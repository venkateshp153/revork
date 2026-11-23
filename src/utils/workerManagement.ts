import {
  appendSheetRow,
  columnLetter,
  DRIVE_BASE,
  fetchSheetRows,
  fetchSheetValues,
  getSheetHeaders,
  updateSheetRange,
  type SheetRow,
} from './sheets';

/** Columns added by newer versions of the app (safe to append to old sheets). */
export const WORKER_EXTRA_HEADERS = [
  'Bio',
  'PhotoURL',
  'EditAccess',
  'ReadAccess',
  'Birthday',
  // Employee delivery spot: pending delivery addresses are assigned to the
  // employee whose spot is closest to them.
  'SpotAddress',
  'SpotLat',
  'SpotLng',
];

export interface WorkerIdentity {
  workerId?: string;
  email?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(
      `Request failed (${response.status})${text ? `: ${text}` : ''}`
    );
    (error as any).status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

/** Adds Bio / PhotoURL / EditAccess / Birthday headers to older sheets. */
export async function ensureWorkerColumns(
  sheetId: string,
  token: string | null
): Promise<string[]> {
  const headers = await getSheetHeaders(sheetId, 'Workers');
  const missing = WORKER_EXTRA_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length === 0) return headers;

  const firstMissingColumn = headers.length + 1;
  await updateSheetRange(
    sheetId,
    `Workers!${columnLetter(firstMissingColumn)}1`,
    [missing],
    token
  );
  return [...headers, ...missing];
}

async function findWorkerCell(
  sheetId: string,
  worker: WorkerIdentity
): Promise<{ headers: string[]; rowNumber: number }> {
  const values = await fetchSheetValues(sheetId, 'Workers');
  const headers = (values[0] || []).map((h) => String(h).trim());

  const idIndex = headers.indexOf('WorkerID');
  const emailIndex = headers.indexOf('Email');

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const idMatch =
      !!worker.workerId &&
      idIndex >= 0 &&
      String(row[idIndex] || '').trim() === worker.workerId;
    const emailMatch =
      !!worker.email &&
      emailIndex >= 0 &&
      String(row[emailIndex] || '').trim().toLowerCase() ===
        worker.email.trim().toLowerCase();
    if (idMatch || emailMatch) {
      return { headers, rowNumber: i + 1 };
    }
  }

  throw new Error('Worker not found in the sheet.');
}

export async function updateWorkerFields(
  sheetId: string,
  token: string | null,
  worker: WorkerIdentity,
  fields: Record<string, string>
): Promise<void> {
  await ensureWorkerColumns(sheetId, token);
  const { headers, rowNumber } = await findWorkerCell(sheetId, worker);

  for (const [field, value] of Object.entries(fields)) {
    const column = headers.indexOf(field) + 1;
    if (column <= 0) continue;
    await updateSheetRange(
      sheetId,
      `Workers!${columnLetter(column)}${rowNumber}`,
      [[value]],
      token
    );
  }
}

/**
 * Toggles the in-app edit permission for a worker.
 *
 * The worker keeps Drive **writer/editor** access permanently so clock-in and
 * clock-out can always be written to the sheet. This function only controls the
 * app-level `EditAccess` flag, which decides whether the worker/manager can
 * edit team data inside the app.
 */
export async function setWorkerEditAccess(
  sheetId: string,
  token: string,
  worker: WorkerIdentity & { email?: string },
  enabled: boolean
): Promise<{ driveUpdated: boolean; driveError?: string }> {
  await updateWorkerFields(sheetId, token, worker, {
    EditAccess: enabled ? 'true' : 'false',
  });

  if (!worker.email) return { driveUpdated: false, driveError: 'No email' };

  // Always ensure editor access; never downgrade to viewer.
  const access = await ensureWorkerEditAccess(sheetId, token, worker.email);
  return { driveUpdated: access.shared, driveError: access.error };
}

/** Toggles the in-app read-all permission for a worker. */
export async function setWorkerReadAccess(
  sheetId: string,
  token: string,
  worker: WorkerIdentity & { email?: string },
  enabled: boolean
): Promise<void> {
  await updateWorkerFields(sheetId, token, worker, {
    ReadAccess: enabled ? 'true' : 'false',
  });
}

