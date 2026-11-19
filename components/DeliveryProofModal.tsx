import React, { useEffect, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DeliveryProofBox from '@/components/DeliveryProofBox';
import { useDeliveryPhotos } from '@/src/hooks/useDeliveryPhotos';
import {
  addDeliveryPhotos,
  releaseDeliveryPhotosForStop,
  removeDeliveryPhoto,
  syncDeliveryPhotos,
  updatePendingPhotoDetails,
  type DeliveryPhotoRecord,
} from '@/src/utils/deliveryPhotos';
import { pickProofImages, type ProofPhotoSource } from '@/src/utils/proofPicker';
import {
  distanceMeters,
  formatDistance,
  type RouteStop,
} from '@/src/utils/routePlanner';
import {
  DEFAULT_COMPANY_SETTINGS,
  type CompanySettings,
} from '@/src/utils/settings';
import {
  formatGps,
  getProofCheckIn,
  type ProofCheckIn,
} from '@/src/utils/proofLocation';

interface SaveDetails {
  contactName: string;
  phone: string;
  orderCount: number;
  lat?: number;
  lng?: number;
  gps?: string;
}

interface Props {
  visible: boolean;
  stop: RouteStop | null;
  routeId: string;
  accent: string;
  settings?: CompanySettings;
  onClose: () => void;
  onSave: (details: SaveDetails) => void;
  onPhotoPress?: (photo: DeliveryPhotoRecord) => void;
}

/**
 * "Mark delivery" sheet: receiver + orders + address, then photo proof.
 *
 * Save unlocks when the workspace proof rule is satisfied (a photo stored on
 * this device). The upload is released on save and synced to Drive in the
 * background, so the flow works offline.
 */
export default function DeliveryProofModal({
  visible,
  stop,
  routeId,
  accent,
  settings = DEFAULT_COMPANY_SETTINGS,
  onClose,
  onSave,
  onPhotoPress,
}: Props) {
  const photos = useDeliveryPhotos(stop?.id);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [orderCount, setOrderCount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [checkIn, setCheckIn] = useState<ProofCheckIn | null>(null);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [geofenceAcknowledged, setGeofenceAcknowledged] = useState(false);

  const maxPhotos = Math.max(1, settings.maxProofPhotos || 2);
  const requireProof = settings.requireProofPhoto !== false;

  const distance =
    checkIn && stop ? distanceMeters(checkIn, stop) : null;
  const outsideGeofence =
    distance !== null &&
    settings.geofenceMeters > 0 &&
    distance > settings.geofenceMeters;

  useEffect(() => {
    if (!visible) return;
    setName(stop?.contactName || '');
    setPhone(stop?.phone || '');
    setOrderCount(
      typeof stop?.orderCount === 'number' && stop.orderCount > 0
        ? `${stop.orderCount}`
        : '1'
    );
    setError('');
    setBusy(false);
    setGeofenceAcknowledged(false);
    setCheckIn(null);
    setCheckingLocation(true);
    let alive = true;
    void getProofCheckIn().then((result) => {
      if (!alive) return;
      setCheckIn(result);
      setCheckingLocation(false);
    });
    return () => {
      alive = false;
    };
  }, [visible, stop?.id, stop?.contactName, stop?.phone, stop?.orderCount]);

  const add = async (source: ProofPhotoSource) => {
    if (!stop) return;
    if (photos.length >= maxPhotos) {
      Alert.alert(
        'Limit reached',
        `You can attach up to ${maxPhotos} photos per stop.`
      );
      return;
    }
    setError('');
    setBusy(true);
    try {
      const assets = await pickProofImages(source, maxPhotos - photos.length);
      if (assets.length === 0) return;
      await addDeliveryPhotos({
        assets,
        routeId,
        stopId: stop.id,
        personName: name,
        address: stop.address,
        phone,
        compress: settings.compressProofPhotos,
        maxPhotos,
        ...(checkIn ? { lat: checkIn.lat, lng: checkIn.lng } : {}),
      });
      // Upload is released when the driver taps Save, so the Drive file name
      // always uses the final customer details.
    } catch (pickError: any) {
      Alert.alert(
        'Could not open camera or gallery',
        pickError?.message ||
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
      setBusy(false);
    }
  };

  const uploadNow = async () => {
    setSyncing(true);
    try {
      await syncDeliveryPhotos();
    } finally {
      setSyncing(false);
    }
  };

  const chooseSource = () => {
    if (photos.length >= maxPhotos) {
      Alert.alert(
        'Limit reached',
        `You can attach up to ${maxPhotos} photos per stop.`
      );
      return;
    }
    Alert.alert(
      'Proof of delivery',
      'Take a new photo or choose one from the gallery.',
      [
        { text: 'Camera', onPress: () => void add('camera') },
        { text: 'Gallery', onPress: () => void add('library') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const confirmRemove = (id: string) => {
    Alert.alert('Remove photo?', 'This proof photo will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void removeDeliveryPhoto(id),
      },
    ]);
  };

  const runSave = async () => {
    if (!stop) return;
    setBusy(true);
    try {
      await updatePendingPhotoDetails(stop.id, {
        personName: name,
        phone,
        address: stop.address,
      });
      await releaseDeliveryPhotosForStop(stop.id);
      onSave({
        contactName: name.trim(),
        phone: phone.trim(),
        orderCount: Math.max(
          0,
          Math.round(parseFloat(orderCount.replace(/[^\d.]/g, '')) || 0)
        ),
        ...(checkIn ? { lat: checkIn.lat, lng: checkIn.lng } : {}),
        ...(checkIn ? { gps: formatGps(checkIn) } : {}),
      });
      void syncDeliveryPhotos();
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (!stop) return;
    if (photos.length === 0 && requireProof) return;

    if (outsideGeofence && distance !== null && !geofenceAcknowledged) {
      Alert.alert(
        'You seem far from this stop',
        `Your GPS is about ${formatDistance(
          distance
        )} from the saved address. Marking delivered here will be flagged in the delivery log.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Deliver anyway',
            style: 'destructive',
            onPress: () => {
              setGeofenceAcknowledged(true);
              void runSave();
            },
          },
        ]
      );
      return;
    }
    void runSave();
  };

  const canSave =
    !!stop && (!requireProof || photos.length > 0) && !busy;
  const allUploaded =
    photos.length > 0 &&
    photos.every((photo) => photo.status === 'uploaded');

  const adjustOrders = (delta: number) => {
    const current = parseInt(orderCount || '0', 10) || 0;
    setOrderCount(`${Math.max(0, current + delta)}`);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <View style={styles.headerIconRow}>
                <View
                  style={[styles.headerIcon, { backgroundColor: `${accent}18` }]}
                >
                  <MaterialCommunityIcons
                    name="package-variant-closed-check"
                    size={18}
                    color={accent}
                  />
                </View>
                <Text style={styles.title}>Mark delivery</Text>
              </View>
              <Text style={styles.subtitle}>
                Add the receiver’s details and a proof photo.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
              <MaterialCommunityIcons name="close" size={22} color="#334155" />
            </TouchableOpacity>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.label}>Person receiving</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Customer name"
              placeholderTextColor="#94A3B8"
              autoCapitalize="words"
            />

            <Text style={[styles.label, { marginTop: 10 }]}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              placeholderTextColor="#94A3B8"
              keyboardType="phone-pad"
            />

            <Text style={[styles.label, { marginTop: 10 }]}>
              Orders delivered
            </Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => adjustOrders(-1)}
              >
                <MaterialCommunityIcons
                  name="minus"
                  size={16}
                  color="#334155"
                />
              </TouchableOpacity>
              <TextInput
                style={styles.stepperInput}
                value={orderCount}
                onChangeText={(text) =>
                  setOrderCount(text.replace(/[^\d]/g, '').slice(0, 4))
                }
                keyboardType="number-pad"
                textAlign="center"
              />
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() => adjustOrders(1)}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#334155" />
              </TouchableOpacity>
              <Text style={styles.stepperHint}>
                Used for the admin’s order totals
              </Text>
            </View>

            <Text style={[styles.label, { marginTop: 10 }]}>Address</Text>
            <View style={styles.addressBox}>
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={16}
                color="#64748B"
              />
              <Text style={styles.addressText}>{stop?.address || '—'}</Text>
            </View>

            {settings.geofenceMeters > 0 && (
              <View
                style={[
                  styles.geofenceRow,
                  outsideGeofence
                    ? styles.geofenceWarning
                    : distance !== null
                    ? styles.geofenceOk
                    : styles.geofenceUnknown,
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    checkingLocation
                      ? 'crosshairs-gps'
                      : outsideGeofence
                      ? 'map-marker-alert-outline'
                      : distance !== null
                      ? 'map-marker-check-outline'
                      : 'map-marker-question-outline'
                  }
                  size={14}
                  color={
                    outsideGeofence
                      ? '#B91C1C'
                      : distance !== null
                      ? '#15803D'
                      : '#64748B'
                  }
                />
                <Text
                  style={[
                    styles.geofenceText,
                    outsideGeofence && { color: '#B91C1C' },
                    distance !== null && !outsideGeofence && { color: '#15803D' },
                  ]}
                >
                  {checkingLocation
                    ? 'Checking your location…'
                    : distance !== null
                    ? outsideGeofence
                      ? `You are about ${formatDistance(
                          distance
                        )} from this stop`
                      : `At the stop · ${formatDistance(distance)} away`
                    : 'GPS unavailable · delivery can still be saved'}
                </Text>
              </View>
            )}

            <View style={styles.photoHeader}>
              <MaterialCommunityIcons
                name="camera-outline"
                size={15}
                color="#334155"
              />
              <Text style={styles.photoHeaderText}>
                Proof of delivery {requireProof ? '(required)' : '(optional)'}
              </Text>
            </View>

            <DeliveryProofBox
              photos={photos}
              accent={accent}
              busy={busy}
              maxPhotos={maxPhotos}
              onAddPress={chooseSource}
              onCamera={() => void add('camera')}
              onGallery={() => void add('library')}
              onRemove={confirmRemove}
              onPhotoPress={onPhotoPress}
              onRetry={() => void uploadNow()}
              retrying={syncing}
            />

            {!!error && (
              <View style={styles.errorRow}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={14}
                  color="#B91C1C"
                />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View
              style={[
                styles.readyNote,
                photos.length === 0 && requireProof
                  ? styles.readyNoteLocked
                  : allUploaded
                  ? styles.readyNoteDone
                  : styles.readyNotePending,
              ]}
            >
              <MaterialCommunityIcons
                name={
                  photos.length === 0 && requireProof
                    ? 'lock-outline'
                    : allUploaded
                    ? 'cloud-check-outline'
                    : photos.length === 0
                    ? 'camera-outline'
                    : 'cloud-clock-outline'
                }
                size={14}
                color={
                  photos.length === 0 && requireProof
                    ? '#94A3B8'
                    : allUploaded
                    ? '#15803D'
                    : '#B45309'
                }
              />
              <Text
                style={[
                  styles.readyText,
                  photos.length === 0 && requireProof
                    ? { color: '#94A3B8' }
                    : allUploaded
                    ? { color: '#15803D' }
                    : { color: '#B45309' },
                ]}
              >
                {photos.length === 0 && requireProof
                  ? 'Add at least one photo to enable Save.'
                  : allUploaded
                  ? 'Proof uploaded to Google Drive.'
                  : photos.length === 0
                  ? 'Photo proof is optional for this workspace. You can save now.'
                  : 'Photo saved on this device. Tap Save to mark delivered — upload starts right after.'}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.save,
                { backgroundColor: accent },
                !canSave && styles.saveDisabled,
              ]}
              onPress={handleSave}
              disabled={!canSave}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name="check-circle-outline"
                    size={17}
                    color="#fff"
                  />
                  <Text style={styles.saveText}>Save & mark delivered</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 26,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  headerText: { flex: 1, paddingRight: 8 },
  headerIconRow: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#1E293B' },
  subtitle: { fontSize: 11, color: '#64748B', marginTop: 4, lineHeight: 15 },
  label: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center' },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperInput: {
    width: 54,
    height: 36,
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
    backgroundColor: '#fff',
  },
  stepperHint: {
    flex: 1,
    fontSize: 9,
    color: '#94A3B8',
    marginLeft: 8,
    lineHeight: 12,
  },
  addressBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#F8FAFC',
  },
  addressText: {
    flex: 1,
    fontSize: 12,
    color: '#475569',
    marginLeft: 5,
    lineHeight: 16,
  },
  geofenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9,
    padding: 8,
    marginTop: 8,
  },
  geofenceOk: { backgroundColor: '#DCFCE7' },
  geofenceWarning: { backgroundColor: '#FEE2E2' },
  geofenceUnknown: { backgroundColor: '#F1F5F9' },
  geofenceText: {
    flex: 1,
    fontSize: 9.5,
    color: '#64748B',
    marginLeft: 5,
    fontWeight: '700',
    lineHeight: 13,
  },
  photoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  photoHeaderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    marginLeft: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  errorText: {
    flex: 1,
    fontSize: 10,
    color: '#B91C1C',
    marginLeft: 4,
    lineHeight: 14,
  },
  readyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 9,
    padding: 9,
    marginTop: 10,
  },
  readyNoteLocked: { backgroundColor: '#F1F5F9' },
  readyNotePending: { backgroundColor: '#FEF3C7' },
  readyNoteDone: { backgroundColor: '#DCFCE7' },
  readyText: {
    flex: 1,
    fontSize: 9.5,
    lineHeight: 14,
    marginLeft: 5,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  cancel: { paddingVertical: 12, paddingHorizontal: 14 },
  cancelText: { fontSize: 13, color: '#64748B', fontWeight: '700' },
  save: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 13,
    marginLeft: 6,
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 13, marginLeft: 6 },
});
