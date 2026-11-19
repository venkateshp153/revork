import * as Location from 'expo-location';

export interface ProofCheckIn {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt: number;
  /** Present so the value can be passed to route distance helpers. */
  address: string;
}

const TIMEOUT_MS = 8000;

/**
 * Lightweight GPS read used for delivery proof. Unlike the route helper this
 * does not reverse-geocode, so it returns quickly and works from a modal.
 */
export async function getProofCheckIn(): Promise<ProofCheckIn | null> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (!permission.granted) return null;
    if (!(await Location.hasServicesEnabledAsync())) return null;

    const position = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TIMEOUT_MS)
      ),
    ]);
    if (!position) return null;

    const accuracy = position.coords.accuracy;
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      ...(typeof accuracy === 'number' && Number.isFinite(accuracy)
        ? { accuracy }
        : {}),
      capturedAt: Date.now(),
      address: 'Current location',
    };
  } catch {
    return null;
  }
}

export function formatGps(checkIn?: ProofCheckIn | null): string {
  if (!checkIn) return '';
  return `${checkIn.lat.toFixed(5)}, ${checkIn.lng.toFixed(5)}`;
}
