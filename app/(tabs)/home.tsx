import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { useRouter, useFocusEffect } from 'expo-router';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import GenerateJoinLinkModal from '@/components/GenerateJoinLinkModal';
import SyncControls from '@/components/SyncControls';
import ScheduleCalendar, {
  type CalendarEntry,
} from '@/components/ScheduleCalendar';
import {
  fetchSheetRows,
  getGoogleAccessToken,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  clockInWorker,
  clockOutWorker,
  computeHoursWorked,
  formatClockTime,
  getDayHours,
  getOpenAttendance,
  getTodayAttendance,
  localDateString,
} from '@/src/utils/attendance';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  saveCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';
import { isAlertActive, sendAlert } from '@/src/utils/notifications';
import { effectiveDesignation, findMyWorkerRow, parseBirthday } from '@/src/utils/workerManagement';
import { loadShifts, type ShiftRecord } from '@/src/utils/scheduling';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(value: number) {
  return `${value}`.padStart(2, '0');
}

function elapsedSince(clockIn: string, nowMs: number) {
  const parts = clockIn.split(':').map((part) => parseInt(part, 10));
  if (parts.length < 2 || parts.some(Number.isNaN)) return '00:00:00';
  const start = new Date();
  start.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
  const diff = Math.max(0, nowMs - start.getTime());
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<SheetRow[]>([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clockBusy, setClockBusy] = useState(false);
  const [joinLinkModalVisible, setJoinLinkModalVisible] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const [companySettings, setCompanySettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [draftStart, setDraftStart] = useState(DEFAULT_COMPANY_SETTINGS.officeStart);
  const [draftEnd, setDraftEnd] = useState(DEFAULT_COMPANY_SETTINGS.officeEnd);
  const [draftHours, setDraftHours] = useState(
    `${DEFAULT_COMPANY_SETTINGS.dailyWorkHours}`
  );
  const [savingSettings, setSavingSettings] = useState(false);

  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertDuration, setAlertDuration] = useState('24');
  const [alertNotes, setAlertNotes] = useState('');
  const [sendingAlert, setSendingAlert] = useState(false);

  // Weekly schedule calendar.
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [dayDetail, setDayDetail] = useState<{
    date: string;
    entries: CalendarEntry[];
  } | null>(null);

  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const currentWorkerId = user.workerProfile?.workerId;
  const currentPayPerHour = user.workerProfile?.payPerHour || 0;

  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        currentWorkerId,
        user.email || user.workerProfile?.email
      ),
    [workers, currentWorkerId, user.email, user.workerProfile?.email]
  );
  const myWorkerId = currentWorkerId || myRow?.WorkerID || '';
  const myName = myRow?.Name || user.name || 'Employee';
  const myPayRate =
    parseFloat(myRow?.PayPerHour || '') || currentPayPerHour || 0;

  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const isEmployee = !isAdmin && !isManager;
  const theme = getRoleTheme(designation, isEmployee);
  const themeIcon = theme.icon as any;

  const fetchData = useCallback(async () => {
    if (!sheetId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setLoading(true);
    try {
      const [workerRows, clockingRows] = await Promise.all([
        fetchSheetRows(sheetId, 'Workers'),
        fetchSheetRows(sheetId, 'Clockings'),
      ]);
      setWorkers(workerRows);
      setClockings(clockingRows);

      try {
        const leaveRows = await fetchSheetRows(sheetId, 'LeaveRequests');
        setLeaveRequests(leaveRows);
      } catch {
        setLeaveRequests([]);
      }

      setShifts(await loadShifts(sheetId));

      try {
        const notifications = await fetchSheetRows(sheetId, 'Notifications');
        const relevant = notifications
          .filter(isAlertActive)
          .filter((notification) => {
            if (isEmployee) {
              return (
                notification.ToWorkerID === myWorkerId ||
                notification.ToWorkerID === 'all'
              );
            }
            return (
              notification.Type === 'leave_request' ||
              notification.Type === 'leave_update' ||
              notification.ToWorkerID === 'admin'
            );
          });
        setUnreadAlerts(
          relevant.filter((notification) => notification.Read === 'false').length
        );
      } catch {
        setUnreadAlerts(0);
      }

      try {
        const settings = await readCompanySettings(sheetId);
        setCompanySettings(settings);
      } catch {
        setCompanySettings(DEFAULT_COMPANY_SETTINGS);
      }
    } catch (error) {
      console.error('Error fetching home data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sheetId, isEmployee, myWorkerId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const attendance = useMemo(
    () => (myWorkerId ? getTodayAttendance(clockings, myWorkerId) : null),
    [clockings, myWorkerId]
  );
  const openSession = useMemo(
    () => (myWorkerId ? getOpenAttendance(clockings, myWorkerId) : null),
    [clockings, myWorkerId]
  );
  const isClockedIn = !!openSession;

  useEffect(() => {
    if (!isClockedIn) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isClockedIn]);

  const today = localDateString();
  const todayClockings = useMemo(
    () => clockings.filter((row) => row.Date === today),
    [clockings, today]
  );

  const teamWorkers = useMemo(
    () => workers.filter((w) => (w.Designation || '').toLowerCase() !== 'admin'),
    [workers]
  );

  const canManageSchedule = isAdmin || isManager;
  const scheduleByDate = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    shifts.forEach((shift) => {
      if (!canManageSchedule && shift.workerId !== myWorkerId) return;
      const list = map[shift.date] || (map[shift.date] = []);
      list.push({
        workerId: shift.workerId,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
      });
    });
    Object.values(map).forEach((list) =>
      list.sort((a, b) => a.name.localeCompare(b.name))
    );
    return map;
  }, [shifts, canManageSchedule, myWorkerId]);

  const calendarMonthPrefix = `${calendarMonth.getFullYear()}-${`${
    calendarMonth.getMonth() + 1
  }`.padStart(2, '0')}`;
  const hasScheduleForMonth = useMemo(
    () => shifts.some((shift) => shift.date.startsWith(calendarMonthPrefix)),
    [shifts, calendarMonthPrefix]
  );

  const activeNowIds = useMemo(
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
    leaveRequests.forEach((row) => {
      const status = (row.Status || '').toLowerCase();
      if (status === 'rejected' || status === 'cancelled') return;
      const start = row.StartDate || '';
      const end = row.EndDate || start;
      if (!start || !(start <= today && end >= today)) return;
      if (row.WorkerID) ids.add(row.WorkerID);
      if (row.Name) names.add(row.Name.trim().toLowerCase());
    });
    return { ids, names };
  }, [leaveRequests, today]);

  const isOnLeave = useCallback(
    (worker: SheetRow) =>
      onLeaveToday.ids.has(worker.WorkerID) ||
      onLeaveToday.names.has((worker.Name || '').trim().toLowerCase()),
    [onLeaveToday]
  );

  const activeNowCount = teamWorkers.filter((w) =>
    activeNowIds.has(w.WorkerID)
  ).length;
  const onLeaveNowCount = teamWorkers.filter(isOnLeave).length;
  const offlineNowCount = teamWorkers.filter(
    (w) => !activeNowIds.has(w.WorkerID) && !isOnLeave(w)
  ).length;

  const weekStart = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    return localDateString(monday);
  }, []);

  const sumHours = useCallback(
    (rows: SheetRow[]) =>
      rows.reduce(
        (total, row) => total + (parseFloat(row.HoursWorked || '0') || 0),
        0
      ),
    []
  );

  const workerHours = useCallback(
    (workerId: string, from: string) =>
      sumHours(
        clockings.filter(
          (row) => row.WorkerID === workerId && row.Date >= from
        )
      ),
    [clockings, sumHours]
  );

  const teamWeekHours = useMemo(
    () => sumHours(clockings.filter((row) => row.Date >= weekStart)),
    [clockings, weekStart, sumHours]
  );

  const myWeekHours = useMemo(
    () => (myWorkerId ? workerHours(myWorkerId, weekStart) : 0),
    [myWorkerId, workerHours, weekStart]
  );

  const weekSessions = useMemo(
    () =>
      clockings.filter(
        (row) =>
          row.Date >= weekStart &&
          !!row.ClockIn &&
          (!isEmployee || row.WorkerID === myWorkerId)
      ),
    [clockings, weekStart, isEmployee, myWorkerId]
  );

  const onTimeRate = useMemo(() => {
    if (weekSessions.length === 0) return 0;
    const onTime = weekSessions.filter(
      (row) => row.ClockIn <= companySettings.officeStart
    ).length;
    return Math.round((onTime / weekSessions.length) * 100);
  }, [weekSessions, companySettings.officeStart]);

  const lateCount = useMemo(
    () =>
      weekSessions.filter((row) => row.ClockIn > companySettings.officeStart)
        .length,
    [weekSessions, companySettings.officeStart]
  );

  const teamLeaveCount = useMemo(() => {
    const monthPrefix = localDateString().slice(0, 7);
    return leaveRequests.filter((row) => {
      const status = (row.Status || '').toLowerCase();
      if (status === 'rejected' || status === 'cancelled') return false;
      const start = row.StartDate || '';
      const end = row.EndDate || start;
      return start.startsWith(monthPrefix) || end.startsWith(monthPrefix);
    }).length;
  }, [leaveRequests]);

  const avgWeekDayHours = useMemo(() => {
    const days = new Set(weekSessions.map((row) => row.Date)).size;
    const hours = isEmployee ? myWeekHours : teamWeekHours;
    return days > 0 ? hours / days : 0;
  }, [weekSessions, isEmployee, myWeekHours, teamWeekHours]);

  // Home shows only the two most recent clock-ins. The full year/month/date
  // history lives on the dedicated clock-history screen.
  const historySessions = useMemo(() => {
    if (!myWorkerId) return [];
    return clockings
      .filter((row) => row.WorkerID === myWorkerId && row.ClockIn)
      .sort(
        (a, b) =>
          (b.Date || '').localeCompare(a.Date || '') ||
          Number(b._row || 0) - Number(a._row || 0)
      )
      .slice(0, 2);
  }, [clockings, myWorkerId]);

  const monthStart = useMemo(() => {
    const now = new Date();
    return localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  }, []);

  const myMonthHours = useMemo(
    () => (myWorkerId ? workerHours(myWorkerId, monthStart) : 0),
    [myWorkerId, workerHours, monthStart]
  );

  const myTodayHours = useMemo(
    () => (myWorkerId ? getDayHours(clockings, myWorkerId) : 0),
    [clockings, myWorkerId]
  );

  const myMonthPay = useMemo(
    () => Math.round(myMonthHours * myPayRate * 100) / 100,
    [myMonthHours, myPayRate]
  );

  const myAttendanceRate = useMemo(() => {
    if (!myWorkerId) return 0;
    const daysInMonthSoFar = new Date().getDate();
    const uniqueDays = new Set(
      clockings
        .filter(
          (row) =>
            row.WorkerID === myWorkerId &&
            row.Date >= monthStart &&
            row.ClockIn
        )
        .map((row) => row.Date)
    ).size;
    return daysInMonthSoFar > 0
      ? Math.round((uniqueDays / daysInMonthSoFar) * 100)
      : 0;
  }, [clockings, myWorkerId, monthStart]);

  const last7Days = useMemo(() => {
    const days: { label: string; hours: number; date: string }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = localDateString(date);
      const rows = clockings.filter(
        (row) =>
          row.Date === key && (!isEmployee || row.WorkerID === myWorkerId)
      );
      days.push({
        label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][date.getDay()],
        hours: sumHours(rows),
        date: key,
      });
    }
    return days;
  }, [clockings, isEmployee, myWorkerId, sumHours]);

  const maxDayHours = Math.max(...last7Days.map((day) => day.hours), 1);

  const celebrations = useMemo(() => {
    const currentMonth = new Date().getMonth() + 1;
    return workers
      .map((worker) => {
        const birthday = parseBirthday(worker.Birthday);
        const joined = worker.JoinDate ? new Date(worker.JoinDate) : null;
        if (birthday && birthday.month === currentMonth) {
          return { name: worker.Name, kind: 'Birthday', day: birthday.day };
        }
        if (joined && joined.getMonth() + 1 === currentMonth) {
          return {
            name: worker.Name,
            kind: 'Work anniversary',
            day: joined.getDate(),
          };
        }
        return null;
      })
      .filter(Boolean) as { name: string; kind: string; day: number }[];
  }, [workers]);

  const commitClock = async (mode: 'in' | 'out') => {
    setClockBusy(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        throw new Error(
          'Sign in with Google to save attendance. Ask your admin to share the sheet with your email as Editor.'
        );
      }
      if (mode === 'in') {
        const clockIn = await clockInWorker(
          sheetId,
          { workerId: myWorkerId, name: myName },
          token
        );
        Alert.alert(
          'Clocked in',
          token
            ? `Timer started at ${clockIn}.`
            : `Saved locally at ${clockIn}. It will sync when you are online.`
        );
      } else {
        const result = await clockOutWorker(
          sheetId,
          { workerId: myWorkerId, name: myName, payPerHour: myPayRate },
          token
        );
        Alert.alert(
          'Clocked out',
          token
            ? `${result.hoursWorked.toFixed(2)} hours saved for today.`
            : `${result.hoursWorked.toFixed(
                2
              )} hours saved locally. It will sync when you are online.`
        );
      }
      await fetchData();
    } catch (error: any) {
      Alert.alert(
        'Attendance not saved',
        error?.message ||
          'Ask your admin to enable edit access so attendance can be written to Sheets.'
      );
    } finally {
      setClockBusy(false);
    }
  };

  const handleClock = () => {
    if (!sheetId || !myWorkerId) {
      Alert.alert(
        'Employee record missing',
        'Your employee record could not be found. Ask your admin to add you to the team.'
      );
      return;
    }

    if (!openSession) {
      Alert.alert(
        'Clock in?',
        `Start your timer now at ${formatClockTime()}?\n\nOffice hours: ${
          companySettings.officeStart
        } – ${companySettings.officeEnd} (${companySettings.dailyWorkHours}h/day)`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clock In', onPress: () => commitClock('in') },
        ]
      );
      return;
    }

    const sessionHours = computeHoursWorked(
      openSession.ClockIn,
      formatClockTime(),
      parseFloat(openSession.BreakMins || '0') || 0
    );
    const totalToday = getDayHours(clockings, myWorkerId);
    Alert.alert(
      'Clock out?',
      `You clocked in at ${openSession.ClockIn}.\n\nThis session: ${sessionHours.toFixed(
        2
      )} h\nTotal today: ${totalToday.toFixed(2)} h`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clock Out', onPress: () => commitClock('out') },
      ]
    );
  };

  const handleSaveSettings = async () => {
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
        ...companySettings,
        officeStart: draftStart,
        officeEnd: draftEnd,
        dailyWorkHours: hours,
      };
      await saveCompanySettings(sheetId, token, next);
      setCompanySettings(next);
      setSettingsVisible(false);
      Alert.alert('Saved', 'Office timings and work hours updated.');
    } catch (error: any) {
      Alert.alert('Unable to save', error?.message || 'Try again.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendAlert = async () => {
    if (!alertTitle.trim() || !alertMessage.trim()) {
      Alert.alert('Missing info', 'Add a title and description for the alert.');
      return;
    }
    setSendingAlert(true);
    try {
      const token = await getGoogleAccessToken(true);
      const result = await sendAlert({
        sheetId,
        token,
        target: 'all',
        title: alertTitle,
        body: alertMessage,
        durationHours: parseFloat(alertDuration) || 24,
        notes: alertNotes,
        fromUid: user.uid || '',
      });
      setAlertVisible(false);
      setAlertTitle('');
      setAlertMessage('');
      setAlertDuration('24');
      setAlertNotes('');
      Alert.alert(
        'Alert sent',
        token
          ? 'Your team will see it in the Alerts tab.'
          : 'Saved locally. It will sync when you are online.'
      );
      return result;
    } catch (error: any) {
      Alert.alert('Unable to send', error?.message || 'Try again.');
    } finally {
      setSendingAlert(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // ------------------------------------------------------------ schedule
  const changeCalendarMonth = (delta: number) => {
    setCalendarMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1)
    );
  };

  const openDayDetail = (date: string, entries: CalendarEntry[]) => {
    setDayDetail({ date, entries });
  };

  const openScheduleScreen = () => {
    const month = `${calendarMonth.getFullYear()}-${`${
      calendarMonth.getMonth() + 1
    }`.padStart(2, '0')}`;
    router.push({
      pathname: '/assign-schedule',
      params: { month },
    } as any);
  };

  const roleLabel = isAdmin ? 'Admin' : isManager ? 'Manager' : 'Employee';

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          colors={[theme.accent]}
        />
      }
    >
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={[styles.greeting, { color: theme.headerMuted }]}>
              {new Date().getHours() < 12
                ? 'Good morning,'
                : new Date().getHours() < 17
                ? 'Good afternoon,'
                : 'Good evening,'}
            </Text>
            <Text style={[styles.userName, { color: theme.headerText }]}>
              {user.name || 'User'}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: theme.accent }]}>
              <MaterialCommunityIcons name={themeIcon} size={14} color="#fff" />
              <Text style={styles.roleBadgeText}>{roleLabel}</Text>
            </View>
            <Text style={[styles.permissionText, { color: theme.headerMuted }]}>
              {theme.permissionSummary}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => router.push('/(tabs)/notifications')}
          >
            <MaterialCommunityIcons
              name="bell-outline"
              size={24}
              color={theme.headerText}
            />
            {unreadAlerts > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadAlerts}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {!isAdmin && <SyncControls sheetId={sheetId} accent={theme.accent} compact />}

      {(isEmployee || isManager) && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Time Clock</Text>
              {attendance?.clockOut && !isClockedIn && (
                <View style={styles.doneChip}>
                  <MaterialCommunityIcons name="check" size={13} color="#059669" />
                  <Text style={styles.doneChipText}>Clocked out</Text>
                </View>
              )}
            </View>
            <View style={[styles.timeCard, { borderColor: theme.accentBorder }]}>
              <View style={styles.timeCardTop}>
                <Text style={styles.timeCardLabel}>My Time Clock</Text>
                <View style={[styles.clockIcon, { backgroundColor: theme.accentSoft }]}>
                  <MaterialCommunityIcons
                    name={isClockedIn ? 'timer-sand' : 'clock-outline'}
                    size={26}
                    color={theme.accent}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.clockButton,
                  { backgroundColor: isClockedIn ? '#DC2626' : '#2563EB' },
                ]}
                onPress={handleClock}
                disabled={clockBusy}
              >
                {clockBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name={isClockedIn ? 'logout' : 'login'}
                      size={18}
                      color="#fff"
                    />
                    <Text style={styles.clockButtonText}>
                      {isClockedIn ? 'Clock Out' : 'Clock In'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.timerBlock}>
                <Text style={styles.timerLabel}>
                  {isClockedIn ? 'Elapsed time' : "Today's total"}
                </Text>
                <Text
                  style={[
                    styles.timer,
                    { color: isClockedIn ? '#DC2626' : '#1E293B' },
                  ]}
                >
                  {isClockedIn && openSession
                    ? elapsedSince(openSession.ClockIn, nowMs)
                    : `${myTodayHours.toFixed(2)} h`}
                </Text>
                <Text style={styles.timerHint}>
                  {isClockedIn
                    ? `Clocked in at ${openSession?.ClockIn}`
                    : attendance?.clockOut
                    ? `Last clock-out at ${attendance.clockOut}`
                    : 'Clock in to start your timer'}
                </Text>
              </View>

              <View style={styles.timeMetaRow}>
                <View style={styles.timeMeta}>
                  <Text style={styles.timeMetaLabel}>Clock in</Text>
                  <Text style={styles.timeMetaValue}>
                    {attendance?.clockIn || '--:--'}
                  </Text>
                </View>
                <View style={styles.timeMeta}>
                  <Text style={styles.timeMetaLabel}>Clock out</Text>
                  <Text style={styles.timeMetaValue}>
                    {attendance?.clockOut || '--:--'}
                  </Text>
                </View>
                <View style={styles.timeMeta}>
                  <Text style={styles.timeMetaLabel}>Today</Text>
                  <Text style={styles.timeMetaValue}>
                    {myTodayHours.toFixed(2)} h
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Clock-in History</Text>
            </View>
            <View style={styles.historyCard}>
              {historySessions.length === 0 ? (
                <Text style={styles.emptyText}>
                  No clock-in stamps yet.
                </Text>
              ) : (
                historySessions.map((row) => {
                  const active = !!row.ClockIn && !row.ClockOut;
                  return (
                    <View key={row._row} style={styles.historyRow}>
                      <View style={styles.historyDateBox}>
                        <Text style={styles.historyDate}>
                          {row.Date?.slice(5)}
                        </Text>
                        <Text style={styles.historyDay}>
                          {row.Date
                            ? new Date(row.Date).toLocaleDateString(undefined, {
                                weekday: 'short',
                              })
                            : ''}
                        </Text>
                      </View>
                      <View style={styles.historyTimes}>
                        <Text style={styles.historyTime}>
                          In {row.ClockIn || '--:--'} · Out{' '}
                          {row.ClockOut || '--:--'}
                        </Text>
                        <Text style={styles.historyHours}>
                          {active
                            ? 'In progress'
                            : `${(
                                parseFloat(row.HoursWorked || '0') || 0
                              ).toFixed(2)} h`}
                        </Text>
                      </View>
                      {active && (
                        <View style={styles.liveChip}>
                          <Text style={styles.liveChipText}>LIVE</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
            <TouchableOpacity
              style={styles.showMore}
              onPress={() => router.push('/clock-history' as any)}
            >
              <Text style={[styles.showMoreText, { color: theme.accent }]}>
                Show more
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={16}
                color={theme.accent}
              />
            </TouchableOpacity>
          </View>
        </>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Schedule</Text>
            <Text style={styles.sectionSubtitle}>
              {canManageSchedule
                ? 'Assign weekly shifts around office hours'
                : 'Days assigned to you'}
            </Text>
          </View>
        </View>
        <ScheduleCalendar
          monthDate={calendarMonth}
          entriesByDate={scheduleByDate}
          today={today}
          canAssign={canManageSchedule}
          isEmployee={isEmployee}
          accent={theme.accent}
          accentSoft={theme.accentSoft}
          accentBorder={theme.accentBorder}
          onPrevMonth={() => changeCalendarMonth(-1)}
          onNextMonth={() => changeCalendarMonth(1)}
          onAssign={openScheduleScreen}
          onDayPress={openDayDetail}
          assignLabel={hasScheduleForMonth ? 'Edit' : 'Assign'}
        />
      </View>

      {!isAdmin && (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Summary</Text>
          <View style={styles.summaryHeaderRight}>
            {isAdmin && (
              <TouchableOpacity
                style={[styles.settingsButton, { backgroundColor: theme.accentSoft }]}
                onPress={() => {
                  setDraftStart(companySettings.officeStart);
                  setDraftEnd(companySettings.officeEnd);
                  setDraftHours(`${companySettings.dailyWorkHours}`);
                  setSettingsVisible(true);
                }}
              >
                <MaterialCommunityIcons
                  name="cog-outline"
                  size={16}
                  color={theme.accentDark}
                />
                <Text style={[styles.settingsButtonText, { color: theme.accentDark }]}>
                  Office hours
                </Text>
              </TouchableOpacity>
            )}
            <View style={[styles.monthChip, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.monthChipText, { color: theme.accentDark }]}>
                {MONTHS[new Date().getMonth()]}
              </Text>
            </View>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.summaryScroll}
        >
          <>
            <SummaryCard
              icon="clock-outline"
              color={theme.accent}
              value={`${myWeekHours.toFixed(1)}h`}
              label="Hours this week"
              footer={`Office ${companySettings.officeStart}–${companySettings.officeEnd}`}
            />
            <SummaryCard
              icon="timer"
              color="#2196F3"
              value={`${myMonthHours.toFixed(1)}h`}
              label="Hours this month"
              footer={`${companySettings.dailyWorkHours}h/day`}
            />
            <SummaryCard
              icon="cash"
              color="#F59E0B"
              value={`$${myMonthPay.toFixed(0)}`}
              label="Pay this month"
            />
            <SummaryCard
              icon="calendar-check"
              color="#8B5CF6"
              value={`${myAttendanceRate}%`}
              label="Attendance"
            />
          </>
        </ScrollView>
      </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {isEmployee ? 'My Performance' : 'Team Performance'}
          </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/routes' as any)}>
            <Text style={[styles.viewAllText, { color: theme.accent }]}>
              Route
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.performanceCard}>
          <View style={styles.performanceHeader}>
            <Text style={styles.performanceLabel}>Last 7 days</Text>
            <Text style={[styles.performanceTotal, { color: theme.accentDark }]}>
              {last7Days.reduce((sum, day) => sum + day.hours, 0).toFixed(1)} h
            </Text>
          </View>
          <Text style={styles.performanceSub}>
            Office {companySettings.officeStart}–{companySettings.officeEnd} ·{' '}
            {companySettings.dailyWorkHours}h/day
          </Text>
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
          {isEmployee ? (
            <View style={styles.performanceFooter}>
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>{myAttendanceRate}%</Text>
                <Text style={styles.performanceStatLabel}>Attendance</Text>
              </View>
              <View style={styles.performanceDivider} />
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>
                  {myMonthHours.toFixed(1)}
                </Text>
                <Text style={styles.performanceStatLabel}>Month hours</Text>
              </View>
              <View style={styles.performanceDivider} />
              <View style={styles.performanceStat}>
                <Text style={styles.performanceStatValue}>
                  ${myMonthPay.toFixed(0)}
                </Text>
                <Text style={styles.performanceStatLabel}>Month pay</Text>
              </View>
            </View>
          ) : (
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
          )}
        </View>
      </View>

      {isAdmin && (
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.summaryButton, { borderColor: theme.accentBorder }]}
            activeOpacity={0.85}
            onPress={() => router.push('/admin-summary' as any)}
          >
            <View
              style={[
                styles.summaryButtonIcon,
                { backgroundColor: theme.accentSoft },
              ]}
            >
              <MaterialCommunityIcons
                name="chart-box-outline"
                size={22}
                color={theme.accent}
              />
            </View>
            <View style={styles.summaryButtonInfo}>
              <Text style={styles.summaryButtonTitle}>Summary</Text>
              <Text style={styles.summaryButtonSubtitle}>
                Performance, office timings, clock in/out, weekly & monthly
                hours and today&apos;s activity
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color="#94A3B8"
            />
          </TouchableOpacity>
        </View>
      )}

      {celebrations.length > 0 && (
        <View style={styles.section}>
          <View style={styles.celebrationCard}>
            <MaterialCommunityIcons
              name="cake-variant"
              size={22}
              color="#DB2777"
            />
            <Text style={styles.celebrationText}>
              {celebrations
                .slice(0, 3)
                .map((event) =>
                  event.kind === 'Birthday'
                    ? `${event.name}'s birthday`
                    : `${event.name}'s work anniversary`
                )
                .join(' • ')}
              {celebrations.length > 3 ? ` +${celebrations.length - 3} more` : ''}
            </Text>
          </View>
        </View>
      )}

      {isEmployee ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Information</Text>
          <View style={styles.myInfoCard}>
            <View style={styles.myInfoHeader}>
              {myRow?.PhotoURL ? (
                <Image
                  source={{ uri: myRow.PhotoURL }}
                  style={styles.myInfoPhoto}
                />
              ) : (
                <View
                  style={[
                    styles.myInfoPhoto,
                    { backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
                  ]}
                >
                  <Text style={styles.myInfoInitials}>{initials(myName)}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.myInfoName}>{myName}</Text>
                <Text style={styles.myInfoRole}>
                  {myRow?.Designation || 'Employee'}
                </Text>
              </View>
              <View
                style={[
                  styles.accessChip,
                  {
                    backgroundColor:
                      String(myRow?.EditAccess).toLowerCase() === 'true'
                        ? '#DCFCE7'
                        : '#F1F5F9',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.accessChipText,
                    {
                      color:
                        String(myRow?.EditAccess).toLowerCase() === 'true'
                          ? '#15803D'
                          : '#64748B',
                    },
                  ]}
                >
                  {String(myRow?.EditAccess).toLowerCase() === 'true'
                    ? 'Edit access'
                    : 'Read only'}
                </Text>
              </View>
            </View>
            <InfoLine
              icon="phone"
              label="Phone"
              value={myRow?.Phone || 'Not set'}
            />
            <InfoLine
              icon="email"
              label="Email"
              value={myRow?.Email || user.email || 'Not set'}
            />
            <InfoLine
              icon="text-account"
              label="Bio"
              value={myRow?.Bio || 'No bio added yet'}
            />
            <TouchableOpacity
              style={[styles.infoButton, { backgroundColor: theme.accent }]}
              onPress={() => router.push('/(tabs)/profile')}
            >
              <Text style={styles.infoButtonText}>Open profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Team Status</Text>
            <TouchableOpacity
              onPress={() => router.push('/team-status?filter=in' as any)}
            >
              <Text style={[styles.viewAllText, { color: theme.accent }]}>
                View details
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.teamStatusRow}>
            <TouchableOpacity
              style={[styles.teamStatusCard, { borderColor: '#BBF7D0' }]}
              onPress={() => router.push('/team-status?filter=in' as any)}
            >
              <MaterialCommunityIcons name="login" size={20} color="#16A34A" />
              <Text style={styles.teamStatusValue}>{activeNowCount}</Text>
              <Text style={styles.teamStatusLabel}>Logged in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.teamStatusCard, { borderColor: '#E2E8F0' }]}
              onPress={() => router.push('/team-status?filter=offline' as any)}
            >
              <MaterialCommunityIcons name="logout" size={20} color="#64748B" />
              <Text style={styles.teamStatusValue}>{offlineNowCount}</Text>
              <Text style={styles.teamStatusLabel}>Offline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.teamStatusCard, { borderColor: '#FDE68A' }]}
              onPress={() => router.push('/team-status?filter=leave' as any)}
            >
              <MaterialCommunityIcons name="beach" size={20} color="#D97706" />
              <Text style={styles.teamStatusValue}>{onLeaveNowCount}</Text>
              <Text style={styles.teamStatusLabel}>On leave</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {isAdmin && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => setJoinLinkModalVisible(true)}
            >
              <MaterialCommunityIcons
                name="link-plus"
                size={26}
                color={theme.accent}
              />
              <Text style={styles.actionLabel}>Add employee</Text>
            </TouchableOpacity>
          )}
          {(isAdmin || isManager) && (
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => setAlertVisible(true)}
            >
              <MaterialCommunityIcons
                name="bullhorn-outline"
                size={26}
                color={theme.accent}
              />
              <Text style={styles.actionLabel}>Create alert</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/routes' as any)}
          >
            <MaterialCommunityIcons
              name="chart-donut"
              size={26}
              color={theme.accent}
            />
            <Text style={styles.actionLabel}>Route</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/workers')}
          >
            <MaterialCommunityIcons
              name="account-group-outline"
              size={26}
              color={theme.accent}
            />
            <Text style={styles.actionLabel}>Team directory</Text>
          </TouchableOpacity>
        </View>
      </View>

      <GenerateJoinLinkModal
        visible={joinLinkModalVisible}
        onClose={() => setJoinLinkModalVisible(false)}
      />

      <Modal visible={settingsVisible} transparent animationType="slide">
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
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimary, { backgroundColor: theme.accent }]}
                onPress={handleSaveSettings}
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

      <Modal visible={alertVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create alert</Text>
            <Text style={styles.modalHint}>
              Share a message with everyone on the team.
            </Text>

            <Text style={styles.modalLabel}>Title</Text>
            <TextInput
              style={styles.modalInput}
              value={alertTitle}
              onChangeText={setAlertTitle}
              placeholder="e.g. Office closed tomorrow"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.modalLabel}>Description</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              value={alertMessage}
              onChangeText={setAlertMessage}
              multiline
              placeholder="What should everyone know?"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.modalLabel}>Show for (hours)</Text>
            <TextInput
              style={styles.modalInput}
              value={alertDuration}
              onChangeText={setAlertDuration}
              keyboardType="numeric"
              placeholder="24"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={alertNotes}
              onChangeText={setAlertNotes}
              placeholder="Internal note"
              placeholderTextColor="#94A3B8"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setAlertVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimary, { backgroundColor: theme.accent }]}
                onPress={handleSendAlert}
                disabled={sendingAlert}
              >
                {sendingAlert ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Send alert</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      <Modal
        visible={!!dayDetail}
        transparent
        animationType="fade"
        onRequestClose={() => setDayDetail(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {dayDetail ? formatDayLabel(dayDetail.date) : ''}
            </Text>
            <Text style={styles.modalHint}>
              {dayDetail?.entries.length
                ? `${dayDetail.entries.length} employee${
                    dayDetail.entries.length === 1 ? '' : 's'
                  } scheduled`
                : 'No shifts scheduled'}
            </Text>

            {!!dayDetail?.entries.length && (
              <ScrollView
                style={styles.modalScroll}
                showsVerticalScrollIndicator={false}
              >
                {dayDetail.entries.map((entry, index) => (
                  <View
                    key={`${entry.workerId}-${index}`}
                    style={styles.dayEntryRow}
                  >
                    <View
                      style={[
                        styles.dayEntryAvatar,
                        { backgroundColor: theme.accentSoft },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayEntryInitials,
                          { color: theme.accentDark },
                        ]}
                      >
                        {initials(entry.name)}
                      </Text>
                    </View>
                    <View style={styles.dayEntryInfo}>
                      <Text style={styles.dayEntryName}>{entry.name}</Text>
                      <Text style={styles.dayEntryTime}>
                        {entry.startTime || companySettings.officeStart} –{' '}
                        {entry.endTime || companySettings.officeEnd}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[
                styles.dayDetailOkButton,
                { backgroundColor: theme.accent },
              ]}
              onPress={() => setDayDetail(null)}
            >
              <Text style={styles.modalPrimaryText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      )}
    </ScrollView>
  );
}

function SummaryCard({
  icon,
  color,
  value,
  label,
  footer,
  onPress,
}: {
  icon: string;
  color: string;
  value: string;
  label: string;
  footer?: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: `${color}18` }]}>
        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      {!!footer && <Text style={styles.summaryFooter}>{footer}</Text>}
      {!!onPress && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={16}
          color="#CBD5E0"
          style={styles.summaryChevron}
        />
      )}
    </View>
  );

  if (!onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      {content}
    </TouchableOpacity>
  );
}

