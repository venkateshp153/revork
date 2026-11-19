import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ImagePickerAsset } from 'expo-image-picker';

/**
 * Camera list scanner for admins.
 *
 * The admin photographs a paper/printed delivery list. The image is sent to
 * Google Cloud Vision (OCR) and the recognised lines are turned into address
 * candidates that can be reviewed before they are added to the shared list.
 *
 * The key is optional: when no Vision key is configured the screen still works
 * because addresses can always be typed or pasted manually.
 */

const VISION_KEY =
  process.env.EXPO_PUBLIC_VISION_API_KEY ||
  process.env.EXPO_PUBLIC_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_API_KEY ||
  '';

export type ScanSource = 'camera' | 'library';

/** True when a Cloud Vision key is available for OCR. */
export function isAddressScannerConfigured(): boolean {
  return !!VISION_KEY;
}

/**
 * True when the installed native build actually contains expo-image-picker.
 * A JS bundle can be newer than the APK/dev-client, which otherwise fails with
 * "Cannot find native module 'ExponentImagePicker'".
 */
export function isAddressScannerNativeReady(): boolean {
  try {
    return !!requireOptionalNativeModule('ExponentImagePicker');
  } catch {
    return false;
  }
}

async function loadImagePicker() {
  if (!isAddressScannerNativeReady()) {
    throw new Error(
      'Camera support is missing from this installed app build. Rebuild the app with “npx expo run:android” (or install a new development build), then try again. You can add addresses manually in the meantime.'
    );
  }
  return import('expo-image-picker');
}

async function pickImage(source: ScanSource): Promise<ImagePickerAsset | null> {
  const ImagePicker = await loadImagePicker();

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error(
        'Camera access is off. Allow camera permission in Settings to scan the address list.'
      );
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
      cameraType: ImagePicker.CameraType.back,
      allowsEditing: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    return asset || null;
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Photo access is off. Allow gallery permission in Settings to scan an address list.'
    );
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    base64: true,
    allowsMultipleSelection: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset || null;
}

export async function captureAddressList(): Promise<ImagePickerAsset | null> {
  return pickImage('camera');
}

export async function pickAddressListImage(): Promise<ImagePickerAsset | null> {
  return pickImage('library');
}

const STREET_WORDS =
  /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd|suite|floor|flat|apt|apartment|block|sector|nagar|colony|cross|main|market|plaza|tower|building|complex|near|opposite|opp|post|p\.?o\.?|district|city|village|house|plot|shop|church|school|hospital|mall)\b/i;

const IGNORE_LINE =
  /^(sr\.?|sl\.?|s\.?no|no\.|#|invoice|bill|order|total|date|phone|mobile|contact|name|address list|delivery list|page)\b/i;

function looksLikeAddress(line: string): boolean {
  if (line.length < 6 || line.length > 180) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if (/^[+\d\s()\-/.,:]+$/.test(line)) return false;
  if (IGNORE_LINE.test(line) && line.length < 24) return false;
  return (
    /\d/.test(line) ||
    line.includes(',') ||
    STREET_WORDS.test(line) ||
    line.split(/\s+/).length >= 3
  );
}

/** Cleans OCR output and keeps lines that look like postal addresses. */
export function parseAddressLines(text: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const push = (value: string) => {
    const line = value
      .replace(/[•·]/g, ' ')
      .replace(/\s+/g, ' ')
      // Drop common list numbering: "1.", "2)", "- ".
      .replace(/^(\d{1,3}[.)]|[-–—*])\s*/, '')
      .trim();
    if (!looksLikeAddress(line)) return;
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(line);
  };

  (text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      // Table rows often come through with pipes or tabs between columns.
      // Keep only the cells that actually look like addresses.
      if (line.includes('|') || line.includes('\t')) {
        const cells = line
          .split(/[|\t]/)
          .map((cell) => cell.trim())
          .filter(Boolean);
        if (cells.length > 1) {
          cells.forEach(push);
          return;
        }
      }
      push(line);
    });

  return results;
}

interface VisionResult {
  text: string;
  addresses: string[];
}

/**
 * Runs OCR on a base64 JPEG/PNG. Throws a message that tells the admin what to
 * fix if Cloud Vision is not enabled for the key.
 */
export async function scanAddressImage(base64: string): Promise<VisionResult> {
  if (!base64) {
    throw new Error('The photo could not be read. Try taking it again.');
  }
  if (!VISION_KEY) {
    throw new Error(
      'Add EXPO_PUBLIC_VISION_API_KEY to .env and restart the app to scan address lists. You can still type or paste the addresses.'
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64 },
              features: [
                { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 },
              ],
            },
          ],
        }),
      }
    );
  } catch {
    throw new Error(
      'Could not reach the text scanner. Check your connection and try again.'
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data?.error?.message || `Text scanner returned ${response.status}.`;
    throw new Error(
      `${message}\n\nEnable the Cloud Vision API for this key in Google Cloud Console, or add the addresses manually.`
    );
  }

  const first = data?.responses?.[0];
  const text =
    first?.fullTextAnnotation?.text ||
    first?.textAnnotations?.[0]?.description ||
    '';

  if (!text.trim()) {
    throw new Error(
      'No text was found in that photo. Move closer, improve the lighting and try again.'
    );
  }

  const addresses = parseAddressLines(text);
  if (addresses.length === 0) {
    throw new Error(
      'The photo had text, but no addresses were recognised. Try a clearer photo or enter them manually.'
    );
  }

  return { text, addresses };
}
