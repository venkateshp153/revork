import { createGoogleDriveStructure } from './createGoogleDriveStructure';
import { findAnyWorkspaceFolder, findFolderByName, findSheetInFolder } from './checkDriveFolder';
import { describeDriveLocation } from './drivePaths';
import { getUserWorkspace } from '@/assets/services/firebaseService';

export interface WorkspaceResult {
  folderId: string;
  sheetId: string;
  joinLink: string;
  reused: boolean;
  folderName: string;
  folderUrl: string;
  folderPath: string;
  sheetUrl: string;
}

async function canReadSheet(sheetId: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Searches Drive for the company's existing folder/sheet without ever creating
 * a replacement. Used to self-heal a stored sheetId that no longer resolves
 * (e.g. a single-character typo in Firestore).
 */
export async function findExistingWorkspaceSheet(params: {
  accessToken: string;
  companyName?: string;
  folderId?: string;
}): Promise<{ sheetId: string; folderId: string }> {
  let folderId = (params.folderId || '').trim();

  try {
    if (!folderId && params.companyName) {
      const folder = await findFolderByName(
        params.accessToken,
        `${params.companyName} WorkForce Data`
      );
      if (folder.exists) folderId = folder.folderId;
    }

    if (!folderId) {
      const anyFolder = await findAnyWorkspaceFolder(params.accessToken);
      if (anyFolder.exists) folderId = anyFolder.folderId;
    }

    if (!folderId) return { sheetId: '', folderId: '' };

    const sheetId = await findSheetInFolder(params.accessToken, folderId);
    return { sheetId: sheetId || '', folderId };
  } catch (error) {
    console.warn('[Workspace] findExistingWorkspaceSheet failed:', error);
    return { sheetId: '', folderId: '' };
  }
}

/**
 * Enforces "one Google account = one company workspace":
 * 1. reuse the folder/sheet ids already stored on users/{uid};
 * 2. reuse an existing `${companyName} WorkForce Data` folder + spreadsheet;
 * 3. only create a new folder + spreadsheet when nothing exists.
 */
export async function ensureCompanyWorkspace(params: {
  uid: string;
  companyName: string;
  companyEmail: string;
  accessToken: string;
}): Promise<WorkspaceResult> {
  const { uid, companyName, companyEmail, accessToken } = params;

  const stored = await getUserWorkspace(uid);
  if (stored.sheetId && (await canReadSheet(stored.sheetId, accessToken))) {
    return {
      folderId: stored.folderId,
      sheetId: stored.sheetId,
      joinLink: stored.joinLink,
      reused: true,
      ...describeDriveLocation({
        companyName,
        folderId: stored.folderId,
        sheetId: stored.sheetId,
      }),
    };
  }

  const folderName = `${companyName} WorkForce Data`;
  let resolvedFolderId = stored.folderId;

  try {
    let folderId = resolvedFolderId;

    if (!folderId) {
      const folder = await findFolderByName(accessToken, folderName);
      if (folder.exists) folderId = folder.folderId;
    }

    // One account = one company workspace: reuse any app-created workspace
    // folder, even if the company name was edited since it was created.
    if (!folderId) {
      const anyFolder = await findAnyWorkspaceFolder(accessToken);
      if (anyFolder.exists) {
        folderId = anyFolder.folderId;
        console.log('[Workspace] Reusing existing workspace folder:', folderId);
      }
    }

    resolvedFolderId = folderId;

    if (folderId) {
      const sheetId =
        stored.sheetId || (await findSheetInFolder(accessToken, folderId));
      if (sheetId) {
        console.log('[Workspace] Reusing existing folder/sheet:', folderId, sheetId);
        return {
          folderId,
          sheetId,
          joinLink: stored.joinLink,
          reused: true,
          ...describeDriveLocation({ companyName, folderId, sheetId }),
        };
      }
    }
  } catch (error) {
    console.warn('[Workspace] Drive lookup failed, creating a new workspace:', error);
  }

  const created = await createGoogleDriveStructure(
    companyName,
    accessToken,
    companyEmail,
    resolvedFolderId || undefined
  );
  return { ...created, reused: false };
}
