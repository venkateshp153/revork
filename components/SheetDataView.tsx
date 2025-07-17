//components/SheetDataView.tsx
import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SheetData } from '@/assets/config/sheets';

interface SheetDataViewProps {
  data: SheetData;
  loading: boolean;
  error: Error | null;
  onRefresh?: () => Promise<void>;
  renderItem?: (item: any) => React.ReactElement;
  keyExtractor?: (item: any, index: number) => string;
  emptyComponent?: React.ReactElement;
  errorComponent?: (error: Error) => React.ReactElement;
}

export const SheetDataView: React.FC<SheetDataViewProps> = ({
  data,
  loading,
  error,
  onRefresh,
  renderItem = defaultRenderItem,
  keyExtractor = defaultKeyExtractor,
  emptyComponent = <Text>No data available</Text>,
  errorComponent = defaultErrorComponent,
}) => {
  if (loading && data.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return <View style={styles.center}>{errorComponent(error)}</View>;
  }

  if (data.length === 0) {
    return <View style={styles.center}>{emptyComponent}</View>;
  }

  return (
    <FlatList
      data={data}
      renderItem={({ item }) => renderItem(item)}
      keyExtractor={keyExtractor}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={loading} onRefresh={onRefresh} />
        ) : undefined
      }
      contentContainerStyle={styles.listContent}
    />
  );
};

const defaultRenderItem = (item: any) => (
  <View style={styles.itemContainer}>
    {Object.entries(item).map(([key, value]) => (
      <Text key={key} style={styles.itemText}>
        {key}: {String(value)}
      </Text>
    ))}
  </View>
);

const defaultKeyExtractor = (item: any, index: number) => {
  return item.id ? String(item.id) : `item-${index}`;
};

const defaultErrorComponent = (error: Error) => (
  <Text style={styles.errorText}>Error: {error.message}</Text>
);

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  itemContainer: {
    backgroundColor: '#f9f9f9',
    padding: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  itemText: {
    fontSize: 14,
    marginBottom: 4,
  },
  errorText: {
    color: 'red',
    fontSize: 16,
  textAlign: 'center',
  padding: 16,
  },
});