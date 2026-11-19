import {
  appendSheetRow,
  fetchSheetRows,
  updateSheetRange,
  type SheetRow,
} from './sheets';

export interface AttendanceWorker {
  workerId: string;
  name: string;
  payPerHour?: number;
}

export interface TodayAttendance {
  clockIn: string;
  clockOut: string;
  breakMins: number;
  hoursWorked: number;
}

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatClockTime(date = new Date()): string {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/** Parses `HH:MM` / `HH:MM:SS` into milliseconds on the given day. */
function parseTimeOnDate(time: string, date: Date): number | null {
  if (!time) return null;
  const parts = time.split(':').map((part) => parseInt(part, 10));
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) return null;
  const result = new Date(date);
  result.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
  return result.getTime();
}

export function computeHoursWorked(
  clockIn: string,
  clockOut?: string | null,
  breakMins = 0
): number {
  const base = new Date();
  const start = parseTimeOnDate(clockIn, base);
  if (start === null) return 0;
  const end = clockOut
    ? parseTimeOnDate(clockOut, base)
    : base.getTime();
  if (end === null || end <= start) return 0;
  const hours = (end - start) / (1000 * 60 * 60) - breakMins / 60;
  return hours > 0 ? hours : 0;
}

/** Most recent clocking row for this worker on a given date. */
export function findTodayRow(
  rows: SheetRow[],
  workerId: string,
  date = localDateString()
): SheetRow | undefined {
  return rows
    .filter((row) => row.WorkerID === workerId && row.Date === date)
    .sort((a, b) => Number(a._row || 0) - Number(b._row || 0))
    .pop();
}

export function getTodayAttendance(
  rows: SheetRow[],
  workerId: string,
  date = localDateString()
): TodayAttendance | null {
  const row = findTodayRow(rows, workerId, date);
  if (!row || !row.ClockIn) return null;
  const breakMins = parseFloat(row.BreakMins || '0') || 0;
  return {
    clockIn: row.ClockIn,
    clockOut: row.ClockOut || '',
    breakMins,
    hoursWorked: computeHoursWorked(row.ClockIn, row.ClockOut || null, breakMins),
  };
}

/** The currently open (not clocked out) session for today, if any. */
export function getOpenAttendance(
  rows: SheetRow[],
  workerId: string,
  date = localDateString()
): SheetRow | null {
  return (
    rows
      .filter(
        (row) =>
          row.WorkerID === workerId &&
          row.Date === date &&
          row.ClockIn &&
          !row.ClockOut
      )
      .sort((a, b) => Number(a._row || 0) - Number(b._row || 0))
      .pop() || null
  );
}

/** Total hours for one worker on a day, including an open session. */
export function getDayHours(
  rows: SheetRow[],
  workerId: string,
  date = localDateString()
): number {
  return rows
    .filter((row) => row.WorkerID === workerId && row.Date === date && row.ClockIn)
    .reduce((total, row) => {
      if (row.ClockOut) {
        return total + (parseFloat(row.HoursWorked || '0') || 0);
      }
      return (
        total +
        computeHoursWorked(row.ClockIn, null, parseFloat(row.BreakMins || '0') || 0)
      );
    }, 0);
}

/** Appends a new open clock-in row to the Clockings sheet. */
export async function clockInWorker(
  sheetId: string,
  worker: AttendanceWorker,
  token: string | null
): Promise<string> {
  const now = new Date();
  const clockIn = formatClockTime(now);
  await appendSheetRow(
    sheetId,
    'Clockings',
    [worker.workerId, worker.name, localDateString(now), clockIn, '', '0', '', ''],
    token
  );
  return clockIn;
}

/**
 * Closes the open clock-in row for today by rewriting that row with the
 * clock-out time, hours worked and day total.
 */
export async function clockOutWorker(
  sheetId: string,
  worker: AttendanceWorker,
  token: string | null
): Promise<TodayAttendance> {
  const rows = await fetchSheetRows(sheetId, 'Clockings');
  const openRow = rows
    .filter(
      (row) =>
        row.WorkerID === worker.workerId &&
        row.Date === localDateString() &&
        row.ClockIn &&
        !row.ClockOut
    )
    .sort((a, b) => Number(a._row || 0) - Number(b._row || 0))
    .pop();

  if (!openRow || !openRow._row) {
    throw new Error('No open clock-in found for today.');
  }

  const now = new Date();
  const clockOut = formatClockTime(now);
  const breakMins = parseFloat(openRow.BreakMins || '0') || 0;
  const hoursWorked = computeHoursWorked(openRow.ClockIn, clockOut, breakMins);
  const dayTotal = Math.round(hoursWorked * (worker.payPerHour || 0) * 100) / 100;

  await updateSheetRange(
    sheetId,
    `Clockings!A${openRow._row}:H${openRow._row}`,
    [[
      worker.workerId,
      worker.name || openRow.Name || '',
      openRow.Date || localDateString(now),
      openRow.ClockIn,
      clockOut,
      `${breakMins}`,
      hoursWorked.toFixed(2),
      dayTotal.toFixed(2),
    ]],
    token
  );

  return {
    clockIn: openRow.ClockIn,
    clockOut,
    breakMins,
    hoursWorked,
  };
}