/**
 * Grants the worker's own Google account access to the spreadsheet.
 *
 * Workers are shared as **writers/editors** so they can always save clock-in
 * data. In-app editing is still controlled separately by the Workers
 * `EditAccess` flag (admin toggles it from the Workers screen).
 */
async function setWorkerDriveRole(
  sheetId: string,
  token: string,
  email: string,
  role: 'reader' | 'writer'
): Promise<{ shared: boolean; error?: string }> {
  const normalized = (email || '').trim().toLowerCase();
  if (!sheetId || !token || !normalized) {
    return { shared: false, error: 'Missing sheet or worker email' };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    const list = await requestJson<{
      permissions?: {
        id: string;
        emailAddress?: string;
        type?: string;
        role?: string;
      }[];
    }>(
      `${DRIVE_BASE}/${sheetId}/permissions?fields=permissions(id,emailAddress,type,role)`,
      { headers }
    );

    const existing = (list.permissions || []).find(
      (permission) =>
        permission.type === 'user' &&
        permission.emailAddress?.trim().toLowerCase() === normalized
    );

    if (existing) {
      const current = (existing.role || '').toLowerCase();
      if (current === role || current === 'owner') {
        await shareCompanyFolderWithWorker(sheetId, token, normalized, role);
        return { shared: true };
      }
      // A writer already has everything a reader needs.
      if (role === 'reader' && current === 'writer') {
        await shareCompanyFolderWithWorker(sheetId, token, normalized, role);
        return { shared: true };
      }

      const updateResponse = await fetch(
        `${DRIVE_BASE}/${sheetId}/permissions/${existing.id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ role }),
        }
      );
      if (!updateResponse.ok) {
        const text = await updateResponse.text().catch(() => '');
        return {
          shared: false,
          error: `Drive returned ${updateResponse.status}${
            text ? `: ${text}` : ''
          }`,
        };
      }
      await shareCompanyFolderWithWorker(sheetId, token, normalized, role);
      return { shared: true };
    }

    const response = await fetch(`${DRIVE_BASE}/${sheetId}/permissions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'user',
        role,
        emailAddress: normalized,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        shared: false,
        error: `Drive returned ${response.status}${text ? `: ${text}` : ''}`,
      };
    }

    await shareCompanyFolderWithWorker(sheetId, token, normalized, role);
    return { shared: true };
  } catch (error: any) {
    return {
      shared: false,
      error: error?.message || 'Drive permission update failed',
    };
  }
}

/**
 * Delivery proof photos are uploaded next to the spreadsheet, so the worker
 * also needs access to the company folder. Failure here must not break the
 * sheet sharing that clock-in depends on.
 */
