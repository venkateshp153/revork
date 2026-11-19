import { getSheetDefinition } from '@/src/constants/workspace';
import { computeHoursWorked, localDateString } from './attendance';
import {
  SHEETS_BASE,
  appendSheetRow,
  appendSheetRowRaw,
  columnLetter,
  fetchSheetRows,
  getGoogleAccessToken,
  updateSheetRange,
  type SheetRow,
} from './sheets';
import {
  monthPrefix,
  shiftHours,
  type ShiftRecord,
} from './scheduling';

/**
 * Monthly payroll + performance snapshots.
 *
 * The schedule (Shifts) is the source of truth for "should have worked",
 * Clockings is the source for "did work", and Workers.PayPerHour turns the
 * hours into pay. Each month's summary is upserted by worker so re-saving
 * never duplicates rows.
 */

export const PAYROLL_SHEET = 'Payroll';

export interface PayrollRow {
  payrollId: string;
  month: string;
  workerId: string;
  name: string;
  scheduledDays: number;
  scheduledHours: number;
  daysWorked: number;
  lateCount: number;
  onTimeRate: number;
  hoursWorked: number;
  payPerHour: number;
  pay: number;
  generatedAt: string;
  generatedBy: string;
}

export interface SavePayrollResult {
  created: number;
  updated: number;
  failed: number;
}

const ensuredSheets = new Set<string>();

function rowHours(row: SheetRow): number {
  if (row.ClockOut) return parseFloat(row.HoursWorked || '0') || 0;
  // Only today's open session is running; a forgotten previous-day clock-out
  // must not inflate the monthly total.
  const today = localDateString();
  if ((row.Date || '') !== today) {
    return parseFloat(row.HoursWorked || '0') || 0;
  }
  return computeHoursWorked(
    row.ClockIn,
    null,
    parseFloat(row.BreakMins || '0') || 0
  );
}

function clockMinutes(value: string): number | null {
  const parts = (value || '').split(':').map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;
  return parts[0] * 60 + parts[1];
}

/** Builds payroll and performance for every non-admin employee. */
export function computeMonthlyPayroll(params: {
  monthDate: Date;
  workers: SheetRow[];
  shifts: ShiftRecord[];
  clockings: SheetRow[];
  officeStart: string;
  generatedBy: string;
}): PayrollRow[] {
  const { monthDate, workers, shifts, clockings, officeStart, generatedBy } =
    params;
  const prefix = monthPrefix(monthDate);
  const generatedAt = new Date().toISOString();

  return workers
    .filter((worker) => (worker.Designation || '').toLowerCase() !== 'admin')
    .filter((worker) => !!worker.WorkerID)
    .map((worker) => {
      const workerShifts = shifts.filter(
        (shift) =>
          shift.workerId === worker.WorkerID &&
          shift.date.startsWith(prefix)
      );
      const scheduledDates = new Set(workerShifts.map((shift) => shift.date));
      const scheduledHours = workerShifts.reduce(
        (sum, shift) => sum + shiftHours(shift.startTime, shift.endTime),
        0
      );

      const workerClockings = clockings.filter(
        (row) =>
          row.WorkerID === worker.WorkerID &&
          (row.Date || '').startsWith(prefix) &&
          !!row.ClockIn
      );

      const byDate = new Map<
        string,
        { firstIn: string; hours: number }
      >();
      workerClockings.forEach((row) => {
        const entry = byDate.get(row.Date) || {
          firstIn: row.ClockIn,
          hours: 0,
        };
        if (!entry.firstIn || row.ClockIn < entry.firstIn) {
          entry.firstIn = row.ClockIn;
        }
        entry.hours += rowHours(row);
        byDate.set(row.Date, entry);
      });

      let lateCount = 0;
      byDate.forEach((entry, date) => {
        const shift = workerShifts.find((item) => item.date === date);
        const expectedStart = clockMinutes(shift?.startTime || officeStart);
        const actualStart = clockMinutes(entry.firstIn);
        if (
          expectedStart !== null &&
          actualStart !== null &&
          actualStart > expectedStart
        ) {
          lateCount += 1;
        }
      });

      const hoursWorked = Array.from(byDate.values()).reduce(
        (sum, entry) => sum + entry.hours,
        0
      );
      const payPerHour = parseFloat(worker.PayPerHour || '0') || 0;
      const clockedDays = byDate.size;

      return {
        payrollId: `payroll_${prefix.replace('-', '')}_${worker.WorkerID}`,
        month: prefix,
        workerId: worker.WorkerID,
        name: worker.Name || worker.WorkerID,
        scheduledDays: scheduledDates.size,
        scheduledHours: Math.round(scheduledHours * 100) / 100,
        daysWorked: clockedDays,
        lateCount,
        onTimeRate:
          clockedDays > 0
            ? Math.round(((clockedDays - lateCount) / clockedDays) * 100)
            : 0,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        payPerHour,
        pay: Math.round(hoursWorked * payPerHour * 100) / 100,
        generatedAt,
        generatedBy,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

/** Adds the Payroll tab for workspaces created before payroll existed. */
export async function ensurePayrollSheet(
  sheetId: string,
  token: string
): Promise<boolean> {
  if (!sheetId || !token) return false;
  if (ensuredSheets.has(sheetId)) return true;

  const exists = await spreadsheetHasSheet(sheetId, PAYROLL_SHEET, token);
  if (exists === null) return false;

  if (!exists) {
    const createResponse = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: PAYROLL_SHEET } } }],
      }),
    });
    if (!createResponse.ok) {
      const text = await createResponse.text().catch(() => '');
      console.warn(
        '[Payroll] Could not create sheet:',
        createResponse.status,
        text
      );
      return false;
    }

    const headers = getSheetDefinition(PAYROLL_SHEET)?.headers || [];
    if (headers.length > 0) {
      try {
        await appendSheetRowRaw(sheetId, PAYROLL_SHEET, headers, token);
      } catch (error) {
        console.warn('[Payroll] Could not write headers:', error);
      }
    }
  }

  ensuredSheets.add(sheetId);
  return true;
}

