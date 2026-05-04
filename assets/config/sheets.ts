import { SheetData } from '../types';

interface SheetConfig {
  sheetId: string;
  apiKey: string;
  sheetName: string;
  range?: string;
}

const sheetId = process.env.EXPO_PUBLIC_SHEET_ID || '';
const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const fullSheetName = process.env.EXPO_PUBLIC_SHEET_NAME || 'List';
const envRange = process.env.EXPO_PUBLIC_RANGE || 'A:Z';

let sheetName = fullSheetName;
let range = envRange;

if (fullSheetName.includes('!')) {
  const parts = fullSheetName.split('!');
  sheetName = parts[0];
  range = parts[1] || range;
}

console.log('=== Google Sheets Config ===');
console.log('Sheet ID:', sheetId ? '✓ Loaded' : '✗ Missing');
console.log('API Key:', apiKey ? '✓ Loaded' : '✗ Missing');
console.log('Sheet Name:', sheetName);
console.log('Range:', range);
console.log('===========================');

export const SHEETS_CONFIG: Record<string, SheetConfig> = {
  default: {
    sheetId,
    apiKey,
    sheetName,
    range,
  }
};

export type { SheetData };