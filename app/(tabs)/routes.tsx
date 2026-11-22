import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { router, useFocusEffect } from 'expo-router';
import { RootState } from '@/redux/store';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import { effectiveDesignation, findMyWorkerRow } from '@/src/utils/workerManagement';
import { fetchSheetRows, type SheetRow } from '@/src/utils/sheets';
import LocationPicker from '@/components/LocationPicker';
import RouteMap from '@/components/RouteMap';
import DeliveryProofBox from '@/components/DeliveryProofBox';
import DeliveryProofModal from '@/components/DeliveryProofModal';
import DeliveryControlPanel from '@/components/DeliveryControlPanel';
import PhotoViewerModal, {
  type ViewerPhoto,
} from '@/components/PhotoViewerModal';
import { useDeliveryPhotos } from '@/src/hooks/useDeliveryPhotos';
import {
  addDeliveryPhotos,
  loadDeliveryPhotos,
  releaseDeliveryPhotosForStop,
  removeDeliveryPhoto,
  removeDeliveryPhotosForStop,
  setDeliverySyncContext,
  subscribeDeliveryPhotos,
  syncDeliveryPhotos,
  type DeliveryPhotoRecord,
} from '@/src/utils/deliveryPhotos';
import {
  deliveryPhotoFolder,
  localDateStamp,
  localTimeStamp,
  logDelivery,
  makeDeliveryId,
} from '@/src/utils/deliveryLog';
import { pickProofImages, type ProofPhotoSource } from '@/src/utils/proofPicker';
import { getProofCheckIn } from '@/src/utils/proofLocation';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';
import {
  describeGoogleMapsError,
  formatDistance,
  formatDuration,
  geocodeAddress,
  getCurrentLocation,
  getPlaceDetails,
  isLocationEnabled,
  nearestNeighbourOrder,
  openDirectionsTo,
  openFullRouteInGoogleMaps,
  openLocationSettings,
  optimizeRoute,
  requestLocationAccess,
  searchPlaces,
  straightPath,
  type PlaceSuggestion,
  type RouteLocation,
  type RouteStop,
} from '@/src/utils/routePlanner';
import {
  createRoute,
  dedupeRouteStops,
  loadRouteState,
  normalizeAddressKey,
  routeShareText,
  saveRouteState,
  sortPriorityStops,
  type SavedRoute,
} from '@/src/utils/routeStore';
import {
  addDeliveryLocations,
  buildDistribution,
  estimateDeliveryMinutes,
  findPlanForWorker,
  formatDeliveryEta,
  loadDeliveryLocations,
  removeDuplicateDeliveryLocations,
  setLocationDelivered,
  workerSpotsFromRows,
  type DeliveryLocationRecord,
} from '@/src/utils/deliverySpots';
import { flushPendingMutations } from '@/src/services/sync';

