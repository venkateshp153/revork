import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'expo-router';
import { RootState, persistor } from '@/redux/store';
import { setProfile, setSheetId, setFolderId, setJoinLink, logout } from '@/redux/store/userSlice';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { ensureCompanyWorkspace } from '@/src/utils/workspace';
import { signOutUser, completeUserOnboarding, auth } from '@/assets/services/firebaseService';
import { ensureAdminWorkerRow } from '@/src/utils/workerManagement';
import { updateSheetRange } from '@/src/utils/sheets';

interface NewUserProfileModalProps {
  visible: boolean;
  preFillData?: {
    name?: string;
    email?: string;
  };
}

export default function NewUserProfileModal({ visible, preFillData }: NewUserProfileModalProps) {
  const [name, setName] = useState(preFillData?.name || '');
  const [email] = useState(preFillData?.email || '');
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const dispatch = useDispatch();
  const router = useRouter();
  const user = useSelector((state: RootState) => state.user);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[0-9]{7,15}$/;

  const validateFields = () => {
    const errors: Record<string, string> = {};

    if (!name.trim()) errors.name = 'Name is required';
    if (!email.trim()) errors.email = 'Email is required';
    else if (!emailRegex.test(email)) errors.email = 'Please enter a valid email';
    if (!companyName.trim()) errors.companyName = 'Company name is required';
    if (!companyPhone.trim()) errors.companyPhone = 'Company phone is required';
    else if (!phoneRegex.test(companyPhone.replace(/\D/g, ''))) {
      errors.companyPhone = 'Phone must be 7-15 digits';
    }
    if (!companyEmail.trim()) errors.companyEmail = 'Company email is required';
    else if (!emailRegex.test(companyEmail)) errors.companyEmail = 'Please enter a valid email';

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateFields()) {
      return;
    }

    setLoading(true);

    try {
      // Resolve uid from Redux or from the live Firebase session. If neither
      // exists (stale persisted state), the save cannot continue safely.
      const uid = user.uid || auth.currentUser?.uid;
      if (!uid) {
        console.error('[AuthDebug] No authenticated uid available for onboarding save');
        Alert.alert('Session expired', 'Please sign in again to finish setting up your workspace.');
        setLoading(false);
        return;
      }
      console.log('[AuthDebug 16] Profile Save clicked. uid:', uid, '| getTokens() for Drive…');

      const profileData = {
        uid: uid,
        designation: 'admin' as const,
        companyName: companyName.trim(),
        companyAddress: companyAddress.trim() || undefined,
        companyPhone: companyPhone.trim(),
        companyEmail: companyEmail.trim(),
      };

      setSetupLoading(true);

      // 1. Resolve the company workspace in Drive. This reuses an existing
      //    folder + spreadsheet for the account when one already exists, so a
      //    single Google account can never end up with two company folders.
      const tokens = await GoogleSignin.getTokens();
      const result = await ensureCompanyWorkspace({
        uid,
        companyName: profileData.companyName,
        companyEmail: profileData.companyEmail,
        accessToken: tokens.accessToken,
      });

      // The workspace is private by default. Workers get access with their own
      // Google account when the admin adds them (Workers → share), so the
      // company sheet is never exposed as "anyone with the link".

      // 2. Save the account + workspace ids to Firestore. This is the moment a
      //    new admin actually gets created in `users/{uid}` (sign-in only
      //    checked Firestore).
      await completeUserOnboarding({
        uid,
        email: email.trim(),
        name: name.trim(),
        companyName: profileData.companyName,
        companyAddress: profileData.companyAddress,
        companyPhone: profileData.companyPhone,
        companyEmail: profileData.companyEmail,
        folderId: result.folderId,
        folderName: result.folderName,
        sheetId: result.sheetId,
        joinLink: result.joinLink,
        photoURL: auth.currentUser?.photoURL || undefined,
        authProvider: 'google',
      });
      console.log('[AuthDebug] Onboarding workspace saved to users/{uid}:', {
        folderId: result.folderId,
        sheetId: result.sheetId,
        companyName: profileData.companyName,
      });

      // 2b. Seed the owner's row in the Workers sheet so the directory,
      //     stats and clock activity have data from day one.
      await ensureAdminWorkerRow(result.sheetId, tokens.accessToken, {
        uid,
        name: name.trim() || user.name || '',
        email: email.trim() || user.email || '',
        phone: companyPhone.trim(),
        photoURL: auth.currentUser?.photoURL || '',
      });

      // 2c. Fill the MyProfile row with the admin's full details.
      await updateSheetRange(
        result.sheetId,
        'MyProfile!A2:L2',
        [[
          uid,
          name.trim(),
          email.trim(),
          'admin',
          profileData.companyName,
          profileData.companyAddress || '',
          profileData.companyPhone,
          profileData.companyEmail,
          result.sheetId,
          result.folderId,
          result.joinLink,
          new Date().toISOString(),
        ]],
        tokens.accessToken
      );

      // 3. Only now mark the profile complete in Redux — the workspace ids are
      //    included so the app can immediately read/populate the sheet.
      dispatch(setProfile({
        ...profileData,
        sheetId: result.sheetId,
        folderId: result.folderId,
        folderName: result.folderName,
        folderUrl: result.folderUrl,
        folderPath: result.folderPath,
        sheetUrl: result.sheetUrl,
        joinLink: result.joinLink,
      }));
      dispatch(setSheetId(result.sheetId));
      dispatch(setFolderId(result.folderId));
      dispatch(setJoinLink(result.joinLink));

      setSetupLoading(false);
      router.replace('/(tabs)/home');
    } catch (error: any) {
      setSetupLoading(false);
      Alert.alert(
        'Setup Failed',
        error.message || 'Failed to setup workspace. Would you like to retry?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Retry',
            onPress: handleSave,
          },
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleExit = async () => {
    if (exiting) return;

    console.log('[AuthDebug 17] Close (X) pressed → signing out and returning to login…');
    setExiting(true);

    // 1. Wipe persisted Redux storage (user + grocery slices in AsyncStorage)
    try {
      await persistor.purge();
      console.log('[AuthDebug 17] Persisted Redux storage purged ✔');
    } catch (e) {
      console.error('[AuthDebug 17] Failed to purge persisted state:', e);
    }

    // 2. Sign out of Firebase + Google (removes persisted Auth session)
    try {
      await signOutUser();
      console.log('[AuthDebug 17] Firebase + Google sign-out complete ✔');
    } catch (e) {
      console.error('[AuthDebug 17] Sign out during profile-setup exit failed:', e);
    }

    // 3. Reset in-memory Redux (clears isNewUser → closes the modal)
    dispatch(logout());

    // 4. Show the login screen
    router.replace('/(auth)/login');
    setExiting(false);
  };

  return (
    <>
      <Modal
        visible={visible || setupLoading}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {}}
      >
        {setupLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#00af5bff" />
            <Text style={styles.loadingText}>Setting up your workspace...</Text>
            <Text style={styles.loadingSubtext}>This may take a minute</Text>
          </View>
        ) : (
          <View style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.title}>Complete Your Profile</Text>
              <TouchableOpacity
                onPress={handleExit}
                style={styles.closeButton}
                disabled={exiting}
                accessibilityLabel="Close and return to login"
              >
                {exiting ? (
                  <ActivityIndicator size="small" color="#333" />
                ) : (
                  <MaterialCommunityIcons name="close" size={28} color="#333" />
                )}
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollView}>
              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={[styles.input, validationErrors.name && styles.inputError]}
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                placeholderTextColor="#999"
              />
              {validationErrors.name && (
                <Text style={styles.errorText}>{validationErrors.name}</Text>
              )}

              <Text style={styles.label}>Email (Google account)</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                placeholder="Your email"
                value={email}
                editable={false}
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.helperText}>
                This is the verified email you signed in with and cannot be
                changed here.
              </Text>
              {validationErrors.email && (
                <Text style={styles.errorText}>{validationErrors.email}</Text>
              )}

              <Text style={styles.label}>Designation</Text>
              <View style={styles.designationStatic}>
                <Text style={styles.designationText}>Admin</Text>
              </View>

              <Text style={styles.label}>Company Name *</Text>
              <TextInput
                style={[styles.input, validationErrors.companyName && styles.inputError]}
                placeholder="Enter company name"
                value={companyName}
                onChangeText={setCompanyName}
                placeholderTextColor="#999"
              />
              {validationErrors.companyName && (
                <Text style={styles.errorText}>{validationErrors.companyName}</Text>
              )}

              <Text style={styles.label}>Company Address (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter company address"
                value={companyAddress}
                onChangeText={setCompanyAddress}
                placeholderTextColor="#999"
                multiline
                numberOfLines={2}
              />

              <Text style={styles.label}>Company Phone *</Text>
              <TextInput
                style={[styles.input, validationErrors.companyPhone && styles.inputError]}
                placeholder="Enter company phone"
                value={companyPhone}
                onChangeText={setCompanyPhone}
                placeholderTextColor="#999"
                keyboardType="phone-pad"
              />
              {validationErrors.companyPhone && (
                <Text style={styles.errorText}>{validationErrors.companyPhone}</Text>
              )}

              <Text style={styles.label}>Company Email *</Text>
              <TextInput
                style={[styles.input, validationErrors.companyEmail && styles.inputError]}
                placeholder="Enter company email"
                value={companyEmail}
                onChangeText={setCompanyEmail}
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {validationErrors.companyEmail && (
                <Text style={styles.errorText}>{validationErrors.companyEmail}</Text>
              )}

              <TouchableOpacity
                style={[styles.saveButton, loading && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Profile</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  💡 Your company workspace will be created automatically
                </Text>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 20,
  },
  loadingSubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#f9f9f9',
    fontSize: 16,
  },
  inputError: {
    borderColor: '#F44336',
  },
  inputDisabled: {
    backgroundColor: '#EEF2F7',
    color: '#64748B',
  },
  helperText: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 5,
  },
  errorText: {
    color: '#F44336',
    fontSize: 12,
    marginTop: 4,
  },
  designationStatic: {
    backgroundColor: '#00af5bff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  designationText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#00af5bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 20,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  footer: {
    padding: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 20,
  },
  footerText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
