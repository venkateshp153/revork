import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  RouteLocation,
  RouteStop,
} from './routePlanner';

/**
 * Local-first route storage. Routes belong to the device/user session: they are
 * available offline and do not depend on the Google Sheet being writable.
 */

const STORE_KEY = 'revork.routes.v2';
const LEGACY_KEY = 'revork.route.v1';

export type RouteStatus = 'draft' | 'active' | 'completed';

export interface RouteAssignee {
  workerId: string;
  name: string;
}

export interface SavedRoute {
  id: string;
  name: string;
  stops: RouteStop[];
  start: RouteLocation | null;
  end: RouteLocation | null;
  optimized: boolean;
  path: { lat: number; lng: number }[];
  distanceText: string;
  durationText: string;
  approximate: boolean;
  status: RouteStatus;
  assignee?: RouteAssignee | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface RouteState {
  routes: SavedRoute[];
  activeId: string | null;
}

export function makeRouteId(): string {
  return `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRoute(name: string): SavedRoute {
  const now = Date.now();
  return {
    id: makeRouteId(),
    name: name.trim() || 'Untitled route',
    stops: [],
    start: null,
    end: null,
    optimized: false,
    path: [],
    distanceText: '',
    durationText: '',
    approximate: false,
    status: 'draft',
    assignee: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultRouteName(date = new Date()): string {
  return `Route · ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeLocation(value: any): RouteLocation | null {
  if (!value || typeof value !== 'object') return null;
  if (!isFiniteNumber(value.lat) || !isFiniteNumber(value.lng)) return null;
  return {
    address: typeof value.address === 'string' ? value.address : 'Location',
    lat: value.lat,
    lng: value.lng,
    ...(typeof value.placeId === 'string' ? { placeId: value.placeId } : {}),
  };
}

function normalizeStop(value: any, index: number): RouteStop | null {
  const location = normalizeLocation(value);
  if (!location) return null;
  return {
    ...location,
    id:
      typeof value.id === 'string' && value.id
        ? value.id
        : `stop_${Date.now()}_${index}`,
    note: typeof value.note === 'string' ? value.note : '',
    delivered: value.delivered === true,
    ...(typeof value.contactName === 'string' && value.contactName
      ? { contactName: value.contactName }
      : {}),
    ...(typeof value.phone === 'string' && value.phone
      ? { phone: value.phone }
      : {}),
    ...(value.orderCount !== undefined &&
    value.orderCount !== null &&
    Number.isFinite(Number(value.orderCount))
      ? { orderCount: Math.max(0, Math.round(Number(value.orderCount))) }
      : {}),
    ...(typeof value.deliveryId === 'string' && value.deliveryId
      ? { deliveryId: value.deliveryId }
      : {}),
    ...(typeof value.locationId === 'string' && value.locationId
      ? { locationId: value.locationId }
      : {}),
    ...(typeof value.deliveredAt === 'string'
      ? { deliveredAt: value.deliveredAt }
      : {}),
    ...(typeof value.etaText === 'string' ? { etaText: value.etaText } : {}),
    ...(typeof value.legDistanceText === 'string'
      ? { legDistanceText: value.legDistanceText }
      : {}),
  };
}

function normalizePath(value: any): { lat: number; lng: number }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point) => isFiniteNumber(point?.lat) && isFiniteNumber(point?.lng))
    .map((point) => ({ lat: point.lat, lng: point.lng }));
}

function normalizeStatus(value: any): RouteStatus {
  if (value === 'active' || value === 'completed') return value;
  return 'draft';
}

export function normalizeRoute(value: any): SavedRoute | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id !== 'string') return null;

  const stops = Array.isArray(value.stops)
    ? (value.stops
        .map((stop: any, index: number) => normalizeStop(stop, index))
        .filter(Boolean) as RouteStop[])
    : [];
  const now = Date.now();

  return {
    id: value.id,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : 'Untitled route',
    stops,
    start: normalizeLocation(value.start),
    end: normalizeLocation(value.end),
    optimized: value.optimized === true,
    path: normalizePath(value.path),
    distanceText:
      typeof value.distanceText === 'string' ? value.distanceText : '',
    durationText:
      typeof value.durationText === 'string' ? value.durationText : '',
    approximate: value.approximate === true,
    status: normalizeStatus(value.status),
    assignee:
      value.assignee &&
      typeof value.assignee.workerId === 'string' &&
      typeof value.assignee.name === 'string'
        ? { workerId: value.assignee.workerId, name: value.assignee.name }
        : null,
    createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : now,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : now,
    ...(isFiniteNumber(value.startedAt) ? { startedAt: value.startedAt } : {}),
    ...(isFiniteNumber(value.completedAt)
      ? { completedAt: value.completedAt }
      : {}),
  };
}

