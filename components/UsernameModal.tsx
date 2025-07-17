import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch } from 'react-redux';
import { setName } from '@/redux/store/userSlice';

interface UsernameModalProps {
  visible: boolean;
  currentName?: string;
  onClose: () => void;
}

const UsernameModal: React.FC<UsernameModalProps> = ({ visible, currentName = '', onClose }) => {
  const [name, setNameInput] = useState(currentName);
  const dispatch = useDispatch();

  // Update the local state when currentName prop changes
  React.useEffect(() => {
    setNameInput(currentName);
  }, [currentName]);

  const handleSave = () => {
    if (name.trim()) {
      dispatch(setName(name.trim()));
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <MaterialCommunityIcons name="close" size={24} color="#94A3B8" />
          </TouchableOpacity>
          
          <Text style={styles.modalTitle}>Edit Your Name</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            value={name}
            onChangeText={setNameInput}
            autoFocus
            maxLength={20}
          />
          
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              style={styles.cancelButton} 
              onPress={onClose}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.saveButton, !name.trim() && styles.disabledButton]} 
              onPress={handleSave}
              disabled={!name.trim()}
            >
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 350,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 20,
    textAlign: 'center',
    fontFamily: 'Inter-SemiBold',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    fontSize: 16,
    fontFamily: 'Inter-Medium',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  cancelButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 12,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#64748B',
    fontWeight: '600',
    fontFamily: 'Inter-SemiBold',
  },
  saveButton: {
    backgroundColor: '#B1F70F',
    borderRadius: 8,
    padding: 12,
    flex: 1,
    marginLeft: 10,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#1E293B',
    fontWeight: '600',
    fontFamily: 'Inter-SemiBold',
  },
});

export default UsernameModal;