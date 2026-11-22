import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  Linking,
  Image,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { setFolderId, setSheetId } from '@/redux/store/userSlice';
import { updateUserDriveFolder } from '@/assets/services/firebaseService';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  fetchSheetRows,
  getGoogleAccessToken,
  ensurePublicReadAccess,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  effectiveDesignation,
  ensureWorkerEditAccess,
  findMyWorkerRow,
  rowHasEditAccess,
  rowHasReadAccess,
  setWorkerEditAccess,
  setWorkerReadAccess,
  updateWorkerFields,
} from '@/src/utils/workerManagement';
import { localDateString } from '@/src/utils/attendance';
import { buildWorkerJoinLink } from '@/src/utils/joinLink';
import { findExistingWorkspaceSheet } from '@/src/utils/workspace';
import DesignationDropdown from '@/components/DesignationDropdown';
import AddWorkerModal from '@/components/AddWorkerModal';

type Filter = 'all' | 'active' | 'off';

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function hashColor(name = '') {
  const palette = ['#00AF5B', '#2563EB', '#F59E0B', '#8B5CF6', '#EC4899', '#0EA5E9'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

export default function WorkersScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const params = useLocalSearchParams<{ filter?: string }>();
  const user = useSelector((state: RootState) => state.user);
  const companyName =
    user.profile?.companyName || user.workerProfile?.companyName || 'Workforce';

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(
    params.filter === 'active' ? 'active' : 'all'
  );

  useEffect(() => {
    if (params.filter === 'active') setFilter('active');
  }, [params.filter]);
  const [busyWorker, setBusyWorker] = useState<string | null>(null);
  const [addWorkerVisible, setAddWorkerVisible] = useState(false);

  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const currentWorkerId = user.workerProfile?.workerId;
  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        currentWorkerId,
        user.email || user.workerProfile?.email
      ),
    [workers, currentWorkerId, user.email, user.workerProfile?.email]
  );

  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const isEmployee = !isAdmin && !isManager;
  const theme = getRoleTheme(designation, isEmployee);

  const fetchData = useCallback(async () => {
    if (!sheetId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [workerRows, clockingRows] = await Promise.all([
        fetchSheetRows(sheetId, 'Workers'),
        fetchSheetRows(sheetId, 'Clockings'),
      ]);
      setWorkers(workerRows);
      setClockings(clockingRows);
    } catch (error) {
      console.error('Error fetching workers:', error);
      Alert.alert('Error', 'Unable to load the team directory.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sheetId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const today = localDateString();

  const statusFor = useCallback(
    (workerId: string) => {
      const row = clockings.find(
        (clocking) =>
          clocking.WorkerID === workerId && clocking.Date === today
      );
      if (!row) return { label: 'Off', active: false, clockIn: '' };
      if (row.ClockIn && !row.ClockOut)
        return { label: 'Active', active: true, clockIn: row.ClockIn };
      return { label: 'Done', active: false, clockIn: row.ClockIn };
    },
    [clockings, today]
  );

  const monthlyHours = useCallback(
    (workerId: string) => {
      const now = new Date();
      return clockings
        .filter((row) => {
          if (row.WorkerID !== workerId || !row.Date) return false;
          const date = new Date(row.Date);
          return (
            date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear()
          );
        })
        .reduce(
          (total, row) => total + (parseFloat(row.HoursWorked || '0') || 0),
          0
        );
    },
    [clockings]
  );

  const filteredWorkers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return workers.filter((worker) => {
      const matchesQuery =
        !query ||
        worker.Name?.toLowerCase().includes(query) ||
        worker.Email?.toLowerCase().includes(query) ||
        worker.Phone?.includes(query) ||
        worker.WorkerID?.toLowerCase().includes(query);
      if (!matchesQuery) return false;
      if (filter === 'all') return true;
      const status = statusFor(worker.WorkerID);
      return filter === 'active' ? status.active : !status.active;
    });
  }, [workers, search, filter, statusFor]);

  const activeCount = useMemo(
    () =>
      workers.filter((worker) => statusFor(worker.WorkerID).active).length,
    [workers, statusFor]
  );

  const handleToggleAccess = (worker: SheetRow) => {
    const enabled = rowHasEditAccess(worker);
    Alert.alert(
      enabled ? 'Revoke edit access?' : 'Grant edit access?',
      enabled
        ? `${worker.Name} will no longer be able to edit team data in the app. Clock-in and clock-out will still work.`
        : `${worker.Name} will be able to edit team data in the app. The sheet is already shared as Editor, so clock-in keeps working.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: enabled ? 'Revoke' : 'Grant',
          style: enabled ? 'destructive' : 'default',
          onPress: async () => {
            setBusyWorker(worker.WorkerID);
            try {
              const token = await getGoogleAccessToken(true);
              if (!token) {
                throw new Error('Sign in with Google to manage access.');
              }
              const result = await setWorkerEditAccess(
                sheetId,
                token,
                { workerId: worker.WorkerID, email: worker.Email },
                !enabled
              );
              setWorkers((prev) =>
                prev.map((row) =>
                  row.WorkerID === worker.WorkerID
                    ? { ...row, EditAccess: enabled ? 'false' : 'true' }
                    : row
                )
              );
              if (!result.driveUpdated) {
                Alert.alert(
                  'Sheet updated',
                  `Access flag saved, but Drive sharing could not be updated${
                    result.driveError ? `: ${result.driveError}` : '.'
                  }`
                );
              }
            } catch (error: any) {
              Alert.alert('Access update failed', error?.message || 'Try again.');
            } finally {
              setBusyWorker(null);
            }
          },
        },
      ]
    );
  };

  const handleToggleReadAccess = (worker: SheetRow) => {
    const enabled = rowHasReadAccess(worker);
    Alert.alert(
      enabled ? 'Revoke read access?' : 'Grant read access?',
      enabled
        ? `${worker.Name} will no longer be able to view other workers' details.`
        : `${worker.Name} will be able to view every worker's details (read only).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: enabled ? 'Revoke' : 'Grant',
          style: enabled ? 'destructive' : 'default',
          onPress: async () => {
            setBusyWorker(worker.WorkerID);
            try {
              const token = await getGoogleAccessToken(true);
              if (!token) {
                throw new Error('Sign in with Google to manage access.');
              }
              await setWorkerReadAccess(
                sheetId,
                token,
                { workerId: worker.WorkerID, email: worker.Email },
                !enabled
              );
              setWorkers((prev) =>
                prev.map((row) =>
                  row.WorkerID === worker.WorkerID
                    ? { ...row, ReadAccess: enabled ? 'false' : 'true' }
                    : row
                )
              );
            } catch (error: any) {
              Alert.alert('Access update failed', error?.message || 'Try again.');
            } finally {
              setBusyWorker(null);
            }
          },
        },
      ]
    );
  };

  const handleChangeDesignation = async (worker: SheetRow, next: string) => {
    if (!isAdmin || !sheetId) return;
    setBusyWorker(worker.WorkerID);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        throw new Error('Sign in with Google to change designation.');
      }
      await updateWorkerFields(
        sheetId,
        token,
        { workerId: worker.WorkerID, email: worker.Email },
        { Designation: next }
      );
      setWorkers((prev) =>
        prev.map((row) =>
          row.WorkerID === worker.WorkerID
            ? { ...row, Designation: next }
            : row
        )
      );
    } catch (error: any) {
      Alert.alert(
        'Designation update failed',
        error?.message || 'Try again.'
      );
    } finally {
      setBusyWorker(null);
    }
  };

  const handleShareWorker = async (worker: SheetRow) => {
    if (!sheetId || !worker.WorkerID) {
      Alert.alert('Cannot share', 'This worker does not have a WorkerID yet.');
      return;
    }

    const workerEmail = (worker.Email || '').trim().toLowerCase();
    if (!workerEmail) {
      Alert.alert(
        'Cannot share',
        'Add the worker Google email to the Workers sheet first, then share.'
      );
      return;
    }

    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        Alert.alert(
          'Sign in with Google',
          'Sign in with Google so the worker can be granted access.'
        );
        return;
      }

      // 1. Verify the exact spreadsheet this list came from is readable. If
      //    the stored id is stale (for example a single-character typo), find
      //    the real sheet in Drive and repair Redux + Firestore before sharing.
      let activeSheetId = sheetId;
      let activeFolderId = user.folderId || user.profile?.folderId || '';
      const sheetCheck = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${activeSheetId}?fields=spreadsheetId`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!sheetCheck.ok) {
        console.warn('[Share] Stored sheet unavailable, searching Drive:', activeSheetId);
        const repaired = await findExistingWorkspaceSheet({
          accessToken: token,
          companyName: user.profile?.companyName || companyName,
          folderId: activeFolderId,
        });
        if (!repaired.sheetId) {
          Alert.alert(
            'Workspace unavailable',
            'This worker list is not linked to a readable spreadsheet and the real sheet could not be found. Sign out and sign in again to repair the workspace.'
          );
          return;
        }
        activeSheetId = repaired.sheetId;
        activeFolderId = repaired.folderId || activeFolderId;
        dispatch(setSheetId(activeSheetId));
        if (activeFolderId) dispatch(setFolderId(activeFolderId));
        if (user.uid) {
          await updateUserDriveFolder(user.uid, activeFolderId, {
            email: user.email || '',
            name: user.name || '',
            companyName: user.profile?.companyName || companyName,
            companyAddress: user.profile?.companyAddress,
            companyPhone: user.profile?.companyPhone,
            companyEmail: user.profile?.companyEmail,
            sheetId: activeSheetId,
          });
        }
        console.log('[Share] Repaired sheet id →', activeSheetId);
      }

      // 2. Grant this worker's exact Google email EDITOR access BEFORE sharing,
      //    so clock-in/out can be saved to the sheet. In-app editing is still
      //    controlled by the EditAccess flag below.
      const access = await ensureWorkerEditAccess(activeSheetId, token, workerEmail);
      if (!access.shared) {
        Alert.alert(
          'Cannot grant access',
          `Google could not grant ${workerEmail} edit access${
            access.error ? `: ${access.error}` : '.'
          } Fix the worker email or share the sheet with that email as Editor, then try again.`
        );
        return;
      }

      // 3. Keep public link access working as a fallback for older installs.
      await ensurePublicReadAccess(activeSheetId, token);

      const link = buildWorkerJoinLink({
        sheetId: activeSheetId,
        workerId: worker.WorkerID,
        companyId: user.uid,
      });
      console.log(
        '[Share] Worker invite → sheet:',
        activeSheetId,
        '| worker:',
        worker.WorkerID,
        '| email:',
        workerEmail,
        '| access granted'
      );

      const message = [
        `Hi ${worker.Name || 'there'},`,
        '',
        `You have been invited to ${companyName} on WorkForce.`,
        'Open the app, paste this link into the "Join link" box on the login screen, and verify your details to see your personal data:',
        '',
        link,
      ].join('\n');

      await Share.share({ title: `${companyName} invite`, message });
    } catch (error: any) {
      Alert.alert(
        'Share failed',
        error?.message || 'Could not complete sharing. Please try again.'
      );
    }
  };

  const renderManagerCard = ({ item }: { item: SheetRow }) => {
    const status = statusFor(item.WorkerID);
    const canToggle = isAdmin;
    const hasAccess = rowHasEditAccess(item);

    return (
      <TouchableOpacity
        style={styles.workerCard}
        activeOpacity={0.85}
        onPress={() => router.push(`/worker-details/${item.WorkerID}`)}
      >
        <View style={styles.cardTop}>
          {item.PhotoURL ? (
            <Image source={{ uri: item.PhotoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: hashColor(item.Name) }]}>
              <Text style={styles.avatarText}>{initials(item.Name)}</Text>
            </View>
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.workerName}>{item.Name}</Text>
            <View style={styles.roleRow}>
              <DesignationDropdown
                value={item.Designation}
                editable={
                  isAdmin &&
                  (item.Designation || '').toLowerCase() !== 'admin'
                }
                onChange={(next) => handleChangeDesignation(item, next)}
                accent={theme.accent}
              />
              <Text style={styles.workerIdText}> · {item.WorkerID}</Text>
            </View>
            <View style={styles.contactRow}>
              {!!item.Phone && (
                <TouchableOpacity
                  style={styles.contactChip}
                  onPress={() => Linking.openURL(`tel:${item.Phone}`)}
                >
                  <MaterialCommunityIcons name="phone" size={12} color={theme.accent} />
                  <Text style={styles.contactChipText}>{item.Phone}</Text>
                </TouchableOpacity>
              )}
              {!!item.Email && (
                <TouchableOpacity
                  style={styles.contactChip}
                  onPress={() => Linking.openURL(`mailto:${item.Email}`)}
                >
                  <MaterialCommunityIcons name="email" size={12} color={theme.accent} />
                  <Text style={styles.contactChipText} numberOfLines={1}>
                    {item.Email}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: status.active ? '#DCFCE7' : '#F1F5F9' },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: status.active ? '#22C55E' : '#CBD5E0' },
              ]}
            />
            <Text
              style={[
                styles.statusPillText,
                { color: status.active ? '#15803D' : '#64748B' },
              ]}
            >
              {status.label}
            </Text>
          </View>
        </View>

        {!!item.Bio && <Text style={styles.bio}>{item.Bio}</Text>}

        <View style={styles.cardFooter}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {monthlyHours(item.WorkerID).toFixed(1)}h
            </Text>
            <Text style={styles.metricLabel}>This month</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              ${parseFloat(item.PayPerHour || '0').toFixed(0)}
            </Text>
            <Text style={styles.metricLabel}>Per hour</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>
              {status.clockIn || '--:--'}
            </Text>
            <Text style={styles.metricLabel}>Clock in</Text>
          </View>

          {isAdmin && (item.Designation || '').toLowerCase() !== 'admin' && (
            <TouchableOpacity
              style={[
                styles.shareButton,
                {
                  backgroundColor: rowHasReadAccess(item)
                    ? '#DCFCE7'
                    : theme.accentSoft,
                  borderColor: rowHasReadAccess(item)
                    ? '#86EFAC'
                    : theme.accentBorder,
                },
              ]}
              onPress={() => handleToggleReadAccess(item)}
              disabled={busyWorker === item.WorkerID}
              accessibilityRole="button"
              accessibilityLabel={`Toggle read access for ${item.Name}`}
            >
              <MaterialCommunityIcons
                name={
                  rowHasReadAccess(item)
                    ? 'book-open-variant'
                    : 'book-open-outline'
                }
                size={15}
                color={
                  rowHasReadAccess(item) ? '#15803D' : theme.accentDark
                }
              />
            </TouchableOpacity>
          )}

          {isAdmin && (item.Designation || '').toLowerCase() !== 'admin' && (
            <TouchableOpacity
              style={[
                styles.shareButton,
                {
                  backgroundColor: theme.accentSoft,
                  borderColor: theme.accentBorder,
                },
              ]}
              onPress={() => handleShareWorker(item)}
              accessibilityRole="button"
              accessibilityLabel={`Share invite link for ${item.Name}`}
            >
              <MaterialCommunityIcons
                name="share-variant"
                size={15}
                color={theme.accentDark}
              />
            </TouchableOpacity>
          )}

          {canToggle && (
            <TouchableOpacity
              style={[
                styles.accessButton,
                {
                  backgroundColor: hasAccess ? '#DCFCE7' : theme.accentSoft,
                  borderColor: hasAccess ? '#86EFAC' : theme.accentBorder,
                },
              ]}
              onPress={() => handleToggleAccess(item)}
              disabled={busyWorker === item.WorkerID}
            >
              {busyWorker === item.WorkerID ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={hasAccess ? 'pencil-lock' : 'pencil-outline'}
                    size={14}
                    color={hasAccess ? '#15803D' : theme.accentDark}
                  />
                  <Text
                    style={[
                      styles.accessButtonText,
                      { color: hasAccess ? '#15803D' : theme.accentDark },
                    ]}
                  >
                    {hasAccess ? 'Edit on' : 'Edit'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderContactCard = ({ item }: { item: SheetRow }) => (
    <TouchableOpacity
      style={styles.contactCard}
      activeOpacity={1}
      disabled
    >
      {item.PhotoURL ? (
        <Image source={{ uri: item.PhotoURL }} style={styles.contactAvatar} />
      ) : (
        <View
          style={[
            styles.contactAvatar,
            { backgroundColor: hashColor(item.Name) },
          ]}
        >
          <Text style={styles.contactAvatarText}>{initials(item.Name)}</Text>
        </View>
      )}
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.Name}</Text>
        <DesignationDropdown value={item.Designation} editable={false} />
        <Text style={styles.contactDetail} numberOfLines={1}>
          {item.Email || 'No email'}
        </Text>
        <Text style={styles.contactDetail}>{item.Phone || 'No phone'}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.loadingText}>Loading team directory…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.headerText }]}>
              {isEmployee ? 'Team Directory' : 'Workers'}
            </Text>
            <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
              {isEmployee
                ? 'Contact anyone on your team'
                : `${workers.length} people · ${activeCount} clocked in now`}
            </Text>
          </View>
          {isAdmin && (
            <TouchableOpacity
              style={[styles.headerButton, { backgroundColor: theme.accent }]}
              onPress={() => setAddWorkerVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Add new worker"
            >
              <MaterialCommunityIcons name="plus" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={18} color="#64748B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, phone or email"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {!isEmployee && (
        <View style={styles.filterRow}>
          {(['all', 'active', 'off'] as Filter[]).map((option) => {
            const active = filter === option;
            return (
              <TouchableOpacity
                key={option}
                style={[
                  styles.filterButton,
                  active && { backgroundColor: theme.accent },
                ]}
                onPress={() => setFilter(option)}
              >
                <Text
                  style={[
                    styles.filterText,
                    active && { color: '#fff' },
                  ]}
                >
                  {option === 'all'
                    ? 'Everyone'
                    : option === 'active'
                    ? 'Clocked in'
                    : 'Off'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <FlatList
        data={filteredWorkers}
        renderItem={isEmployee ? renderContactCard : renderManagerCard}
        keyExtractor={(item) => item.WorkerID || item.Email || item._row!.toString()}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchData();
            }}
            colors={[theme.accent]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="account-search" size={48} color="#CBD5E0" />
            <Text style={styles.emptyText}>
              {workers.length === 0
                ? 'No team members yet'
                : 'No one matches this search'}
            </Text>
          </View>
        }
      />

      <AddWorkerModal
        visible={addWorkerVisible}
        onClose={() => setAddWorkerVisible(false)}
        onCreated={fetchData}
        sheetId={sheetId}
        accent={theme.accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: { flex: 1, paddingRight: 12 },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 26, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 4, marginBottom: 14 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13, color: '#1E293B' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginRight: 8,
  },
  filterText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  listContainer: { padding: 16, paddingBottom: 100 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F6F8F7',
  },
  loadingText: { marginTop: 12, color: '#64748B', fontSize: 13 },
  workerCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  cardInfo: { flex: 1, paddingRight: 6 },
  workerName: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  roleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  workerIdText: { fontSize: 10, color: '#94A3B8', marginLeft: 2 },
  workerRole: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  contactChipText: {
    fontSize: 10,
    color: '#475569',
    marginLeft: 3,
    maxWidth: 130,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  bio: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginTop: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
    marginTop: 10,
  },
  metric: { marginRight: 16 },
  metricValue: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  metricLabel: { fontSize: 9, color: '#94A3B8', marginTop: 1 },
  shareButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  accessButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  accessButtonText: { fontSize: 10, fontWeight: '700', marginLeft: 4 },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  contactAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  contactInfo: { flex: 1, marginLeft: 12 },
  contactName: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  contactDetail: { fontSize: 12, color: '#64748B', marginTop: 2 },
  contactEditIcon: { marginLeft: 8 },
  contactRole: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  contactLine: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  contactLineText: {
    fontSize: 12,
    color: '#475569',
    marginLeft: 6,
    flex: 1,
  },
  contactActions: { marginLeft: 8 },
  roundAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { marginTop: 12, color: '#94A3B8', fontSize: 13 },
});
