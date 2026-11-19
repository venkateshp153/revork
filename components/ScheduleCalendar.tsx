import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export interface CalendarEntry {
  workerId: string;
  name: string;
  startTime?: string;
  endTime?: string;
}

interface ScheduleCalendarProps {
  monthDate: Date;
  entriesByDate: Record<string, CalendarEntry[]>;
  today: string;
  canAssign: boolean;
  isEmployee: boolean;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onAssign: () => void;
  onDayPress: (date: string, entries: CalendarEntry[]) => void;
  /** Button text: Assign when the month is empty, Edit when it has shifts. */
  assignLabel?: string;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
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

function toDateKey(year: number, month: number, day: number): string {
  const mm = `${month + 1}`.padStart(2, '0');
  const dd = `${day}`.padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Stable, distinct color per employee. The same worker always gets the same
 * hue across months and devices because it is derived from the id/name.
 */
function employeeColor(workerId: string, name: string): {
  solid: string;
  soft: string;
} {
  const seedText = workerId || name || 'employee';
  let hash = 0;
  for (let index = 0; index < seedText.length; index += 1) {
    hash = seedText.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.round((Math.abs(hash) * 137.508) % 360);
  return {
    solid: `hsl(${hue}, 62%, 34%)`,
    soft: `hsl(${hue}, 82%, 93%)`,
  };
}

export default function ScheduleCalendar({
  monthDate,
  entriesByDate,
  today,
  canAssign,
  isEmployee,
  accent,
  accentSoft,
  accentBorder,
  onPrevMonth,
  onNextMonth,
  onAssign,
  onDayPress,
  assignLabel = 'Assign',
}: ScheduleCalendarProps) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.monthNav}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={onPrevMonth}
            accessibilityLabel="Previous month"
          >
            <MaterialCommunityIcons name="chevron-left" size={20} color="#475569" />
          </TouchableOpacity>
          <Text style={styles.monthTitle}>
            {MONTHS[month]} {year}
          </Text>
          <TouchableOpacity
            style={styles.navButton}
            onPress={onNextMonth}
            accessibilityLabel="Next month"
          >
            <MaterialCommunityIcons name="chevron-right" size={20} color="#475569" />
          </TouchableOpacity>
        </View>
        {canAssign && (
          <TouchableOpacity
            style={[styles.assignButton, { backgroundColor: accent }]}
            onPress={onAssign}
          >
            <MaterialCommunityIcons
              name="calendar-plus"
              size={15}
              color="#fff"
            />
            <Text style={styles.assignButtonText}>{assignLabel}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((label, index) => (
          <View key={`${label}-${index}`} style={styles.weekdayCell}>
            <Text style={styles.weekdayText}>{label}</Text>
          </View>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={`week-${weekIndex}`} style={styles.weekRow}>
          {week.map((day, dayIndex) => {
            if (day === null) {
              return <View key={`blank-${dayIndex}`} style={styles.blankCell} />;
            }
            const date = toDateKey(year, month, day);
            const entries = entriesByDate[date] || [];
            const isToday = date === today;
            const isWeekend =
              new Date(year, month, day).getDay() === 0 ||
              new Date(year, month, day).getDay() === 6;
            return (
              <TouchableOpacity
                key={date}
                style={[
                  styles.dayCell,
                  isEmployee ? styles.dayCellEmployee : null,
                  isWeekend && styles.dayCellWeekend,
                  isToday && { borderColor: accent, backgroundColor: accentSoft },
                ]}
                onPress={() => onDayPress(date, entries)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    isToday && { color: accent, fontWeight: '800' },
                  ]}
                >
                  {day}
                </Text>

                {isEmployee ? (
                  entries.length > 0 && (
                    <View style={styles.dotsRow}>
                      {entries.slice(0, 3).map((entry, index) => {
                        const color = employeeColor(entry.workerId, entry.name);
                        return (
                          <View
                            key={`${entry.workerId}-${index}`}
                            style={[styles.dot, { backgroundColor: color.solid }]}
                          />
                        );
                      })}
                    </View>
                  )
                ) : (
                  <View style={styles.entriesWrap}>
                    {entries.slice(0, 2).map((entry, index) => {
                      const color = employeeColor(entry.workerId, entry.name);
                      return (
                        <View
                          key={`${entry.workerId}-${index}`}
                          style={[
                            styles.entryChip,
                            {
                              backgroundColor: color.soft,
                              borderColor: color.solid,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.entryName, { color: color.solid }]}
                            numberOfLines={1}
                          >
                            {firstName(entry.name)}
                          </Text>
                        </View>
                      );
                    })}
                    {entries.length > 2 && (
                      <Text style={styles.moreText}>+{entries.length - 2}</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <View style={styles.legend}>
        <MaterialCommunityIcons
          name={isEmployee ? 'circle' : 'account-outline'}
          size={isEmployee ? 8 : 13}
          color={accent}
        />
        <Text style={styles.legendText}>
          {isEmployee
            ? 'A dot marks a day you are scheduled'
            : 'Each employee has a unique color. Tap a date for details.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthNav: { flexDirection: 'row', alignItems: 'center' },
  navButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
    marginHorizontal: 8,
    minWidth: 110,
    textAlign: 'center',
  },
  assignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  assignButtonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 4,
  },
  weekdayRow: { flexDirection: 'row', marginBottom: 3 },
  weekdayCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  weekdayText: { fontSize: 9, fontWeight: '800', color: '#94A3B8' },
  weekRow: { flexDirection: 'row' },
  blankCell: { flex: 1, margin: 2, minHeight: 52 },
  dayCell: {
    flex: 1,
    margin: 2,
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 3,
    backgroundColor: '#FBFCFD',
  },
  dayCellEmployee: { minHeight: 40, justifyContent: 'space-between' },
  dayCellWeekend: { backgroundColor: '#F8FAFC' },
  dayNumber: { fontSize: 10.5, fontWeight: '700', color: '#334155' },
  entriesWrap: { marginTop: 2 },
  entryChip: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 2,
    paddingVertical: 1,
    marginBottom: 1,
  },
  entryName: { fontSize: 7.5, fontWeight: '800' },
  moreText: { fontSize: 7.5, fontWeight: '800', color: '#94A3B8' },
  dotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 2,
    marginBottom: 2,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendText: {
    flex: 1,
    fontSize: 9,
    color: '#94A3B8',
    marginLeft: 5,
  },
});
