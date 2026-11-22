import {
  appendSheetRow,
  columnLetter,
  getSheetHeaders,
  updateSheetRange,
  type SheetRow,
} from './sheets';

export const ALERT_EXTRA_HEADERS = ['ExpiresAt', 'Notes'];

async function ensureNotificationColumns(
  sheetId: string,
  token: string | null
) {
  const headers = await getSheetHeaders(sheetId, 'Notifications');
  const missing = ALERT_EXTRA_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length === 0) return;
  await updateSheetRange(
    sheetId,
    `Notifications!${columnLetter(headers.length + 1)}1`,
    [missing],
    token
  );
}

export interface AlertInput {
  sheetId: string;
  token: string | null;
  target: string;
  title: string;
  body: string;
  /** Hours the alert remains visible. Use 0 for no expiry. */
  durationHours: number;
  notes?: string;
  fromUid: string;
  /** Notification category shown as the alert icon. Defaults to announcement. */
  type?: string;
}

export async function sendAlert(input: AlertInput): Promise<void> {
  await ensureNotificationColumns(input.sheetId, input.token);

  const now = new Date();
  const expiresAt =
    input.durationHours > 0
      ? new Date(now.getTime() + input.durationHours * 3600000).toISOString()
      : '';

  await appendSheetRow(
    input.sheetId,
    'Notifications',
    [
      `ALERT_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${
        input.target
      }`,
      input.type || 'announcement',
      input.target,
      input.fromUid,
      input.title.trim(),
      input.body.trim(),
      now.toISOString(),
      'false',
      'active',
      expiresAt,
      input.notes?.trim() || '',
    ],
    input.token
  );
}

/** Alerts with an expiry in the past are hidden from the Alerts tab. */
export function isAlertActive(row: SheetRow): boolean {
  if (!row.ExpiresAt) return true;
  const expiry = new Date(row.ExpiresAt).getTime();
  return Number.isNaN(expiry) || expiry > Date.now();
}
