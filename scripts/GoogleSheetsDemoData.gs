/**
 * Revork demo-data generator for Google Sheets.
 *
 * HOW TO USE
 * 1. Open your Revork workspace spreadsheet.
 * 2. Extensions → Apps Script.
 * 3. Delete the placeholder code and paste this whole file.
 * 4. Save, then run "seedDemoData".
 * 5. Approve the permission prompt (it only writes to this spreadsheet).
 *
 * A "Demo Data" menu is also added to the spreadsheet:
 *   Demo Data → Fill 28 rows in every main tab
 *   Demo Data → Clear demo rows
 *
 * Demo rows use IDs starting with "DEMO-" so they can be removed safely.
 */

const DEMO_PREFIX = 'DEMO-';
const DEMO_DOMAIN = '@demo.revork.test';
const BASE_LAT = 12.9716;
const BASE_LNG = 77.5946;

/**
 * Optional: only needed when running this script as a standalone project.
 * Normally leave blank and run it from Extensions → Apps Script inside the
 * spreadsheet.
 */
const SPREADSHEET_ID = '';

const SHEET_HEADERS = {
  Workers: [
    'WorkerID', 'Name', 'Email', 'Phone', 'PayPerHour', 'Designation',
    'JoinDate', 'Status', 'Bio', 'PhotoURL', 'EditAccess', 'ReadAccess',
    'Birthday', 'SpotAddress', 'SpotLat', 'SpotLng',
  ],
  Inventory: [
    'ItemID', 'Category', 'ItemName', 'Quantity', 'LowStockAt', 'Notes',
    'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy',
  ],
  DeliveryLocations: [
    'LocationID', 'Address', 'Lat', 'Lng', 'ContactName', 'Phone',
    'OrderCount', 'Notes', 'Status', 'DeliveredAt', 'WorkerID', 'WorkerName',
    'CreatedAt', 'CreatedBy', 'AssignedWorkerID', 'AssignedWorkerName',
    'AssignmentMode', 'AssignedAt', 'AssignedBy', 'UpdatedAt', 'UpdatedBy',
    'Priority',
  ],
  Deliveries: [
    'DeliveryID', 'Date', 'Time', 'RouteID', 'RouteName', 'StopID', 'Name',
    'Phone', 'Address', 'OrderCount', 'Status', 'PhotoCount', 'PhotoFolder',
    'GPS', 'WorkerName', 'WorkerID', 'Notes', 'CreatedAt',
  ],
  Clockings: [
    'WorkerID', 'Name', 'Date', 'ClockIn', 'ClockOut', 'BreakMins',
    'HoursWorked', 'DayTotal',
  ],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Demo Data')
    .addItem('Fill 28 rows in every main tab', 'seedDemoData')
    .addItem('Clear demo rows', 'clearDemoData')
    .addToUi();
}