function InfoLine({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoLine}>
      <MaterialCommunityIcons name={icon as any} size={16} color="#64748B" />
      <Text style={styles.infoLineLabel}>{label}</Text>
      <Text style={styles.infoLineValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  headerLeft: { flex: 1, paddingRight: 12 },
  greeting: { fontSize: 13, fontWeight: '600' },
  userName: { fontSize: 26, fontWeight: '800', marginTop: 2 },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  roleBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  permissionText: { fontSize: 11, marginTop: 8 },
  bellButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  sectionSubtitle: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  viewAllText: { fontSize: 13, fontWeight: '700' },
  teamStatusRow: { flexDirection: 'row', marginTop: 8 },
  teamStatusCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 8,
  },
  teamStatusValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 4,
  },
  teamStatusLabel: { fontSize: 10, color: '#64748B', marginTop: 2 },
  monthChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  monthChipText: { fontSize: 11, fontWeight: '700' },
  summaryHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    marginRight: 8,
  },
  settingsButtonText: { fontSize: 10, fontWeight: '700', marginLeft: 4 },
  timeCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  timeCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeCardLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  timer: {
    fontSize: 38,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  timerHint: { fontSize: 12, color: '#64748B', marginTop: 2 },
  timerBlock: { marginTop: 18, alignItems: 'center' },
  timerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  clockIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  timeMeta: { flex: 1, alignItems: 'center' },
  timeMetaLabel: { fontSize: 11, color: '#64748B' },
  timeMetaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  clockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 14,
  },
  clockButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  monthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  monthButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginRight: 4,
  },
  historyCard: { backgroundColor: '#fff', borderRadius: 16, padding: 6 },
  showMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  showMoreText: { fontSize: 12, fontWeight: '800', marginRight: 2 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  historyDateBox: {
    width: 52,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 9,
    paddingVertical: 6,
  },
  historyDate: { fontSize: 12, fontWeight: '800', color: '#1E293B' },
  historyDay: { fontSize: 9, color: '#94A3B8', marginTop: 1 },
  historyTimes: { flex: 1, marginLeft: 12 },
  historyTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
  historyHours: { fontSize: 10, color: '#64748B', marginTop: 2 },
  liveChip: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveChipText: { fontSize: 9, fontWeight: '800', color: '#15803D' },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  doneChipText: { fontSize: 11, fontWeight: '700', color: '#059669', marginLeft: 3 },
  activityCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 6,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  activityAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityAvatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  activityInfo: { flex: 1, marginLeft: 10 },
  activityName: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  activityTimes: { fontSize: 11, color: '#64748B', marginTop: 2 },
  activityChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  activityChipText: { fontSize: 10, fontWeight: '700' },
  emptyText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
    padding: 16,
    textAlign: 'center',
  },
  summaryScroll: { flexDirection: 'row' },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginRight: 10,
    minWidth: 124,
  },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 10,
  },
  summaryLabel: { fontSize: 11, color: '#64748B', marginTop: 2 },
  summaryFooter: { fontSize: 9, color: '#94A3B8', marginTop: 6 },
  summaryChevron: { position: 'absolute', right: 8, top: 10 },
  summaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
  },
  summaryButtonIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryButtonInfo: { flex: 1, marginLeft: 11, paddingRight: 8 },
  summaryButtonTitle: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  summaryButtonSubtitle: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 14,
  },
  performanceCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  performanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  performanceLabel: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  performanceSub: { fontSize: 10, color: '#94A3B8', marginTop: 2 },
  performanceTotal: { fontSize: 17, fontWeight: '800' },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 110,
    marginTop: 14,
  },
  barColumn: { flex: 1, alignItems: 'center' },
  barValue: { fontSize: 9, color: '#94A3B8', marginBottom: 4 },
  barTrack: {
    flex: 1,
    width: 12,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 6 },
  barLabel: { fontSize: 10, color: '#94A3B8', marginTop: 6, fontWeight: '600' },
  performanceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
  },
  performanceStat: { flex: 1, alignItems: 'center' },
  performanceStatValue: { fontSize: 16, fontWeight: '800', color: '#1E293B' },
  performanceStatLabel: { fontSize: 10, color: '#64748B', marginTop: 2 },
  performanceDivider: { width: 1, height: 26, backgroundColor: '#E2E8F0' },
  celebrationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCE7F3',
    borderRadius: 14,
    padding: 14,
  },
  celebrationText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 12,
    color: '#9D174D',
    fontWeight: '600',
  },
  myInfoCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16 },
  myInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  myInfoPhoto: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  myInfoInitials: { color: '#fff', fontSize: 16, fontWeight: '800' },
  myInfoName: { fontSize: 16, fontWeight: '800', color: '#1E293B' },
  myInfoRole: { fontSize: 12, color: '#64748B', marginTop: 2, textTransform: 'capitalize' },
  accessChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9 },
  accessChipText: { fontSize: 10, fontWeight: '700' },
  infoLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  infoLineLabel: {
    fontSize: 12,
    color: '#64748B',
    width: 52,
    marginLeft: 8,
  },
  infoLineValue: { flex: 1, fontSize: 13, color: '#1E293B', fontWeight: '500' },
  infoButton: {
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  infoButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
  },
  workerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  workerInfo: { flex: 1, marginLeft: 12 },
  workerName: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  workerDesignation: { fontSize: 11, color: '#64748B', marginTop: 2 },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  statusLabel: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 7,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1E293B' },
  modalHint: { fontSize: 11, color: '#94A3B8', marginTop: 4, marginBottom: 12 },
  modalScroll: { maxHeight: 320 },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  modalOptionText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  modalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 10,
    marginBottom: 5,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    color: '#1E293B',
  },
  modalTextarea: { height: 84, textAlignVertical: 'top' },
  modalButtons: { flexDirection: 'row', marginTop: 16 },
  modalCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  modalCancelText: { color: '#475569', fontWeight: '700', fontSize: 13 },
  modalPrimary: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  dayDetailOkButton: {
    alignSelf: 'stretch',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },

  assignOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  assignCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  assignHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  assignWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 8,
    marginTop: 12,
  },
  assignWeekButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignWeekInfo: { flex: 1, alignItems: 'center' },
  assignWeekLabel: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  assignOfficeHint: { fontSize: 9.5, color: '#94A3B8', marginTop: 2 },
  assignDayRow: { flexDirection: 'row', flexWrap: 'wrap' },
  assignDayChip: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginRight: 5,
    marginBottom: 5,
    backgroundColor: '#fff',
  },
  assignDayText: { fontSize: 10, fontWeight: '800', color: '#64748B' },
  assignListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assignSelectAll: { fontSize: 10, fontWeight: '800' },
  assignList: { maxHeight: 230 },
  assignWorkerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  assignWorkerInfo: { flex: 1, marginLeft: 9 },
  assignWorkerName: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  assignWorkerMeta: { fontSize: 9.5, color: '#94A3B8', marginTop: 2 },
  assignFooterNote: {
    fontSize: 9.5,
    color: '#94A3B8',
    lineHeight: 14,
    marginTop: 8,
    marginBottom: 4,
  },

  dayEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dayEntryAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayEntryInitials: { fontSize: 13, fontWeight: '800' },
  dayEntryInfo: { flex: 1, marginLeft: 9 },
  dayEntryName: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  dayEntryTime: { fontSize: 10, color: '#64748B', marginTop: 2 },

  loadingContainer: { padding: 30, alignItems: 'center' },
});
