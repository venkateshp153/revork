import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { getGoogleAccessToken } from '@/src/services/googleAuth';
import { stampProofPhoto } from './proofStamp';

/**
 * Local-first delivery proof photos.
 *
 * Every photo is copied into the app's document directory first and recorded
 * in AsyncStorage. That makes delivery proof work in places with no signal.
 * A background sync uploads queued photos to Google Drive when the device is
 * online:
 *
 *   <company folder>/delivered_locations_data/<YYYY-MM-DD>/<Name>_<Address>_<Phone>.jpg
 *
 * The company folder is resolved from the signed-in workspace, so workers who
 * joined with a link do not need their own Drive folder id.
 */

export type DeliveryPhotoStatus = 'pending' | 'uploading' | 'uploaded';

export interface DeliveryPhotoRecord {
  id: string;
  routeId: string;
  stopId: string;
  localUri: string;
  /** Name shown in Google Drive, e.g. "Ravi Kumar_12 MG Road_9876543210.jpg". */
  fileName: string;
  mimeType: string;
  /** Local delivery date, also used as the Drive folder name. */
  folderDate: string;
  personName: string;
  address: string;
  phone: string;
  createdAt: number;
  status: DeliveryPhotoStatus;
  /** GPS position captured when the proof was added, when available. */
  lat?: number;
  lng?: number;
  /**
   * Photos stay on the device until the delivery is saved, so the Drive file
   * name can use the final customer name/phone. Older queued records have no
   * flag and are treated as ready.
   */
  holdUpload?: boolean;
  error?: string;
  driveFileId?: string;
  driveUrl?: string;
}

export interface DeliverySyncContext {
  sheetId?: string | null;
  folderId?: string | null;
  companyName?: string | null;
}

export interface DeliverySyncResult {
  uploaded: number;
  pending: number;
  failed: number;
  error?: string;
}

export interface DriveProofFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  createdTime?: string;
  size?: number;
}

const PHOTOS_KEY = 'revork.delivery.photos.v1';
const CONTEXT_KEY = 'revork.delivery.context.v1';
const FOLDERS_KEY = 'revork.drive.delivery.folders.v1';
const DELIVERY_ROOT_FOLDER = 'delivered_locations_data';

const MAX_PHOTOS_PER_STOP = 2;

type Listener = () => void;
const listeners = new Set<Listener>();
let activeSync: Promise<DeliverySyncResult> | null = null;
let memoryContext: DeliverySyncContext = {};

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // a listener must never break the sync loop
    }
  });
}

