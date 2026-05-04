import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Modal,
  StatusBar,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useDispatch } from 'react-redux';
import { setUserAuthenticated, setWorkerProfile } from '@/redux/store/userSlice';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signInWithEmail, signInWithGoogle, checkOrCreateUser } from '@/assets/services/firebaseService';
import WorkerVerifyModal from '@/components/WorkerVerifyModal';

export default function LoginScreen() {
  const [joinLink, setJoinLink] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [workerVerifyVisible, setWorkerVerifyVisible] = useState(false);
  const [fetchedWorkerData, setFetchedWorkerData] = useState<any>(null);
  const [inlineError, setInlineError] = useState('');
  
  const router = useRouter();
  const dispatch = useDispatch();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const passwordRegex = /^(?=.*[0-9]).{8,}$/;
  const isEmailValid = emailRegex.test(email);
  const isPasswordValid = passwordRegex.test(password);

  const handleJoinLink = async () => {
    if (!joinLink.trim()) {
      setInlineError('Please enter a join link');
      return;
    }
    setInlineError('');
    setLoading(true);
    
    try {
      const url = new URL(joinLink);
      const sheetId = url.searchParams.get('sheetId');
      const token = url.searchParams.get('token');
      const companyId = url.searchParams.get('companyId');

      if (!sheetId || !token || !companyId) {
        setInlineError('Invalid or expired link');
        setLoading(false);
        return;
      }

      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Workers?key=${token}`
      );

      if (!response.ok) {
        setInlineError('Link not recognized. Please check with your admin.');
        setLoading(false);
        return;
      }

      const data = await response.json();
      
      if (!data.values || data.values.length === 0) {
        setInlineError('Link not recognized. Please check with your admin.');
        setLoading(false);
        return;
      }

      const headers = data.values[0];
      const rows = data.values.slice(1);
      
      const workerRow = rows.find((row: string[]) => {
        const workerEmail = row[headers.indexOf('Email')]?.trim().toLowerCase() || '';
        return workerEmail !== '';
      });

      if (!workerRow) {
        setInlineError('Link not recognized. Please check with your admin.');
        setLoading(false);
        return;
      }

      const workerData = {
        workerId: workerRow[headers.indexOf('WorkerID')] || '',
        name: workerRow[headers.indexOf('Name')] || '',
        email: workerRow[headers.indexOf('Email')] || '',
        phone: workerRow[headers.indexOf('Phone')] || '',
        payPerHour: workerRow[headers.indexOf('PayPerHour')] || '0',
        designation: workerRow[headers.indexOf('Designation')] || 'worker',
        joinDate: workerRow[headers.indexOf('JoinDate')] || '',
        sheetId,
        token,
        companyId,
      };

      setFetchedWorkerData(workerData);
      setWorkerVerifyVisible(true);
    } catch {
      setInlineError('Invalid or expired link');
    } finally {
      setLoading(false);
    }
  };

  const handleWorkerVerify = (name: string, phone: string, email: string) => {
    if (!fetchedWorkerData) return;

    const phoneMatch = phone.trim().toLowerCase() === fetchedWorkerData.phone.trim().toLowerCase();
    const emailMatch = email.trim().toLowerCase() === fetchedWorkerData.email.trim().toLowerCase();

    if (!phoneMatch || !emailMatch) {
      Alert.alert('Error', "Details don't match. Please check with your admin.");
      return;
    }

    dispatch(setWorkerProfile({
      workerId: fetchedWorkerData.workerId,
      name: fetchedWorkerData.name,
      email: fetchedWorkerData.email,
      phone: fetchedWorkerData.phone,
      payPerHour: parseFloat(fetchedWorkerData.payPerHour) || 0,
      designation: 'worker',
      companyName: fetchedWorkerData.companyName || 'Company',
      sheetId: fetchedWorkerData.sheetId,
      companyId: fetchedWorkerData.companyId,
    }));

    router.replace('/(tabs)/home');
  };

  const checkIfNewUser = async (uid: string, email: string, name: string) => {
    const userData = await checkOrCreateUser(uid, email, name);
    
    if (userData.isNewUser) {
      return true;
    }

    dispatch(setUserAuthenticated({
      uid: userData.uid,
      email: userData.email,
      name: userData.name,
      designation: userData.designation as 'admin' | 'manager' | 'worker',
      companyName: userData.companyName,
      companyAddress: userData.companyAddress,
      companyPhone: userData.companyPhone,
      companyEmail: userData.companyEmail,
      sheetId: userData.sheetId,
      folderId: userData.folderId,
      isNewUser: false,
    }));
    router.replace('/(tabs)/home');
    return false;
  };

  const handleEmailLogin = async () => {
    if (!isEmailValid || !isPasswordValid) {
      Alert.alert('Error', 'Please enter valid email and password');
      return;
    }

    setLoading(true);
    const result = await signInWithEmail(email, password);
    
    if (result.success && result.user) {
      const isNew = await checkIfNewUser(result.user.uid, email, email.split('@')[0]);
      
      if (isNew) {
        dispatch(setUserAuthenticated({
          uid: result.user.uid,
          email,
          name: email.split('@')[0],
          designation: 'admin',
          isNewUser: true,
        }));
        router.replace('/profile-modal');
      }
    } else {
      Alert.alert('Error', result.error || 'Login failed');
    }
    setLoading(false);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const result = await signInWithGoogle();
    
    console.log('Google Sign-In Result:', JSON.stringify(result, null, 2));
    
    if (result.success && result.user) {
      const isNew = await checkIfNewUser(
        result.user.uid,
        result.email || '',
        result.name || ''
      );

      if (isNew) {
        dispatch(setUserAuthenticated({
          uid: result.user.uid,
          email: result.email || '',
          name: result.name || '',
          designation: 'admin',
          isNewUser: true,
        }));
        router.replace('/profile-modal');
      }
    } else if (result.error && result.error !== 'cancelled') {
      console.error('Google Sign-In Error:', result.error);
      Alert.alert('Google Sign-In Failed', result.error + '\n\nCheck console for details.');
    }
    setLoading(false);
  };

  return (
    <>
      <StatusBar hidden={true} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoContainer}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Join a Company Team</Text>
            <View style={styles.joinLinkRow}>
              <TextInput
                style={styles.joinLinkInput}
                placeholder="Paste join link here..."
                value={joinLink}
                onChangeText={setJoinLink}
                placeholderTextColor="#999"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.joinButton,
                  (!joinLink.trim() || loading) && styles.buttonDisabled,
                ]}
                onPress={handleJoinLink}
                disabled={!joinLink.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.joinButtonText}>Join</Text>
                )}
              </TouchableOpacity>
            </View>
            {inlineError ? (
              <Text style={styles.inlineError}>{inlineError}</Text>
            ) : null}
          </View>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.orText}>(or)</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Manage Your Company</Text>
            <TextInput
              style={[styles.input, !isEmailValid && email.length > 0 && styles.inputError]}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              placeholderTextColor="#999"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!isEmailValid && email.length > 0 && (
              <Text style={styles.validationError}>Please enter a valid email address</Text>
            )}

            <TextInput
              style={[styles.input, !isPasswordValid && password.length > 0 && styles.inputError]}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              placeholderTextColor="#999"
              secureTextEntry
              autoCapitalize="none"
            />
            {!isPasswordValid && password.length > 0 && (
              <Text style={styles.validationError}>
                Password must be at least 8 characters with at least one number
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.loginButton,
                (!isEmailValid || !isPasswordValid || loading) && styles.buttonDisabled,
              ]}
              onPress={handleEmailLogin}
              disabled={!isEmailValid || !isPasswordValid || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.loginButtonText}>Login</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.orText}>(or)</Text>
            <View style={styles.line} />
          </View>

          <TouchableOpacity
            style={styles.googleButton}
            onPress={handleGoogleSignIn}
            disabled={loading}
          >
            <MaterialCommunityIcons name="google" size={24} color="#DB4437" />
            <Text style={styles.googleButtonText}>
              {loading ? 'Signing in...' : 'Continue with Google'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <WorkerVerifyModal
        visible={workerVerifyVisible}
        onClose={() => {
          setWorkerVerifyVisible(false);
          setFetchedWorkerData(null);
        }}
        onVerify={handleWorkerVerify}
        workerData={fetchedWorkerData}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: {
    width: 150,
    height: 150,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  joinLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  joinLinkInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginRight: 10,
    backgroundColor: '#f9f9f9',
    fontSize: 16,
  },
  joinButton: {
    backgroundColor: '#00af5bff',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  inlineError: {
    color: '#F44336',
    fontSize: 14,
    marginTop: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#ccc',
  },
  orText: {
    marginHorizontal: 12,
    color: '#999',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#f9f9f9',
    fontSize: 16,
  },
  inputError: {
    borderColor: '#F44336',
  },
  validationError: {
    color: '#F44336',
    fontSize: 12,
    marginBottom: 10,
  },
  loginButton: {
    backgroundColor: '#00af5bff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  loginButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  googleButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 15,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    color: '#333',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 10,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
