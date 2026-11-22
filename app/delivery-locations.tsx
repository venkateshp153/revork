import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import {
  fetchSheetRows,
  getGoogleAccessToken,
  type SheetRow,
} from '@/src/utils/sheets';
import { sendAlert } from '@/src/utils/notifications';
import { flushPendingMutations } from '@/src/services/sync';
import {
  describeGoogleMapsError,
  distanceMeters,
  geocodeAddress,
  getPlaceDetails,
  openDirectionsTo,
  searchPlaces,
  type PlaceSuggestion,
  type RouteLocation,
} from '@/src/utils/routePlanner';
import LocationPicker from '@/components/LocationPicker';
import {
  buildDistribution,
  deleteDeliveryLocation,
  findPlanForWorker,
  formatDeliveryEta,
  addDeliveryLocations,
  loadDeliveryLocations,
  removeDuplicateDeliveryLocations,
  saveWorkerSpot,
  workerSpotsFromRows,
  type DeliveryActor,
  type DeliveryLocationRecord,
  type WorkerSpot,
} from '@/src/utils/deliverySpots';

type LocationFilter = 'all' | 'pending' | 'delivered';

const REMOVE_CONFIRM_KEY = 'revork.deliveryLocations.skipRemoveConfirm.v1';

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

export default function DeliveryLocationsScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [locations, setLocations] = useState<DeliveryLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<LocationFilter>('all');

  // Inline address search.
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remove-address confirmation preference.
  const [skipRemoveConfirm, setSkipRemoveConfirm] = useState(false);
  const [removeTarget, setRemoveTarget] =
    useState<DeliveryLocationRecord | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Employee spot modal.
  const [spotWorker, setSpotWorker] = useState<WorkerSpot | null>(null);
  const [spotDraft, setSpotDraft] = useState<RouteLocation | null>(null);
  const [spotSaving, setSpotSaving] = useState(false);

  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        user.workerProfile?.workerId,
        user.email || user.workerProfile?.email
      ),
    [workers, user.workerProfile?.workerId, user.email, user.workerProfile?.email]
  );
  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const canManage = isAdmin || isManager;
  const theme = getRoleTheme(designation, !canManage);
  const actor: DeliveryActor = {
    workerId: user.workerProfile?.workerId || myRow?.WorkerID || '',
    name: user.name || myRow?.Name || 'Manager',
    isManager,
  };

  const spots = useMemo(() => workerSpotsFromRows(workers), [workers]);
  const distribution = useMemo(
    () => buildDistribution(locations, spots),
    [locations, spots]
  );
  const myPlan = useMemo(
    () =>
      findPlanForWorker(
        distribution,
        user.workerProfile?.workerId || myRow?.WorkerID,
        user.name || user.workerProfile?.name
      ),
    [
      distribution,
      user.workerProfile?.workerId,
      user.workerProfile?.name,
      myRow?.WorkerID,
      user.name,
    ]
  );

  const assignmentById = useMemo(() => {
    const map = new Map<
      string,
      { workerName: string; distanceMeters: number; etaMinutes: number }
    >();
    distribution.plans.forEach((plan) => {
      if (!plan.worker.spot) return;
      plan.pending.forEach((location) => {
        map.set(location.id, {
          workerName: plan.worker.name,
          distanceMeters: distanceMeters(plan.worker.spot!, location),
          etaMinutes: plan.etas[location.id] || 0,
        });
      });
    });
    return map;
  }, [distribution]);

  /** How many pending addresses the draft spot would win right now. */
  const spotPreviewCount = useMemo(() => {
    if (!spotWorker || !spotDraft) return 0;
    const otherSpots = distribution.plans.filter(
      (plan) =>
        plan.worker.workerId !== spotWorker.workerId && !!plan.worker.spot
    );
    return locations.filter((location) => {
      if (location.status === 'delivered') return false;
      if (location.assignmentMode !== 'auto') return false;
      let bestDistance = distanceMeters(spotDraft, location);
      otherSpots.forEach((plan) => {
        const distance = distanceMeters(plan.worker.spot!, location);
        if (distance < bestDistance) bestDistance = distance;
      });
      return distanceMeters(spotDraft, location) <= bestDistance;
    }).length;
  }, [spotWorker, spotDraft, distribution.plans, locations]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(REMOVE_CONFIRM_KEY)
      .then((value) => {
        if (alive) setSkipRemoveConfirm(value === 'true');
      })
      .catch(() => {
        // Preference is optional; keep the confirmation enabled.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const text = query.trim();
    if (text.length < 3) {
      setSuggestions([]);
      setSearchError('');
      return () => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
      };
    }

    searchTimer.current = setTimeout(async () => {
      try {
        setSearching(true);
        setSearchError('');
        const results = await searchPlaces(text);
        setSuggestions(results.slice(0, 6));
      } catch (error: any) {
        setSuggestions([]);
        setSearchError(
          describeGoogleMapsError(error) ||
            'Address search is unavailable. Try again or enter the address another way.'
        );
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const refresh = useCallback(
    async (showSpinner = false) => {
      if (!sheetId) {
        setLoading(false);
        return;
      }
      if (showSpinner) setRefreshing(true);
      try {
        const [rows, deliveryLocations] = await Promise.all([
          fetchSheetRows(sheetId, 'Workers').catch(() => [] as SheetRow[]),
          loadDeliveryLocations(sheetId),
        ]);
        setWorkers(rows);
        setLocations(deliveryLocations);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sheetId]
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  // Managers clean duplicate address rows from the shared sheet once loaded.
  useEffect(() => {
    if (!sheetId || !canManage) return;
    let alive = true;
    (async () => {
      const removed = await removeDuplicateDeliveryLocations(sheetId);
      if (alive && removed > 0) {
        await refresh();
      }
    })();
    return () => {
      alive = false;
    };
  }, [sheetId, canManage, refresh]);

  const visibleLocations = useMemo(() => {
    if (canManage) return locations;
    if (!myPlan) return [];
    // Employees only ever see the pending locations assigned to them (whether
    // auto, optimized or manual) plus the ones they delivered themselves.
    const ids = new Set<string>([
      ...myPlan.pending.map((location) => location.id),
      ...myPlan.delivered.map((location) => location.id),
    ]);
    return locations.filter((location) => ids.has(location.id));
  }, [canManage, locations, myPlan]);

  const filteredLocations = useMemo(() => {
    return visibleLocations.filter((location) => {
      if (filter === 'pending' && location.status === 'delivered') return false;
      if (filter === 'delivered' && location.status !== 'delivered') return false;
      return true;
    });
  }, [visibleLocations, filter]);

  // ------------------------------------------------------------ address search
  const addLocation = async (location: RouteLocation) => {
    const normalized = location.address.trim().toLowerCase();
    const alreadyExists = locations.some(
      (item) => item.address.trim().toLowerCase() === normalized
    );
    if (alreadyExists) {
      throw new Error('That address is already in the list.');
    }

    const added = await addDeliveryLocations(
      sheetId,
      [
        {
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        },
      ],
      user.name || user.email || 'Admin',
      actor,
      spots
    );
    if (added === 0) {
      throw new Error('Could not save that address.');
    }
    // Write to the sheet immediately instead of leaving it in the sync queue.
    await flushPendingMutations(true);
    setQuery('');
    setSuggestions([]);
    setSearchError('');
    await refresh();
  };

  const addAddressFromSuggestion = async (suggestion: PlaceSuggestion) => {
    if (addingAddress) return;
    setAddingAddress(true);
    setSearching(true);
    setSearchError('');
    try {
      const location: RouteLocation =
        typeof suggestion.lat === 'number' && typeof suggestion.lng === 'number'
          ? {
              address:
                suggestion.description ||
                suggestion.mainText ||
                `${suggestion.lat}, ${suggestion.lng}`,
              lat: suggestion.lat,
              lng: suggestion.lng,
              placeId: suggestion.placeId,
            }
          : await getPlaceDetails(suggestion.placeId);
      await addLocation(location);
    } catch (error: any) {
      setSearchError(error?.message || 'Could not add that address.');
    } finally {
      setAddingAddress(false);
      setSearching(false);
    }
  };

  const addTypedAddress = async () => {
    const text = query.trim();
    if (text.length < 3 || addingAddress) return;
    setAddingAddress(true);
    setSearching(true);
    setSearchError('');
    try {
      const location = await geocodeAddress(text);
      await addLocation(location);
    } catch (error: any) {
      setSearchError(error?.message || 'Could not find that address.');
    } finally {
      setAddingAddress(false);
      setSearching(false);
    }
  };

  // ------------------------------------------------------------ removal
  const performRemove = async (location: DeliveryLocationRecord) => {
    try {
      await deleteDeliveryLocation(sheetId, location, actor);
      await refresh();
    } catch (error: any) {
      Alert.alert(
        'Could not remove',
        error?.message || 'Try again in a moment.'
      );
    }
  };

  const onRemovePress = (location: DeliveryLocationRecord) => {
    if (skipRemoveConfirm) {
      void performRemove(location);
      return;
    }
    setDontAskAgain(false);
    setRemoveTarget(location);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    if (dontAskAgain) {
      setSkipRemoveConfirm(true);
      void AsyncStorage.setItem(REMOVE_CONFIRM_KEY, 'true').catch(() => {});
    }
    setRemoveTarget(null);
    await performRemove(target);
  };

  // ------------------------------------------------------------ employee spot
  const openSpotEditor = (worker: WorkerSpot) => {
    setSpotWorker(worker);
    setSpotDraft(worker.spot);
  };

  const closeSpotEditor = () => {
    if (spotSaving) return;
    setSpotWorker(null);
    setSpotDraft(null);
  };

  const saveSpot = async (clear = false) => {
    if (!spotWorker) return;
    setSpotSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        Alert.alert(
          'Sign in required',
          'Sign in with the company Google account to change employee spots.'
        );
        return;
      }
      await saveWorkerSpot(
        sheetId,
        token,
        { workerId: spotWorker.workerId, email: spotWorker.email },
        clear ? null : spotDraft
      );
      if (isManager) {
        void sendAlert({
          sheetId,
          token,
          target: 'admin',
          title: 'Delivery spot changed by manager',
          body: `${actor.name || 'A manager'} ${
            clear ? 'removed' : 'changed'
          } the delivery spot for ${spotWorker.name}.`,
          durationHours: 0,
          fromUid: actor.workerId || actor.name || 'manager',
          type: 'delivery_audit',
        }).catch(() => {});
      }
      setSpotWorker(null);
      setSpotDraft(null);
      await refresh();
      Alert.alert(
        clear ? 'Spot cleared' : 'Spot saved',
        clear
          ? `${spotWorker.name} will no longer receive automatic deliveries. Any saved assignment to them will show as unassigned.`
          : `New addresses closest to this spot will be linked to ${spotWorker.name}. Use Optimize in Route to redistribute saved deliveries.`
      );
    } catch (error: any) {
      Alert.alert(
        'Could not save spot',
        error?.message || 'Check your connection and permissions.'
      );
    } finally {
      setSpotSaving(false);
    }
  };

  const navigateToLocation = async (location: DeliveryLocationRecord) => {
    try {
      await openDirectionsTo({
        address: location.address,
        lat: location.lat,
        lng: location.lng,
      });
    } catch {
      Alert.alert('Could not open Maps', 'Install Google Maps and try again.');
    }
  };

  // ------------------------------------------------------------ render
  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.headerText }]}>
            Delivery spots
          </Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            Employee spots and the shared delivery location list
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => void refresh(true)}
          disabled={refreshing}
          accessibilityLabel="Refresh delivery list"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.headerText} />
          ) : (
            <MaterialCommunityIcons
              name="refresh"
              size={20}
              color={theme.headerText}
            />
          )}
        </TouchableOpacity>
        {canManage && (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.push('/delivery-team')}
            accessibilityLabel="Team delivery tracking"
          >
            <MaterialCommunityIcons
              name="account-group-outline"
              size={20}
              color={theme.headerText}
            />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.loadingText}>Loading delivery list…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {!canManage && !myPlan?.worker.spot && (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons
                name="map-marker-off-outline"
                size={28}
                color="#94A3B8"
              />
              <Text style={styles.emptyText}>
                Your delivery spot has not been set yet. Ask a manager or admin
                to set it, then deliveries around that spot will be assigned to
                you automatically.
              </Text>
            </View>
          )}

          {canManage && (
            <>
              <View style={styles.addSearchCard}>
                <Text style={styles.addSearchLabel}>Add a delivery location</Text>
                <View style={styles.addSearchRow}>
                  <MaterialCommunityIcons
                    name="magnify"
                    size={18}
                    color="#64748B"
                  />
                  <TextInput
                    style={styles.addSearchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search an address to add"
                    placeholderTextColor="#94A3B8"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={() => void addTypedAddress()}
                  />
                  {!!query && !addingAddress && (
                    <TouchableOpacity
                      onPress={() => {
                        setQuery('');
                        setSuggestions([]);
                        setSearchError('');
                      }}
                      accessibilityLabel="Clear address search"
                    >
                      <MaterialCommunityIcons
                        name="close-circle"
                        size={17}
                        color="#94A3B8"
                      />
                    </TouchableOpacity>
                  )}
                  {searching && (
                    <ActivityIndicator size="small" color={theme.accent} />
                  )}
                  <TouchableOpacity
                    style={[
                      styles.scanInlineButton,
                      { backgroundColor: theme.accentSoft },
                    ]}
                    onPress={() =>
                      Alert.alert(
                        'Scan list',
                        'Camera address-list scanning will be available in the next update.'
                      )
                    }
                    accessibilityLabel="Scan address list"
                  >
                    <MaterialCommunityIcons
                      name="camera-outline"
                      size={20}
                      color={theme.accent}
                    />
                  </TouchableOpacity>
                </View>
                {!!searchError && (
                  <Text style={styles.addSearchError}>{searchError}</Text>
                )}
                {suggestions.length > 0 && (
                  <View style={styles.addSuggestions}>
                    {suggestions.map((suggestion) => (
                      <TouchableOpacity
                        key={suggestion.placeId}
                        style={styles.addSuggestionRow}
                        onPress={() => void addAddressFromSuggestion(suggestion)}
                        disabled={addingAddress}
                      >
                        <MaterialCommunityIcons
                          name="map-marker-outline"
                          size={16}
                          color="#64748B"
                        />
                        <View style={styles.addSuggestionText}>
                          <Text
                            style={styles.addSuggestionMain}
                            numberOfLines={1}
                          >
                            {suggestion.mainText}
                          </Text>
                          {!!suggestion.secondaryText && (
                            <Text
                              style={styles.addSuggestionSecondary}
                              numberOfLines={1}
                            >
                              {suggestion.secondaryText}
                            </Text>
                          )}
                        </View>
                        <MaterialCommunityIcons
                          name="plus-circle-outline"
                          size={18}
                          color={theme.accent}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Employee spots</Text>
                  <Text style={styles.sectionSubtitle}>
                    Only admins and managers can change a spot
                  </Text>
                </View>
                {refreshing && (
                  <ActivityIndicator size="small" color={theme.accent} />
                )}
              </View>

              {spots.length === 0 ? (
                <View style={styles.emptyCard}>
                  <MaterialCommunityIcons
                    name="account-group-outline"
                    size={26}
                    color="#94A3B8"
                  />
                  <Text style={styles.emptyText}>
                    Add employees from the Workers tab, then set a spot for each
                    of them.
                  </Text>
                </View>
              ) : (
                spots.map((worker) => {
                  const plan = distribution.plans.find(
                    (item) => item.worker.workerId === worker.workerId
                  );
                  return (
                    <View key={`${worker.workerId}-${worker.row}`} style={styles.workerCard}>
                      <View
                        style={[
                          styles.workerAvatar,
                          { backgroundColor: theme.accentSoft },
                        ]}
                      >
                        <Text
                          style={[
                            styles.workerAvatarText,
                            { color: theme.accentDark },
                          ]}
                        >
                          {worker.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.workerInfo}>
                        <Text style={styles.workerName} numberOfLines={1}>
                          {worker.name}
                        </Text>
                        <Text style={styles.workerMeta} numberOfLines={1}>
                          {worker.spot
                            ? worker.spot.address
                            : 'No spot set · receives no auto-assignments'}
                        </Text>
                        {!!worker.spot && (
                          <Text style={styles.workerStats}>
                            {plan?.pending.length || 0} pending ·{' '}
                            {plan?.delivered.length || 0} delivered · ETA{' '}
                            {formatDeliveryEta(plan?.estimatedMinutes || 0)}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={styles.spotButton}
                        onPress={() => openSpotEditor(worker)}
                      >
                        <Text
                          style={[styles.spotButtonText, { color: theme.accent }]}
                        >
                          {worker.spot ? 'Change' : 'Set spot'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </>
          )}

          {!canManage && myPlan?.worker.spot && (
            <View style={[styles.mySpotCard, { borderColor: theme.accentBorder }]}>
              <View style={styles.mySpotTop}>
                <View
                  style={[styles.mySpotIcon, { backgroundColor: theme.accentSoft }]}
                >
                  <MaterialCommunityIcons
                    name="map-marker-radius"
                    size={20}
                    color={theme.accent}
                  />
                </View>
                <View style={styles.mySpotInfo}>
                  <Text style={styles.mySpotLabel}>Your spot</Text>
                  <Text style={styles.mySpotAddress} numberOfLines={2}>
                    {myPlan.worker.spot.address}
                  </Text>
                </View>
              </View>
              <View style={styles.mySpotStats}>
                <View style={styles.mySpotStat}>
                  <Text style={styles.mySpotValue}>
                    {myPlan.pending.length}
                  </Text>
                  <Text style={styles.mySpotStatLabel}>Remaining</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.mySpotStat}>
                  <Text style={styles.mySpotValue}>
                    {myPlan.delivered.length}
                  </Text>
                  <Text style={styles.mySpotStatLabel}>Delivered</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.mySpotStat}>
                  <Text style={styles.mySpotValue}>
                    {formatDeliveryEta(myPlan.estimatedMinutes)}
                  </Text>
                  <Text style={styles.mySpotStatLabel}>Est. time</Text>
                </View>
              </View>
              {!!myPlan.current && (
                <View style={styles.currentOrder}>
                  <MaterialCommunityIcons
                    name="navigation-variant-outline"
                    size={16}
                    color={theme.accentDark}
                  />
                  <View style={styles.currentOrderText}>
                    <Text style={styles.currentOrderLabel}>Next delivery</Text>
                    <Text style={styles.currentOrderAddress} numberOfLines={2}>
                      {myPlan.current.address}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.currentOrderButton, { backgroundColor: theme.accent }]}
                    onPress={() => void navigateToLocation(myPlan.current!)}
                  >
                    <MaterialCommunityIcons
                      name="navigation"
                      size={15}
                      color="#fff"
                    />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {canManage && distribution.unassigned.length > 0 && (
            <View style={styles.warningCard}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color="#B45309"
              />
              <Text style={styles.warningText}>
                {distribution.unassigned.length} pending address
                {distribution.unassigned.length === 1 ? '' : 'es'} {distribution.unassigned.length === 1 ? 'is' : 'are'} not assigned to an employee. Set a spot or assign {distribution.unassigned.length === 1 ? 'it' : 'them'} from Delivery control.
              </Text>
            </View>
          )}

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>
                {canManage ? 'Delivery locations' : 'My delivery locations'}
              </Text>
              <Text style={styles.sectionSubtitle}>
                {canManage
                  ? 'Shared with the whole team'
                  : 'Only deliveries assigned to you are shown'}
              </Text>
            </View>
          </View>

          <View style={styles.filterRow}>
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'pending', label: 'Pending' },
                { key: 'delivered', label: 'Done' },
              ] as { key: LocationFilter; label: string }[]
            ).map((item) => {
              const active = filter === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.filterChip,
                    active && {
                      backgroundColor: theme.accentSoft,
                      borderColor: theme.accentBorder,
                    },
                  ]}
                  onPress={() => setFilter(item.key)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      active && { color: theme.accentDark },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {filteredLocations.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialCommunityIcons
                name="map-marker-off-outline"
                size={30}
                color="#94A3B8"
              />
              <Text style={styles.emptyText}>
                {visibleLocations.length === 0
                  ? canManage
                    ? 'No delivery addresses yet. Add a few to get started.'
                    : 'No deliveries are assigned to your spot yet. New addresses near your spot will appear here.'
                  : 'No addresses match this filter.'}
              </Text>
            </View>
          ) : (
            filteredLocations.map((location) => {
              const assignment = assignmentById.get(location.id);
              return (
                <View key={location.id} style={styles.locationCard}>
                  <View style={styles.locationTop}>
                    <View
                      style={[
                        styles.locationIcon,
                        {
                          backgroundColor:
                            location.status === 'delivered'
                              ? '#DCFCE7'
                              : theme.accentSoft,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={
                          location.status === 'delivered'
                            ? 'check'
                            : 'map-marker-outline'
                        }
                        size={16}
                        color={
                          location.status === 'delivered'
                            ? '#15803D'
                            : theme.accent
                        }
                      />
                    </View>
                    <View style={styles.locationInfo}>
                      <Text style={styles.locationAddress} numberOfLines={2}>
                        {location.address}
                      </Text>
                      {!!(location.contactName || location.phone) && (
                        <Text style={styles.locationMeta} numberOfLines={1}>
                          {[location.contactName, location.phone]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      )}
                      <View style={styles.locationChipRow}>
                        {location.status === 'delivered' ? (
                          <View style={styles.deliveredChip}>
                            <MaterialCommunityIcons
                              name="check-decagram"
                              size={10}
                              color="#15803D"
                            />
                            <Text style={styles.deliveredChipText}>
                              Delivered
                              {location.workerName
                                ? ` · ${location.workerName}`
                                : ''}
                            </Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.assignedChip,
                              { backgroundColor: theme.accentSoft },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="account-arrow-right-outline"
                              size={10}
                              color={theme.accentDark}
                            />
                            <Text
                              style={[
                                styles.assignedChipText,
                                { color: theme.accentDark },
                              ]}
                            >
                              {assignment
                                ? `${assignment.workerName}${
                                    assignment.distanceMeters
                                      ? ` · ${formatDistance(
                                          assignment.distanceMeters
                                        )}`
                                      : ''
                                  }${
                                    assignment.etaMinutes
                                      ? ` · ETA ${formatDeliveryEta(
                                          assignment.etaMinutes
                                        )}`
                                      : ''
                                  }${
                                    location.assignmentMode === 'manual'
                                      ? ' · manual'
                                      : location.assignmentMode === 'optimized'
                                      ? ' · optimized'
                                      : ''
                                  }`
                                : location.assignmentMode === 'unassigned'
                                ? 'Removed from every plan'
                                : 'Waiting for a spot'}
                            </Text>
                          </View>
                        )}
                        {!!location.orderCount && (
                          <Text style={styles.locationOrders}>
                            {location.orderCount} order
                            {location.orderCount === 1 ? '' : 's'}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                  <View style={styles.locationActions}>
                    <TouchableOpacity
                      style={styles.locationAction}
                      onPress={() => void navigateToLocation(location)}
                    >
                      <MaterialCommunityIcons
                        name="navigation-outline"
                        size={16}
                        color="#475569"
                      />
                    </TouchableOpacity>
                    {canManage && (
                      <TouchableOpacity
                        style={styles.removeCrossButton}
                        onPress={() => onRemovePress(location)}
                        accessibilityLabel="Remove address"
                      >
                        <MaterialCommunityIcons
                          name="close"
                          size={18}
                          color="#DC2626"
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}

          <View style={styles.footerNote}>
            <MaterialCommunityIcons
              name="information-outline"
              size={13}
              color="#94A3B8"
            />
            <Text style={styles.footerNoteText}>
              New addresses follow the closest employee spot automatically.
              Assignments can be changed from the Route tab.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ---------------------------------------------------- Remove address */}
      <Modal
        visible={!!removeTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Remove address?</Text>
            <Text style={styles.modalSubtitle}>
              Are you sure you want to remove this address from the delivery
              list?
            </Text>
            {!!removeTarget && (
              <Text style={styles.removeAddressText}>
                {removeTarget.address}
              </Text>
            )}

            <TouchableOpacity
              style={styles.dontAskRow}
              onPress={() => setDontAskAgain((value) => !value)}
            >
              <MaterialCommunityIcons
                name={
                  dontAskAgain
                    ? 'checkbox-marked'
                    : 'checkbox-blank-outline'
                }
                size={20}
                color={dontAskAgain ? theme.accent : '#94A3B8'}
              />
              <Text style={styles.dontAskText}>Don&apos;t show this again</Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setRemoveTarget(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimary, { backgroundColor: '#DC2626' }]}
                onPress={() => void confirmRemove()}
              >
                <Text style={styles.modalPrimaryText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---------------------------------------------------- Employee spot */}
      <Modal
        visible={!!spotWorker}
        transparent
        animationType="slide"
        onRequestClose={closeSpotEditor}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, styles.sheetCard]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalTitle}>Delivery spot</Text>
                <Text style={styles.modalSubtitle}>
                  {spotWorker?.name} gets new auto addresses closest to this
                  point. Optimize redistributes the saved plan.
                </Text>
              </View>
              <TouchableOpacity onPress={closeSpotEditor} disabled={spotSaving}>
                <MaterialCommunityIcons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <LocationPicker
              label="Employee spot"
              value={spotDraft}
              onChange={setSpotDraft}
              onClear={() => setSpotDraft(null)}
              accent={theme.accent}
              placeholder="Search the employee’s base area"
            />

            <View style={styles.spotSummary}>
              <MaterialCommunityIcons
                name="account-arrow-right-outline"
                size={15}
                color="#64748B"
              />
              <Text style={styles.spotSummaryText}>
                {spotWorker
                  ? spotDraft
                    ? `${spotPreviewCount} new/auto address${
                        spotPreviewCount === 1 ? '' : 'es'
                      } would be linked to ${spotWorker.name} from this spot.`
                    : `${spotWorker.name} will not receive auto-assigned deliveries.`
                  : ''}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.modalPrimary,
                { backgroundColor: theme.accent },
                spotSaving && styles.disabled,
              ]}
              onPress={() => void saveSpot(false)}
              disabled={spotSaving || !spotDraft}
            >
              {spotSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalPrimaryText}>Save spot</Text>
              )}
            </TouchableOpacity>
            {!!spotWorker?.spot && (
              <TouchableOpacity
                style={styles.clearSpotButton}
                onPress={() => void saveSpot(true)}
                disabled={spotSaving}
              >
                <Text style={styles.clearSpotText}>Remove this spot</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    paddingTop: 58,
    paddingBottom: 18,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginRight: 10,
  },
  headerText: { flex: 1 },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginLeft: 8,
  },
  title: { fontSize: 21, fontWeight: '800' },
  subtitle: { fontSize: 11, marginTop: 3 },
  content: { padding: 16, paddingBottom: 110 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: { marginTop: 10, fontSize: 12, color: '#64748B' },

  statDivider: { width: 1, height: 28, backgroundColor: '#F1F5F9' },

  actionRow: { flexDirection: 'row', marginBottom: 8 },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
  },
  actionButtonOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#fff',
  },
  actionText: { color: '#fff', fontSize: 12.5, fontWeight: '800', marginLeft: 6 },
  hint: {
    fontSize: 10,
    color: '#64748B',
    lineHeight: 15,
    marginBottom: 14,
  },
  addSearchCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 10,
  },
  addSearchLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  addSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 9,
  },
  addSearchInput: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    fontSize: 12.5,
    color: '#1E293B',
  },
  scanInlineButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  addSearchError: {
    fontSize: 10,
    color: '#DC2626',
    lineHeight: 14,
    marginTop: 6,
  },
  addSuggestions: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  addSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  addSuggestionText: { flex: 1, marginLeft: 6 },
  addSuggestionMain: { fontSize: 11.5, fontWeight: '700', color: '#1E293B' },
  addSuggestionSecondary: { fontSize: 9.5, color: '#64748B', marginTop: 1 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 9,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  sectionSubtitle: { fontSize: 10, color: '#94A3B8', marginTop: 2 },

  workerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  workerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerAvatarText: { fontSize: 15, fontWeight: '800' },
  workerInfo: { flex: 1, marginLeft: 10 },
  workerName: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  workerMeta: { fontSize: 10, color: '#64748B', marginTop: 2 },
  workerStats: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  spotButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginLeft: 8,
  },
  spotButtonText: { fontSize: 10, fontWeight: '800' },

  mySpotCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
    marginBottom: 14,
  },
  mySpotTop: { flexDirection: 'row', alignItems: 'center' },
  mySpotIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mySpotInfo: { flex: 1, marginLeft: 10 },
  mySpotLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '700' },
  mySpotAddress: { fontSize: 13, color: '#1E293B', fontWeight: '700', marginTop: 2 },
  mySpotStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  mySpotStat: { flex: 1, alignItems: 'center' },
  mySpotValue: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  mySpotStatLabel: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  currentOrder: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 9,
    marginTop: 11,
  },
  currentOrderText: { flex: 1, marginLeft: 7 },
  currentOrderLabel: { fontSize: 9, color: '#94A3B8', fontWeight: '700' },
  currentOrderAddress: { fontSize: 11.5, color: '#1E293B', fontWeight: '700', marginTop: 1 },
  currentOrderButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },

  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 10,
    marginBottom: 12,
  },
  warningText: {
    flex: 1,
    fontSize: 10,
    color: '#92400E',
    marginLeft: 7,
    lineHeight: 14,
  },

  filterRow: { flexDirection: 'row', marginBottom: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    marginRight: 7,
    backgroundColor: '#fff',
  },
  filterChipText: { fontSize: 10, fontWeight: '700', color: '#64748B' },

  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 22,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },

  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 8,
  },
  locationTop: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  locationIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationInfo: { flex: 1, marginLeft: 9 },
  locationAddress: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  locationMeta: { fontSize: 10, color: '#64748B', marginTop: 2 },
  locationChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 5,
  },
  assignedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  assignedChipText: { fontSize: 8.5, fontWeight: '800', marginLeft: 3 },
  deliveredChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    backgroundColor: '#DCFCE7',
  },
  deliveredChipText: { fontSize: 8.5, fontWeight: '800', color: '#15803D', marginLeft: 3 },
  locationOrders: { fontSize: 8.5, color: '#94A3B8', fontWeight: '700' },
  locationActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 6 },
  locationAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 5,
  },
  removeCrossButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 5,
  },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    marginTop: 8,
  },
  footerNoteText: {
    flex: 1,
    fontSize: 9.5,
    color: '#94A3B8',
    lineHeight: 14,
    marginLeft: 5,
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
    padding: 16,
    maxHeight: '92%',
  },
  sheetCard: { paddingBottom: 30 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalHeaderText: { flex: 1, paddingRight: 10 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  modalSubtitle: { fontSize: 10.5, color: '#64748B', marginTop: 3, lineHeight: 15 },
  removeAddressText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 8,
    lineHeight: 17,
  },
  dontAskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  dontAskText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginLeft: 8,
  },
  addInput: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    padding: 11,
    fontSize: 12.5,
    color: '#1E293B',
    marginBottom: 10,
  },
  errorText: { fontSize: 11, color: '#DC2626', lineHeight: 16 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressText: { fontSize: 10.5, color: '#64748B', marginLeft: 7 },
  modalPrimary: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 6,
  },
  modalPrimaryText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  modalButtons: { flexDirection: 'row', marginTop: 16 },
  modalCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: '#F1F5F9',
    marginRight: 8,
  },
  modalCancelText: { fontSize: 12.5, fontWeight: '800', color: '#475569' },
  disabled: { opacity: 0.5 },

  scanActions: { flexDirection: 'row', marginBottom: 8 },
  scanButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
  },
  scanButtonOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  scanButtonText: { color: '#fff', fontSize: 12, fontWeight: '800', marginLeft: 6 },
  scanErrorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  scanFallback: { fontSize: 11, fontWeight: '800', marginTop: 7 },
  scanResults: { maxHeight: 300, marginTop: 4 },
  scanResultsTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  scanAddress: {
    flex: 1,
    fontSize: 11.5,
    color: '#334155',
    lineHeight: 16,
    marginLeft: 8,
  },
  spotSummary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 9,
    marginBottom: 4,
  },
  spotSummaryText: {
    flex: 1,
    fontSize: 10,
    color: '#64748B',
    lineHeight: 15,
    marginLeft: 6,
  },
  clearSpotButton: { alignItems: 'center', paddingVertical: 12 },
  clearSpotText: { fontSize: 11.5, color: '#DC2626', fontWeight: '700' },
});
