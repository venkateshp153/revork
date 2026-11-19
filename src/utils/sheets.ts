import {
  getGoogleAccessToken,
} from '@/src/services/googleAuth';
import {
  applyMutationsToGrid,
  cachedAppend,
  cachedUpdate,
  enqueueMutation,
  getPendingMutations,
  isNetworkError,
  readCachedSheet,
  writeCachedSheet,
} from '@/src/services/localStore';

// Re-exported so existing imports (`@/src/utils/sheets`) keep working.
export { getGoogleAccessToken } from '@/src/services/googleAuth';

export const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
export const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';
export const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';

export type SheetRow = { [key: string]: string; _row: string };

export type WriteResult = 'synced' | 'queued';

/** Converts a 1-based column number into a spreadsheet column letter. */
export function columnLetter(column: number): string {
  let letter = '';
  let n = column;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** Builds a rich error from a Google API error response. */
async function toApiError(response: Response, label: string): Promise<Error> {
  let detail = '';
  let reason = '';

  try {
    const body = await response.json();
    detail = body?.error?.message || '';
    reason =
      body?.error?.details?.find((entry: any) => entry?.reason)?.reason ||
      body?.error?.errors?.[0]?.reason ||
      '';
  } catch {
    // response body was empty or not JSON
  }

  const error = new Error(
    `${label} (${response.status})${detail ? `: ${detail}` : ''}`
  );
  (error as any).status = response.status;
  (error as any).reason = reason;
  (error as any).detail = detail;
  return error;
}

/** Network-only read of the raw cell grid (header row included). */
export async function fetchSheetValuesRaw(
  sheetId: string,
  sheetName: string,
  token?: string
): Promise<string[][]> {
  // Never send the API key together with an OAuth token: any restriction on
  // the key (e.g. "API_KEY_SERVICE_BLOCKED") is then applied to the request
  // and can reject a perfectly valid signed-in Google account.
  const keyPart = !token && API_KEY ? `?key=${API_KEY}` : '';
  const response = await fetch(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(sheetName)}${keyPart}`,
    token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined
  );
  if (!response.ok) {
    throw await toApiError(response, `Failed to load ${sheetName}`);
  }
  const data = await response.json();
  return data.values || [];
}

/**
 * Makes sure the spreadsheet is readable with the public API key by adding
 * an "anyone with the link → viewer" permission. Safe to call repeatedly.
 */
export async function ensurePublicReadAccess(
  sheetId: string,
  token: string | null
): Promise<boolean> {
  if (!sheetId || !token) return false;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    const listResponse = await fetch(
      `${DRIVE_BASE}/${sheetId}/permissions?fields=permissions(id,type,role)`,
      { headers }
    );
    if (listResponse.ok) {
      const list = await listResponse.json();
      const isPublic = (list.permissions || []).some(
        (permission: any) =>
          permission.type === 'anyone' &&
          (permission.role === 'reader' || permission.role === 'writer')
      );
      if (isPublic) return true;
    }

    const shareResponse = await fetch(`${DRIVE_BASE}/${sheetId}/permissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });
    if (shareResponse.ok) {
      console.log('[Sheets] Public read access enabled for', sheetId);
      return true;
    }
    const body = await shareResponse.text().catch(() => '');
    console.warn(
      '[Sheets] Could not enable public read access:',
      shareResponse.status,
      body
    );
    return false;
  } catch (error) {
    console.warn('[Sheets] Public access check failed:', error);
    return false;
  }
}

/**
 * Turns a 401/403 from Google into an actionable message for the admin. A
 * blocked API key is a Google Cloud configuration problem, not a sharing
 * problem, so the two cases must not be conflated.
 */
function describeSheetAccessError(sheetName: string, error: any): string {
  const reason = error?.reason || '';
  const detail = error?.detail ? ` — ${error.detail}` : '';

  if (
    reason === 'API_KEY_SERVICE_BLOCKED' ||
    reason === 'SERVICE_DISABLED' ||
    reason === 'ACCESS_DENIED'
  ) {
    return (
      `Google is blocking the app's API key for “${sheetName}” (${reason})${detail}. ` +
      'In Google Cloud Console → APIs & Services, enable the Google Sheets API ' +
      'and Google Drive API, then open Credentials → the API key used by ' +
      'EXPO_PUBLIC_API_KEY and either add both APIs to its allowed list or ' +
      'choose “Don’t restrict key”.'
    );
  }

  return (
    `${sheetName} is not readable. Ask the admin to share the workspace spreadsheet as “Anyone with the link · Viewer”, or sign in with the company Google account.`
  );
}

/**
 * Reads a sheet with offline support: successful network reads refresh the
 * local cache; when offline the last downloaded snapshot is returned.
 */
