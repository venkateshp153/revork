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
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getGoogleAccessToken } from '@/src/utils/sheets';
import { addWorkerToSheet, ensureWorkerEditAccess } from '@/src/utils/workerManagement';

interface AddWorkerModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
  sheetId?: string;
  accent?: string;
}

const DESIGNATIONS = [
  { value: 'worker', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AddWorkerModal({
  visible,
  onClose,
  onCreated,
  sheetId,
  accent = '#00AF5B',
}: AddWorkerModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [designation, setDesignation] = useState('worker');
  const [designationOpen, setDesignationOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setPhone('');
    setEmail('');
    setDesignation('worker');
    setDesignationOpen(false);
    setErrors({});
    setSaving(false);
  };

  const handleClose = () => {
    if (saving) return;
    Alert.alert(
      'Discard input?',
      'Are you sure you want to discard input data',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            resetForm();
            onClose();
          },
        },
      ]
    );
  };

  const handleCreate = async () => {
    const nextErrors: Record<string, string> = {};
    const phoneDigits = phone.replace(/\D/g, '');

    if (!firstName.trim()) nextErrors.firstName = 'First name is required';
    if (!lastName.trim()) nextErrors.lastName = 'Last name is required';
    if (!phone.trim()) nextErrors.phone = 'Phone is required';
    else if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      nextErrors.phone = 'Phone must be 7-15 digits';
    }
    if (!email.trim()) nextErrors.email = 'Email is required';
    else if (!EMAIL_REGEX.test(email.trim())) {
      nextErrors.email = 'Please enter a valid email';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (!sheetId) {
      Alert.alert('Error', 'No spreadsheet found. Please contact your admin.');
      return;
    }

    setSaving(true);
    try {
      const token = await getGoogleAccessToken(true);
      if (!token) {
        throw new Error('Sign in with Google to add a worker.');
      }

      const workerId = await addWorkerToSheet(sheetId, token, {
        firstName,
        lastName,
        phone,
        email,
        designation,
      });

      // Pre-authorize the worker's Google account for the spreadsheet. This is
      // best-effort and does not block worker creation, but the admin is told
      // when Google refused so the join link does not silently fail later.
      const access = await ensureWorkerEditAccess(
        sheetId,
        token,
        email.trim().toLowerCase()
      );

      const label =
        DESIGNATIONS.find((option) => option.value === designation)?.label ||
        'Employee';
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      resetForm();
      onClose();
      onCreated?.();
      Alert.alert(
        'Worker added',
        `${fullName} was added as ${label} (${workerId}).${
          access.shared
            ? ' Sheet edit access granted.'
            : ` Google could not grant sheet edit access to ${email.trim()}${
                access.error ? ` (${access.error})` : ''
              }. Share the sheet with that email as Editor manually.`
        }`
      );
    } catch (error: any) {
      Alert.alert('Unable to add worker', error?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const selectedDesignation =
    DESIGNATIONS.find((option) => option.value === designation)?.label ||
    'Employee';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleClose}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />

            <View style={styles.headerRow}>
              <Text style={styles.title}>Add new worker</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close add worker"
              >
                <MaterialCommunityIcons name="close" size={20} color="#1E293B" />
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              New teammates are saved to the Workers sheet.
            </Text>

            <ScrollView
              style={styles.form}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.label}>First name</Text>
              <TextInput
                style={[styles.input, errors.firstName && styles.inputError]}
                value={firstName}
                onChangeText={(text) => {
                  setFirstName(text);
                  if (errors.firstName) {
                    setErrors((prev) => ({ ...prev, firstName: '' }));
                  }
                }}
                placeholder="e.g. Alex"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />
              {!!errors.firstName && (
                <Text style={styles.errorText}>{errors.firstName}</Text>
              )}

              <Text style={styles.label}>Last name</Text>
              <TextInput
                style={[styles.input, errors.lastName && styles.inputError]}
                value={lastName}
                onChangeText={(text) => {
                  setLastName(text);
                  if (errors.lastName) {
                    setErrors((prev) => ({ ...prev, lastName: '' }));
                  }
                }}
                placeholder="e.g. Johnson"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />
              {!!errors.lastName && (
                <Text style={styles.errorText}>{errors.lastName}</Text>
              )}

              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={[styles.input, errors.phone && styles.inputError]}
                value={phone}
                onChangeText={(text) => {
                  setPhone(text);
                  if (errors.phone) {
                    setErrors((prev) => ({ ...prev, phone: '' }));
                  }
                }}
                placeholder="e.g. 555 123 4567"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
              />
              {!!errors.phone && (
                <Text style={styles.errorText}>{errors.phone}</Text>
              )}

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (errors.email) {
                    setErrors((prev) => ({ ...prev, email: '' }));
                  }
                }}
                placeholder="e.g. alex@company.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!errors.email && (
                <Text style={styles.errorText}>{errors.email}</Text>
              )}

              <Text style={styles.label}>Designation</Text>
              <TouchableOpacity
                style={styles.dropdown}
                activeOpacity={0.85}
                onPress={() => setDesignationOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityLabel="Choose designation"
              >
                <Text style={styles.dropdownText}>{selectedDesignation}</Text>
                <MaterialCommunityIcons
                  name={designationOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#64748B"
                />
              </TouchableOpacity>

              {designationOpen && (
                <View style={styles.dropdownMenu}>
                  {DESIGNATIONS.map((option) => {
                    const active = option.value === designation;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.dropdownOption,
                          active && { backgroundColor: '#F1F5F9' },
                        ]}
                        onPress={() => {
                          setDesignation(option.value);
                          setDesignationOpen(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.dropdownOptionText,
                            active && { color: accent, fontWeight: '800' },
                          ]}
                        >
                          {option.label}
                        </Text>
                        {active && (
                          <MaterialCommunityIcons
                            name="check"
                            size={16}
                            color={accent}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.createButton,
                  { backgroundColor: accent },
                  saving && styles.buttonDisabled,
                ]}
                onPress={handleCreate}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.createButtonText}>Create</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheetWrap: { width: '100%' },
  sheet: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#1E293B' },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  hint: { fontSize: 11, color: '#94A3B8', marginTop: 4, marginBottom: 4 },
  form: { flexShrink: 1 },
  formContent: { paddingBottom: 4 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 12,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
  },
  inputError: { borderColor: '#EF4444' },
  errorText: { fontSize: 10, color: '#EF4444', marginTop: 4 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#F8FAFC',
  },
  dropdownText: { fontSize: 13, color: '#1E293B', fontWeight: '600' },
  dropdownMenu: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    marginTop: 6,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dropdownOptionText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  createButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  createButtonText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
