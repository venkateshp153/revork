import axios from 'axios';

/**
 * Finds a non-trashed Drive folder by its exact name. Workspace folders are
 * created as `${companyName} WorkForce Data`, so this lets returning users
 * recover their workspace when the folder id was never saved to Firestore.
 */
export async function findFolderByName(accessToken: string, folderName: string) {
  try {
    // A company name is user input. Strip backslashes and escape single quotes
    // so it cannot break out of the Drive query string.
    const escapedName = folderName.replace(/\\/g, '').replace(/'/g, "\\'");
    const response = await axios.get(
      'https://www.googleapis.com/drive/v3/files',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
        },
      }
    );

    const files = response.data.files;
    if (files && files.length > 0) {
      return {
        exists: true,
        folderId: files[0].id as string,
      };
    }
    return { exists: false, folderId: '' };
  } catch (error: any) {
    console.error('Error searching for Drive folder:', error);
    throw error;
  }
}

/**
 * Finds any workspace folder created by this Google account. Used as a
 * fallback so a single account can never end up with two company folders.
 */
export async function findAnyWorkspaceFolder(accessToken: string) {
  try {
    const response = await axios.get(
      'https://www.googleapis.com/drive/v3/files',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q: "name contains 'WorkForce Data' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
          fields: 'files(id, name)',
          orderBy: 'createdTime',
          pageSize: 1,
        },
      }
    );

    const files = response.data.files;
    if (files && files.length > 0) {
      return {
        exists: true,
        folderId: files[0].id as string,
      };
    }
    return { exists: false, folderId: '' };
  } catch (error: any) {
    console.error('Error searching for workspace folder:', error);
    throw error;
  }
}

export async function findSheetInFolder(accessToken: string, folderId: string) {
  try {
    const response = await axios.get(
      'https://www.googleapis.com/drive/v3/files',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: 'files(id, name)',
        },
      }
    );

    const files = response.data.files;
    if (files && files.length > 0) {
      return files[0].id;
    }
    return null;
  } catch (error: any) {
    console.error('Error finding sheet in folder:', error);
    throw error;
  }
}
