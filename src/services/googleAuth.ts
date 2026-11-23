import { GoogleSignin } from '@react-native-google-signin/google-signin';

/**
 * Scopes required by the workspace features: Drive (folder/sheet creation and
 * sharing) and Sheets (reading and writing the workspace spreadsheet).
 */
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

let configured = false;

/**
 * Access tokens are valid for ~1 hour. Caching them avoids a native round-trip
 * on every sheet read and, more importantly, keeps the app on the authenticated
 * path instead of falling back to the public API key.
 */
let cachedAccessToken: { value: string; expiresAt: number } | null = null;
const TOKEN_CACHE_MS = 50 * 60 * 1000;

/** Drops the cached token (call on sign-out or when Google rejects a token). */
export function clearCachedAccessToken(): void {
  cachedAccessToken = null;
}

function rememberToken(token: string): string {
  cachedAccessToken = { value: token, expiresAt: Date.now() + TOKEN_CACHE_MS };
  return token;
}

/**
 * Configures the native Google Sign-In module once per JS runtime.
 *
 * This used to live only inside `firebaseService`, which meant a cold start
 * straight into the tabs (where that module is never imported) left Google
 * Sign-In unconfigured — `GoogleSignin.getTokens()` then failed and every
 * private sheet read fell back to the public API key.
 */
export function configureGoogleSignin(): void {
  if (configured) return;
  configured = true;

  try {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      offlineAccess: true,
      scopes: GOOGLE_SCOPES,
      forceCodeForRefreshToken: true,
    });
  } catch (error) {
    console.warn('[GoogleAuth] Google Sign-In configuration failed:', error);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `getTokens()` can return an empty accessToken for a moment right after
 * `signIn()` on some Android devices. Retry briefly instead of failing the
 * first join attempt.
 */
async function getAccessTokenWithRetry(
  attempts = 5,
  delayMs = 250
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { accessToken } = await GoogleSignin.getTokens();
      if (accessToken) return accessToken;
    } catch {
      // token not ready yet
    }
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return null;
}

/**
 * Returns a usable Google OAuth access token. When `interactive` is true the
 * user is prompted to pick a Google account if there is no active session —
 * this is what lets an employee sign in on demand to write attendance.
 */
export async function getGoogleAccessToken(
  interactive = false
): Promise<string | null> {
  configureGoogleSignin();

  if (!interactive && cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.value;
  }

  const silent = await getAccessTokenWithRetry(2, 150);
  if (silent) return rememberToken(silent);

  if (!interactive) {
    clearCachedAccessToken();
    return null;
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    await GoogleSignin.signIn();
    const token = await getAccessTokenWithRetry(6, 250);
    return token ? rememberToken(token) : null;
  } catch {
    return null;
  }
}

/** Email of the currently signed-in Google account, if any. */
export async function getGoogleAccountEmail(): Promise<string | null> {
  configureGoogleSignin();
  try {
    const current = await GoogleSignin.getCurrentUser();
    return current?.user?.email || null;
  } catch {
    return null;
  }
}

/**
 * Resolves the email from an access token via Google's userinfo endpoint.
 * More reliable than `getCurrentUser()` on some Android devices.
 */
export async function getGoogleEmailForToken(
  accessToken: string
): Promise<string | null> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.email || null;
  } catch {
    return null;
  }
}

/**
 * Resolves the signed-in Google email, retrying briefly because the native
 * module can return the account slightly after sign-in.
 */
export async function resolveGoogleEmail(
  accessToken?: string | null
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await getGoogleAccountEmail();
    if (current) return current;
    if (accessToken) {
      const fromToken = await getGoogleEmailForToken(accessToken);
      if (fromToken) return fromToken;
    }
    await sleep(250);
  }
  return null;
}

/** Clears the current Google session so the next sign-in shows the account picker. */
export async function clearGoogleSession(): Promise<void> {
  configureGoogleSignin();
  clearCachedAccessToken();
  try {
    await GoogleSignin.signOut();
    console.log('[GoogleAuth] Google session cleared');
  } catch {
    // no active session — ignore
  }
}

/**
 * Forces the Google account picker and returns the chosen account's token and
 * email. Used when a worker joins a shared workspace: the sheet is shared with
 * one specific email, so the worker must be able to switch accounts.
 */
export async function signInWithGoogleWorkspace(): Promise<{
  accessToken: string;
  email: string;
  scopes: string[];
} | null> {
  configureGoogleSignin();
  clearCachedAccessToken();
  try {
    try {
      await GoogleSignin.signOut();
    } catch {
      // no active session — ignore
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    const scopes = result.data?.scopes || [];
    const accessToken = await getAccessTokenWithRetry(6, 250);
    if (!accessToken) return null;
    const email =
      result.data?.user?.email ||
      (await resolveGoogleEmail(accessToken)) ||
      '';
    rememberToken(accessToken);
    console.log('[GoogleAuth] Workspace sign-in:', email, '| scopes:', scopes);
    return { accessToken, email, scopes };
  } catch (error) {
    console.warn('[GoogleAuth] Workspace sign-in failed:', error);
    return null;
  }
}
