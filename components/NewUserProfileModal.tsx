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
  BackHandler,
  Platform,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'expo-router';
import { RootState } from '@/redux/store';
import { setProfile, setSheetId, setFolderId, setJoinLink } from '@/redux/store/userSlice';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { createGoogleDriveStructure } from '@/src/utils/createGoogleDriveStructure';

interface NewUserProfileModalProps {
  visible: boolean;
  preFillData?: {
    name?: string;
    email?: string;
  };
}

export default function NewUserProfileModal({ visible, preFillData }: NewUserProfileModalProps) {
  const [name, setName] = useState(preFillData?.name || '');
  const [email, setEmail] = useState(preFillData?.email || '');
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
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
      const profileData = {
        uid: user.uid || undefined,
        designation: 'admin' as const,
        companyName: companyName.trim(),
        companyAddress: companyAddress.trim() || undefined,
        companyPhone: companyPhone.trim(),
        companyEmail: companyEmail.trim(),
      };

      dispatch(setProfile(profileData));

      setSetupLoading(true);

      const tokens = await GoogleSignin.getTokens();
      const result = await createGoogleDriveStructure(
        profileData.companyName,
        tokens.accessToken,
        profileData.companyEmail
      );

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

  const handleExit = () => {
    Alert.alert(
      'Your account has not been created. Exit app?',
      '',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit App',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS === 'android') {
              BackHandler.exitApp();
            } else {
              BackHandler.exitApp();
            }
          },
        },
      ]
    );
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
              <TouchableOpacity onPress={handleExit} style={styles.closeButton}>
                <MaterialCommunityIcons name="close" size={28} color="#333" />
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

              <Text style={styles.label}>Email *</Text>
              <TextInput
                style={[styles.input, validationErrors.email && styles.inputError]}
                placeholder="Your email"
                value={email}
                onChangeText={setEmail}
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
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
