import { computeHoursWorked } from './attendance';
import type { SheetRow } from './sheets';

export interface WorkerPerformance {
  sessions: number;
  lateCount: number;
  onTimeRate: number;
  hoursWorked: number;
  payPerHour: number;
  pay: number;
  daysWorked: number;
  assignedHours: number;
  attendanceRate: number;
  breakMins: number;
}

function dayKey(value: string): string {
  return (value || '').slice(0, 10);
}

/**
 * Reusable performance calculation for one worker over a period (normally the
 * current month). Uses the same rules everywhere: late = ClockIn after office
 * start, assigned hours = days worked × daily work hours.
 */
export function computeWorkerPerformance(params: {
  clockings: SheetRow[];
  workerId: string;
  monthStart: string;
  officeStart: string;
  dailyWorkHours: number;
  payPerHour: number;
}): WorkerPerformance {
  const {
    clockings,
    workerId,
    monthStart,
    officeStart,
    dailyWorkHours,
    payPerHour,
  } = params;

  const rows = clockings.filter(
    (row) =>
      row.WorkerID === workerId &&
      !!row.ClockIn &&
      (row.Date || '') >= monthStart
  );

  let hoursWorked = 0;
  let lateCount = 0;
  let breakMins = 0;
  const days = new Set<string>();

  rows.forEach((row) => {
    const closed = !!row.ClockOut;
    const breakForRow = parseFloat(row.BreakMins || '0') || 0;
    breakMins += breakForRow;
    days.add(dayKey(row.Date));

    if (closed) {
      hoursWorked += parseFloat(row.HoursWorked || '0') || 0;
    } else {
      hoursWorked += computeHoursWorked(row.ClockIn, null, breakForRow);
    }

    if (row.ClockIn > officeStart) lateCount += 1;
  });

  const sessions = rows.length;
  const daysWorked = days.size;
  const now = new Date();
  const monthDate = new Date(`${monthStart}T00:00:00`);
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0
  ).getDate();
  const workingDaysSoFar = Math.min(
    daysInMonth,
    now.getMonth() === monthDate.getMonth() &&
      now.getFullYear() === monthDate.getFullYear()
      ? now.getDate()
      : daysInMonth
  );

  return {
    sessions,
    lateCount,
    onTimeRate:
      sessions > 0 ? Math.round(((sessions - lateCount) / sessions) * 100) : 0,
    hoursWorked,
    payPerHour,
    pay: Math.round(hoursWorked * payPerHour * 100) / 100,
    daysWorked,
    assignedHours: Math.round(daysWorked * dailyWorkHours * 100) / 100,
    attendanceRate:
      workingDaysSoFar > 0
        ? Math.round((daysWorked / workingDaysSoFar) * 100)
        : 0,
    breakMins,
  };
}
