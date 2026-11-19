import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import PhotoViewerModal, {
  type ViewerPhoto,
} from '@/components/PhotoViewerModal';
import { fetchSheetRows, type SheetRow } from '@/src/utils/sheets';
import {
  downloadDeliveryProofFile,
  listDeliveryProofFiles,
  type DriveProofFile,
} from '@/src/utils/deliveryPhotos';
import { localDateStamp } from '@/src/utils/deliveryLog';

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DeliveryProofsScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const companyName =
    user.profile?.companyName || user.workerProfile?.companyName || '';
  const folderId = user.folderId || user.profile?.folderId || '';

  const [selectedDate, setSelectedDate] = useState(localDateStamp());
  const [deliveries, setDeliveries] = useState<SheetRow[]>([]);
  const [files, setFiles] = useState<DriveProofFile[]>([]);
  const [folderUrl, setFolderUrl] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<ViewerPhoto | null>(null);
  const [openingId, setOpeningId] = useState('');

  const load = useCallback(
    async (date: string, showSpinner = false) => {
      if (!sheetId) {
        setError('No workspace is linked to this account.');
        setLoading(false);
        return;
      }
      if (showSpinner) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const rows = await fetchSheetRows(sheetId, 'Deliveries');
        setDeliveries(rows);
      } catch (sheetError: any) {
        setDeliveries([]);
        const status = sheetError?.status || sheetError?.response?.status;
        if (status !== 400 && status !== 404) {
          setError(
            sheetError?.message ||
              'Could not read the Deliveries tab yet. It appears after the first delivery.'
          );
        }
      }

      const result = await listDeliveryProofFiles({
        date,
        context: { sheetId, folderId, companyName },
      });
      setFiles(result.files);
      setFolderUrl(result.folderUrl);
      if (result.error) setError(result.error);

      setLoading(false);
      setRefreshing(false);
    },
    [sheetId, folderId, companyName]
  );

  useFocusEffect(
    useCallback(() => {
      void load(selectedDate);
    }, [load, selectedDate])
  );

  // Warm the first few thumbnails one at a time to avoid a memory spike.
  useEffect(() => {
    let alive = true;
    const targets = files.slice(0, 12);
    (async () => {
      const found: Record<string, string> = {};
      for (const file of targets) {
        if (!alive) return;
        try {
          const uri = await downloadDeliveryProofFile(file);
          found[file.id] = uri;
          if (alive) setThumbs((prev) => ({ ...prev, [file.id]: uri }));
        } catch {
          // shown as a placeholder; tapping retries
        }
      }
      if (alive && Object.keys(found).length > 0) {
        setThumbs((prev) => ({ ...prev, ...found }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [files]);

  const dates = useMemo(() => {
    const set = new Set(deliveries.map((row) => row.Date).filter(Boolean));
    set.add(selectedDate);
    return Array.from(set).sort().reverse();
  }, [deliveries, selectedDate]);

  const dateRows = useMemo(
    () =>
      deliveries
        .filter((row) => row.Date === selectedDate)
        .sort((a, b) =>
          (a.CreatedAt || a.Time || '').localeCompare(
            b.CreatedAt || b.Time || ''
          )
        ),
    [deliveries, selectedDate]
  );

  const orders = dateRows.reduce(
    (sum, row) => sum + (parseInt(row.OrderCount || '0', 10) || 0),
    0
  );
  const withProof = dateRows.filter(
    (row) => (parseInt(row.PhotoCount || '0', 10) || 0) > 0
  ).length;

  const shiftDate = (delta: number) => {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + delta);
    setSelectedDate(localDateStamp(date));
  };

  const openFile = async (file: DriveProofFile) => {
    setOpeningId(file.id);
    try {
      const uri =
        thumbs[file.id] || (await downloadDeliveryProofFile(file));
      setThumbs((prev) => ({ ...prev, [file.id]: uri }));
      setViewer({
        uri,
        title: file.name,
        subtitle: formatDateLabel(selectedDate),
        meta: [
          file.createdTime
            ? `Uploaded ${new Date(file.createdTime).toLocaleString()}`
            : 'Uploaded proof photo',
          file.size ? `${Math.round(file.size / 1024)} KB` : '',
        ].filter(Boolean),
        driveUrl: file.url,
      });
    } catch (openError: any) {
      setError(openError?.message || 'Could not open that photo.');
    } finally {
      setOpeningId('');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Delivery proofs</Text>
          <Text style={styles.subtitle}>
            Orders, deliveries and photo proof by day
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => void load(selectedDate, true)}
        >
          <MaterialCommunityIcons name="refresh" size={19} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(selectedDate, true)}
            tintColor="#16A34A"
          />
        }
      >
        <View style={styles.dateBar}>
          <TouchableOpacity
            style={styles.dateArrow}
            onPress={() => shiftDate(-1)}
          >
            <MaterialCommunityIcons
              name="chevron-left"
              size={20}
              color="#475569"
            />
          </TouchableOpacity>
          <View style={styles.dateTextWrap}>
            <Text style={styles.dateText}>{formatDateLabel(selectedDate)}</Text>
            <Text style={styles.dateSub}>{selectedDate}</Text>
          </View>
          <TouchableOpacity
            style={styles.dateArrow}
            onPress={() => shiftDate(1)}
          >
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color="#475569"
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dateChips}
        >
          {dates.slice(0, 14).map((date) => {
            const active = date === selectedDate;
            return (
              <TouchableOpacity
                key={date}
                style={[styles.dateChip, active && styles.dateChipActive]}
                onPress={() => setSelectedDate(date)}
              >
                <Text
                  style={[
                    styles.dateChipText,
                    active && styles.dateChipTextActive,
                  ]}
                >
                  {date === localDateStamp() ? 'Today' : date.slice(5)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.summaryCard}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{dateRows.length}</Text>
            <Text style={styles.summaryLabel}>Deliveries</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{orders}</Text>
            <Text style={styles.summaryLabel}>Orders</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{files.length}</Text>
            <Text style={styles.summaryLabel}>Photos</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>
              {withProof}/{dateRows.length}
            </Text>
            <Text style={styles.summaryLabel}>With proof</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#16A34A" />
            <Text style={styles.loadingText}>Loading proofs…</Text>
          </View>
        ) : (
          <>
            {!!error && (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={15}
                  color="#B45309"
                />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Deliveries</Text>
              <Text style={styles.sectionCount}>{dateRows.length}</Text>
            </View>

            {dateRows.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons
                  name="package-variant"
                  size={26}
                  color="#CBD5E1"
                />
                <Text style={styles.emptyText}>
                  No deliveries logged for this day.
                </Text>
              </View>
            ) : (
              dateRows.map((row) => (
                <View key={row.DeliveryID || `${row.StopID}-${row.Time}`} style={styles.deliveryCard}>
                  <View style={styles.deliveryTop}>
                    <View style={styles.deliveryIcon}>
                      <MaterialCommunityIcons
                        name="check"
                        size={13}
                        color="#15803D"
                      />
                    </View>
                    <View style={styles.deliveryInfo}>
                      <Text style={styles.deliveryName} numberOfLines={1}>
                        {row.Name || 'Customer'}
                      </Text>
                      <Text style={styles.deliveryAddress} numberOfLines={2}>
                        {row.Address || '—'}
                      </Text>
                    </View>
                    <View style={styles.deliveryRight}>
                      <Text style={styles.deliveryTime}>{row.Time}</Text>
                      <Text style={styles.deliveryOrders}>
                        {parseInt(row.OrderCount || '0', 10) || 0} orders
                      </Text>
                    </View>
                  </View>
                  <View style={styles.deliveryMetaRow}>
                    {!!row.Phone && (
                      <View style={styles.metaChip}>
                        <MaterialCommunityIcons
                          name="phone-outline"
                          size={10}
                          color="#64748B"
                        />
                        <Text style={styles.metaChipText}>{row.Phone}</Text>
                      </View>
                    )}
                    <View style={styles.metaChip}>
                      <MaterialCommunityIcons
                        name="camera-outline"
                        size={10}
                        color="#64748B"
                      />
                      <Text style={styles.metaChipText}>
                        {row.PhotoCount || 0} photo
                        {(parseInt(row.PhotoCount || '0', 10) || 0) === 1
                          ? ''
                          : 's'}
                      </Text>
                    </View>
                    {!!row.GPS && (
                      <View style={styles.metaChip}>
                        <MaterialCommunityIcons
                          name="crosshairs-gps"
                          size={10}
                          color="#64748B"
                        />
                        <Text style={styles.metaChipText}>{row.GPS}</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Proof photos</Text>
              {!!folderUrl && (
                <TouchableOpacity
                  onPress={() => {
                    void Linking.openURL(folderUrl);
                  }}
                >
                  <Text style={styles.folderLink}>Open Drive folder</Text>
                </TouchableOpacity>
              )}
            </View>

            {files.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons
                  name="camera-off-outline"
                  size={26}
                  color="#CBD5E1"
                />
                <Text style={styles.emptyText}>
                  No proof photos in the Drive folder for this day.
                </Text>
              </View>
            ) : (
              <View style={styles.photoGrid}>
                {files.map((file) => {
                  const uri = thumbs[file.id];
                  return (
                    <TouchableOpacity
                      key={file.id}
                      style={styles.photoCard}
                      onPress={() => void openFile(file)}
                      activeOpacity={0.85}
                    >
                      {uri ? (
                        <Image source={{ uri }} style={styles.photo} />
                      ) : (
                        <View style={styles.photoPlaceholder}>
                          {openingId === file.id ? (
                            <ActivityIndicator size="small" color="#16A34A" />
                          ) : (
                            <MaterialCommunityIcons
                              name="image-outline"
                              size={22}
                              color="#94A3B8"
                            />
                          )}
                        </View>
                      )}
                      <Text style={styles.photoName} numberOfLines={1}>
                        {file.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <PhotoViewerModal
        visible={!!viewer}
        photo={viewer}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803D',
    paddingTop: 54,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerText: { flex: 1 },
  title: { color: '#fff', fontSize: 19, fontWeight: '800' },
  subtitle: { color: '#DCFCE7', fontSize: 10.5, marginTop: 3 },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, paddingBottom: 50 },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 8,
    marginBottom: 8,
  },
  dateArrow: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateTextWrap: { flex: 1, alignItems: 'center' },
  dateText: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  dateSub: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  dateChips: { marginBottom: 10 },
  dateChip: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
  },
  dateChipActive: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  dateChipText: { fontSize: 9.5, color: '#64748B', fontWeight: '700' },
  dateChipTextActive: { color: '#15803D' },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  summaryLabel: { fontSize: 8.5, color: '#94A3B8', marginTop: 2 },
  summaryDivider: { width: 1, height: 24, backgroundColor: '#F1F5F9' },
  center: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { fontSize: 11, color: '#94A3B8', marginTop: 8 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 10, color: '#B45309', marginLeft: 5, lineHeight: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 2,
  },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: '#1E293B' },
  sectionCount: { fontSize: 10, color: '#94A3B8', fontWeight: '700' },
  folderLink: { fontSize: 9.5, fontWeight: '800', color: '#2563EB' },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 22,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 10.5,
    color: '#94A3B8',
    marginTop: 6,
    textAlign: 'center',
  },
  deliveryCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  deliveryTop: { flexDirection: 'row', alignItems: 'flex-start' },
  deliveryIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 1,
  },
  deliveryInfo: { flex: 1, paddingRight: 8 },
  deliveryName: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  deliveryAddress: { fontSize: 10, color: '#64748B', marginTop: 2, lineHeight: 14 },
  deliveryRight: { alignItems: 'flex-end' },
  deliveryTime: { fontSize: 9.5, color: '#94A3B8', fontWeight: '700' },
  deliveryOrders: { fontSize: 9, color: '#15803D', fontWeight: '800', marginTop: 3 },
  deliveryMetaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 5,
    marginBottom: 3,
  },
  metaChipText: { fontSize: 8, color: '#64748B', marginLeft: 3, fontWeight: '600' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  photoCard: {
    width: '48%',
    marginRight: '2%',
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: 120, backgroundColor: '#F1F5F9' },
  photoPlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoName: { fontSize: 8.5, color: '#64748B', padding: 6 },
});