export async function fetchSheetValues(
  sheetId: string,
  sheetName: string
): Promise<string[][]> {
  try {
    let values: string[][];
    try {
      values = await fetchSheetValuesRaw(sheetId, sheetName);
    } catch (readError: any) {
      if (readError?.status !== 401 && readError?.status !== 403) throw readError;

      // The public (API key) read was rejected. Signed-in admins/managers have
      // a Google session, so read with their OAuth token first — it bypasses
      // API-key restrictions and works on private spreadsheets.
      const token = await getGoogleAccessToken(false);
      if (!token) throw readError;

      try {
        values = await fetchSheetValuesRaw(sheetId, sheetName, token);
      } catch (tokenError: any) {
        // The account could not read it either. Try to repair the public
        // "anyone with the link" permission, then retry anonymously.
        await ensurePublicReadAccess(sheetId, token);
        try {
          values = await fetchSheetValuesRaw(sheetId, sheetName);
        } catch (retryError: any) {
          throw retryError || tokenError;
        }
      }
    }

    const pending = (await getPendingMutations()).filter(
      (mutation) =>
        mutation.sheetId === sheetId && mutation.sheetName === sheetName
    );
    const merged = applyMutationsToGrid(values, pending);
    await writeCachedSheet(sheetId, sheetName, merged);
    return merged;
  } catch (error: any) {
    const cached = await readCachedSheet(sheetId, sheetName);
    if (cached) return cached.values;
    if (error?.status === 401 || error?.status === 403) {
      throw new Error(describeSheetAccessError(sheetName, error));
    }
    throw error;
  }
}

/** Fetches every row of a sheet, keyed by its header row. `_row` is 1-based. */
export async function fetchSheetRows(
  sheetId: string,
  sheetName: string
): Promise<SheetRow[]> {
  if (!sheetId) return [];
  const values = await fetchSheetValues(sheetId, sheetName);
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h).trim());
  return values
    .slice(1)
    .map((row, index) => {
      const obj: SheetRow = { _row: String(index + 2) };
      headers.forEach((header, i) => {
        obj[header] = row[i] !== undefined ? String(row[i]) : '';
      });
      return obj;
    })
    .filter((row) =>
      Object.keys(row).some((key) => key !== '_row' && row[key] !== '')
    );
}

async function requestWrite(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw await toApiError(response, 'Sheets write failed');
  }
}

/** Network-only append (used by the sync queue). */
export async function appendSheetRowRaw(
  sheetId: string,
  sheetName: string,
  values: string[],
  token: string
): Promise<void> {
  await requestWrite(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(
      sheetName
    )}:append?valueInputOption=RAW`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [values] }),
    }
  );
}

/** Network-only range update (used by the sync queue). */
export async function updateSheetRangeRaw(
  sheetId: string,
  range: string,
  values: string[][],
  token: string
): Promise<void> {
  await requestWrite(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(
      range
    )}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );
}

/**
 * Local-first append: the cache is updated immediately so the UI reflects the
 * change even offline. Network failures are queued and retried by the sync
 * service; permission errors are surfaced to the caller.
 */
export async function appendSheetRow(
  sheetId: string,
  sheetName: string,
  values: string[],
  token: string | null
): Promise<WriteResult> {
  await cachedAppend(sheetId, sheetName, values);

  if (!token) {
    await enqueueMutation({
      kind: 'append',
      sheetId,
      sheetName,
      values,
      label: `Add row to ${sheetName}`,
    });
    return 'queued';
  }

  try {
    await appendSheetRowRaw(sheetId, sheetName, values, token);
    return 'synced';
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueueMutation({
        kind: 'append',
        sheetId,
        sheetName,
        values,
        label: `Add row to ${sheetName}`,
      });
      return 'queued';
    }
    throw error;
  }
}

/** Local-first range update with the same offline queue behaviour. */
export async function updateSheetRange(
  sheetId: string,
  range: string,
  values: string[][],
  token: string | null
): Promise<WriteResult> {
  await cachedUpdate(sheetId, range, values);

  if (!token) {
    await enqueueMutation({
      kind: 'update',
      sheetId,
      sheetName: range.split('!')[0] || 'Sheet',
      range,
      values,
      label: `Update ${range}`,
    });
    return 'queued';
  }

  try {
    await updateSheetRangeRaw(sheetId, range, values, token);
    return 'synced';
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueueMutation({
        kind: 'update',
        sheetId,
        sheetName: range.split('!')[0] || 'Sheet',
        range,
        values,
        label: `Update ${range}`,
      });
      return 'queued';
    }
    throw error;
  }
}

/** Returns the header row of a sheet, or an empty array. */
export async function getSheetHeaders(
  sheetId: string,
  sheetName: string
): Promise<string[]> {
  const values = await fetchSheetValues(sheetId, sheetName);
  return (values[0] || []).map((h) => String(h).trim());
}