export function subscribeDeliveryPhotos(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function maxProofPhotos(): number {
  return MAX_PHOTOS_PER_STOP;
}

// ------------------------------------------------------------------ storage

function photoRoot(): string {
  return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}delivery-proofs/`;
}

export async function loadDeliveryPhotos(): Promise<DeliveryPhotoRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(PHOTOS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: any) => item && typeof item.id === 'string')
      .map((item: any) => ({
        ...item,
        // An upload interrupted by an app close must be retried.
        status: item.status === 'uploaded' ? 'uploaded' : 'pending',
      }));
  } catch {
    return [];
  }
}

async function saveDeliveryPhotos(
  records: DeliveryPhotoRecord[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(PHOTOS_KEY, JSON.stringify(records));
  } catch {
    // best-effort persistence
  }
}

export async function getDeliveryPhotosForStop(
  stopId: string
): Promise<DeliveryPhotoRecord[]> {
  const records = await loadDeliveryPhotos();
  return records
    .filter((record) => record.stopId === stopId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function countDeliveryPhotosForStop(
  stopId: string
): Promise<number> {
  return (await getDeliveryPhotosForStop(stopId)).length;
}

// --------------------------------------------------------------- file names

function sanitizePart(value: string, max = 70): string {
  return (value || '')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/g, '');
}

/** "Ravi Kumar_12 MG Road_9876543210" */
export function buildProofBaseName(params: {
  personName?: string;
  address?: string;
  phone?: string;
}): string {
  const name = sanitizePart(params.personName || '', 48) || 'Customer';
  const address = sanitizePart(params.address || '', 70) || 'Delivery location';
  const phone = sanitizePart(params.phone || '', 20).replace(/\s+/g, '') || 'No phone';
  return `${name}_${address}_${phone}`;
}

function extensionFor(asset: ImagePickerAsset): string {
  const fromMime = (asset.mimeType || '').toLowerCase();
  if (fromMime.includes('png')) return 'png';
  if (fromMime.includes('webp')) return 'webp';
  if (fromMime.includes('heic')) return 'jpg';
  const fromName = (asset.fileName || '').split('.').pop()?.toLowerCase();
  if (fromName && /^(jpe?g|png|webp)$/.test(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  return 'jpg';
}

function mimeFor(extension: string): string {
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function uniqueName(base: string, extension: string, used: Set<string>): string {
  let candidate = `${base}.${extension}`;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${index}.${extension}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function localFolderDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ----------------------------------------------------------- add / remove

async function ensureDirectory(uri: string): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  } catch {
    // directory already exists
  }
}

async function prepareImageAsset(
  asset: ImagePickerAsset,
  compress: boolean
): Promise<{ uri: string; extension: string; mimeType: string }> {
  const originalExtension = extensionFor(asset);
  const original = {
    uri: asset.uri,
    extension: originalExtension,
    mimeType: mimeFor(originalExtension),
  };
  if (!compress) return original;

  try {
    if (!requireOptionalNativeModule('ExpoImageManipulator')) {
      return original;
    }
    // Loaded lazily so older dev builds can still open the app.
    const ImageManipulator = await import('expo-image-manipulator');
    const actions: any[] =
      asset.width && asset.width > 1280
        ? [{ resize: { width: 1280 } }]
        : [];
    const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: 0.72,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: result.uri, extension: 'jpg', mimeType: 'image/jpeg' };
  } catch (error) {
    console.warn('[DeliveryProof] Could not compress photo:', error);
    return original;
  }
}

/**
 * Copies picked photos into permanent app storage and queues them for Drive.
 * Safe to call offline.
 */
export async function addDeliveryPhotos(params: {
  assets: ImagePickerAsset[];
  routeId: string;
  stopId: string;
  personName?: string;
  address?: string;
  phone?: string;
  /** Resize/compress before storing. Defaults to true. */
  compress?: boolean;
  /** Maximum photos for this stop. Defaults to 2. */
  maxPhotos?: number;
  /** GPS captured with the delivery, stored for the proof record. */
  lat?: number;
  lng?: number;
}): Promise<DeliveryPhotoRecord[]> {
  const assets = params.assets.filter((asset) => !!asset?.uri);
  if (assets.length === 0) return [];

  const limit = Math.max(1, params.maxPhotos ?? MAX_PHOTOS_PER_STOP);
  const existing = await loadDeliveryPhotos();
  const already = existing.filter(
    (record) => record.stopId === params.stopId
  ).length;
  const room = limit - already;
  if (room <= 0) {
    throw new Error(
      `You can attach up to ${limit} proof photo${limit === 1 ? '' : 's'} per stop.`
    );
  }

  const accepted = assets.slice(0, room);
  const folderDate = localFolderDate();
  const directory = `${photoRoot()}${folderDate}/`;
  await ensureDirectory(directory);

  const used = new Set(
    existing
      .filter((record) => record.folderDate === folderDate)
      .map((record) => record.fileName.toLowerCase())
  );
  const base = buildProofBaseName(params);
  const created: DeliveryPhotoRecord[] = [];

  for (const asset of accepted) {
    const id = `proof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const gpsLine =
      typeof params.lat === 'number' && typeof params.lng === 'number'
        ? `GPS ${params.lat.toFixed(5)}, ${params.lng.toFixed(5)}`
        : '';
    const stampLines = [
      [params.personName, params.phone].filter(Boolean).join(' · ') ||
        'Customer',
      params.address || '',
      new Date().toLocaleString(),
      gpsLine,
      'Revork delivery proof',
    ].filter(Boolean);
    const stampedUri = await stampProofPhoto(asset.uri, stampLines);
    const prepared = await prepareImageAsset(
      stampedUri !== asset.uri
        ? {
            ...asset,
            uri: stampedUri,
            width: 0,
            height: 0,
            mimeType: 'image/jpeg',
            fileName: 'proof.jpg',
          }
        : asset,
      params.compress !== false
    );
    const extension = prepared.extension;
    const localUri = `${directory}${id}.${extension}`;
    let storedUri = localUri;
    try {
      await FileSystem.copyAsync({ from: prepared.uri, to: localUri });
    } catch (error) {
      // Keep the prepared URI so previews still work; the Drive upload will
      // report an error and stay queued if the temporary file disappears.
      storedUri = prepared.uri;
      console.warn('[DeliveryProof] Could not copy photo locally:', error);
    }

    const record: DeliveryPhotoRecord = {
      id,
      routeId: params.routeId,
      stopId: params.stopId,
      localUri: storedUri,
      fileName: uniqueName(base, extension, used),
      mimeType: prepared.mimeType,
      folderDate,
      personName: params.personName?.trim() || '',
      address: params.address?.trim() || '',
      phone: params.phone?.trim() || '',
      createdAt: Date.now() + created.length,
      status: 'pending',
      holdUpload: true,
      ...(typeof params.lat === 'number' && Number.isFinite(params.lat)
        ? { lat: params.lat }
        : {}),
      ...(typeof params.lng === 'number' && Number.isFinite(params.lng)
        ? { lng: params.lng }
        : {}),
    };
    created.push(record);
  }

  await saveDeliveryPhotos([...existing, ...created]);
  notify();
  return created;
}

