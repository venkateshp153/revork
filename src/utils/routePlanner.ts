import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

/**
 * Maps key. Prefer a dedicated Maps-only key so restrictions for the Sheets /
 * Firebase key do not block Places and Routes.
 */
const API_KEY =
  process.env.EXPO_PUBLIC_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_API_KEY ||
  '';

export interface RouteLocation {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

export interface RouteStop extends RouteLocation {
  id: string;
  note: string;
  delivered: boolean;
  /** Person receiving the delivery, used for the proof photo file name. */
  contactName?: string;
  /** Phone number of the person receiving the delivery. */
  phone?: string;
  /** Number of orders delivered to this stop. */
  orderCount?: number;
  /** Audit-log id written to the Deliveries sheet when completed. */
  deliveryId?: string;
  /** ID of the shared DeliveryLocations row this stop was loaded from. */
  locationId?: string;
  /** ISO timestamp set when the stop is marked delivered. */
  deliveredAt?: string;
  /** Cumulative ETA text from the start of the optimized route. */
  etaText?: string;
  /** Distance of the leg that arrives at this stop. */
  legDistanceText?: string;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  /** Present for OpenStreetMap fallback results, so no details call is needed. */
  lat?: number;
  lng?: number;
  provider?: 'google' | 'osm';
}

/**
 * Turns a raw Google Maps error into something a user can act on. API key
 * restrictions are a Google Cloud configuration issue, so the message points
 * to the exact APIs that need to be allowed instead of showing a raw 403.
 */
export function describeGoogleMapsError(error: any): string {
  const raw =
    typeof error === 'string'
      ? error
      : typeof error?.message === 'string'
      ? error.message
      : '';
  const lower = raw.toLowerCase();

  if (
    lower.includes('are blocked') ||
    lower.includes('api_key_service_blocked') ||
    lower.includes('permission denied') ||
    lower.includes('permission_denied') ||
    lower.includes('access_denied') ||
    lower.includes('access denied') ||
    lower.includes('not authorized') ||
    lower.includes('has not been used in project') ||
    lower.includes('is disabled') ||
    lower.includes('service_disabled')
  ) {
    return (
      'Google Maps is not enabled for this app’s API key. In Google Cloud Console, ' +
      'enable “Places API (New)” and “Routes API”, then edit the API key used by ' +
      'EXPO_PUBLIC_MAPS_API_KEY (or EXPO_PUBLIC_API_KEY) and allow both APIs under ' +
      '“API restrictions”.'
    );
  }

  return raw || 'Google Maps request failed. Check your connection and API key.';
}

/** OpenStreetMap/Photon fallback used when the Google key is blocked or offline. */
async function searchOpenStreetMap(
  query: string,
  language = 'en'
): Promise<PlaceSuggestion[]> {
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}` +
    `&limit=6&lang=${encodeURIComponent(language)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`OpenStreetMap search returned ${response.status}.`);
  }
  const data = await response.json().catch(() => null);
  const features: any[] = Array.isArray(data?.features) ? data.features : [];

  const unique = new Set<string>();
  return features
    .map((feature: any, index: number) => {
      const coords = feature?.geometry?.coordinates;
      const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
      const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const properties = feature?.properties || {};
      const streetLine = [properties.housenumber, properties.street]
        .filter(Boolean)
        .join(' ')
        .trim();
      const mainText =
        properties.name || streetLine || properties.city || 'Location';
      const secondaryParts = [
        mainText === streetLine ? '' : streetLine,
        properties.city,
        properties.state,
        properties.postcode,
        properties.country,
      ].filter(Boolean);
      const descriptionParts = [
        properties.name,
        streetLine !== properties.name ? streetLine : '',
        properties.city,
        properties.state,
        properties.postcode,
        properties.country,
      ].filter(Boolean);
      const description = Array.from(new Set(descriptionParts)).join(', ');
      const placeId = `osm:${properties.osm_type || 'node'}:${
        properties.osm_id || index
      }:${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (unique.has(placeId)) return null;
      unique.add(placeId);

      return {
        placeId,
        description: description || mainText,
        mainText,
        secondaryText: Array.from(new Set(secondaryParts)).join(', '),
        lat,
        lng,
        provider: 'osm' as const,
      };
    })
    .filter(Boolean) as PlaceSuggestion[];
}

function assertKey(): string {
  if (!API_KEY) {
    throw new Error(
      'Missing EXPO_PUBLIC_MAPS_API_KEY (or EXPO_PUBLIC_API_KEY).'
    );
  }
  return API_KEY;
}

/**
 * JSON helper for the current Google Maps Platform APIs (Places API (New) and
 * Routes API). These APIs use `X-Goog-*` headers instead of URL parameters and
 * return structured `{ error: { message, status } }` payloads.
 */
async function googleApiJson(
  url: string,
  init: RequestInit,
  label: string
): Promise<any> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error_message ||
      `Google API returned ${response.status}.`;
    const error = new Error(`${label}: ${message}`);
    (error as any).status = response.status;
    (error as any).reason = data?.error?.status || data?.status || '';
    throw error;
  }
  return data;
}

/** Google Places API (New) autocomplete suggestions for an address query. */
export async function searchPlaces(
  input: string,
  language = 'en'
): Promise<PlaceSuggestion[]> {
  const query = input.trim();
  if (query.length < 3) return [];

  try {
    const key = assertKey();
    const data = await googleApiJson(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'suggestions.placePrediction.placeId,' +
            'suggestions.placePrediction.text.text,' +
            'suggestions.placePrediction.structuredFormat.mainText.text,' +
            'suggestions.placePrediction.structuredFormat.secondaryText.text',
        },
        body: JSON.stringify({ input: query, languageCode: language }),
      },
      'Places Autocomplete'
    );

    return (data?.suggestions || [])
      .map((suggestion: any) => suggestion?.placePrediction)
      .filter(Boolean)
      .map((prediction: any) => {
        const mainText =
          prediction.structuredFormat?.mainText?.text ||
          prediction.text?.text ||
          '';
        const secondaryText =
          prediction.structuredFormat?.secondaryText?.text || '';
        return {
          placeId: prediction.placeId || '',
          description:
            prediction.text?.text ||
            [mainText, secondaryText].filter(Boolean).join(', '),
          mainText,
          secondaryText,
          provider: 'google' as const,
        };
      })
      .filter((suggestion: PlaceSuggestion) => !!suggestion.placeId);
  } catch (googleError: any) {
    // A blocked/disabled key must not kill address search. OpenStreetMap keeps
    // the route planner usable while the admin fixes the Google Cloud setup.
    try {
      const fallback = await searchOpenStreetMap(query, language);
      if (fallback.length > 0) return fallback;
    } catch (fallbackError) {
      console.warn('[Route] OpenStreetMap fallback failed:', fallbackError);
    }
    console.warn('[Route] Google address search failed:', googleError?.message);
    throw new Error(describeGoogleMapsError(googleError));
  }
}

/** Resolves a place id to coordinates + formatted address using Places API (New). */
export async function getPlaceDetails(placeId: string): Promise<RouteLocation> {
  const key = assertKey();
  const data = await googleApiJson(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
      },
    },
    'Place details'
  );

  const lat = data?.location?.latitude;
  const lng = data?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('Could not resolve this address.');
  }
  return {
    address:
      data?.formattedAddress ||
      data?.displayName?.text ||
      data?.displayName ||
      'Selected location',
    lat,
    lng,
    placeId: data?.id || placeId,
  };
}

/**
 * Accepts "12.9716, 77.5946" or "12.9716 77.5946" and returns a location.
 * Useful when the Places API is unavailable or a user only has coordinates.
 */
export function parseCoordinates(input: string): RouteLocation | null {
  const match = input
    .trim()
    .match(/^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  return {
    address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    lat,
    lng,
  };
}

/**
 * Resolves free text to a location. Coordinates are handled locally; anything
 * else uses Places API (New) Text Search. This is the manual-add fallback used
 * when autocomplete cannot be used.
 */
export async function geocodeAddress(address: string): Promise<RouteLocation> {
  const query = address.trim();
  if (!query) throw new Error('Enter an address or coordinates.');

  const parsed = parseCoordinates(query);
  if (parsed) return parsed;

  try {
    const key = assertKey();
    const data = await googleApiJson(
      'https://places.googleapis.com/v1/places:searchText',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'en',
          pageSize: 1,
        }),
      },
      'Places Text Search'
    );

    const place = data?.places?.[0];
    const lat = place?.location?.latitude;
    const lng = place?.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new Error('Could not find that address. Try a more specific one.');
    }
    return {
      address:
        place?.formattedAddress ||
        place?.displayName?.text ||
        place?.displayName ||
        query,
      lat,
      lng,
      placeId: place?.id,
    };
  } catch (googleError: any) {
    try {
      const fallback = await searchOpenStreetMap(query, 'en');
      const first = fallback[0];
      if (first && typeof first.lat === 'number' && typeof first.lng === 'number') {
        return {
          address: first.description || first.mainText || query,
          lat: first.lat,
          lng: first.lng,
          placeId: first.placeId,
        };
      }
    } catch (fallbackError) {
      console.warn('[Route] OpenStreetMap geocode fallback failed:', fallbackError);
    }
    console.warn('[Route] Google geocode failed:', googleError?.message);
    throw new Error(describeGoogleMapsError(googleError));
  }
}

/** Current device location, with a friendly reverse-geocoded address. */
export async function getCurrentLocation(): Promise<RouteLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Location permission is required.');
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const { latitude, longitude } = position.coords;
  let address = 'Current location';
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude,
      longitude,
    });
    if (place) {
      address =
        place.formattedAddress ||
        [place.name, place.street, place.city, place.region]
          .filter(Boolean)
          .join(', ') ||
        address;
    }
  } catch {
    // reverse geocoding is optional
  }
  return { address, lat: latitude, lng: longitude };
}

export async function isLocationEnabled(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return false;
  }
}

export async function requestLocationAccess(): Promise<boolean> {
  const permission = await Location.requestForegroundPermissionsAsync();
  return permission.granted;
}

export async function openLocationSettings(): Promise<void> {
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    await Linking.openSettings();
  }
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceMeters(a: RouteLocation, b: RouteLocation): number {
  const earth = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

/** Nearest-neighbour ordering used when the Routes API is unavailable. */
export function nearestNeighbourOrder(
  start: RouteLocation,
  stops: RouteStop[]
): RouteStop[] {
  const remaining = [...stops];
  const ordered: RouteStop[] = [];
  let current: RouteLocation = start;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      const distance = distanceMeters(current, stop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

export function straightPath(
  start: RouteLocation,
  stops: RouteStop[],
  end?: RouteLocation | null
): { lat: number; lng: number }[] {
  return [
    { lat: start.lat, lng: start.lng },
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ...(end ? [{ lat: end.lat, lng: end.lng }] : []),
  ];
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

/** Encoded Google polyline → coordinate list. */
export function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  if (!encoded) return [];
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

export interface RouteLegInfo {
  distanceMeters: number;
  distanceText: string;
  durationSeconds: number;
  durationText: string;
}

export interface OptimizedRoute {
  stops: RouteStop[];
  path: { lat: number; lng: number }[];
  distanceText?: string;
  durationText?: string;
  /** One entry per stop: the leg that arrives at that stop. */
  legs: RouteLegInfo[];
  /** The final leg from the last stop to the end location. */
  endLeg?: RouteLegInfo;
  approximate: boolean;
  /** Which service produced the order and road geometry. */
  provider?: 'google' | 'osrm' | 'local';
  /** Why live road routing could not be used, when `approximate` is true. */
  errorMessage?: string;
}

/** Rough city-driving speed used when the Routes API is unavailable. */
const APPROX_METERS_PER_SECOND = 8.33;

/** Routes API durations look like "1234s"; legacy legs used numbers. */
function parseDurationSeconds(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/i);
  return match ? Number(match[1]) : null;
}

function estimateSeconds(meters: number): number {
  return Math.max(30, Math.round(meters / APPROX_METERS_PER_SECOND));
}

function computeLeg(from: RouteLocation, to: RouteLocation): RouteLegInfo {
  const meters = distanceMeters(from, to);
  const seconds = estimateSeconds(meters);
  return {
    distanceMeters: meters,
    distanceText: formatDistance(meters),
    durationSeconds: seconds,
    durationText: formatDuration(seconds),
  };
}

/** Converts a Routes API leg (or a legacy Directions leg) into display data. */
function googleLegToInfo(leg: any): RouteLegInfo | null {
  if (!leg) return null;
  const distance =
    typeof leg?.distanceMeters === 'number'
      ? leg.distanceMeters
      : leg?.distance?.value;
  const duration =
    parseDurationSeconds(leg?.duration) ?? leg?.duration?.value ?? null;
  if (typeof distance !== 'number' && typeof duration !== 'number') return null;
  const meters = typeof distance === 'number' ? distance : 0;
  const seconds =
    typeof duration === 'number' ? duration : estimateSeconds(meters);
  return {
    distanceMeters: meters,
    distanceText:
      leg?.distance?.text || leg?.distanceMetersText || formatDistance(meters),
    durationSeconds: seconds,
    durationText: leg?.duration?.text || formatDuration(seconds),
  };
}

/**
 * Public OSRM demo server. It provides real road routing and trip optimization
 * without a Google key. Override it with EXPO_PUBLIC_OSRM_URL for production.
 */
const OSRM_BASE = (
  process.env.EXPO_PUBLIC_OSRM_URL || 'https://router.project-osrm.org'
).replace(/\/+$/, '');
const OSRM_TIMEOUT_MS = 12000;
/** The public OSRM server accepts at most 100 coordinates per trip. */
const OSRM_MAX_POINTS = 100;

function toOsrmCoordinate(location: RouteLocation): string {
  return `${location.lng.toFixed(6)},${location.lat.toFixed(6)}`;
}

async function fetchOsrmJson(path: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const response = await fetch(`${OSRM_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Road routing service returned ${response.status}.`);
    }
    return await response.json();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Road routing service timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function osrmLegToInfo(leg: any): RouteLegInfo | null {
  if (!leg) return null;
  const distance =
    typeof leg?.distance === 'number' ? leg.distance : leg?.distanceMeters;
  const duration =
    typeof leg?.duration === 'number'
      ? leg.duration
      : parseDurationSeconds(leg?.duration);
  if (typeof distance !== 'number' && typeof duration !== 'number') return null;
  const meters = typeof distance === 'number' ? distance : 0;
  const seconds =
    typeof duration === 'number' ? duration : estimateSeconds(meters);
  return {
    distanceMeters: meters,
    distanceText: formatDistance(meters),
    durationSeconds: seconds,
    durationText: formatDuration(seconds),
  };
}

/** GeoJSON `[lng, lat]` pairs from OSRM → `{ lat, lng }` points. */
function osrmGeometryToPath(geometry: any): { lat: number; lng: number }[] {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  return coordinates
    .map((pair: any) =>
      Array.isArray(pair) && pair.length >= 2
        ? { lat: Number(pair[1]), lng: Number(pair[0]) }
        : null
    )
    .filter(
      (point: any): point is { lat: number; lng: number } =>
        !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    );
}

/** Local fallback: distance-sorted stops joined by straight lines. */
function buildApproximateRoute(
  start: RouteLocation,
  end: RouteLocation,
  stops: RouteStop[],
  errorMessage?: string
): OptimizedRoute {
  const ordered = nearestNeighbourOrder(start, stops);
  const legs = ordered.map((stop, index) =>
    computeLeg(index === 0 ? start : ordered[index - 1], stop)
  );
  const lastStop = ordered[ordered.length - 1];
  const endLeg = lastStop ? computeLeg(lastStop, end) : undefined;
  const totalDistance =
    legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) +
    (endLeg?.distanceMeters || 0);
  const totalDuration =
    legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) +
    (endLeg?.durationSeconds || 0);
  return {
    stops: ordered,
    path: straightPath(start, ordered, end),
    distanceText: formatDistance(totalDistance),
    durationText: formatDuration(totalDuration),
    legs,
    endLeg,
    approximate: true,
    provider: 'local',
    errorMessage,
  };
}

/**
 * Google Routes API path. Supports at most 25 intermediate waypoints and
 * returns the optimized order, road geometry and per-leg distance/duration.
 */
async function optimizeRouteWithGoogle(
  start: RouteLocation,
  end: RouteLocation,
  stops: RouteStop[]
): Promise<OptimizedRoute> {
  const key = assertKey();
  const data = await googleApiJson(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'routes.optimizedIntermediateWaypointIndex,' +
          'routes.distanceMeters,' +
          'routes.duration,' +
          'routes.polyline.encodedPolyline,' +
          'routes.legs.distanceMeters,' +
          'routes.legs.duration',
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: { latitude: start.lat, longitude: start.lng },
          },
        },
        destination: {
          location: {
            latLng: { latitude: end.lat, longitude: end.lng },
          },
        },
        intermediates: stops.map((stop) => ({
          location: {
            latLng: { latitude: stop.lat, longitude: stop.lng },
          },
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        optimizeWaypointOrder: true,
        languageCode: 'en-US',
        units: 'METRIC',
      }),
    },
    'Routes API'
  );

  const route = data?.routes?.[0];
  if (!route) throw new Error('No route found.');

  const order: number[] = Array.isArray(
    route.optimizedIntermediateWaypointIndex
  )
    ? route.optimizedIntermediateWaypointIndex
    : [];
  const orderMatches = order.length === stops.length;
  const ordered = orderMatches
    ? order.map((index) => stops[index])
    : nearestNeighbourOrder(start, stops);
  const path = decodePolyline(route.polyline?.encodedPolyline || '');
  const rawLegs: any[] = Array.isArray(route.legs) ? route.legs : [];

  const legs = ordered.map((_, index) => {
    const apiLeg = orderMatches ? googleLegToInfo(rawLegs[index]) : null;
    if (apiLeg) return apiLeg;
    const from = index === 0 ? start : ordered[index - 1];
    return computeLeg(from, ordered[index]);
  });

  const lastStop = ordered[ordered.length - 1];
  const endLeg =
    (orderMatches && googleLegToInfo(rawLegs[ordered.length])) ||
    (lastStop ? computeLeg(lastStop, end) : undefined);

  const rawDistance =
    typeof route.distanceMeters === 'number'
      ? route.distanceMeters
      : rawLegs.reduce(
          (sum: number, leg: any) => sum + (leg?.distanceMeters || 0),
          0
        );
  const rawDuration =
    parseDurationSeconds(route.duration) ??
    rawLegs.reduce(
      (sum: number, leg: any) =>
        sum + (parseDurationSeconds(leg?.duration) || 0),
      0
    );
  const computedDistance =
    legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) +
    (endLeg?.distanceMeters || 0);
  const computedDuration =
    legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) +
    (endLeg?.durationSeconds || 0);
  const totalDistance = rawDistance || computedDistance;
  const totalDuration = rawDuration || computedDuration;

  return {
    stops: ordered,
    path: path.length > 0 ? path : straightPath(start, ordered, end),
    distanceText: totalDistance > 0 ? formatDistance(totalDistance) : undefined,
    durationText: totalDuration > 0 ? formatDuration(totalDuration) : undefined,
    legs,
    endLeg,
    approximate: false,
    provider: 'google',
  };
}

/**
 * OSRM trip service: computes a road-following order and geometry without a
 * Google key. It also handles routes longer than the Routes API's 25-stop
 * limit, so the app no longer falls back to distance sorting.
 */
async function optimizeRouteWithOsrm(
  start: RouteLocation,
  end: RouteLocation,
  stops: RouteStop[]
): Promise<OptimizedRoute> {
  const roundTrip = distanceMeters(start, end) < 40;
  const points = [
    start,
    ...stops,
    ...(roundTrip ? [start] : [end]),
  ];
  if (points.length > OSRM_MAX_POINTS) {
    throw new Error(
      `Road routing supports up to ${OSRM_MAX_POINTS - 2} stops per route.`
    );
  }

  const coordinates = points.map(toOsrmCoordinate).join(';');
  const data = await fetchOsrmJson(
    `/trip/v1/driving/${coordinates}` +
      '?roundtrip=false&source=first&destination=last' +
      '&geometries=geojson&overview=full&steps=false'
  );

  if (data?.code !== 'Ok') {
    throw new Error(data?.message || 'Road routing failed.');
  }
  const trip = data?.trips?.[0];
  const waypoints: any[] = Array.isArray(data?.waypoints) ? data.waypoints : [];
  if (!trip || waypoints.length !== points.length) {
    throw new Error('Road routing returned an unexpected response.');
  }

  // `waypoint_index` is each input point's position in the optimized trip.
  const stopPositions = stops
    .map((stop, index) => {
      const raw = waypoints[index + 1]?.waypoint_index;
      const position = typeof raw === 'number' && raw > 0 ? raw : index + 1;
      return { index, position };
    })
    .sort((a, b) => a.position - b.position);
  const ordered = stopPositions.map(({ index }) => stops[index]);

  const rawLegs: any[] = Array.isArray(trip.legs) ? trip.legs : [];
  const legs = stopPositions.map(({ position }, orderIndex) => {
    const apiLeg = osrmLegToInfo(rawLegs[position - 1]);
    if (apiLeg) return apiLeg;
    const from = orderIndex === 0 ? start : ordered[orderIndex - 1];
    return computeLeg(from, ordered[orderIndex]);
  });

  const lastStop = ordered[ordered.length - 1];
  const endLeg =
    osrmLegToInfo(rawLegs[ordered.length]) ||
    (lastStop ? computeLeg(lastStop, end) : undefined);

  const totalDistance =
    typeof trip.distance === 'number'
      ? trip.distance
      : legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) +
        (endLeg?.distanceMeters || 0);
  const totalDuration =
    typeof trip.duration === 'number'
      ? trip.duration
      : legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) +
        (endLeg?.durationSeconds || 0);
  const path = osrmGeometryToPath(trip.geometry);

  return {
    stops: ordered,
    path: path.length > 0 ? path : straightPath(start, ordered, end),
    distanceText: totalDistance > 0 ? formatDistance(totalDistance) : undefined,
    durationText: totalDuration > 0 ? formatDuration(totalDuration) : undefined,
    legs,
    endLeg,
    approximate: false,
    provider: 'osrm',
  };
}

/**
 * Optimizes stops for the best driving order. Google Routes is tried first;
 * if it is unavailable (blocked key, offline, or more than 25 stops), OSRM
 * provides real road routing. Only if both fail do we use distance sorting.
 * The returned `legs` let the UI show a distance/ETA for every stop.
 */
export async function optimizeRoute(params: {
  start: RouteLocation;
  end: RouteLocation;
  stops: RouteStop[];
}): Promise<OptimizedRoute> {
  const { start, end, stops } = params;
  if (stops.length === 0) {
    throw new Error('Add at least one stop first.');
  }

  let googleError: any = null;
  if (stops.length <= 25) {
    try {
      return await optimizeRouteWithGoogle(start, end, stops);
    } catch (error) {
      googleError = error;
    }
  } else {
    googleError = new Error(
      'The Routes API handles up to 25 stops; used the road-routing fallback.'
    );
  }

  try {
    return await optimizeRouteWithOsrm(start, end, stops);
  } catch (osrmError: any) {
    const googleMessage = googleError
      ? describeGoogleMapsError(googleError)
      : '';
    const osrmMessage =
      osrmError?.message || 'The road-routing service is unavailable.';
    return buildApproximateRoute(
      start,
      end,
      stops,
      [googleMessage, osrmMessage].filter(Boolean).join(' ')
    );
  }
}

export function openInGoogleMaps(location: RouteLocation): void {
  const appUrl = `comgooglemaps://?q=${location.lat},${location.lng}`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
  if (Platform.OS === 'web') {
    void Linking.openURL(webUrl).catch(() => {});
    return;
  }
  Linking.openURL(appUrl).catch(() => {
    void Linking.openURL(webUrl).catch(() => {});
  });
}

/** Builds a Google Maps directions URL (max 9 waypoints, a Maps web limit). */
export function googleMapsDirectionsUrl(params: {
  origin?: RouteLocation | null;
  destination: RouteLocation;
  waypoints?: RouteLocation[];
}): string {
  const parts = [
    'https://www.google.com/maps/dir/?api=1',
    `destination=${params.destination.lat},${params.destination.lng}`,
    'travelmode=driving',
  ];
  if (params.origin) {
    parts.push(`origin=${params.origin.lat},${params.origin.lng}`);
  }
  const waypoints = (params.waypoints || []).slice(0, 9);
  if (waypoints.length > 0) {
    parts.push(
      `waypoints=${waypoints
        .map((point) => `${point.lat},${point.lng}`)
        .join('|')}`
    );
  }
  return parts.join('&');
}

/** Opens turn-by-turn directions in Google Maps (app first, web fallback). */
export async function openDirectionsTo(
  destination: RouteLocation,
  origin?: RouteLocation | null
): Promise<void> {
  if (Platform.OS !== 'web') {
    const appUrl =
      `comgooglemaps://?daddr=${destination.lat},${destination.lng}` +
      '&directionsmode=driving' +
      (origin ? `&saddr=${origin.lat},${origin.lng}` : '');
    try {
      await Linking.openURL(appUrl);
      return;
    } catch {
      // Google Maps is not installed; open the web directions below.
    }
  }
  await Linking.openURL(googleMapsDirectionsUrl({ destination, origin }));
}

/**
 * Opens the whole route in Google Maps. The origin falls back to the device's
 * current position and the destination to the last stop.
 */
export async function openFullRouteInGoogleMaps(params: {
  start?: RouteLocation | null;
  end?: RouteLocation | null;
  stops: RouteStop[];
}): Promise<void> {
  const { start, end, stops } = params;
  const destination = end || stops[stops.length - 1];
  if (!destination) throw new Error('Add at least one stop first.');

  const waypoints = stops.filter((stop) => {
    if (distanceMeters(stop, destination) < 40) return false;
    if (start && distanceMeters(stop, start) < 40) return false;
    return true;
  });

  await Linking.openURL(
    googleMapsDirectionsUrl({ origin: start || null, destination, waypoints })
  );
}
