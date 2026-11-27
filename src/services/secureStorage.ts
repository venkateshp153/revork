import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * An AsyncStorage-compatible store backed by the OS keychain / keystore.
 *
 * Firebase's React Native persistence writes the signed-in session (including
 * the long-lived refresh token) as plain JSON into AsyncStorage. That file is
 * readable by anyone who can reach the app's private directory — a rooted
 * device, an `adb backup`, or a device-to-device restore. Routing the session
 * through expo-secure-store keeps it behind the platform keystore instead.
 *
 * Two platform details shape this wrapper:
 *
 * 1. SecureStore caps a single value at ~2048 bytes, while a Firebase auth
 *    record is routinely larger than that. Values are therefore split into
 *    chunks and re-joined on read, with the chunk count written last so a
 *    half-finished write reads back as "missing" rather than as truncated JSON.
 * 2. SecureStore keys may only contain [A-Za-z0-9._-], but Firebase's key is
 *    `firebase:authUser:<apiKey>:[DEFAULT]`. Keys are hex-encoded so any
 *    AsyncStorage key maps deterministically onto a legal SecureStore key.
 */

/** Stay under SecureStore's ~2048 byte per-value limit. */
const CHUNK_SIZE = 1800;

/** Prefix so our keys never collide with anything else in the keychain. */
const KEY_PREFIX = 'rv';

const encodeKey = (key: string): string => {
  let encoded = '';
  for (let i = 0; i < key.length; i += 1) {
    encoded += key.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return `${KEY_PREFIX}.${encoded}`;
};

const countKey = (base: string) => `${base}.n`;
const chunkKey = (base: string, index: number) => `${base}.${index}`;

/**
 * Resolved once per runtime: SecureStore needs a native build, and it is not
 * available on web at all. When it is unavailable every method falls back to
 * AsyncStorage so the app still works (the web build has no refresh token to
 * protect in the same way).
 */
let availability: Promise<boolean> | null = null;

const canUseSecureStore = (): Promise<boolean> => {
  if (Platform.OS === 'web') return Promise.resolve(false);
  if (!availability) {
    availability = Promise.resolve()
      .then(() => SecureStore.isAvailableAsync())
      .catch(() => false);
  }
  return availability;
};

const readChunkCount = async (base: string): Promise<number> => {
  try {
    const raw = await SecureStore.getItemAsync(countKey(base));
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const deleteChunks = async (base: string, count: number): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    try {
      await SecureStore.deleteItemAsync(chunkKey(base, index));
    } catch {
      // Best effort: a leftover chunk is harmless once the count is gone.
    }
  }
};

const secureGetItem = async (key: string): Promise<string | null> => {
  const base = encodeKey(key);
  const count = await readChunkCount(base);
  if (count === 0) return null;

  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const part = await SecureStore.getItemAsync(chunkKey(base, index));
    // A missing chunk means the write never finished or the keystore entry was
    // invalidated (e.g. Android backup restored without the Keystore key).
    // Report "not stored" so callers treat it as a signed-out session.
    if (part == null) return null;
    parts.push(part);
  }
  return parts.join('');
};

const secureSetItem = async (key: string, value: string): Promise<void> => {
  const base = encodeKey(key);
  const previousCount = await readChunkCount(base);

  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + CHUNK_SIZE));
  }

  for (let index = 0; index < chunks.length; index += 1) {
    await SecureStore.setItemAsync(chunkKey(base, index), chunks[index]);
  }

  // Drop chunks left over from a previously longer value.
  if (previousCount > chunks.length) {
    for (let index = chunks.length; index < previousCount; index += 1) {
      try {
        await SecureStore.deleteItemAsync(chunkKey(base, index));
      } catch {
        // ignore
      }
    }
  }

  // Written last: readers only trust the value once every chunk is present.
  await SecureStore.setItemAsync(countKey(base), String(chunks.length));
};

const secureRemoveItem = async (key: string): Promise<void> => {
  const base = encodeKey(key);
  const count = await readChunkCount(base);
  try {
    await SecureStore.deleteItemAsync(countKey(base));
  } catch {
    // ignore
  }
  await deleteChunks(base, count);
};

/**
 * Drop-in replacement for the subset of AsyncStorage that redux-persist and
 * Firebase's React Native persistence rely on.
 */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!(await canUseSecureStore())) return AsyncStorage.getItem(key);
    try {
      return await secureGetItem(key);
    } catch (error) {
      console.warn('[secureStorage] getItem failed, treating as empty:', error);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!(await canUseSecureStore())) return AsyncStorage.setItem(key, value);
    await secureSetItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (!(await canUseSecureStore())) return AsyncStorage.removeItem(key);
    try {
      await secureRemoveItem(key);
    } catch (error) {
      console.warn('[secureStorage] removeItem failed:', error);
    }
  },

  /** True when values are actually going to the keychain/keystore. */
  async isSecure(): Promise<boolean> {
    return canUseSecureStore();
  },
};

export default secureStorage;
