import { useEffect } from 'react';
import { AppState, NativeModules } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { flushPendingMutations, getSyncStatus } from '@/src/services/sync';
import { ensureDeliveriesSheet } from '@/src/utils/deliveryLog';
import {
  pendingDeliveryPhotoCount,
  purgeUploadedProofs,
  setDeliverySyncContext,
  syncDeliveryPhotos,
} from '@/src/utils/deliveryPhotos';
import { readCompanySettings } from '@/src/utils/settings';
import {
  ensurePublicReadAccess,
  getGoogleAccessToken,
} from '@/src/utils/sheets';

/**
 * Flushes the offline queue automatically and keeps the admin workspace
 * publicly readable (API-key reads) without requiring a re-login.
 *
 * It also drains queued delivery proof photos to Google Drive as soon as the
 * device gets a connection, so drivers can work in dead zones without thinking
 * about uploads.
 */
export default function SyncManager() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const folderId = user.folderId || user.profile?.folderId || '';
  const companyName =
    user.profile?.companyName || user.workerProfile?.companyName || '';
  const role = user.profile?.designation || user.designation;

  useEffect(() => {
    if (!sheetId) return;
    void setDeliverySyncContext({ sheetId, folderId, companyName });
  }, [sheetId, folderId, companyName]);

  // Once the workspace folder is known (e.g. right after rehydration or login),
  // start any proof uploads that were queued while the context was missing.
  useEffect(() => {
    if (!sheetId) return;
    void pendingDeliveryPhotoCount().then((count) => {
      if (count > 0) void syncDeliveryPhotos();
    });
  }, [sheetId, folderId, companyName]);

  useEffect(() => {
    if (role !== 'admin' || !sheetId) return;

    let cancelled = false;

    const repairAccess = async () => {
      try {
        const token = await getGoogleAccessToken(false);
        if (token && !cancelled) {
          await ensurePublicReadAccess(sheetId, token);
        }
      } catch {
        // retried on the next foreground event
      }
    };

    repairAccess();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') repairAccess();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [role, sheetId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      try {
        const token = await getGoogleAccessToken(false);
        if (token && sheetId) {
          // Older workspaces may not have the Deliveries tab yet.
          await ensureDeliveriesSheet(sheetId, token);
        }
      } catch {
        // retried on the next pass
      }
      try {
        const status = await getSyncStatus();
        if (status.pending > 0) {
          await flushPendingMutations(false);
        }
      } catch {
        // stays queued for the next attempt
      }
      try {
        if ((await pendingDeliveryPhotoCount()) > 0) {
          await syncDeliveryPhotos();
        }
      } catch {
        // photos stay queued for the next attempt
      }
      try {
        if (sheetId) {
          const settings = await readCompanySettings(sheetId);
          await purgeUploadedProofs(settings.proofRetentionDays);
        }
      } catch {
        // cleanup is best-effort
      }
    };

    run();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });

    // Loaded lazily so an older dev-client build does not crash on startup;
    // the 60-second foreground interval below still drains the queue.
    let unsubscribeNetwork: (() => void) | undefined;
    const hasNativeNetInfo = () => {
      try {
        return !!NativeModules.RNCNetInfo;
      } catch {
        return false;
      }
    };
    if (hasNativeNetInfo()) {
      void (async () => {
        try {
          const NetInfo = (await import('@react-native-community/netinfo'))
            .default;
          if (cancelled) return;
          unsubscribeNetwork = NetInfo.addEventListener((state) => {
            const online =
              state.isConnected === true && state.isInternetReachable !== false;
            if (online) void run();
          });
        } catch {
          // Native module missing — polling keeps sync working.
        }
      })();
    }

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') run();
    }, 60000);

    return () => {
      cancelled = true;
      subscription.remove();
      unsubscribeNetwork?.();
      clearInterval(interval);
    };
  }, [sheetId]);

  return null;
}
