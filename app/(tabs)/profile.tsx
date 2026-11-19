import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { RootState } from '@/redux/store';
import {
  logout,
  setName,
  setProfile,
  setWorkerProfile,
} from '@/redux/store/userSlice';
import {
  signOutUser,
  updateUserProfileFields,
} from '@/assets/services/firebaseService';
import { getRoleTheme } from '@/assets/constants/roleTheme';
import {
  fetchSheetRows,
  getGoogleAccessToken,
  type SheetRow,
} from '@/src/utils/sheets';
import {
  effectiveDesignation,
  findMyWorkerRow,
  rowHasEditAccess,
  updateWorkerFields,
} from '@/src/utils/workerManagement';
import { notifyAdminOfEdit } from '@/src/utils/editAccess';
import GenerateJoinLinkModal from '@/components/GenerateJoinLinkModal';

export default function ProfileScreen() {
  const dispatch = useDispatch();
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const [workers, setWorkers] = useState<SheetRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [joinLinkVisible, setJoinLinkVisible] = useState(false);

  const [name, setNameValue] = useState(user.name || '');
  const [phone, setPhone] = useState('');
  const [biography, setBio] = useState('');
  const [companyName, setCompanyName] = useState(
    user.profile?.companyName || ''
  );
  const [companyPhone, setCompanyPhone] = useState(
    user.profile?.companyPhone || ''
  );
  const [companyEmail, setCompanyEmail] = useState(
    user.profile?.companyEmail || ''
  );
  const [companyAddress, setCompanyAddress] = useState(
    user.profile?.companyAddress || ''
  );

  const sheetId = user.sheetId || user.workerProfile?.sheetId || '';
  const currentWorkerId = user.workerProfile?.workerId;

  const myRow = useMemo(
    () =>
      findMyWorkerRow(
        workers,
        currentWorkerId,
        user.email || user.workerProfile?.email
      ),
    [workers, currentWorkerId, user.email, user.workerProfile?.email]
  );

  const designation = effectiveDesignation(
    user.profile?.designation || user.designation,
    myRow
  );
  const isAdmin = designation === 'admin';
  const isManager = designation === 'manager';
  const isEmployee = !isAdmin && !isManager;
  const theme = getRoleTheme(designation, isEmployee);
  const hasEditAccess = isAdmin || rowHasEditAccess(myRow);

  const fetchWorkers = useCallback(async () => {
    if (!sheetId) {
      setRefreshing(false);
      return;
    }
    try {
      const rows = await fetchSheetRows(sheetId, 'Workers');
      setWorkers(rows);
    } catch (error) {
      console.error('Error loading profile row:', error);
    } finally {
      setRefreshing(false);
    }
  }, [sheetId]);

  useFocusEffect(
    useCallback(() => {
      fetchWorkers();
    }, [fetchWorkers])
  );

  useEffect(() => {
    setNameValue(user.name || '');
    setPhone(myRow?.Phone || user.workerProfile?.phone || '');
    setBio(myRow?.Bio || '');
    setCompanyName(user.profile?.companyName || '');
    setCompanyPhone(user.profile?.companyPhone || '');
    setCompanyEmail(user.profile?.companyEmail || '');
    setCompanyAddress(user.profile?.companyAddress || '');
  }, [user.name, user.profile, user.workerProfile, myRow]);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await signOutUser();
          dispatch(logout());
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleCopyWorkspace = async () => {
    if (!sheetId) {
      Alert.alert('No workspace', 'No spreadsheet is linked to this account.');
      return;
    }
    const link =
      user.profile?.sheetUrl ||
      `https://docs.google.com/spreadsheets/d/${sheetId}`;
    await Clipboard.setStringAsync(link);
    Alert.alert('Copied', 'Spreadsheet link copied to clipboard.');
  };

  const handleOpenFolder = async () => {
    const link =
      user.profile?.folderUrl ||
      (user.folderId
        ? `https://drive.google.com/drive/folders/${user.folderId}`
        : '');
    if (!link) {
      Alert.alert(
        'No folder',
        'The company Drive folder is not linked yet. Sign in again to restore it.'
      );
      return;
    }
    try {
      await Linking.openURL(link);
    } catch {
      Alert.alert('Unable to open Drive', 'Please try again.');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    setSaving(true);
    try {
      if (isAdmin) {
        const uid = user.uid;
        if (!uid) throw new Error('Session expired. Please sign in again.');
        await updateUserProfileFields(uid, {
          name: name.trim(),
          companyName: companyName.trim(),
          companyPhone: companyPhone.trim(),
          companyEmail: companyEmail.trim(),
          companyAddress: companyAddress.trim(),
        });
        dispatch(setName(name.trim()));
        dispatch(
          setProfile({
            uid,
            designation: user.profile?.designation || 'admin',
            companyName: companyName.trim(),
            companyPhone: companyPhone.trim(),
            companyEmail: companyEmail.trim(),
            companyAddress: companyAddress.trim(),
            sheetId: user.sheetId || user.profile?.sheetId || undefined,
            folderId: user.folderId || user.profile?.folderId || undefined,
            folderName: user.profile?.folderName,
            folderUrl: user.profile?.folderUrl,
            folderPath: user.profile?.folderPath,
            sheetUrl: user.profile?.sheetUrl,
            joinLink: user.joinLink || user.profile?.joinLink || undefined,
          })
        );
      } else {
        if (!hasEditAccess) {
          throw new Error(
            'Your profile is read-only. Ask an admin to grant edit access.'
          );
        }
        if (!sheetId) throw new Error('No workspace is linked to this account.');
        const token = await getGoogleAccessToken(true);
        if (!myRow?.WorkerID && !currentWorkerId) {
          throw new Error('Your employee record was not found.');
        }
        await updateWorkerFields(
          sheetId,
          token,
          { workerId: currentWorkerId || myRow?.WorkerID, email: user.email || myRow?.Email },
          {
            Name: name.trim(),
            Phone: phone.trim(),
            Email: user.email || myRow?.Email || '',
            Bio: biography.trim(),
          }
        );
        dispatch(setName(name.trim()));
        if (user.workerProfile) {
          dispatch(
            setWorkerProfile({
              ...user.workerProfile,
              name: name.trim(),
              phone: phone.trim(),
            })
          );
        }

        await notifyAdminOfEdit({
          sheetId,
          token,
          actorWorkerId: currentWorkerId || myRow?.WorkerID || '',
          actorName: name.trim() || user.name || 'A teammate',
          action: 'updated their profile',
        });

        await fetchWorkers();
      }
      setEditing(false);
      Alert.alert(
        'Saved',
        isAdmin
          ? 'Your profile has been updated.'
          : 'Profile saved. The admin has been notified.'
      );
    } catch (error: any) {
      Alert.alert('Unable to save', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const permissionText = isAdmin
    ? 'Full control · edit company, people and access'
    : hasEditAccess
    ? 'Edit access granted by admin'
    : isManager
    ? 'Limited access · ask admin for edit rights'
    : 'Read only · ask admin for edit access';

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchWorkers();
          }}
          colors={[theme.accent]}
        />
      }
    >
      <View style={[styles.header, { backgroundColor: theme.headerBg }]}>
        <View style={styles.headerTop}>
          <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
            <Text style={styles.avatarText}>
              {(name || user.name || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.editToggle,
              !hasEditAccess && styles.editToggleDisabled,
            ]}
            onPress={() => hasEditAccess && setEditing((value) => !value)}
            disabled={!hasEditAccess}
          >
            <MaterialCommunityIcons
              name={editing ? 'close' : hasEditAccess ? 'pencil' : 'lock-outline'}
              size={18}
              color={hasEditAccess ? '#fff' : '#94A3B8'}
            />
            <Text
              style={[
                styles.editToggleText,
                !hasEditAccess && { color: '#94A3B8' },
              ]}
            >
              {editing ? 'Cancel' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.userName, { color: theme.headerText }]}>
          {user.name || 'User'}
        </Text>
        <Text style={[styles.userEmail, { color: theme.headerMuted }]}>
          {user.email || 'email@example.com'}
        </Text>
        <View style={styles.badgeRow}>
          <View style={[styles.roleBadge, { backgroundColor: theme.accent }]}>
            <MaterialCommunityIcons
              name={theme.icon as any}
              size={12}
              color="#fff"
            />
            <Text style={styles.roleBadgeText}>
              {(user.profile?.designation || designation || 'Employee').toUpperCase()}
            </Text>
          </View>
          <View
            style={[
              styles.accessBadge,
              {
                backgroundColor: hasEditAccess
                  ? 'rgba(255,255,255,0.18)'
                  : 'rgba(255,255,255,0.10)',
              },
            ]}
          >
            <MaterialCommunityIcons
              name={hasEditAccess ? 'shield-check' : 'shield-lock-outline'}
              size={12}
              color={hasEditAccess ? '#fff' : theme.headerMuted}
            />
            <Text
              style={[
                styles.accessBadgeText,
                { color: hasEditAccess ? '#fff' : theme.headerMuted },
              ]}
            >
              {hasEditAccess ? 'Edit access' : 'Read only'}
            </Text>
          </View>
        </View>
        <Text style={[styles.permissionText, { color: theme.headerMuted }]}>
          {permissionText}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Personal information</Text>
        <View style={styles.card}>
          {editing ? (
            <>
              <Field label="Full name" value={name} onChange={setNameValue} />
              {!isAdmin && (
                <>
                  <Field
                    label="Phone"
                    value={phone}
                    onChange={setPhone}
                    keyboardType="phone-pad"
                  />
                  <Field
                    label="Email"
                    value={user.email || myRow?.Email || ''}
                    onChange={() => {}}
                    editable={false}
                  />
                  <Field
                    label="Bio"
                    value={biography}
                    onChange={setBio}
                    multiline
                    placeholder="A short introduction for your team"
                  />
                </>
              )}
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: theme.accent }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save changes</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <InfoRow
                icon="account"
                label="Name"
                value={user.name || 'Not set'}
              />
              <InfoRow
                icon="email-outline"
                label="Email"
                value={user.email || myRow?.Email || 'Not set'}
              />
              <InfoRow
                icon="phone-outline"
                label="Phone"
                value={myRow?.Phone || user.workerProfile?.phone || 'Not set'}
              />
              <InfoRow
                icon="briefcase-outline"
                label="Designation"
                value={user.profile?.designation || designation || 'Employee'}
              />
              {!!myRow?.Bio && (
                <InfoRow icon="text-account" label="Bio" value={myRow.Bio} />
              )}
              {!hasEditAccess && (
                <View style={styles.lockedNotice}>
                  <MaterialCommunityIcons
                    name="lock-outline"
                    size={16}
                    color="#92400E"
                  />
                  <Text style={styles.lockedText}>
                    This profile is locked. An admin can unlock editing from the
                    Workers tab using “Give access”.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Company</Text>
        <View style={styles.card}>
          {editing && isAdmin ? (
            <>
              <Field
                label="Company name"
                value={companyName}
                onChange={setCompanyName}
              />
              <Field
                label="Company phone"
                value={companyPhone}
                onChange={setCompanyPhone}
                keyboardType="phone-pad"
              />
              <Field
                label="Company email"
                value={companyEmail}
                onChange={setCompanyEmail}
                keyboardType="email-address"
              />
              <Field
                label="Address"
                value={companyAddress}
                onChange={setCompanyAddress}
                multiline
              />
            </>
          ) : (
            <>
              <InfoRow
                icon="office-building"
                label="Company"
                value={user.profile?.companyName || 'Not set'}
              />
              <InfoRow
                icon="phone"
                label="Phone"
                value={user.profile?.companyPhone || 'Not set'}
              />
              <InfoRow
                icon="email"
                label="Email"
                value={user.profile?.companyEmail || 'Not set'}
              />
              <InfoRow
                icon="map-marker"
                label="Address"
                value={user.profile?.companyAddress || 'Not set'}
              />
            </>
          )}
        </View>
      </View>

      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin tools</Text>
          <TouchableOpacity
            style={styles.toolRow}
            onPress={() => setJoinLinkVisible(true)}
          >
            <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
              <MaterialCommunityIcons name="account-plus-outline" size={20} color={theme.accent} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolTitle}>Add employee</Text>
              <Text style={styles.toolSubtitle}>
                Create a join link and add someone to the sheet
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#CBD5E0" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolRow} onPress={handleCopyWorkspace}>
            <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
              <MaterialCommunityIcons name="google-spreadsheet" size={20} color={theme.accent} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolTitle}>Copy workspace link</Text>
              <Text style={styles.toolSubtitle}>
                Share the folder spreadsheet with your team
              </Text>
            </View>
            <MaterialCommunityIcons name="content-copy" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.toolRow} onPress={handleOpenFolder}>
            <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
              <MaterialCommunityIcons name="folder-google-drive" size={20} color={theme.accent} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolTitle}>Open company folder</Text>
              <Text style={styles.toolSubtitle}>
                {user.profile?.folderName || 'Google Drive folder for this workspace'}
              </Text>
            </View>
            <MaterialCommunityIcons name="open-in-new" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolRow}
            onPress={() => router.push('/delivery-proofs')}
          >
            <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
              <MaterialCommunityIcons name="camera-outline" size={20} color={theme.accent} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolTitle}>Delivery proofs</Text>
              <Text style={styles.toolSubtitle}>
                Orders, deliveries and photo proof by day
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toolRow}
            onPress={() => router.push('/delivery-settings')}
          >
            <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
              <MaterialCommunityIcons name="tune-variant" size={20} color={theme.accent} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolTitle}>Delivery settings</Text>
              <Text style={styles.toolSubtitle}>
                Proof rules, geofence and photo storage
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.toolRow}>
            <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
              <MaterialCommunityIcons name="shield-key-outline" size={20} color={theme.accent} />
            </View>
            <View style={styles.toolInfo}>
              <Text style={styles.toolTitle}>Access control</Text>
              <Text style={styles.toolSubtitle}>
                Grant edit access one person at a time from Workers
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#CBD5E0" />
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <MaterialCommunityIcons name="logout" size={20} color="#DC2626" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Revork v1.0.0</Text>
        <Text style={styles.footerText}>
          {isAdmin
            ? 'Admin workspace · full control'
            : isManager
            ? 'Manager workspace · limited write access'
            : 'Employee workspace · read only by default'}
        </Text>
      </View>

      <GenerateJoinLinkModal
        visible={joinLinkVisible}
        onClose={() => setJoinLinkVisible(false)}
      />
    </ScrollView>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <MaterialCommunityIcons name={icon as any} size={17} color="#64748B" />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboardType,
  multiline,
  editable = true,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
  multiline?: boolean;
  editable?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[
          styles.fieldInput,
          multiline && styles.fieldInputMultiline,
          !editable && styles.fieldInputDisabled,
        ]}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F8F7' },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTop: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  editToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  editToggleDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  editToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 5,
  },
  userName: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
  },
  userEmail: { fontSize: 12, marginTop: 2 },
  badgeRow: { flexDirection: 'row', marginTop: 10 },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginRight: 8,
  },
  roleBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 4,
    letterSpacing: 0.4,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  accessBadgeText: { fontSize: 10, fontWeight: '700', marginLeft: 4 },
  permissionText: { fontSize: 11, marginTop: 10, textAlign: 'center' },
  section: { paddingHorizontal: 20, paddingTop: 18 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 10,
  },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  infoLabel: {
    fontSize: 12,
    color: '#64748B',
    width: 78,
    marginLeft: 8,
  },
  infoValue: { flex: 1, fontSize: 13, color: '#1E293B', fontWeight: '600' },
  lockedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3E2',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  lockedText: { flex: 1, fontSize: 11, color: '#92400E', marginLeft: 7 },
  field: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 5,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    color: '#1E293B',
  },
  fieldInputMultiline: { height: 74, textAlignVertical: 'top' },
  fieldInputDisabled: { backgroundColor: '#F1F5F9', color: '#64748B' },
  saveButton: {
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
  },
  toolIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolInfo: { flex: 1, marginLeft: 10 },
  toolTitle: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  toolSubtitle: { fontSize: 10, color: '#64748B', marginTop: 2 },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    marginHorizontal: 20,
    marginTop: 22,
    padding: 14,
    borderRadius: 12,
  },
  logoutText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 7,
  },
  footer: { alignItems: 'center', padding: 24 },
  footerText: { fontSize: 10, color: '#94A3B8', marginBottom: 3 },
});