function seedDemoData() {
  const ss = getSpreadsheet_();
  try {
    clearDemoData();
    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const stamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss');

    const workers = buildWorkers(today, stamp);
    appendObjects_(ss, 'Workers', workers);
    appendObjects_(ss, 'Inventory', buildInventory(stamp));
    appendObjects_(ss, 'DeliveryLocations', buildLocations(workers, stamp));
    appendObjects_(ss, 'Deliveries', buildDeliveries(workers, today, stamp));
    appendObjects_(ss, 'Clockings', buildClockings(workers, today));

    SpreadsheetApp.flush();
    ss.toast(
      'Added 28 demo rows to Workers, Inventory, DeliveryLocations, Deliveries and Clockings.',
      'Revork demo data',
      8
    );
    SpreadsheetApp.getUi().alert(
      'Demo data added',
      '28 test rows were written to Workers, Inventory, DeliveryLocations, Deliveries and Clockings for ' +
        today +
        '. Reload the app to see them.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (error) {
    Logger.log(error && error.stack ? error.stack : error);
    SpreadsheetApp.getUi().alert(
      'Demo data failed',
      (error && error.message ? error.message : String(error)) +
        '\n\nCheck View → Executions for the full log.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

function clearDemoData() {
  const ss = getSpreadsheet_();
  deleteDemoRows_(ss, 'Workers', 'WorkerID');
  deleteDemoRows_(ss, 'Inventory', 'ItemID');
  deleteDemoRows_(ss, 'DeliveryLocations', 'LocationID');
  deleteDemoRows_(ss, 'Deliveries', 'DeliveryID');
  deleteDemoRows_(ss, 'Clockings', 'WorkerID');
  SpreadsheetApp.flush();
  ss.toast('Demo rows removed.', 'Revork demo data', 6);
}

/* ------------------------------------------------------------------ data */

function buildWorkers(today, stamp) {
  const names = [
    'Aarav Sharma', 'Vivaan Patel', 'Aditya Rao', 'Diya Nair',
    'Ananya Iyer', 'Rohan Mehta', 'Ishaan Gupta', 'Kavya Reddy',
    'Arjun Desai', 'Priya Singh', 'Karan Malhotra', 'Neha Joshi',
    'Rahul Verma', 'Sneha Kapoor', 'Vikram Chauhan', 'Pooja Menon',
    'Siddharth Bose', 'Riya Shah', 'Arav Kapoor', 'Meera Pillai',
    'Dev Sharma', 'Tanvi Bhat', 'Kabir Khan', 'Anika Das',
    'Yash Thakur', 'Sara Ali', 'Nitin Yadav', 'Ishita Roy',
  ];

  return names.map((name, index) => {
    const number = pad2(index + 1);
    const first = name.split(' ')[0].toLowerCase();
    const lat = BASE_LAT + (index % 7) * 0.004;
    const lng = BASE_LNG + Math.floor(index / 7) * 0.004;
    return {
      WorkerID: `${DEMO_PREFIX}W${number}`,
      Name: name,
      Email: `${first}.${number}${DEMO_DOMAIN}`,
      Phone: `98765${10000 + index}`,
      PayPerHour: index % 5 === 0 ? '22' : '18',
      Designation: index % 9 === 0 ? 'manager' : 'employee',
      JoinDate: today,
      Status: 'active',
      Bio: 'Demo employee created for testing.',
      PhotoURL: '',
      EditAccess: 'false',
      ReadAccess: 'false',
      Birthday: '',
      SpotAddress: `Demo Spot ${number}, Bengaluru`,
      SpotLat: lat.toFixed(6),
      SpotLng: lng.toFixed(6),
    };
  });
}

function buildInventory(stamp) {
  const items = [
    ['Beverages', 'Cola 500ml', 24, 6, 'Cold drinks'],
    ['Beverages', 'Orange Juice 1L', 12, 4, 'Chilled'],
    ['Beverages', 'Mineral Water 1L', 40, 10, ''],
    ['Beverages', 'Coffee Beans 250g', 5, 6, 'Medium roast'],
    ['Beverages', 'Green Tea 20 bags', 8, 3, ''],
    ['Snacks', 'Potato Chips', 30, 8, 'Salted'],
    ['Snacks', 'Salted Peanuts', 15, 5, ''],
    ['Snacks', 'Chocolate Bar', 4, 6, 'Milk chocolate'],
    ['Snacks', 'Cream Biscuits', 18, 6, ''],
    ['Snacks', 'Instant Noodles', 22, 8, 'Masala'],
    ['Dairy', 'Whole Milk 1L', 10, 12, 'Keep chilled'],
    ['Dairy', 'Butter 250g', 6, 4, ''],
    ['Dairy', 'Cheese Slices', 3, 5, ''],
    ['Dairy', 'Yogurt 500g', 9, 4, ''],
    ['Bakery', 'White Bread', 5, 6, 'Fresh daily'],
    ['Bakery', 'Brown Bread', 7, 4, ''],
    ['Bakery', 'Croissant', 12, 5, ''],
    ['Bakery', 'Muffin', 2, 4, 'Chocolate chip'],
    ['Household', 'Dish Soap', 14, 5, ''],
    ['Household', 'Laundry Detergent', 4, 6, ''],
    ['Household', 'Floor Cleaner', 6, 3, ''],
    ['Household', 'Garbage Bags', 20, 10, 'Medium size'],
    ['Household', 'Paper Towels', 3, 5, ''],
    ['Stationery', 'Ball Pen', 25, 10, 'Blue ink'],
    ['Stationery', 'Notebook A5', 8, 4, 'Ruled'],
    ['Stationery', 'Sticky Notes', 5, 6, ''],
    ['Stationery', 'Marker', 11, 4, 'Black'],
    ['Stationery', 'Printer Paper', 2, 5, 'A4 ream'],
  ];

  return items.map(([category, name, quantity, lowStockAt, notes], index) => ({
    ItemID: `${DEMO_PREFIX}INV${pad2(index + 1)}`,
    Category: category,
    ItemName: name,
    Quantity: String(quantity),
    LowStockAt: String(lowStockAt),
    Notes: notes,
    CreatedAt: stamp,
    CreatedBy: 'Demo Script',
    UpdatedAt: stamp,
    UpdatedBy: 'Demo Script',
  }));
}

function buildLocations(workers, stamp) {
  return Array.from({ length: 28 }, (_, index) => {
    const number = pad2(index + 1);
    const worker = workers[index];
    const lat = BASE_LAT + (index % 7) * 0.003;
    const lng = BASE_LNG + Math.floor(index / 7) * 0.003;
    return {
      LocationID: `${DEMO_PREFIX}LOC${number}`,
      Address: `${index + 1} Demo Street, Sector ${((index % 9) + 1)}, Bengaluru`,
      Lat: lat.toFixed(6),
      Lng: lng.toFixed(6),
      ContactName: worker.Name,
      Phone: worker.Phone,
      OrderCount: String((index % 3) + 1),
      Notes: index % 5 === 0 ? 'Call on arrival' : '',
      Status: 'pending',
      DeliveredAt: '',
      WorkerID: '',
      WorkerName: '',
      CreatedAt: stamp,
      CreatedBy: 'Demo Script',
      AssignedWorkerID: worker.WorkerID,
      AssignedWorkerName: worker.Name,
      AssignmentMode: 'manual',
      AssignedAt: stamp,
      AssignedBy: 'Demo Script',
      UpdatedAt: stamp,
      UpdatedBy: 'Demo Script',
      Priority: index % 7 === 0 ? 'true' : '',
    };
  });
}

function buildDeliveries(workers, today, stamp) {
  return Array.from({ length: 28 }, (_, index) => {
    const number = pad2(index + 1);
    const worker = workers[index];
    return {
      DeliveryID: `${DEMO_PREFIX}DEL${number}`,
      Date: today,
      Time: `${pad2(9 + Math.floor(index / 12))}:${pad2((index * 5) % 60)}`,
      RouteID: `demo-route-${today}`,
      RouteName: `Demo Route ${today}`,
      StopID: `${DEMO_PREFIX}STOP${number}`,
      Name: worker.Name,
      Phone: worker.Phone,
      Address: `${index + 1} Demo Street, Sector ${((index % 9) + 1)}, Bengaluru`,
      OrderCount: String((index % 3) + 1),
      Status: 'Delivered',
      PhotoCount: '1',
      PhotoFolder: `delivered_locations_data/${today}`,
      GPS: `${(BASE_LAT + index * 0.001).toFixed(5)}, ${(BASE_LNG + index * 0.001).toFixed(5)}`,
      WorkerName: worker.Name,
      WorkerID: worker.WorkerID,
      Notes: 'Demo delivery',
      CreatedAt: stamp,
    };
  });
}

function buildClockings(workers, today) {
  return workers.map((worker, index) => {
    const clockIn = `0${8 + (index % 2)}:00`;
    const finished = index % 3 !== 0;
    return {
      WorkerID: worker.WorkerID,
      Name: worker.Name,
      Date: today,
      ClockIn: clockIn,
      ClockOut: finished ? `1${7 + (index % 2)}:00` : '',
      BreakMins: '30',
      HoursWorked: finished ? '8' : '',
      DayTotal: finished ? '8' : '',
    };
  });
}

/* --------------------------------------------------------------- helpers */

function appendObjects_(ss, sheetName, objects) {
  if (!objects || objects.length === 0) return;
  const sheet = ensureTab_(ss, sheetName);
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    throw new Error(`Tab "${sheetName}" has no header row.`);
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const rows = objects.map((object) =>
    headers.map((header) => (object[header] !== undefined ? object[header] : ''))
  );
  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
    .setValues(rows);
}

function deleteDemoRows_(ss, sheetName, idHeader) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return;
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) return;

  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return;
  const values = sheet.getRange(2, 1, rowCount, lastColumn).getValues();

  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index][idIndex] || '').indexOf(DEMO_PREFIX) === 0) {
      sheet.deleteRow(index + 2);
    }
  }
}

function getSpreadsheet_() {
  const active = SpreadsheetApp.getActive();
  if (active) return active;
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  throw new Error(
    'This script is not connected to a spreadsheet. Open your Revork sheet, then use Extensions → Apps Script, or set SPREADSHEET_ID at the top of this script.'
  );
}

function ensureTab_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  const headers = SHEET_HEADERS[sheetName] || [];
  if (sheet.getLastRow() === 0 && headers.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad4(value) {
  return String(value).padStart(4, '0');
}
