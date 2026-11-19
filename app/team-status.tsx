import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RootState } from '@/redux/store';
import { fetchSheetRows, type SheetRow } from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import { computeWorkerPerformance } from '@/src/utils/attendanceStats';
import { localDateString } from '@/src/utils/attendance';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';
import { getRoleTheme } from '@/assets/constants/roleTheme';

type TeamFilter = 'in' | 'offline' | 'leave';

const FILTER_TITLES: Record<TeamFilter, string> = {
  in: 'Logged in now',
  offline: 'Offline',
  leave: 'On leave',
};

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

export default function TeamStatusScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const user = useSelector((state: RootState) => state.user);

  const filter: TeamFilter =
    params.filter === 'offline' || params.filter === 'leave'
      ? params.filter
      : 'in';

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<SheetRow[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const fetchData = useCallback(async () => {
    if (!sheetId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [workerRows, clockingRows, leaveRows, companySettings] =
        await Promise.all([
          fetchSheetRows(sheetId, 'Workers'),
          fetchSheetRows(sheetId, 'Clockings'),
          fetchSheetRows(sheetId, 'LeaveRequests').catch(() => [] as SheetRow[]),
          readCompanySettings(sheetId),
        ]);
      setWorkers(workerRows);
      setClockings(clockingRows);
      setLeaveRequests(leaveRows);
      setSettings(companySettings);
    } catch (error) {
      console.error('Error loading team status:', error);
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
  const todayClockings = useMemo(
    () => clockings.filter((row) => row.Date === today),
    [clockings, today]
  );

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
  const theme = getRoleTheme(designation, designation === 'employee');

  const activeIds = useMemo(
    () =>
      new Set(
        todayClockings
          .filter((row) => row.ClockIn && !row.ClockOut)
          .map((row) => row.WorkerID)
      ),
    [todayClockings]
  );

  const onLeaveToday = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    const rowsByWorker = new Map<string, SheetRow>();
    leaveRequests.forEach((row) => {
      const status = (row.Status || '').toLowerCase();
      if (status === 'rejected' || status === 'cancelled') return;
      const start = row.StartDate || '';
      const end = row.EndDate || start;
      if (!start || !(start <= today && end >= today)) return;
      if (row.WorkerID) {
        ids.add(row.WorkerID);
        rowsByWorker.set(row.WorkerID, row);
      }
      if (row.Name) names.add(row.Name.trim().toLowerCase());
    });
    return { ids, names, rowsByWorker };
  }, [leaveRequests, today]);

  const isOnLeave = useCallback(
    (worker: SheetRow) =>
      onLeaveToday.ids.has(worker.WorkerID) ||
      onLeaveToday.names.has((worker.Name || '').trim().toLowerCase()),
    [onLeaveToday]
  );

  const teamWorkers = useMemo(
    () => workers.filter((w) => (w.Designation || '').toLowerCase() !== 'admin'),
    [workers]
  );

  const list = useMemo(() => {
    if (filter === 'in') {
      return teamWorkers.filter((w) => activeIds.has(w.WorkerID));
    }
    if (filter === 'leave') {
      return teamWorkers.filter(isOnLeave);
    }
    return teamWorkers.filter(
      (w) => !activeIds.has(w.WorkerID) && !isOnLeave(w)
    );
  }, [filter, teamWorkers, activeIds, isOnLeave]);

  const monthStart = useMemo(() => {
    const now = new Date();
    return localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const performanceFor = useCallback(
    (worker: SheetRow) =>
      computeWorkerPerformance({
        clockings,
        workerId: worker.WorkerID,
        monthStart,
        officeStart: settings.officeStart,
        dailyWorkHours: settings.dailyWorkHours,
        payPerHour: parseFloat(worker.PayPerHour || '0') || 0,
      }),
    [clockings, monthStart, settings]
  );

  const lastClockingFor = useCallback(
    (workerId: string) =>
      clockings
        .filter((row) => row.WorkerID === workerId && row.ClockIn)
        .sort(
          (a, b) =>
            (b.Date || '').localeCompare(a.Date || '') ||
            Number(b._row || 0) - Number(a._row || 0)
        )[0],
    [clockings]
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.loadingText}>Loading team status…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={theme.headerText}
          />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.headerText }]}>
            {FILTER_TITLES[filter]}
          </Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            {list.length} {list.length === 1 ? 'person' : 'people'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
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
      >
        {list.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="account-group-outline"
              size={44}
              color="#CBD5E0"
            />
            <Text style={styles.emptyText}>No one in this category.</Text>
          </View>
        ) : (
          list.map((worker) => {
            const performance = performanceFor(worker);
            const activeRow = todayClockings.find(
              (row) =>
                row.WorkerID === worker.WorkerID &&
                row.ClockIn &&
                !row.ClockOut
            );
            const leaveRow = onLeaveToday.rowsByWorker.get(worker.WorkerID);
            const lastClocking = lastClockingFor(worker.WorkerID);

            return (
              <TouchableOpacity
                key={worker.WorkerID}
                style={styles.card}
                activeOpacity={0.85}
                onPress={() =>
                  router.push(
                    `/worker-details/${worker.WorkerID}` as any
                  )
                }
              >
                <View style={styles.cardTop}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: hashColor(worker.Name) },
                    ]}
                  >
                    <Text style={styles.avatarText}>
                      {initials(worker.Name)}
                    </Text>
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.name}>{worker.Name}</Text>
                    <Text style={styles.role}>
                      {worker.Designation || 'Employee'} ·{' '}
                      {worker.Email || 'no email'}
                    </Text>
                  </View>
                  {filter === 'in' && (
                    <View style={styles.liveChip}>
                      <Text style={styles.liveChipText}>
                        In {activeRow?.ClockIn}
                      </Text>
                    </View>
                  )}
                  {filter === 'leave' && leaveRow && (
                    <View style={styles.leaveChip}>
                      <Text style={styles.leaveChipText}>
                        {leaveRow.StartDate} → {leaveRow.EndDate || leaveRow.StartDate}
                      </Text>
                    </View>
                  )}
                  {filter === 'offline' && lastClocking && (
                    <Text style={styles.lastSeen}>
                      Last: {lastClocking.Date}
                    </Text>
                  )}
                </View>

                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {performance.onTimeRate}%
                    </Text>
                    <Text style={styles.statLabel}>On time</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {performance.hoursWorked.toFixed(1)}h
                    </Text>
                    <Text style={styles.statLabel}>Hours</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      {performance.lateCount}
                    </Text>
                    <Text style={styles.statLabel}>Late</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>
                      ${performance.pay.toFixed(0)}
                    </Text>
                    <Text style={styles.statLabel}>Pay</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F8F7',
  },
  loadingText: { marginTop: 12, color: '#64748B', fontSize: 13 },
  header: {
    paddingTop: 58,
    paddingBottom: 18,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  headerText: { flex: 1, marginLeft: 12 },
  headerSpacer: { width: 36 },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 3 },
  content: { padding: 16, paddingBottom: 60 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  cardInfo: { flex: 1 },
  name: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  role: { fontSize: 11, color: '#64748B', marginTop: 2 },
  liveChip: {
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveChipText: { fontSize: 10, fontWeight: '700', color: '#15803D' },
  leaveChip: {
    backgroundColor: '#FEF3E2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  leaveChipText: { fontSize: 9, fontWeight: '700', color: '#B45309' },
  lastSeen: { fontSize: 10, color: '#94A3B8' },
  statsRow: {
    flexDirection: 'row',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  statLabel: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { marginTop: 10, fontSize: 12, color: '#94A3B8' },
});
