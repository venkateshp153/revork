/**
 * Google Drive / Sheets location helpers.
 *
 * These values are stored on `users/{uid}` so an existing user can be restored
 * from Firestore alone, without searching Drive again.
 */

export function driveFolderUrl(folderId?: string | null): string {
  const id = (folderId || '').trim();
  return id ? `https://drive.google.com/drive/folders/${id}` : '';
}

export function driveSheetUrl(sheetId?: string | null): string {
  const id = (sheetId || '').trim();
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : '';
}

export interface DriveLocation {
  folderName: string;
  folderUrl: string;
  /** Alias for folderUrl, stored to match the "folder path" wording. */
  folderPath: string;
  sheetUrl: string;
}

export function describeDriveLocation(params: {
  companyName?: string | null;
  folderId?: string | null;
  sheetId?: string | null;
}): DriveLocation {
  const folderUrl = driveFolderUrl(params.folderId);
  const companyName = (params.companyName || '').trim();
  return {
    folderName: companyName ? `${companyName} WorkForce Data` : '',
    folderUrl,
    folderPath: folderUrl,
    sheetUrl: driveSheetUrl(params.sheetId),
  };
}
