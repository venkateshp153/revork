import { SHEETS_CONFIG, SheetData } from '../config/sheets';
import axios, { AxiosResponse, AxiosError } from 'axios';
import Constants from 'expo-constants';

export class SheetsService {
  private static instance: SheetsService;
  private readonly baseUrl = Constants.expoConfig?.extra?.sheetsUrl;

  private constructor() {}

  public static getInstance(): SheetsService {
    if (!SheetsService.instance) {
      SheetsService.instance = new SheetsService();
    }
    return SheetsService.instance;
  }

  private buildUrl(sheetId: string, sheetName: string, range?: string): string {
    const fullRange = range ? `${sheetName}!${range}` : sheetName;
    return `${this.baseUrl}${sheetId}/values/${fullRange}?key=`;
  }

  public async fetchSheetData(
    configKey: string = 'default',
    transformFn?: (data: any[]) => SheetData
  ): Promise<SheetData> {
    const config = SHEETS_CONFIG[configKey];
    if (!config) {
      throw new Error(`No sheet configuration found for key: ${configKey}`);
    }

    try {
      const url = `${this.buildUrl(config.sheetId, config.sheetName, config.range)}${config.apiKey}`;
      // console.log('Fetching data from URL:', url); // Debug log

      const response: AxiosResponse<{ values: any[][] }> = await axios.get(url);
      // console.log('Raw API response:', response.data); // Debug log
      
      if (!response.data || !response.data.values) {
        console.warn('API response is empty or missing values');
        return [];
      }

      let data: any[][] = response.data.values;
      let processedData: SheetData = [];

      if (data.length > 1) {
        const headers: string[] = data[0].map(header => String(header).trim());
        // console.log('Headers found:', headers); // Debug log

        processedData = data.slice(1).map((row: any[]) => {
          const obj: Record<string, any> = {};
          headers.forEach((header: string, index: number) => {
            obj[header] = row[index] !== undefined ? row[index] : null;
          });
          return obj;
        });
      } else if (data.length === 1) {
        // console.log('Only header row found in data'); // Debug log
        processedData = data;
      }

      // console.log('Processed data before transform:', processedData); // Debug log

      const finalData = transformFn ? transformFn(processedData) : processedData;
      // console.log('Final transformed data:', finalData); // Debug log

      return finalData;
    } catch (error) {
      if (error instanceof AxiosError) {
        const axiosError = error as AxiosError;
        const errorMessage = `Sheets API Error: ${axiosError.message}${
          axiosError.response ? ` (Status: ${axiosError.response.status})` : ''
        }`;
        console.error(errorMessage); // Debug log
        throw new Error(errorMessage);
      }
      console.error('Unexpected error:', error); // Debug log
      throw error;
    }
  }
}