function stopId(): string {
  return `stop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The daily route is named after today's date. */
function todayRouteName(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDeliveryTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Live elapsed time shown on the running-route status bar. */
function formatElapsedTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

type StopFilter = 'all' | 'pending' | 'delivered';

export default function RouteScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [deliveryLocations, setDeliveryLocations] = useState<DeliveryLocationRecord[]>([]);

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
  const canAssign = isAdmin || isManager;
  const theme = getRoleTheme(designation, !canAssign);

  // Shared delivery spots: pending addresses are assigned to the employee
  // whose spot is closest, so everyone sees the same plan on every device.
  const workerSpots = useMemo(() => workerSpotsFromRows(workers), [workers]);
  const distribution = useMemo(
    () => buildDistribution(deliveryLocations, workerSpots),
    [deliveryLocations, workerSpots]
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

  // Every pending location assigned to this employee (auto, optimized or
  // manual). Locations belonging to other employees are never included.
  const myAssignedPending = useMemo(
    () => (myPlan ? myPlan.pending : []),
    [myPlan]
  );
  const myLocationIds = useMemo(() => {
    const ids = new Set<string>();
    const addresses = new Set<string>();
    const add = (location: DeliveryLocationRecord) => {
      if (location.id) ids.add(location.id);
      const key = normalizeAddressKey(location.address);
      if (key) addresses.add(key);
    };
    myPlan?.pending.forEach(add);
    myPlan?.delivered.forEach(add);
    return { ids, addresses };
  }, [myPlan]);
  const myLocationIdByAddress = useMemo(() => {
    const map = new Map<string, string>();
    const add = (location: DeliveryLocationRecord) => {
      const key = normalizeAddressKey(location.address);
      if (key && location.id) map.set(key, location.id);
    };
    myPlan?.pending.forEach(add);
    myPlan?.delivered.forEach(add);
    return map;
  }, [myPlan]);
  const priorityLocations = useMemo(() => {
    const ids = new Set<string>();
    const addresses = new Set<string>();
    myPlan?.pending.forEach((location) => {
      if (!location.priority) return;
      if (location.id) ids.add(location.id);
      const key = normalizeAddressKey(location.address);
      if (key) addresses.add(key);
    });
    return { ids, addresses };
  }, [myPlan]);
  const myAssignedEstimate = useMemo(
    () =>
      myPlan?.worker.spot
        ? estimateDeliveryMinutes(myPlan.worker.spot, myAssignedPending)
        : null,
    [myPlan, myAssignedPending]
  );

  // Address search.
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stops.
  const [stopQuery, setStopQuery] = useState('');
  const [stopFilter, setStopFilter] = useState<StopFilter>('all');

  // Start-route setup: where the employee begins and finishes the day.
  const [startSetupVisible, setStartSetupVisible] = useState(false);
  const [startSetupStart, setStartSetupStart] =
    useState<RouteLocation | null>(null);
  const [startSetupEnd, setStartSetupEnd] =
    useState<RouteLocation | null>(null);
  const [startSetupBusy, setStartSetupBusy] = useState(false);

  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualText, setManualText] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  const [routeModalVisible, setRouteModalVisible] = useState(false);
  const [routing, setRouting] = useState(false);

  const [detailStopId, setDetailStopId] = useState<string | null>(null);
  const [menuStopId, setMenuStopId] = useState<string | null>(null);
  const [proofStopId, setProofStopId] = useState<string | null>(null);

  // Inline stop details editing.
  const [detailNoteEditing, setDetailNoteEditing] = useState(false);
  const [detailNoteDraft, setDetailNoteDraft] = useState('');
  const [contactEditing, setContactEditing] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [orderCountDraft, setOrderCountDraft] = useState('1');
  const [detailPhotoBusy, setDetailPhotoBusy] = useState(false);
  const [detailPhotoSyncing, setDetailPhotoSyncing] = useState(false);
  const [pendingProofUploads, setPendingProofUploads] = useState(0);
  const [viewerPhoto, setViewerPhoto] = useState<DeliveryPhotoRecord | null>(
    null
  );
  const [deliverySettings, setDeliverySettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );

  // New stop details popup.
  const [stopDetailsVisible, setStopDetailsVisible] = useState(false);
  const [pendingStopLocation, setPendingStopLocation] =
    useState<RouteLocation | null>(null);
  const [pendingStopName, setPendingStopName] = useState('');
  const [pendingStopPhone, setPendingStopPhone] = useState('');
  const [pendingStopNote, setPendingStopNote] = useState('');

  const detailPhotos = useDeliveryPhotos(detailStopId);

  const [currentLocation, setCurrentLocation] = useState<RouteLocation | null>(
    null
  );
  const [locating, setLocating] = useState(false);

  const activeRoute = useMemo(
    () => routes.find((route) => route.id === activeId) || null,
    [routes, activeId]
  );

  // Live clock for the running-route timer.
  const [clockTick, setClockTick] = useState(Date.now());
  useEffect(() => {
    if (activeRoute?.status !== 'active') return;
    setClockTick(Date.now());
    const id = setInterval(() => setClockTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeRoute?.status, activeRoute?.id]);

  const routeStartedAt =
    activeRoute?.startedAt || activeRoute?.createdAt || clockTick;
  const routeEndedAt =
    activeRoute?.status === 'completed'
      ? activeRoute.completedAt || clockTick
      : clockTick;
  const routeElapsedText = formatElapsedTime(
    (routeEndedAt -
      routeStartedAt -
      (activeRoute?.totalPausedMs || 0)) /
      1000
  );

  const stops = useMemo(() => {
    const unique = dedupeRouteStops(activeRoute?.stops || []);
    // When the employee's plan is unavailable (for example offline before the
    // Workers sheet loads) keep the saved stops instead of showing nothing.
    if (!myPlan) return sortPriorityStops(unique);
    // Only stops tied to one of this employee's assigned deliveries are shown.
    // Matching on address also covers stops saved before a duplicate row was
    // removed from the shared list. A manually added stop has no locationId
    // and still belongs to them.
    return sortPriorityStops(
      unique
        .filter((stop) => {
          if (!stop.locationId) return true;
          if (myLocationIds.ids.has(stop.locationId)) return true;
          const key = normalizeAddressKey(stop.address);
          return !!key && myLocationIds.addresses.has(key);
        })
        .map((stop) => {
          const key = normalizeAddressKey(stop.address);
          const assignedId =
            stop.locationId && key
              ? myLocationIdByAddress.get(key)
              : undefined;
          const locationId = assignedId || stop.locationId;
          const priority =
            !!stop.priority ||
            (!!locationId && priorityLocations.ids.has(locationId)) ||
            (!!key && priorityLocations.addresses.has(key));
          if (locationId === stop.locationId && priority === stop.priority) {
            return stop;
          }
          return {
            ...stop,
            ...(locationId ? { locationId } : {}),
            ...(priority ? { priority: true } : {}),
          };
        })
    );
  }, [
    activeRoute,
    myPlan,
    myLocationIds,
    myLocationIdByAddress,
    priorityLocations,
  ]);
  const deliveredCount = stops.filter((stop) => stop.delivered).length;
  const progress =
    stops.length > 0
      ? Math.round((deliveredCount / stops.length) * 100)
      : 0;
  const nextStopIndex = stops.findIndex((stop) => !stop.delivered);
  const nextStop = nextStopIndex >= 0 ? stops[nextStopIndex] : null;
  const allDelivered = stops.length > 0 && deliveredCount === stops.length;

  const filteredStops = useMemo(() => {
    const text = stopQuery.trim().toLowerCase();
    return stops
      .map((stop, index) => ({ stop, index }))
      .filter(({ stop }) => {
        if (stopFilter === 'pending' && stop.delivered) return false;
        if (stopFilter === 'delivered' && !stop.delivered) return false;
        if (
          text &&
          !`${stop.address} ${stop.note || ''} ${stop.contactName || ''} ${
            stop.phone || ''
          }`
            .toLowerCase()
            .includes(text)
        ) {
          return false;
        }
        return true;
      });
  }, [stops, stopQuery, stopFilter]);

  const pendingCount = stops.length - deliveredCount;
  const myPendingForRoute = useMemo(() => {
    const onRoute = new Set(
      stops.map((stop) => stop.locationId).filter(Boolean) as string[]
    );
    return myAssignedPending.filter((location) => !onRoute.has(location.id));
  }, [myAssignedPending, stops]);

  const myDeliveredToday = useMemo(() => {
    if (!myPlan) return [];
    const today = localDateStamp();
    return myPlan.delivered.filter((location) => {
      if (!location.deliveredAt) return false;
      const delivered = new Date(location.deliveredAt);
      return (
        !Number.isNaN(delivered.getTime()) &&
        localDateStamp(delivered) === today
      );
    });
  }, [myPlan]);

  const myAssignedOrdersPending = myAssignedPending.reduce(
    (sum, location) => sum + (location.orderCount || 0),
    0
  );
  const myOrdersToday =
    myAssignedOrdersPending +
    myDeliveredToday.reduce(
      (sum, location) => sum + (location.orderCount || 0),
      0
    );
  const myLocationsToday =
    myAssignedPending.length + myDeliveredToday.length;
  const myAssignedDistance = myAssignedEstimate?.distanceMeters || 0;
  const myDriveMinutes =
    myAssignedDistance > 0
      ? Math.max(1, Math.round(myAssignedDistance / 8.33 / 60))
      : 0;

  const viewerData = useMemo<ViewerPhoto | null>(() => {
    if (!viewerPhoto) return null;
    const status =
      viewerPhoto.status === 'uploaded'
        ? 'Uploaded to Google Drive'
        : viewerPhoto.error
        ? 'Upload failed · saved on this device'
        : 'Saved on this device · waiting to upload';
    const gps =
      typeof viewerPhoto.lat === 'number' &&
      typeof viewerPhoto.lng === 'number'
        ? `GPS ${viewerPhoto.lat.toFixed(5)}, ${viewerPhoto.lng.toFixed(5)}`
        : 'GPS not recorded';
    return {
      uri: viewerPhoto.localUri,
      title: viewerPhoto.fileName,
      subtitle: viewerPhoto.address,
      meta: [
        `Taken ${new Date(viewerPhoto.createdAt).toLocaleString()}`,
        gps,
        status,
        `Delivery date folder: ${viewerPhoto.folderDate}`,
      ],
      driveUrl: viewerPhoto.driveUrl,
    };
  }, [viewerPhoto]);
  const detailStop = stops.find((stop) => stop.id === detailStopId) || null;
  const menuStop = stops.find((stop) => stop.id === menuStopId) || null;
  const proofStop = stops.find((stop) => stop.id === proofStopId) || null;
  const menuStopIndex = menuStop
    ? stops.findIndex((stop) => stop.id === menuStop.id)
    : -1;

  const mapPath = useMemo(() => {
    // If any pending stop is high priority, draw the path in the actual
    // prioritized order instead of the older optimizer order.
    const hasPriority = stops.some(
      (stop) => stop.priority && !stop.delivered
    );
    if (hasPriority && activeRoute?.start) {
      return straightPath(activeRoute.start, stops, activeRoute.end);
    }
    if (activeRoute?.optimized && activeRoute.path.length > 1) {
      return activeRoute.path;
    }
    if (stops.length === 0) return [];
    // Preview the full drive, including the start and end, even before the
    // order has been optimized.
    if (activeRoute?.start) {
      return straightPath(activeRoute.start, stops, activeRoute.end);
    }
    if (stops.length > 1) {
      return stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
    }
    return [];
  }, [
    activeRoute?.optimized,
    activeRoute?.path,
    activeRoute?.start,
    activeRoute?.end,
    stops,
  ]);

  // ---------------------------------------------------------------- storage
  useEffect(() => {
    let alive = true;
    (async () => {
      const state = await loadRouteState();
      if (!alive) return;
      const name = todayRouteName();
      if (state.routes.length === 0) {
        const route = createRoute(name);
        setRoutes([route]);
        setActiveId(route.id);
      } else {
        const nextActiveId = state.activeId || state.routes[0].id;
        // The daily route always carries today's date as its name.
        setRoutes(
          state.routes.map((route) =>
            route.id === nextActiveId ? { ...route, name } : route
          )
        );
        setActiveId(nextActiveId);
      }
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void saveRouteState({ routes, activeId });
    }, 300);
    return () => clearTimeout(timer);
  }, [hydrated, routes, activeId]);

  useEffect(() => {
    if (!hydrated) return;
    if (routes.length === 0) {
      const route = createRoute(todayRouteName());
      setRoutes([route]);
      setActiveId(route.id);
      return;
    }
    if (!activeId || !routes.some((route) => route.id === activeId)) {
      setActiveId(routes[0].id);
    }
  }, [hydrated, routes, activeId]);

  const reloadDeliveryData = useCallback(async () => {
    if (!sheetId) return;
    const [rows, locations] = await Promise.all([
      fetchSheetRows(sheetId, 'Workers').catch(() => [] as SheetRow[]),
      loadDeliveryLocations(sheetId),
    ]);
    setWorkers(rows);
    setDeliveryLocations(locations);
  }, [sheetId]);

  // Load workers and the shared delivery list once per focus so spots,
  // assignments and the "Assign to" list stay current.
  useFocusEffect(
    useCallback(() => {
      void reloadDeliveryData();
    }, [reloadDeliveryData])
  );

  // Admins/managers clean any duplicate rows left in the shared
  // DeliveryLocations tab, then refresh the deduped list.
  useEffect(() => {
    if (!sheetId || !canAssign) return;
    let alive = true;
    (async () => {
      const removed = await removeDuplicateDeliveryLocations(sheetId);
      if (alive && removed > 0) {
        await reloadDeliveryData();
      }
    })();
    return () => {
      alive = false;
    };
  }, [sheetId, canAssign, reloadDeliveryData]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!sheetId) return;
        const settings = await readCompanySettings(sheetId);
        if (alive) setDeliverySettings(settings);
      })();
      return () => {
        alive = false;
      };
    }, [sheetId])
  );

  // ---------------------------------------------------------------- proof context
  useEffect(() => {
    if (!sheetId) return;
    void setDeliverySyncContext({
      sheetId,
      folderId: user.folderId || user.profile?.folderId || '',
      companyName:
        user.profile?.companyName || user.workerProfile?.companyName || '',
    });
  }, [
    sheetId,
    user.folderId,
    user.profile?.folderId,
    user.profile?.companyName,
    user.workerProfile?.companyName,
  ]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const records = await loadDeliveryPhotos();
      if (!alive) return;
      setPendingProofUploads(
        records.filter(
          (record) => record.status !== 'uploaded' && !record.holdUpload
        ).length
      );
    };
    void refresh();
    const unsubscribe = subscribeDeliveryPhotos(() => void refresh());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // ---------------------------------------------------------------- helpers
  const updateActive = useCallback(
    (patch: Partial<SavedRoute>) => {
      if (!activeId) return;
      setRoutes((prev) =>
        prev.map((route) =>
          route.id === activeId
            ? { ...route, ...patch, updatedAt: Date.now() }
            : route
        )
      );
    },
    [activeId]
  );

  const patchStops = useCallback(
    (updater: (current: RouteStop[]) => RouteStop[]) => {
      if (!activeId) return;
      setRoutes((prev) =>
        prev.map((route) =>
          route.id === activeId
            ? {
                ...route,
                stops: dedupeRouteStops(updater(route.stops)),
                updatedAt: Date.now(),
              }
            : route
        )
      );
    },
    [activeId]
  );

  const invalidateRoute = useCallback(() => {
    if (!activeId) return;
    setRoutes((prev) =>
      prev.map((route) =>
        route.id === activeId
          ? {
              ...route,
              optimized: false,
              path: [],
              distanceText: '',
              durationText: '',
              approximate: false,
              // Leg ETAs and distances belong to the old order; drop them so a
              // newly added or moved stop cannot show a stale time.
              stops: route.stops.map((stop) => ({
                ...stop,
                etaText: undefined,
                legDistanceText: undefined,
              })),
              updatedAt: Date.now(),
            }
          : route
      )
    );
  }, [activeId]);

  const addStopLocation = useCallback(
    (
      location: RouteLocation,
      details: { note?: string; contactName?: string; phone?: string } = {}
    ) => {
      const stop: RouteStop = {
        ...location,
        id: stopId(),
        note: details.note?.trim() || '',
        delivered: false,
        ...(details.contactName?.trim()
          ? { contactName: details.contactName.trim() }
          : {}),
        ...(details.phone?.trim() ? { phone: details.phone.trim() } : {}),
      };
      patchStops((prev) => [...prev, stop]);
      invalidateRoute();
      return stop;
    },
    [patchStops, invalidateRoute]
  );

  const openStopDetails = (location: RouteLocation) => {
    Keyboard.dismiss();
    setPendingStopLocation(location);
    setPendingStopName('');
    setPendingStopPhone('');
    setPendingStopNote('');
    setStopDetailsVisible(true);
  };

  const cancelPendingStop = () => {
    setStopDetailsVisible(false);
    setPendingStopLocation(null);
  };

  const savePendingStop = async () => {
    if (!pendingStopLocation) return;
    if (
      !pendingStopName.trim() ||
      !pendingStopPhone.trim() ||
      !pendingStopNote.trim()
    ) {
      return;
    }
    const location = pendingStopLocation;
    const stop = addStopLocation(location, {
      note: pendingStopNote,
      contactName: pendingStopName,
      phone: pendingStopPhone,
    });
    setStopDetailsVisible(false);
    setPendingStopLocation(null);
    setQuery('');
    setSuggestions([]);

    // Also save the stop to the shared DeliveryLocations sheet so admins and
    // managers see it right away, then link it to the local route stop.
    if (!sheetId) return;
    try {
      const key = normalizeAddressKey(location.address);
      let locationId = deliveryLocations.find(
        (item) =>
          item.status !== 'delivered' &&
          normalizeAddressKey(item.address) === key
      )?.id;

      if (!locationId) {
        const actor = {
          workerId:
            user.workerProfile?.workerId || myRow?.WorkerID || '',
          name: user.name || myRow?.Name || 'Employee',
          isManager,
        };
        const onlyMySpot = myPlan?.worker ? [myPlan.worker] : [];
        const added = await addDeliveryLocations(
          sheetId,
          [
            {
              address: location.address,
              lat: location.lat,
              lng: location.lng,
              contactName: pendingStopName.trim(),
              phone: pendingStopPhone.trim(),
              orderCount: 1,
              note: pendingStopNote.trim(),
            },
          ],
          actor.name,
          actor,
          onlyMySpot
        );
        if (added > 0) {
          await flushPendingMutations(true);
          const locations = await loadDeliveryLocations(sheetId);
          locationId = locations.find(
            (item) =>
              item.status !== 'delivered' &&
              normalizeAddressKey(item.address) === key
          )?.id;
        }
      }

      if (locationId) {
        patchStops((prev) =>
          prev.map((item) =>
            item.id === stop.id ? { ...item, locationId } : item
          )
        );
      }
      await reloadDeliveryData();
    } catch (error: any) {
      Alert.alert(
        'Saved on this device',
        error?.message ||
          'The stop is on your route but the shared delivery list could not be updated yet.'
      );
    }
  };

  const canSavePendingStop =
    !!pendingStopLocation &&
    !!pendingStopName.trim() &&
    !!pendingStopPhone.trim() &&
    !!pendingStopNote.trim();

  /**
   * Pulls this employee's pending spot deliveries into the route. The linked
   * DeliveryLocations id lets a completed stop update the shared list so admins
   * and managers see live progress.
   */
  const makeStopsFromPlan = (
    locations: DeliveryLocationRecord[]
  ): RouteStop[] =>
    locations.map((location) => ({
      id: stopId(),
      address: location.address,
      lat: location.lat,
      lng: location.lng,
      note: location.note || '',
      delivered: false,
      locationId: location.id,
      ...(location.contactName ? { contactName: location.contactName } : {}),
      ...(location.phone ? { phone: location.phone } : {}),
      ...(location.orderCount ? { orderCount: location.orderCount } : {}),
      ...(location.priority ? { priority: true } : {}),
    }));

  const addMyDeliveriesToRoute = () => {
    if (!myPlan) return;
    if (myPendingForRoute.length === 0) {
      Alert.alert(
        'Nothing new',
        'All of your pending deliveries are already on this route.'
      );
      return;
    }
    const newStops = makeStopsFromPlan(myPendingForRoute);
    patchStops((prev) => [...prev, ...newStops]);
    if (myPlan.worker.spot && activeRoute && !activeRoute.start) {
      updateActive({
        start: myPlan.worker.spot,
        end: activeRoute.end || myPlan.worker.spot,
      });
    }
    invalidateRoute();
    Alert.alert(
      'Deliveries added',
      `${newStops.length} deliver${
        newStops.length === 1 ? 'y' : 'ies'
      } around your spot were added. Optimize the route when you are ready.`
    );
  };

  const addStopFromSuggestion = async (suggestion: PlaceSuggestion) => {
    try {
      setSearching(true);
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
      openStopDetails(location);
    } catch (error: any) {
      Alert.alert('Could not add stop', error?.message || 'Try again.');
    } finally {
      setSearching(false);
    }
  };

  // ---------------------------------------------------------------- address search
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
            'Address search is unavailable. Add the stop manually instead.'
        );
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  // ---------------------------------------------------------------- route actions
  const startRoute = () => {
    if (!activeRoute) return;
    if (stops.length === 0 && myPendingForRoute.length === 0) {
      Alert.alert(
        'No deliveries',
        'No assigned deliveries were found and this route has no stops yet.'
      );
      return;
    }
    const defaultStart =
      activeRoute.start || myPlan?.worker.spot || currentLocation || null;
    const defaultEnd = activeRoute.end || defaultStart;
    setStartSetupStart(defaultStart);
    setStartSetupEnd(defaultEnd);
    setStartSetupVisible(true);
  };

  const pauseRoute = () => {
    updateActive({ status: 'draft', pausedAt: Date.now() });
  };

  const finishRoute = (deliveredOverride?: number) => {
    if (!activeRoute) return;
    const delivered =
      typeof deliveredOverride === 'number'
        ? deliveredOverride
        : stops.filter((stop) => stop.delivered).length;
    // Hard guard: a route can only be finished once every stop is delivered.
    const allMarked = stops.length > 0 && delivered >= stops.length;
    if (!allMarked) {
      Alert.alert(
        'Deliveries pending',
        `Mark every delivery as delivered first. ${Math.max(
          0,
          stops.length - delivered
        )} stop${stops.length - delivered === 1 ? '' : 's'} still pending.`
      );
      return;
    }
    updateActive({ status: 'completed', completedAt: Date.now() });
    Alert.alert(
      'Route completed',
      `${delivered} of ${stops.length} stops delivered. Great work!`
    );
  };

  const confirmFinishRoute = () => {
    if (!activeRoute) return;
    if (!allDelivered) {
      Alert.alert(
        'Cannot finish yet',
        `${pendingCount} stop${pendingCount === 1 ? '' : 's'} still pending. Mark every delivery as delivered before finishing the route.`
      );
      return;
    }
    finishRoute();
  };

  const promptFinishIfAllDelivered = (remaining: number) => {
    if (remaining !== 0) return;
    if (!activeRoute || activeRoute.status === 'completed') return;
    Alert.alert('All stops delivered', 'Finish this route now?', [
      { text: 'Later', style: 'cancel' },
      { text: 'Finish route', onPress: () => finishRoute(stops.length) },
    ]);
  };

  const markStop = (stop: RouteStop, delivered: boolean) => {
    patchStops((prev) =>
      prev.map((item) =>
        item.id === stop.id
          ? {
              ...item,
              delivered,
              deliveredAt: delivered ? new Date().toISOString() : undefined,
              ...(delivered ? {} : { deliveryId: undefined }),
            }
          : item
      )
    );

    if (stop.locationId) {
      const worker = {
        workerId: user.workerProfile?.workerId || myRow?.WorkerID || '',
        name: user.name || user.workerProfile?.name || '',
      };
      setDeliveryLocations((prev) =>
        prev.map((location) =>
          location.id === stop.locationId
            ? {
                ...location,
                status: delivered ? 'delivered' : 'pending',
                deliveredAt: delivered ? new Date().toISOString() : undefined,
                workerId: delivered ? worker.workerId : '',
                workerName: delivered ? worker.name : '',
              }
            : location
        )
      );
      void setLocationDelivered(sheetId, stop.locationId, delivered, worker);
    }

    if (delivered) {
      const remaining = stops.filter(
        (item) => !item.delivered && item.id !== stop.id
      ).length;
      promptFinishIfAllDelivered(remaining);
    }
  };

  const completeDeliveredStop = (
    stop: RouteStop,
    details: {
      contactName: string;
      phone: string;
      orderCount?: number;
      lat?: number;
      lng?: number;
      gps?: string;
    }
  ) => {
    const now = new Date();
    const deliveryId = stop.deliveryId || makeDeliveryId();
    const orderCount = Math.max(0, Math.round(details.orderCount || 0));

    patchStops((prev) =>
      prev.map((item) =>
        item.id === stop.id
          ? {
              ...item,
              contactName: details.contactName,
              phone: details.phone,
              orderCount,
              deliveryId,
              delivered: true,
              deliveredAt: now.toISOString(),
            }
          : item
      )
    );
    setProofStopId(null);

    if (stop.locationId) {
      const worker = {
        workerId: user.workerProfile?.workerId || myRow?.WorkerID || '',
        name: user.name || user.workerProfile?.name || '',
      };
      setDeliveryLocations((prev) =>
        prev.map((location) =>
          location.id === stop.locationId
            ? {
                ...location,
                status: 'delivered',
                deliveredAt: now.toISOString(),
                workerId: worker.workerId,
                workerName: worker.name,
              }
            : location
        )
      );
      void setLocationDelivered(sheetId, stop.locationId, true, worker);
    }

    void (async () => {
      const records = await loadDeliveryPhotos();
      const stopPhotos = records.filter(
        (record) => record.stopId === stop.id
      );
      const date = localDateStamp(now);
      void logDelivery(sheetId, {
        deliveryId,
        date,
        time: localTimeStamp(now),
        routeId: activeRoute?.id || '',
        routeName: activeRoute?.name || '',
        stopId: stop.id,
        name: details.contactName || stop.contactName || '',
        phone: details.phone || stop.phone || '',
        address: stop.address,
        orderCount,
        status: 'Delivered',
        photoCount: stopPhotos.length,
        photoFolder: deliveryPhotoFolder(date),
        gps:
          details.gps ||
          (typeof details.lat === 'number' && typeof details.lng === 'number'
            ? `${details.lat.toFixed(5)}, ${details.lng.toFixed(5)}`
            : ''),
        workerName: user.name || user.workerProfile?.name || '',
        workerId: user.workerProfile?.workerId || myRow?.WorkerID || '',
        notes: stop.note || '',
        createdAt: now.toISOString(),
      });
    })();

    const remaining = stops.filter(
      (item) => !item.delivered && item.id !== stop.id
    ).length;
    promptFinishIfAllDelivered(remaining);
  };

  const toggleDelivered = (stop: RouteStop) => {
    if (!stop.delivered) {
      openProofForStop(stop);
      return;
    }
    Alert.alert(
      'Uncheck delivery?',
      `${stop.address} will be marked as not delivered.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Uncheck',
          style: 'destructive',
          onPress: () => markStop(stop, false),
        },
      ]
    );
  };

  // ---------------------------------------------------------------- stop actions
  const moveStop = (stop: RouteStop, delta: number) => {
    patchStops((prev) => {
      const index = prev.findIndex((item) => item.id === stop.id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      next.splice(target, 0, picked);
      return next.map((item) => ({
        ...item,
        etaText: undefined,
        legDistanceText: undefined,
      }));
    });
    invalidateRoute();
  };

  const setStopPriority = (stop: RouteStop, priority: boolean) => {
    patchStops((prev) =>
      prev.map((item) =>
        item.id === stop.id ? { ...item, priority } : item
      )
    );
  };

  const setStopFirst = (stop: RouteStop) => {
    patchStops((prev) => {
      const picked = prev.find((item) => item.id === stop.id);
      if (!picked) return prev;
      return [
        { ...picked, etaText: undefined, legDistanceText: undefined },
        ...prev
          .filter((item) => item.id !== stop.id)
          .map((item) => ({
            ...item,
            etaText: undefined,
            legDistanceText: undefined,
          })),
      ];
    });
    invalidateRoute();
  };

  const deleteStop = (stop: RouteStop) => {
    Alert.alert('Delete stop?', `Remove ${stop.address} from the route?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          patchStops((prev) => prev.filter((item) => item.id !== stop.id));
          void removeDeliveryPhotosForStop(stop.id);
          invalidateRoute();
          setDetailStopId(null);
        },
      },
    ]);
  };

  const clearRoute = () => {
    Alert.alert('Clear route?', 'Remove all stops from this route?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          stops.forEach((stop) => {
            void removeDeliveryPhotosForStop(stop.id);
          });
          updateActive({
            stops: [],
            optimized: false,
            path: [],
            distanceText: '',
            durationText: '',
            approximate: false,
            start: null,
            end: null,
            status: 'draft',
            startedAt: undefined,
            completedAt: undefined,
          });
          setStopQuery('');
          setStopFilter('all');
        },
      },
    ]);
  };

  // ---------------------------------------------------------------- stop details / proof
  const openDetails = (stop: RouteStop) => {
    setDetailStopId(stop.id);
    setDetailNoteEditing(false);
    setDetailNoteDraft(stop.note || '');
    setContactEditing(false);
    setContactNameDraft(stop.contactName || '');
    setPhoneDraft(stop.phone || '');
    setOrderCountDraft(
      typeof stop.orderCount === 'number' && stop.orderCount > 0
        ? `${stop.orderCount}`
        : '1'
    );
  };

  const openStopNote = (stop: RouteStop) => {
    openDetails(stop);
    setDetailNoteEditing(true);
  };

  const saveDetailNote = () => {
    if (!detailStopId) return;
    patchStops((prev) =>
      prev.map((item) =>
        item.id === detailStopId
          ? { ...item, note: detailNoteDraft.trim() }
          : item
      )
    );
    setDetailNoteEditing(false);
  };

  const saveContact = () => {
    if (!detailStopId) return;
    const orderCount = Math.max(
      0,
      Math.round(parseFloat(orderCountDraft.replace(/[^\d.]/g, '')) || 0)
    );
    patchStops((prev) =>
      prev.map((item) =>
        item.id === detailStopId
          ? {
              ...item,
              contactName: contactNameDraft.trim(),
              phone: phoneDraft.trim(),
              orderCount,
            }
          : item
      )
    );
    setContactEditing(false);
  };

  const adjustDetailOrders = (delta: number) => {
    const current = parseInt(orderCountDraft || '0', 10) || 0;
    setOrderCountDraft(`${Math.max(0, current + delta)}`);
  };

  const openProofForStop = (stop: RouteStop) => {
    setDetailStopId(null);
    // Pull the latest customer name/phone from the shared delivery location so
    // the Mark delivery modal is pre-filled even for older saved stops.
    const key = normalizeAddressKey(stop.address);
    const location =
      deliveryLocations.find((item) => item.id === stop.locationId) ||
      deliveryLocations.find(
        (item) =>
          normalizeAddressKey(item.address) === key &&
          item.status !== 'delivered'
      ) ||
      deliveryLocations.find(
        (item) => normalizeAddressKey(item.address) === key
      );
    if (location) {
      const contactName = location.contactName || stop.contactName;
      const phone = location.phone || stop.phone;
      const hasChanges =
        contactName !== stop.contactName ||
        phone !== stop.phone ||
        (!!location.note && location.note !== stop.note) ||
        (!!location.orderCount && location.orderCount !== stop.orderCount) ||
        (!stop.locationId && !!location.id);
      if (hasChanges) {
        patchStops((prev) =>
          prev.map((item) =>
            item.id === stop.id
              ? {
                  ...item,
                  ...(contactName ? { contactName } : {}),
                  ...(phone ? { phone } : {}),
                  ...(location.note ? { note: location.note } : {}),
                  ...(location.orderCount
                    ? { orderCount: location.orderCount }
                    : {}),
                  ...(location.priority ? { priority: true } : {}),
                  ...(stop.locationId || !location.id
                    ? {}
                    : { locationId: location.id }),
                }
              : item
          )
        );
      }
    }
    setProofStopId(stop.id);
  };

  const runPhotoSync = async (showError = false) => {
    setDetailPhotoSyncing(true);
    try {
      const result = await syncDeliveryPhotos();
      if (showError && result.error) {
        Alert.alert(
          'Saved on this device',
          `${result.error}\n\nThe photo stays safe on this phone and will upload automatically when the connection is back.`
        );
      }
      return result;
    } finally {
      setDetailPhotoSyncing(false);
    }
  };

  const addDetailProof = async (source: ProofPhotoSource) => {
    if (!detailStop || !activeRoute) return;
    const maxPhotos = Math.max(1, deliverySettings.maxProofPhotos || 2);
    const remaining = maxPhotos - detailPhotos.length;
    if (remaining <= 0) {
      Alert.alert(
        'Limit reached',
        `You can attach up to ${maxPhotos} photos per stop.`
      );
      return;
    }
    setDetailPhotoBusy(true);
    try {
      const checkInPromise = getProofCheckIn();
      const assets = await pickProofImages(source, remaining);
      if (assets.length === 0) return;
      const checkIn = await checkInPromise;
      await addDeliveryPhotos({
        assets,
        routeId: activeRoute.id,
        stopId: detailStop.id,
        personName: contactNameDraft || detailStop.contactName,
        address: detailStop.address,
        phone: phoneDraft || detailStop.phone,
        compress: deliverySettings.compressProofPhotos,
        maxPhotos,
        ...(checkIn ? { lat: checkIn.lat, lng: checkIn.lng } : {}),
      });
      // A stop that is already delivered has no Save step left, so release its
      // new proof photo for upload immediately.
      if (detailStop.delivered) {
        await releaseDeliveryPhotosForStop(detailStop.id);
        await runPhotoSync();
      }
    } catch (error: any) {
      Alert.alert(
        'Could not open camera or gallery',
        error?.message ||
          'Check camera and photo permissions, then try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ]
      );
    } finally {
      setDetailPhotoBusy(false);
    }
  };

  const chooseDetailProofSource = () => {
    const maxPhotos = Math.max(1, deliverySettings.maxProofPhotos || 2);
    if (detailPhotos.length >= maxPhotos) {
      Alert.alert(
        'Limit reached',
        `You can attach up to ${maxPhotos} photos per stop.`
      );
      return;
    }
    Alert.alert(
      'Add delivery proof',
      'Take a new photo or choose one from the gallery.',
      [
        { text: 'Camera', onPress: () => void addDetailProof('camera') },
        { text: 'Gallery', onPress: () => void addDetailProof('library') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const confirmRemoveDetailProof = (id: string) => {
    Alert.alert('Remove photo?', 'This proof photo will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void removeDeliveryPhoto(id),
      },
    ]);
  };

  // ---------------------------------------------------------------- current location / manual add
  const handleAddCurrentLocation = async () => {
    if (!activeRoute) return;
    setLocating(true);
    try {
      const location = await getCurrentLocation();
      setCurrentLocation(location);
      openStopDetails(location);
    } catch (error: any) {
      Alert.alert(
        'Location unavailable',
        error?.message || 'Allow location access and try again.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Settings',
            onPress: () => {
              void openLocationSettings();
            },
          },
        ]
      );
    } finally {
      setLocating(false);
    }
  };

  const openManualAdd = () => {
    setManualText('');
    setManualError('');
    setManualModalVisible(true);
  };

  const submitManualStop = async () => {
    const text = manualText.trim();
    if (!text) {
      setManualError('Enter an address or coordinates.');
      return;
    }
    setManualBusy(true);
    setManualError('');
    try {
      const location = await geocodeAddress(text);
      setManualModalVisible(false);
      setManualText('');
      openStopDetails(location);
    } catch (error: any) {
      setManualError(
        error?.message ||
          'Could not find that place. You can also paste coordinates as “lat,lng”.'
      );
    } finally {
      setManualBusy(false);
    }
  };

  // ---------------------------------------------------------------- optimize
  const resolveStartAndEnd = async (): Promise<{
    start: RouteLocation;
    end: RouteLocation;
  } | null> => {
    if (!activeRoute) return null;
    let start = activeRoute.start;
    let end = activeRoute.end;

    // If a start is set but no end, a round trip needs no extra permission.
    if (start && !end) {
      end = start;
      updateActive({ end });
      return { start, end };
    }

    if (!start) {
      const enabled = await isLocationEnabled();
      if (!enabled) {
        Alert.alert(
          'Turn on location',
          'Location services are off. Enable them to use your current position, or set a start location manually.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open settings',
              onPress: () => {
                void openLocationSettings();
              },
            },
            { text: 'Set manually', onPress: () => setRouteModalVisible(true) },
          ]
        );
        return null;
      }

      const granted = await requestLocationAccess();
      if (!granted) {
        Alert.alert(
          'Location permission needed',
          'Allow location access to start from where you are, or set a start location manually.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Set manually', onPress: () => setRouteModalVisible(true) },
          ]
        );
        return null;
      }

      try {
        const current = await getCurrentLocation();
        setCurrentLocation(current);
        start = current;
        // A round trip is the most useful default for field work.
        end = end || start;
        updateActive({ start, end });
      } catch (error: any) {
        Alert.alert(
          'Could not get your location',
          error?.message || 'Set a start location manually and try again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Set manually', onPress: () => setRouteModalVisible(true) },
          ]
        );
        return null;
      }
    }

    return { start: start!, end: end! };
  };

  const runOptimization = async (
    start: RouteLocation,
    end: RouteLocation,
    currentStops: RouteStop[]
  ): Promise<boolean> => {
    if (currentStops.length === 0) {
      Alert.alert('No stops', 'Add at least one address first.');
      return false;
    }
    setRouting(true);
    setRouteModalVisible(false);
    try {
      const result = await optimizeRoute({
        start,
        end,
        stops: currentStops,
      });

      let cumulativeSeconds = 0;
      const ordered = result.stops.map((stop, index) => {
        const leg = result.legs[index];
        cumulativeSeconds += leg?.durationSeconds || 0;
        return {
          ...stop,
          etaText:
            cumulativeSeconds > 0
              ? formatDuration(cumulativeSeconds)
              : undefined,
          legDistanceText: leg?.distanceText,
        };
      });

      updateActive({
        stops: sortPriorityStops(dedupeRouteStops(ordered)),
        start,
        end,
        optimized: true,
        path: result.path,
        distanceText: result.distanceText || '',
        durationText: result.durationText || '',
        approximate: result.approximate,
      });

      if (result.approximate) {
        const reason = result.errorMessage
          ? `\n\n${describeGoogleMapsError({ message: result.errorMessage })}`
          : '';
        Alert.alert(
          'Approximate route',
          `Stops were sorted by distance because neither Google Routes nor the OpenStreetMap road-routing service could be reached. Check your connection and try again.${reason}`
        );
      }
      return true;
    } catch (error: any) {
      Alert.alert('Optimization failed', error?.message || 'Try again.');
      return false;
    } finally {
      setRouting(false);
    }
  };

  const confirmStartRoute = async () => {
    if (!activeRoute) return;
    if (!startSetupStart) {
      Alert.alert(
        'Start location needed',
        'Choose where you are starting the route.'
      );
      return;
    }
    const end = startSetupEnd || startSetupStart;
    const merged = sortPriorityStops(
      dedupeRouteStops([...stops, ...makeStopsFromPlan(myPendingForRoute)])
    );
    if (merged.length === 0) {
      Alert.alert(
        'No deliveries',
        'There are no assigned deliveries or route stops to start with.'
      );
      return;
    }

    setStartSetupBusy(true);
    try {
      // Add the time spent paused so the running timer excludes breaks.
      const pauseDelta = activeRoute.pausedAt
        ? Math.max(0, Date.now() - activeRoute.pausedAt)
        : 0;
      const totalPausedMs = (activeRoute.totalPausedMs || 0) + pauseDelta;
      updateActive({
        stops: merged,
        start: startSetupStart,
        end,
        optimized: false,
        path: [],
        distanceText: '',
        durationText: '',
        approximate: false,
      });
      const optimized = await runOptimization(startSetupStart, end, merged);
      if (!optimized) return;
      updateActive({
        status: 'active',
        startedAt: activeRoute.startedAt || Date.now(),
        completedAt: undefined,
        pausedAt: undefined,
        totalPausedMs,
      });
      setStartSetupVisible(false);
    } finally {
      setStartSetupBusy(false);
    }
  };

  const handleOptimize = async () => {
    if (!activeRoute || stops.length === 0) {
      Alert.alert('No stops', 'Search and add addresses first.');
      return;
    }
    const resolved = await resolveStartAndEnd();
    if (!resolved) return;
    await runOptimization(resolved.start, resolved.end, stops);
  };

  const reorderApproximate = () => {
    if (!activeRoute?.start) {
      Alert.alert('Start required', 'Optimize the route first to set a start.');
      return;
    }
    const ordered = nearestNeighbourOrder(activeRoute.start, stops);
    updateActive({
      stops: sortPriorityStops(
        dedupeRouteStops(
          ordered.map((stop) => ({
            ...stop,
            etaText: undefined,
            legDistanceText: undefined,
          }))
        )
      ),
      path: straightPath(activeRoute.start, ordered, activeRoute.end),
      optimized: true,
      approximate: true,
      distanceText: '',
      durationText: '',
    });
  };

  const setStartLocation = (location: RouteLocation) => {
    updateActive({ start: location });
    invalidateRoute();
  };

  const setEndLocation = (location: RouteLocation) => {
    updateActive({ end: location });
    invalidateRoute();
  };

  const clearStartLocation = () => {
    updateActive({ start: null });
    invalidateRoute();
  };

  const clearEndLocation = () => {
    updateActive({ end: null });
    invalidateRoute();
  };

  const useLastStopAsEnd = () => {
    const last = stops[stops.length - 1];
    if (!last) {
      Alert.alert('No stops', 'Add a stop first.');
      return;
    }
    setEndLocation(last);
  };

  // ---------------------------------------------------------------- sharing / navigation
  const shareRoute = async () => {
    if (!activeRoute) return;
    try {
      await Share.share({
        title: activeRoute.name,
        message: routeShareText(activeRoute),
      });
    } catch {
      // User dismissed the share sheet.
    }
  };

  const copyRoute = async () => {
    if (!activeRoute) return;
    await Clipboard.setStringAsync(routeShareText(activeRoute));
    Alert.alert('Copied', 'The route summary is on your clipboard.');
  };

  const navigateToStop = async (stop: RouteStop) => {
    try {
      await openDirectionsTo(stop, activeRoute?.start || null);
    } catch {
      Alert.alert(
        'Could not open Google Maps',
        'Install Google Maps or check your connection and try again.'
      );
    }
  };

  const callStopContact = async (stop: RouteStop) => {
    const cleaned = (stop.phone || '').replace(/[^\d+]/g, '');
    if (!cleaned) {
      Alert.alert(
        'No phone number',
        'Add the customer’s phone number in the contact section first.'
      );
      return;
    }
    try {
      await Linking.openURL(`tel:${cleaned}`);
    } catch {
      Alert.alert('Could not open the dialer', 'Try calling manually.');
    }
  };

  const openWholeRoute = async () => {
    if (!activeRoute || stops.length === 0) return;
    try {
      await openFullRouteInGoogleMaps({
        start: activeRoute.start,
        end: activeRoute.end,
        stops,
      });
    } catch (error: any) {
      Alert.alert('Could not open route', error?.message || 'Try again.');
    }
  };

  // ---------------------------------------------------------------- render
  const statusActions = () => {
    if (!activeRoute) return null;
    if (activeRoute.status === 'completed') {
      return (
        <View>
          <View style={[styles.startStatusButton, styles.completedStatusButton]}>
            <Text style={styles.startStatusTitle}>Route completed</Text>
            <Text style={styles.startStatusMeta}>
              {routeElapsedText} · {deliveredCount} of {stops.length} delivered ·{' '}
              {progress}%
            </Text>
            <View style={styles.startStatusBaselineTrack}>
              <View
                style={[
                  styles.startStatusBaselineFill,
                  { width: `${progress}%` },
                ]}
              />
            </View>
          </View>
          <View style={[styles.routeCardActions, { marginTop: 10 }]}>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={() =>
                updateActive({
                  status: 'draft',
                  completedAt: undefined,
                  startedAt: undefined,
                  pausedAt: undefined,
                  totalPausedMs: 0,
                })
              }
            >
              <MaterialCommunityIcons
                name="restart"
                size={16}
                color={theme.accent}
              />
              <Text
                style={[styles.secondaryActionText, { color: theme.accent }]}
              >
                Reopen route
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (activeRoute.status === 'active') {
      return (
        <View>
          <View style={[styles.startStatusButton, styles.runningStatusButton]}>
            <Text style={styles.startStatusTitle}>Route running</Text>
            <Text style={styles.startStatusMeta}>
              {routeElapsedText} · {deliveredCount} of {stops.length} delivered ·{' '}
              {progress}%
            </Text>
            <View style={styles.startStatusBaselineTrack}>
              <View
                style={[
                  styles.startStatusBaselineFill,
                  { width: `${progress}%` },
                ]}
              />
            </View>
          </View>
          <View style={[styles.routeCardActions, { marginTop: 10 }]}>
            <TouchableOpacity
              style={[
                styles.primaryAction,
                { backgroundColor: theme.accent },
                !allDelivered && styles.disabled,
              ]}
              onPress={confirmFinishRoute}
              disabled={!allDelivered}
            >
              <MaterialCommunityIcons
                name="flag-checkered"
                size={17}
                color="#fff"
              />
              <Text style={styles.primaryActionText}>Finish route</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={pauseRoute}
            >
              <MaterialCommunityIcons
                name="pause"
                size={16}
                color={theme.accent}
              />
              <Text
                style={[styles.secondaryActionText, { color: theme.accent }]}
              >
                Pause
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[
          styles.startStatusButton,
          stops.length === 0 &&
            myPendingForRoute.length === 0 &&
            styles.disabled,
        ]}
        onPress={startRoute}
        disabled={stops.length === 0 && myPendingForRoute.length === 0}
        activeOpacity={0.85}
        accessibilityLabel="Start route"
      >
        <Text style={styles.startStatusTitle}>
          {activeRoute.pausedAt ? 'Resume route' : 'Start route'}
        </Text>
        <Text style={styles.startStatusMeta}>
          {deliveredCount} of {stops.length} delivered · {progress}%
        </Text>
        <View style={styles.startStatusBaselineTrack}>
          <View
            style={[
              styles.startStatusBaselineFill,
              { width: `${progress}%` },
            ]}
          />
        </View>
      </TouchableOpacity>
    );
  };

  // Admins do not run a personal route: their Route tab is the delivery
  // control room for the whole team.
  if (isAdmin) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.headerText }]}>
              Delivery control
            </Text>
            <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
              Add every delivery for today, optimize and track each order
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => router.push('/delivery-proofs')}
              accessibilityLabel="Delivery proof gallery"
            >
              <MaterialCommunityIcons
                name="image-multiple-outline"
                size={20}
                color={theme.headerText}
              />
              {pendingProofUploads > 0 && (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>
                    {pendingProofUploads}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => router.push('/delivery-team')}
              accessibilityLabel="Team delivery tracking"
            >
              <MaterialCommunityIcons
                name="account-search-outline"
                size={20}
                color={theme.headerText}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => router.push('/delivery-settings')}
              accessibilityLabel="Delivery settings"
            >
              <MaterialCommunityIcons
                name="cog-outline"
                size={20}
                color={theme.headerText}
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <DeliveryControlPanel
            sheetId={sheetId}
            locations={deliveryLocations}
            workers={workerSpots}
            distribution={distribution}
            theme={theme}
            actor={{
              workerId: user.workerProfile?.workerId || myRow?.WorkerID || '',
              name: user.name || myRow?.Name || 'Admin',
              isManager: false,
            }}
            canOptimize
            onRefresh={reloadDeliveryData}
          />

          <TouchableOpacity
            style={[styles.adminToolCard, { borderColor: theme.accentBorder }]}
            onPress={() => router.push('/delivery-team')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.adminToolIcon, { backgroundColor: theme.accentSoft }]}
            >
              <MaterialCommunityIcons
                name="chart-timeline-variant"
                size={19}
                color={theme.accent}
              />
            </View>
            <View style={styles.adminToolInfo}>
              <Text style={styles.adminToolTitle}>Track every order</Text>
              <Text style={styles.adminToolSubtitle}>
                See every employee’s current stop, delivered orders and ETA.
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color="#94A3B8"
            />
          </TouchableOpacity>

          <View style={styles.adminNote}>
            <MaterialCommunityIcons
              name="shield-check-outline"
              size={14}
              color="#64748B"
            />
            <Text style={styles.adminNoteText}>
              Managers can assign, remove or edit deliveries. Every manager
              change appears in the admin’s Alerts tab.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.headerText }]}>Route</Text>
          <Text style={[styles.subtitle, { color: theme.headerMuted }]}>
            Plan stops, optimize the drive and track deliveries
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.push('/delivery-proofs')}
            accessibilityLabel="Delivery proof gallery"
          >
            <MaterialCommunityIcons
              name="image-multiple-outline"
              size={20}
              color={theme.headerText}
            />
            {pendingProofUploads > 0 && (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>
                  {pendingProofUploads}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => router.push('/delivery-locations')}
            accessibilityLabel="Delivery spots and locations"
          >
            <MaterialCommunityIcons
              name="map-marker-multiple-outline"
              size={20}
              color={theme.headerText}
            />
            {(canAssign
              ? distribution.pendingTotal
              : myPlan?.pending.length || 0) > 0 && (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>
                  {canAssign
                    ? distribution.pendingTotal
                    : myPlan?.pending.length || 0}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {(isAdmin || isManager) && (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => router.push('/delivery-settings')}
              accessibilityLabel="Delivery settings"
            >
              <MaterialCommunityIcons
                name="cog-outline"
                size={20}
                color={theme.headerText}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.headerButton}
            onPress={shareRoute}
            accessibilityLabel="Share route"
          >
            <MaterialCommunityIcons
              name="share-variant-outline"
              size={21}
              color={theme.headerText}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Active route summary */}
        {activeRoute && (
          <View style={[styles.routeCard, { borderColor: theme.accentBorder }]}>
            {statusActions()}

            {/* Next stop & delivery actions sit directly under Finish route so
                a driver can navigate without scrolling the whole screen. */}
            {activeRoute.status === 'active' && nextStop && (
              <View style={styles.nextInline}>
                <View style={styles.nextHeader} pointerEvents="none">
                  <View
                    style={[styles.nextBadge, { backgroundColor: theme.accent }]}
                  >
                    <MaterialCommunityIcons
                      name="navigation-variant"
                      size={11}
                      color="#fff"
                    />
                    <Text style={styles.nextBadgeText}>NEXT STOP</Text>
                  </View>
                  {nextStop.priority && (
                    <View
                      style={[styles.nextBadge, styles.priorityNextBadge]}
                    >
                      <MaterialCommunityIcons
                        name="star"
                        size={10}
                        color="#fff"
                      />
                      <Text style={styles.nextBadgeText}>PRIORITY</Text>
                    </View>
                  )}
                  <Text style={styles.nextCounter}>
                    {nextStopIndex + 1} of {stops.length}
                  </Text>
                  {!!nextStop.etaText && (
                    <Text style={[styles.nextEta, { color: theme.accentDark }]}>
                      ETA {nextStop.etaText}
                    </Text>
                  )}
                </View>
                <Text style={styles.nextAddress}>{nextStop.address}</Text>
                {!!(nextStop.contactName || nextStop.phone) && (
                  <View style={styles.nextContactRow}>
                    <MaterialCommunityIcons
                      name="account-outline"
                      size={12}
                      color="#64748B"
                    />
                    <Text style={styles.nextContactText} numberOfLines={1}>
                      {[nextStop.contactName, nextStop.phone]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                )}
                {!!nextStop.note && (
                  <Text style={styles.nextNote}>{nextStop.note}</Text>
                )}
                <View style={styles.nextActions}>
                  <TouchableOpacity
                    style={[styles.nextNav, { backgroundColor: theme.accent }]}
                    onPress={() => navigateToStop(nextStop)}
                  >
                    <MaterialCommunityIcons
                      name="navigation"
                      size={17}
                      color="#fff"
                    />
                    <Text style={styles.nextNavText}>Navigate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.nextDone}
                    onPress={() => openProofForStop(nextStop)}
                  >
                    <MaterialCommunityIcons
                      name="package-variant-closed-check"
                      size={17}
                      color="#15803D"
                    />
                    <Text style={styles.nextDoneText}>Mark delivery</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Shared delivery control for admins/managers. */}
        {canAssign && (
          <DeliveryControlPanel
            sheetId={sheetId}
            locations={deliveryLocations}
            workers={workerSpots}
            distribution={distribution}
            theme={theme}
            actor={{
              workerId: user.workerProfile?.workerId || myRow?.WorkerID || '',
              name: user.name || myRow?.Name || 'Manager',
              isManager,
            }}
            canOptimize={isAdmin}
            onRefresh={reloadDeliveryData}
          />
        )}

        {/* The employee's own spot and automatically assigned deliveries. */}
        {!canAssign && !myPlan?.worker.spot && (
          <View style={[styles.opsCard, { borderColor: theme.accentBorder }]}>
            <View style={styles.opsTop}>
              <View
                style={[styles.opsIcon, { backgroundColor: theme.accentSoft }]}
              >
                <MaterialCommunityIcons
                  name="map-marker-off-outline"
                  size={20}
                  color={theme.accent}
                />
              </View>
              <View style={styles.opsInfo}>
                <Text style={styles.opsTitle}>Delivery spot not set</Text>
                <Text style={styles.opsSubtitle}>
                  Ask your manager to set your spot. Deliveries around it will be
                  assigned to you automatically.
                </Text>
              </View>
            </View>
          </View>
        )}
        {myPlan?.worker.spot && (
          <View
            style={[styles.mySpotRouteCard, { borderColor: theme.accentBorder }]}
          >
            <View style={styles.mySpotRouteTop}>
              <View
                style={[
                  styles.mySpotRouteIcon,
                  { backgroundColor: theme.accentSoft },
                ]}
              >
                <MaterialCommunityIcons
                  name="map-marker-radius"
                  size={20}
                  color={theme.accent}
                />
              </View>
              <View style={styles.mySpotRouteInfo}>
                <Text style={styles.mySpotRouteLabel}>MY DELIVERY SPOT</Text>
                <Text style={styles.mySpotRouteAddress} numberOfLines={2}>
                  {myPlan.worker.spot.address}
                </Text>
              </View>
              <View
                style={[
                  styles.mySpotRoutePill,
                  { backgroundColor: theme.accentSoft },
                ]}
              >
                <Text
                  style={[
                    styles.mySpotRoutePillText,
                    { color: theme.accentDark },
                  ]}
                >
                  {myAssignedPending.length} left
                </Text>
              </View>
            </View>

            <View style={styles.mySpotRouteStats}>
              <View style={styles.mySpotRouteStat}>
                <Text style={styles.mySpotRouteValue}>
                  {formatDistance(myAssignedDistance)}
                </Text>
                <Text style={styles.mySpotRouteStatLabel}>Distance</Text>
              </View>
              <View style={styles.mySpotRouteStat}>
                <Text style={styles.mySpotRouteValue}>
                  {myDriveMinutes > 0 ? `${myDriveMinutes} min` : '—'}
                </Text>
                <Text style={styles.mySpotRouteStatLabel}>Drive</Text>
              </View>
              <View style={styles.mySpotRouteStat}>
                <Text style={styles.mySpotRouteValue}>{myOrdersToday}</Text>
                <Text style={styles.mySpotRouteStatLabel}>Orders</Text>
              </View>
              <View style={styles.mySpotRouteStat}>
                <Text style={styles.mySpotRouteValue}>{myLocationsToday}</Text>
                <Text style={styles.mySpotRouteStatLabel}>Locations</Text>
              </View>
              <View style={styles.mySpotRouteStat}>
                <Text style={styles.mySpotRouteValue}>
                  {formatDeliveryEta(myAssignedEstimate?.minutes || 0)}
                </Text>
                <Text style={styles.mySpotRouteStatLabel}>Est. time</Text>
              </View>
              <View style={styles.mySpotRouteStat}>
                <Text style={styles.mySpotRouteValue}>
                  {myAssignedOrdersPending}
                </Text>
                <Text style={styles.mySpotRouteStatLabel}>Pending orders</Text>
              </View>
            </View>

            {!!myAssignedPending[0] && (
              <TouchableOpacity
                style={styles.mySpotCurrent}
                onPress={() =>
                  void openDirectionsTo(myAssignedPending[0], myPlan.worker.spot)
                }
              >
                <MaterialCommunityIcons
                  name="navigation-variant-outline"
                  size={16}
                  color={theme.accentDark}
                />
                <View style={styles.mySpotCurrentInfo}>
                  <Text style={styles.mySpotCurrentLabel}>Next delivery</Text>
                  <Text
                    style={styles.mySpotCurrentAddress}
                    numberOfLines={2}
                  >
                    {myAssignedPending[0].address}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={17}
                  color="#94A3B8"
                />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.mySpotAdd,
                { backgroundColor: theme.accent },
                myPendingForRoute.length === 0 && styles.disabled,
              ]}
              onPress={addMyDeliveriesToRoute}
              disabled={myPendingForRoute.length === 0}
            >
              <MaterialCommunityIcons
                name="playlist-plus"
                size={17}
                color="#fff"
              />
              <Text style={styles.mySpotAddText}>
                {myPendingForRoute.length > 0
                  ? `Add ${myPendingForRoute.length} deliver${
                      myPendingForRoute.length === 1 ? 'y' : 'ies'
                    } to this route`
                  : 'All deliveries are already on this route'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!canAssign && (
          <TouchableOpacity
            style={[styles.employeeProofCard, { borderColor: theme.accentBorder }]}
            onPress={() => router.push('/delivery-proofs')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.employeeProofIcon, { backgroundColor: theme.accentSoft }]}
            >
              <MaterialCommunityIcons
                name="image-multiple-outline"
                size={19}
                color={theme.accent}
              />
            </View>
            <View style={styles.employeeProofInfo}>
              <Text style={styles.employeeProofTitle}>Today’s delivery proofs</Text>
              <Text style={styles.employeeProofSubtitle}>
                View every proof photo captured for today
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color="#94A3B8"
            />
          </TouchableOpacity>
        )}

        {activeRoute?.status === 'active' && allDelivered && (
          <View style={styles.allDoneCard}>
            <MaterialCommunityIcons
              name="party-popper"
              size={20}
              color="#15803D"
            />
            <Text style={styles.allDoneText}>
              All stops delivered. Finish the route to save the completed day.
            </Text>
          </View>
        )}

        {pendingProofUploads > 0 && (
          <TouchableOpacity
            style={styles.uploadBanner}
            onPress={() => void runPhotoSync(true)}
            disabled={detailPhotoSyncing}
            activeOpacity={0.85}
          >
            <View style={styles.uploadBannerIcon}>
              <MaterialCommunityIcons
                name="cloud-upload-outline"
                size={18}
                color="#B45309"
              />
            </View>
            <View style={styles.uploadBannerTextWrap}>
              <Text style={styles.uploadBannerTitle}>
                {pendingProofUploads} proof photo
                {pendingProofUploads === 1 ? '' : 's'} waiting to upload
              </Text>
              <Text style={styles.uploadBannerSubtitle}>
                Saved safely on this phone · tap to upload now
              </Text>
            </View>
            {detailPhotoSyncing ? (
              <ActivityIndicator size="small" color="#B45309" />
            ) : (
              <Text style={styles.uploadBannerAction}>Sync</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Address search */}
        <View style={styles.searchCard}>
          <Text style={styles.label}>Add a stop</Text>
          <View style={styles.searchRow}>
            <MaterialCommunityIcons name="magnify" size={18} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search an address, shop or landmark"
              placeholderTextColor="#94A3B8"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={theme.accent} />}
          </View>
          {!!searchError && (
            <View style={styles.searchErrorRow}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={13}
                color="#B45309"
              />
              <Text style={styles.errorText}>{searchError}</Text>
            </View>
          )}
          {suggestions.length > 0 && (
            <View style={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion.placeId}
                  style={styles.suggestion}
                  onPress={() => addStopFromSuggestion(suggestion)}
                >
                  <MaterialCommunityIcons
                    name="map-marker-outline"
                    size={16}
                    color="#64748B"
                  />
                  <View style={styles.suggestionText}>
                    <Text style={styles.suggestionMain} numberOfLines={1}>
                      {suggestion.mainText}
                    </Text>
                    {!!suggestion.secondaryText && (
                      <Text
                        style={styles.suggestionSecondary}
                        numberOfLines={1}
                      >
                        {suggestion.secondaryText}
                      </Text>
                    )}
                  </View>
                  <MaterialCommunityIcons
                    name="plus-circle-outline"
                    size={19}
                    color={theme.accent}
                  />
                </TouchableOpacity>
              ))}
              {suggestions.some(
                (suggestion) => suggestion.provider === 'osm'
              ) && (
                <View style={styles.suggestionSource}>
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={12}
                    color="#94A3B8"
                  />
                  <Text style={styles.suggestionSourceText}>
                    Results from OpenStreetMap · Google Places is unavailable
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Quick add actions */}
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={handleAddCurrentLocation}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <MaterialCommunityIcons
                name="crosshairs-gps"
                size={22}
                color={theme.accent}
              />
            )}
            <Text style={styles.quickLabel}>Current location</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickCard} onPress={openManualAdd}>
            <MaterialCommunityIcons
              name="map-marker-plus-outline"
              size={22}
              color={theme.accent}
            />
            <Text style={styles.quickLabel}>Add manually</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => setRouteModalVisible(true)}
          >
            <MaterialCommunityIcons
              name="flag-checkered"
              size={22}
              color={theme.accent}
            />
            <Text style={styles.quickLabel}>Start & end</Text>
          </TouchableOpacity>
        </View>

        {/* Start / end summary */}
        {activeRoute && (
          <TouchableOpacity
            style={styles.startEndBar}
            onPress={() => setRouteModalVisible(true)}
          >
            <View
              style={[
                styles.startEndIcon,
                { backgroundColor: theme.accentSoft },
              ]}
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={18}
                color={theme.accent}
              />
            </View>
            <View style={styles.startEndBarInfo}>
              <Text style={styles.startEndLabel}>Start → End</Text>
              <Text style={styles.startEndValue} numberOfLines={1}>
                {activeRoute.start?.address || 'Not set'}
                {'  →  '}
                {activeRoute.end?.address ||
                  (activeRoute.start ? 'Round trip' : 'Not set')}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color="#94A3B8"
            />
          </TouchableOpacity>
        )}

        {/* Map */}
        {stops.length > 0 && (
          <View style={styles.mapWrap}>
            <RouteMap
              path={mapPath}
              stops={stops}
              start={activeRoute?.start}
              end={activeRoute?.end}
              currentLocation={currentLocation}
              accent={theme.accent}
              height={240}
              onStopPress={(index) => {
                const stop = stops[index];
                if (stop) openDetails(stop);
              }}
            />
            <View style={styles.mapFooter}>
              <Text style={styles.mapHint}>
                {activeRoute?.optimized
                  ? 'Optimized route'
                  : 'Stop preview · optimize for the best drive'}
              </Text>
              <View style={styles.mapFooterActions}>
                {activeRoute?.approximate && (
                  <TouchableOpacity
                    style={styles.mapAction}
                    onPress={reorderApproximate}
                  >
                    <Text style={styles.mapActionText}>Re-sort</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.mapAction}
                  onPress={openWholeRoute}
                >
                  <Text style={styles.mapActionText}>Open in Maps</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Stops list */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Stops</Text>
            <Text style={styles.sectionSubtitle}>
              {stops.length === 0
                ? 'No stops yet'
                : `${deliveredCount} delivered · ${pendingCount} pending`}
            </Text>
          </View>
          {stops.length > 0 && (
            <View style={styles.sectionHeaderActions}>
              <TouchableOpacity
                style={styles.sectionAction}
                onPress={handleOptimize}
                disabled={routing}
              >
                {routing ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Text
                    style={[styles.sectionActionText, { color: theme.accent }]}
                  >
                    Optimize
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={clearRoute}>
                <Text style={[styles.clearText, { color: '#DC2626' }]}>
                  Clear
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {stops.length > 0 && (
          <>
            <View style={styles.filterRow}>
              {(
                [
                  { key: 'all', label: `All ${stops.length}` },
                  { key: 'pending', label: `Pending ${pendingCount}` },
                  { key: 'delivered', label: `Done ${deliveredCount}` },
                ] as { key: StopFilter; label: string }[]
              ).map((filter) => {
                const active = stopFilter === filter.key;
                return (
                  <TouchableOpacity
                    key={filter.key}
                    style={[
                      styles.filterChip,
                      active && {
                        backgroundColor: theme.accentSoft,
                        borderColor: theme.accentBorder,
                      },
                    ]}
                    onPress={() => setStopFilter(filter.key)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        active && { color: theme.accentDark },
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {stops.length > 4 && (
              <View style={styles.stopSearchRow}>
                <MaterialCommunityIcons
                  name="magnify"
                  size={16}
                  color="#64748B"
                />
                <TextInput
                  style={styles.stopSearchInput}
                  value={stopQuery}
                  onChangeText={setStopQuery}
                  placeholder="Find a stop by address, name or phone"
                  placeholderTextColor="#94A3B8"
                />
                {!!stopQuery && (
                  <TouchableOpacity onPress={() => setStopQuery('')}>
                    <MaterialCommunityIcons
                      name="close-circle"
                      size={16}
                      color="#94A3B8"
                    />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {filteredStops.length === 0 ? (
              <View style={styles.emptyFilter}>
                <Text style={styles.emptyText}>No stops match this filter.</Text>
              </View>
            ) : (
              filteredStops.map(({ stop, index }) => (
                <View key={stop.id} style={styles.stopCard}>
                  <View style={styles.stopTop}>
                    <View
                      style={[
                        styles.serial,
                        {
                          backgroundColor: stop.delivered
                            ? '#DCFCE7'
                            : theme.accentSoft,
                        },
                      ]}
                    >
                      {stop.delivered ? (
                        <MaterialCommunityIcons
                          name="check"
                          size={14}
                          color="#15803D"
                        />
                      ) : (
                        <Text
                          style={[styles.serialText, { color: theme.accent }]}
                        >
                          {index + 1}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.stopInfo}
                      onPress={() => openDetails(stop)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.stopAddress,
                          stop.delivered && styles.stopAddressDone,
                        ]}
                        numberOfLines={2}
                      >
                        {stop.address}
                      </Text>
                      {!!(stop.contactName || stop.phone) && (
                        <Text style={styles.stopContact} numberOfLines={1}>
                          {[stop.contactName, stop.phone]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      )}
                      {!!stop.note && (
                        <Text style={styles.stopNote} numberOfLines={1}>
                          {stop.note}
                        </Text>
                      )}
                      <View style={styles.stopMetaRow}>
                        {stop.priority && (
                          <View
                            style={[
                              styles.stopMetaChip,
                              styles.priorityChip,
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="star"
                              size={10}
                              color="#B45309"
                            />
                            <Text
                              style={[
                                styles.stopMetaText,
                                { color: '#B45309' },
                              ]}
                            >
                              High priority
                            </Text>
                          </View>
                        )}
                        {!!stop.etaText && (
                          <View
                            style={[
                              styles.stopMetaChip,
                              { backgroundColor: theme.accentSoft },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="clock-outline"
                              size={10}
                              color={theme.accentDark}
                            />
                            <Text
                              style={[
                                styles.stopMetaText,
                                { color: theme.accentDark },
                              ]}
                            >
                              ETA {stop.etaText}
                            </Text>
                          </View>
                        )}
                        {!!stop.legDistanceText && (
                          <Text style={styles.stopMetaText}>
                            {stop.legDistanceText}
                          </Text>
                        )}
                        {!!stop.orderCount && (
                          <Text style={styles.stopMetaText}>
                            {stop.orderCount} order
                            {stop.orderCount === 1 ? '' : 's'}
                          </Text>
                        )}
                        {stop.delivered && !!stop.deliveredAt && (
                          <Text style={[styles.stopMetaText, { color: '#15803D' }]}>
                            Delivered {formatDeliveryTime(stop.deliveredAt)}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.checkButton}
                      onPress={() =>
                        stop.delivered
                          ? toggleDelivered(stop)
                          : openProofForStop(stop)
                      }
                      accessibilityLabel="Toggle delivered"
                    >
                      <MaterialCommunityIcons
                        name={
                          stop.delivered
                            ? 'checkbox-marked-circle'
                            : 'checkbox-blank-circle-outline'
                        }
                        size={23}
                        color={stop.delivered ? '#16A34A' : '#94A3B8'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuButton}
                      onPress={() => setMenuStopId(stop.id)}
                      accessibilityLabel="Stop options"
                    >
                      <MaterialCommunityIcons
                        name="dots-vertical"
                        size={20}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {stops.length === 0 && (
          <View style={styles.emptyState}>
            <View
              style={[styles.emptyIcon, { backgroundColor: theme.accentSoft }]}
            >
              <MaterialCommunityIcons
                name="map-marker-plus-outline"
                size={34}
                color={theme.accent}
              />
            </View>
            <Text style={styles.emptyTitle}>Build your first route</Text>
            <Text style={styles.emptyText}>
              Search for an address above, use your current location, or paste
              coordinates. Then optimize the order and start driving.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.optimizeButton,
            { backgroundColor: theme.accent },
            (routing || stops.length === 0) && styles.disabled,
          ]}
          onPress={handleOptimize}
          disabled={routing || stops.length === 0}
        >
          {routing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons name="routes" size={20} color="#fff" />
              <Text style={styles.optimizeText}>
                {activeRoute?.optimized ? 'Re-optimize route' : 'Optimize route'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {stops.length > 0 && (
          <View style={styles.footerActions}>
            <TouchableOpacity style={styles.footerAction} onPress={shareRoute}>
              <MaterialCommunityIcons
                name="share-variant-outline"
                size={17}
                color="#475569"
              />
              <Text style={styles.footerActionText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerAction} onPress={copyRoute}>
              <MaterialCommunityIcons
                name="content-copy"
                size={17}
                color="#475569"
              />
              <Text style={styles.footerActionText}>Copy</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ------------------------------------------------------ Manual add */}
      <Modal
        visible={manualModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setManualModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add stop manually</Text>
              <TouchableOpacity onPress={() => setManualModalVisible(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color="#334155"
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Paste a full address, or enter coordinates like “12.9716,
              77.5946”.
            </Text>
            <TextInput
              style={styles.manualInput}
              value={manualText}
              onChangeText={(text) => {
                setManualText(text);
                setManualError('');
              }}
              placeholder="221B Baker Street, London  ·  51.5007, -0.1246"
              placeholderTextColor="#94A3B8"
              multiline
              textAlignVertical="top"
            />
            {!!manualError && (
              <Text style={styles.manualError}>{manualError}</Text>
            )}
            <TouchableOpacity
              style={[
                styles.modalPrimary,
                { backgroundColor: theme.accent, marginTop: 12 },
              ]}
              onPress={submitManualStop}
              disabled={manualBusy}
            >
              {manualBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalPrimaryText}>Add stop</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ------------------------------------------------------ New stop details */}
      <Modal
        visible={stopDetailsVisible}
        transparent
        animationType="slide"
        onRequestClose={cancelPendingStop}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.pendingHeaderText}>
                <Text style={styles.modalTitle}>Add stop</Text>
                <Text style={styles.modalSubtitle}>
                  Add the receiver details for this address.
                </Text>
              </View>
              <TouchableOpacity onPress={cancelPendingStop}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color="#334155"
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.pendingAddressBox}>
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={17}
                  color={theme.accent}
                />
                <Text style={styles.pendingAddressText}>
                  {pendingStopLocation?.address || ''}
                </Text>
              </View>

              <Text style={styles.pendingLabel}>Name</Text>
              <TextInput
                style={styles.pendingInput}
                value={pendingStopName}
                onChangeText={setPendingStopName}
                placeholder="Customer or contact name"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />

              <Text style={styles.pendingLabel}>Phone</Text>
              <TextInput
                style={styles.pendingInput}
                value={pendingStopPhone}
                onChangeText={setPendingStopPhone}
                placeholder="Phone number"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
              />

              <Text style={styles.pendingLabel}>Note</Text>
              <TextInput
                style={[styles.pendingInput, styles.pendingNoteInput]}
                value={pendingStopNote}
                onChangeText={setPendingStopNote}
                placeholder="e.g. Gate code 4321, call on arrival"
                placeholderTextColor="#94A3B8"
                multiline
                textAlignVertical="top"
              />
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={cancelPendingStop}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalPrimary,
                  { backgroundColor: theme.accent },
                  !canSavePendingStop && styles.disabled,
                ]}
                onPress={() => void savePendingStop()}
                disabled={!canSavePendingStop}
              >
                <Text style={styles.modalPrimaryText}>Save stop</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ------------------------------------------------------ Start route */}
      <Modal
        visible={startSetupVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!startSetupBusy) setStartSetupVisible(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, styles.sheetCard]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Start route</Text>
                <Text style={styles.modalSubtitle}>
                  Set where you begin and finish. Your assigned deliveries are
                  added and optimized automatically.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setStartSetupVisible(false)}
                disabled={startSetupBusy}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color="#334155"
                />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <LocationPicker
                label="Start location"
                value={startSetupStart}
                onChange={setStartSetupStart}
                onClear={() => setStartSetupStart(null)}
                accent={theme.accent}
                placeholder="Search start or use current location"
              />
              <LocationPicker
                label="End location"
                value={startSetupEnd}
                onChange={setStartSetupEnd}
                onClear={() => setStartSetupEnd(null)}
                accent={theme.accent}
                placeholder="Search end (optional)"
              />
              <Text style={styles.startSetupHint}>
                Leave the end empty to finish back at the start.
              </Text>
              <TouchableOpacity
                style={[
                  styles.startButton,
                  { backgroundColor: theme.accent },
                  (!startSetupStart || startSetupBusy || routing) &&
                    styles.disabled,
                ]}
                onPress={() => void confirmStartRoute()}
                disabled={!startSetupStart || startSetupBusy || routing}
              >
                {startSetupBusy || routing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.startButtonText}>
                    Start & optimize route
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ------------------------------------------------------ Start / end */}
      <Modal
        visible={routeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRouteModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, styles.sheetCard]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Start & end</Text>
                <Text style={styles.modalSubtitle}>
                  The optimizer uses these two points.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setRouteModalVisible(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color="#334155"
                />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <LocationPicker
                label="Start location"
                value={activeRoute?.start || null}
                onChange={setStartLocation}
                onClear={clearStartLocation}
                accent={theme.accent}
                placeholder="Search start or use current location"
              />
              <LocationPicker
                label="End location"
                value={activeRoute?.end || null}
                onChange={setEndLocation}
                onClear={clearEndLocation}
                accent={theme.accent}
                placeholder="Search end or use current location"
              />
              <TouchableOpacity
                style={[styles.linkButton, { borderColor: theme.accentBorder }]}
                onPress={useLastStopAsEnd}
              >
                <MaterialCommunityIcons
                  name="map-marker-check-outline"
                  size={15}
                  color={theme.accent}
                />
                <Text style={[styles.linkButtonText, { color: theme.accent }]}>
                  End at the last stop
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.startButton, { backgroundColor: theme.accent }]}
                onPress={() => setRouteModalVisible(false)}
              >
                <Text style={styles.startButtonText}>Save locations</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ------------------------------------------------------ Stop details */}
      <Modal
        visible={!!detailStop}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailStopId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Stop details</Text>
              <TouchableOpacity onPress={() => setDetailStopId(null)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color="#334155"
                />
              </TouchableOpacity>
            </View>
            {detailStop && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.detailAddress}>{detailStop.address}</Text>
                <Text style={styles.detailMeta}>
                  {detailStop.lat.toFixed(6)}, {detailStop.lng.toFixed(6)}
                  {detailStop.etaText ? ` · ETA ${detailStop.etaText}` : ''}
                  {detailStop.legDistanceText
                    ? ` · ${detailStop.legDistanceText}`
                    : ''}
                </Text>

                {/* Note lives right under the address, with an inline edit button. */}
                <View style={styles.detailBlock}>
                  <View style={styles.detailBlockHeader}>
                    <Text style={styles.detailBlockLabel}>Note</Text>
                    {detailNoteEditing ? (
                      <TouchableOpacity
                        style={styles.detailBlockAction}
                        onPress={saveDetailNote}
                      >
                        <MaterialCommunityIcons
                          name="check"
                          size={15}
                          color={theme.accent}
                        />
                        <Text
                          style={[
                            styles.detailBlockActionText,
                            { color: theme.accent },
                          ]}
                        >
                          Save
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.detailBlockAction}
                        onPress={() => {
                          setDetailNoteDraft(detailStop.note || '');
                          setDetailNoteEditing(true);
                        }}
                      >
                        <MaterialCommunityIcons
                          name="pencil-outline"
                          size={14}
                          color="#64748B"
                        />
                        <Text style={styles.detailBlockActionText}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {detailNoteEditing ? (
                    <View>
                      <TextInput
                        style={styles.detailNoteInput}
                        value={detailNoteDraft}
                        onChangeText={setDetailNoteDraft}
                        placeholder="e.g. Gate code 4321, call on arrival"
                        placeholderTextColor="#94A3B8"
                        multiline
                        autoFocus
                      />
                      <TouchableOpacity
                        style={styles.detailInlineCancel}
                        onPress={() => setDetailNoteEditing(false)}
                      >
                        <Text style={styles.detailInlineCancelText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.detailNote,
                        !detailStop.note && styles.detailNoteEmpty,
                      ]}
                    >
                      {detailStop.note || 'Add a note for this stop'}
                    </Text>
                  )}
                </View>

                {/* Customer contact, needed for the proof photo file name. */}
                <View style={styles.detailBlock}>
                  <View style={styles.detailBlockHeader}>
                    <Text style={styles.detailBlockLabel}>Receiver</Text>
                    {contactEditing ? (
                      <TouchableOpacity
                        style={styles.detailBlockAction}
                        onPress={saveContact}
                      >
                        <MaterialCommunityIcons
                          name="check"
                          size={15}
                          color={theme.accent}
                        />
                        <Text
                          style={[
                            styles.detailBlockActionText,
                            { color: theme.accent },
                          ]}
                        >
                          Save
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.detailBlockAction}
                        onPress={() => {
                          setContactNameDraft(detailStop.contactName || '');
                          setPhoneDraft(detailStop.phone || '');
                          setContactEditing(true);
                        }}
                      >
                        <MaterialCommunityIcons
                          name="pencil-outline"
                          size={14}
                          color="#64748B"
                        />
                        <Text style={styles.detailBlockActionText}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {contactEditing ? (
                    <View>
                      <TextInput
                        style={styles.detailContactInput}
                        value={contactNameDraft}
                        onChangeText={setContactNameDraft}
                        placeholder="Customer name"
                        placeholderTextColor="#94A3B8"
                        autoCapitalize="words"
                      />
                      <TextInput
                        style={[styles.detailContactInput, { marginTop: 6 }]}
                        value={phoneDraft}
                        onChangeText={setPhoneDraft}
                        placeholder="Phone number"
                        placeholderTextColor="#94A3B8"
                        keyboardType="phone-pad"
                      />
                      <View style={styles.detailOrderRow}>
                        <MaterialCommunityIcons
                          name="package-variant"
                          size={14}
                          color="#64748B"
                        />
                        <Text style={styles.detailOrderLabel}>Orders</Text>
                        <TouchableOpacity
                          style={styles.detailOrderButton}
                          onPress={() => adjustDetailOrders(-1)}
                        >
                          <MaterialCommunityIcons
                            name="minus"
                            size={14}
                            color="#334155"
                          />
                        </TouchableOpacity>
                        <TextInput
                          style={styles.detailOrderInput}
                          value={orderCountDraft}
                          onChangeText={(text) =>
                            setOrderCountDraft(
                              text.replace(/[^\d]/g, '').slice(0, 4)
                            )
                          }
                          keyboardType="number-pad"
                          textAlign="center"
                        />
                        <TouchableOpacity
                          style={styles.detailOrderButton}
                          onPress={() => adjustDetailOrders(1)}
                        >
                          <MaterialCommunityIcons
                            name="plus"
                            size={14}
                            color="#334155"
                          />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={styles.detailInlineCancel}
                        onPress={() => setContactEditing(false)}
                      >
                        <Text style={styles.detailInlineCancelText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <View style={styles.detailContactRow}>
                        <MaterialCommunityIcons
                          name="account-outline"
                          size={15}
                          color="#64748B"
                        />
                        <Text style={styles.detailContactText}>
                          {detailStop.contactName || 'No name added'}
                        </Text>
                      </View>
                      <View style={styles.detailContactRow}>
                        <MaterialCommunityIcons
                          name="phone-outline"
                          size={14}
                          color="#64748B"
                        />
                        <Text style={styles.detailContactText}>
                          {detailStop.phone || 'No phone added'}
                        </Text>
                        {!!detailStop.phone && (
                          <TouchableOpacity
                            style={styles.detailCallLink}
                            onPress={() => void callStopContact(detailStop)}
                          >
                            <Text
                              style={[
                                styles.detailCallLinkText,
                                { color: theme.accent },
                              ]}
                            >
                              Call
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.detailContactRow}>
                        <MaterialCommunityIcons
                          name="package-variant"
                          size={14}
                          color="#64748B"
                        />
                        <Text style={styles.detailContactText}>
                          Orders: {detailStop.orderCount ?? 0}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                <View style={styles.detailStatusRow}>
                  <MaterialCommunityIcons
                    name={
                      detailStop.delivered
                        ? 'checkbox-marked-circle'
                        : 'checkbox-blank-circle-outline'
                    }
                    size={20}
                    color={detailStop.delivered ? '#16A34A' : '#94A3B8'}
                  />
                  <Text style={styles.detailStatusText}>
                    {detailStop.delivered
                      ? `Delivered${
                          detailStop.deliveredAt
                            ? ` at ${formatDeliveryTime(detailStop.deliveredAt)}`
                            : ''
                        }`
                      : 'Not delivered yet'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.detailPriority,
                    detailStop.priority && styles.detailPriorityActive,
                  ]}
                  onPress={() =>
                    setStopPriority(detailStop, !detailStop.priority)
                  }
                >
                  <MaterialCommunityIcons
                    name={detailStop.priority ? 'star' : 'star-outline'}
                    size={18}
                    color="#B45309"
                  />
                  <Text style={styles.detailPriorityText}>
                    {detailStop.priority
                      ? 'High priority · deliver first'
                      : 'Mark as high priority'}
                  </Text>
                </TouchableOpacity>

                {/* Map + call logo buttons. */}
                <View style={styles.detailActions}>
                  <View style={styles.detailActionItem}>
                    <TouchableOpacity
                      style={[
                        styles.detailNavCircle,
                        { backgroundColor: theme.accent },
                      ]}
                      onPress={() => navigateToStop(detailStop)}
                      accessibilityLabel="Navigate with Google Maps"
                    >
                      <MaterialCommunityIcons
                        name="navigation"
                        size={22}
                        color="#fff"
                      />
                    </TouchableOpacity>
                    <Text style={styles.detailActionLabel}>Navigate</Text>
                  </View>

                  <View style={styles.detailActionItem}>
                    <TouchableOpacity
                      style={[
                        styles.detailIconCircle,
                        !detailStop.phone && styles.detailIconDisabled,
                      ]}
                      onPress={() => void callStopContact(detailStop)}
                      disabled={!detailStop.phone}
                      accessibilityLabel="Call customer"
                    >
                      <MaterialCommunityIcons
                        name="phone-outline"
                        size={20}
                        color="#334155"
                      />
                    </TouchableOpacity>
                    <Text style={styles.detailActionLabel}>Call</Text>
                  </View>
                </View>

                {detailStop.delivered ? (
                  <TouchableOpacity
                    style={[
                      styles.detailButtonOutline,
                      { borderColor: '#B45309' },
                    ]}
                    onPress={() => toggleDelivered(detailStop)}
                  >
                    <Text
                      style={[styles.detailButtonText, { color: '#B45309' }]}
                    >
                      Mark as not delivered
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.detailButton,
                        { backgroundColor: '#16A34A' },
                      ]}
                      onPress={() => openProofForStop(detailStop)}
                    >
                      <MaterialCommunityIcons
                        name="check-decagram"
                        size={18}
                        color="#fff"
                      />
                      <Text style={styles.detailButtonText}>
                        Mark as delivered
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.detailProofHint}>
                      A proof photo is required to mark this stop delivered.
                    </Text>
                  </>
                )}

                {/* Delivery proof photos, below the delivery action. */}
                <View style={styles.detailBlock}>
                  <View style={styles.detailBlockHeader}>
                    <Text style={styles.detailBlockLabel}>Proof of delivery</Text>
                    <Text style={styles.detailProofCount}>
                      {detailPhotos.length}/
                      {Math.max(1, deliverySettings.maxProofPhotos || 2)}
                    </Text>
                  </View>
                  <DeliveryProofBox
                    photos={detailPhotos}
                    accent={theme.accent}
                    busy={detailPhotoBusy}
                    maxPhotos={deliverySettings.maxProofPhotos}
                    onAddPress={chooseDetailProofSource}
                    onCamera={() => void addDetailProof('camera')}
                    onGallery={() => void addDetailProof('library')}
                    onRemove={confirmRemoveDetailProof}
                    onPhotoPress={setViewerPhoto}
                    onRetry={() => void runPhotoSync(true)}
                    retrying={detailPhotoSyncing}
                    helperText={
                      detailPhotos.length > 0
                        ? detailStop.delivered
                          ? 'Delivery proof attached to this stop'
                          : 'Add one more photo, or mark the delivery below'
                        : 'Add a photo now, or when you mark it delivered'
                    }
                  />
                </View>

                <TouchableOpacity
                  style={styles.detailDelete}
                  onPress={() => deleteStop(detailStop)}
                >
                  <Text style={styles.detailDangerText}>Delete this stop</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------------ Stop menu */}
      <Modal
        visible={!!menuStop}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuStopId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.menuTitle} numberOfLines={2}>
              {menuStop?.address}
            </Text>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const stop = menuStop;
                setMenuStopId(null);
                if (stop) void navigateToStop(stop);
              }}
            >
              <MaterialCommunityIcons
                name="navigation"
                size={18}
                color="#2563EB"
              />
              <Text style={styles.menuOptionText}>Navigate to stop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const stop = menuStop;
                setMenuStopId(null);
                if (stop) toggleDelivered(stop);
              }}
            >
              <MaterialCommunityIcons
                name={
                  menuStop?.delivered
                    ? 'checkbox-blank-circle-outline'
                    : 'checkbox-marked-circle'
                }
                size={18}
                color="#16A34A"
              />
              <Text style={styles.menuOptionText}>
                {menuStop?.delivered
                  ? 'Mark as not delivered'
                  : 'Mark as delivered'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const stop = menuStop;
                setMenuStopId(null);
                if (stop) openStopNote(stop);
              }}
            >
              <MaterialCommunityIcons
                name="note-text-outline"
                size={18}
                color="#2563EB"
              />
              <Text style={styles.menuOptionText}>
                {menuStop?.note ? 'Edit note' : 'Add note'}
              </Text>
            </TouchableOpacity>
            {!!menuStop && menuStopIndex > 0 && (
              <TouchableOpacity
                style={styles.menuOption}
                onPress={() => {
                  const stop = menuStop;
                  setMenuStopId(null);
                  if (stop) moveStop(stop, -1);
                }}
              >
                <MaterialCommunityIcons
                  name="arrow-up"
                  size={18}
                  color="#2563EB"
                />
                <Text style={styles.menuOptionText}>Move up</Text>
              </TouchableOpacity>
            )}
            {!!menuStop && menuStopIndex < stops.length - 1 && (
              <TouchableOpacity
                style={styles.menuOption}
                onPress={() => {
                  const stop = menuStop;
                  setMenuStopId(null);
                  if (stop) moveStop(stop, 1);
                }}
              >
                <MaterialCommunityIcons
                  name="arrow-down"
                  size={18}
                  color="#2563EB"
                />
                <Text style={styles.menuOptionText}>Move down</Text>
              </TouchableOpacity>
            )}
            {!!menuStop && menuStopIndex > 0 && (
              <TouchableOpacity
                style={styles.menuOption}
                onPress={() => {
                  const stop = menuStop;
                  setMenuStopId(null);
                  if (stop) setStopFirst(stop);
                }}
              >
                <MaterialCommunityIcons
                  name="format-vertical-align-top"
                  size={18}
                  color="#2563EB"
                />
                <Text style={styles.menuOptionText}>Set as first stop</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const stop = menuStop;
                setMenuStopId(null);
                if (stop) setStopPriority(stop, !stop.priority);
              }}
            >
              <MaterialCommunityIcons
                name={menuStop?.priority ? 'star-off' : 'star-outline'}
                size={18}
                color="#D97706"
              />
              <Text style={styles.menuOptionText}>
                {menuStop?.priority
                  ? 'Remove high priority'
                  : 'Mark as high priority'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const stop = menuStop;
                setMenuStopId(null);
                if (stop) deleteStop(stop);
              }}
            >
              <MaterialCommunityIcons
                name="delete-outline"
                size={18}
                color="#DC2626"
              />
              <Text style={[styles.menuOptionText, { color: '#DC2626' }]}>
                Delete stop
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuCancel}
              onPress={() => setMenuStopId(null)}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ------------------------------------------------------ Note */}
      <DeliveryProofModal
        visible={!!proofStop}
        stop={proofStop}
        routeId={activeRoute?.id || ''}
        accent={theme.accent}
        settings={deliverySettings}
        onClose={() => setProofStopId(null)}
        onPhotoPress={setViewerPhoto}
        onSave={(details) => {
          if (!proofStop) return;
          completeDeliveredStop(proofStop, details);
        }}
      />

      <PhotoViewerModal
        visible={!!viewerPhoto}
        photo={viewerData}
        onClose={() => setViewerPhoto(null)}
        onDelete={
          viewerPhoto
            ? () => {
                const id = viewerPhoto.id;
                setViewerPhoto(null);
                void removeDeliveryPhoto(id);
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    paddingTop: 58,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  title: { fontSize: 26, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 4 },
  content: { padding: 16, paddingBottom: 110 },

  routeCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  routeCardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  routeNameWrap: { flex: 1, paddingRight: 8 },
  routeName: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  routeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginRight: 8,
  },
  statusChipText: {
    fontSize: 9.5,
    fontWeight: '800',
    marginLeft: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  metaLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  metaLinkText: { fontSize: 10, color: '#64748B', marginLeft: 3, fontWeight: '700' },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  assigneeText: {
    flex: 1,
    fontSize: 11.5,
    color: '#64748B',
    marginLeft: 5,
    fontWeight: '600',
  },
  moreButton: { padding: 4 },

  startStatusButton: {
    borderRadius: 12,
    backgroundColor: '#F97316',
    borderColor: '#F97316',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  startStatusTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  startStatusMeta: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 3,
    textAlign: 'center',
  },
  startStatusBaselineTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  startStatusBaselineFill: {
    height: 4,
    backgroundColor: '#fff',
  },
  runningStatusButton: {
    backgroundColor: '#EA580C',
    borderColor: '#EA580C',
  },
  completedStatusButton: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },

  routeCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '800',
    marginLeft: 6,
  },
  secondaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginLeft: 8,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
  },
  secondaryActionText: { fontSize: 12.5, fontWeight: '800', marginLeft: 4 },

  opsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  opsTop: { flexDirection: 'row', alignItems: 'center' },
  opsIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opsInfo: { flex: 1, marginLeft: 9 },
  opsTitle: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  opsSubtitle: { fontSize: 9.5, color: '#64748B', marginTop: 2, lineHeight: 13 },

  adminToolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  adminToolIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminToolInfo: { flex: 1 },
  adminToolTitle: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  adminToolSubtitle: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  adminNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  adminNoteText: {
    flex: 1,
    fontSize: 10.5,
    color: '#64748B',
    lineHeight: 15,
  },

  mySpotRouteCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  mySpotRouteTop: { flexDirection: 'row', alignItems: 'center' },
  mySpotRouteIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mySpotRouteInfo: { flex: 1, marginLeft: 9 },
  mySpotRouteLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  mySpotRouteAddress: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  mySpotRoutePill: {
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 6,
  },
  mySpotRoutePillText: { fontSize: 9.5, fontWeight: '800' },
  mySpotRouteStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  mySpotRouteStat: {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: 4,
  },
  mySpotRouteValue: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  mySpotRouteStatLabel: { fontSize: 8.5, color: '#94A3B8', marginTop: 2 },
  mySpotCurrent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 11,
    padding: 9,
    marginTop: 11,
  },
  mySpotCurrentInfo: { flex: 1, marginLeft: 7 },
  mySpotCurrentLabel: { fontSize: 8.5, color: '#94A3B8', fontWeight: '700' },
  mySpotCurrentAddress: {
    fontSize: 11,
    color: '#1E293B',
    fontWeight: '700',
    marginTop: 1,
  },
  mySpotAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingVertical: 11,
    marginTop: 10,
  },
  mySpotAddText: { color: '#fff', fontSize: 12, fontWeight: '800', marginLeft: 6 },

  employeeProofCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  employeeProofIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeProofInfo: { flex: 1 },
  employeeProofTitle: { fontSize: 13, fontWeight: '800', color: '#1E293B' },
  employeeProofSubtitle: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },

  nextCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  nextInline: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  nextHeader: { flexDirection: 'row', alignItems: 'center' },
  nextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  nextBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginLeft: 3,
  },
  priorityNextBadge: { backgroundColor: '#D97706', marginLeft: 6 },
  nextCounter: { fontSize: 10.5, color: '#64748B', marginLeft: 8, fontWeight: '700' },
  nextEta: { fontSize: 10.5, fontWeight: '800', marginLeft: 'auto' },
  nextAddress: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 9,
  },
  nextNote: { fontSize: 11.5, color: '#B45309', marginTop: 4 },
  nextContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  nextContactText: {
    fontSize: 10.5,
    color: '#64748B',
    marginLeft: 4,
    fontWeight: '600',
    flex: 1,
  },
  nextActions: { flexDirection: 'row', marginTop: 12 },
  nextNavGroup: {
    flex: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  nextNavMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  nextNavCaret: {
    width: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.28)',
  },
  nextNav: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
  },
  nextNavText: { color: '#fff', fontSize: 13.5, fontWeight: '800', marginLeft: 6 },
  nextDone: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginLeft: 8,
    backgroundColor: '#DCFCE7',
  },
  nextDoneText: { color: '#15803D', fontSize: 13.5, fontWeight: '800', marginLeft: 6 },
  allDoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  allDoneText: {
    flex: 1,
    fontSize: 11.5,
    color: '#15803D',
    fontWeight: '700',
    marginLeft: 8,
  },
  uploadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    padding: 11,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  uploadBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  uploadBannerTextWrap: { flex: 1 },
  uploadBannerTitle: { fontSize: 11.5, fontWeight: '800', color: '#92400E' },
  uploadBannerSubtitle: {
    fontSize: 9.5,
    color: '#B45309',
    marginTop: 2,
  },
  uploadBannerAction: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#B45309',
    marginLeft: 8,
  },

  searchCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    fontSize: 13,
    color: '#1E293B',
  },
  searchErrorRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 },
  errorText: { flex: 1, fontSize: 10, color: '#B45309', marginLeft: 4 },
  suggestions: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  suggestionText: { flex: 1, marginLeft: 6 },
  suggestionMain: { fontSize: 12, fontWeight: '700', color: '#1E293B' },
  suggestionSecondary: { fontSize: 10, color: '#64748B', marginTop: 1 },
  suggestionSource: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#F8FAFC',
  },
  suggestionSourceText: {
    fontSize: 9,
    color: '#94A3B8',
    marginLeft: 4,
    flex: 1,
  },

  quickRow: { flexDirection: 'row', marginBottom: 10 },
  quickCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginRight: 8,
  },
  quickLabel: {
    fontSize: 9.5,
    color: '#475569',
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },

  startEndBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 12,
  },
  startEndIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  startEndBarInfo: { flex: 1 },
  startEndLabel: { fontSize: 9.5, color: '#94A3B8', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  startEndValue: { fontSize: 11.5, color: '#334155', fontWeight: '600', marginTop: 2 },

  mapWrap: { marginBottom: 16 },
  mapFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  mapHint: { flex: 1, fontSize: 9.5, color: '#94A3B8' },
  mapFooterActions: { flexDirection: 'row', alignItems: 'center' },
  mapAction: { marginLeft: 12 },
  mapActionText: { fontSize: 10, fontWeight: '800', color: '#2563EB' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  sectionSubtitle: { fontSize: 10.5, color: '#94A3B8', marginTop: 2 },
  sectionHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  sectionAction: { marginRight: 14, minWidth: 54, alignItems: 'flex-end' },
  sectionActionText: { fontSize: 11, fontWeight: '800' },
  clearText: { fontSize: 11, fontWeight: '800' },

  filterRow: { flexDirection: 'row', marginBottom: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    marginRight: 7,
  },
  filterChipText: { fontSize: 10.5, color: '#64748B', fontWeight: '700' },

  stopSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  stopSearchInput: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    fontSize: 12,
    color: '#1E293B',
  },

  emptyFilter: { paddingVertical: 24, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 34 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: '#334155' },
  emptyText: {
    marginTop: 6,
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 17,
  },

  stopCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 11,
    marginBottom: 9,
  },
  stopTop: { flexDirection: 'row', alignItems: 'center' },
  serial: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  serialText: { fontSize: 11.5, fontWeight: '800' },
  stopInfo: { flex: 1 },
  stopAddress: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  stopAddressDone: { color: '#64748B', textDecorationLine: 'line-through' },
  stopNote: { fontSize: 10, color: '#B45309', marginTop: 2 },
  stopContact: { fontSize: 9.5, color: '#64748B', marginTop: 2 },
  stopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  stopMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginRight: 6,
  },
  priorityChip: { backgroundColor: '#FEF3C7' },
  stopMetaText: { fontSize: 9, color: '#94A3B8', marginRight: 6, fontWeight: '600' },
  checkButton: { padding: 4 },
  menuButton: { padding: 4, marginLeft: 1 },

  optimizeButton: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: 4,
  },
  optimizeText: { color: '#fff', fontSize: 15, fontWeight: '800', marginLeft: 8 },
  disabled: { opacity: 0.45 },

  footerActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
  },
  footerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 8,
    marginHorizontal: 4,
    borderRadius: 20,
    backgroundColor: '#fff',
  },
  footerActionText: { fontSize: 11, fontWeight: '700', color: '#475569', marginLeft: 5 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 30,
    maxHeight: '90%',
  },
  sheetCard: { maxHeight: '88%' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  modalSubtitle: { fontSize: 11, color: '#64748B', marginTop: 3, lineHeight: 15 },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 14 },
  modalCancelText: { fontSize: 13, color: '#64748B', fontWeight: '700' },
  modalPrimary: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  newRouteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 10,
    marginBottom: 12,
    borderStyle: 'dashed',
  },
  newRouteText: { fontSize: 12.5, fontWeight: '800', marginLeft: 5 },

  routeListCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 11,
    marginBottom: 9,
    backgroundColor: '#fff',
  },
  routeListMain: { flex: 1 },
  routeListTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeListName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: '#1E293B',
    marginRight: 8,
  },
  routeListMeta: { fontSize: 10.5, color: '#64748B', marginTop: 3 },
  routeListProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 7,
  },
  routeListPct: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    marginLeft: 8,
    width: 32,
    textAlign: 'right',
  },
  routeListUpdated: { fontSize: 9.5, color: '#94A3B8', marginTop: 5 },
  routeListActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  iconAction: {
    width: 32,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 5,
    backgroundColor: '#F8FAFC',
  },
  emptyModalText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 20,
    lineHeight: 17,
  },

  nameInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#1E293B',
    marginTop: 14,
  },
  workerSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  workerSearchInput: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 6,
    fontSize: 12.5,
    color: '#1E293B',
  },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  workerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  workerAvatarText: { fontSize: 12, fontWeight: '800' },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 12.5, fontWeight: '700', color: '#1E293B' },
  workerRole: { fontSize: 10, color: '#94A3B8', marginTop: 1 },
  workerCheck: { marginLeft: 8 },

  manualInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    minHeight: 84,
    padding: 10,
    fontSize: 13,
    color: '#1E293B',
    marginTop: 12,
  },
  manualError: { fontSize: 10.5, color: '#DC2626', marginTop: 7, lineHeight: 15 },

  pendingHeaderText: { flex: 1, paddingRight: 8 },
  pendingAddressBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 4,
  },
  pendingAddressText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    marginLeft: 6,
    lineHeight: 16,
  },
  pendingLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 11,
    marginBottom: 5,
  },
  pendingInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
  },
  pendingNoteInput: { minHeight: 72, textAlignVertical: 'top' },

  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 8,
  },
  linkButtonText: { fontSize: 10.5, fontWeight: '800', marginLeft: 5 },

  startButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  startButtonText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  startSetupHint: {
    fontSize: 10.5,
    color: '#94A3B8',
    lineHeight: 15,
    marginTop: 4,
    marginBottom: 2,
  },

  detailAddress: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  detailMeta: { fontSize: 11, color: '#64748B', marginTop: 4 },
  detailBlock: {
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 11,
    padding: 10,
    marginTop: 10,
    backgroundColor: '#fff',
  },
  detailBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  detailBlockLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailBlockAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  detailBlockActionText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#64748B',
    marginLeft: 3,
  },
  detailNote: {
    fontSize: 11.5,
    color: '#475569',
    lineHeight: 16,
    marginTop: 3,
  },
  detailNoteEmpty: { color: '#94A3B8', fontStyle: 'italic' },
  detailNoteInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    minHeight: 62,
    padding: 8,
    fontSize: 12,
    color: '#1E293B',
    textAlignVertical: 'top',
    backgroundColor: '#F8FAFC',
  },
  detailInlineCancel: { alignSelf: 'flex-start', paddingVertical: 5, marginTop: 2 },
  detailInlineCancelText: { fontSize: 10, color: '#94A3B8', fontWeight: '700' },
  detailContactInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    fontSize: 12,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
  },
  detailContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  detailContactText: {
    flex: 1,
    fontSize: 11.5,
    color: '#475569',
    marginLeft: 5,
  },
  detailCallLink: { paddingHorizontal: 8, paddingVertical: 2 },
  detailCallLinkText: { fontSize: 10, fontWeight: '800' },
  detailOrderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  detailOrderLabel: {
    flex: 1,
    fontSize: 11,
    color: '#475569',
    fontWeight: '700',
    marginLeft: 5,
  },
  detailOrderButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailOrderInput: {
    width: 42,
    height: 28,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: '800',
    color: '#1E293B',
  },
  detailStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  detailStatusText: { fontSize: 12, color: '#475569', marginLeft: 6 },
  detailPriority: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
    borderRadius: 11,
    paddingVertical: 10,
    marginTop: 10,
  },
  detailPriorityActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  detailPriorityText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B45309',
    marginLeft: 6,
  },
  detailActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  detailActionItem: { alignItems: 'center', minWidth: 64 },
  detailNavWrap: { width: 52, height: 52 },
  detailNavCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailNavCaret: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  detailIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailIconDisabled: { opacity: 0.4 },
  detailActionLabel: {
    fontSize: 9.5,
    color: '#64748B',
    fontWeight: '700',
    marginTop: 4,
  },
  mapDefaultHint: {
    fontSize: 9,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 2,
  },
  detailProofCount: { fontSize: 9.5, color: '#64748B', fontWeight: '800' },
  detailProofHint: {
    fontSize: 9.5,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 13,
  },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 14,
  },
  detailButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    marginLeft: 6,
  },
  detailButtonOutline: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 11,
    marginTop: 8,
  },
  detailButtonTextMuted: { color: '#64748B', fontWeight: '700', fontSize: 12 },
  detailDelete: { alignItems: 'center', paddingVertical: 13, marginTop: 4 },
  detailDangerText: { color: '#DC2626', fontWeight: '800', fontSize: 12.5 },

  menuTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 10,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  menuOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    marginLeft: 10,
  },
  menuCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  menuCancelText: { fontSize: 13, fontWeight: '800', color: '#64748B' },

  noteAddress: { fontSize: 12, color: '#64748B', marginBottom: 8 },
  noteInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    minHeight: 80,
    padding: 10,
    fontSize: 13,
    color: '#1E293B',
    textAlignVertical: 'top',
  },
  noteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  noteActionsRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  noteClear: { paddingVertical: 10, paddingHorizontal: 10 },
  noteClearText: { fontSize: 12, color: '#DC2626', fontWeight: '700' },
  noteCancel: { paddingVertical: 10, paddingHorizontal: 14 },
  noteCancelText: { fontSize: 13, color: '#64748B', fontWeight: '700' },
  noteSave: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginLeft: 8,
  },
  noteSaveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