/** Restores saved routes. Falls back to importing the old single-route key. */
export async function loadRouteState(): Promise<RouteState> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const routes = Array.isArray(parsed?.routes)
        ? (parsed.routes
            .map((route: any) => normalizeRoute(route))
            .filter(Boolean) as SavedRoute[])
        : [];
      const activeId =
        typeof parsed?.activeId === 'string' &&
        routes.some((route) => route.id === parsed.activeId)
          ? parsed.activeId
          : routes[0]?.id || null;
      return { routes, activeId };
    }
  } catch {
    // Corrupt storage is treated as empty; the UI will create a fresh route.
  }

  // Migrate the single-route payload used by the first version of the tab.
  try {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      const route = createRoute('My route');
      route.stops = Array.isArray(legacy?.stops)
        ? (legacy.stops
            .map((stop: any, index: number) => normalizeStop(stop, index))
            .filter(Boolean) as RouteStop[])
        : [];
      route.start = normalizeLocation(legacy?.start);
      route.end = normalizeLocation(legacy?.end);
      route.optimized = legacy?.optimized === true;
      route.path = normalizePath(legacy?.path);
      route.distanceText =
        typeof legacy?.distanceText === 'string' ? legacy.distanceText : '';
      route.durationText =
        typeof legacy?.durationText === 'string' ? legacy.durationText : '';
      route.approximate = legacy?.approximate === true;
      const state = { routes: [route], activeId: route.id };
      await saveRouteState(state);
      return state;
    }
  } catch {
    // Ignore legacy data that cannot be parsed.
  }

  return { routes: [], activeId: null };
}

export async function saveRouteState(state: RouteState): Promise<void> {
  try {
    const payload: RouteState = {
      routes: state.routes,
      activeId:
        state.activeId &&
        state.routes.some((route) => route.id === state.activeId)
          ? state.activeId
          : state.routes[0]?.id || null,
    };
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best-effort. The in-memory route still works.
  }
}

export function routeDeliveredCount(route: SavedRoute): number {
  return route.stops.filter((stop) => stop.delivered).length;
}

export function routeProgress(route: SavedRoute): number {
  if (route.stops.length === 0) return 0;
  return Math.round((routeDeliveredCount(route) / route.stops.length) * 100);
}

/** Plain-text summary used by Share and Copy. */
export function routeShareText(route: SavedRoute): string {
  const delivered = routeDeliveredCount(route);
  const lines: string[] = [];
  lines.push(route.name);
  if (route.assignee?.name) lines.push(`Assigned to: ${route.assignee.name}`);
  lines.push(
    `${route.stops.length} stop${route.stops.length === 1 ? '' : 's'} · ${delivered} delivered`
  );
  if (route.distanceText || route.durationText) {
    lines.push(
      [route.distanceText, route.durationText].filter(Boolean).join(' · ')
    );
  }
  if (route.start?.address) lines.push(`Start: ${route.start.address}`);
  lines.push('');
  route.stops.forEach((stop, index) => {
    const status = stop.delivered ? '[x]' : '[ ]';
    lines.push(`${index + 1}. ${status} ${stop.address}`);
    const contact = [stop.contactName, stop.phone].filter(Boolean).join(' · ');
    if (contact) lines.push(`   Contact: ${contact}`);
    if (stop.orderCount) lines.push(`   Orders: ${stop.orderCount}`);
    if (stop.note) lines.push(`   Note: ${stop.note}`);
  });
  if (route.end?.address && route.end.address !== route.start?.address) {
    lines.push('');
    lines.push(`End: ${route.end.address}`);
  }
  return lines.join('\n');
}
