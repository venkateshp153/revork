import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { Colors } from '@/assets/constants/colors';
import {
  addInventoryItem,
  adjustInventoryQuantity,
  deleteInventoryItem,
  loadInventoryItems,
  type InventoryItem,
} from '@/src/utils/inventory';
import { flushPendingMutations } from '@/src/services/sync';

const CACHE_KEY = 'revork.inventory.cache.v1';

function parseNumber(value: string, fallback = 0): number {
  const parsed = parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export default function ListScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const actor = {
    workerId: user.workerProfile?.workerId || '',
    name: user.name || user.email || 'User',
  };

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [quantityDraft, setQuantityDraft] = useState('1');
  const [lowStockDraft, setLowStockDraft] = useState('1');
  const [notesDraft, setNotesDraft] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [lastDeleted, setLastDeleted] = useState<InventoryItem | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    if (!sheetId) {
      setLoading(false);
      return;
    }
    const rows = await loadInventoryItems(sheetId);
    setItems(rows);
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(rows)).catch(() => {});
    setLoading(false);
  }, [sheetId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  // Show the cached catalog instantly while the sheet loads.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (alive && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setItems((current) => (current.length === 0 ? parsed : current));
          }
        }
      } catch {
        // Ignore an unreadable cache.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!lastDeleted) return;
    const timer = setTimeout(() => setLastDeleted(null), 7000);
    return () => clearTimeout(timer);
  }, [lastDeleted]);

  const query = search.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!query) return items;
    return items.filter(
      (item) =>
        item.category.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.notes.toLowerCase().includes(query)
    );
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; category: string; items: InventoryItem[] }
    >();
    filteredItems.forEach((item) => {
      const key = item.category.trim().toLowerCase();
      const group = map.get(key) || {
        key,
        category: item.category.trim(),
        items: [],
      };
      group.items.push(item);
      map.set(key, group);
    });
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredItems]);

  const lowStockCount = useMemo(
    () =>
      items.filter(
        (item) => item.lowStockAt > 0 && item.quantity <= item.lowStockAt
      ).length,
    [items]
  );

  const canCreate = !!categoryDraft.trim() && !!nameDraft.trim();

  const resetCreate = () => {
    setCategoryDraft('');
    setNameDraft('');
    setQuantityDraft('1');
    setLowStockDraft('1');
    setNotesDraft('');
    setCreateOpen(false);
  };

  const createItem = async () => {
    if (!canCreate) return;
    const category = categoryDraft.trim();
    const name = nameDraft.trim();
    const duplicate = items.some(
      (item) =>
        item.category.trim().toLowerCase() === category.toLowerCase() &&
        item.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      Alert.alert('Already exists', 'That item is already in this category.');
      return;
    }

    const input = {
      category,
      name,
      quantity: parseNumber(quantityDraft, 1),
      lowStockAt: parseNumber(lowStockDraft, 0),
      notes: notesDraft.trim(),
    };
    const now = new Date().toISOString();
    const optimistic: InventoryItem = {
      id: `temp_${Date.now()}`,
      ...input,
      createdAt: now,
      createdBy: actor.name,
      updatedAt: now,
      updatedBy: actor.name,
      row: 0,
    };
    setItems((prev) => [optimistic, ...prev]);
    setExpandedCategory(category.toLowerCase());
    resetCreate();

    if (!sheetId) return;
    const saved = await addInventoryItem(sheetId, input, actor);
    if (!saved) {
      Alert.alert(
        'Could not save to the sheet',
        'The item is still shown on this device, but it could not be written to Google Sheets. Check that the signed-in Google account can edit the spreadsheet, then try again.'
      );
      return;
    }
    await flushPendingMutations(true);
    await load();
  };

  const changeQuantity = async (item: InventoryItem, delta: number) => {
    const next = Math.max(0, item.quantity + delta);
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, quantity: next } : entry
      )
    );
    if (sheetId && item.row > 0) {
      await adjustInventoryQuantity(sheetId, item, next, actor);
    }
  };

  const removeItem = (item: InventoryItem) => {
    Alert.alert('Remove item?', `“${item.name}” will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((entry) => entry.id !== item.id));
          setLastDeleted(item);
          if (sheetId && item.row > 0) {
            await deleteInventoryItem(sheetId, item, actor);
          }
        },
      },
    ]);
  };

  const undoDelete = async () => {
    if (!lastDeleted) return;
    const item = lastDeleted;
    setLastDeleted(null);
    setItems((prev) => [item, ...prev]);
    if (!sheetId) return;
    await addInventoryItem(
      sheetId,
      {
        category: item.category,
        name: item.name,
        quantity: item.quantity,
        lowStockAt: item.lowStockAt,
        notes: item.notes,
      },
      actor
    );
    await load();
  };

  const shareLowStock = async () => {
    const lowItems = items.filter(
      (item) => item.lowStockAt > 0 && item.quantity <= item.lowStockAt
    );
    if (lowItems.length === 0) {
      Alert.alert(
        'Nothing running low',
        'No inventory items are at or below their low-stock level.'
      );
      return;
    }

    const byCategory = new Map<string, InventoryItem[]>();
    lowItems.forEach((item) => {
      const category = item.category.trim();
      const list = byCategory.get(category) || [];
      list.push(item);
      byCategory.set(category, list);
    });

    const sections = Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => {
        const lines = [...list]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item, index) => `${index + 1}.) ${item.name}`);
        return `${category}\n${lines.join('\n')}`;
      });

    const message = [
      'List of items running low and we need, and make sure to place order for delivery end of the day.',
      '',
      sections.join('\n\n'),
    ].join('\n');

    await Share.share({
      title: 'Low-stock order list',
      message,
    }).catch(() => {});
  };

  const runImport = async () => {
    const rows = importText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\t|,/).map((part) => part.trim()))
      .filter((parts) => parts.length >= 2 && parts[0] && parts[1]);
    if (rows.length === 0) {
      Alert.alert(
        'Nothing to import',
        'Use one line per item: Category, Item, Quantity, Low stock at, Notes.'
      );
      return;
    }
    setImporting(true);
    try {
      let added = 0;
      let skipped = 0;
      const existing = new Set(
        items.map(
          (item) =>
            `${item.category.trim().toLowerCase()}|${item.name
              .trim()
              .toLowerCase()}`
        )
      );
      for (const parts of rows) {
        const category = parts[0];
        const name = parts[1];
        const key = `${category.trim().toLowerCase()}|${name
          .trim()
          .toLowerCase()}`;
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        existing.add(key);
        const saved = await addInventoryItem(
          sheetId,
          {
            category,
            name,
            quantity: parseNumber(parts[2] || '1', 1),
            lowStockAt: parseNumber(parts[3] || '0', 0),
            notes: parts.slice(4).join(' ').trim(),
          },
          actor
        );
        if (saved) added += 1;
      }
      setImportVisible(false);
      setImportText('');
      await flushPendingMutations(true);
      await load();
      Alert.alert(
        'Import finished',
        `${added} item${added === 1 ? '' : 's'} added${
          skipped > 0 ? `, ${skipped} duplicate skipped` : ''
        }.`
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Inventory</Text>
          <Text style={styles.subtitle}>
            {items.length} item{items.length === 1 ? '' : 's'}
            {lowStockCount > 0 ? ` · ${lowStockCount} low stock` : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.editButton, editMode && styles.editButtonActive]}
          onPress={() => setEditMode((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={editMode ? 'Finish editing counts' : 'Edit item counts'}
        >
          <MaterialCommunityIcons
            name={editMode ? 'check' : 'pencil-outline'}
            size={14}
            color={editMode ? '#fff' : '#475569'}
          />
          <Text
            style={[
              styles.editButtonText,
              editMode && { color: '#fff' },
            ]}
          >
            {editMode ? 'Done' : 'Edit'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerIcon}
          onPress={() => void shareLowStock()}
          accessibilityLabel="Share low-stock order list"
        >
          <MaterialCommunityIcons
            name="share-variant-outline"
            size={20}
            color="#475569"
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerIcon}
          onPress={() => setImportVisible(true)}
          accessibilityLabel="Import inventory"
        >
          <MaterialCommunityIcons
            name="tray-arrow-down"
            size={20}
            color="#475569"
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.plusButton}
          onPress={() => setCreateOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel="Create inventory item"
        >
          <MaterialCommunityIcons
            name={createOpen ? 'close' : 'plus'}
            size={22}
            color="#fff"
          />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <MaterialCommunityIcons name="magnify" size={19} color="#64748B" />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search category, item or notes"
          placeholderTextColor="#94A3B8"
          autoCorrect={false}
        />
        {!!search && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            accessibilityLabel="Clear search"
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color="#94A3B8"
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.showAllRow}>
        <Text style={styles.showAllLabel}>Show all items</Text>
        <Switch
          value={showAll}
          onValueChange={(value) => {
            setShowAll(value);
            if (!value) setExpandedCategory(null);
          }}
          style={styles.showAllSwitch}
          trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
          thumbColor={showAll ? Colors.primary : '#F8FAFC'}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading inventory…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={Colors.primary}
            />
          }
        >
          {createOpen && (
            <View style={styles.createCard}>
              <Text style={styles.createTitle}>New inventory item</Text>
              <Text style={styles.fieldLabel}>Category</Text>
              <TextInput
                style={styles.fieldInput}
                value={categoryDraft}
                onChangeText={setCategoryDraft}
                placeholder="e.g. Beverages"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />
              <Text style={styles.fieldLabel}>Item name</Text>
              <TextInput
                style={styles.fieldInput}
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="e.g. Cola 500ml"
                placeholderTextColor="#94A3B8"
                autoCapitalize="sentences"
              />
              <View style={styles.twoColumns}>
                <View style={styles.column}>
                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={quantityDraft}
                    onChangeText={(text) =>
                      setQuantityDraft(text.replace(/[^\d]/g, ''))
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <View style={styles.column}>
                  <Text style={styles.fieldLabel}>Low stock at</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={lowStockDraft}
                    onChangeText={(text) =>
                      setLowStockDraft(text.replace(/[^\d]/g, ''))
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>
              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={[styles.fieldInput, styles.notesInput]}
                value={notesDraft}
                onChangeText={setNotesDraft}
                placeholder="Optional notes for this item"
                placeholderTextColor="#94A3B8"
                multiline
              />
              <View style={styles.createActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={resetCreate}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.createButton, !canCreate && styles.disabled]}
                  onPress={() => void createItem()}
                  disabled={!canCreate}
                >
                  <Text style={styles.createButtonText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {groups.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons
                name="package-variant"
                size={36}
                color="#CBD5E1"
              />
              <Text style={styles.emptyTitle}>
                {items.length === 0 ? 'No inventory items yet' : 'No matches'}
              </Text>
              <Text style={styles.emptyText}>
                {items.length === 0
                  ? 'Tap plus to create your first category and item, or import a list.'
                  : 'Try a different category or item name.'}
              </Text>
            </View>
          ) : (
            groups.map((group) => {
              const isOpen =
                showAll ||
                editMode ||
                expandedCategory === group.key ||
                !!query;
              return (
                <View key={group.key} style={styles.groupCard}>
                  <TouchableOpacity
                    style={styles.groupHeader}
                    activeOpacity={0.8}
                    onPress={() =>
                      setExpandedCategory(isOpen ? null : group.key)
                    }
                  >
                    <View style={styles.groupIcon}>
                      <MaterialCommunityIcons
                        name="tag-outline"
                        size={17}
                        color={Colors.primary}
                      />
                    </View>
                    <View style={styles.groupInfo}>
                      <Text style={styles.groupName} numberOfLines={1}>
                        {group.category}
                      </Text>
                    </View>
                    <MaterialCommunityIcons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color="#94A3B8"
                    />
                  </TouchableOpacity>

                  {isOpen && (
                    <View style={styles.groupBody}>
                      {group.items.map((item) => {
                        const isLow =
                          item.lowStockAt > 0 &&
                          item.quantity <= item.lowStockAt;
                        return (
                          <View key={item.id} style={styles.itemRow}>
                            <View
                              style={[
                                styles.itemIcon,
                                isLow && styles.itemIconLow,
                              ]}
                            >
                              <MaterialCommunityIcons
                                name={
                                  isLow
                                    ? 'alert-outline'
                                    : 'package-variant-closed'
                                }
                                size={15}
                                color={isLow ? '#B45309' : '#64748B'}
                              />
                            </View>
                            <View style={styles.itemInfo}>
                              <Text style={styles.itemName} numberOfLines={1}>
                                {item.name}
                              </Text>
                              {!!item.notes && (
                                <Text style={styles.itemNotes} numberOfLines={1}>
                                  {item.notes}
                                </Text>
                              )}
                              {isLow && (
                                <Text style={styles.lowText}>
                                  Low stock · {item.quantity} left
                                </Text>
                              )}
                            </View>
                            {editMode ? (
                              <>
                                <View style={styles.qtyControls}>
                                  <TouchableOpacity
                                    style={styles.qtyButton}
                                    onPress={() =>
                                      void changeQuantity(item, -1)
                                    }
                                    accessibilityLabel={`Decrease ${item.name}`}
                                  >
                                    <MaterialCommunityIcons
                                      name="minus"
                                      size={14}
                                      color="#334155"
                                    />
                                  </TouchableOpacity>
                                  <Text style={styles.qtyValue}>
                                    {item.quantity}
                                  </Text>
                                  <TouchableOpacity
                                    style={styles.qtyButton}
                                    onPress={() =>
                                      void changeQuantity(item, 1)
                                    }
                                    accessibilityLabel={`Increase ${item.name}`}
                                  >
                                    <MaterialCommunityIcons
                                      name="plus"
                                      size={14}
                                      color="#334155"
                                    />
                                  </TouchableOpacity>
                                </View>
                                <TouchableOpacity
                                  style={styles.itemDelete}
                                  onPress={() => removeItem(item)}
                                  accessibilityLabel={`Remove ${item.name}`}
                                >
                                  <MaterialCommunityIcons
                                    name="trash-can-outline"
                                    size={16}
                                    color="#DC2626"
                                  />
                                </TouchableOpacity>
                              </>
                            ) : (
                              <Text style={styles.qtyPlain}>
                                {item.quantity}
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {!!lastDeleted && (
        <View style={styles.undoBanner}>
          <MaterialCommunityIcons
            name="delete-outline"
            size={17}
            color="#fff"
          />
          <Text style={styles.undoText} numberOfLines={1}>
            “{lastDeleted.name}” removed
          </Text>
          <TouchableOpacity onPress={() => void undoDelete()}>
            <Text style={styles.undoAction}>Undo</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={importVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setImportVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.headerText}>
                <Text style={styles.modalTitle}>Import inventory</Text>
                <Text style={styles.modalSubtitle}>
                  One item per line: Category, Item, Quantity, Low stock at,
                  Notes
                </Text>
              </View>
              <TouchableOpacity onPress={() => setImportVisible(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color="#334155"
                />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.importInput}
              value={importText}
              onChangeText={setImportText}
              placeholder={'Beverages, Cola 500ml, 24, 6, Cold drinks\nSnacks, Chips, 10, 3'}
              placeholderTextColor="#94A3B8"
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[
                styles.createButton,
                styles.importButton,
                importing && styles.disabled,
              ]}
              onPress={() => void runImport()}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.createButtonText}>Import items</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.screenBackground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 58,
    paddingBottom: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerText: { flex: 1, paddingRight: 8 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.heading },
  subtitle: { fontSize: 11.5, color: Colors.mutedText, marginTop: 3 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    marginRight: 7,
  },
  editButtonActive: { backgroundColor: '#16A34A' },
  editButtonText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#475569',
    marginLeft: 4,
  },
  plusButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 7,
    fontSize: 13,
    color: Colors.heading,
  },
  showAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  showAllLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    color: Colors.mutedText,
    marginRight: 6,
  },
  showAllSwitch: {
    transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }],
    marginRight: -6,
  },
  center: { alignItems: 'center', paddingVertical: 50 },
  loadingText: { marginTop: 10, fontSize: 12, color: Colors.mutedText },
  content: { padding: 16, paddingBottom: 120 },
  createCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  createTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.heading,
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 10,
    marginBottom: 4,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
    color: Colors.heading,
    backgroundColor: '#F8FAFC',
  },
  notesInput: { minHeight: 60, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1 },
  createActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  cancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    marginRight: 8,
  },
  cancelButtonText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  createButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  createButtonText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 28,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.heading,
    marginTop: 10,
  },
  emptyText: {
    fontSize: 11.5,
    color: Colors.mutedText,
    marginTop: 5,
    textAlign: 'center',
    lineHeight: 17,
  },
  groupCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 9,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  groupIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#EAF7EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupInfo: { flex: 1, marginLeft: 9 },
  groupName: { fontSize: 13.5, fontWeight: '800', color: Colors.heading },
  groupLow: { fontSize: 9.5, color: '#B45309', fontWeight: '700', marginTop: 1 },
  groupCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    marginRight: 6,
  },
  groupCountText: { fontSize: 10, fontWeight: '800', color: '#64748B' },
  groupBody: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  itemIcon: {
    width: 27,
    height: 27,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIconLow: { backgroundColor: '#FEF3C7' },
  itemInfo: { flex: 1, marginLeft: 8, paddingRight: 6 },
  itemName: { fontSize: 12.5, fontWeight: '700', color: '#334155' },
  itemNotes: { fontSize: 10, color: '#94A3B8', marginTop: 1 },
  lowText: { fontSize: 9.5, color: '#B45309', fontWeight: '700', marginTop: 2 },
  qtyControls: { flexDirection: 'row', alignItems: 'center' },
  qtyButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    minWidth: 26,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: Colors.heading,
  },
  qtyPlain: {
    fontSize: 12.5,
    fontWeight: '800',
    color: Colors.heading,
    minWidth: 26,
    textAlign: 'right',
  },
  itemDelete: { padding: 5, marginLeft: 5 },
  undoBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  undoText: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  undoAction: { color: '#93C5FD', fontSize: 12.5, fontWeight: '800' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.heading },
  modalSubtitle: { fontSize: 11, color: Colors.mutedText, marginTop: 3 },
  importInput: {
    minHeight: 130,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    padding: 11,
    fontSize: 12.5,
    color: Colors.heading,
  },
  importButton: { marginTop: 14, alignItems: 'center' },
});