export async function removeDeliveryPhoto(id: string): Promise<void> {
  const records = await loadDeliveryPhotos();
  const target = records.find((record) => record.id === id);
  if (!target) return;
  if (target.status === 'uploading') return;

  try {
    await FileSystem.deleteAsync(target.localUri, { idempotent: true });
  } catch {
    // file already gone
  }
  await saveDeliveryPhotos(records.filter((record) => record.id !== id));
  notify();
}

/** Allows the photos for a stop to upload after delivery is saved. */
export async function releaseDeliveryPhotosForStop(
  stopId: string
): Promise<void> {
  const records = await loadDeliveryPhotos();
  const targets = records.filter(
    (record) => record.stopId === stopId && record.holdUpload
  );
  if (targets.length === 0) return;
  await saveDeliveryPhotos(
    records.map((record) =>
      record.stopId === stopId ? { ...record, holdUpload: false } : record
    )
  );
  notify();
}

/** Clears local proof records when a stop or route is deleted. */
export async function removeDeliveryPhotosForStop(
  stopId: string
): Promise<void> {
  const records = await loadDeliveryPhotos();
  const removed = records.filter((record) => record.stopId === stopId);
  if (removed.length === 0) return;

  await Promise.all(
    removed.map(async (record) => {
      try {
        await FileSystem.deleteAsync(record.localUri, { idempotent: true });
      } catch {
        // file already gone
      }
    })
  );
  await saveDeliveryPhotos(records.filter((record) => record.stopId !== stopId));
  notify();
}

/**
 * Keeps queued (not yet uploaded) file names in sync when the driver edits the
 * customer name or phone inside the proof sheet.
 */
