import * as Linking from 'expo-linking';

/**
 * Guards for values that can come from a shared spreadsheet or another user.
 *
 * A malicious editor could put `intent://…`, `javascript:`, `file://` or a
 * look-alike host in a Drive URL / phone / email cell. Passing that straight to
 * `Linking.openURL` can launch arbitrary intents on Android, so every external
 * link is validated before it is opened.
 */

const HTTPS_URL = /^https:\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?(\/[^\s\\]*)?$/i;

export interface SafeUrlOptions {
  /** Hosts that are allowed (a subdomain of the host is also accepted). */
  hosts?: string[];
}

/**
 * Returns a normalised https URL, or null when the value is not a plain https
 * URL on an allowed host. Rejects credentials (`https://evil.com@host`) because
 * the host capture only accepts letters, digits, dots and dashes.
 */
export function sanitizeHttpsUrl(
  raw?: string | null,
  options: SafeUrlOptions = {}
): string | null {
  const value = (raw || '').trim();
  if (!value) return null;

  const match = HTTPS_URL.exec(value);
  if (!match) return null;

  const host = match[1].toLowerCase();
  const port = match[2] || '';
  const path = match[3] || '/';

  if (options.hosts && options.hosts.length > 0) {
    const allowed = options.hosts.some(
      (candidate) =>
        host === candidate.toLowerCase() ||
        host.endsWith(`.${candidate.toLowerCase()}`)
    );
    if (!allowed) return null;
  }

  return `https://${host}${port ? `:${port}` : ''}${path}`;
}

/** Opens an https URL only when it passes {@link sanitizeHttpsUrl}. */
export async function openSafeHttpsUrl(
  raw: string | null | undefined,
  options: SafeUrlOptions = {}
): Promise<boolean> {
  const url = sanitizeHttpsUrl(raw, options);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Keeps only characters that are valid in a phone number. */
export function sanitizePhoneNumber(raw?: string | null): string | null {
  const value = (raw || '').trim();
  if (!value) return null;
  // Allow a single leading + and digits; reject anything that could be parsed
  // as another URI scheme or a dialer control code.
  const cleaned = value.replace(/[^\d+]/g, '');
  if (!/^\+?\d{3,20}$/.test(cleaned)) return null;
  return cleaned;
}

/** Opens the dialer for a validated phone number. */
export async function openPhoneNumber(raw?: string | null): Promise<boolean> {
  const phone = sanitizePhoneNumber(raw);
  if (!phone) return false;
  try {
    await Linking.openURL(`tel:${phone}`);
    return true;
  } catch {
    return false;
  }
}

/** Basic, conservative email validation for `mailto:` links. */
export function sanitizeEmailAddress(raw?: string | null): string | null {
  const value = (raw || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return null;
  return value;
}

/** Opens the mail composer for a validated email address. */
export async function openEmailAddress(raw?: string | null): Promise<boolean> {
  const email = sanitizeEmailAddress(raw);
  if (!email) return false;
  try {
    await Linking.openURL(`mailto:${email}`);
    return true;
  } catch {
    return false;
  }
}
