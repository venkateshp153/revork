import {
  API_KEY,
  SHEETS_BASE,
  appendSheetRow,
  appendSheetRowRaw,
  columnLetter,
  fetchSheetRows,
  getGoogleAccessToken,
  getSheetHeaders,
  updateSheetRange,
  type SheetRow,
} from './sheets';
import { getSheetDefinition } from '@/src/constants/workspace';
import {
  distanceMeters,
  formatDuration,
  type RouteLocation,
} from './routePlanner';
import { updateWorkerFields, type WorkerIdentity } from './workerManagement';

/**
 * Delivery spots & shared delivery locations.
 *
 * Admins and managers keep one shared list of delivery addresses in the
 * workspace `DeliveryLocations` tab. Every employee gets a "spot" (a base
 * location) stored on their Workers row. Pending addresses are assigned to the
 * employee whose spot is closest, so the whole team is balanced automatically
 * without assigning addresses one by one.
 *
 * Assignments are derived on the device from the two sheets, which keeps every
 * phone in sync without extra writes. Delivered rows store the employee who
 * completed them so historical counts never change when a spot moves.
 */

export const DELIVERY_LOCATIONS_SHEET = 'DeliveryLocations';

export type DeliveryLocationStatus = 'pending' | 'delivered';

export interface DeliveryLocationRecord {
  id: string;
  address: string;
  lat: number;
  lng: number;
  contactName: string;
  phone: string;
  orderCount: number;
  note: string;
  status: DeliveryLocationStatus;
  deliveredAt?: string;
  workerId: string;
  workerName: string;
  createdAt?: string;
  createdBy?: string;
  /** 1-based spreadsheet row, used for updates and deletes. */
  row: number;
}

export interface DeliveryLocationInput {
  address: string;
  lat: number;
  lng: number;
  contactName?: string;
  phone?: string;
  orderCount?: number;
  note?: string;
}

export interface WorkerSpot {
  workerId: string;
  name: string;
  email: string;
  designation: string;
  spot: RouteLocation | null;
  row: string;
}

export interface WorkerDeliveryPlan {
  worker: WorkerSpot;
  /** Pending locations assigned to this spot, in the best driving order. */
  pending: DeliveryLocationRecord[];
  /** Delivered locations completed by this employee. */
  delivered: DeliveryLocationRecord[];
  /** The next pending delivery for this employee. */
  current: DeliveryLocationRecord | null;
  /** Estimated minutes left for the pending deliveries. */
  estimatedMinutes: number;
  /** Cumulative ETA (minutes from now) keyed by location id. */
  etas: Record<string, number>;
  /** Estimated driving distance left. */
  totalDistanceMeters: number;
  ordersPending: number;
  ordersDelivered: number;
}

export interface DeliveryDistribution {
  plans: WorkerDeliveryPlan[];
  /** Pending locations that could not be assigned because no employee has a spot. */
  unassigned: DeliveryLocationRecord[];
  pendingTotal: number;
  deliveredTotal: number;
  ordersPending: number;
  ordersDelivered: number;
  /** Every employee who has a spot set. */
  spotsSet: number;
}

/** City driving estimate used for the delivery ETA shown in the app. */
const AVERAGE_METERS_PER_SECOND = 8.33;
/** Time spent at the door per delivery. */
const SERVICE_SECONDS_PER_STOP = 4 * 60;

