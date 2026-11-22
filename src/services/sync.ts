import { WORKSPACE_SHEET_NAMES } from '@/src/constants/workspace';
import {
  appendSheetRowRaw,
  fetchSheetValuesRaw,
  getGoogleAccessToken,
  updateSheetRangeRaw,
} from '@/src/utils/sheets';
import { ensureDeliveriesSheet } from '@/src/utils/deliveryLog';
import { ensureDeliveryLocationsSheet } from '@/src/utils/deliverySpots';
import { ensureShiftsSheet } from '@/src/utils/scheduling';
import { ensurePayrollSheet } from '@/src/utils/payroll';
import { ensureInventorySheet } from '@/src/utils/inventory';
import {
  applyMutationsToGrid,
  getPendingMutations,
  getSyncMeta,
  isNetworkError,
  removeMutation,
  setSyncMeta,
  writeCachedSheet,
  type PendingMutation,
  type SyncMeta,
} from './localStore';

export interface SyncStatus {
  pending: number;
  meta: SyncMeta;
  sheetCount: number;
}

export interface FlushResult {
  synced: number;
  failed: number;
  error?: string;
}

export interface DownloadResult {
  downloaded: number;
  failed: number;
  error?: string;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const [pending, meta] = await Promise.all([
    getPendingMutations(),
    getSyncMeta(),
  ]);
  return { pending: pending.length, meta, sheetCount: WORKSPACE_SHEET_NAMES.length };
}

/** Stores a full local snapshot of every workspace sheet. */
export async function downloadWorkspace(
  sheetId: string
): Promise<DownloadResult> {
  if (!sheetId) {
    return { downloaded: 0, failed: 0, error: 'No workspace linked.' };
  }

  let downloaded = 0;
  let failed = 0;
  let error: string | undefined;
  const pending = await getPendingMutations();
  const token = await getGoogleAccessToken(false);

  for (const sheetName of WORKSPACE_SHEET_NAMES) {
    try {
      const values = await fetchSheetValuesRaw(
        sheetId,
        sheetName,
        token || undefined
      );
      const merged = applyMutationsToGrid(
        values,
        pending.filter(
          (mutation) =>
            mutation.sheetId === sheetId && mutation.sheetName === sheetName
        )
      );
      await writeCachedSheet(sheetId, sheetName, merged);
      downloaded += 1;
    } catch (sheetError: any) {
      const status = sheetError?.status || sheetError?.response?.status;
      if (status === 400 || status === 404) {
        // Sheet doesn't exist in this workspace yet (e.g. legacy Settings).
        continue;
      }
      failed += 1;
      error = sheetError?.message || 'Download failed';
    }
  }

  await setSyncMeta({
    lastDownloadAt: downloaded > 0 ? Date.now() : null,
    lastError: error || null,
  });

  return { downloaded, failed, error };
}

function replayMutation(mutation: PendingMutation, token: string) {
  if (mutation.kind === 'append') {
    return appendSheetRowRaw(
      mutation.sheetId,
      mutation.sheetName,
      mutation.values,
      token
    );
  }
  return updateSheetRangeRaw(
    mutation.sheetId,
    mutation.range,
    mutation.values,
    token
  );
}

/**
 * Uploads everything in the offline queue. Called from the Sync button and
 * automatically by the SyncManager when the app comes back online.
 */
export async function flushPendingMutations(
  interactive = false
): Promise<FlushResult> {
  const queue = await getPendingMutations();
  if (queue.length === 0) {
    await setSyncMeta({ lastSyncAt: Date.now(), lastError: null });
    return { synced: 0, failed: 0 };
  }

  const token = await getGoogleAccessToken(interactive);
  if (!token) {
    if (!interactive) {
      return { synced: 0, failed: queue.length };
    }
    const error = 'Sign in with Google to sync your changes.';
    await setSyncMeta({ lastError: error });
    return { synced: 0, failed: queue.length, error };
  }

  let synced = 0;
  let failed = 0;
  let lastError: string | undefined;

  const firstDelivery = queue.find(
    (mutation) => mutation.sheetName === 'Deliveries'
  );
  if (firstDelivery) {
    try {
      await ensureDeliveriesSheet(firstDelivery.sheetId, token);
    } catch {
      // The append below will report the real error if the tab is missing.
    }
  }

  const firstLocation = queue.find(
    (mutation) => mutation.sheetName === 'DeliveryLocations'
  );
  if (firstLocation) {
    try {
      await ensureDeliveryLocationsSheet(firstLocation.sheetId, token);
    } catch {
      // The append below will report the real error if the tab is missing.
    }
  }

  const firstShift = queue.find(
    (mutation) => mutation.sheetName === 'Shifts'
  );
  if (firstShift) {
    try {
      await ensureShiftsSheet(firstShift.sheetId, token);
    } catch {
      // The append below will report the real error if the tab is missing.
    }
  }

  const firstPayroll = queue.find(
    (mutation) => mutation.sheetName === 'Payroll'
  );
  if (firstPayroll) {
    try {
      await ensurePayrollSheet(firstPayroll.sheetId, token);
    } catch {
      // The append below will report the real error if the tab is missing.
    }
  }

  const firstInventory = queue.find(
    (mutation) => mutation.sheetName === 'Inventory'
  );
  if (firstInventory) {
    try {
      await ensureInventorySheet(firstInventory.sheetId, token);
    } catch {
      // The append below will report the real error if the tab is missing.
    }
  }

  for (const mutation of queue) {
    try {
      await replayMutation(mutation, token);
      await removeMutation(mutation.id);
      synced += 1;
    } catch (error: any) {
      failed += 1;
      lastError = error?.message || 'Sync failed';
      if (isNetworkError(error)) {
        // Still offline — stop early and keep the rest queued.
        break;
      }
    }
  }

  await setSyncMeta({
    lastSyncAt: synced > 0 ? Date.now() : (await getSyncMeta()).lastSyncAt,
    lastError: lastError || null,
  });

  return { synced, failed, error: lastError };
}
