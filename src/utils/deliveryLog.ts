import {
  API_KEY,
  SHEETS_BASE,
  appendSheetRow,
  appendSheetRowRaw,
  getGoogleAccessToken,
} from './sheets';
import { enqueueMutation } from '@/src/services/localStore';
import { getSheetDefinition } from '@/src/constants/workspace';

/**
 * Delivery audit log.
 *
 * Every completed stop writes one row to the workspace `Deliveries` tab. The
 * write goes through the existing local-first sheet queue, so it still works
 * offline and syncs when the connection returns.
 */

export const DELIVERY_SHEET = 'Deliveries';

const ensuredSheets = new Set<string>();

export interface DeliveryLogEntry {
  deliveryId: string;
  date: string;
  time: string;
  routeId: string;
  routeName: string;
  stopId: string;
  name: string;
  phone: string;
  address: string;
  orderCount: number;
  status: string;
  photoCount: number;
  photoFolder: string;
  gps: string;
  workerName: string;
  workerId: string;
  notes: string;
  createdAt: string;
}

export function makeDeliveryId(): string {
  return `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function localDateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localTimeStamp(date = new Date()): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function deliveryPhotoFolder(date: string): string {
  return `delivered_locations_data/${date}`;
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

/**
 * Adds the Deliveries tab to workspaces created before this feature existed.
 * Safe to call repeatedly; a module cache avoids checking on every delivery.
 */
export async function ensureDeliveriesSheet(
  sheetId: string,
  token: string
): Promise<boolean> {
  if (!sheetId || !token) return false;
  if (ensuredSheets.has(sheetId)) return true;

  const exists = await spreadsheetHasSheet(sheetId, DELIVERY_SHEET, token);
  if (exists === null) return false;

  if (!exists) {
    const createResponse = await fetch(
      `${SHEETS_BASE}/${sheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: DELIVERY_SHEET } } }],
        }),
      }
    );
    if (!createResponse.ok) {
      const text = await createResponse.text().catch(() => '');
      console.warn(
        '[Deliveries] Could not create sheet:',
        createResponse.status,
        text
      );
      return false;
    }

    const headers = getSheetDefinition(DELIVERY_SHEET)?.headers || [];
    if (headers.length > 0) {
      try {
        await appendSheetRowRaw(
          sheetId,
          DELIVERY_SHEET,
          headers,
          token
        );
      } catch (error) {
        console.warn('[Deliveries] Could not write headers:', error);
      }
    }
  }

  ensuredSheets.add(sheetId);
  return true;
}

function rowForEntry(entry: DeliveryLogEntry): string[] {
  const headers = getSheetDefinition(DELIVERY_SHEET)?.headers || [];
  const values: Record<string, string> = {
    DeliveryID: entry.deliveryId,
    Date: entry.date,
    Time: entry.time,
    RouteID: entry.routeId,
    RouteName: entry.routeName,
    StopID: entry.stopId,
    Name: entry.name,
    Phone: entry.phone,
    Address: entry.address,
    OrderCount: `${entry.orderCount || 0}`,
    Status: entry.status || 'Delivered',
    PhotoCount: `${entry.photoCount || 0}`,
    PhotoFolder: entry.photoFolder,
    GPS: entry.gps,
    WorkerName: entry.workerName,
    WorkerID: entry.workerId,
    Notes: entry.notes,
    CreatedAt: entry.createdAt,
  };
  return headers.map((header) => values[header] ?? '');
}

/**
 * Writes one delivery to the Deliveries tab. Never throws: a failed write is
 * queued by the sheet layer and replayed later.
 */
export async function logDelivery(
  sheetId: string,
  entry: DeliveryLogEntry
): Promise<void> {
  if (!sheetId) return;
  try {
    const token = await getGoogleAccessToken(false);
    if (token) await ensureDeliveriesSheet(sheetId, token);
    const values = rowForEntry(entry);
    try {
      await appendSheetRow(sheetId, DELIVERY_SHEET, values, token);
    } catch (appendError: any) {
      const status = appendError?.status || appendError?.response?.status;
      if (status === 400 || status === 404) {
        // The tab was missing this time; keep the row queued so the next
        // online pass can create the tab and replay it.
        await enqueueMutation({
          kind: 'append',
          sheetId,
          sheetName: DELIVERY_SHEET,
          values,
          label: 'Add delivery log row',
        });
      } else {
        throw appendError;
      }
    }
  } catch (error) {
    console.warn('[Deliveries] Could not log delivery:', error);
  }
}
