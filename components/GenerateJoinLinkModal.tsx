import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { RootState } from '@/redux/store';
import { setJoinLink } from '@/redux/store/userSlice';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface GenerateJoinLinkModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function GenerateJoinLinkModal({ visible, onClose }: GenerateJoinLinkModalProps) {
  const [workerName, setWorkerName] = useState('');
  const [workerPhone, setWorkerPhone] = useState('');
  const [workerEmail, setWorkerEmail] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const dispatch = useDispatch();
  const user = useSelector((state: RootState) => state.user);
  const companyName = user.profile?.companyName || 'Company';
  const sheetId = user.sheetId;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[0-9]{7,15}$/;

  const generateWorkerId = (name: string, phone: string) => {
    const firstTwo = name.trim().slice(0, 2).toUpperCase();
    const lastFour = phone.replace(/\D/g, '').slice(-4);
    return `W${firstTwo}${lastFour}`;
  };

  const handleGenerateWorkerId = (name: string) => {
    const id = generateWorkerId(name, workerPhone);
    setWorkerId(id);
  };

  const validateStep1 = () => {
    const errors: Record<string, string> = {};

    if (!workerName.trim()) errors.name = 'Name is required';
    if (!workerPhone.trim()) errors.phone = 'Phone is required';
    else if (!phoneRegex.test(workerPhone.replace(/\D/g, ''))) {
      errors.phone = 'Phone must be 7-15 digits';
    }
    if (!workerEmail.trim()) errors.email = 'Email is required';
    else if (!emailRegex.test(workerEmail)) errors.email = 'Please enter a valid email';

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleGenerateLink = async () => {
    if (!validateStep1()) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLoading(true);

    try {
      if (!sheetId) {
        Alert.alert('Error', 'No spreadsheet found. Please contact admin.');
        return;
      }

      const workerData = [
        workerId,
        workerName.trim(),
        workerEmail.trim().toLowerCase(),
        workerPhone.replace(/\D/g, ''),
        '0',
        'worker',
        new Date().toISOString().split('T')[0],
        'pending',
      ];

      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Workers:append?key=${process.env.EXPO_PUBLIC_API_KEY}&valueInputOption=RAW`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [workerData],
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to save worker data');
      }

      const joinLink = `workforce://join?sheetId=${sheetId}&token=anyone&companyId=${user.uid}&workerName=${encodeURIComponent(workerName)}&workerEmail=${encodeURIComponent(workerEmail)}&workerPhone=${encodeURIComponent(workerPhone)}`;
      setGeneratedLink(joinLink);
      setStep(2);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate link');
    } finally {
      setLoading(false);
    }
  };

  const handleShareSMS = () => {
    const message = `Join ${companyName} on WorkForce! Tap here to get started: ${generatedLink}`;
    Linking.openURL(`sms:?body=${encodeURIComponent(message)}`);
  };

  const handleShareEmail = () => {
    const subject = `Join ${companyName} on WorkForce`;
    const body = `Hi ${workerName},\n\nUse this link to join our team: ${generatedLink}`;
    Linking.openURL(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(generatedLink);
    Alert.alert('Success', 'Link copied to clipboard!');
  };

  const handleRevokeRegenerate = () => {
    Alert.alert(
      'Revoke & Regenerate',
      'This will invalidate the current join link for all pending workers. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Regenerate',
          style: 'destructive',
          onPress: () => {
            setGeneratedLink('');
            setStep(1);
            Alert.alert('Done', 'The old link is now invalid. Generate a new link to share.');
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Generate Join Link</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          {step === 1 ? (
            <>
              <Text style={styles.subtitle}>Enter worker details to generate a unique join link</Text>

              <Text style={styles.label}>Worker Name *</Text>
              <TextInput
                style={[styles.input, validationErrors.name && styles.inputError]}
                placeholder="Enter worker name"
                value={workerName}
                onChangeText={(text) => {
                  setWorkerName(text);
                  if (workerPhone) handleGenerateWorkerId(text);
                }}
                placeholderTextColor="#999"
              />
              {validationErrors.name && <Text style={styles.errorText}>{validationErrors.name}</Text>}

              <Text style={styles.label}>Worker ID</Text>
              <View style={styles.workerIdContainer}>
                <Text style={styles.workerIdText}>{workerId || 'Will auto-generate...'}</Text>
              </View>

              <Text style={styles.label}>Phone Number *</Text>
              <TextInput
                style={[styles.input, validationErrors.phone && styles.inputError]}
                placeholder="Enter phone number"
                value={workerPhone}
                onChangeText={(text) => {
                  setWorkerPhone(text);
                  if (workerName) handleGenerateWorkerId(workerName);
                }}
                placeholderTextColor="#999"
                keyboardType="phone-pad"
              />
              {validationErrors.phone && <Text style={styles.errorText}>{validationErrors.phone}</Text>}

              <Text style={styles.label}>Email *</Text>
              <TextInput
                style={[styles.input, validationErrors.email && styles.inputError]}
                placeholder="Enter email address"
                value={workerEmail}
                onChangeText={setWorkerEmail}
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {validationErrors.email && <Text style={styles.errorText}>{validationErrors.email}</Text>}

              <TouchableOpacity
                style={[styles.generateButton, loading && styles.buttonDisabled]}
                onPress={handleGenerateLink}
                disabled={loading || !workerId}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.generateButtonText}>Generate Link</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.successContainer}>
                <MaterialCommunityIcons name="check-circle" size={64} color="#4CAF50" />
                <Text style={styles.successTitle}>Link Generated!</Text>
              </View>

              <Text style={styles.label}>Join Link</Text>
              <TextInput
                style={styles.linkInput}
                value={generatedLink}
                editable={false}
                selectTextOnFocus
                multiline
              />

              <Text style={styles.shareLabel}>Share via:</Text>
              <View style={styles.shareButtons}>
                <TouchableOpacity style={styles.shareButton} onPress={handleShareSMS}>
                  <MaterialCommunityIcons name="message-text" size={24} color="#fff" />
                  <Text style={styles.shareButtonText}>SMS</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shareButton} onPress={handleShareEmail}>
                  <MaterialCommunityIcons name="email" size={24} color="#fff" />
                  <Text style={styles.shareButtonText}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shareButton} onPress={handleCopyLink}>
                  <MaterialCommunityIcons name="content-copy" size={24} color="#fff" />
                  <Text style={styles.shareButtonText}>Copy</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.revokeButton}
                onPress={handleRevokeRegenerate}
              >
                <MaterialCommunityIcons name="refresh" size={20} color="#F44336" />
                <Text style={styles.revokeButtonText}>Revoke & Regenerate</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.doneButton} onPress={onClose}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '90%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
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
  workerIdContainer: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  workerIdText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#00af5bff',
  },
  generateButton: {
    backgroundColor: '#00af5bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  generateButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  successContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 12,
  },
  linkInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#f9f9f9',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 16,
  },
  shareLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  shareButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00af5bff',
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  shareButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 6,
  },
  revokeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F44336',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  revokeButtonText: {
    color: '#F44336',
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  doneButton: {
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
