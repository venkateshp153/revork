import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import { setName } from '@/redux/store/userSlice';

export default function UsernameScreen() {
  const [name, setNameInput] = useState('');
  const dispatch = useDispatch();

  const handleSave = () => {
    if (name.trim()) {
      dispatch(setName(name.trim()));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.modalContent}>
        <Text style={styles.title}>Welcome!</Text>
        <Text style={styles.subtitle}>Please enter your name to continue</Text>
        
        <TextInput
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChangeText={setNameInput}
          autoFocus
        />
        
        <TouchableOpacity 
          style={styles.button} 
          onPress={handleSave}
          disabled={!name.trim()}
        >
          <Text style={styles.buttonText}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#00af5bff',
    padding: 12,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});