export async function updatePendingPhotoDetails(
  stopId: string,
  details: { personName?: string; phone?: string; address?: string }
): Promise<void> {
  const records = await loadDeliveryPhotos();
  const pending = records.filter(
    (record) => record.stopId === stopId && record.status === 'pending'
  );
  if (pending.length === 0) return;

  const base = buildProofBaseName({
    personName: details.personName || pending[0].personName,
    phone: details.phone || pending[0].phone,
    address: details.address || pending[0].address,
  });
  const used = new Set(
    records
      .filter(
        (record) =>
          record.folderDate === pending[0].folderDate &&
          !pending.some((item) => item.id === record.id)
      )
      .map((record) => record.fileName.toLowerCase())
  );

  let changed = false;
  const next = records.map((record) => {
    if (!pending.some((item) => item.id === record.id)) return record;
    const extension = record.fileName.split('.').pop() || 'jpg';
    const fileName = uniqueName(base, extension, used);
    const nextPerson = details.personName?.trim() || record.personName;
    const nextPhone = details.phone?.trim() || record.phone;
    const nextAddress = details.address?.trim() || record.address;
    if (
      fileName !== record.fileName ||
      nextPerson !== record.personName ||
      nextPhone !== record.phone ||
      nextAddress !== record.address
    ) {
      changed = true;
    }
    return {
      ...record,
      fileName,
      personName: nextPerson,
      phone: nextPhone,
      address: nextAddress,
    };
  });

  if (changed) {
    await saveDeliveryPhotos(next);
    notify();
  }
}

// -------------------------------------------------------------- drive sync

export async function setDeliverySyncContext(
  context: DeliverySyncContext
): Promise<void> {
  memoryContext = { ...memoryContext, ...context };
  try {
    await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(memoryContext));
  } catch {
    // context is re-supplied on the next app launch
  }
}

async function readSyncContext(): Promise<DeliverySyncContext> {
  if (memoryContext.sheetId || memoryContext.folderId) return memoryContext;
  try {
    const raw = await AsyncStorage.getItem(CONTEXT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryContext = { ...memoryContext, ...parsed };
    }
  } catch {
    // ignore
  }
  return memoryContext;
}

interface FolderCache {
  companyBySheet: Record<string, string>;
  companyByRoot: Record<string, string>;
  dataFolders: Record<string, string>;
  dateFolders: Record<string, Record<string, string>>;
}

async function loadFolderCache(): Promise<FolderCache> {
  try {
    const raw = await AsyncStorage.getItem(FOLDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        companyBySheet: parsed.companyBySheet || {},
        companyByRoot: parsed.companyByRoot || {},
        dataFolders: parsed.dataFolders || {},
        dateFolders: parsed.dateFolders || {},
      };
    }
  } catch {
    // ignore
  }
  return {
    companyBySheet: {},
    companyByRoot: {},
    dataFolders: {},
    dateFolders: {},
  };
}

async function saveFolderCache(cache: FolderCache): Promise<void> {
  try {
    await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(cache));
  } catch {
    // cache is best-effort
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const query =
    `'${parentId}' in parents` +
    ` and name = '${escapeQuery(name)}'` +
    " and mimeType = 'application/vnd.google-apps.folder'" +
    ' and trashed = false';
  const url =
    'https://www.googleapis.com/drive/v3/files' +
    `?q=${encodeURIComponent(query)}` +
    '&fields=files(id,name)&pageSize=1&spaces=drive&supportsAllDrives=true';
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`Drive folder lookup failed (${response.status}).`);
  }
  const data = await response.json().catch(() => null);
  return data?.files?.[0]?.id || '';
}

async function createFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Could not create the “${name}” folder (${response.status}).`);
  }
  const data = await response.json().catch(() => null);
  if (!data?.id) throw new Error(`Could not create the “${name}” folder.`);
  return data.id as string;
}

async function findOrCreateFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;
  return createFolder(token, name, parentId);
}

async function getFileParents(
  token: string,
  fileId: string
): Promise<string[]> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?fields=parents&supportsAllDrives=true`,
    { headers: authHeaders(token) }
  );
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  return Array.isArray(data?.parents) ? data.parents : [];
}

