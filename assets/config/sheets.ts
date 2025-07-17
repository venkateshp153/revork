import Constants from 'expo-constants';
interface SheetConfig {
  sheetId: string;
  apiKey: string;
  sheetName: string;
  range?: string;
}

export const SHEETS_CONFIG: Record<string, SheetConfig> = {
  default: {
    sheetId: Constants.expoConfig?.extra?.sheetId,
    apiKey: Constants.expoConfig?.extra?.apiKey,
    sheetName: Constants.expoConfig?.extra?.sheetName,
    range: Constants.expoConfig?.extra?.range,
  }

};

export type SheetData = Record<string, any>[];