async function shareCompanyFolderWithWorker(
  sheetId: string,
  token: string,
  email: string,
  role: 'reader' | 'writer'
): Promise<void> {
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const info = await fetch(
      `${DRIVE_BASE}/${sheetId}?fields=parents&supportsAllDrives=true`,
      { headers }
    );
    if (!info.ok) return;
    const data = await info.json().catch(() => null);
    const folderId = Array.isArray(data?.parents) ? data.parents[0] : '';
    if (!folderId) return;

    await fetch(
      `${DRIVE_BASE}/${folderId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'user',
          role,
          emailAddress: email,
        }),
      }
    );
  } catch {
    // Folder sharing is best-effort; proof uploads will queue and report a
    // permission error if it is missing.
  }
}

/**
 * Removes a worker's per-account Drive access to the spreadsheet and folder.
 *
 * Join links only carry ids, so the real access control is the worker's Google
 * account permission. Deleting that permission is what actually invalidates the
 * link for someone who already has it.
 */
export async function removeWorkerDriveAccess(
  sheetId: string,
  token: string,
  email: string
): Promise<{ removed: boolean; error?: string }> {
  const normalized = (email || '').trim().toLowerCase();
  if (!sheetId || !token || !normalized) {
    return { removed: false, error: 'Missing sheet or worker email' };
  }

  const headers = { Authorization: `Bearer ${token}` };

  const removeFrom = async (fileId: string): Promise<boolean> => {
    const list = await requestJson<{
      permissions?: { id: string; emailAddress?: string; type?: string }[];
    }>(
      `${DRIVE_BASE}/${fileId}/permissions?fields=permissions(id,emailAddress,type)&supportsAllDrives=true`,
      { headers }
    );

    const existing = (list.permissions || []).find(
      (permission) =>
        permission.type === 'user' &&
        permission.emailAddress?.trim().toLowerCase() === normalized
    );
    if (!existing) return true;

    const response = await fetch(
      `${DRIVE_BASE}/${fileId}/permissions/${encodeURIComponent(
        existing.id
      )}?supportsAllDrives=true`,
      { method: 'DELETE', headers }
    );
    return response.ok || response.status === 404;
  };

  try {
    const sheetRemoved = await removeFrom(sheetId);
    if (!sheetRemoved) {
      return { removed: false, error: 'Google refused to remove sheet access' };
    }

    // Best effort: the folder holds proof photos, so remove it too.
    try {
      const info = await fetch(
        `${DRIVE_BASE}/${sheetId}?fields=parents&supportsAllDrives=true`,
        { headers }
      );
      if (info.ok) {
        const data = await info.json().catch(() => null);
        const parentId = Array.isArray(data?.parents) ? data.parents[0] : '';
        if (parentId) await removeFrom(parentId);
      }
    } catch {
      // The sheet permission is the important one.
    }

    return { removed: true };
  } catch (error: any) {
    return {
      removed: false,
      error: error?.message || 'Drive permission removal failed',
    };
  }
}

/** Ensures the worker has viewer access (legacy helper). */
export async function ensureWorkerReadAccess(
  sheetId: string,
  token: string,
  email: string
): Promise<{ shared: boolean; error?: string }> {
  return setWorkerDriveRole(sheetId, token, email, 'reader');
}

/** Ensures the worker has editor access so clock-in/out writes succeed. */
export async function ensureWorkerEditAccess(
  sheetId: string,
  token: string,
  email: string
): Promise<{ shared: boolean; error?: string }> {
  return setWorkerDriveRole(sheetId, token, email, 'writer');
}

/** True when the worker row has been granted edit access by an admin. */
export function rowHasEditAccess(row?: SheetRow | null): boolean {
  if (!row) return false;
  return String(row.EditAccess || '').toLowerCase() === 'true';
}

/** True when the worker row has been granted full read access by an admin. */
export function rowHasReadAccess(row?: SheetRow | null): boolean {
  if (!row) return false;
  return String(row.ReadAccess || '').toLowerCase() === 'true';
}

/**
 * Resolves the effective role. Google admins keep their profile role, while
 * workers who signed in with a join link inherit the designation saved on
 * their Workers row (so admins can promote someone to manager).
 */
export function effectiveDesignation(
  fallback?: string | null,
  row?: SheetRow | null
): 'admin' | 'manager' | 'employee' {
  const profileRole = (fallback || '').toLowerCase();
  const rowRole = (row?.Designation || '').toLowerCase();

  if (profileRole === 'admin' || rowRole === 'admin') return 'admin';
  if (rowRole === 'manager' || profileRole === 'manager') return 'manager';
  return 'employee';
}

/**
 * Ensures the company owner has a row in the Workers sheet right after
 * onboarding, so every tab (directory, stats, clock activity) has data.
 */
export async function ensureAdminWorkerRow(
  sheetId: string,
  token: string,
  admin: {
    uid: string;
    name: string;
    email: string;
    phone?: string;
    photoURL?: string;
  }
): Promise<void> {
  try {
    await ensureWorkerColumns(sheetId, token);
    const rows = await fetchSheetRows(sheetId, 'Workers');
    const existing = rows.some(
      (row) =>
        (!!admin.email &&
          row.Email?.trim().toLowerCase() === admin.email.trim().toLowerCase()) ||
        (!!admin.uid &&
          row.WorkerID === `ADMIN-${admin.uid.slice(0, 6).toUpperCase()}`)
    );
    if (existing) return;

    const now = new Date();
    const joinDate = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(
      2,
      '0'
    )}-${`${now.getDate()}`.padStart(2, '0')}`;
    const workerId = `ADMIN-${(admin.uid || 'OWNER').slice(0, 6).toUpperCase()}`;

    const headers = await getSheetHeaders(sheetId, 'Workers');
    const record: Record<string, string> = {
      WorkerID: workerId,
      Name: admin.name,
      Email: admin.email,
      Phone: admin.phone || '',
      PayPerHour: '0',
      Designation: 'admin',
      JoinDate: joinDate,
      Status: 'active',
      Bio: '',
      PhotoURL: admin.photoURL || '',
      EditAccess: 'true',
      ReadAccess: 'true',
      Birthday: '',
    };
    const row = (headers.length ? headers : FALLBACK_WORKER_HEADERS).map(
      (header) => record[header] ?? ''
    );

    await appendSheetRow(sheetId, 'Workers', row, token);
  } catch (error) {
    console.warn('[Workspace] Could not seed the admin Workers row:', error);
  }
}

