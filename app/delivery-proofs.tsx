import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
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
import { fetchSheetRows, getGoogleAccessToken, type SheetRow } from '@/src/utils/sheets';
import { sendAlert } from '@/src/utils/notifications';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import {
  buildProofBaseName,
  downloadDeliveryProofFile,
  listDeliveryProofFiles,
  loadDeliveryPhotos,
  subscribeDeliveryPhotos,
  syncDeliveryPhotos,
  type DeliveryPhotoRecord,
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

function normalizePhone(value?: string): string {
  return (value || '').replace(/\D/g, '');
}

/** Proof photos are named from the receiver/address/phone, so match that way. */
function driveFilesForDelivery(
  row: SheetRow,
  files: DriveProofFile[]
): DriveProofFile[] {
  const base = buildProofBaseName({
    personName: row.Name,
    address: row.Address,
    phone: row.Phone,
  }).toLowerCase();
  const exact = files.filter((file) =>
    file.name.toLowerCase().startsWith(base)
  );
  if (exact.length > 0) return exact;

  const phone = normalizePhone(row.Phone);
  if (phone.length >= 6) {
    return files.filter((file) => normalizePhone(file.name).includes(phone));
  }
  return [];
}

function localPhotosForDelivery(
  row: SheetRow,
  photos: DeliveryPhotoRecord[]
): DeliveryPhotoRecord[] {
  const phone = normalizePhone(row.Phone);
  const name = (row.Name || '').trim().toLowerCase();
  const address = (row.Address || '').trim().toLowerCase();
  return photos.filter((photo) => {
    if (phone && normalizePhone(photo.phone) === phone) return true;
    return (
      !!name &&
      photo.personName.trim().toLowerCase() === name &&
      photo.address.trim().toLowerCase() === address
    );
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
  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [files, setFiles] = useState<DriveProofFile[]>([]);
  const [folderUrl, setFolderUrl] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<ViewerPhoto | null>(null);
  const [openingId, setOpeningId] = useState('');
  const [detailDelivery, setDetailDelivery] = useState<SheetRow | null>(null);
  const [pendingUploads, setPendingUploads] = useState<DeliveryPhotoRecord[]>([]);
  const [syncingUploads, setSyncingUploads] = useState(false);
  const [remindingIds, setRemindingIds] = useState<Record<string, boolean>>({});
  const [remindingAll, setRemindingAll] = useState(false);

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

      try {
        const workerRows = await fetchSheetRows(sheetId, 'Workers');
        setWorkers(workerRows);
      } catch {
        setWorkers([]);
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

  const refreshPendingUploads = useCallback(async () => {
    const records = await loadDeliveryPhotos();
    setPendingUploads(
      records.filter(
        (record) =>
          record.status !== 'uploaded' && record.folderDate === selectedDate
      )
    );
  }, [selectedDate]);

  // Local photos that still need uploading are invisible to the Drive listing,
  // so surface them here and refresh the Drive gallery when sync status changes.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const records = await loadDeliveryPhotos();
      if (!alive) return;
      setPendingUploads(
        records.filter(
          (record) =>
            record.status !== 'uploaded' && record.folderDate === selectedDate
        )
      );
    };
    void run();
    const unsubscribe = subscribeDeliveryPhotos(() => {
      void run();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (alive) void load(selectedDate, true);
      }, 900);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [selectedDate, load]);

  // Admins and managers see the whole team. Employees only ever see the
  // deliveries assigned to them, so the summary moved here stays personal.
  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        user.workerProfile?.workerId,
        user.email || user.workerProfile?.email
      ),
    [workers, user.workerProfile?.workerId, user.email, user.workerProfile?.email]
  );
  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const canManageProofs = designation === 'admin' || designation === 'manager';
  const myWorkerId = (
    user.workerProfile?.workerId ||
    myRow?.WorkerID ||
    ''
  ).trim();
  const myWorkerName = (
    user.name ||
    user.workerProfile?.name ||
    myRow?.Name ||
    ''
  ).trim().toLowerCase();

  const visibleDeliveries = useMemo(() => {
    if (canManageProofs) return deliveries;
    return deliveries.filter((row) => {
      const rowWorkerId = (row.WorkerID || '').trim();
      if (rowWorkerId) {
        return !!myWorkerId && rowWorkerId === myWorkerId;
      }
      return (
        !!myWorkerName &&
        (row.WorkerName || '').trim().toLowerCase() === myWorkerName
      );
    });
  }, [canManageProofs, deliveries, myWorkerId, myWorkerName]);

  const dates = useMemo(() => {
    const set = new Set(visibleDeliveries.map((row) => row.Date).filter(Boolean));
    set.add(selectedDate);
    return Array.from(set).sort().reverse();
  }, [visibleDeliveries, selectedDate]);

  const dateRows = useMemo(
    () =>
      visibleDeliveries
        .filter((row) => row.Date === selectedDate)
        .sort((a, b) =>
          (a.CreatedAt || a.Time || '').localeCompare(
            b.CreatedAt || b.Time || ''
          )
        ),
    [visibleDeliveries, selectedDate]
  );

  // Employees only see proof photos that belong to their own deliveries.
  const visiblePendingUploads = useMemo(() => {
    if (canManageProofs) return pendingUploads;
    return pendingUploads.filter((record) =>
      dateRows.some(
        (row) => localPhotosForDelivery(row, [record]).length > 0
      )
    );
  }, [canManageProofs, pendingUploads, dateRows]);

  const visibleFiles = useMemo(() => {
    if (canManageProofs) return files;
    const matched = new Set<string>();
    dateRows.forEach((row) => {
      driveFilesForDelivery(row, files).forEach((file) =>
        matched.add(file.id)
      );
    });
    return files.filter((file) => matched.has(file.id));
  }, [canManageProofs, files, dateRows]);

  const orders = dateRows.reduce(
    (sum, row) => sum + (parseInt(row.OrderCount || '0', 10) || 0),
    0
  );
  const withProof = dateRows.filter(
    (row) =>
      (parseInt(row.PhotoCount || '0', 10) || 0) > 0 ||
      localPhotosForDelivery(row, visiblePendingUploads).length > 0
  ).length;

  const missingProofRows = useMemo(
    () =>
      dateRows.filter(
        (row) =>
          (parseInt(row.PhotoCount || '0', 10) || 0) === 0 &&
          localPhotosForDelivery(row, visiblePendingUploads).length === 0
      ),
    [dateRows, visiblePendingUploads]
  );

  const proofRequestId = (row: SheetRow) =>
    row.DeliveryID || `${row.StopID || 'stop'}-${row.Time || ''}`;

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

  const openLocalPhoto = (record: DeliveryPhotoRecord) => {
    setViewer({
      uri: record.localUri,
      title: record.fileName,
      subtitle: record.address || 'Delivery proof',
      meta: [
        `Captured ${new Date(record.createdAt).toLocaleString()}`,
        typeof record.lat === 'number' && typeof record.lng === 'number'
          ? `GPS ${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}`
          : 'GPS not recorded',
        record.error
          ? `Upload failed: ${record.error}`
          : 'Waiting to upload to Google Drive',
      ].filter(Boolean),
      ...(record.driveUrl ? { driveUrl: record.driveUrl } : {}),
    });
  };

  const syncPendingUploads = async () => {
    setSyncingUploads(true);
    setError('');
    try {
      const result = await syncDeliveryPhotos();
      await refreshPendingUploads();
      await load(selectedDate, true);
      if (result.error) setError(result.error);
    } catch (syncError: any) {
      setError(syncError?.message || 'Could not upload proof photos.');
    } finally {
      setSyncingUploads(false);
    }
  };

  const sendProofRequest = async (
    token: string,
    row: SheetRow
  ): Promise<boolean> => {
    const workerId = (row.WorkerID || '').trim();
    if (!workerId) return false;
    await sendAlert({
      sheetId,
      token,
      target: workerId,
      title: 'Proof photo needed',
      body: `Please upload a proof photo for “${
        row.Address || row.Name || 'today’s delivery'
      }” on ${formatDateLabel(selectedDate)}.`,
      durationHours: 48,
      fromUid: user.uid || user.email || 'admin',
      type: 'proof_request',
    });
    return true;
  };

  const remindDelivery = async (row: SheetRow) => {
    const id = proofRequestId(row);
    if (!row.WorkerID) {
      Alert.alert(
        'No employee linked',
        'This delivery has no employee ID, so a reminder cannot be sent.'
      );
      return;
    }
    setRemindingIds((prev) => ({ ...prev, [id]: true }));
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) throw new Error('Sign in with Google to send reminders.');
      const sent = await sendProofRequest(token, row);
      if (!sent) throw new Error('This delivery has no employee linked.');
      Alert.alert(
        'Reminder sent',
        `${row.WorkerName || 'The employee'} will see it in Alerts.`
      );
    } catch (remindError: any) {
      Alert.alert(
        'Could not send reminder',
        remindError?.message || 'Try again.'
      );
    } finally {
      setRemindingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const remindAllMissing = async () => {
    const rows = missingProofRows.filter((row) => !!row.WorkerID);
    if (rows.length === 0) {
      Alert.alert(
        'No employees linked',
        'None of the missing deliveries have an employee ID.'
      );
      return;
    }
    setRemindingAll(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) throw new Error('Sign in with Google to send reminders.');
      let sent = 0;
      for (const row of rows) {
        try {
          if (await sendProofRequest(token, row)) sent += 1;
        } catch {
          // Keep sending the rest; the summary reports how many went out.
        }
      }
      Alert.alert(
        'Reminders sent',
        `${sent} reminder${sent === 1 ? '' : 's'} sent to employees in Alerts.`
      );
    } catch (remindError: any) {
      Alert.alert(
        'Could not send reminders',
        remindError?.message || 'Try again.'
      );
    } finally {
      setRemindingAll(false);
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
          <View style={styles.summaryStats}>
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
              <Text style={styles.summaryValue}>
                {withProof}/{dateRows.length}
              </Text>
              <Text style={styles.summaryLabel}>With proof</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{visibleFiles.length}</Text>
              <Text style={styles.summaryLabel}>Uploaded</Text>
            </View>
          </View>
          <View style={styles.summaryFooter}>
            <MaterialCommunityIcons
              name={
                visiblePendingUploads.length > 0
                  ? 'cloud-clock-outline'
                  : 'cloud-check-outline'
              }
              size={12}
              color={visiblePendingUploads.length > 0 ? '#B45309' : '#15803D'}
            />
            <Text
              style={[
                styles.summaryFooterText,
                {
                  color:
                    visiblePendingUploads.length > 0 ? '#B45309' : '#15803D',
                },
              ]}
            >
              {visiblePendingUploads.length > 0
                ? `${visiblePendingUploads.length} proof photo${
                    visiblePendingUploads.length === 1 ? '' : 's'
                  } waiting to upload`
                : 'All proof photos are safely uploaded'}
            </Text>
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

            {visiblePendingUploads.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Pending uploads</Text>
                    <Text style={styles.sectionHint}>
                      {visiblePendingUploads.length} photo
                      {visiblePendingUploads.length === 1 ? '' : 's'} still on this
                      device
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.syncButton}
                    onPress={() => void syncPendingUploads()}
                    disabled={syncingUploads}
                  >
                    {syncingUploads ? (
                      <ActivityIndicator size="small" color="#16A34A" />
                    ) : (
                      <MaterialCommunityIcons
                        name="cloud-upload-outline"
                        size={14}
                        color="#16A34A"
                      />
                    )}
                    <Text style={styles.syncButtonText}>
                      {syncingUploads ? 'Syncing…' : 'Sync now'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {visiblePendingUploads.map((record) => (
                  <TouchableOpacity
                    key={record.id}
                    style={styles.pendingCard}
                    onPress={() => openLocalPhoto(record)}
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{ uri: record.localUri }}
                      style={styles.pendingThumb}
                    />
                    <View style={styles.pendingInfo}>
                      <Text style={styles.pendingName} numberOfLines={1}>
                        {record.personName || 'Proof photo'}
                      </Text>
                      <Text style={styles.pendingAddress} numberOfLines={1}>
                        {record.address || 'Delivery address'}
                      </Text>
                      <Text style={styles.pendingMeta} numberOfLines={1}>
                        {new Date(record.createdAt).toLocaleString()}
                        {record.error ? ' · Upload failed' : ' · Waiting to upload'}
                      </Text>
                    </View>
                    <MaterialCommunityIcons
                      name="cloud-clock-outline"
                      size={18}
                      color="#B45309"
                    />
                  </TouchableOpacity>
                ))}
              </>
            )}

            {missingProofRows.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>Missing proof</Text>
                    <Text style={styles.sectionHint}>
                      {missingProofRows.length} deliver
                      {missingProofRows.length === 1 ? 'y' : 'ies'} without a
                      proof photo
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.remindAllButton}
                    onPress={() => void remindAllMissing()}
                    disabled={remindingAll}
                  >
                    {remindingAll ? (
                      <ActivityIndicator size="small" color="#B45309" />
                    ) : (
                      <MaterialCommunityIcons
                        name="bell-ring-outline"
                        size={14}
                        color="#B45309"
                      />
                    )}
                    <Text style={styles.remindAllText}>Remind all</Text>
                  </TouchableOpacity>
                </View>

                {missingProofRows.map((row) => {
                  const id = proofRequestId(row);
                  const busy = !!remindingIds[id];
                  return (
                    <View key={id} style={styles.missingCard}>
                      <View style={styles.missingIcon}>
                        <MaterialCommunityIcons
                          name="camera-off-outline"
                          size={16}
                          color="#B45309"
                        />
                      </View>
                      <View style={styles.missingInfo}>
                        <Text style={styles.missingName} numberOfLines={1}>
                          {row.Name || 'Customer'}
                        </Text>
                        <Text style={styles.missingAddress} numberOfLines={1}>
                          {row.Address || '—'}
                        </Text>
                        <Text style={styles.missingMeta} numberOfLines={1}>
                          {row.WorkerName || 'Employee not linked'} ·{' '}
                          {row.Time || '—'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.remindButton,
                          (!row.WorkerID || busy) && styles.remindButtonDisabled,
                        ]}
                        onPress={() => void remindDelivery(row)}
                        disabled={!row.WorkerID || busy}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color="#B45309" />
                        ) : (
                          <Text style={styles.remindButtonText}>Remind</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
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
                <TouchableOpacity
                  key={row.DeliveryID || `${row.StopID}-${row.Time}`}
                  style={styles.deliveryCard}
                  onPress={() => setDetailDelivery(row)}
                  activeOpacity={0.85}
                >
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
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={16}
                        color="#94A3B8"
                        style={{ marginTop: 3 }}
                      />
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
                </TouchableOpacity>
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

            {visibleFiles.length === 0 ? (
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
                {visibleFiles.map((file) => {
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

      <Modal
        visible={!!detailDelivery}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailDelivery(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderText}>
                <Text style={styles.detailTitle}>Delivery details</Text>
                <Text style={styles.detailSubtitle}>
                  {formatDateLabel(selectedDate)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.detailClose}
                onPress={() => setDetailDelivery(null)}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={20}
                  color="#475569"
                />
              </TouchableOpacity>
            </View>

            {detailDelivery &&
              (() => {
                const row = detailDelivery;
                const drivePhotos = driveFilesForDelivery(row, files);
                const localPhotos = localPhotosForDelivery(
                  row,
                  pendingUploads
                );
                const photoCount = drivePhotos.length + localPhotos.length;
                const ordersAtStop =
                  parseInt(row.OrderCount || '0', 10) || 0;
                return (
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.detailBody}
                  >
                    <View style={styles.detailInfoCard}>
                      <Text style={styles.detailName}>
                        {row.Name || 'Customer'}
                      </Text>
                      <Text style={styles.detailAddress}>
                        {row.Address || '—'}
                      </Text>
                      <View style={styles.detailChips}>
                        {!!row.Time && (
                          <View style={styles.metaChip}>
                            <MaterialCommunityIcons
                              name="clock-outline"
                              size={10}
                              color="#64748B"
                            />
                            <Text style={styles.metaChipText}>{row.Time}</Text>
                          </View>
                        )}
                        <View style={styles.metaChip}>
                          <MaterialCommunityIcons
                            name="package-variant"
                            size={10}
                            color="#64748B"
                          />
                          <Text style={styles.metaChipText}>
                            {ordersAtStop} order
                            {ordersAtStop === 1 ? '' : 's'}
                          </Text>
                        </View>
                        {!!row.WorkerName && (
                          <View style={styles.metaChip}>
                            <MaterialCommunityIcons
                              name="account-outline"
                              size={10}
                              color="#64748B"
                            />
                            <Text style={styles.metaChipText}>
                              {row.WorkerName}
                            </Text>
                          </View>
                        )}
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
                      {!!row.Notes && (
                        <Text style={styles.detailNotes}>{row.Notes}</Text>
                      )}
                    </View>

                    <View style={styles.detailSectionRow}>
                      <Text style={styles.detailSectionTitle}>
                        Proof photos · {photoCount}
                      </Text>
                      {!!folderUrl && (
                        <TouchableOpacity
                          onPress={() => {
                            void Linking.openURL(folderUrl);
                          }}
                        >
                          <Text style={styles.folderLink}>
                            Open Drive folder
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {photoCount === 0 ? (
                      <View style={styles.detailEmpty}>
                        <MaterialCommunityIcons
                          name="camera-off-outline"
                          size={24}
                          color="#CBD5E1"
                        />
                        <Text style={styles.emptyText}>
                          No proof photo is linked to this delivery yet.
                        </Text>
                        {!!row.WorkerID && (
                          <TouchableOpacity
                            style={styles.detailRemind}
                            onPress={() => void remindDelivery(row)}
                            disabled={!!remindingIds[proofRequestId(row)]}
                          >
                            {remindingIds[proofRequestId(row)] ? (
                              <ActivityIndicator size="small" color="#B45309" />
                            ) : (
                              <MaterialCommunityIcons
                                name="bell-ring-outline"
                                size={14}
                                color="#B45309"
                              />
                            )}
                            <Text style={styles.detailRemindText}>
                              Remind employee
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      <View style={styles.detailPhotoGrid}>
                        {drivePhotos.map((file) => {
                          const uri = thumbs[file.id];
                          return (
                            <TouchableOpacity
                              key={file.id}
                              style={styles.detailPhotoCard}
                              onPress={() => void openFile(file)}
                              activeOpacity={0.85}
                            >
                              {uri ? (
                                <Image
                                  source={{ uri }}
                                  style={styles.detailPhoto}
                                />
                              ) : (
                                <View style={styles.detailPhotoPlaceholder}>
                                  {openingId === file.id ? (
                                    <ActivityIndicator
                                      size="small"
                                      color="#16A34A"
                                    />
                                  ) : (
                                    <MaterialCommunityIcons
                                      name="image-outline"
                                      size={20}
                                      color="#94A3B8"
                                    />
                                  )}
                                </View>
                              )}
                              <Text
                                style={styles.detailPhotoName}
                                numberOfLines={1}
                              >
                                {file.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                        {localPhotos.map((record) => (
                          <TouchableOpacity
                            key={record.id}
                            style={styles.detailPhotoCard}
                            onPress={() => openLocalPhoto(record)}
                            activeOpacity={0.85}
                          >
                            <Image
                              source={{ uri: record.localUri }}
                              style={styles.detailPhoto}
                            />
                            <Text
                              style={styles.detailPhotoName}
                              numberOfLines={1}
                            >
                              Pending upload
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </ScrollView>
                );
              })()}
          </View>
        </View>
      </Modal>

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
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  summaryStats: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  summaryLabel: { fontSize: 8.5, color: '#94A3B8', marginTop: 2 },
  summaryDivider: { width: 1, height: 24, backgroundColor: '#F1F5F9' },
  summaryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  summaryFooterText: {
    fontSize: 9,
    fontWeight: '700',
    marginLeft: 5,
  },
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
  sectionHint: { fontSize: 10, color: '#94A3B8', marginTop: 2 },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  syncButtonText: { fontSize: 10, fontWeight: '800', color: '#15803D' },
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 9,
    marginBottom: 8,
  },
  pendingThumb: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 11.5, fontWeight: '700', color: '#1E293B' },
  pendingAddress: { fontSize: 10, color: '#64748B', marginTop: 1 },
  pendingMeta: { fontSize: 9, color: '#B45309', marginTop: 2 },
  remindAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  remindAllText: { fontSize: 10, fontWeight: '800', color: '#B45309' },
  missingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 9,
    marginBottom: 8,
  },
  missingIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FEF3E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingInfo: { flex: 1 },
  missingName: { fontSize: 11.5, fontWeight: '700', color: '#1E293B' },
  missingAddress: { fontSize: 10, color: '#64748B', marginTop: 1 },
  missingMeta: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  remindButton: {
    backgroundColor: '#FEF3E2',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
    minWidth: 58,
    alignItems: 'center',
  },
  remindButtonDisabled: { opacity: 0.45 },
  remindButtonText: { fontSize: 10, fontWeight: '800', color: '#B45309' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  detailCard: {
    backgroundColor: '#F6F8F7',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 16,
    paddingHorizontal: 16,
    maxHeight: '90%',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  detailHeaderText: { flex: 1 },
  detailTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  detailSubtitle: { fontSize: 10.5, color: '#64748B', marginTop: 2 },
  detailClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBody: { paddingBottom: 32 },
  detailInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 13,
    marginBottom: 12,
  },
  detailName: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  detailAddress: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 15,
  },
  detailChips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  detailNotes: {
    fontSize: 10.5,
    color: '#475569',
    marginTop: 8,
    lineHeight: 15,
  },
  detailSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailSectionTitle: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  detailEmpty: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 22,
  },
  detailRemind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF3E2',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 10,
  },
  detailRemindText: { fontSize: 10, fontWeight: '800', color: '#B45309' },
  detailPhotoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detailPhotoCard: {
    width: '31%',
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  detailPhoto: { width: '100%', height: 96, backgroundColor: '#F1F5F9' },
  detailPhotoPlaceholder: {
    width: '100%',
    height: 96,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPhotoName: { fontSize: 8, color: '#64748B', padding: 5 },
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
