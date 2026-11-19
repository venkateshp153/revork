import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  fetchSheetRows,
  getGoogleAccessToken,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';
import {
  buildContinuationSchedule,
  buildMonthSchedule,
  createShifts,
  deleteShift,
  deleteShifts,
  isValidTime,
  loadShifts,
  monthPrefix,
  nextMonth,
  previousMonth,
  shiftHours,
  timeToMinutes,
  updateShiftTimes,
  type ScheduleBuildResult,
  type ShiftRecord,
  type TimeOverride,
} from '@/src/utils/scheduling';
import {
  computeMonthlyPayroll,
  savePayroll,
} from '@/src/utils/payroll';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DEFAULT_WORK_DAYS = [0, 1, 2, 3, 4];

function monthLabel(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function initials(name = ''): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function formatDateHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function skippedSummary(result: ScheduleBuildResult): string {
  const parts: string[] = [];
  if (result.skippedLeave > 0) parts.push(`${result.skippedLeave} on leave`);
  if (result.skippedExisting > 0) {
    parts.push(`${result.skippedExisting} already scheduled`);
  }
  if ((result.skippedPast || 0) > 0) {
    parts.push(`${result.skippedPast} past dates`);
  }
  if ((result.skippedInvalid || 0) > 0) {
    parts.push(`${result.skippedInvalid} invalid dates`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'none';
}

export default function AssignScheduleScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const params = useLocalSearchParams<{ month?: string }>();

  const initialMonth = useMemo(() => {
    if (params.month && /^\d{4}-\d{2}$/.test(params.month)) {
      const [year, month] = params.month.split('-').map(Number);
      return new Date(year, month - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [params.month]);

  const [monthDate, setMonthDate] = useState(initialMonth);
  useEffect(() => {
    if (!params.month || !/^\d{4}-\d{2}$/.test(params.month)) return;
    const [year, month] = params.month.split('-').map(Number);
    const next = new Date(year, month - 1, 1);
    setMonthDate((prev) => (monthPrefix(prev) === params.month ? prev : next));
  }, [params.month]);

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<SheetRow[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Assignment modal.
  const [assignVisible, setAssignVisible] = useState(false);
  const [assignMode, setAssignMode] = useState<'month' | 'continue'>('month');
  const [workerDays, setWorkerDays] = useState<Record<string, number[]>>({});
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [customTimes, setCustomTimes] = useState<Record<string, TimeOverride>>(
    {}
  );
  const [skipPastDates, setSkipPastDates] = useState(true);
  const [assignBusy, setAssignBusy] = useState(false);
  const [timeEditorWorkerId, setTimeEditorWorkerId] = useState<string | null>(
    null
  );
  const [timeDraftStart, setTimeDraftStart] = useState('');
  const [timeDraftEnd, setTimeDraftEnd] = useState('');
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [editShift, setEditShift] = useState<ShiftRecord | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!sheetId) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (showSpinner) setRefreshing(true);
      try {
        const [workerRows, shiftRows, clockingRows, leaveRows, companySettings] =
          await Promise.all([
            fetchSheetRows(sheetId, 'Workers').catch(() => [] as SheetRow[]),
            loadShifts(sheetId),
            fetchSheetRows(sheetId, 'Clockings').catch(() => [] as SheetRow[]),
            fetchSheetRows(sheetId, 'LeaveRequests').catch(
              () => [] as SheetRow[]
            ),
            readCompanySettings(sheetId),
          ]);
        setWorkers(workerRows);
        setShifts(shiftRows);
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
      void load();
    }, [load])
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
  const canManage = designation === 'admin' || designation === 'manager';
  const theme = getRoleTheme(designation, false);
  const myName = myRow?.Name || user.name || 'Admin';

  const teamWorkers = useMemo(
    () =>
      workers
        .filter((worker) => (worker.Designation || '').toLowerCase() !== 'admin')
        .filter((worker) => !!worker.WorkerID),
    [workers]
  );

  const prefix = monthPrefix(monthDate);
  const currentPrefix = monthPrefix(new Date());
  const monthShifts = useMemo(
    () =>
      shifts
        .filter((shift) => shift.date.startsWith(prefix))
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.name.localeCompare(b.name)
        ),
    [shifts, prefix]
  );

  const shiftsByDate = useMemo(() => {
    const map: Record<string, ShiftRecord[]> = {};
    monthShifts.forEach((shift) => {
      (map[shift.date] || (map[shift.date] = [])).push(shift);
    });
    return map;
  }, [monthShifts]);

  const scheduledEmployeeCount = useMemo(
    () => new Set(monthShifts.map((shift) => shift.workerId)).size,
    [monthShifts]
  );
  const scheduledHours = useMemo(
    () =>
      monthShifts.reduce(
        (sum, shift) => sum + shiftHours(shift.startTime, shift.endTime),
        0
      ),
    [monthShifts]
  );

  const previousPrefix = monthPrefix(previousMonth(monthDate));
  const previousShifts = useMemo(
    () => shifts.filter((shift) => shift.date.startsWith(previousPrefix)),
    [shifts, previousPrefix]
  );

  const payrollRows = useMemo(
    () =>
      computeMonthlyPayroll({
        monthDate,
        workers: teamWorkers,
        shifts,
        clockings,
        officeStart: settings.officeStart,
        generatedBy: myName,
      }),
    [monthDate, teamWorkers, shifts, clockings, settings.officeStart, myName]
  );

  const changeMonth = (delta: number) => {
    const next =
      delta > 0 ? nextMonth(monthDate) : previousMonth(monthDate);
    setMonthDate(next);
    setSkipPastDates(monthPrefix(next) >= currentPrefix);
  };

  const openAssign = (mode: 'month' | 'continue' = 'month') => {
    setAssignMode(mode);
    setWorkerDays(
      Object.fromEntries(
        teamWorkers.map((worker) => [worker.WorkerID, [...DEFAULT_WORK_DAYS]])
      )
    );
    setSelectedWorkerIds(teamWorkers.map((worker) => worker.WorkerID));
    setCustomTimes({});
    setSkipPastDates(prefix >= currentPrefix);
    setTimeEditorWorkerId(null);
    setAssignVisible(true);
  };

  const toggleWorkerDay = (workerId: string, offset: number) => {
    setWorkerDays((prev) => {
      const current = prev[workerId] ?? DEFAULT_WORK_DAYS;
      const next = current.includes(offset)
        ? current.filter((day) => day !== offset)
        : [...current, offset].sort((a, b) => a - b);
      return { ...prev, [workerId]: next };
    });
  };

  const applyDaysToAll = (days: number[]) => {
    setWorkerDays(
      Object.fromEntries(
        teamWorkers.map((worker) => [worker.WorkerID, [...days]])
      )
    );
  };

  const toggleWorker = (workerId: string) => {
    setSelectedWorkerIds((prev) =>
      prev.includes(workerId)
        ? prev.filter((id) => id !== workerId)
        : [...prev, workerId]
    );
  };

  const openTimeEditor = (worker: SheetRow) => {
    const override = customTimes[worker.WorkerID];
    setTimeEditorWorkerId(
      timeEditorWorkerId === worker.WorkerID ? null : worker.WorkerID
    );
    setTimeDraftStart(override?.start || settings.officeStart);
    setTimeDraftEnd(override?.end || settings.officeEnd);
  };

  const saveTimeEditor = (workerId: string) => {
    const start = timeDraftStart.trim();
    const end = timeDraftEnd.trim();
    if (!isValidTime(start) || !isValidTime(end)) {
      Alert.alert('Invalid time', 'Use 24-hour times like 09:00 and 17:00.');
      return;
    }
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      Alert.alert('Invalid time', 'The end time must be after the start time.');
      return;
    }
    setCustomTimes((prev) => ({ ...prev, [workerId]: { start, end } }));
    setTimeEditorWorkerId(null);
  };

  const resetTimeEditor = (workerId: string) => {
    setCustomTimes((prev) => {
      const next = { ...prev };
      delete next[workerId];
      return next;
    });
    setTimeEditorWorkerId(null);
  };

  const selectedWorkers = () =>
    teamWorkers
      .filter((worker) => selectedWorkerIds.includes(worker.WorkerID))
      .map((worker) => ({
        workerId: worker.WorkerID,
        name: worker.Name || worker.WorkerID,
      }));

  const confirmAndCreate = (result: ScheduleBuildResult) => {
    if (result.shifts.length === 0) {
      Alert.alert(
        'Nothing to schedule',
        `No new shifts were created. Skipped: ${skippedSummary(result)}.`
      );
      return;
    }
    Alert.alert(
      'Create schedule?',
      `${result.shifts.length} shift${
        result.shifts.length === 1 ? '' : 's'
      } will be added for ${monthLabel(monthDate)}.\n\nSkipped: ${skippedSummary(
        result
      )}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: () => void commitSchedule(result),
        },
      ]
    );
  };

  const commitSchedule = async (result: ScheduleBuildResult) => {
    setAssignBusy(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        throw new Error('Sign in with Google to save the schedule.');
      }
      const write = await createShifts(sheetId, result.shifts);
      await load();
      setAssignVisible(false);
      Alert.alert(
        'Schedule saved',
        `${write.created} shift${
          write.created === 1 ? '' : 's'
        } added for ${monthLabel(monthDate)}.${
          write.failed > 0 ? `\n\n${write.failed} failed to save.` : ''
        }`
      );
    } catch (error: any) {
      Alert.alert(
        'Could not save schedule',
        error?.message || 'Check your connection and try again.'
      );
    } finally {
      setAssignBusy(false);
    }
  };

  const generate = () => {
    const workersForSchedule = selectedWorkers();
    if (workersForSchedule.length === 0) {
      Alert.alert('Select employees', 'Choose at least one employee.');
      return;
    }

    if (assignMode === 'month') {
      const anyDays = workersForSchedule.some(
        (worker) => (workerDays[worker.workerId] ?? DEFAULT_WORK_DAYS).length > 0
      );
      if (!anyDays) {
        Alert.alert(
          'Select days',
          'Mark at least one working day for the selected employees.'
        );
        return;
      }
    }

    if (assignMode === 'continue') {
      if (previousShifts.length === 0) {
        Alert.alert(
          'No previous schedule',
          `${monthLabel(
            previousMonth(monthDate)
          )} has no shifts to continue.`
        );
        return;
      }
      const result = buildContinuationSchedule({
        monthDate,
        workers: workersForSchedule,
        previousShifts,
        leaveRequests,
        existingShifts: shifts,
        assignedBy: myName,
        skipPastDates,
      });
      confirmAndCreate(result);
      return;
    }

    const result = buildMonthSchedule({
      monthDate,
      weekdayOffsets: [],
      daysByWorker: workerDays,
      workers: workersForSchedule,
      leaveRequests,
      existingShifts: shifts,
      officeStart: settings.officeStart,
      officeEnd: settings.officeEnd,
      assignedBy: myName,
      customTimes,
      skipPastDates,
    });
    confirmAndCreate(result);
  };

  const removeShift = (shift: ShiftRecord) => {
    Alert.alert(
      'Remove shift?',
      `${shift.name} on ${formatDateHeading(shift.date)} will be deassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await deleteShift(sheetId, shift);
              await load();
              if (result.failed > 0) {
                Alert.alert('Partly removed', 'The shift may still be in the sheet. Refresh and try again.');
              }
            } catch (error: any) {
              Alert.alert('Could not remove', error?.message || 'Try again.');
            }
          },
        },
      ]
    );
  };

  const clearMonth = () => {
    if (monthShifts.length === 0) return;
    Alert.alert(
      'Clear this month?',
      `${monthShifts.length} shift${
        monthShifts.length === 1 ? '' : 's'
      } in ${monthLabel(monthDate)} will be deassigned. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear month',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await deleteShifts(sheetId, monthShifts);
              await load();
              Alert.alert(
                'Schedule cleared',
                `${result.deleted} shift${
                  result.deleted === 1 ? '' : 's'
                } removed.${
                  result.failed > 0
                    ? ` ${result.failed} could not be removed.`
                    : ''
                }`
              );
            } catch (error: any) {
              Alert.alert('Could not clear', error?.message || 'Try again.');
            }
          },
        },
      ]
    );
  };

  const saveMonthlyPayroll = async () => {
    if (payrollRows.length === 0) {
      Alert.alert('No employees', 'No payroll rows to save.');
      return;
    }
    setPayrollSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        throw new Error('Sign in with Google to save payroll.');
      }
      const result = await savePayroll(sheetId, payrollRows);
      Alert.alert(
        'Payroll saved',
        `${result.created} new row${
          result.created === 1 ? '' : 's'
        } and ${result.updated} updated in the Payroll sheet.${
          result.failed > 0 ? `\n\n${result.failed} failed.` : ''
        }`
      );
    } catch (error: any) {
      Alert.alert(
        'Could not save payroll',
        error?.message || 'Check your connection and try again.'
      );
    } finally {
      setPayrollSaving(false);
    }
  };

  const openShiftEditor = (shift: ShiftRecord) => {
    setEditShift(shift);
    setEditStart(shift.startTime || settings.officeStart);
    setEditEnd(shift.endTime || settings.officeEnd);
  };

  const saveShiftTimes = async () => {
    if (!editShift) return;
    const start = editStart.trim();
    const end = editEnd.trim();
    if (!isValidTime(start) || !isValidTime(end)) {
      Alert.alert('Invalid time', 'Use 24-hour times like 09:00 and 17:00.');
      return;
    }
    const from = timeToMinutes(start);
    const to = timeToMinutes(end);
    if (from === null || to === null || to <= from) {
      Alert.alert('Invalid time', 'The end time must be after the start time.');
      return;
    }
    setEditSaving(true);
    try {
      await updateShiftTimes(sheetId, editShift, start, end);
      await load();
      setEditShift(null);
      Alert.alert('Shift updated', `${editShift.name} now works ${start}–${end}.`);
    } catch (error: any) {
      Alert.alert('Could not update shift', error?.message || 'Try again.');
    } finally {
      setEditSaving(false);
    }
  };

  if (!loading && !canManage) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="lock-outline" size={40} color="#94A3B8" />
        <Text style={styles.emptyTitle}>Admin / manager access only</Text>
        <Text style={styles.emptyText}>
          Only admins and managers can assign or deassign schedules.
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
          <Text style={[styles.title, { color: theme.headerText }]}>
            Schedule
          </Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            Assign, deassign and save monthly payroll
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => void load(true)}
          disabled={refreshing}
          accessibilityLabel="Refresh schedule"
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
          <Text style={styles.loadingText}>Loading schedule…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              colors={[theme.accent]}
            />
          }
        >
          <View style={styles.monthBar}>
            <TouchableOpacity
              style={styles.monthNavButton}
              onPress={() => changeMonth(-1)}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={22}
                color="#475569"
              />
            </TouchableOpacity>
            <View style={styles.monthInfo}>
              <Text style={styles.monthTitle}>{monthLabel(monthDate)}</Text>
              <Text style={styles.monthSubtitle}>
                {monthShifts.length} shift{monthShifts.length === 1 ? '' : 's'} ·{' '}
                {scheduledEmployeeCount} employee
                {scheduledEmployeeCount === 1 ? '' : 's'} ·{' '}
                {scheduledHours.toFixed(1)}h
              </Text>
            </View>
            <TouchableOpacity
              style={styles.monthNavButton}
              onPress={() => changeMonth(1)}
            >
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color="#475569"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.primaryAction, { backgroundColor: theme.accent }]}
              onPress={() => openAssign('month')}
            >
              <MaterialCommunityIcons
                name={monthShifts.length > 0 ? 'calendar-edit' : 'calendar-plus'}
                size={17}
                color="#fff"
              />
              <Text style={styles.primaryActionText}>
                {monthShifts.length > 0 ? 'Add shifts' : 'Assign schedule'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={() => openAssign('continue')}
            >
              <MaterialCommunityIcons
                name="calendar-sync-outline"
                size={17}
                color={theme.accent}
              />
              <Text style={[styles.secondaryActionText, { color: theme.accent }]}>
                Continue last month
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.officeCard}>
            <MaterialCommunityIcons name="clock-outline" size={16} color="#64748B" />
            <Text style={styles.officeText}>
              Office hours {settings.officeStart}–{settings.officeEnd} ·{' '}
              {settings.dailyWorkHours}h/day. Employees on leave and already
              scheduled days are skipped automatically.
            </Text>
          </View>

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Scheduled shifts</Text>
              <Text style={styles.sectionSubtitle}>
                Tap the bin to deassign a shift
              </Text>
            </View>
            {monthShifts.length > 0 && (
              <TouchableOpacity onPress={clearMonth}>
                <Text style={styles.clearText}>Clear month</Text>
              </TouchableOpacity>
            )}
          </View>

          {monthShifts.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons
                name="calendar-blank-outline"
                size={30}
                color="#94A3B8"
              />
              <Text style={styles.emptyText}>
                No schedule for {monthLabel(monthDate)} yet. Tap Assign schedule
                to create it, or continue the previous month.
              </Text>
            </View>
          ) : (
            Object.entries(shiftsByDate)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, dayShifts]) => (
                <View key={date} style={styles.dayGroup}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayTitle}>{formatDateHeading(date)}</Text>
                    <Text style={styles.dayCount}>
                      {dayShifts.length} shift
                      {dayShifts.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {dayShifts
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((shift) => (
                      <View key={shift.id} style={styles.shiftRow}>
                        <View
                          style={[
                            styles.shiftAvatar,
                            { backgroundColor: theme.accentSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.shiftInitials,
                              { color: theme.accentDark },
                            ]}
                          >
                            {initials(shift.name)}
                          </Text>
                        </View>
                        <View style={styles.shiftInfo}>
                          <Text style={styles.shiftName} numberOfLines={1}>
                            {shift.name}
                          </Text>
                          <Text style={styles.shiftTime}>
                            {shift.startTime} – {shift.endTime}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.timeButton}
                          onPress={() => openShiftEditor(shift)}
                          accessibilityLabel="Edit shift time"
                        >
                          <MaterialCommunityIcons
                            name="clock-edit-outline"
                            size={16}
                            color="#475569"
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => removeShift(shift)}
                          accessibilityLabel="Deassign shift"
                        >
                          <MaterialCommunityIcons
                            name="trash-can-outline"
                            size={17}
                            color="#DC2626"
                          />
                        </TouchableOpacity>
                      </View>
                    ))}
                </View>
              ))
          )}

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Payroll & performance</Text>
              <Text style={styles.sectionSubtitle}>
                Tallied with shifts, clock in/out and office timings
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: theme.accent }]}
              onPress={() => void saveMonthlyPayroll()}
              disabled={payrollSaving}
            >
              {payrollSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name="content-save-outline"
                    size={14}
                    color="#fff"
                  />
                  <Text style={styles.saveButtonText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {payrollRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No employees to calculate.</Text>
            </View>
          ) : (
            payrollRows.map((row) => (
              <View key={row.workerId} style={styles.payrollCard}>
                <View style={styles.payrollTop}>
                  <View
                    style={[
                      styles.shiftAvatar,
                      { backgroundColor: theme.accentSoft },
                    ]}
                  >
                    <Text
                      style={[
                        styles.shiftInitials,
                        { color: theme.accentDark },
                      ]}
                    >
                      {initials(row.name)}
                    </Text>
                  </View>
                  <View style={styles.payrollInfo}>
                    <Text style={styles.payrollName} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={styles.payrollMeta}>
                      Scheduled {row.scheduledDays}d · {row.scheduledHours.toFixed(1)}h
                      · Worked {row.daysWorked}d · {row.hoursWorked.toFixed(1)}h
                    </Text>
                  </View>
                  <Text style={styles.payrollPay}>{formatMoney(row.pay)}</Text>
                </View>
                <View style={styles.payrollStats}>
                  <View style={styles.payrollStat}>
                    <Text style={styles.payrollStatValue}>{row.onTimeRate}%</Text>
                    <Text style={styles.payrollStatLabel}>On time</Text>
                  </View>
                  <View style={styles.payrollDivider} />
                  <View style={styles.payrollStat}>
                    <Text style={styles.payrollStatValue}>{row.lateCount}</Text>
                    <Text style={styles.payrollStatLabel}>Late</Text>
                  </View>
                  <View style={styles.payrollDivider} />
                  <View style={styles.payrollStat}>
                    <Text style={styles.payrollStatValue}>
                      {row.payPerHour.toFixed(2)}
                    </Text>
                    <Text style={styles.payrollStatLabel}>Rate / h</Text>
                  </View>
                  <View style={styles.payrollDivider} />
                  <View style={styles.payrollStat}>
                    <Text style={styles.payrollStatValue}>
                      {row.scheduledDays > 0
                        ? Math.round(
                            (row.daysWorked / row.scheduledDays) * 100
                          )
                        : 0}
                      %
                    </Text>
                    <Text style={styles.payrollStatLabel}>Attended</Text>
                  </View>
                </View>
              </View>
            ))
          )}

          <View style={styles.footerNote}>
            <MaterialCommunityIcons
              name="information-outline"
              size={13}
              color="#94A3B8"
            />
            <Text style={styles.footerNoteText}>
              Saving payroll writes one row per employee and month to the
              Payroll sheet. Re-saving updates the same rows instead of
              duplicating them. Run it after clock-outs for final figures.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Edit a single shift */}
      <Modal
        visible={!!editShift}
        transparent
        animationType="fade"
        onRequestClose={() => !editSaving && setEditShift(null)}
      >
        <View style={styles.centeredOverlay}>
          <View style={styles.editCard}>
            <Text style={styles.modalTitle}>Shift time</Text>
            <Text style={styles.modalHint}>
              {editShift
                ? `${editShift.name} · ${formatDateHeading(editShift.date)}`
                : ''}
            </Text>
            <View style={styles.editTimeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.editLabel}>Start</Text>
                <TextInput
                  style={styles.editInput}
                  value={editStart}
                  onChangeText={setEditStart}
                  placeholder="09:00"
                  placeholderTextColor="#94A3B8"
                  maxLength={5}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.editLabel}>End</Text>
                <TextInput
                  style={styles.editInput}
                  value={editEnd}
                  onChangeText={setEditEnd}
                  placeholder="17:00"
                  placeholderTextColor="#94A3B8"
                  maxLength={5}
                />
              </View>
            </View>
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancel}
                onPress={() => !editSaving && setEditShift(null)}
                disabled={editSaving}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveButton, { backgroundColor: theme.accent }]}
                onPress={() => void saveShiftTimes()}
                disabled={editSaving}
              >
                {editSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.editSaveText}>Save time</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Assign modal */}
      <Modal
        visible={assignVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !assignBusy && setAssignVisible(false)}
      >
        <View style={styles.assignOverlay}>
          <View style={styles.assignCard}>
            <View style={styles.assignHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign schedule</Text>
                <Text style={styles.modalHint}>
                  {monthLabel(monthDate)} · office {settings.officeStart}–
                  {settings.officeEnd}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => !assignBusy && setAssignVisible(false)}
                disabled={assignBusy}
              >
                <MaterialCommunityIcons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  assignMode === 'month' && {
                    backgroundColor: theme.accentSoft,
                    borderColor: theme.accentBorder,
                  },
                ]}
                onPress={() => setAssignMode('month')}
                disabled={assignBusy}
              >
                <Text
                  style={[
                    styles.modeText,
                    assignMode === 'month' && { color: theme.accentDark },
                  ]}
                >
                  Generate month
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  assignMode === 'continue' && {
                    backgroundColor: theme.accentSoft,
                    borderColor: theme.accentBorder,
                  },
                ]}
                onPress={() => setAssignMode('continue')}
                disabled={assignBusy}
              >
                <Text
                  style={[
                    styles.modeText,
                    assignMode === 'continue' && { color: theme.accentDark },
                  ]}
                >
                  Continue previous
                </Text>
              </TouchableOpacity>
            </View>

            {assignMode === 'month' ? (
              <Text style={styles.assignHint}>
                Tick the days each employee works. Use Time to override office
                hours individually.
              </Text>
            ) : (
              <Text style={styles.assignHint}>
                Continues the previous month&apos;s days and times for the
                employees you tick below.
              </Text>
            )}

            {assignMode === 'month' ? (
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Skip past dates</Text>
                  <Text style={styles.switchSubtitle}>
                    Only create shifts from today onward
                  </Text>
                </View>
                <Switch
                  value={skipPastDates}
                  onValueChange={setSkipPastDates}
                  disabled={assignBusy}
                  trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                  thumbColor={skipPastDates ? theme.accent : '#F8FAFC'}
                />
              </View>
            ) : (
              <View style={styles.continueBox}>
                <MaterialCommunityIcons
                  name="calendar-sync-outline"
                  size={18}
                  color={theme.accent}
                />
                <Text style={styles.continueText}>
                  Copies {monthLabel(previousMonth(monthDate))} shifts for the
                  selected employees into {monthLabel(monthDate)}, keeping the
                  same day of month and times. Leave and existing shifts are
                  skipped.
                </Text>
              </View>
            )}

            <View style={styles.assignListHeader}>
              <Text style={styles.fieldLabel}>Employees</Text>
              <TouchableOpacity
                onPress={() =>
                  setSelectedWorkerIds(
                    selectedWorkerIds.length === teamWorkers.length
                      ? []
                      : teamWorkers.map((worker) => worker.WorkerID)
                  )
                }
                disabled={assignBusy}
              >
                <Text style={[styles.selectAll, { color: theme.accent }]}>
                  {selectedWorkerIds.length === teamWorkers.length
                    ? 'Clear all'
                    : 'Select all'}
                </Text>
              </TouchableOpacity>
            </View>

            {assignMode === 'month' && (
              <View style={styles.quickDaysRow}>
                <TouchableOpacity
                  style={styles.quickDaysLink}
                  onPress={() => applyDaysToAll([0, 1, 2, 3, 4])}
                  disabled={assignBusy}
                >
                  <Text style={[styles.quickDaysText, { color: theme.accent }]}>
                    Mon–Fri all
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickDaysLink}
                  onPress={() => applyDaysToAll([0, 1, 2, 3, 4, 5])}
                  disabled={assignBusy}
                >
                  <Text style={[styles.quickDaysText, { color: theme.accent }]}>
                    Mon–Sat all
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickDaysLink}
                  onPress={() => applyDaysToAll([])}
                  disabled={assignBusy}
                >
                  <Text style={styles.quickDaysClear}>Clear days</Text>
                </TouchableOpacity>
              </View>
            )}

            <ScrollView
              style={styles.assignList}
              showsVerticalScrollIndicator={false}
            >
              {teamWorkers.map((worker) => {
                const selected = selectedWorkerIds.includes(worker.WorkerID);
                const override = customTimes[worker.WorkerID];
                const editing = timeEditorWorkerId === worker.WorkerID;
                const days = workerDays[worker.WorkerID] ?? DEFAULT_WORK_DAYS;
                return (
                  <View key={worker.WorkerID} style={styles.workerRow}>
                    <View style={styles.workerTop}>
                      <TouchableOpacity
                        style={styles.workerMain}
                        onPress={() => toggleWorker(worker.WorkerID)}
                        disabled={assignBusy}
                      >
                        <MaterialCommunityIcons
                          name={
                            selected
                              ? 'checkbox-marked'
                              : 'checkbox-blank-outline'
                          }
                          size={21}
                          color={selected ? theme.accent : '#94A3B8'}
                        />
                        <View style={styles.workerInfo}>
                          <Text style={styles.workerName} numberOfLines={1}>
                            {worker.Name || worker.WorkerID}
                          </Text>
                          <Text style={styles.workerMeta} numberOfLines={1}>
                            {worker.Designation || 'Employee'} ·{' '}
                            {assignMode === 'continue'
                              ? 'uses last month days & times'
                              : override
                              ? `${override.start}–${override.end} custom`
                              : `${settings.officeStart}–${settings.officeEnd} office`}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {assignMode === 'month' && (
                        <TouchableOpacity
                          style={styles.timeButton}
                          onPress={() => openTimeEditor(worker)}
                          disabled={assignBusy}
                        >
                          <MaterialCommunityIcons
                            name="clock-edit-outline"
                            size={15}
                            color={theme.accent}
                          />
                          <Text
                            style={[
                              styles.timeButtonText,
                              { color: theme.accent },
                            ]}
                          >
                            Time
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {assignMode === 'month' && (
                      <>
                        <View style={styles.workerDayRow}>
                          {WEEKDAY_SHORT.map((label, offset) => {
                            const active = days.includes(offset);
                            return (
                              <TouchableOpacity
                                key={label}
                                style={[
                                  styles.workerDayChip,
                                  active && {
                                    backgroundColor: theme.accentSoft,
                                    borderColor: theme.accentBorder,
                                  },
                                ]}
                                onPress={() =>
                                  toggleWorkerDay(worker.WorkerID, offset)
                                }
                                disabled={assignBusy}
                              >
                                <Text
                                  style={[
                                    styles.workerDayText,
                                    active && { color: theme.accentDark },
                                  ]}
                                >
                                  {label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                          <Text style={styles.workerDayCount}>
                            {days.length} day{days.length === 1 ? '' : 's'}
                          </Text>
                        </View>

                        {editing && (
                          <View style={styles.timeEditor}>
                            <TextInput
                              style={styles.timeInput}
                              value={timeDraftStart}
                              onChangeText={setTimeDraftStart}
                              placeholder="09:00"
                              placeholderTextColor="#94A3B8"
                              maxLength={5}
                            />
                            <Text style={styles.timeDash}>–</Text>
                            <TextInput
                              style={styles.timeInput}
                              value={timeDraftEnd}
                              onChangeText={setTimeDraftEnd}
                              placeholder="17:00"
                              placeholderTextColor="#94A3B8"
                              maxLength={5}
                            />
                            <TouchableOpacity
                              style={[
                                styles.timeSave,
                                { backgroundColor: theme.accent },
                              ]}
                              onPress={() => saveTimeEditor(worker.WorkerID)}
                            >
                              <Text style={styles.timeSaveText}>Set</Text>
                            </TouchableOpacity>
                            {!!override && (
                              <TouchableOpacity
                                style={styles.timeReset}
                                onPress={() =>
                                  resetTimeEditor(worker.WorkerID)
                                }
                              >
                                <Text style={styles.timeResetText}>Office</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.assignFooter}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => !assignBusy && setAssignVisible(false)}
                disabled={assignBusy}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.generateButton,
                  { backgroundColor: theme.accent, opacity: assignBusy ? 0.6 : 1 },
                ]}
                onPress={generate}
                disabled={assignBusy}
              >
                {assignBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.generateText}>
                    {assignMode === 'continue'
                      ? 'Continue schedule'
                      : 'Create schedule'}
                  </Text>
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
  content: { padding: 16, paddingBottom: 70 },

  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 10,
  },
  monthNavButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthInfo: { flex: 1, alignItems: 'center' },
  monthTitle: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  monthSubtitle: { fontSize: 9.5, color: '#94A3B8', marginTop: 2 },

  actionRow: { flexDirection: 'row', marginTop: 10 },
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
  },
  primaryActionText: { color: '#fff', fontSize: 12, fontWeight: '800', marginLeft: 5 },
  secondaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#fff',
  },
  secondaryActionText: { fontSize: 11, fontWeight: '800', marginLeft: 5 },

  officeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  officeText: {
    flex: 1,
    fontSize: 9.5,
    color: '#64748B',
    lineHeight: 14,
    marginLeft: 6,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  sectionSubtitle: { fontSize: 9.5, color: '#94A3B8', marginTop: 2 },
  clearText: { fontSize: 10.5, fontWeight: '800', color: '#DC2626' },

  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 22,
  },

  dayGroup: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dayTitle: { fontSize: 11.5, fontWeight: '800', color: '#334155' },
  dayCount: { fontSize: 9, color: '#94A3B8', fontWeight: '700' },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  shiftAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftInitials: { fontSize: 11, fontWeight: '800' },
  shiftInfo: { flex: 1, marginLeft: 8 },
  shiftName: { fontSize: 11.5, fontWeight: '800', color: '#1E293B' },
  shiftTime: { fontSize: 9.5, color: '#64748B', marginTop: 1 },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },

  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  saveButtonText: { color: '#fff', fontSize: 10, fontWeight: '800', marginLeft: 4 },

  payrollCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  payrollTop: { flexDirection: 'row', alignItems: 'center' },
  payrollInfo: { flex: 1, marginLeft: 8 },
  payrollName: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  payrollMeta: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  payrollPay: { fontSize: 13, fontWeight: '800', color: '#15803D' },
  payrollStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 9,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  payrollStat: { flex: 1, alignItems: 'center' },
  payrollStatValue: { fontSize: 11.5, fontWeight: '800', color: '#1E293B' },
  payrollStatLabel: { fontSize: 8.5, color: '#94A3B8', marginTop: 2 },
  payrollDivider: { width: 1, height: 20, backgroundColor: '#F1F5F9' },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    marginTop: 8,
  },
  footerNoteText: {
    flex: 1,
    fontSize: 9.5,
    color: '#94A3B8',
    lineHeight: 14,
    marginLeft: 5,
  },

  centeredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  editCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
  },
  editTimeRow: { flexDirection: 'row', marginTop: 12 },
  editLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
    color: '#1E293B',
    textAlign: 'center',
  },
  editActions: { flexDirection: 'row', marginTop: 16 },
  editCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  editCancelText: { fontSize: 12, fontWeight: '800', color: '#475569' },
  editSaveButton: {
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
  },
  editSaveText: { color: '#fff', fontSize: 12, fontWeight: '800' },

  assignOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.5)',
    justifyContent: 'flex-end',
  },  assignCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    paddingBottom: 26,
    maxHeight: '94%',
  },
  assignHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  modalHint: { fontSize: 10.5, color: '#64748B', marginTop: 3 },
  modeRow: { flexDirection: 'row', marginTop: 12 },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    marginRight: 6,
  },
  modeText: { fontSize: 10.5, fontWeight: '800', color: '#64748B' },
  assignHint: {
    fontSize: 9.5,
    color: '#64748B',
    lineHeight: 14,
    marginTop: 10,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 5,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 9,
  },
  switchTitle: { fontSize: 11, fontWeight: '800', color: '#334155' },
  switchSubtitle: { fontSize: 9, color: '#94A3B8', marginTop: 1 },
  continueBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  continueText: {
    flex: 1,
    fontSize: 10,
    color: '#64748B',
    lineHeight: 15,
    marginLeft: 7,
  },
  assignListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectAll: { fontSize: 10, fontWeight: '800' },
  quickDaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 2,
  },
  quickDaysLink: { marginRight: 12, paddingVertical: 2 },
  quickDaysText: { fontSize: 9.5, fontWeight: '800' },
  quickDaysClear: { fontSize: 9.5, fontWeight: '800', color: '#DC2626' },
  assignList: { maxHeight: 300 },
  workerRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 9,
  },
  workerTop: { flexDirection: 'row', alignItems: 'center' },
  workerMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  workerInfo: { flex: 1, marginLeft: 8 },
  workerName: { fontSize: 12, fontWeight: '800', color: '#1E293B' },
  workerMeta: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  workerDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 7,
    marginLeft: 29,
  },
  workerDayChip: {
    width: 26,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 3,
    backgroundColor: '#fff',
  },
  workerDayText: { fontSize: 8.5, fontWeight: '800', color: '#64748B' },
  workerDayCount: {
    fontSize: 8.5,
    color: '#94A3B8',
    marginLeft: 5,
    fontWeight: '700',
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 5,
    marginLeft: 6,
  },
  timeButtonText: { fontSize: 9.5, fontWeight: '800', marginLeft: 3 },
  timeEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 7,
    marginLeft: 29,
  },
  timeInput: {
    width: 54,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontSize: 11,
    color: '#1E293B',
    textAlign: 'center',
    backgroundColor: '#F8FAFC',
  },
  timeDash: { marginHorizontal: 4, color: '#94A3B8' },
  timeSave: {
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginLeft: 5,
  },
  timeSaveText: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
  timeReset: { paddingHorizontal: 7, paddingVertical: 6 },
  timeResetText: { fontSize: 9.5, color: '#64748B', fontWeight: '700' },

  assignFooter: { flexDirection: 'row', marginTop: 12 },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  cancelText: { fontSize: 12, fontWeight: '800', color: '#475569' },
  generateButton: {
    flex: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
  },
  generateText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
