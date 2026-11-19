/**
 * Single source of truth for the company workspace spreadsheet.
 * Adding a new sheet/column here automatically creates it on onboarding,
 * includes it in downloads, caching and sync without touching screen code.
 */
export interface SheetDefinition {
  title: string;
  headers: string[];
  /** Rows written right after the header when a workspace is created. */
  seedRows?: string[][];
}

export const WORKSPACE_SHEETS: SheetDefinition[] = [
  {
    title: 'MyProfile',
    headers: [
      'UID',
      'Name',
      'Email',
      'Designation',
      'CompanyName',
      'CompanyAddress',
      'CompanyPhone',
      'CompanyEmail',
      'SheetID',
      'FolderID',
      'JoinLink',
      'CreatedAt',
    ],
  },
  {
    title: 'Workers',
    headers: [
      'WorkerID',
      'Name',
      'Email',
      'Phone',
      'PayPerHour',
      'Designation',
      'JoinDate',
      'Status',
      'Bio',
      'PhotoURL',
      'EditAccess',
      'ReadAccess',
      'Birthday',
      'SpotAddress',
      'SpotLat',
      'SpotLng',
    ],
  },
  {
    title: 'Clockings',
    headers: [
      'WorkerID',
      'Name',
      'Date',
      'ClockIn',
      'ClockOut',
      'BreakMins',
      'HoursWorked',
      'DayTotal',
    ],
  },
  {
    title: 'Deliveries',
    headers: [
      'DeliveryID',
      'Date',
      'Time',
      'RouteID',
      'RouteName',
      'StopID',
      'Name',
      'Phone',
      'Address',
      'OrderCount',
      'Status',
      'PhotoCount',
      'PhotoFolder',
      'GPS',
      'WorkerName',
      'WorkerID',
      'Notes',
      'CreatedAt',
    ],
  },
  {
    /**
     * The shared pool of delivery addresses plus the employee they were
     * delivered by. Pending rows are assigned to employees in the app by
     * matching each address to the closest employee "spot".
     */
    title: 'DeliveryLocations',
    headers: [
      'LocationID',
      'Address',
      'Lat',
      'Lng',
      'ContactName',
      'Phone',
      'OrderCount',
      'Notes',
      'Status',
      'DeliveredAt',
      'WorkerID',
      'WorkerName',
      'CreatedAt',
      'CreatedBy',
    ],
  },
  {
    title: 'DrawerMoney',
    headers: ['WorkerID', 'Name', 'Date', 'DrawerAmount', 'Notes', 'PhotoURL'],
  },
  {
    title: 'Notifications',
    headers: [
      'NotifID',
      'Type',
      'ToWorkerID',
      'FromUID',
      'Title',
      'Body',
      'Timestamp',
      'Read',
      'Status',
      'ExpiresAt',
      'Notes',
    ],
  },
  {
    title: 'LeaveRequests',
    headers: [
      'RequestID',
      'WorkerID',
      'Name',
      'StartDate',
      'EndDate',
      'Reason',
      'Type',
      'CoveringWorker',
      'Status',
      'ReviewedBy',
      'ReviewedAt',
    ],
  },
  {
    title: 'Shifts',
    headers: [
      'ShiftID',
      'WorkerID',
      'Name',
      'Date',
      'StartTime',
      'EndTime',
      'AssignedBy',
    ],
  },
  {
    title: 'Payroll',
    headers: [
      'PayrollID',
      'Month',
      'WorkerID',
      'Name',
      'ScheduledDays',
      'ScheduledHours',
      'DaysWorked',
      'LateCount',
      'OnTimeRate',
      'HoursWorked',
      'PayPerHour',
      'Pay',
      'GeneratedAt',
      'GeneratedBy',
    ],
  },
  {
    title: 'AuditLog',
    headers: [
      'LogID',
      'Timestamp',
      'UserID',
      'UserName',
      'Action',
      'TargetSheet',
      'RowID',
      'OldValue',
      'NewValue',
    ],
  },
  {
    title: 'Settings',
    headers: ['Key', 'Value'],
    seedRows: [
      ['officeStart', '09:00'],
      ['officeEnd', '17:00'],
      ['dailyWorkHours', '8'],
    ],
  },
];

export const WORKSPACE_SHEET_NAMES = WORKSPACE_SHEETS.map((sheet) => sheet.title);

export function getSheetDefinition(title: string): SheetDefinition | undefined {
  return WORKSPACE_SHEETS.find((sheet) => sheet.title === title);
}
