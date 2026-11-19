/**
 * Worker join links.
 *
 * A link is bound to ONE worker (workerId) and one company spreadsheet. The
 * login screen uses that id to find the exact Workers row, so an employee can
 * only open their own record - not "the first worker the sheet happens to
 * contain" (the old behaviour).
 *
 * Links are parsed by hand instead of relying on `URL`/`URLSearchParams`
 * because React Native runtimes vary in their support for those APIs.
 */

export const JOIN_LINK_SCHEME = 'revork';
export const JOIN_LINK_VERSION = 2;

export interface WorkerJoinLink {
  version: number;
  sheetId: string;
  workerId: string;
  email: string;
  phone: string;
  companyId: string;
}

function encodeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** Builds the shareable link for a single worker row.
 *
 * Only the identifiers are encoded. The employee's email/phone are NOT put in
 * the URL, so the "verify your details" step is a real check instead of the
 * recipient simply copying values that already came with the link.
 */
export function buildWorkerJoinLink(input: {
  sheetId: string;
  workerId?: string | null;
  companyId?: string | null;
}): string {
  return `${JOIN_LINK_SCHEME}://login?${encodeQuery({
    v: String(JOIN_LINK_VERSION),
    sheetId: (input.sheetId || '').trim(),
    workerId: (input.workerId || '').trim(),
    companyId: (input.companyId || '').trim(),
  })}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * Reads a parameter while tolerating:
 * - a bare query string or a full URL,
 * - line-wrapped links (all whitespace is removed first),
 * - HTML-escaped ampersands from chat apps,
 * - `sheetld` / `workerld` / `companyld` (lowercase L) transcriptions.
 */
function getParam(source: string, names: string[]): string {
  for (const name of names) {
    const pattern = new RegExp(`(?:^|[?&])${name}=([^&]*)`, 'i');
    const match = pattern.exec(source);
    if (match) return decode(match[1]);
  }
  return '';
}

/** Keeps only the identifier characters used by Drive/Sheets/Firebase ids. */
function cleanId(value: string): string {
  const match = (value || '').match(/[A-Za-z0-9_-]+/);
  return match ? match[0] : '';
}

/**
 * Common copy/typing variants of an opaque Google sheet id: `0`/`O` and
 * `1`/`l`/`I` are visually ambiguous. Tried only after the original id 404s.
 */
export function sheetIdVariants(sheetId: string): string[] {
  const original = (sheetId || '').trim();
  if (!original) return [];

  const replaceAll = (value: string, from: string, to: string) =>
    value.split(from).join(to);

  const variants = new Set<string>([original]);
  const steps: [string, string][] = [
    ['0', 'O'],
    ['O', '0'],
    ['1', 'l'],
    ['l', '1'],
    ['1', 'I'],
    ['I', '1'],
  ];

  // One pass + one combined pass keeps the list small (<= ~36 ids).
  const firstPass = [original];
  for (const [from, to] of steps) {
    firstPass.push(replaceAll(original, from, to));
  }
  for (const value of firstPass) {
    variants.add(value);
    for (const [from, to] of steps) {
      variants.add(replaceAll(value, from, to));
    }
  }

  return Array.from(variants).filter((value) => value.length === original.length);
}

/**
 * Parses a join link (or a bare query string) and validates its shape.
 * Returns null when the link cannot identify a worker.
 */
export function parseWorkerJoinLink(raw?: string | null): WorkerJoinLink | null {
  const text = (raw || '').trim();
  if (!text) return null;

  // Messaging apps wrap long links and insert spaces/newlines inside the URL.
  // A real link never contains whitespace (values are URL-encoded), so remove
  // it all along with HTML-escaped ampersands before reading parameters.
  const compact = text
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/\s+/g, '');

  const sheetId = cleanId(getParam(compact, ['sheetId', 'sheetld', 'sheet_id']));
  const workerId = cleanId(
    getParam(compact, ['workerId', 'workerld', 'worker_id'])
  );
  const email = getParam(compact, ['email', 'workerEmail']).trim().toLowerCase();
  const phone = getParam(compact, ['phone', 'workerPhone']).replace(/\D/g, '');
  const companyId = cleanId(
    getParam(compact, ['companyId', 'companyld', 'company_id'])
  );
  const version = parseInt(getParam(compact, ['v']), 10) || 1;

  if (!sheetId) return null;
  // v2 links always carry a worker id. Older links may only have email/phone.
  if (!workerId && !email && !phone) return null;

  return { version, sheetId, workerId, email, phone, companyId };
}
