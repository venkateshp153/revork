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
import { sendAlert } from './notifications';
import { updateWorkerFields, type WorkerIdentity } from './workerManagement';

/**
 * Delivery spots & shared delivery locations.
 *
 * Admins and managers keep one shared list of delivery addresses in the
 * workspace `DeliveryLocations` tab. Every employee gets a "spot" (a base
 * location) stored on their Workers row. The admin adds the day's addresses,
 * clicks Optimize, and each pending address is distributed across the closest
 * employee spots. The saved assignment survives reloads, and admins/managers
 * can still assign, deassign, edit or delete any address afterwards.
 *
 * Delivered rows store the employee who completed them so historical counts
 * never change when a spot moves.
 */

export const DELIVERY_LOCATIONS_SHEET = 'DeliveryLocations';

/**
 * Columns added after the first version of the shared list. They are appended
 * to older spreadsheets automatically so existing workspaces keep working.
 */
export const DELIVERY_ASSIGNMENT_HEADERS = [
  'AssignedWorkerID',
  'AssignedWorkerName',
  'AssignmentMode',
  'AssignedAt',
  'AssignedBy',
  'UpdatedAt',
  'UpdatedBy',
  'Priority',
];

export type DeliveryLocationStatus = 'pending' | 'delivered';

/**
 * How a pending location is tied to an employee:
 * - `auto` (default): follows the closest spot, recalculated on every read.
 * - `optimized`: saved by the admin's Optimize action for today's run.
 * - `manual`: explicitly assigned by an admin or manager.
 * - `unassigned`: deliberately removed from every employee's plan.
 */
export type DeliveryAssignmentMode = 'auto' | 'manual' | 'optimized' | 'unassigned';

export interface DeliveryActor {
  workerId?: string;
  name?: string;
  isManager?: boolean;
}

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
  /** How the pending location is assigned to an employee. */
  assignmentMode: DeliveryAssignmentMode;
  /** Employee chosen by Optimize or by a manual assign. */
  assignedWorkerId: string;
  assignedWorkerName: string;
  assignedAt?: string;
  assignedBy?: string;
  /** High-priority location: carry it to route stops and deliver first. */
  priority: boolean;
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
  /** Pending locations with no employee: no spot, deassigned, or missing assignment. */
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
const ensuredColumns = new Set<string>();

/** Appends the assignment columns to workspaces created before they existed. */
export async function ensureDeliveryLocationColumns(
  sheetId: string,
  token: string
): Promise<boolean> {
  if (!sheetId || !token) return false;
  const key = `${sheetId}:assignment`;
  if (ensuredColumns.has(key)) return true;

  try {
    const headers = await getSheetHeaders(sheetId, DELIVERY_LOCATIONS_SHEET);
    if (headers.length === 0) return false;
    const missing = DELIVERY_ASSIGNMENT_HEADERS.filter(
      (header) => !headers.includes(header)
    );
    if (missing.length > 0) {
      await updateSheetRange(
        sheetId,
        `${DELIVERY_LOCATIONS_SHEET}!${columnLetter(headers.length + 1)}1`,
        [missing],
        token
      );
    }
    ensuredColumns.add(key);
    return true;
  } catch (error) {
    console.warn('[DeliverySpots] Could not add assignment columns:', error);
    return false;
  }
}

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
  await ensureDeliveryLocationColumns(sheetId, token);
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
  const rawMode = (row.AssignmentMode || '').trim().toLowerCase();
  const assignedWorkerId = (row.AssignedWorkerID || '').trim();
  const assignmentMode: DeliveryAssignmentMode =
    rawMode === 'manual' || rawMode === 'optimized' || rawMode === 'unassigned'
      ? rawMode
      : assignedWorkerId
      ? 'manual'
      : 'auto';
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
    assignmentMode,
    assignedWorkerId,
    assignedWorkerName: (row.AssignedWorkerName || '').trim(),
    ...(row.AssignedAt ? { assignedAt: row.AssignedAt } : {}),
    ...(row.AssignedBy ? { assignedBy: row.AssignedBy } : {}),
    priority:
      (row.Priority || '').trim().toLowerCase() === 'true' ||
      (row.Priority || '').trim() === '1',
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
    const records = rows
      .map(locationFromRow)
      .filter((record): record is DeliveryLocationRecord => !!record);
    return dedupeDeliveryLocations(records);
  } catch {
    return [];
  }
}

