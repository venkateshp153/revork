// assets/hooks/useSheetData.ts
import { useState, useEffect, useCallback } from 'react';
import { SheetsService } from '../services/sheetsService';
import { GroceryItem } from '../types';

export const useSheetData = (
  configKey?: string,
  transformFn?: (data: any[]) => GroceryItem[]
) => {
  const [data, setData] = useState<GroceryItem[]>([]);
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
      
      if (Array.isArray(result)) {
        const typedData: GroceryItem[] = result.map(item => ({
          Id: item.Id || '',
          GroceryItem: item.GroceryItem || '',
        }));
        setData(typedData);
      } else {
        setData([]);
      }
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