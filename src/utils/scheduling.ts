import {
  SHEETS_BASE,
  appendSheetRow,
  appendSheetRowRaw,
  fetchSheetRows,
  getGoogleAccessToken,
  updateSheetRange,
  type SheetRow,
} from './sheets';
import { getSheetDefinition } from '@/src/constants/workspace';
import { localDateString } from './attendance';

/**
 * Weekly scheduling for the team.
 *
 * A shift is one row in the workspace `Shifts` tab (one employee per day).
 * The schedule generator uses the company office hours and each employee's
 * approved leave, so nobody is booked on a day they are unavailable.
 */

export const SHIFTS_SHEET = 'Shifts';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test((value || '').trim());
}

export function timeToMinutes(value: string): number | null {
  if (!isValidTime(value)) return null;
  const [hours, minutes] = value.trim().split(':').map(Number);
  return hours * 60 + minutes;
}

export function shiftHours(start: string, end: string): number {
  const from = timeToMinutes(start);
  const to = timeToMinutes(end);
  if (from === null || to === null || to <= from) return 0;
  return (to - from) / 60;
}

export function monthPrefix(date: Date): string {
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${date.getFullYear()}-${mm}`;
}

export function previousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

export function nextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/** Monday-first weekday offset: Mon=0 … Sun=6. */
export function weekdayOffset(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export interface ShiftRecord {
  id: string;
  workerId: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  assignedBy: string;
  row: number;
}

export interface ScheduleWorker {
  workerId: string;
  name: string;
}

export interface NewShiftInput {
  shiftId: string;
  workerId: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  assignedBy: string;
}

export interface ScheduleBuildResult {
  shifts: NewShiftInput[];
  skippedLeave: number;
  skippedExisting: number;
  skippedPast?: number;
  skippedInvalid?: number;
}

export function makeShiftId(): string {
  return `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shiftFromRow(row: SheetRow): ShiftRecord | null {
  const date = (row.Date || '').trim();
  const workerId = (row.WorkerID || '').trim();
  if (!date || !workerId) return null;
  return {
    id: row.ShiftID || `shift_row_${row._row}`,
    workerId,
    name: row.Name || workerId,
    date,
    startTime: row.StartTime || '',
    endTime: row.EndTime || '',
    assignedBy: row.AssignedBy || '',
    row: Number(row._row) || 0,
  };
}

/** Reads all shifts. A missing tab on older workspaces is treated as empty. */
export async function loadShifts(sheetId: string): Promise<ShiftRecord[]> {
  if (!sheetId) return [];
  try {
    const rows = await fetchSheetRows(sheetId, SHIFTS_SHEET);
    return rows
      .map(shiftFromRow)
      .filter((record): record is ShiftRecord => !!record);
  } catch {
    return [];
  }
}

const ensuredSheets = new Set<string>();

async function spreadsheetHasSheet(
  sheetId: string,
  title: string,
  token: string
): Promise<boolean | null> {
  try {
    const response = await fetch(
      `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.sheets || []).some(
      (sheet: any) => sheet?.properties?.title === title
    );
  } catch {
    return null;
  }
}

/** Adds the Shifts tab to workspaces created before scheduling existed. */
export async function ensureShiftsSheet(
  sheetId: string,
  token: string
): Promise<boolean> {
  if (!sheetId || !token) return false;
  if (ensuredSheets.has(sheetId)) return true;

  const exists = await spreadsheetHasSheet(sheetId, SHIFTS_SHEET, token);
  if (exists === null) return false;

  if (!exists) {
    const createResponse = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: SHIFTS_SHEET } } }],
      }),
    });
    if (!createResponse.ok) {
      const text = await createResponse.text().catch(() => '');
      console.warn('[Shifts] Could not create sheet:', createResponse.status, text);
      return false;
    }

    const headers = getSheetDefinition(SHIFTS_SHEET)?.headers || [];
    if (headers.length > 0) {
      try {
        await appendSheetRowRaw(sheetId, SHIFTS_SHEET, headers, token);
      } catch (error) {
        console.warn('[Shifts] Could not write headers:', error);
      }
    }
  }

  ensuredSheets.add(sheetId);
  return true;
}

export function startOfWeek(date = new Date()): Date {
  const start = new Date(date);
  const day = start.getDay();
  const diff = start.getDate() - day + (day === 0 ? -6 : 1);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function dateKey(date: Date): string {
  return localDateString(date);
}

/** True when an approved/pending leave covers this date. */
export function isWorkerOnLeaveOnDate(
  leaveRequests: SheetRow[],
  workerId: string,
  name: string,
  date: string
): boolean {
  const normalizedName = (name || '').trim().toLowerCase();
  return leaveRequests.some((row) => {
    const status = (row.Status || '').toLowerCase();
    if (status === 'rejected' || status === 'cancelled') return false;
    const start = row.StartDate || '';
    const end = row.EndDate || start;
    if (!start || !(start <= date && end >= date)) return false;
    return (
      (!!workerId && row.WorkerID === workerId) ||
      (!!normalizedName &&
        (row.Name || '').trim().toLowerCase() === normalizedName)
    );
  });
}

/**
 * Builds one shift per employee per selected day. Duplicate worker/date pairs
 * and approved leave are skipped.
 */
export function buildWeekSchedule(params: {
  weekStart: Date;
  dayOffsets: number[];
  workers: ScheduleWorker[];
  leaveRequests: SheetRow[];
  existingShifts: ShiftRecord[];
  officeStart: string;
  officeEnd: string;
  assignedBy: string;
}): ScheduleBuildResult {
  const {
    weekStart,
    dayOffsets,
    workers,
    leaveRequests,
    existingShifts,
    officeStart,
    officeEnd,
    assignedBy,
  } = params;

  const existing = new Set(
    existingShifts.map((shift) => `${shift.workerId}|${shift.date}`)
  );
  const shifts: NewShiftInput[] = [];
  let skippedLeave = 0;
  let skippedExisting = 0;

  const orderedDays = [...new Set(dayOffsets)].sort((a, b) => a - b);

  workers.forEach((worker) => {
    orderedDays.forEach((offset) => {
      const date = dateKey(addDays(weekStart, offset));
      if (isWorkerOnLeaveOnDate(leaveRequests, worker.workerId, worker.name, date)) {
        skippedLeave += 1;
        return;
      }
      const key = `${worker.workerId}|${date}`;
      if (existing.has(key)) {
        skippedExisting += 1;
        return;
      }
      existing.add(key);
      shifts.push({
        shiftId: makeShiftId(),
        workerId: worker.workerId,
        name: worker.name,
        date,
        startTime: officeStart,
        endTime: officeEnd,
        assignedBy,
      });
    });
  });

  return { shifts, skippedLeave, skippedExisting };
}

export interface TimeOverride {
  start: string;
  end: string;
}

/**
 * Builds a full month of shifts. Only the selected weekdays are used; leave,
 * duplicates and (optionally) past dates are skipped. Per-employee custom
 * times fall back to office hours when not provided.
 */
export function buildMonthSchedule(params: {
  monthDate: Date;
  weekdayOffsets?: number[];
  daysByWorker?: Record<string, number[]>;
  workers: ScheduleWorker[];
  leaveRequests: SheetRow[];
  existingShifts: ShiftRecord[];
  officeStart: string;
  officeEnd: string;
  assignedBy: string;
  customTimes?: Record<string, TimeOverride>;
  skipPastDates?: boolean;
}): ScheduleBuildResult {
  const {
    monthDate,
    weekdayOffsets = [],
    daysByWorker = {},
    workers,
    leaveRequests,
    existingShifts,
    officeStart,
    officeEnd,
    assignedBy,
    customTimes = {},
    skipPastDates = false,
  } = params;

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateString();
  const existing = new Set(
    existingShifts.map((shift) => `${shift.workerId}|${shift.date}`)
  );
  const shifts: NewShiftInput[] = [];
  let skippedLeave = 0;
  let skippedExisting = 0;
  let skippedPast = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateObj = new Date(year, month, day);
    const offset = weekdayOffset(dateObj);
    const eligibleWorkers = workers.filter((worker) =>
      (daysByWorker[worker.workerId] ?? weekdayOffsets).includes(offset)
    );
    if (eligibleWorkers.length === 0) continue;

    const date = dateKey(dateObj);
    if (skipPastDates && date < todayKey) {
      skippedPast += 1;
      continue;
    }

    eligibleWorkers.forEach((worker) => {
      if (
        isWorkerOnLeaveOnDate(
          leaveRequests,
          worker.workerId,
          worker.name,
          date
        )
      ) {
        skippedLeave += 1;
        return;
      }
      const key = `${worker.workerId}|${date}`;
      if (existing.has(key)) {
        skippedExisting += 1;
        return;
      }
      existing.add(key);
      const override = customTimes[worker.workerId];
      shifts.push({
        shiftId: makeShiftId(),
        workerId: worker.workerId,
        name: worker.name,
        date,
        startTime: override?.start || officeStart,
        endTime: override?.end || officeEnd,
        assignedBy,
      });
    });
  }

  return { shifts, skippedLeave, skippedExisting, skippedPast, skippedInvalid: 0 };
}

/**
 * Continues last month's schedule into the selected month. Dates keep their
 * day-of-month; employees absent from last month are ignored. Existing shifts
 * are never overwritten.
 */
export function buildContinuationSchedule(params: {
  monthDate: Date;
  workers: ScheduleWorker[];
  previousShifts: ShiftRecord[];
  leaveRequests: SheetRow[];
  existingShifts: ShiftRecord[];
  assignedBy: string;
  skipPastDates?: boolean;
}): ScheduleBuildResult {
  const {
    monthDate,
    workers,
    previousShifts,
    leaveRequests,
    existingShifts,
    assignedBy,
    skipPastDates = false,
  } = params;

  const workerIds = new Set(workers.map((worker) => worker.workerId));
  const previousPrefix = monthPrefix(previousMonth(monthDate));
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const todayKey = localDateString();
  const existing = new Set(
    existingShifts.map((shift) => `${shift.workerId}|${shift.date}`)
  );
  const shifts: NewShiftInput[] = [];
  let skippedLeave = 0;
  let skippedExisting = 0;
  let skippedPast = 0;
  let skippedInvalid = 0;

  previousShifts
    .filter(
      (shift) =>
        workerIds.has(shift.workerId) &&
        shift.date.startsWith(previousPrefix)
    )
    .forEach((previous) => {
      const dayOfMonth = parseInt(previous.date.slice(8, 10), 10);
      if (!Number.isFinite(dayOfMonth)) {
        skippedInvalid += 1;
        return;
      }
      const target = new Date(year, month, dayOfMonth);
      if (target.getMonth() !== month) {
        skippedInvalid += 1;
        return;
      }
      const date = dateKey(target);
      if (skipPastDates && date < todayKey) {
        skippedPast += 1;
        return;
      }
      if (
        isWorkerOnLeaveOnDate(
          leaveRequests,
          previous.workerId,
          previous.name,
          date
        )
      ) {
        skippedLeave += 1;
        return;
      }
      const key = `${previous.workerId}|${date}`;
      if (existing.has(key)) {
        skippedExisting += 1;
        return;
      }
      existing.add(key);
      shifts.push({
        shiftId: makeShiftId(),
        workerId: previous.workerId,
        name: previous.name,
        date,
        startTime: previous.startTime,
        endTime: previous.endTime,
        assignedBy,
      });
    });

  return {
    shifts,
    skippedLeave,
    skippedExisting,
    skippedPast,
    skippedInvalid,
  };
}

/** Clears one or more shift rows in the Shifts sheet. */
export async function deleteShifts(
  sheetId: string,
  shifts: ShiftRecord[]
): Promise<{ deleted: number; failed: number }> {
  if (!sheetId || shifts.length === 0) return { deleted: 0, failed: 0 };
  const token = await getGoogleAccessToken(true);
  const empty = new Array(7).fill('');
  let deleted = 0;
  let failed = 0;

  for (const shift of shifts) {
    if (!shift.row) {
      failed += 1;
      continue;
    }
    try {
      await updateSheetRange(
        sheetId,
        `${SHIFTS_SHEET}!A${shift.row}:G${shift.row}`,
        [empty],
        token
      );
      deleted += 1;
    } catch (error) {
      console.warn('[Shifts] Could not remove shift:', error);
      failed += 1;
    }
  }

  return { deleted, failed };
}

export async function deleteShift(
  sheetId: string,
  shift: ShiftRecord
): Promise<{ deleted: number; failed: number }> {
  return deleteShifts(sheetId, [shift]);
}

/** Changes the start/end time of an existing shift. */
export async function updateShiftTimes(
  sheetId: string,
  shift: ShiftRecord,
  startTime: string,
  endTime: string
): Promise<void> {
  if (!sheetId || !shift.row) {
    throw new Error('Missing shift row.');
  }
  const from = timeToMinutes(startTime);
  const to = timeToMinutes(endTime);
  if (from === null || to === null) {
    throw new Error('Use 24-hour times like 09:00 and 17:00.');
  }
  if (to <= from) {
    throw new Error('The end time must be after the start time.');
  }
  const token = await getGoogleAccessToken(true);
  await updateSheetRange(
    sheetId,
    `${SHIFTS_SHEET}!E${shift.row}:F${shift.row}`,
    [[startTime, endTime]],
    token
  );
}


function rowForShift(shift: NewShiftInput): string[] {
  const headers = getSheetDefinition(SHIFTS_SHEET)?.headers || [];
  const values: Record<string, string> = {
    ShiftID: shift.shiftId,
    WorkerID: shift.workerId,
    Name: shift.name,
    Date: shift.date,
    StartTime: shift.startTime,
    EndTime: shift.endTime,
    AssignedBy: shift.assignedBy,
  };
  return headers.map((header) => values[header] ?? '');
}

/** Writes the generated week schedule (local-first, so it also queues offline). */
export async function createShifts(
  sheetId: string,
  shifts: NewShiftInput[]
): Promise<{ created: number; failed: number }> {
  if (!sheetId || shifts.length === 0) return { created: 0, failed: 0 };
  const token = await getGoogleAccessToken(true);
  if (token) {
    try {
      await ensureShiftsSheet(sheetId, token);
    } catch {
      // The append below reports the real error if the tab stays missing.
    }
  }

  let created = 0;
  let failed = 0;
  for (const shift of shifts) {
    try {
      await appendSheetRow(sheetId, SHIFTS_SHEET, rowForShift(shift), token);
      created += 1;
    } catch (error) {
      console.warn('[Shifts] Could not add shift:', error);
      failed += 1;
    }
  }
  return { created, failed };
}