/** Normalizes an address so case, spacing and punctuation cannot hide a dup. */
export function normalizeDeliveryAddressKey(value?: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function deliveryLocationKey(
  record: Pick<DeliveryLocationRecord, 'address' | 'lat' | 'lng'>
): string {
  const address = normalizeDeliveryAddressKey(record.address);
  if (address) return `addr:${address}`;
  return `geo:${record.lat.toFixed(5)},${record.lng.toFixed(5)}`;
}

/**
 * Collapses rows that point at the same address. The first row keeps its
 * position; delivered/assignment details from a duplicate are merged in so
 * progress is not lost.
 */
export function dedupeDeliveryLocations(
  records: DeliveryLocationRecord[]
): DeliveryLocationRecord[] {
  const seen = new Map<string, number>();
  const result: DeliveryLocationRecord[] = [];

  records.forEach((record) => {
    const key = deliveryLocationKey(record);
    const existingIndex = seen.get(key);
    if (existingIndex === undefined) {
      seen.set(key, result.length);
      result.push(record);
      return;
    }

    const current = result[existingIndex];
    const delivered = current.status === 'delivered' || record.status === 'delivered';
    result[existingIndex] = {
      ...current,
      ...(delivered ? { status: 'delivered' as const } : {}),
      ...(current.deliveredAt || record.deliveredAt
        ? { deliveredAt: current.deliveredAt || record.deliveredAt }
        : {}),
      ...(current.workerId || record.workerId
        ? { workerId: current.workerId || record.workerId }
        : {}),
      ...(current.workerName || record.workerName
        ? { workerName: current.workerName || record.workerName }
        : {}),
      ...(current.assignedWorkerId || record.assignedWorkerId
        ? { assignedWorkerId: current.assignedWorkerId || record.assignedWorkerId }
        : {}),
      ...(current.assignedWorkerName || record.assignedWorkerName
        ? {
            assignedWorkerName:
              current.assignedWorkerName || record.assignedWorkerName,
          }
        : {}),
      ...(current.assignmentMode === 'auto' &&
      record.assignmentMode !== 'auto'
        ? { assignmentMode: record.assignmentMode }
        : {}),
      ...(current.contactName || record.contactName
        ? { contactName: current.contactName || record.contactName }
        : {}),
      ...(current.phone || record.phone
        ? { phone: current.phone || record.phone }
        : {}),
      ...(current.note || record.note ? { note: current.note || record.note } : {}),
      priority: current.priority || record.priority,
      orderCount: Math.max(current.orderCount || 0, record.orderCount || 0),
    };
  });

  return result;
}

async function deliveryLocationsGridId(
  sheetId: string,
  token: string
): Promise<number | null> {
  try {
    const response = await fetch(
      `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const sheet = (data?.sheets || []).find(
      (item: any) =>
        item?.properties?.title === DELIVERY_LOCATIONS_SHEET
    );
    const id = sheet?.properties?.sheetId;
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Deletes duplicate rows from the shared DeliveryLocations tab, keeping the
 * most useful row for each address. Returns how many rows were removed.
 * Safe to call when signed in; it no-ops without a token.
 */
const duplicateCleanupRuns = new Map<string, Promise<number>>();

async function runDuplicateDeliveryLocationsCleanup(
  sheetId: string
): Promise<number> {
  if (!sheetId) return 0;
  let token: string | null = null;
  try {
    // Silent only: never pop up an account picker just for cleanup.
    token = await getGoogleAccessToken(false);
  } catch {
    return 0;
  }
  if (!token) return 0;

  let rows: SheetRow[] = [];
  try {
    rows = await fetchSheetRows(sheetId, DELIVERY_LOCATIONS_SHEET);
  } catch {
    return 0;
  }
  const records = rows
    .map(locationFromRow)
    .filter((record): record is DeliveryLocationRecord => !!record);
  if (records.length < 2) return 0;

  const score = (record: DeliveryLocationRecord): number =>
    (record.status === 'delivered' ? 4 : 0) +
    (record.assignmentMode === 'manual'
      ? 3
      : record.assignmentMode === 'optimized'
      ? 2
      : record.assignmentMode === 'unassigned'
      ? -1
      : 0) +
    (record.assignedWorkerId ? 1 : 0);

  const keep = new Map<string, DeliveryLocationRecord>();
  const duplicates: DeliveryLocationRecord[] = [];
  records.forEach((record) => {
    const key = deliveryLocationKey(record);
    const keeper = keep.get(key);
    if (!keeper) {
      keep.set(key, record);
      return;
    }
    if (score(record) > score(keeper)) {
      duplicates.push(keeper);
      keep.set(key, record);
    } else {
      duplicates.push(record);
    }
  });
  if (duplicates.length === 0) return 0;

  const gridId = await deliveryLocationsGridId(sheetId, token);
  if (gridId === null) return 0;

  // Delete from the bottom up so the remaining row indexes stay valid.
  const rowNumbers = Array.from(
    new Set(duplicates.map((record) => record.row).filter((row) => row > 0))
  ).sort((a, b) => b - a);

  let removed = 0;
  for (let index = 0; index < rowNumbers.length; index += 50) {
    const slice = rowNumbers.slice(index, index + 50);
    try {
      const response = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: slice.map((row) => ({
            deleteDimension: {
              range: {
                sheetId: gridId,
                dimension: 'ROWS',
                startIndex: row - 1,
                endIndex: row,
              },
            },
          })),
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn(
          '[DeliverySpots] Could not remove duplicate rows:',
          response.status,
          text
        );
        break;
      }
      removed += slice.length;
    } catch (error) {
      console.warn('[DeliverySpots] Could not remove duplicate rows:', error);
      break;
    }
  }
  return removed;
}

export function removeDuplicateDeliveryLocations(
  sheetId: string
): Promise<number> {
  if (!sheetId) return Promise.resolve(0);
  const existing = duplicateCleanupRuns.get(sheetId);
  if (existing) return existing;
  const run = runDuplicateDeliveryLocationsCleanup(sheetId).finally(() => {
    duplicateCleanupRuns.delete(sheetId);
  });
  duplicateCleanupRuns.set(sheetId, run);
  return run;
}

function closestSpot(
  location: RouteLocation,
  workers: WorkerSpot[]
): WorkerSpot | null {
  let best: WorkerSpot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  workers.forEach((worker) => {
    if (!worker.spot) return;
    const distance = distanceMeters(worker.spot, location);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = worker;
    }
  });
  return best;
}

function rowForLocation(
  input: DeliveryLocationInput,
  createdBy: string,
  worker: WorkerSpot | null,
  actorName: string
): string[] {
  const headers = getSheetDefinition(DELIVERY_LOCATIONS_SHEET)?.headers || [];
  const now = new Date().toISOString();
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
    CreatedAt: now,
    CreatedBy: createdBy,
    AssignedWorkerID: worker?.workerId || '',
    AssignedWorkerName: worker?.name || '',
    AssignmentMode: worker ? 'optimized' : 'auto',
    AssignedAt: worker ? now : '',
    AssignedBy: worker ? actorName : '',
    UpdatedAt: now,
    UpdatedBy: createdBy,
    Priority: '',
  };
  return headers.map((header) => values[header] ?? '');
}

/**
 * Adds one or more addresses to the shared list (local-first + sync queue).
 *
 * When employee spots are supplied, each new address is immediately assigned
 * to the closest employee spot and the assignment columns are written in the
 * same row. That makes the assignment visible to the employee on their next
 * read without waiting for a separate Optimize pass.
 */
export async function addDeliveryLocations(
  sheetId: string,
  inputs: DeliveryLocationInput[],
  createdBy: string,
  actor?: DeliveryActor,
  workers: WorkerSpot[] = []
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
  const assigned: Map<
    string,
    { name: string; addresses: string[] }
  > = new Map();
  for (const input of inputs) {
    const location: RouteLocation = {
      address: input.address,
      lat: input.lat,
      lng: input.lng,
    };
    const worker = closestSpot(location, workers);
    try {
      await appendSheetRow(
        sheetId,
        DELIVERY_LOCATIONS_SHEET,
        rowForLocation(input, createdBy, worker, actor?.name || createdBy),
        token
      );
      added += 1;
      if (worker) {
        const entry = assigned.get(worker.workerId) || {
          name: worker.name,
          addresses: [],
        };
        entry.addresses.push(input.address);
        assigned.set(worker.workerId, entry);
      }
    } catch (error) {
      console.warn('[DeliverySpots] Could not add location:', error);
    }
  }

  for (const [workerId, entry] of assigned) {
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId,
      title: 'New delivery assigned',
      body:
        entry.addresses.length === 1
          ? `A new delivery location was assigned to you: ${entry.addresses[0]}.`
          : `${entry.addresses.length} new delivery locations were assigned to you.`,
      actor,
    });
  }

  if (added > 0) {
    await notifyAdminOfDeliveryChange({
      sheetId,
      token,
      actor,
      title: 'Delivery locations added by manager',
      body: `${actor?.name || 'A manager'} added ${added} location${
        added === 1 ? '' : 's'
      } to the delivery list.`,
    });
  }
  return added;
}

/** Lets the admin know when a manager changes the shared delivery list. */
async function notifyAdminOfDeliveryChange(params: {
  sheetId: string;
  token: string | null;
  actor?: DeliveryActor;
  title: string;
  body: string;
}): Promise<void> {
  if (!params.actor?.isManager) return;
  try {
    await sendAlert({
      sheetId: params.sheetId,
      token: params.token,
      target: 'admin',
      title: params.title,
      body: params.body,
      durationHours: 0,
      fromUid:
        params.actor.workerId || params.actor.name || 'manager',
      type: 'delivery_audit',
    });
  } catch (error) {
    console.warn('[DeliverySpots] Could not notify admin:', error);
  }
}

/** Notifies the specific employee whose delivery plan changed. */
async function notifyEmployeeOfAssignment(params: {
  sheetId: string;
  token: string | null;
  workerId: string;
  title: string;
  body: string;
  actor?: DeliveryActor;
}): Promise<void> {
  if (!params.sheetId || !params.workerId) return;
  try {
    await sendAlert({
      sheetId: params.sheetId,
      token: params.token,
      target: params.workerId,
      title: params.title,
      body: params.body,
      durationHours: 0,
      fromUid:
        params.actor?.workerId || params.actor?.name || 'delivery-plan',
      type: 'delivery_assignment',
    });
  } catch (error) {
    console.warn('[DeliverySpots] Could not notify employee:', error);
  }
}

function assignmentRowValues(
  worker: { workerId?: string; name?: string } | null,
  mode: DeliveryAssignmentMode,
  actor: DeliveryActor | undefined,
  now: string
): string[] {
  const actorName = actor?.name || '';
  return [
    worker?.workerId || '',
    worker?.name || '',
    mode,
    worker ? now : '',
    actorName,
    now,
    actorName,
  ];
}

async function writeAssignment(
  sheetId: string,
  record: DeliveryLocationRecord,
  worker: { workerId?: string; name?: string } | null,
  mode: DeliveryAssignmentMode,
  actor?: DeliveryActor
): Promise<void> {
  const token = await getGoogleAccessToken(true);
  if (token) {
    await ensureDeliveryLocationColumns(sheetId, token);
  }
  const now = new Date().toISOString();
  await updateSheetRange(
    sheetId,
    `${DELIVERY_LOCATIONS_SHEET}!O${record.row}:U${record.row}`,
    [assignmentRowValues(worker, mode, actor, now)],
    token
  );
}

/** Assigns one pending location to a specific employee (manual override). */
export async function assignDeliveryLocation(
  sheetId: string,
  record: DeliveryLocationRecord,
  worker: { workerId?: string; name?: string },
  actor?: DeliveryActor
): Promise<void> {
  if (!sheetId || !record.row || !worker.workerId) return;
  const previousWorkerId = record.assignedWorkerId;
  const previousWorkerName = record.assignedWorkerName;
  await writeAssignment(sheetId, record, worker, 'manual', actor);
  const token = await getGoogleAccessToken(false);

  if (previousWorkerId && previousWorkerId !== worker.workerId) {
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId: previousWorkerId,
      title: 'Delivery reassigned',
      body: `“${record.address}” is no longer assigned to you.`,
      actor,
    });
  }
  await notifyEmployeeOfAssignment({
    sheetId,
    token,
    workerId: worker.workerId,
    title: 'New delivery assigned',
    body: `“${record.address}” was assigned to you.`,
    actor,
  });
  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: 'Delivery assigned by manager',
    body: `${actor?.name || 'A manager'} assigned “${record.address}” to ${worker.name || previousWorkerName || 'an employee'}.`,
  });
}

/** Removes a location from every employee's plan until it is assigned again. */
export async function deassignDeliveryLocation(
  sheetId: string,
  record: DeliveryLocationRecord,
  actor?: DeliveryActor
): Promise<void> {
  if (!sheetId || !record.row) return;
  const previousWorkerId = record.assignedWorkerId;
  await writeAssignment(sheetId, record, null, 'unassigned', actor);
  const token = await getGoogleAccessToken(false);
  if (previousWorkerId) {
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId: previousWorkerId,
      title: 'Delivery removed',
      body: `“${record.address}” was removed from your delivery plan.`,
      actor,
    });
  }
  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: 'Delivery unassigned by manager',
    body: `${actor?.name || 'A manager'} removed “${record.address}” from the delivery plan.`,
  });
}

/** Sets a location back to automatic nearest-spot assignment. */
export async function autoAssignDeliveryLocation(
  sheetId: string,
  record: DeliveryLocationRecord,
  actor?: DeliveryActor
): Promise<void> {
  if (!sheetId || !record.row) return;
  const previousWorkerId = record.assignedWorkerId;
  await writeAssignment(sheetId, record, null, 'auto', actor);
  const token = await getGoogleAccessToken(false);
  if (previousWorkerId) {
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId: previousWorkerId,
      title: 'Delivery assignment changed',
      body: `“${record.address}” is no longer specifically assigned to you.`,
      actor,
    });
  }
  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: 'Delivery assignment changed by manager',
    body: `${actor?.name || 'A manager'} moved “${record.address}” back to automatic spot assignment.`,
  });
}

/** Edits the address, receiver or order count of a location. */
export async function updateDeliveryLocation(
  sheetId: string,
  record: DeliveryLocationRecord,
  input: DeliveryLocationInput,
  actor?: DeliveryActor
): Promise<void> {
  if (!sheetId || !record.row) return;
  const token = await getGoogleAccessToken(true);
  if (token) {
    await ensureDeliveryLocationColumns(sheetId, token);
  }
  const now = new Date().toISOString();
  await updateSheetRange(
    sheetId,
    `${DELIVERY_LOCATIONS_SHEET}!A${record.row}:H${record.row}`,
    [
      [
        input.address,
        input.lat.toFixed(6),
        input.lng.toFixed(6),
        input.contactName || '',
        input.phone || '',
        `${Math.max(0, Math.round(input.orderCount || 0))}`,
        input.note || '',
      ],
    ],
    token
  );
  await updateSheetRange(
    sheetId,
    `${DELIVERY_LOCATIONS_SHEET}!T${record.row}:U${record.row}`,
    [[now, actor?.name || '']],
    token
  );
  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: 'Delivery location edited by manager',
    body: `${actor?.name || 'A manager'} updated “${input.address}”.`,
  });
  if (record.assignedWorkerId) {
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId: record.assignedWorkerId,
      title: 'Delivery details updated',
      body: `The details for “${input.address}” were updated.`,
      actor,
    });
  }
}

/** Removes a location by clearing its spreadsheet row. */
export async function deleteDeliveryLocation(
  sheetId: string,
  record: DeliveryLocationRecord,
  actor?: DeliveryActor
): Promise<void> {
  if (!sheetId || !record.row) return;
  const headers = await getSheetHeaders(sheetId, DELIVERY_LOCATIONS_SHEET);
  const schemaColumns =
    getSheetDefinition(DELIVERY_LOCATIONS_SHEET)?.headers.length || 21;
  const columns = Math.max(headers.length, schemaColumns);
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
  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: 'Delivery location deleted by manager',
    body: `${actor?.name || 'A manager'} deleted “${record.address}”.`,
  });
  if (record.assignedWorkerId) {
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId: record.assignedWorkerId,
      title: 'Delivery removed',
      body: `“${record.address}” was removed from your delivery plan.`,
      actor,
    });
  }
}

/**
 * Distributes pending locations across employee spots for today's run.
 *
 * Locations are matched nearest-first to the closest spot, with a soft
 * per-employee capacity so one spot cannot swallow the whole day. The result
 * is written to the sheet (AssignmentMode = optimized) so the distribution is
 * the same on every phone and can still be changed one row at a time.
 */
export async function optimizeDeliveryAssignments(
  sheetId: string,
  locations: DeliveryLocationRecord[],
  workers: WorkerSpot[],
  actor?: DeliveryActor
): Promise<{ assigned: number; unassigned: number }> {
  if (!sheetId) return { assigned: 0, unassigned: 0 };
  const pending = locations.filter(
    (location) => location.status !== 'delivered' && location.row > 0
  );
  const spots = workers.filter((worker) => !!worker.spot);
  if (spots.length === 0 || pending.length === 0) {
    return { assigned: 0, unassigned: pending.length };
  }

  const token = await getGoogleAccessToken(true);
  if (token) {
    await ensureDeliveryLocationColumns(sheetId, token);
  }
  const actorName = actor?.name || 'Admin';
  const now = new Date().toISOString();
  const capacity = Math.max(1, Math.ceil(pending.length / spots.length));
  const loads = new Map<string, number>();
  const applied = new Map<string, { workerId: string; name: string }>();

  // Lock in the closest addresses first so they always go to their own spot.
  const ordered = [...pending].sort((a, b) => {
    const aDistance = Math.min(
      ...spots.map((worker) => distanceMeters(worker.spot!, a))
    );
    const bDistance = Math.min(
      ...spots.map((worker) => distanceMeters(worker.spot!, b))
    );
    return aDistance - bDistance;
  });

  let assigned = 0;
  for (const location of ordered) {
    const ranked = spots
      .map((worker) => ({
        worker,
        distance: distanceMeters(worker.spot!, location),
      }))
      .sort((a, b) => a.distance - b.distance);
    const preferred =
      ranked.find(
        ({ worker }) => (loads.get(worker.workerId) || 0) < capacity
      ) || ranked[0];
    if (!preferred) continue;

    try {
      await updateSheetRange(
        sheetId,
        `${DELIVERY_LOCATIONS_SHEET}!O${location.row}:U${location.row}`,
        [
          assignmentRowValues(
            preferred.worker,
            'optimized',
            actor,
            now
          ),
        ],
        token
      );
      loads.set(
        preferred.worker.workerId,
        (loads.get(preferred.worker.workerId) || 0) + 1
      );
      applied.set(location.id, {
        workerId: preferred.worker.workerId,
        name: preferred.worker.name,
      });
      assigned += 1;
    } catch (error) {
      console.warn('[DeliverySpots] Could not save an assignment:', error);
    }
  }

  // Notify each employee whose plan actually changed, with a single summary
  // instead of one alert per address.
  const addedByWorker = new Map<string, { name: string; count: number }>();
  const removedByWorker = new Map<
    string,
    { name: string; count: number }
  >();
  pending.forEach((location) => {
    const next = applied.get(location.id);
    if (!next) return;
    const previousId = location.assignedWorkerId;
    if (previousId && next.workerId !== previousId) {
      const entry = removedByWorker.get(previousId) || {
        name: location.assignedWorkerName || 'Employee',
        count: 0,
      };
      entry.count += 1;
      removedByWorker.set(previousId, entry);
    }
    if (next && next.workerId !== previousId) {
      const entry = addedByWorker.get(next.workerId) || {
        name: next.name || 'Employee',
        count: 0,
      };
      entry.count += 1;
      addedByWorker.set(next.workerId, entry);
    }
  });

  const affected = new Set([
    ...addedByWorker.keys(),
    ...removedByWorker.keys(),
  ]);
  for (const workerId of affected) {
    const addedCount = addedByWorker.get(workerId)?.count || 0;
    const removedCount = removedByWorker.get(workerId)?.count || 0;
    const parts: string[] = [];
    if (addedCount > 0) {
      parts.push(
        `${addedCount} new location${addedCount === 1 ? '' : 's'} assigned`
      );
    }
    if (removedCount > 0) {
      parts.push(
        `${removedCount} location${removedCount === 1 ? '' : 's'} removed`
      );
    }
    await notifyEmployeeOfAssignment({
      sheetId,
      token,
      workerId,
      title: 'Delivery plan updated',
      body: `${parts.join(' · ')}.`,
      actor,
    });
  }

  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: 'Delivery plan optimized by manager',
    body: `${actorName} redistributed ${assigned} pending location${
      assigned === 1 ? '' : 's'
    } across ${spots.length} employee spot${spots.length === 1 ? '' : 's'}.`,
  });

  return { assigned, unassigned: pending.length - assigned };
}

/** Marks a shared location as high priority so its route stop is delivered first. */
export async function setLocationPriority(
  sheetId: string,
  record: DeliveryLocationRecord,
  priority: boolean,
  actor?: DeliveryActor
): Promise<void> {
  if (!sheetId || !record.row) return;
  const token = await getGoogleAccessToken(true);
  if (token) {
    await ensureDeliveryLocationColumns(sheetId, token);
  }
  let column = 22;
  try {
    const headers = await getSheetHeaders(sheetId, DELIVERY_LOCATIONS_SHEET);
    const index = headers.indexOf('Priority');
    if (index >= 0) column = index + 1;
  } catch {
    // Fall back to the schema position (V).
  }
  await updateSheetRange(
    sheetId,
    `${DELIVERY_LOCATIONS_SHEET}!${columnLetter(column)}${record.row}`,
    [[priority ? 'true' : '']],
    token
  );
  await notifyAdminOfDeliveryChange({
    sheetId,
    token,
    actor,
    title: priority ? 'Delivery marked high priority' : 'Delivery priority removed',
    body: `${actor?.name || 'A manager'} ${
      priority ? 'marked' : 'unmarked'
    } “${record.address}” as high priority.`,
  });
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
 * Builds each employee's plan. Optimized/manual rows keep the employee saved
 * on the sheet; `auto` rows follow the closest spot; `unassigned` rows wait in
 * a separate pool so a deliberate deassign cannot snap back on the next read.
 */
export function buildDistribution(
  locations: DeliveryLocationRecord[],
  workers: WorkerSpot[]
): DeliveryDistribution {
  const pending = locations.filter((location) => location.status !== 'delivered');
  const delivered = locations.filter((location) => location.status === 'delivered');
  const spots = workers.filter((worker) => !!worker.spot);
  const spotById = new Map(spots.map((worker) => [worker.workerId, worker]));

  const grouped = new Map<string, DeliveryLocationRecord[]>();
  workers.forEach((worker) => grouped.set(worker.workerId, []));
  const unassigned: DeliveryLocationRecord[] = [];

  pending.forEach((location) => {
    if (location.assignmentMode === 'unassigned') {
      unassigned.push(location);
      return;
    }

    let target: WorkerSpot | null = null;
    if (
      location.assignmentMode !== 'auto' &&
      location.assignedWorkerId
    ) {
      target = spotById.get(location.assignedWorkerId) || null;
    } else if (location.assignmentMode === 'auto') {
      let bestDistance = Number.POSITIVE_INFINITY;
      spots.forEach((worker) => {
        if (!worker.spot) return;
        const distance = distanceMeters(worker.spot, location);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = worker;
        }
      });
    }

    if (target) {
      const list = grouped.get((target as WorkerSpot).workerId) || [];
      list.push(location);
      grouped.set((target as WorkerSpot).workerId, list);
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
