import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { RoleTheme } from '@/assets/constants/roleTheme';
import LocationPicker from '@/components/LocationPicker';
import {
  addDeliveryLocations,
  assignDeliveryLocation,
  autoAssignDeliveryLocation,
  deassignDeliveryLocation,
  deleteDeliveryLocation,
  formatDeliveryEta,
  optimizeDeliveryAssignments,
  setLocationPriority,
  updateDeliveryLocation,
  type DeliveryActor,
  type DeliveryDistribution,
  type DeliveryLocationRecord,
  type WorkerSpot,
} from '@/src/utils/deliverySpots';
import type { RouteLocation } from '@/src/utils/routePlanner';
import { flushPendingMutations } from '@/src/services/sync';

interface DeliveryControlPanelProps {
  sheetId: string;
  locations: DeliveryLocationRecord[];
  workers: WorkerSpot[];
  distribution: DeliveryDistribution;
  theme: RoleTheme;
  actor: DeliveryActor;
  /** Only admins can lock the day's distribution. Managers can still edit. */
  canOptimize: boolean;
  onRefresh: () => Promise<void> | void;
}

function orderLabel(count: number): string {
  return `${count} order${count === 1 ? '' : 's'}`;
}

export default function DeliveryControlPanel({
  sheetId,
  locations,
  workers,
  distribution,
  theme,
  actor,
  canOptimize,
  onRefresh,
}: DeliveryControlPanelProps) {
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);

  // Add location modal.
  const [addVisible, setAddVisible] = useState(false);
  const [addDraft, setAddDraft] = useState<RouteLocation | null>(null);
  const [addContact, setAddContact] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addOrders, setAddOrders] = useState('1');
  const [addNote, setAddNote] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // Edit location modal.
  const [editTarget, setEditTarget] =
    useState<DeliveryLocationRecord | null>(null);
  const [editDraft, setEditDraft] = useState<RouteLocation | null>(null);
  const [editContact, setEditContact] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editOrders, setEditOrders] = useState('1');
  const [editNote, setEditNote] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Assign modal.
  const [assignTarget, setAssignTarget] =
    useState<DeliveryLocationRecord | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  const teamsWithSpot = useMemo(
    () => distribution.plans.filter((plan) => !!plan.worker.spot),
    [distribution.plans]
  );

  const pendingLocations = useMemo(
    () => locations.filter((location) => location.status !== 'delivered'),
    [locations]
  );

  const autoLocations = useMemo(
    () =>
      pendingLocations.filter(
        (location) => location.assignmentMode === 'auto'
      ),
    [pendingLocations]
  );

  const manualCount = useMemo(
    () =>
      pendingLocations.filter(
        (location) =>
          location.assignmentMode === 'manual' ||
          location.assignmentMode === 'optimized'
      ).length,
    [pendingLocations]
  );

  const ordersHandled = useMemo(
    () =>
      distribution.plans.reduce(
        (sum, plan) => sum + plan.ordersDelivered,
        0
      ),
    [distribution.plans]
  );

  const openAdd = () => {
    setAddDraft(null);
    setAddContact('');
    setAddPhone('');
    setAddOrders('1');
    setAddNote('');
    setAddVisible(true);
  };

  // All fields are required before the delivery can be added.
  const addComplete =
    !!addDraft &&
    !!addContact.trim() &&
    !!addPhone.trim() &&
    !!addNote.trim() &&
    (parseInt(addOrders, 10) || 0) > 0;

  const saveAdd = async () => {
    if (!addDraft || !addComplete) return;
    const address = addDraft.address.trim().toLowerCase();
    if (
      locations.some(
        (location) => location.address.trim().toLowerCase() === address
      )
    ) {
      Alert.alert('Already added', 'That address is already in the list.');
      return;
    }
    setAddBusy(true);
    try {
      const added = await addDeliveryLocations(
        sheetId,
        [
          {
            address: addDraft.address,
            lat: addDraft.lat,
            lng: addDraft.lng,
            contactName: addContact.trim(),
            phone: addPhone.trim(),
            orderCount: Math.max(1, parseInt(addOrders, 10) || 1),
            note: addNote.trim(),
          },
        ],
        actor.name || 'Admin',
        actor,
        workers
      );
      if (added === 0) throw new Error('Could not save that address.');
      // Push the new row to Google Sheets immediately instead of waiting for
      // the background sync.
      await flushPendingMutations(true);
      setAddVisible(false);
      await onRefresh();
    } catch (error: any) {
      Alert.alert('Could not add', error?.message || 'Try again.');
    } finally {
      setAddBusy(false);
    }
  };

  const openEdit = (location: DeliveryLocationRecord) => {
    setEditTarget(location);
    setEditDraft({
      address: location.address,
      lat: location.lat,
      lng: location.lng,
    });
    setEditContact(location.contactName);
    setEditPhone(location.phone);
    setEditOrders(`${location.orderCount || 0}`);
    setEditNote(location.note);
  };

  const closeEdit = () => {
    if (editBusy) return;
    setEditTarget(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editTarget || !editDraft) return;
    setEditBusy(true);
    try {
      await updateDeliveryLocation(
        sheetId,
        editTarget,
        {
          address: editDraft.address,
          lat: editDraft.lat,
          lng: editDraft.lng,
          contactName: editContact.trim(),
          phone: editPhone.trim(),
          orderCount: Math.max(0, parseInt(editOrders, 10) || 0),
          note: editNote.trim(),
        },
        actor
      );
      setEditTarget(null);
      setEditDraft(null);
      await onRefresh();
    } catch (error: any) {
      Alert.alert('Could not save', error?.message || 'Try again.');
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!editTarget) return;
    const target = editTarget;
    Alert.alert(
      'Delete location?',
      `“${target.address}” will be removed for everyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setEditBusy(true);
            try {
              await deleteDeliveryLocation(sheetId, target, actor);
              setEditTarget(null);
              setEditDraft(null);
              await onRefresh();
            } catch (error: any) {
              Alert.alert(
                'Could not delete',
                error?.message || 'Try again.'
              );
            } finally {
              setEditBusy(false);
            }
          },
        },
      ]
    );
  };

  const runOptimize = () => {
    if (distribution.spotsSet === 0) {
      Alert.alert(
        'No employee spots',
        'Set a delivery spot for at least one employee before optimizing.'
      );
      return;
    }
    if (pendingLocations.length === 0) {
      Alert.alert('Nothing to optimize', 'Add delivery locations first.');
      return;
    }
    Alert.alert(
      'Optimize today’s deliveries?',
      `All ${pendingLocations.length} pending location${
        pendingLocations.length === 1 ? '' : 's'
      } will be redistributed across ${distribution.spotsSet} employee spot${
        distribution.spotsSet === 1 ? '' : 's'
      }. You can still assign or remove any address afterwards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Optimize',
          onPress: async () => {
            setOptimizing(true);
            try {
              const result = await optimizeDeliveryAssignments(
                sheetId,
                locations,
                workers,
                actor
              );
              await onRefresh();
              Alert.alert(
                'Delivery plan ready',
                `${result.assigned} location${
                  result.assigned === 1 ? '' : 's'
                } distributed. ${
                  result.unassigned > 0
                    ? `${result.unassigned} still needs an employee.`
                    : 'Every pending delivery has an employee.'
                }`
              );
            } catch (error: any) {
              Alert.alert(
                'Could not optimize',
                error?.message || 'Check your connection and try again.'
              );
            } finally {
              setOptimizing(false);
            }
          },
        },
      ]
    );
  };

  const assignTo = async (worker: WorkerSpot) => {
    if (!assignTarget) return;
    const target = assignTarget;
    setAssignBusy(true);
    try {
      await assignDeliveryLocation(
        sheetId,
        target,
        { workerId: worker.workerId, name: worker.name },
        actor
      );
      setAssignTarget(null);
      setEditTarget(null);
      setEditDraft(null);
      setExpandedWorker(worker.workerId);
      await onRefresh();
    } catch (error: any) {
      Alert.alert('Could not assign', error?.message || 'Try again.');
    } finally {
      setAssignBusy(false);
    }
  };

  const makeAutomatic = async () => {
    if (!assignTarget) return;
    const target = assignTarget;
    setAssignBusy(true);
    try {
      await autoAssignDeliveryLocation(sheetId, target, actor);
      setAssignTarget(null);
      setEditTarget(null);
      setEditDraft(null);
      await onRefresh();
    } catch (error: any) {
      Alert.alert('Could not update', error?.message || 'Try again.');
    } finally {
      setAssignBusy(false);
    }
  };

  const togglePriority = async (location: DeliveryLocationRecord) => {
    try {
      await setLocationPriority(sheetId, location, !location.priority, actor);
      await onRefresh();
    } catch (error: any) {
      Alert.alert('Could not update priority', error?.message || 'Try again.');
    }
  };

  const removeFromPlan = (location: DeliveryLocationRecord) => {    Alert.alert(
      'Remove from the plan?',
      `“${location.address}” will stop being assigned to an employee until you assign it again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deassignDeliveryLocation(sheetId, location, actor);
              await onRefresh();
            } catch (error: any) {
              Alert.alert(
                'Could not remove',
                error?.message || 'Try again.'
              );
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.card, { borderColor: theme.accentBorder }]}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
          <MaterialCommunityIcons
            name="truck-delivery-outline"
            size={20}
            color={theme.accent}
          />
        </View>
        <View style={styles.topInfo}>
          <Text style={styles.title}>Delivery control</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {distribution.pendingTotal} pending · {distribution.ordersPending}{' '}
            orders left · {distribution.spotsSet} employee spot
            {distribution.spotsSet === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={[styles.rolePill, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.rolePillText, { color: theme.accentDark }]}>
            {canOptimize ? 'ADMIN' : 'MANAGER'}
          </Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{distribution.pendingTotal}</Text>
          <Text style={styles.metricLabel}>Pending</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{distribution.ordersPending}</Text>
          <Text style={styles.metricLabel}>Orders left</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{ordersHandled}</Text>
          <Text style={styles.metricLabel}>Orders done</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text
            style={[
              styles.metricValue,
              distribution.unassigned.length > 0 && { color: '#B45309' },
            ]}
          >
            {distribution.unassigned.length}
          </Text>
          <Text style={styles.metricLabel}>Unassigned</Text>
        </View>
      </View>

      {distribution.spotsSet === 0 ? (
        <View style={styles.warning}>
          <MaterialCommunityIcons
            name="map-marker-alert-outline"
            size={17}
            color="#B45309"
          />
          <Text style={styles.warningText}>
            No employee spots yet. Set each employee’s base location first so
            deliveries can be distributed.
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {canOptimize && (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: theme.accent },
              (optimizing || pendingLocations.length === 0) && styles.disabled,
            ]}
            onPress={runOptimize}
            disabled={optimizing || pendingLocations.length === 0}
          >
            {optimizing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="auto-fix" size={17} color="#fff" />
            )}
            <Text style={styles.primaryButtonText}>
              {optimizing ? 'Distributing…' : 'Optimize today'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.outlineButton, { borderColor: theme.accentBorder }]}
          onPress={() => router.push('/delivery-locations')}
          accessibilityLabel="Employee spots and delivery locations"
        >
          <MaterialCommunityIcons
            name="map-marker-radius-outline"
            size={17}
            color={theme.accent}
          />
          <Text style={[styles.outlineButtonText, { color: theme.accent }]}>
            Spots & locations
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.outlineButton, { borderColor: theme.accentBorder }]}
          onPress={openAdd}
        >
          <MaterialCommunityIcons
            name="map-marker-plus-outline"
            size={17}
            color={theme.accent}
          />
          <Text style={[styles.outlineButtonText, { color: theme.accent }]}>
            Add location
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Team plans</Text>
        <Text style={styles.sectionHint}>
          {manualCount} assigned · {autoLocations.length} auto
        </Text>
      </View>

      {teamsWithSpot.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name="account-off-outline"
            size={24}
            color="#94A3B8"
          />
          <Text style={styles.emptyText}>
            No employee spot is set yet. Add spots to start distributing
            deliveries.
          </Text>
        </View>
      ) : (
        teamsWithSpot.map((plan) => {
          const isOpen = expandedWorker === plan.worker.workerId;
          return (
            <View
              key={plan.worker.workerId}
              style={[styles.teamCard, { borderColor: theme.accentBorder }]}
            >
              <TouchableOpacity
                style={styles.teamTop}
                onPress={() =>
                  setExpandedWorker(isOpen ? null : plan.worker.workerId)
                }
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: theme.accentSoft },
                  ]}
                >
                  <Text style={[styles.avatarText, { color: theme.accentDark }]}>
                    {plan.worker.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.teamInfo}>
                  <Text style={styles.teamName} numberOfLines={1}>
                    {plan.worker.name}
                  </Text>
                  <Text style={styles.teamSpot} numberOfLines={1}>
                    {plan.worker.spot?.address || 'No spot'}
                  </Text>
                  <Text style={styles.teamMeta} numberOfLines={2}>
                    {plan.pending.length} pending · {plan.ordersPending} orders
                    left
                    {plan.pending.length > 0
                      ? ` · ETA ${formatDeliveryEta(plan.estimatedMinutes)}`
                      : ''}
                    {plan.delivered.length > 0
                      ? ` · ${plan.delivered.length} stops done · ${plan.ordersDelivered} orders delivered`
                      : ''}
                  </Text>
                </View>
                <View style={styles.teamRight}>
                  <View
                    style={[
                      styles.countPill,
                      { backgroundColor: theme.accentSoft },
                    ]}
                  >
                    <Text
                      style={[styles.countPillText, { color: theme.accentDark }]}
                    >
                      {plan.pending.length}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#94A3B8"
                  />
                </View>
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.teamBody}>
                  {plan.pending.length === 0 ? (
                    <Text style={styles.teamEmpty}>
                      No pending deliveries for this spot.
                    </Text>
                  ) : (
                    plan.pending.map((location, index) => (
                      <View key={location.id} style={styles.stopRow}>
                        <View
                          style={[
                            styles.stopIndex,
                            { backgroundColor: theme.accentSoft },
                          ]}
                        >
                          <Text
                            style={[
                              styles.stopIndexText,
                              { color: theme.accentDark },
                            ]}
                          >
                            {index + 1}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.stopMain}
                          onPress={() => openEdit(location)}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.stopAddress} numberOfLines={2}>
                            {location.address}
                          </Text>
                          <Text style={styles.stopMeta} numberOfLines={1}>
                            {orderLabel(location.orderCount)} · ETA{' '}
                            {formatDeliveryEta(plan.etas[location.id] || 0)}
                            {location.assignmentMode === 'auto'
                              ? ' · auto'
                              : location.assignmentMode === 'manual'
                              ? ' · manual'
                              : ' · optimized'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.stopAction,
                            location.priority && styles.priorityAction,
                          ]}
                          onPress={() => void togglePriority(location)}
                          accessibilityLabel={
                            location.priority
                              ? 'Remove high priority'
                              : 'Mark as high priority'
                          }
                        >
                          <MaterialCommunityIcons
                            name={location.priority ? 'star' : 'star-outline'}
                            size={17}
                            color={location.priority ? '#B45309' : '#475569'}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.stopAction}
                          onPress={() => setAssignTarget(location)}
                          accessibilityLabel="Assign this delivery"
                        >
                          <MaterialCommunityIcons
                            name="account-switch-outline"
                            size={17}
                            color="#475569"
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.stopAction}
                          onPress={() => removeFromPlan(location)}
                          accessibilityLabel="Remove this delivery from the plan"
                        >
                          <MaterialCommunityIcons
                            name="link-off"
                            size={17}
                            color="#DC2626"
                          />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}

                  {plan.delivered.length > 0 && (
                    <>
                      <Text style={styles.deliveredHeading}>
                        Delivered · {plan.ordersDelivered} orders
                      </Text>
                      {[...plan.delivered]
                        .sort((a, b) =>
                          (b.deliveredAt || '').localeCompare(
                            a.deliveredAt || ''
                          )
                        )
                        .slice(0, 4)
                        .map((location) => (
                          <View key={location.id} style={styles.deliveredRow}>
                            <MaterialCommunityIcons
                              name="check-circle-outline"
                              size={14}
                              color="#15803D"
                            />
                            <Text
                              style={styles.deliveredAddress}
                              numberOfLines={1}
                            >
                              {location.address}
                            </Text>
                            <Text style={styles.deliveredOrders}>
                              {orderLabel(location.orderCount)}
                            </Text>
                          </View>
                        ))}
                      {plan.delivered.length > 4 && (
                        <Text style={styles.deliveredMore}>
                          +{plan.delivered.length - 4} more completed
                        </Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })
      )}

      {distribution.unassigned.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Needs an employee</Text>
            <Text style={[styles.sectionHint, { color: '#B45309' }]}>
              {distribution.unassigned.length}
            </Text>
          </View>
          {distribution.unassigned.map((location) => (
            <View key={location.id} style={styles.unassignedRow}>
              <MaterialCommunityIcons
                name="map-marker-question-outline"
                size={18}
                color="#B45309"
              />
              <TouchableOpacity
                style={styles.stopMain}
                onPress={() => openEdit(location)}
                activeOpacity={0.75}
              >
                <Text style={styles.stopAddress} numberOfLines={2}>
                  {location.address}
                </Text>
                <Text style={styles.stopMeta}>
                  {orderLabel(location.orderCount)} ·{' '}
                  {distribution.spotsSet === 0
                    ? 'waiting for employee spots'
                    : location.assignmentMode === 'unassigned'
                    ? 'removed from the plan'
                    : 'no matching employee spot'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.assignButton, { backgroundColor: theme.accentSoft }]}
                onPress={() => setAssignTarget(location)}
              >
                <Text style={[styles.assignButtonText, { color: theme.accentDark }]}>
                  Assign
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      <Text style={styles.footerHint}>
        Add today’s locations, then tap Optimize to distribute them by employee
        spot. Tap a delivery to edit it. Assign sends it to a chosen employee;
        remove takes it out of every plan. Managers’ changes notify the admin in
        Alerts.
      </Text>

      {/* -------------------------------------------------- Add location */}
      <Modal
        visible={addVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !addBusy && setAddVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Add delivery location</Text>
                <Text style={styles.modalSubtitle}>
                  It joins the shared list for the whole team.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setAddVisible(false)}
                disabled={addBusy}
              >
                <MaterialCommunityIcons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <LocationPicker
              label="Address"
              value={addDraft}
              onChange={setAddDraft}
              onClear={() => setAddDraft(null)}
              accent={theme.accent}
              placeholder="Search the delivery address"
            />

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Receiver</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={addContact}
                  onChangeText={setAddContact}
                  placeholder="Name"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={addPhone}
                  onChangeText={setAddPhone}
                  placeholder="Optional"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Orders at this stop</Text>
            <TextInput
              style={styles.fieldInput}
              value={addOrders}
              onChangeText={setAddOrders}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.fieldLabel}>Note</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldMultiline]}
              value={addNote}
              onChangeText={setAddNote}
              placeholder="Gate code, floor, timing…"
              placeholderTextColor="#94A3B8"
              multiline
            />

            <TouchableOpacity
              style={[
                styles.modalPrimary,
                { backgroundColor: theme.accent },
                (addBusy || !addComplete) && styles.disabled,
              ]}
              onPress={() => void saveAdd()}
              disabled={addBusy || !addComplete}
            >
              {addBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalPrimaryText}>Add to delivery list</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* -------------------------------------------------- Edit location */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="slide"
        onRequestClose={closeEdit}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Edit delivery</Text>
                <Text style={styles.modalSubtitle}>
                  Changes apply to every phone and notify the admin when a
                  manager saves.
                </Text>
              </View>
              <TouchableOpacity onPress={closeEdit} disabled={editBusy}>
                <MaterialCommunityIcons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <LocationPicker
              label="Address"
              value={editDraft}
              onChange={setEditDraft}
              onClear={() => setEditDraft(null)}
              accent={theme.accent}
              placeholder="Search the delivery address"
            />

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Receiver</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={editContact}
                  onChangeText={setEditContact}
                  placeholder="Name"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={editPhone}
                  onChangeText={setEditPhone}
                  placeholder="Optional"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Orders at this stop</Text>
            <TextInput
              style={styles.fieldInput}
              value={editOrders}
              onChangeText={setEditOrders}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor="#94A3B8"
            />

            <Text style={styles.fieldLabel}>Note</Text>
            <TextInput
              style={[styles.fieldInput, styles.fieldMultiline]}
              value={editNote}
              onChangeText={setEditNote}
              placeholder="Gate code, floor, timing…"
              placeholderTextColor="#94A3B8"
              multiline
            />

            {!!editTarget && editTarget.status !== 'delivered' && (
              <TouchableOpacity
                style={[
                  styles.outlineButton,
                  { borderColor: theme.accentBorder, marginTop: 10 },
                ]}
                onPress={() => {
                  setAssignTarget(editTarget);
                }}
              >
                <MaterialCommunityIcons
                  name="account-switch-outline"
                  size={17}
                  color={theme.accent}
                />
                <Text
                  style={[styles.outlineButtonText, { color: theme.accent }]}
                >
                  {editTarget.assignedWorkerName
                    ? `Assigned to ${editTarget.assignedWorkerName} · change`
                    : 'Assign to an employee'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.modalPrimary,
                { backgroundColor: theme.accent },
                (editBusy || !editDraft) && styles.disabled,
              ]}
              onPress={() => void saveEdit()}
              disabled={editBusy || !editDraft}
            >
              {editBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalPrimaryText}>Save changes</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={confirmDelete}
              disabled={editBusy}
            >
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={16}
                color="#DC2626"
              />
              <Text style={styles.deleteButtonText}>Delete this location</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* -------------------------------------------------- Assign worker */}
      <Modal
        visible={!!assignTarget}
        transparent
        animationType="slide"
        onRequestClose={() => !assignBusy && setAssignTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Assign delivery</Text>
                <Text style={styles.modalSubtitle} numberOfLines={2}>
                  {assignTarget?.address}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setAssignTarget(null)}
                disabled={assignBusy}
              >
                <MaterialCommunityIcons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            {teamsWithSpot.length === 0 ? (
              <Text style={styles.teamEmpty}>
                Set an employee spot first so there is someone to assign to.
              </Text>
            ) : (
              teamsWithSpot.map((plan) => (
                <TouchableOpacity
                  key={plan.worker.workerId}
                  style={styles.assignRow}
                  onPress={() => void assignTo(plan.worker)}
                  disabled={assignBusy}
                >
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: theme.accentSoft },
                    ]}
                  >
                    <Text
                      style={[styles.avatarText, { color: theme.accentDark }]}
                    >
                      {plan.worker.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.teamInfo}>
                    <Text style={styles.teamName} numberOfLines={1}>
                      {plan.worker.name}
                    </Text>
                    <Text style={styles.teamSpot} numberOfLines={1}>
                      {plan.pending.length} pending ·{' '}
                      {plan.worker.spot?.address || 'No spot'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={18}
                    color="#94A3B8"
                  />
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity
              style={[
                styles.outlineButton,
                { borderColor: theme.accentBorder, marginTop: 8 },
              ]}
              onPress={() => void makeAutomatic()}
              disabled={assignBusy}
            >
              <MaterialCommunityIcons
                name="auto-fix"
                size={16}
                color={theme.accent}
              />
              <Text style={[styles.outlineButtonText, { color: theme.accent }]}>
                Automatic · closest spot
              </Text>
            </TouchableOpacity>

            {!!assignTarget && assignTarget.assignmentMode !== 'unassigned' && (
              <TouchableOpacity
                style={styles.deassignButton}
                onPress={() => {
                  const target = assignTarget;
                  setAssignTarget(null);
                  if (target) removeFromPlan(target);
                }}
                disabled={assignBusy}
              >
                <Text style={styles.deassignButtonText}>
                  Remove from the delivery plan
                </Text>
              </TouchableOpacity>
            )}

            {assignBusy && (
              <ActivityIndicator
                style={{ marginTop: 12 }}
                color={theme.accent}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topInfo: { flex: 1 },
  title: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 11.5, color: '#64748B', marginTop: 2 },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  rolePillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
  },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  metricLabel: { fontSize: 10, color: '#64748B', marginTop: 1 },
  metricDivider: { width: 1, height: 22, backgroundColor: '#E2E8F0' },
  warning: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#FEF3E2',
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  warningText: { flex: 1, fontSize: 11.5, color: '#92400E', lineHeight: 17 },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    flexGrow: 1,
    flexBasis: 118,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: 108,
  },
  outlineButtonText: { fontWeight: '700', fontSize: 11.5 },
  disabled: { opacity: 0.55 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  sectionHint: { fontSize: 10.5, color: '#64748B' },
  empty: {
    alignItems: 'center',
    paddingVertical: 18,
    gap: 8,
  },
  emptyText: {
    fontSize: 11.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 17,
  },
  teamCard: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
    backgroundColor: '#FBFDFC',
  },
  teamTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800' },
  teamInfo: { flex: 1 },
  teamName: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  teamSpot: { fontSize: 10.5, color: '#64748B', marginTop: 1 },
  teamMeta: { fontSize: 10.5, color: '#475569', marginTop: 3 },
  teamRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countPill: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    alignItems: 'center',
  },
  countPillText: { fontSize: 11, fontWeight: '800' },
  teamBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  teamEmpty: {
    fontSize: 11.5,
    color: '#64748B',
    paddingVertical: 10,
    textAlign: 'center',
  },
  deliveredHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.4,
    marginTop: 10,
    marginBottom: 4,
  },
  deliveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  deliveredAddress: { flex: 1, fontSize: 11, color: '#475569' },
  deliveredOrders: { fontSize: 10, color: '#64748B' },
  deliveredMore: {
    fontSize: 10,
    color: '#94A3B8',
    paddingVertical: 4,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDF2F0',
  },
  stopIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIndexText: { fontSize: 10.5, fontWeight: '800' },
  stopMain: { flex: 1 },
  stopAddress: { fontSize: 12, fontWeight: '600', color: '#0F172A' },
  stopMeta: { fontSize: 10.5, color: '#64748B', marginTop: 2 },
  stopAction: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  priorityAction: { backgroundColor: '#FEF3C7' },
  unassignedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 6,
  },
  assignButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
  },
  assignButtonText: { fontSize: 11, fontWeight: '800' },
  footerHint: {
    fontSize: 10.5,
    color: '#94A3B8',
    lineHeight: 16,
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  modalHeaderText: { flex: 1 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  modalSubtitle: { fontSize: 11.5, color: '#64748B', marginTop: 3 },
  fieldRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  fieldHalf: { flex: 1 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 10,
    marginBottom: 4,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  fieldMultiline: { minHeight: 62, textAlignVertical: 'top' },
  modalPrimary: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  deleteButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#FEF2F2',
  },
  deleteButtonText: { color: '#DC2626', fontWeight: '700', fontSize: 12 },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDF2F0',
  },
  deassignButton: {
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  deassignButtonText: { color: '#DC2626', fontWeight: '700', fontSize: 12 },
});
