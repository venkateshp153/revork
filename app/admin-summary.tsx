import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  computeHoursWorked,
  localDateString,
} from '@/src/utils/attendance';
import { computeWorkerPerformance } from '@/src/utils/attendanceStats';
import {
  getGoogleAccessToken,
  fetchSheetRows,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  saveCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function rowHours(row: SheetRow): number {
  if (row.ClockOut) return parseFloat(row.HoursWorked || '0') || 0;
  // Only today's open session runs on the clock; a forgotten previous-day
  // clock-out must not inflate weekly/monthly totals.
  if ((row.Date || '') !== localDateString()) {
    return parseFloat(row.HoursWorked || '0') || 0;
  }
  return computeHoursWorked(
    row.ClockIn,
    null,
    parseFloat(row.BreakMins || '0') || 0
  );
}

export default function AdminSummaryScreen() {
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<SheetRow[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [draftStart, setDraftStart] = useState(settings.officeStart);
  const [draftEnd, setDraftEnd] = useState(settings.officeEnd);
  const [draftHours, setDraftHours] = useState(`${settings.dailyWorkHours}`);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchData = useCallback(
    async (showSpinner = false) => {
      if (!sheetId) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (showSpinner) setRefreshing(true);
      try {
        const [workerRows, clockingRows, leaveRows, companySettings] =
          await Promise.all([
            fetchSheetRows(sheetId, 'Workers').catch(() => [] as SheetRow[]),
            fetchSheetRows(sheetId, 'Clockings').catch(() => [] as SheetRow[]),
            fetchSheetRows(sheetId, 'LeaveRequests').catch(
              () => [] as SheetRow[]
            ),
            readCompanySettings(sheetId),
          ]);
        setWorkers(workerRows);
        setClockings(clockingRows);
        setLeaveRequests(leaveRows);
        setSettings(companySettings);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sheetId]
  );

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData])
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
  const isAdmin = designation === 'admin';
  const theme = getRoleTheme(designation, false);

  const today = localDateString();
  const teamWorkers = useMemo(
    () => workers.filter((w) => (w.Designation || '').toLowerCase() !== 'admin'),
    [workers]
  );
  const teamIds = useMemo(
    () => new Set(teamWorkers.map((worker) => worker.WorkerID).filter(Boolean)),
    [teamWorkers]
  );

  const todayClockings = useMemo(
    () =>
      clockings.filter(
        (row) => row.Date === today && teamIds.has(row.WorkerID)
      ),
    [clockings, today, teamIds]
  );

  /** Per-person in/out summary for today. */
  const todaysActivity = useMemo(() => {
    const grouped: Record<
      string,
      {
        workerId: string;
        name: string;
        firstIn: string;
        lastOut: string;
        active: boolean;
      }
    > = {};

    todayClockings
      .filter((row) => row.ClockIn)
      .forEach((row) => {
        const entry =
          grouped[row.WorkerID] ||
          (grouped[row.WorkerID] = {
            workerId: row.WorkerID,
            name: row.Name || row.WorkerID,
            firstIn: row.ClockIn,
            lastOut: '',
            active: false,
          });
        if (!entry.firstIn || row.ClockIn < entry.firstIn) {
          entry.firstIn = row.ClockIn;
        }
        if (!row.ClockOut) entry.active = true;
        if (row.ClockOut && row.ClockOut > entry.lastOut) {
          entry.lastOut = row.ClockOut;
        }
      });

    return Object.values(grouped);
  }, [todayClockings]);

  /** Every employee, so the admin sees who has and hasn't clocked in. */
  const roster = useMemo(() => {
    const byWorker = new Map(todaysActivity.map((entry) => [entry.workerId, entry]));
    return teamWorkers
      .map((worker) => {
        const entry = byWorker.get(worker.WorkerID) || null;
        return {
          workerId: worker.WorkerID,
          name: worker.Name || worker.WorkerID,
          role: worker.Designation || 'Employee',
          entry,
          active: !!entry?.active,
        };
      })
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [teamWorkers, todaysActivity]);

  const weekStart = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    return localDateString(monday);
  }, []);

  const monthStart = useMemo(() => {
    const now = new Date();
    return localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const teamClockings = useMemo(
    () => clockings.filter((row) => teamIds.has(row.WorkerID) && row.ClockIn),
    [clockings, teamIds]
  );

  const teamWeekHours = useMemo(
    () =>
      teamClockings
        .filter((row) => row.Date >= weekStart)
        .reduce((sum, row) => sum + rowHours(row), 0),
    [teamClockings, weekStart]
  );

  const teamMonthHours = useMemo(
    () =>
      teamClockings
        .filter((row) => row.Date >= monthStart)
        .reduce((sum, row) => sum + rowHours(row), 0),
    [teamClockings, monthStart]
  );

  const weekSessions = useMemo(
    () =>
      teamClockings.filter(
        (row) => row.Date >= weekStart && !!row.ClockIn
      ),
    [teamClockings, weekStart]
  );

  const onTimeRate = useMemo(() => {
    if (weekSessions.length === 0) return 0;
    const onTime = weekSessions.filter(
      (row) => row.ClockIn <= settings.officeStart
    ).length;
    return Math.round((onTime / weekSessions.length) * 100);
  }, [weekSessions, settings.officeStart]);

  const lateCount = useMemo(
    () =>
      weekSessions.filter(
        (row) => row.ClockIn > settings.officeStart
      ).length,
    [weekSessions, settings.officeStart]
  );

  const avgWeekDayHours = useMemo(() => {
    const days = new Set(weekSessions.map((row) => row.Date)).size;
    return days > 0 ? teamWeekHours / days : 0;
  }, [weekSessions, teamWeekHours]);

  const teamLeaveCount = useMemo(() => {
    const monthPrefix = today.slice(0, 7);
    return leaveRequests.filter((row) => {
      const status = (row.Status || '').toLowerCase();
      if (status === 'rejected' || status === 'cancelled') return false;
      const start = row.StartDate || '';
      const end = row.EndDate || start;
      return start.startsWith(monthPrefix) || end.startsWith(monthPrefix);
    }).length;
  }, [leaveRequests, today]);

  const last7Days = useMemo(() => {
    const days: { label: string; hours: number; date: string }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = localDateString(date);
      const hours = teamClockings
        .filter((row) => row.Date === key)
        .reduce((sum, row) => sum + rowHours(row), 0);
      days.push({
        label: WEEKDAY_LABELS[date.getDay()],
        hours,
        date: key,
      });
    }
    return days;
  }, [teamClockings]);

  const maxDayHours = Math.max(...last7Days.map((day) => day.hours), 1);

  const teamMonthPay = useMemo(
    () =>
      teamWorkers.reduce((sum, worker) => {
        const performance = computeWorkerPerformance({
          clockings,
          workerId: worker.WorkerID,
          monthStart,
          officeStart: settings.officeStart,
          dailyWorkHours: settings.dailyWorkHours,
          payPerHour: parseFloat(worker.PayPerHour || '0') || 0,
        });
        return sum + performance.pay;
      }, 0),
    [teamWorkers, clockings, monthStart, settings]
  );

  const activeNowCount = roster.filter((person) => person.active).length;
  const notClockedInCount = roster.filter(
    (person) => !person.active && !person.entry
  ).length;
  const clockedOutCount = roster.length - activeNowCount - notClockedInCount;

  const openSettings = () => {
    setDraftStart(settings.officeStart);
    setDraftEnd(settings.officeEnd);
    setDraftHours(`${settings.dailyWorkHours}`);
    setSettingsVisible(true);
  };

  const saveSettings = async () => {
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const hours = parseFloat(draftHours);
    if (!timePattern.test(draftStart) || !timePattern.test(draftEnd)) {
      Alert.alert('Invalid time', 'Use 24-hour times like 09:00 and 17:00.');
      return;
    }
    if (!hours || hours <= 0 || hours > 24) {
      Alert.alert('Invalid hours', 'Daily work hours must be between 0 and 24.');
      return;
    }
    setSavingSettings(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) throw new Error('Sign in with Google to change settings.');
      const next: CompanySettings = {
        ...settings,
        officeStart: draftStart,
        officeEnd: draftEnd,
        dailyWorkHours: hours,
      };
      await saveCompanySettings(sheetId, token, next);
      setSettings(next);
      setSettingsVisible(false);
      Alert.alert('Saved', 'Office timings and work hours updated.');
    } catch (error: any) {
      Alert.alert('Unable to save', error?.message || 'Try again.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (!loading && !isAdmin) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="lock-outline" size={40} color="#94A3B8" />
        <Text style={styles.emptyTitle}>Admin access only</Text>
        <Text style={styles.emptyText}>
          Only admins can open the team summary.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.headerText }]}>Summary</Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            Performance, office hours & today&apos;s activity
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => void fetchData(true)}
          disabled={refreshing}
          accessibilityLabel="Refresh summary"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.headerText} />
          ) : (
            <MaterialCommunityIcons
              name="refresh"
              size={20}
              color={theme.headerText}
            />
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.loadingText}>Loading summary…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void fetchData(true)}
              colors={[theme.accent]}
            />
          }
        >
          {/* Weekly / monthly totals */}
          <View style={styles.totalsRow}>
            <View style={styles.totalCard}>
              <View style={[styles.totalIcon, { backgroundColor: '#E8F0FE' }]}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={19}
                  color="#2563EB"
                />
              </View>
              <Text style={styles.totalValue}>{teamWeekHours.toFixed(1)}h</Text>
              <Text style={styles.totalLabel}>This week</Text>
            </View>
            <View style={styles.totalCard}>
              <View style={[styles.totalIcon, { backgroundColor: '#FEF3E2' }]}>
                <MaterialCommunityIcons
                  name="timer-outline"
                  size={19}
                  color="#D97706"
                />
              </View>
              <Text style={styles.totalValue}>{teamMonthHours.toFixed(1)}h</Text>
              <Text style={styles.totalLabel}>This month</Text>
            </View>
            <View style={styles.totalCard}>
              <View style={[styles.totalIcon, { backgroundColor: '#DCFCE7' }]}>
                <MaterialCommunityIcons
                  name="cash"
                  size={19}
                  color="#15803D"
                />
              </View>
              <Text style={styles.totalValue}>
                ${teamMonthPay.toFixed(0)}
              </Text>
              <Text style={styles.totalLabel}>Month pay</Text>
            </View>
          </View>

          {/* Performance */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Performance</Text>
              <Text style={styles.sectionSubtitle}>Team · last 7 days</Text>
            </View>
            <View style={[styles.monthChip, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.monthChipText, { color: theme.accentDark }]}>
                {last7Days.reduce((sum, day) => sum + day.hours, 0).toFixed(1)} h
              </Text>
            </View>
          </View>
          <View style={styles.performanceCard}>
            <View style={styles.performanceHeader}>
              <Text style={styles.performanceLabel}>Hours per day</Text>
              <Text style={styles.performanceHint}>
                Office {settings.officeStart}–{settings.officeEnd}
              </Text>
            </View>
            <View style={styles.barsRow}>
              {last7Days.map((day) => (
                <View key={day.date} style={styles.barColumn}>
                  <Text style={styles.barValue}>
                    {day.hours > 0 ? day.hours.toFixed(1) : ''}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: `${Math.max(
                            6,
                            (day.hours / maxDayHours) * 100
                          )}%`,
                          backgroundColor: theme.accent,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel}>{day.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.performanceFooter}>
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>{onTimeRate}%</Text>
                <Text style={styles.performanceStatLabel}>On time</Text>
              </View>
              <View style={styles.performanceDivider} />
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>
                  {avgWeekDayHours.toFixed(1)}h
                </Text>
                <Text style={styles.performanceStatLabel}>Avg / day</Text>
              </View>
              <View style={styles.performanceDivider} />
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>{lateCount}</Text>
                <Text style={styles.performanceStatLabel}>Late clock-ins</Text>
              </View>
              <View style={styles.performanceDivider} />
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>{teamLeaveCount}</Text>
                <Text style={styles.performanceStatLabel}>Leaves</Text>
              </View>
            </View>
          </View>

          {/* Office timings */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Office timings</Text>
              <Text style={styles.sectionSubtitle}>
                Used for on-time stats and expected hours
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.editButton, { backgroundColor: theme.accentSoft }]}
              onPress={openSettings}
            >
              <MaterialCommunityIcons
                name="pencil-outline"
                size={14}
                color={theme.accentDark}
              />
              <Text style={[styles.editButtonText, { color: theme.accentDark }]}>
                Edit
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.settingsCard}>
            <View style={styles.settingsItem}>
              <Text style={styles.settingsLabel}>Start</Text>
              <Text style={styles.settingsValue}>{settings.officeStart}</Text>
            </View>
            <View style={styles.settingsDivider} />
            <View style={styles.settingsItem}>
              <Text style={styles.settingsLabel}>End</Text>
              <Text style={styles.settingsValue}>{settings.officeEnd}</Text>
            </View>
            <View style={styles.settingsDivider} />
            <View style={styles.settingsItem}>
              <Text style={styles.settingsLabel}>Per day</Text>
              <Text style={styles.settingsValue}>
                {settings.dailyWorkHours} h
              </Text>
            </View>
          </View>

          {/* Today's activity */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Today&apos;s activity</Text>
              <Text style={styles.sectionSubtitle}>
                {activeNowCount} working · {clockedOutCount} clocked out ·{' '}
                {notClockedInCount} not in
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/workers')}
              accessibilityLabel="View teams"
            >
              <Text style={[styles.viewTeamsLink, { color: theme.accent }]}>
                View teams
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.peopleGrid}>
            {roster.length === 0 ? (
              <Text style={[styles.emptyText, styles.emptyGridText]}>
                No employees found. Add employees from the Workers tab.
              </Text>
            ) : (
              roster.map((person) => (
                <View
                  key={person.workerId}
                  style={[
                    styles.personBlock,
                    person.active && styles.personBlockActive,
                  ]}
                >
                  <View style={styles.personTop}>
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor: person.active
                            ? '#16A34A'
                            : person.entry
                            ? '#F59E0B'
                            : '#CBD5E1',
                        },
                      ]}
                    />
                    <Text style={styles.personName} numberOfLines={1}>
                      {person.name}
                    </Text>
                  </View>
                  <Text style={styles.personRole} numberOfLines={1}>
                    {person.role}
                  </Text>
                  <Text style={styles.personTimes}>
                    In {person.entry?.firstIn || '--:--'} · Out{' '}
                    {person.entry?.lastOut || '--:--'}
                  </Text>
                  <Text
                    style={[
                      styles.personState,
                      {
                        color: person.active
                          ? '#15803D'
                          : person.entry
                          ? '#B45309'
                          : '#94A3B8',
                      },
                    ]}
                  >
                    {person.active
                      ? 'Working now'
                      : person.entry
                      ? 'Clocked out'
                      : 'Not clocked in'}
                  </Text>
                </View>
              ))
            )}
          </View>

          <TouchableOpacity
            style={[styles.viewTeamsButton, { backgroundColor: theme.accent }]}
            onPress={() => router.push('/(tabs)/workers')}
          >
            <MaterialCommunityIcons
              name="account-group-outline"
              size={18}
              color="#fff"
            />
            <Text style={styles.viewTeamsButtonText}>View teams</Text>
          </TouchableOpacity>

          <View style={styles.footerNote}>
            <MaterialCommunityIcons
              name="information-outline"
              size={13}
              color="#94A3B8"
            />
            <Text style={styles.footerNoteText}>
              Hours include open sessions in real time. A green dot means the
              employee is currently clocked in.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Office timings editor */}
      <Modal
        visible={settingsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !savingSettings && setSettingsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Office timings</Text>
            <Text style={styles.modalHint}>
              Used for on-time stats, expected hours and payroll insights.
            </Text>

            <Text style={styles.modalLabel}>Office start (HH:MM)</Text>
            <TextInput
              style={styles.modalInput}
              value={draftStart}
              onChangeText={setDraftStart}
              placeholder="09:00"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.modalLabel}>Office end (HH:MM)</Text>
            <TextInput
              style={styles.modalInput}
              value={draftEnd}
              onChangeText={setDraftEnd}
              placeholder="17:00"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.modalLabel}>Daily work hours</Text>
            <TextInput
              style={styles.modalInput}
              value={draftHours}
              onChangeText={setDraftHours}
              keyboardType="numeric"
              placeholder="8"
              placeholderTextColor="#94A3B8"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setSettingsVisible(false)}
                disabled={savingSettings}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimary, { backgroundColor: theme.accent }]}
                onPress={() => void saveSettings()}
                disabled={savingSettings}
              >
                {savingSettings ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Save settings</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F6F8F7',
  },
  loadingText: { marginTop: 10, fontSize: 12, color: '#64748B' },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B', marginTop: 10 },
  emptyText: {
    fontSize: 11.5,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
  },
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
    marginRight: 10,
  },
  headerText: { flex: 1 },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginLeft: 8,
  },
  title: { fontSize: 21, fontWeight: '800' },
  subtitle: { fontSize: 11, marginTop: 3 },
  content: { padding: 16, paddingBottom: 110 },

  totalsRow: { flexDirection: 'row', marginBottom: 8, gap: 8 },
  totalCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 10,
  },
  totalIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalValue: { fontSize: 14, fontWeight: '800', color: '#1E293B', marginTop: 7 },
  totalLabel: { fontSize: 9, color: '#94A3B8', marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 9,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  sectionSubtitle: { fontSize: 10, color: '#94A3B8', marginTop: 2 },
  monthChip: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 },
  monthChipText: { fontSize: 10, fontWeight: '800' },

  performanceCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  performanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  performanceLabel: { fontSize: 11, color: '#64748B', fontWeight: '700' },
  performanceHint: { fontSize: 9.5, color: '#94A3B8' },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 110,
    marginTop: 10,
  },
  barColumn: { flex: 1, alignItems: 'center' },
  barValue: { fontSize: 8, color: '#94A3B8', height: 12 },
  barTrack: {
    width: 16,
    height: 70,
    borderRadius: 5,
    backgroundColor: '#F1F5F9',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 5 },
  barLabel: { fontSize: 9, color: '#94A3B8', marginTop: 4 },
  performanceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  performanceStat: { flex: 1, alignItems: 'center' },
  performanceStatValue: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  performanceStatLabel: { fontSize: 8.5, color: '#94A3B8', marginTop: 2 },
  performanceDivider: { width: 1, height: 24, backgroundColor: '#F1F5F9' },

  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  editButtonText: { fontSize: 10, fontWeight: '800', marginLeft: 3 },
  settingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
  },
  settingsItem: { flex: 1, alignItems: 'center' },
  settingsLabel: { fontSize: 9, color: '#94A3B8' },
  settingsValue: { fontSize: 14, fontWeight: '800', color: '#1E293B', marginTop: 3 },
  settingsDivider: { width: 1, height: 26, backgroundColor: '#F1F5F9' },

  viewTeamsLink: { fontSize: 11, fontWeight: '800' },
  peopleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emptyGridText: { width: '100%' },
  personBlock: {
    width: '48.5%',
    backgroundColor: '#fff',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#EEF2F6',
    padding: 10,
    marginBottom: 8,
  },
  personBlockActive: { borderColor: '#BBF7D0', backgroundColor: '#F7FEF9' },
  personTop: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  personName: { flex: 1, fontSize: 12, fontWeight: '800', color: '#1E293B' },
  personRole: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  personTimes: { fontSize: 9.5, color: '#64748B', marginTop: 6 },
  personState: { fontSize: 9, fontWeight: '800', marginTop: 3 },
  viewTeamsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 8,
  },
  viewTeamsButtonText: { color: '#fff', fontSize: 13, fontWeight: '800', marginLeft: 6 },
  footerNote: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  footerNoteText: {
    flex: 1,
    fontSize: 9.5,
    color: '#94A3B8',
    lineHeight: 14,
    marginLeft: 5,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    paddingBottom: 30,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  modalHint: { fontSize: 10.5, color: '#64748B', marginTop: 3, marginBottom: 10 },
  modalLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1E293B',
  },
  modalButtons: { flexDirection: 'row', marginTop: 16 },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  modalCancelText: { fontSize: 12.5, fontWeight: '800', color: '#475569' },
  modalPrimary: {
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
  },
  modalPrimaryText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
});
