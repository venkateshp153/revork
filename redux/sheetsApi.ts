// redux/sheetsApi.ts
import { createAsyncThunk } from '@reduxjs/toolkit';
import { SheetsService } from '@/assets/services/sheetsService';
import { GroceryItem } from '@/assets/types';

export const fetchSheetData = createAsyncThunk(
  'grocery/fetchSheetData',
  async (_, { rejectWithValue }) => {
    try {
      const result = await SheetsService.getInstance().fetchSheetData();
      
      if (!Array.isArray(result)) {
        return [];
      }
      
      const typedData: GroceryItem[] = result.map(item => ({
        Id: item.Id || '',
        GroceryItem: item.GroceryItem || '',
      }));
      
      return typedData;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : 'Failed to fetch data'
      );
    }
  }
);
