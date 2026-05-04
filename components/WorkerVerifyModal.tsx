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
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface WorkerVerifyModalProps {
  visible: boolean;
  onClose: () => void;
  onVerify: (name: string, phone: string, email: string) => void;
  workerData: {
    name: string;
    email: string;
    phone: string;
  } | null;
}

export default function WorkerVerifyModal({
  visible,
  onClose,
  onVerify,
  workerData,
}: WorkerVerifyModalProps) {
  const [name, setName] = useState(workerData?.name || '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleVerify = () => {
    if (!name.trim() || !phone.trim() || !email.trim()) {
      setVerifyError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setVerifyError('');
    
    setTimeout(() => {
      onVerify(name.trim(), phone.trim(), email.trim());
      setLoading(false);
    }, 100);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Verify Your Details</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Enter your details to verify your identity
          </Text>

          {workerData && (
            <View style={styles.infoContainer}>
              <Text style={styles.infoLabel}>Pre-filled from company records:</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoIcon}>👤</Text>
                <Text style={styles.infoText}>{workerData.name}</Text>
              </View>
            </View>
          )}

          <Text style={styles.label}>Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            placeholderTextColor="#999"
          />

          <Text style={styles.label}>Phone Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="Your phone number"
            value={phone}
            onChangeText={setPhone}
            placeholderTextColor="#999"
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Email *</Text>
          <TextInput
            style={styles.input}
            placeholder="Your email"
            value={email}
            onChangeText={setEmail}
            placeholderTextColor="#999"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {verifyError ? (
            <Text style={styles.verifyError}>{verifyError}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.verifyButton, loading && styles.buttonDisabled]}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.verifyButtonText}>Verify & Join</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.helperText}>
            ⚠️ Your phone and email must match the records provided by your admin
          </Text>
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
    maxHeight: '80%',
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
    marginBottom: 16,
  },
  infoContainer: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
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
  verifyError: {
    color: '#F44336',
    fontSize: 14,
    marginTop: 8,
    fontStyle: 'italic',
  },
  verifyButton: {
    backgroundColor: '#00af5bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  verifyButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  helperText: {
    fontSize: 12,
    color: '#F44336',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 12,
  },
});
