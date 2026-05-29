import axios from 'axios';

export async function checkRevorkFolderExists(accessToken: string) {
  try {
    const response = await axios.get(
      'https://www.googleapis.com/drive/v3/files',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          q: "name = 'revork' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
          fields: 'files(id, name)',
        },
      }
    );

    const files = response.data.files;
    if (files && files.length > 0) {
      return {
        exists: true,
        folderId: files[0].id,
      };
    }
    return { exists: false };
  } catch (error: any) {
    console.error('Error checking for revork folder:', error);
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
