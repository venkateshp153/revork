import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  AppState,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  downloadWorkspace,
  flushPendingMutations,
  getSyncStatus,
  type SyncStatus,
} from '@/src/services/sync';

interface SyncControlsProps {
  sheetId: string;
  accent?: string;
  /** Smaller layout used on the Home screen for managers/employees. */
  compact?: boolean;
}

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Reusable download/sync controls. Any screen can drop this in to expose the
 * cached workspace snapshot and the offline mutation queue.
 */
export default function SyncControls({
  sheetId,
  accent = '#2563EB',
  compact = false,
}: SyncControlsProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<'download' | 'sync' | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await getSyncStatus());
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const interval = setInterval(refresh, 15000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [refresh]);

  const handleDownload = async () => {
    setBusy('download');
    try {
      const result = await downloadWorkspace(sheetId);
      await refresh();
      if (result.failed > 0) {
        Alert.alert(
          'Downloaded with warnings',
          `${result.downloaded} sheets saved locally. ${result.failed} could not be downloaded${
            result.error ? `: ${result.error}` : '.'
          }`
        );
      } else {
        Alert.alert(
          'Download complete',
          `${result.downloaded} sheets are available offline.`
        );
      }
    } catch (error: any) {
      Alert.alert('Download failed', error?.message || 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async () => {
    setBusy('sync');
    try {
      const result = await flushPendingMutations(true);
      await refresh();
      if (result.error) {
        Alert.alert(
          'Sync needs attention',
          `${result.synced} change(s) uploaded. ${result.failed} still pending${
            result.error ? `: ${result.error}` : '.'
          }`
        );
      } else {
        Alert.alert(
          'Synced',
          result.synced > 0
            ? `${result.synced} local change(s) uploaded to Sheets.`
            : 'Everything is already in sync.'
        );
      }
    } catch (error: any) {
      Alert.alert('Sync failed', error?.message || 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const pending = status?.pending || 0;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <MaterialCommunityIcons
            name="cloud-sync-outline"
            size={compact ? 14 : 18}
            color={accent}
          />
          <Text style={[styles.title, compact && styles.titleCompact]}>
            Offline & Sync
          </Text>
        </View>
        <View
          style={[
            styles.pendingChip,
            compact && styles.pendingChipCompact,
            { backgroundColor: pending > 0 ? '#FEF3E2' : '#DCFCE7' },
          ]}
        >
          <Text
            style={[
              styles.pendingText,
              compact && styles.pendingTextCompact,
              { color: pending > 0 ? '#B45309' : '#15803D' },
            ]}
          >
            {pending > 0 ? `${pending} pending` : 'In sync'}
          </Text>
        </View>
      </View>

      {!compact && (
        <Text style={styles.hint}>
          Download keeps every sheet on this device. Sync uploads changes made
          while offline.
        </Text>
      )}

      <View style={[styles.actions, compact && styles.actionsCompact]}>
        <TouchableOpacity
          style={[
            styles.button,
            compact && styles.buttonCompact,
            { backgroundColor: '#EEF2FF' },
          ]}
          onPress={handleDownload}
          disabled={!!busy}
        >
          {busy === 'download' ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <>
              <MaterialCommunityIcons
                name="download"
                size={compact ? 13 : 16}
                color={accent}
              />
              <Text
                style={[
                  styles.buttonText,
                  compact && styles.buttonTextCompact,
                  { color: accent },
                ]}
              >
                Download
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            compact && styles.buttonCompact,
            { backgroundColor: accent },
          ]}
          onPress={handleSync}
          disabled={!!busy}
        >
          {busy === 'sync' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons
                name="sync"
                size={compact ? 13 : 16}
                color="#fff"
              />
              <Text
                style={[
                  styles.buttonText,
                  compact && styles.buttonTextCompact,
                  { color: '#fff' },
                ]}
              >
                Sync
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.meta, compact && styles.metaCompact]}>
        Downloaded {relativeTime(status?.meta.lastDownloadAt ?? null)} · Synced{' '}
        {relativeTime(status?.meta.lastSyncAt ?? null)}
      </Text>
      {!!status?.meta.lastError && (
        <Text style={[styles.error, compact && styles.errorCompact]} numberOfLines={2}>
          {status.meta.lastError}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 20,
    marginTop: 16,
  },
  cardCompact: {
    borderRadius: 12,
    padding: 9,
    marginHorizontal: 16,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleWrap: { flexDirection: 'row', alignItems: 'center' },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
    marginLeft: 6,
  },
  titleCompact: { fontSize: 11, marginLeft: 4 },
  pendingChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9 },
  pendingChipCompact: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  pendingText: { fontSize: 10, fontWeight: '800' },
  pendingTextCompact: { fontSize: 9 },
  hint: { fontSize: 11, color: '#64748B', marginTop: 8, lineHeight: 16 },
  actions: { flexDirection: 'row', marginTop: 12 },
  actionsCompact: { marginTop: 8 },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 8,
  },
  buttonCompact: {
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
  },
  buttonText: { fontSize: 12, fontWeight: '800', marginLeft: 6 },
  buttonTextCompact: { fontSize: 10, marginLeft: 4 },
  meta: { fontSize: 10, color: '#94A3B8', marginTop: 10 },
  metaCompact: { fontSize: 9, marginTop: 6 },
  error: { fontSize: 10, color: '#B91C1C', marginTop: 4 },
  errorCompact: { fontSize: 9, marginTop: 3 },
});
