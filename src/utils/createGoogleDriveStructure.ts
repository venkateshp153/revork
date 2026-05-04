import axios from 'axios';

interface CreateGoogleDriveStructureResult {
  sheetId: string;
  folderId: string;
  joinLink: string;
}

const HEADERS = {
  Workers: ['WorkerID', 'Name', 'Email', 'Phone', 'PayPerHour', 'Designation', 'JoinDate', 'Status'],
  Clockings: ['WorkerID', 'Name', 'Date', 'ClockIn', 'ClockOut', 'BreakMins', 'HoursWorked', 'DayTotal'],
  DrawerMoney: ['WorkerID', 'Name', 'Date', 'DrawerAmount', 'Notes', 'PhotoURL'],
  Notifications: ['NotifID', 'Type', 'ToWorkerID', 'FromUID', 'Title', 'Body', 'Timestamp', 'Read', 'Status'],
  LeaveRequests: ['RequestID', 'WorkerID', 'Name', 'StartDate', 'EndDate', 'Reason', 'Type', 'CoveringWorker', 'Status', 'ReviewedBy', 'ReviewedAt'],
  Shifts: ['ShiftID', 'WorkerID', 'Name', 'Date', 'StartTime', 'EndTime', 'AssignedBy'],
  AuditLog: ['LogID', 'Timestamp', 'UserID', 'UserName', 'Action', 'TargetSheet', 'RowID', 'OldValue', 'NewValue'],
  MyProfile: ['UID', 'Name', 'Email', 'Designation', 'CompanyName', 'CompanyAddress', 'CompanyPhone', 'CompanyEmail', 'SheetID', 'FolderID', 'JoinLink', 'CreatedAt'],
};

export async function createGoogleDriveStructure(
  companyName: string,
  accessToken: string,
  userEmail: string
): Promise<CreateGoogleDriveStructureResult> {
  try {
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const folderResponse = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      {
        name: `${companyName} WorkForce Data`,
        mimeType: 'application/vnd.google-apps.folder',
      },
      { headers: authHeaders }
    );
    const folderId = folderResponse.data.id;
    console.log('Folder created:', folderId);

    const spreadsheetResponse = await axios.post(
      'https://sheets.googleapis.com/v4/spreadsheets',
      {
        properties: {
          title: `${companyName} Records`,
        },
        sheets: [
          { properties: { title: 'MyProfile' } },
          { properties: { title: 'Workers' } },
          { properties: { title: 'Clockings' } },
          { properties: { title: 'DrawerMoney' } },
          { properties: { title: 'Notifications' } },
          { properties: { title: 'LeaveRequests' } },
          { properties: { title: 'Shifts' } },
          { properties: { title: 'AuditLog' } },
        ],
      },
      { headers: authHeaders }
    );
    const sheetId = spreadsheetResponse.data.spreadsheetId;
    console.log('Spreadsheet created:', sheetId);

    await axios.patch(
      `https://www.googleapis.com/drive/v3/files/${sheetId}`,
      {},
      {
        headers: authHeaders,
        params: {
          addParents: folderId,
          removeParents: 'root',
        },
      }
    );
    console.log('Spreadsheet moved to folder');

    const batchUpdateRequests = (Object.keys(HEADERS) as Array<keyof typeof HEADERS>)
      .filter(sheetName => sheetName !== 'MyProfile')
      .map(sheetName => ({
        appendDimension: {
          sheetId: spreadsheetResponse.data.sheets.find(
            (s: any) => s.properties.title === sheetName
          ).properties.sheetId,
          dimension: 'ROWS',
          length: 1,
        },
      }));

    if (batchUpdateRequests.length > 0) {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        { requests: batchUpdateRequests },
        { headers: authHeaders }
      );
    }

    const myProfileSheetId = spreadsheetResponse.data.sheets.find(
      (s: any) => s.properties.title === 'MyProfile'
    ).properties.sheetId;

    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/MyProfile:append`,
      {
        values: [HEADERS.MyProfile],
      },
      {
        headers: authHeaders,
        params: { valueInputOption: 'RAW' },
      }
    );

    for (const sheetName of Object.keys(HEADERS) as Array<keyof typeof HEADERS>) {
      if (sheetName === 'MyProfile') continue;
      
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}:append`,
        {
          values: [HEADERS[sheetName]],
        },
        {
          headers: authHeaders,
          params: { valueInputOption: 'RAW' },
        }
      );
    }
    console.log('Headers written to all sheets');

    await axios.post(
      `https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`,
      {
        type: 'user',
        role: 'writer',
        emailAddress: userEmail,
      },
      { headers: authHeaders }
    );
    console.log('Writer permission granted to admin');

    const shareResponse = await axios.post(
      `https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`,
      {
        type: 'anyone',
        role: 'reader',
      },
      {
        headers: authHeaders,
        params: { sendNotificationEmail: false },
      }
    );
    console.log('Reader permission granted (anyone with link)');

    const fileResponse = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${sheetId}?fields=webViewLink`,
      { headers: authHeaders }
    );
    const webViewLink = fileResponse.data.webViewLink;

    const joinLink = `workforce://join?sheetId=${sheetId}&token=${shareResponse.data.id}&companyId=${userEmail}`;
    console.log('Join link generated:', joinLink);

    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/MyProfile:append`,
      {
        values: [[
          '', '', '', 'admin', companyName, '', '', '', sheetId, folderId, joinLink, new Date().toISOString(),
        ]],
      },
      {
        headers: authHeaders,
        params: { valueInputOption: 'RAW' },
      }
    );

    return { sheetId, folderId, joinLink };
  } catch (error: any) {
    console.error('Error creating Google Drive structure:', error);
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown error';
    throw new Error(`Failed to setup Google Drive: ${errorMessage}`);
  }
}