export interface NewWorkerInput {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  designation: string;
}

/** Column order used when a sheet has no header row yet. */
const FALLBACK_WORKER_HEADERS = [
  'WorkerID',
  'Name',
  'Email',
  'Phone',
  'PayPerHour',
  'Designation',
  'JoinDate',
  'Status',
  'Bio',
  'PhotoURL',
  'EditAccess',
  'ReadAccess',
  'Birthday',
  'SpotAddress',
  'SpotLat',
  'SpotLng',
];

function uniqueWorkerId(
  firstName: string,
  phoneDigits: string,
  existingIds: string[]
): string {
  const taken = new Set(existingIds.map((id) => id.trim().toLowerCase()));
  const initials = firstName
    .trim()
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 2)
    .toUpperCase();
  const prefix = `W${initials}`;
  const suffix = phoneDigits.slice(-4) || '0000';
  const base = `${prefix}${suffix}`;

  let candidate = base;
  let counter = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}${counter}`;
    counter += 1;
  }
  return candidate;
}

/**
 * Appends a new employee to the Workers sheet, mapping the values to the
 * sheet's actual header order so older sheets keep working.
 */
export async function addWorkerToSheet(
  sheetId: string,
  token: string | null,
  input: NewWorkerInput
): Promise<string> {
  const values = await fetchSheetValues(sheetId, 'Workers');
  const headerRow = (values[0] || []).map((header) => String(header).trim());
  const headers = headerRow.length ? headerRow : FALLBACK_WORKER_HEADERS;

  const idIndex = headers.indexOf('WorkerID');
  const existingIds =
    idIndex >= 0
      ? values
          .slice(1)
          .map((row) => String(row[idIndex] || '').trim())
          .filter(Boolean)
      : [];

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phoneDigits = input.phone.replace(/\D/g, '');
  const workerId = uniqueWorkerId(firstName, phoneDigits, existingIds);

  const now = new Date();
  const joinDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(now.getDate()).padStart(2, '0')}`;

  const record: Record<string, string> = {
    WorkerID: workerId,
    Name: `${firstName} ${lastName}`.trim(),
    Email: input.email.trim().toLowerCase(),
    Phone: phoneDigits,
    PayPerHour: '0',
    Designation: input.designation,
    JoinDate: joinDate,
    Status: 'active',
    Bio: '',
    PhotoURL: '',
    EditAccess: 'false',
    ReadAccess: 'false',
    Birthday: '',
  };

  const row = headers.map((header) => record[header] ?? '');
  await appendSheetRow(sheetId, 'Workers', row, token);
  return workerId;
}

/** Matches a worker row to the signed-in user by worker id or email. */
export function findMyWorkerRow(
  rows: SheetRow[],
  workerId?: string | null,
  email?: string | null
): SheetRow | undefined {
  return rows.find(
    (row) =>
      (!!workerId && row.WorkerID === workerId) ||
      (!!email && row.Email?.trim().toLowerCase() === email.trim().toLowerCase())
  );
}

/**
 * Returns { month, day } for a birthday cell. Supports `MM-DD`, `DD/MM`,
 * `MM/DD` (when unambiguous) and full ISO dates.
 */
export function parseBirthday(
  value?: string | null
): { month: number; day: number } | null {
  if (!value) return null;
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return { month: parseInt(iso[2], 10), day: parseInt(iso[3], 10) };
  }
  const short = trimmed.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (!short) return null;
  const first = parseInt(short[1], 10);
  const second = parseInt(short[2], 10);
  if (first > 12) return { month: second, day: first };
  return { month: first, day: second };
}
