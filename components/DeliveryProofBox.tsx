import React from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { DeliveryPhotoRecord } from '@/src/utils/deliveryPhotos';

interface Props {
  photos: DeliveryPhotoRecord[];
  accent: string;
  busy?: boolean;
  maxPhotos?: number;
  onAddPress: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onRemove: (id: string) => void;
  onPhotoPress?: (photo: DeliveryPhotoRecord) => void;
  onRetry?: () => void;
  retrying?: boolean;
  helperText?: string;
}

function statusMeta(photo: DeliveryPhotoRecord) {
  if (photo.status === 'uploaded') {
    return {
      label: 'Uploaded to Drive',
      color: '#15803D',
      background: '#DCFCE7',
      icon: 'cloud-check-outline',
    };
  }
  if (photo.status === 'uploading') {
    return {
      label: 'Uploading…',
      color: '#1D4ED8',
      background: '#E8F0FE',
      icon: 'cloud-upload-outline',
    };
  }
  if (photo.error) {
    return {
      label: 'Upload failed',
      color: '#B91C1C',
      background: '#FEE2E2',
      icon: 'cloud-alert-outline',
    };
  }
  return {
    label: 'Saved on device',
    color: '#B45309',
    background: '#FEF3C7',
    icon: 'cloud-clock-outline',
  };
}

/**
 * Camera tile + thumbnails for delivery proof. Shared by the stop details
 * panel and the "Mark delivery" sheet so both behave identically.
 */
export default function DeliveryProofBox({
  photos,
  accent,
  busy,
  maxPhotos,
  onAddPress,
  onCamera,
  onGallery,
  onRemove,
  onPhotoPress,
  onRetry,
  retrying,
  helperText,
}: Props) {
  const limit = Math.max(1, maxPhotos ?? 2);
  const atLimit = photos.length >= limit;
  const hasPending = photos.some((photo) => photo.status !== 'uploaded');

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[
          styles.addBox,
          { borderColor: atLimit ? '#CBD5E1' : accent },
          atLimit && styles.addBoxDisabled,
        ]}
        onPress={onAddPress}
        disabled={atLimit || busy}
        activeOpacity={0.85}
      >
        <View style={[styles.cameraCircle, { backgroundColor: `${accent}18` }]}>
          {busy ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <MaterialCommunityIcons
              name="camera-plus-outline"
              size={25}
              color={accent}
            />
          )}
        </View>
        <View style={styles.addTextWrap}>
          <Text style={styles.addTitle}>
            {atLimit
              ? `${limit} proof photo${limit === 1 ? '' : 's'} attached`
              : 'Add proof of delivery'}
          </Text>
          <Text style={styles.addSubtitle}>
            {atLimit
              ? 'Remove one to replace it.'
              : helperText ||
                `Take a photo or choose from the gallery · max ${limit}`}
          </Text>
        </View>
        {!atLimit && (
          <MaterialCommunityIcons
            name="chevron-right"
            size={19}
            color="#94A3B8"
          />
        )}
      </TouchableOpacity>

      {!atLimit && (
        <View style={styles.sourceRow}>
          <TouchableOpacity
            style={styles.sourceButton}
            onPress={onCamera}
            disabled={busy}
          >
            <MaterialCommunityIcons name="camera" size={16} color="#334155" />
            <Text style={styles.sourceText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sourceButton}
            onPress={onGallery}
            disabled={busy}
          >
            <MaterialCommunityIcons
              name="image-multiple-outline"
              size={16}
              color="#334155"
            />
            <Text style={styles.sourceText}>Gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      {photos.length > 0 && (
        <View style={styles.photoRow}>
          {photos.map((photo) => {
            const meta = statusMeta(photo);
            return (
              <View key={photo.id} style={styles.photoCard}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onPhotoPress?.(photo)}
                  disabled={!onPhotoPress}
                >
                  <Image source={{ uri: photo.localUri }} style={styles.photo} />
                </TouchableOpacity>
                {photo.status !== 'uploading' && (
                  <TouchableOpacity
                    style={styles.removePhoto}
                    onPress={() => onRemove(photo.id)}
                    accessibilityLabel="Remove proof photo"
                  >
                    <MaterialCommunityIcons
                      name="close"
                      size={13}
                      color="#fff"
                    />
                  </TouchableOpacity>
                )}
                <View
                  style={[
                    styles.photoStatus,
                    { backgroundColor: meta.background },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={meta.icon as any}
                    size={10}
                    color={meta.color}
                  />
                  <Text
                    style={[styles.photoStatusText, { color: meta.color }]}
                    numberOfLines={1}
                  >
                    {meta.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {hasPending && (
        <View style={styles.syncHintRow}>
          <MaterialCommunityIcons
            name="information-outline"
            size={12}
            color="#B45309"
          />
          <Text style={styles.syncHint}>
            {photos.some(
              (photo) => photo.holdUpload && photo.status !== 'uploaded'
            )
              ? 'Saved on this device. It uploads to Google Drive after you save the delivery.'
              : 'Photos are saved on this device first and upload to Google Drive automatically when the internet is available.'}
          </Text>
        </View>
      )}

      {photos.some((photo) => photo.error) && onRetry && (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          disabled={retrying}
        >
          {retrying ? (
            <ActivityIndicator size="small" color="#2563EB" />
          ) : (
            <MaterialCommunityIcons
              name="cloud-refresh-outline"
              size={15}
              color="#2563EB"
            />
          )}
          <Text style={styles.retryText}>
            {retrying ? 'Retrying upload…' : 'Retry upload'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  addBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 13,
    padding: 11,
    backgroundColor: '#F8FAFC',
  },
  addBoxDisabled: { opacity: 0.8, backgroundColor: '#F1F5F9' },
  cameraCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTextWrap: { flex: 1, marginLeft: 10 },
  addTitle: { fontSize: 12.5, fontWeight: '800', color: '#1E293B' },
  addSubtitle: { fontSize: 9.5, color: '#64748B', marginTop: 2, lineHeight: 13 },
  sourceRow: { flexDirection: 'row', marginTop: 7 },
  sourceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginRight: 7,
  },
  sourceText: { fontSize: 10.5, fontWeight: '700', color: '#334155', marginLeft: 5 },
  photoRow: { flexDirection: 'row', marginTop: 9 },
  photoCard: {
    width: 92,
    marginRight: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  photo: { width: 92, height: 92, backgroundColor: '#E2E8F0' },
  removePhoto: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(15,23,42,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  photoStatusText: { fontSize: 7.5, fontWeight: '800', marginLeft: 3, flex: 1 },
  syncHintRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  syncHint: {
    flex: 1,
    fontSize: 9,
    color: '#B45309',
    lineHeight: 13,
    marginLeft: 4,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 7,
    paddingVertical: 3,
  },
  retryText: { fontSize: 10, fontWeight: '800', color: '#2563EB', marginLeft: 4 },
});
