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
import { computeHoursWorked } from '@/src/utils/attendance';
import { getRoleTheme } from '@/assets/constants/roleTheme';

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
const MONTHS_SHORT = MONTHS.map((month) => month.slice(0, 3));
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(
    2,
    '0'
  )}`;
}

function parseDate(value: string): { year: number; month: number } | null {
  const parts = (value || '').split('-');
  if (parts.length < 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
}

export default function ClockHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ workerId?: string }>();
  const user = useSelector((state: RootState) => state.user);
  const routeWorkerId = (params.workerId || '').trim();

  const [clockings, setClockings] = useState<SheetRow[]>([]);
  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const viewerRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        user.workerProfile?.workerId,
        user.email || user.workerProfile?.email
      ),
    [workers, user.workerProfile?.workerId, user.email, user.workerProfile?.email]
  );

  const targetRow = useMemo(
    () =>
      routeWorkerId
        ? workers.find((row) => row.WorkerID === routeWorkerId)
        : viewerRow,
    [workers, routeWorkerId, viewerRow]
  );

  const myWorkerId =
    routeWorkerId || user.workerProfile?.workerId || viewerRow?.WorkerID || '';

  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    viewerRow
  );
  const theme = getRoleTheme(designation, designation === 'employee');
  const targetName = targetRow?.Name || '';

  const fetchData = useCallback(async () => {
    if (!sheetId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [clockingRows, workerRows] = await Promise.all([
        fetchSheetRows(sheetId, 'Clockings'),
        fetchSheetRows(sheetId, 'Workers'),
      ]);
      setClockings(clockingRows);
      setWorkers(workerRows);
    } catch (error) {
      console.error('Error loading clock history:', error);
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

  const myClockings = useMemo(() => {
    if (!myWorkerId) return [];
    return clockings
      .filter((row) => row.WorkerID === myWorkerId && row.ClockIn)
      .sort(
        (a, b) =>
          (b.Date || '').localeCompare(a.Date || '') ||
          Number(b._row || 0) - Number(a._row || 0)
      );
  }, [clockings, myWorkerId]);

  const years = useMemo(() => {
    const set = new Set<number>();
    myClockings.forEach((row) => {
      const parsed = parseDate(row.Date);
      if (parsed) set.add(parsed.year);
    });
    if (set.size === 0) set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [myClockings]);

  const yearClockings = useMemo(() => {
    if (selectedYear === null) return [];
    return myClockings.filter((row) => parseDate(row.Date)?.year === selectedYear);
  }, [myClockings, selectedYear]);

  const datesWithData = useMemo(() => {
    if (selectedYear === null || selectedMonth === null) return new Set<string>();
    return new Set(
      myClockings
        .filter((row) => {
          const parsed = parseDate(row.Date);
          return (
            parsed?.year === selectedYear && parsed?.month === selectedMonth
          );
        })
        .map((row) => row.Date)
    );
  }, [myClockings, selectedYear, selectedMonth]);

  const monthCounts = useMemo(() => {
    const counts = Array(12).fill(0);
    yearClockings.forEach((row) => {
      const parsed = parseDate(row.Date);
      if (parsed) counts[parsed.month] += 1;
    });
    return counts;
  }, [yearClockings]);

  const calendarCells = useMemo(() => {
    if (selectedYear === null || selectedMonth === null) return [];
    const firstWeekday = new Date(selectedYear, selectedMonth, 1).getDay();
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(dateKey(selectedYear, selectedMonth, day));
    }
    return cells;
  }, [selectedYear, selectedMonth]);

  const selectedRows = useMemo(() => {
    if (!selectedDate) return [];
    return myClockings
      .filter((row) => row.Date === selectedDate)
      .sort((a, b) => (a.ClockIn || '').localeCompare(b.ClockIn || ''));
  }, [myClockings, selectedDate]);

  const selectedDayHours = useMemo(() => {
    return selectedRows.reduce((total, row) => {
      if (row.ClockOut) {
        return total + (parseFloat(row.HoursWorked || '0') || 0);
      }
      return (
        total +
        computeHoursWorked(
          row.ClockIn,
          null,
          parseFloat(row.BreakMins || '0') || 0
        )
      );
    }, 0);
  }, [selectedRows]);

  const chooseYear = (year: number) => {
    setSelectedYear(year);
    setSelectedMonth(null);
    setSelectedDate(null);
  };

  const chooseMonth = (month: number) => {
    setSelectedMonth(month);
    setSelectedDate(null);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.accent} />
        <Text style={styles.loadingText}>Loading clock history…</Text>
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
            Clock History
          </Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            {targetName ? `${targetName} · ` : ''}
            {selectedYear === null
              ? 'pick a year to begin'
              : selectedMonth === null
              ? `${selectedYear} · pick a month`
              : `${MONTHS[selectedMonth]} ${selectedYear}`}
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
        <Text style={styles.stepLabel}>Years</Text>
        <View style={styles.yearRow}>
          {years.map((year) => {
            const active = year === selectedYear;
            return (
              <TouchableOpacity
                key={year}
                style={[
                  styles.yearButton,
                  active && { backgroundColor: theme.accent },
                ]}
                onPress={() => chooseYear(year)}
              >
                <Text
                  style={[
                    styles.yearText,
                    active && { color: '#fff' },
                  ]}
                >
                  {year}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedYear !== null && (
          <>
            <Text style={styles.stepLabel}>Months</Text>
            <View style={styles.monthGrid}>
              {MONTHS_SHORT.map((month, index) => {
                const active = index === selectedMonth;
                const count = monthCounts[index];
                return (
                  <TouchableOpacity
                    key={month}
                    style={[
                      styles.monthButton,
                      active && { backgroundColor: theme.accentSoft },
                      active && { borderColor: theme.accent },
                    ]}
                    onPress={() => chooseMonth(index)}
                  >
                    <Text
                      style={[
                        styles.monthText,
                        active && { color: theme.accentDark, fontWeight: '800' },
                      ]}
                    >
                      {month}
                    </Text>
                    {count > 0 && (
                      <Text
                        style={[
                          styles.monthCount,
                          active && { color: theme.accentDark },
                        ]}
                      >
                        {count}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {selectedYear !== null && selectedMonth !== null && (
          <>
            <View style={styles.calendarHeader}>
              <Text style={styles.stepLabel}>
                {MONTHS[selectedMonth]} {selectedYear}
              </Text>
              <Text style={styles.calendarHint}>
                {datesWithData.size} day{datesWithData.size === 1 ? '' : 's'} with
                records
              </Text>
            </View>
            <View style={styles.calendarCard}>
              <View style={styles.weekdayRow}>
                {WEEKDAYS.map((day, index) => (
                  <View key={`${day}-${index}`} style={styles.weekdayCell}>
                    <Text style={styles.weekdayText}>{day}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {calendarCells.map((date, index) => {
                  if (!date) {
                    return (
                      <View
                        key={`empty-${index}`}
                        style={styles.dayCellWrap}
                      />
                    );
                  }
                  const day = parseInt(date.slice(-2), 10);
                  const hasData = datesWithData.has(date);
                  const active = date === selectedDate;
                  return (
                    <View key={date} style={styles.dayCellWrap}>
                      <TouchableOpacity
                        style={[
                          styles.dayCell,
                          hasData && styles.dayCellWithData,
                          active && {
                            backgroundColor: theme.accentSoft,
                            borderColor: theme.accent,
                          },
                        ]}
                        onPress={() => setSelectedDate(date)}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            active && { color: theme.accentDark, fontWeight: '800' },
                          ]}
                        >
                          {day}
                        </Text>
                        {hasData && !active && <View style={styles.greenDot} />}
                        {active && <View style={styles.blueDot} />}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {selectedDate && (
          <View style={styles.dayDetails}>
            <View style={styles.dayDetailsHeader}>
              <Text style={styles.dayDetailsTitle}>{selectedDate}</Text>
              <Text style={styles.dayTotal}>
                {selectedDayHours.toFixed(2)} h total
              </Text>
            </View>
            {selectedRows.length === 0 ? (
              <Text style={styles.emptyText}>
                No clock-in records for this date.
              </Text>
            ) : (
              selectedRows.map((row, index) => {
                const active = !!row.ClockIn && !row.ClockOut;
                return (
                  <View key={row._row || index} style={styles.sessionRow}>
                    <View style={styles.sessionBadge}>
                      <Text style={styles.sessionBadgeText}>{index + 1}</Text>
                    </View>
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionTimes}>
                        In {row.ClockIn || '--:--'} · Out {row.ClockOut || '--:--'}
                      </Text>
                      <Text style={styles.sessionMeta}>
                        {active
                          ? 'In progress'
                          : `${(
                              parseFloat(row.HoursWorked || '0') || 0
                            ).toFixed(2)} h`}
                        {parseFloat(row.BreakMins || '0') > 0
                          ? ` · ${row.BreakMins} min break`
                          : ''}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {myClockings.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="calendar-blank-outline"
              size={44}
              color="#CBD5E0"
            />
            <Text style={styles.emptyStateText}>
              No clock-in history yet.
            </Text>
          </View>
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
  stepLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 6,
  },
  yearRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  yearButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginRight: 8,
    marginBottom: 8,
  },
  yearText: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  monthButton: {
    width: '23%',
    marginRight: '2%',
    marginBottom: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  monthText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  monthCount: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    marginLeft: 4,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  calendarHint: { fontSize: 10, color: '#94A3B8', marginTop: 6 },
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 10,
    marginBottom: 14,
  },
  weekdayRow: { flexDirection: 'row' },
  weekdayCell: { width: '14.2857%', alignItems: 'center', paddingVertical: 6 },
  weekdayText: { fontSize: 10, fontWeight: '800', color: '#94A3B8' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellWrap: { width: '14.2857%', padding: 2 },
  dayCell: {
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayCellWithData: { backgroundColor: '#F0FDF4' },
  dayText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  greenDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    position: 'absolute',
    bottom: 5,
  },
  blueDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2563EB',
    position: 'absolute',
    bottom: 4,
  },
  dayDetails: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  dayDetailsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 10,
  },
  dayDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayTotal: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563EB',
    marginBottom: 10,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sessionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sessionBadgeText: { fontSize: 10, fontWeight: '800', color: '#2563EB' },
  sessionInfo: { flex: 1 },
  sessionTimes: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  sessionMeta: { fontSize: 11, color: '#64748B', marginTop: 2 },
  emptyText: { fontSize: 12, color: '#94A3B8', paddingVertical: 8 },
  emptyState: { alignItems: 'center', paddingVertical: 50 },
  emptyStateText: { marginTop: 10, fontSize: 12, color: '#94A3B8' },
});