async function resolveCompanyFolder(
  token: string,
  context: DeliverySyncContext,
  cache: FolderCache
): Promise<string> {
  if (context.folderId && context.folderId.trim()) {
    return context.folderId.trim();
  }

  if (context.sheetId && cache.companyBySheet[context.sheetId]) {
    return cache.companyBySheet[context.sheetId];
  }

  // Workers join with a shared sheet and do not store the company Drive folder
  // id. MyProfile already records it, so read that before asking Drive.
  if (context.sheetId) {
    try {
      const { fetchSheetRows } = await import('@/src/utils/sheets');
      const profileRows = await fetchSheetRows(context.sheetId, 'MyProfile');
      const folder = profileRows
        .map((row) => (row.FolderID || '').trim())
        .find(Boolean);
      if (folder) {
        cache.companyBySheet[context.sheetId] = folder;
        await saveFolderCache(cache);
        return folder;
      }
    } catch {
      // fall through to Drive parent lookup
    }
  }

  if (context.sheetId) {
    const parents = await getFileParents(token, context.sheetId);
    const parent = parents.find(Boolean);
    if (parent) {
      cache.companyBySheet[context.sheetId] = parent;
      await saveFolderCache(cache);
      return parent;
    }
  }

  if (context.companyName && cache.companyByRoot[context.companyName]) {
    return cache.companyByRoot[context.companyName];
  }

  if (context.companyName) {
    const found = await findFolder(
      token,
      `${context.companyName} WorkForce Data`,
      'root'
    );
    if (found) {
      cache.companyByRoot[context.companyName] = found;
      if (context.sheetId) cache.companyBySheet[context.sheetId] = found;
      await saveFolderCache(cache);
      return found;
    }
  }

  throw new Error(
    'Could not find the company Drive folder. Open the workspace once while online, then retry the upload.'
  );
}

async function resolveDateFolder(
  token: string,
  companyFolderId: string,
  folderDate: string,
  cache: FolderCache
): Promise<string> {
  const cachedData = cache.dataFolders[companyFolderId];
  const dataFolderId =
    cachedData ||
    (await findOrCreateFolder(token, DELIVERY_ROOT_FOLDER, companyFolderId));
  if (!cachedData) {
    cache.dataFolders[companyFolderId] = dataFolderId;
    await saveFolderCache(cache);
  }

  cache.dateFolders[companyFolderId] =
    cache.dateFolders[companyFolderId] || {};
  const cachedDate = cache.dateFolders[companyFolderId][folderDate];
  if (cachedDate) return cachedDate;

  const dateFolderId = await findOrCreateFolder(
    token,
    folderDate,
    dataFolderId
  );
  cache.dateFolders[companyFolderId][folderDate] = dateFolderId;
  await saveFolderCache(cache);
  return dateFolderId;
}

async function uploadPhoto(
  token: string,
  folderId: string,
  record: DeliveryPhotoRecord
): Promise<{ id: string; url?: string }> {
  let size: number | undefined;
  try {
    const info = await FileSystem.getInfoAsync(record.localUri);
    if (info.exists && 'size' in info) size = info.size;
  } catch {
    // size is optional
  }

  const initResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files' +
      '?uploadType=resumable&fields=id,name,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': record.mimeType,
        ...(size ? { 'X-Upload-Content-Length': String(size) } : {}),
      },
      body: JSON.stringify({
        name: record.fileName,
        mimeType: record.mimeType,
        parents: [folderId],
      }),
    }
  );

  if (!initResponse.ok) {
    const detail = await initResponse.text().catch(() => '');
    const error: any = new Error(
      `Drive upload could not start (${initResponse.status})${
        detail ? `: ${detail.slice(0, 160)}` : ''
      }`
    );
    error.status = initResponse.status;
    throw error;
  }

  const uploadUrl =
    initResponse.headers.get('location') ||
    initResponse.headers.get('Location');
  if (!uploadUrl) throw new Error('Drive did not return an upload URL.');

  const upload = await FileSystem.uploadAsync(uploadUrl, record.localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': record.mimeType },
  });

  if (upload.status !== 200 && upload.status !== 201) {
    const error: any = new Error(
      `Drive upload failed (${upload.status})${
        upload.body ? `: ${upload.body.slice(0, 160)}` : ''
      }`
    );
    error.status = upload.status;
    throw error;
  }

  let body: any = null;
  try {
    body = upload.body ? JSON.parse(upload.body) : null;
  } catch {
    // response body is optional
  }
  if (!body?.id) throw new Error('Drive upload finished without a file id.');
  return { id: body.id, url: body.webViewLink };
}

