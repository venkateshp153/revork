import axios from 'axios';
import { WORKSPACE_SHEETS } from '@/src/constants/workspace';
import { describeDriveLocation } from './drivePaths';

interface CreateGoogleDriveStructureResult {
  sheetId: string;
  folderId: string;
  joinLink: string;
  folderName: string;
  folderUrl: string;
  folderPath: string;
  sheetUrl: string;
}

export async function createGoogleDriveStructure(
  companyName: string,
  accessToken: string,
  userEmail: string,
  existingFolderId?: string
): Promise<CreateGoogleDriveStructureResult> {
  try {
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const folderName = `${companyName} WorkForce Data`;
    let folderId = existingFolderId || '';

    if (!folderId) {
      const folderResponse = await axios.post(
        'https://www.googleapis.com/drive/v3/files',
        {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
        },
        { headers: authHeaders }
      );
      folderId = folderResponse.data.id;
      console.log('Folder created:', folderId);
    } else {
      console.log('Reusing existing folder:', folderId);
    }

    // All tabs read/write the same schema defined in workspace.ts.
    const spreadsheetResponse = await axios.post(
      'https://sheets.googleapis.com/v4/spreadsheets',
      {
        properties: {
          title: `${companyName} Records`,
        },
        sheets: WORKSPACE_SHEETS.map((sheet) => ({
          properties: { title: sheet.title },
        })),
      },
      { headers: authHeaders }
    );

    const sheetId = spreadsheetResponse.data.spreadsheetId;
    const createdSheets: { properties: { title: string; sheetId: number } }[] =
      spreadsheetResponse.data.sheets || [];
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

    // Give every data tab one empty row so it behaves like a normal sheet.
    const batchUpdateRequests = WORKSPACE_SHEETS.filter(
      (sheet) => sheet.title !== 'MyProfile'
    )
      .map((sheet) => {
        const created = createdSheets.find(
          (item) => item.properties.title === sheet.title
        );
        if (!created) return null;
        return {
          appendDimension: {
            sheetId: created.properties.sheetId,
            dimension: 'ROWS',
            length: 1,
          },
        };
      })
      .filter(Boolean);

    if (batchUpdateRequests.length > 0) {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
        { requests: batchUpdateRequests },
        { headers: authHeaders }
      );
    }

    // Headers + initial seed rows (e.g. default office timings).
    for (const sheet of WORKSPACE_SHEETS) {
      if (sheet.title === 'MyProfile') continue;
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheet.title}:append`,
        { values: [sheet.headers] },
        {
          headers: authHeaders,
          params: { valueInputOption: 'RAW' },
        }
      );

      if (sheet.seedRows && sheet.seedRows.length > 0) {
        await axios.post(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheet.title}:append`,
          { values: sheet.seedRows },
          {
            headers: authHeaders,
            params: { valueInputOption: 'RAW' },
          }
        );
      }
    }
    console.log('Headers and seed rows written to all sheets');

    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/MyProfile:append`,
      {
        values: [
          WORKSPACE_SHEETS.find((sheet) => sheet.title === 'MyProfile')!.headers,
        ],
      },
      {
        headers: authHeaders,
        params: { valueInputOption: 'RAW' },
      }
    );

    if (userEmail) {
      try {
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
      } catch (permissionError: any) {
        // The signed-in account already owns the file, so this is only a
        // convenience grant for the company email. Never fail setup over it.
        console.warn(
          'Could not grant writer permission to the company email:',
          permissionError?.response?.data?.error?.message || permissionError?.message
        );
      }
    }

    try {
      await axios.post(
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
    } catch (permissionError: any) {
      // Org policies can block link sharing. Employees can still be granted
      // per-account access when the admin shares their worker link.
      console.warn(
        'Could not enable link sharing on the spreadsheet:',
        permissionError?.response?.data?.error?.message || permissionError?.message
      );
    }

    const joinLink = `revork://login?sheetId=${encodeURIComponent(
      sheetId
    )}&companyId=${encodeURIComponent(userEmail || '')}`;
    console.log('Workspace link generated:', joinLink);

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

    const location = describeDriveLocation({ companyName, folderId, sheetId });
    return { sheetId, folderId, joinLink, ...location };
  } catch (error: any) {
    console.error('Error creating Google Drive structure:', error);
    const errorMessage =
      error.response?.data?.error?.message || error.message || 'Unknown error';
    throw new Error(`Failed to setup Google Drive: ${errorMessage}`);
  }
}
