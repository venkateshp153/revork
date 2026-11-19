import {
  SHEETS_BASE,
  fetchSheetRows,
  updateSheetRange,
} from './sheets';

export interface CompanySettings {
  officeStart: string;
  officeEnd: string;
  dailyWorkHours: number;
  /** Require at least one proof photo before a stop can be marked delivered. */
  requireProofPhoto: boolean;
  /** Maximum proof photos stored per stop. */
  maxProofPhotos: number;
  /** Warn when marking delivered farther than this from the stop. 0 = off. */
  geofenceMeters: number;
  /** Delete local copies of uploaded proofs after this many days. 0 = never. */
  proofRetentionDays: number;
  /** Resize/compress proof photos before saving and uploading. */
  compressProofPhotos: boolean;
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  officeStart: '09:00',
  officeEnd: '17:00',
  dailyWorkHours: 8,
  requireProofPhoto: true,
  maxProofPhotos: 2,
  geofenceMeters: 200,
  proofRetentionDays: 7,
  compressProofPhotos: true,
};

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Creates the Settings sheet when an older workspace doesn't have it yet. */
async function ensureSettingsSheet(sheetId: string, token: string) {
  try {
    const metaResponse = await fetch(
      `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (metaResponse.ok) {
      const meta = await metaResponse.json();
      const exists = (meta.sheets || []).some(
        (sheet: any) => sheet.properties?.title === 'Settings'
      );
      if (exists) return;
    }

    await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: 'Settings' } } }],
      }),
    });
  } catch {
    // Offline: the range write below will be queued and replayed by sync.
  }
}

export async function readCompanySettings(
  sheetId: string
): Promise<CompanySettings> {
  if (!sheetId) return DEFAULT_COMPANY_SETTINGS;
  try {
    const rows = await fetchSheetRows(sheetId, 'Settings');
    const values: Record<string, string> = {};
    rows.forEach((row) => {
      if (row.Key) values[row.Key] = row.Value;
    });
    return {
      officeStart: values.officeStart || DEFAULT_COMPANY_SETTINGS.officeStart,
      officeEnd: values.officeEnd || DEFAULT_COMPANY_SETTINGS.officeEnd,
      dailyWorkHours:
        parseNumber(values.dailyWorkHours, DEFAULT_COMPANY_SETTINGS.dailyWorkHours),
      requireProofPhoto: parseBool(
        values.requireProofPhoto,
        DEFAULT_COMPANY_SETTINGS.requireProofPhoto
      ),
      maxProofPhotos: Math.min(
        4,
        Math.max(
          1,
          Math.round(
            parseNumber(
              values.maxProofPhotos,
              DEFAULT_COMPANY_SETTINGS.maxProofPhotos
            )
          )
        )
      ),
      geofenceMeters: Math.max(
        0,
        parseNumber(
          values.geofenceMeters,
          DEFAULT_COMPANY_SETTINGS.geofenceMeters
        )
      ),
      proofRetentionDays: Math.max(
        0,
        parseNumber(
          values.proofRetentionDays,
          DEFAULT_COMPANY_SETTINGS.proofRetentionDays
        )
      ),
      compressProofPhotos: parseBool(
        values.compressProofPhotos,
        DEFAULT_COMPANY_SETTINGS.compressProofPhotos
      ),
    };
  } catch {
    return DEFAULT_COMPANY_SETTINGS;
  }
}

export async function saveCompanySettings(
  sheetId: string,
  token: string,
  settings: CompanySettings
): Promise<void> {
  await ensureSettingsSheet(sheetId, token);
  const rows: string[][] = [
    ['Key', 'Value'],
    ['officeStart', settings.officeStart],
    ['officeEnd', settings.officeEnd],
    ['dailyWorkHours', `${settings.dailyWorkHours}`],
    ['requireProofPhoto', settings.requireProofPhoto ? 'true' : 'false'],
    ['maxProofPhotos', `${settings.maxProofPhotos}`],
    ['geofenceMeters', `${settings.geofenceMeters}`],
    ['proofRetentionDays', `${settings.proofRetentionDays}`],
    ['compressProofPhotos', settings.compressProofPhotos ? 'true' : 'false'],
  ];
  await updateSheetRange(sheetId, `Settings!A1:B${rows.length}`, rows, token);
}
