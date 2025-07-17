///components/GroceryItemCard.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated } from 'react-native';
import { GroceryItem } from '@/assets/types/index';

interface GroceryItemCardProps {
  item: GroceryItem;
  onPress: (item: GroceryItem) => void;
  opacity: Animated.Value;
}

const GroceryItemCard: React.FC<GroceryItemCardProps> = ({ item, onPress, opacity }) => {
  return (
    <Animated.View style={{ opacity }}>
      <TouchableOpacity 
        style={styles.container}
        onPress={() => onPress(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.name}>{item.GroceryItem}</Text>
        <Text style={styles.id}>#{item.Id}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 20,
    marginVertical: 6,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  name: {
    fontSize: 16,
    color: '#2d3748',
    fontWeight: '500',
    flex: 1,
  },
  id: {
    fontSize: 12,
    color: '#718096',
    backgroundColor: '#edf2f7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginLeft: 10,
  },
});

export default React.memo(GroceryItemCard);