/**
 * Uploads everything waiting in the local proof queue. Called automatically by
 * SyncManager when the connection returns, and by the photo UI after picking.
 */
export function syncDeliveryPhotos(
  options: { interactive?: boolean } = {}
): Promise<DeliverySyncResult> {
  if (activeSync) return activeSync;
  activeSync = runDeliverySync(options.interactive === true).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function runDeliverySync(
  interactive: boolean
): Promise<DeliverySyncResult> {
  const records = await loadDeliveryPhotos();
  const waiting = records.filter(
    (record) => record.status !== 'uploaded' && !record.holdUpload
  );
  if (waiting.length === 0) return { uploaded: 0, pending: 0, failed: 0 };

  const token = await getGoogleAccessToken(interactive);
  if (!token) {
    return {
      uploaded: 0,
      pending: waiting.length,
      failed: 0,
      error: 'Sign in with Google to upload proof photos.',
    };
  }

  const context = await readSyncContext();
  const cache = await loadFolderCache();

  let companyFolderId = '';
  try {
    companyFolderId = await resolveCompanyFolder(token, context, cache);
  } catch (error: any) {
    return {
      uploaded: 0,
      pending: waiting.length,
      failed: 0,
      error: error?.message || 'Could not find the company Drive folder.',
    };
  }

  let uploaded = 0;
  let failed = 0;
  let lastError: string | undefined;
  const current = await loadDeliveryPhotos();

  for (const record of current) {
    if (record.status === 'uploaded' || record.holdUpload) continue;

    const marked = current.map((item) =>
      item.id === record.id
        ? { ...item, status: 'uploading' as const, error: undefined }
        : item
    );
    await saveDeliveryPhotos(marked);
    notify();

    try {
      const dateFolderId = await resolveDateFolder(
        token,
        companyFolderId,
        record.folderDate,
        cache
      );
      const result = await uploadPhoto(token, dateFolderId, record);
      const after = await loadDeliveryPhotos();
      await saveDeliveryPhotos(
        after.map((item) =>
          item.id === record.id
            ? {
                ...item,
                status: 'uploaded' as const,
                error: undefined,
                driveFileId: result.id,
                driveUrl: result.url,
              }
            : item
        )
      );
      uploaded += 1;
    } catch (error: any) {
      failed += 1;
      lastError = error?.message || 'Photo upload failed.';
      const after = await loadDeliveryPhotos();
      await saveDeliveryPhotos(
        after.map((item) =>
          item.id === record.id
            ? { ...item, status: 'pending' as const, error: lastError }
            : item
        )
      );
      const status = error?.status;
      // A permission/network failure will apply to every queued photo; stop
      // early instead of burning through the whole queue.
      if (status === 401 || status === 403 || status === 404) break;
    } finally {
      notify();
    }
  }

  if (uploaded > 0) {
    try {
      const { setSyncMeta } = await import('@/src/services/localStore');
      await setSyncMeta({ lastSyncAt: Date.now() });
    } catch {
      // non-critical
    }
  }

  const remaining = (await loadDeliveryPhotos()).filter(
    (record) => record.status !== 'uploaded' && !record.holdUpload
  ).length;
  return {
    uploaded,
    pending: remaining,
    failed,
    ...(lastError ? { error: lastError } : {}),
  };
}

export async function pendingDeliveryPhotoCount(): Promise<number> {
  return (await loadDeliveryPhotos()).filter(
    (record) => record.status !== 'uploaded' && !record.holdUpload
  ).length;
}

// ------------------------------------------------------- admin proof gallery

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

/**
 * Lists the proof photos for one delivery date. Used by the admin gallery.
 * Read-only: it never creates folders.
 */
export async function listDeliveryProofFiles(params: {
  date: string;
  context?: DeliverySyncContext;
}): Promise<{ files: DriveProofFile[]; folderUrl: string; error?: string }> {
  const token = await getGoogleAccessToken(false);
  if (!token) {
    return {
      files: [],
      folderUrl: '',
      error: 'Sign in with Google to view proof photos.',
    };
  }

  const context = params.context || (await readSyncContext());
  const cache = await loadFolderCache();

  try {
    const companyFolderId = await resolveCompanyFolder(token, context, cache);
    let dataFolderId = cache.dataFolders[companyFolderId];
    if (!dataFolderId) {
      dataFolderId = await findFolder(
        token,
        DELIVERY_ROOT_FOLDER,
        companyFolderId
      );
      if (dataFolderId) {
        cache.dataFolders[companyFolderId] = dataFolderId;
        await saveFolderCache(cache);
      }
    }
    if (!dataFolderId) {
      return { files: [], folderUrl: '' };
    }

    const cachedDate = cache.dateFolders[companyFolderId]?.[params.date];
    const dateFolderId =
      cachedDate ||
      (await findFolder(token, params.date, dataFolderId));
    if (!dateFolderId) {
      return { files: [], folderUrl: '' };
    }
    if (!cachedDate) {
      cache.dateFolders[companyFolderId] =
        cache.dateFolders[companyFolderId] || {};
      cache.dateFolders[companyFolderId][params.date] = dateFolderId;
      await saveFolderCache(cache);
    }

    const query =
      `'${dateFolderId}' in parents` +
      " and mimeType contains 'image/'" +
      ' and trashed = false';
    const url =
      `${DRIVE_FILES}?q=${encodeURIComponent(query)}` +
      '&fields=files(id,name,mimeType,webViewLink,createdTime,size)' +
      '&pageSize=200&orderBy=name&spaces=drive&supportsAllDrives=true';
    const response = await fetch(url, { headers: authHeaders(token) });
    if (!response.ok) {
      return {
        files: [],
        folderUrl: `https://drive.google.com/drive/folders/${dateFolderId}`,
        error: `Drive returned ${response.status}.`,
      };
    }
    const data = await response.json().catch(() => null);
    const files: DriveProofFile[] = (data?.files || []).map((file: any) => ({
      id: file.id,
      name: file.name || 'Proof photo',
      url: file.webViewLink || '',
      mimeType: file.mimeType || 'image/jpeg',
      ...(file.createdTime ? { createdTime: file.createdTime } : {}),
      ...(typeof file.size === 'number' ? { size: file.size } : {}),
    }));
    return {
      files,
      folderUrl: `https://drive.google.com/drive/folders/${dateFolderId}`,
    };
  } catch (error: any) {
    return {
      files: [],
      folderUrl: '',
      error: error?.message || 'Could not load the proof folder.',
    };
  }
}

/** Downloads one Drive proof photo to cache so it can be shown with auth. */
export async function downloadDeliveryProofFile(
  file: DriveProofFile
): Promise<string> {
  const token = await getGoogleAccessToken(false);
  if (!token) throw new Error('Sign in with Google to open this photo.');

  const directory = `${FileSystem.cacheDirectory || photoRoot()}drive-proofs/`;
  await ensureDirectory(directory);
  const extension = (file.mimeType || '').includes('png') ? 'png' : 'jpg';
  const target = `${directory}${file.id}.${extension}`;

  try {
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists) return target;
  } catch {
    // download below
  }

  const result = await FileSystem.downloadAsync(
    `${DRIVE_FILES}/${file.id}?alt=media&supportsAllDrives=true`,
    target,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return result.uri;
}

/**
 * Removes local copies of proofs that already reached Drive. Keeps phone
 * storage from growing forever; the Drive copy remains the source of truth.
 */
export async function purgeUploadedProofs(
  retentionDays: number
): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const records = await loadDeliveryPhotos();
  const expired = records.filter(
    (record) => record.status === 'uploaded' && record.createdAt < cutoff
  );
  if (expired.length === 0) return 0;

  const expiredIds = new Set(expired.map((record) => record.id));
  await Promise.all(
    expired.map(async (record) => {
      try {
        await FileSystem.deleteAsync(record.localUri, { idempotent: true });
      } catch {
        // already gone
      }
    })
  );
  await saveDeliveryPhotos(
    records.filter((record) => !expiredIds.has(record.id))
  );
  notify();
  return expired.length;
}