const ensuredSheets = new Set<string>();

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function spreadsheetHasSheet(
  sheetId: string,
  title: string,
  token?: string
): Promise<boolean | null> {
  try {
    const keyPart = token ? '' : `&key=${API_KEY}`;
    const response = await fetch(
      `${SHEETS_BASE}/${sheetId}?fields=sheets.properties${keyPart}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.sheets || []).some(
      (sheet: any) => sheet?.properties?.title === title
    );
  } catch {
    return null;
  }
}

/** Adds the DeliveryLocations tab for workspaces created before this feature. */
export async function ensureDeliveryLocationsSheet(
  sheetId: string,
  token: string
): Promise<boolean> {
  if (!sheetId || !token) return false;
  if (ensuredSheets.has(sheetId)) return true;

  const exists = await spreadsheetHasSheet(sheetId, DELIVERY_LOCATIONS_SHEET, token);
  if (exists === null) return false;

  if (!exists) {
    const createResponse = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          { addSheet: { properties: { title: DELIVERY_LOCATIONS_SHEET } } },
        ],
      }),
    });
    if (!createResponse.ok) {
      const text = await createResponse.text().catch(() => '');
      console.warn(
        '[DeliverySpots] Could not create sheet:',
        createResponse.status,
        text
      );
      return false;
    }

    const headers = getSheetDefinition(DELIVERY_LOCATIONS_SHEET)?.headers || [];
    if (headers.length > 0) {
      try {
        await appendSheetRowRaw(
          sheetId,
          DELIVERY_LOCATIONS_SHEET,
          headers,
          token
        );
      } catch (error) {
        console.warn('[DeliverySpots] Could not write headers:', error);
      }
    }
  }

  ensuredSheets.add(sheetId);
  return true;
}

function locationFromRow(row: SheetRow): DeliveryLocationRecord | null {
  const lat = toFiniteNumber(row.Lat);
  const lng = toFiniteNumber(row.Lng);
  if (lat === null || lng === null) return null;
  const address = (row.Address || '').trim();
  if (!address) return null;
  const orderCount = Math.max(
    0,
    Math.round(toFiniteNumber(row.OrderCount) ?? 0)
  );
  return {
    id: row.LocationID || `loc_${row._row}`,
    address,
    lat,
    lng,
    contactName: row.ContactName || '',
    phone: row.Phone || '',
    orderCount,
    note: row.Notes || '',
    status: (row.Status || '').toLowerCase() === 'delivered'
      ? 'delivered'
      : 'pending',
    ...(row.DeliveredAt ? { deliveredAt: row.DeliveredAt } : {}),
    workerId: row.WorkerID || '',
    workerName: row.WorkerName || '',
    ...(row.CreatedAt ? { createdAt: row.CreatedAt } : {}),
    ...(row.CreatedBy ? { createdBy: row.CreatedBy } : {}),
    row: Number(row._row) || 0,
  };
}

/** Reads the shared delivery list. A missing tab is treated as empty. */
export async function loadDeliveryLocations(
  sheetId: string
): Promise<DeliveryLocationRecord[]> {
  if (!sheetId) return [];
  try {
    const rows = await fetchSheetRows(sheetId, DELIVERY_LOCATIONS_SHEET);
    return rows
      .map(locationFromRow)
      .filter((record): record is DeliveryLocationRecord => !!record);
  } catch {
    return [];
  }
}

function rowForLocation(
  input: DeliveryLocationInput,
  createdBy: string
): string[] {
  const headers = getSheetDefinition(DELIVERY_LOCATIONS_SHEET)?.headers || [];
  const values: Record<string, string> = {
    LocationID: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    Address: input.address,
    Lat: input.lat.toFixed(6),
    Lng: input.lng.toFixed(6),
    ContactName: input.contactName || '',
    Phone: input.phone || '',
    OrderCount: `${Math.max(0, Math.round(input.orderCount || 0))}`,
    Notes: input.note || '',
    Status: 'pending',
    DeliveredAt: '',
    WorkerID: '',
    WorkerName: '',
    CreatedAt: new Date().toISOString(),
    CreatedBy: createdBy,
  };
  return headers.map((header) => values[header] ?? '');
}

/** Adds one or more addresses to the shared list (local-first + sync queue). */
export async function addDeliveryLocations(
  sheetId: string,
  inputs: DeliveryLocationInput[],
  createdBy: string
): Promise<number> {
  if (!sheetId || inputs.length === 0) return 0;
  const token = await getGoogleAccessToken(true);
  if (token) {
    try {
      await ensureDeliveryLocationsSheet(sheetId, token);
    } catch {
      // The append queue reports the real problem if the tab stays missing.
    }
  }
  let added = 0;
  for (const input of inputs) {
    try {
      await appendSheetRow(
        sheetId,
        DELIVERY_LOCATIONS_SHEET,
        rowForLocation(input, createdBy),
        token
      );
      added += 1;
    } catch (error) {
      console.warn('[DeliverySpots] Could not add location:', error);
    }
  }
  return added;
}

/** Removes a location by clearing its spreadsheet row. */
export async function deleteDeliveryLocation(
  sheetId: string,
  record: DeliveryLocationRecord
): Promise<void> {
  if (!sheetId || !record.row) return;
  const headers = await getSheetHeaders(sheetId, DELIVERY_LOCATIONS_SHEET);
  const columns = headers.length || 14;
  const token = await getGoogleAccessToken(true);
  const empty = new Array(columns).fill('');
  await updateSheetRange(
    sheetId,
    `${DELIVERY_LOCATIONS_SHEET}!A${record.row}:${columnLetter(
      columns
    )}${record.row}`,
    [empty],
    token
  );
}

/**
 * Marks a shared location delivered (or puts it back in the pending pool) and
 * records who delivered it.
 */
export async function setLocationDelivered(
  sheetId: string,
  locationId: string,
  delivered: boolean,
  worker: { workerId?: string; name?: string }
): Promise<void> {
  if (!sheetId || !locationId) return;
  let rows: SheetRow[] = [];
  try {
    rows = await fetchSheetRows(sheetId, DELIVERY_LOCATIONS_SHEET);
  } catch {
    return;
  }
  const record = rows.find((row) => (row.LocationID || '') === locationId);
  if (!record) return;

  // Fixed layout from WORKSPACE_SHEETS: Status, DeliveredAt, WorkerID,
  // WorkerName occupy consecutive columns I–L. Writing one range keeps this
  // working offline (the sheet layer queues it) without extra header reads.
  const token = await getGoogleAccessToken(false);
  try {
    await updateSheetRange(
      sheetId,
      `${DELIVERY_LOCATIONS_SHEET}!I${record._row}:L${record._row}`,
      [
        [
          delivered ? 'delivered' : 'pending',
          delivered ? new Date().toISOString() : '',
          delivered ? worker.workerId || '' : '',
          delivered ? worker.name || '' : '',
        ],
      ],
      token
    );
  } catch (error) {
    console.warn('[DeliverySpots] Could not update location:', error);
  }
}

/** Reads every employee and their delivery spot. */
export async function loadWorkerSpots(sheetId: string): Promise<WorkerSpot[]> {
  if (!sheetId) return [];
  let rows: SheetRow[] = [];
  try {
    rows = await fetchSheetRows(sheetId, 'Workers');
  } catch {
    return [];
  }
  return workerSpotsFromRows(rows);
}

/** Derives employee spots from Workers rows that were already fetched. */
export function workerSpotsFromRows(rows: SheetRow[]): WorkerSpot[] {
  return rows
    .filter((row) => (row.Designation || '').toLowerCase() !== 'admin')
    .filter((row) => !!row.WorkerID || !!row.Name)
    .map((row) => {
      const lat = toFiniteNumber(row.SpotLat);
      const lng = toFiniteNumber(row.SpotLng);
      const address = (row.SpotAddress || '').trim();
      return {
        workerId: row.WorkerID || `worker_row_${row._row}`,
        name: row.Name || row.Email || row.WorkerID || 'Employee',
        email: row.Email || '',
        designation: row.Designation || 'employee',
        spot:
          lat !== null && lng !== null
            ? {
                address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                lat,
                lng,
              }
            : null,
        row: row._row,
      };
    });
}

/** Saves an employee spot on their Workers row. */
export async function saveWorkerSpot(
  sheetId: string,
  token: string,
  worker: WorkerIdentity,
  spot: RouteLocation | null
): Promise<void> {
  await updateWorkerFields(sheetId, token, worker, {
    SpotAddress: spot?.address || '',
    SpotLat: spot ? spot.lat.toFixed(6) : '',
    SpotLng: spot ? spot.lng.toFixed(6) : '',
  });
}

function orderByNearest<T extends RouteLocation>(
  start: RouteLocation,
  items: T[]
): { ordered: T[]; totalDistanceMeters: number } {
  const remaining = [...items];
  const ordered: T[] = [];
  let current: RouteLocation = start;
  let totalDistanceMeters = 0;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((item, index) => {
      const distance = distanceMeters(current, item);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    if (next) {
      totalDistanceMeters += bestDistance;
      ordered.push(next);
      current = next;
    }
  }

  return { ordered, totalDistanceMeters };
}

/**
 * Estimated time for a spot's pending deliveries: a nearest-neighbour drive
 * from the spot plus a few minutes at every door.
 */
export function estimateDeliveryMinutes(
  spot: RouteLocation,
  locations: DeliveryLocationRecord[]
): {
  minutes: number;
  distanceMeters: number;
  ordered: DeliveryLocationRecord[];
  etas: Record<string, number>;
} {
  if (locations.length === 0) {
    return { minutes: 0, distanceMeters: 0, ordered: [], etas: {} };
  }
  const { ordered } = orderByNearest(spot, locations);
  const etas: Record<string, number> = {};
  let elapsedSeconds = 0;
  let totalDistanceMeters = 0;
  let previous: RouteLocation = spot;

  ordered.forEach((location) => {
    const legMeters = distanceMeters(previous, location);
    totalDistanceMeters += legMeters;
    elapsedSeconds +=
      legMeters / AVERAGE_METERS_PER_SECOND + SERVICE_SECONDS_PER_STOP;
    etas[location.id] = Math.max(1, Math.round(elapsedSeconds / 60));
    previous = location;
  });

  return {
    minutes: Math.max(1, Math.round(elapsedSeconds / 60)),
    distanceMeters: Math.round(totalDistanceMeters),
    ordered,
    etas,
  };
}

export function formatDeliveryEta(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  return formatDuration(minutes * 60);
}

/**
 * Assigns every pending address to the closest employee spot and combines the
 * result with each employee's delivered history.
 */
export function buildDistribution(
  locations: DeliveryLocationRecord[],
  workers: WorkerSpot[]
): DeliveryDistribution {
  const pending = locations.filter((location) => location.status !== 'delivered');
  const delivered = locations.filter((location) => location.status === 'delivered');
  const spots = workers.filter((worker) => !!worker.spot);

  const grouped = new Map<string, DeliveryLocationRecord[]>();
  workers.forEach((worker) => grouped.set(worker.workerId, []));
  const unassigned: DeliveryLocationRecord[] = [];

  pending.forEach((location) => {
    let bestWorker: WorkerSpot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    spots.forEach((worker) => {
      if (!worker.spot) return;
      const distance = distanceMeters(worker.spot, location);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestWorker = worker;
      }
    });
    if (bestWorker) {
      const list = grouped.get((bestWorker as WorkerSpot).workerId) || [];
      list.push(location);
      grouped.set((bestWorker as WorkerSpot).workerId, list);
    } else {
      unassigned.push(location);
    }
  });

  const plans: WorkerDeliveryPlan[] = workers.map((worker) => {
    const pendingForWorker = grouped.get(worker.workerId) || [];
    const deliveredForWorker = delivered.filter(
      (location) =>
        !!location.workerId && location.workerId === worker.workerId
    );
    const estimate = worker.spot
      ? estimateDeliveryMinutes(worker.spot, pendingForWorker)
      : { minutes: 0, distanceMeters: 0, ordered: pendingForWorker, etas: {} };

    return {
      worker,
      pending: estimate.ordered,
      delivered: deliveredForWorker,
      current: estimate.ordered[0] || null,
      estimatedMinutes: estimate.minutes,
      etas: estimate.etas,
      totalDistanceMeters: estimate.distanceMeters,
      ordersPending: pendingForWorker.reduce(
        (sum, location) => sum + (location.orderCount || 0),
        0
      ),
      ordersDelivered: deliveredForWorker.reduce(
        (sum, location) => sum + (location.orderCount || 0),
        0
      ),
    };
  });

  // Employees with active work first, then the rest of the team.
  plans.sort((a, b) => {
    if (b.pending.length !== a.pending.length) {
      return b.pending.length - a.pending.length;
    }
    return a.worker.name.localeCompare(b.worker.name);
  });

  return {
    plans,
    unassigned,
    pendingTotal: pending.length,
    deliveredTotal: delivered.length,
    ordersPending: pending.reduce(
      (sum, location) => sum + (location.orderCount || 0),
      0
    ),
    ordersDelivered: delivered.reduce(
      (sum, location) => sum + (location.orderCount || 0),
      0
    ),
    spotsSet: spots.length,
  };
}

/** Convenience helper for the signed-in employee's own plan. */
export function findPlanForWorker(
  distribution: DeliveryDistribution,
  workerId?: string | null,
  name?: string | null
): WorkerDeliveryPlan | null {
  if (workerId) {
    const byId = distribution.plans.find(
      (plan) => plan.worker.workerId === workerId
    );
    if (byId) return byId;
  }
  if (name) {
    return (
      distribution.plans.find(
        (plan) =>
          plan.worker.name.trim().toLowerCase() === name.trim().toLowerCase()
      ) || null
    );
  }
  return null;
}