function rowForPayroll(row: PayrollRow): string[] {
  const headers = getSheetDefinition(PAYROLL_SHEET)?.headers || [];
  const values: Record<string, string> = {
    PayrollID: row.payrollId,
    Month: row.month,
    WorkerID: row.workerId,
    Name: row.name,
    ScheduledDays: `${row.scheduledDays}`,
    ScheduledHours: row.scheduledHours.toFixed(2),
    DaysWorked: `${row.daysWorked}`,
    LateCount: `${row.lateCount}`,
    OnTimeRate: `${row.onTimeRate}`,
    HoursWorked: row.hoursWorked.toFixed(2),
    PayPerHour: row.payPerHour.toFixed(2),
    Pay: row.pay.toFixed(2),
    GeneratedAt: row.generatedAt,
    GeneratedBy: row.generatedBy,
  };
  return headers.map((header) => values[header] ?? '');
}

/** Upserts one row per employee/month so the sheet stays clean. */
export async function savePayroll(
  sheetId: string,
  rows: PayrollRow[]
): Promise<SavePayrollResult> {
  if (!sheetId || rows.length === 0) {
    return { created: 0, updated: 0, failed: 0 };
  }
  const token = await getGoogleAccessToken(true);
  if (token) {
    try {
      await ensurePayrollSheet(sheetId, token);
    } catch {
      // The write below reports the real error if the tab stays missing.
    }
  }

  let existing: SheetRow[] = [];
  try {
    existing = await fetchSheetRows(sheetId, PAYROLL_SHEET);
  } catch {
    existing = [];
  }

  const headers = getSheetDefinition(PAYROLL_SHEET)?.headers || [];
  const lastColumn = columnLetter(headers.length || 14);
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const values = rowForPayroll(row);
    const match = existing.find(
      (item) =>
        (item.Month || '') === row.month &&
        (item.WorkerID || '') === row.workerId
    );
    try {
      if (match && match._row) {
        await updateSheetRange(
          sheetId,
          `${PAYROLL_SHEET}!A${match._row}:${lastColumn}${match._row}`,
          [values],
          token
        );
        updated += 1;
      } else {
        await appendSheetRow(sheetId, PAYROLL_SHEET, values, token);
        created += 1;
      }
    } catch (error) {
      console.warn('[Payroll] Could not save payroll row:', error);
      failed += 1;
    }
  }

  return { created, updated, failed };
}
