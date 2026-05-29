import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosError, AxiosResponse } from 'axios';

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export class GoogleService {
  private static instance: GoogleService;
  private api: AxiosInstance;
  private accessToken: string | null = null;

  private constructor() {
    this.api = axios.create();

    this.api.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error: AxiosError) => Promise.reject(error)
    );

    this.api.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as CustomAxiosRequestConfig;
        if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            // In a real app, you would call a refresh token endpoint here.
            // For this implementation, we notify the app to re-authenticate.
            console.warn('Google Access Token expired. Re-authentication requested.');
            return Promise.reject(new Error('TOKEN_EXPIRED'));
          } catch (refreshError) {
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  public static getInstance(): GoogleService {
    if (!GoogleService.instance) {
      GoogleService.instance = new GoogleService();
    }
    return GoogleService.instance;
  }

  public setAccessToken(token: string) {
    this.accessToken = token;
  }

  public async createFolder(
    folderName: string,
    parentFolderId?: string
  ): Promise<string | null> {
    try {
      const response = await this.api.post(
        'https://www.googleapis.com/drive/v3/files',
        {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentFolderId ? [parentFolderId] : [],
        }
      );

      console.log('Folder created:', response.data);
      return response.data.id;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  public async createSpreadsheet(
    title: string,
    folderId: string
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string } | null> {
    try {
      const response = await this.api.post(
        'https://sheets.googleapis.com/v4/spreadsheets',
        {
          properties: {
            title: title,
          },
        }
      );

      const spreadsheetId = response.data.spreadsheetId;

      if (folderId) {
        await this.moveFileToFolder(spreadsheetId, folderId);
      }

      console.log('Spreadsheet created:', response.data);
      return {
        spreadsheetId,
        spreadsheetUrl: response.data.spreadsheetUrl,
      };
    } catch (error) {
      console.error('Error creating spreadsheet:', error);
      throw error;
    }
  }

  private async moveFileToFolder(fileId: string, folderId: string) {
    try {
      await this.api.patch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
          parents: [folderId],
        },
        {
          params: {
            addParents: folderId,
            removeParents: 'root',
          },
        }
      );
    } catch (error) {
      console.error('Error moving file to folder:', error);
    }
  }

  public async createSheetInSpreadsheet(
    spreadsheetId: string,
    sheetName: string
  ): Promise<void> {
    try {
      await this.api.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        }
      );

      console.log(`Sheet '${sheetName}' created in spreadsheet`);
    } catch (error) {
      console.error('Error creating sheet:', error);
      throw error;
    }
  }

  public async appendDataToSheet(
    spreadsheetId: string,
    sheetName: string,
    data: any[][]
  ): Promise<void> {
    try {
      await this.api.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}:append`,
        {
          values: data,
        },
        {
          params: {
            valueInputOption: 'RAW',
          },
        }
      );

      console.log('Data appended to sheet successfully');
    } catch (error) {
      console.error('Error appending data to sheet:', error);
      throw error;
    }
  }

  public async setupBackendForUser(
    userEmail: string
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string } | null> {
    try {
      const folderName = `Revork_${userEmail.replace(/@/g, '_')}`;
      const folderId = await this.createFolder(folderName);

      if (!folderId) {
        throw new Error('Failed to create folder');
      }

      const spreadsheetResult = await this.createSpreadsheet(
        `Revork_Backend_${userEmail.replace(/@/g, '_')}`,
        folderId
      );

      if (!spreadsheetResult) {
        throw new Error('Failed to create spreadsheet');
      }

      const { spreadsheetId } = spreadsheetResult;

      await this.createSheetInSpreadsheet(spreadsheetId, 'MyProfile');
      await this.createSheetInSpreadsheet(spreadsheetId, 'Workers');
      await this.createSheetInSpreadsheet(spreadsheetId, 'Attendance');
      await this.createSheetInSpreadsheet(spreadsheetId, 'Payments');
      await this.createSheetInSpreadsheet(spreadsheetId, 'Notifications');

      console.log('Backend setup completed successfully');
      return spreadsheetResult;
    } catch (error) {
      console.error('Error setting up backend:', error);
      throw error;
    }
  }

  public async shareFileWithUser(
    fileId: string,
    userEmail: string,
    role: 'reader' | 'writer' | 'commenter' | 'organizer' | 'fileOrganizer'
  ): Promise<void> {
    try {
      await this.api.post(
        `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
        {
          type: 'user',
          role: role,
          emailAddress: userEmail,
        }
      );

      console.log(`File shared with ${userEmail} as ${role}`);
    } catch (error) {
      console.error('Error sharing file:', error);
      throw error;
    }
  }
}
