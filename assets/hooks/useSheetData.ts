// assets/hooks/useSheetData.ts
import { useState, useEffect, useCallback } from 'react';
import { SheetsService } from '../services/sheetsService';
import { GroceryItem } from '../types';

export const useSheetData = (
  configKey?: string,
  transformFn?: (data: any[]) => GroceryItem[] // Update return type
) => {
  const [data, setData] = useState<GroceryItem[]>([]); // Explicit type
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await SheetsService.getInstance().fetchSheetData(
        configKey,
        transformFn
      );
      // Ensure the data matches GroceryItem type
      const typedData = (result || []).map(item => ({
        Id: item.Id || '',
        GroceryItem: item.GroceryItem || '',
        ...item
      }));
      setData(typedData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [configKey, transformFn]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
};