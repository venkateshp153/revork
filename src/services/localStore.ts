import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WORKSPACE_SHEETS,
  getSheetDefinition,
} from '@/src/constants/workspace';

const CACHE_PREFIX = '@revork/cache';
const QUEUE_KEY = '@revork/sync/queue';
const META_KEY = '@revork/sync/meta';

export interface CachedSheet {
  values: string[][];
  updatedAt: number;
}

export type PendingMutation =
  | {
      id: string;
      kind: 'append';
      sheetId: string;
      sheetName: string;
      values: string[];
      createdAt: number;
      label: string;
    }
  | {
      id: string;
      kind: 'update';
      sheetId: string;
      sheetName: string;
      range: string;
      values: string[][];
      createdAt: number;
      label: string;
    };

export interface SyncMeta {
  lastDownloadAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
}

const cacheKey = (sheetId: string, sheetName: string) =>
  `${CACHE_PREFIX}/${sheetId}/${encodeURIComponent(sheetName)}`;

function columnIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

/** Builds an empty grid with the schema headers for a sheet. */
function seedGrid(sheetName: string): string[][] {
  const definition = getSheetDefinition(sheetName);
  if (!definition) return [];
  return [definition.headers, ...(definition.seedRows || [])];
}

export async function readCachedSheet(
  sheetId: string,
  sheetName: string
): Promise<CachedSheet | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(sheetId, sheetName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.values)) return null;
    return parsed as CachedSheet;
  } catch {
    return null;
  }
}

export async function writeCachedSheet(
  sheetId: string,
  sheetName: string,
  values: string[][]
): Promise<void> {
  try {
    const payload: CachedSheet = { values, updatedAt: Date.now() };
    await AsyncStorage.setItem(
      cacheKey(sheetId, sheetName),
      JSON.stringify(payload)
    );
  } catch {
    // cache is best-effort
  }
}

async function loadOrSeedGrid(
  sheetId: string,
  sheetName: string
): Promise<string[][]> {
  const cached = await readCachedSheet(sheetId, sheetName);
  return cached?.values || seedGrid(sheetName);
}

export async function cachedAppend(
  sheetId: string,
  sheetName: string,
  values: string[]
): Promise<void> {
  const grid = await loadOrSeedGrid(sheetId, sheetName);
  grid.push(values);
  await writeCachedSheet(sheetId, sheetName, grid);
}

export async function cachedUpdate(
  sheetId: string,
  range: string,
  values: string[][]
): Promise<void> {
  const sheetName = range.split('!')[0];
  if (!sheetName) return;
  const grid = await loadOrSeedGrid(sheetId, sheetName);
  applyUpdateToGrid(grid, range, values);
  await writeCachedSheet(sheetId, sheetName, grid);
}

function applyUpdateToGrid(
  grid: string[][],
  range: string,
  values: string[][]
): void {
  const match = range.match(/^[^!]+!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!match) return;

  const startColumn = columnIndex(match[1]);
  const startRow = parseInt(match[2], 10) - 1;
  const endColumn = match[3] ? columnIndex(match[3]) : startColumn;
  const endRow = match[4] ? parseInt(match[4], 10) - 1 : startRow;

  for (let r = startRow; r <= endRow; r += 1) {
    if (!grid[r]) grid[r] = [];
    const rowValues = values[r - startRow] || [];
    for (let c = startColumn; c <= endColumn; c += 1) {
      grid[r][c] = rowValues[c - startColumn] ?? '';
    }
  }
}

/**
 * Re-applies pending local changes on top of a network snapshot so unsynced
 * rows never disappear from the UI when connectivity briefly returns.
 */
export function applyMutationsToGrid(
  grid: string[][],
  mutations: PendingMutation[]
): string[][] {
  const result = grid.map((row) => [...row]);
  mutations
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((mutation) => {
      if (mutation.kind === 'append') {
        result.push([...mutation.values]);
      } else {
        applyUpdateToGrid(result, mutation.range, mutation.values);
      }
    });
  return result;
}

export function isNetworkError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.response?.status;
  if (typeof status === 'number') {
    return status === 0 || status >= 500 || status === 408 || status === 429;
  }
  const message = `${error.message || ''}`.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('timeout') ||
    message.includes('offline')
  );
}

export async function getPendingMutations(): Promise<PendingMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingMutation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getPendingCount(): Promise<number> {
  return (await getPendingMutations()).length;
}

export async function enqueueMutation(
  mutation:
    | Omit<Extract<PendingMutation, { kind: 'append' }>, 'id' | 'createdAt'>
    | Omit<Extract<PendingMutation, { kind: 'update' }>, 'id' | 'createdAt'>
): Promise<PendingMutation> {
  const queue = await getPendingMutations();
  const entry = {
    ...mutation,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  } as PendingMutation;
  queue.push(entry);
  await writeQueue(queue);
  return entry;
}

export async function removeMutation(id: string): Promise<void> {
  const queue = await getPendingMutations();
  await writeQueue(queue.filter((item) => item.id !== id));
}

export async function getSyncMeta(): Promise<SyncMeta> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      lastDownloadAt: parsed.lastDownloadAt ?? null,
      lastSyncAt: parsed.lastSyncAt ?? null,
      lastError: parsed.lastError ?? null,
    };
  } catch {
    return { lastDownloadAt: null, lastSyncAt: null, lastError: null };
  }
}

export async function setSyncMeta(patch: Partial<SyncMeta>): Promise<void> {
  const current = await getSyncMeta();
  await AsyncStorage.setItem(META_KEY, JSON.stringify({ ...current, ...patch }));
}

/** Total number of sheets in the workspace schema (used by download UI). */
export const WORKSPACE_SHEET_COUNT = WORKSPACE_SHEETS.length;
