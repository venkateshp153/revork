import { SHEETS_CONFIG } from '../config/sheets';
import { SheetData, GroceryItem } from '../types';
import axios, { AxiosResponse, AxiosError } from 'axios';
import Constants from 'expo-constants';

export class SheetsService {
  private static instance: SheetsService;
  private readonly baseUrl = process.env.EXPO_PUBLIC_SHEETS_URL || 'https://sheets.googleapis.com/v4/spreadsheets/';

  private constructor() {}

  public static getInstance(): SheetsService {
    if (!SheetsService.instance) {
      SheetsService.instance = new SheetsService();
    }
    return SheetsService.instance;
  }

  private buildUrl(sheetId: string, sheetName: string, range?: string): string {
    const fullRange = range ? `${sheetName}!${range}` : sheetName;
    const encodedRange = encodeURIComponent(fullRange);
    const url = `${this.baseUrl}${sheetId}/values/${encodedRange}?key=`;
    console.log('Built URL:', url);
    console.log('Sheet ID:', sheetId);
    console.log('Sheet Name:', sheetName);
    console.log('Range:', range);
    return url;
  }

  public async fetchSheetData(
    configKey: string = 'default',
    transformFn?: (data: any[]) => GroceryItem[]
  ): Promise<GroceryItem[]> {
    const config = SHEETS_CONFIG[configKey];
    if (!config) {
      throw new Error(`No sheet configuration found for key: ${configKey}`);
    }

    if (!config.sheetId || !config.apiKey || !config.sheetName) {
      throw new Error('Missing required sheet configuration. Check .env file for EXPO_PUBLIC_SHEET_ID, EXPO_PUBLIC_API_KEY, EXPO_PUBLIC_SHEET_NAME');
    }

    try {
      const url = `${this.buildUrl(config.sheetId, config.sheetName, config.range)}${config.apiKey}`;
      console.log('Fetching data from URL:', url);

      const response: AxiosResponse<{ values: any[][] }> = await axios.get(url);
      console.log('Raw API response:', response.data);
      
      if (!response.data || !response.data.values) {
        console.warn('API response is empty or missing values');
        return [];
      }

      const data: any[][] = response.data.values;
      const processedData: SheetData = [];

      if (data.length > 1) {
        const headers: string[] = data[0].map(header => String(header).trim());

        processedData.push(...data.slice(1).map((row: any[]) => {
          const obj: Record<string, any> = {};
          headers.forEach((header: string, index: number) => {
            obj[header] = row[index] !== undefined ? row[index] : null;
          });
          return obj as GroceryItem;
        }));
      } else if (data.length === 1) {
        processedData.push(...data as any);
      }

      const finalData = transformFn ? transformFn(processedData) : processedData as GroceryItem[];

      return finalData;
    } catch (error) {
      if (error instanceof AxiosError) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        
        if (status === 403) {
          console.error('403 Forbidden: Google Sheet is not publicly accessible');
          console.error('Fix: Open your Google Sheet → Share → Change to "Anyone with the link" → Viewer');
          throw new Error('Access denied. Please share your Google Sheet publicly: Click Share → Anyone with the link → Viewer');
        }
        
        if (status === 404) {
          throw new Error('Sheet not found. Check your Sheet ID in app.json');
        }
        
        if (status === 400) {
          throw new Error('Invalid request. Check sheet name and range in app.json');
        }
        
        const errorMessage = `Sheets API Error: ${axiosError.message}${
          status ? ` (Status: ${status})` : ''
        }`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
      console.error('Unexpected error:', error);
      throw error;
    }
  }
}