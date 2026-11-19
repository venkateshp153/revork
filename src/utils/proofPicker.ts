import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ImagePickerAsset } from 'expo-image-picker';

export type ProofPhotoSource = 'camera' | 'library';

/**
 * The JS bundle can be newer than the installed native app. Without this guard
 * the picker throws "Cannot find native module 'ExponentImagePicker'" and the
 * camera/photo flow appears to crash.
 */
function assertImagePickerNativeReady(): void {
  let ready = false;
  try {
    ready = !!requireOptionalNativeModule('ExponentImagePicker');
  } catch {
    ready = false;
  }
  if (!ready) {
    throw new Error(
      'Camera and photo support is missing from this installed app build. Rebuild the app with “npx expo run:android” (or install a new development build), then try again.'
    );
  }
}

/**
 * Opens the camera or gallery and returns the picked images. Permission
 * failures are converted into messages that can be shown directly to a driver.
 */
export async function pickProofImages(
  source: ProofPhotoSource,
  limit: number
): Promise<ImagePickerAsset[]> {
  assertImagePickerNativeReady();
  const remaining = Math.max(1, limit);
  const ImagePicker = await import('expo-image-picker');

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error(
        'Camera access is off. Allow camera permission in Settings to take a delivery photo.'
      );
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.65,
      cameraType: ImagePicker.CameraType.back,
      allowsEditing: false,
    });
    if (result.canceled) return [];
    return result.assets.slice(0, remaining);
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Photo access is off. Allow gallery permission in Settings to attach a delivery photo.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.65,
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    orderedSelection: true,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, remaining);
}
