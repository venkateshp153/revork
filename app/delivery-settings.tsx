import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSelector } from 'react-redux';
import { RootState } from '@/redux/store';
import { getGoogleAccessToken, fetchSheetRows } from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
} from '@/src/utils/workerManagement';
import {
  DEFAULT_COMPANY_SETTINGS,
  readCompanySettings,
  saveCompanySettings,
  type CompanySettings,
} from '@/src/utils/settings';

export default function DeliverySettingsScreen() {
  const user = useSelector((state: RootState) => state.user);
  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';

  const [settings, setSettings] = useState<CompanySettings>(
    DEFAULT_COMPANY_SETTINGS
  );
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await readCompanySettings(sheetId);
      let rows: any[] = [];
      try {
        rows = await fetchSheetRows(sheetId, 'Workers');
      } catch {
        rows = [];
      }
      if (!alive) return;
      const myRow = findMyWorkerRow(
        rows,
        user.workerProfile?.workerId,
        user.email || user.workerProfile?.email
      );
      setRole(
        effectiveDesignation(
          user.profile?.designation || user.designation,
          myRow
        )
      );
      setSettings(loaded);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [
    sheetId,
    user.profile?.designation,
    user.designation,
    user.workerProfile?.workerId,
    user.email,
    user.workerProfile?.email,
  ]);

  const patch = (values: Partial<CompanySettings>) =>
    setSettings((prev) => ({ ...prev, ...values }));

  const save = async () => {
    setSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        Alert.alert(
          'Sign in required',
          'Sign in with Google to save delivery settings.'
        );
        return;
      }
      await saveCompanySettings(sheetId, token, settings);
      Alert.alert('Saved', 'Delivery proof settings were updated.');
    } catch (error: any) {
      Alert.alert(
        'Could not save',
        error?.message || 'Check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!loading && role !== 'admin' && role !== 'manager') {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="lock-outline" size={40} color="#94A3B8" />
        <Text style={styles.emptyTitle}>Admin access only</Text>
        <Text style={styles.emptyText}>
          Ask an admin to change delivery proof rules.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Delivery settings</Text>
          <Text style={styles.subtitle}>
            Proof rules for every driver in this workspace
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#16A34A" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Proof of delivery</Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.rowTitle}>Require a photo</Text>
                <Text style={styles.rowSubtitle}>
                  Drivers cannot mark a stop delivered without a photo.
                </Text>
              </View>
              <Switch
                value={settings.requireProofPhoto}
                onValueChange={(value) => patch({ requireProofPhoto: value })}
                trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                thumbColor={settings.requireProofPhoto ? '#16A34A' : '#F8FAFC'}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleTextWrap}>
                <Text style={styles.rowTitle}>Compress proof photos</Text>
                <Text style={styles.rowSubtitle}>
                  Resize to 1280px and JPEG-compress before saving. Saves data
                  and Drive storage.
                </Text>
              </View>
              <Switch
                value={settings.compressProofPhotos}
                onValueChange={(value) => patch({ compressProofPhotos: value })}
                trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                thumbColor={
                  settings.compressProofPhotos ? '#16A34A' : '#F8FAFC'
                }
              />
            </View>

            <View style={styles.divider} />

            <Text style={styles.rowTitle}>Photos per stop</Text>
            <Text style={styles.rowSubtitle}>
              Between 1 and 4. Default is 2.
            </Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() =>
                  patch({
                    maxProofPhotos: Math.max(1, settings.maxProofPhotos - 1),
                  })
                }
              >
                <MaterialCommunityIcons name="minus" size={16} color="#334155" />
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{settings.maxProofPhotos}</Text>
              <TouchableOpacity
                style={styles.stepperButton}
                onPress={() =>
                  patch({
                    maxProofPhotos: Math.min(4, settings.maxProofPhotos + 1),
                  })
                }
              >
                <MaterialCommunityIcons name="plus" size={16} color="#334155" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Location check</Text>
            <Text style={styles.rowTitle}>Geofence warning (metres)</Text>
            <Text style={styles.rowSubtitle}>
              Warn the driver when they are farther than this from the stop. Use
              0 to turn the warning off.
            </Text>
            <TextInput
              style={styles.numberInput}
              value={`${settings.geofenceMeters}`}
              onChangeText={(text) =>
                patch({
                  geofenceMeters: Math.max(
                    0,
                    parseInt(text.replace(/[^\d]/g, ''), 10) || 0
                  ),
                })
              }
              keyboardType="number-pad"
              placeholder="200"
              placeholderTextColor="#94A3B8"
            />
            <Text style={styles.hint}>
              A far-away delivery is still allowed with a confirmation, and is
              recorded in the Deliveries tab.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Phone storage</Text>
            <Text style={styles.rowTitle}>
              Delete local copies after (days)
            </Text>
            <Text style={styles.rowSubtitle}>
              Uploaded photos stay in Google Drive. Set 0 to keep local copies
              forever.
            </Text>
            <TextInput
              style={styles.numberInput}
              value={`${settings.proofRetentionDays}`}
              onChangeText={(text) =>
                patch({
                  proofRetentionDays: Math.max(
                    0,
                    parseInt(text.replace(/[^\d]/g, ''), 10) || 0
                  ),
                })
              }
              keyboardType="number-pad"
              placeholder="7"
              placeholderTextColor="#94A3B8"
            />
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveDisabled]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons
                  name="content-save-outline"
                  size={18}
                  color="#fff"
                />
                <Text style={styles.saveText}>Save settings</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.footer}>
            Settings are stored in the workspace Settings tab, so they apply on
            every driver’s phone.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15803D',
    paddingTop: 54,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerText: { flex: 1 },
  title: { color: '#fff', fontSize: 19, fontWeight: '800' },
  subtitle: { color: '#DCFCE7', fontSize: 10.5, marginTop: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#334155', marginTop: 10 },
  emptyText: { fontSize: 12, color: '#94A3B8', marginTop: 4, textAlign: 'center' },
  content: { padding: 16, paddingBottom: 50 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 10,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleTextWrap: { flex: 1, paddingRight: 10 },
  rowTitle: { fontSize: 12, fontWeight: '800', color: '#1E293B' },
  rowSubtitle: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 14,
  },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 12 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 44,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
  },
  numberInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
    marginTop: 9,
  },
  hint: { fontSize: 9, color: '#94A3B8', marginTop: 7, lineHeight: 13 },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 13,
    paddingVertical: 14,
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '800', marginLeft: 6 },
  footer: {
    fontSize: 9.5,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 14,
  },
});
