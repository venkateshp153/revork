import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

if (!getApps().length) {
  initializeApp(firebaseConfig);
}

const auth = getAuth();
const db = getFirestore();

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  offlineAccess: true,
  forceCodeForRefreshToken: true,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

export interface UserData {
  uid: string;
  email: string;
  name: string;
  designation: 'admin' | 'manager' | 'worker' | string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  sheetId?: string;
  folderId?: string;
  isNewUser: boolean;
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  idToken: string;
}

export const signInWithEmail = async (email: string, password: string) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error: any) {
    let message = 'Login failed. Please try again.';
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      message = 'Incorrect email or password.';
    } else if (error.code === 'auth/email-already-in-use') {
      message = 'This email is already linked to another account.';
    }
    return { success: false, error: message };
  }
};

export const signInWithGoogle = async () => {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const userInfo = await GoogleSignin.signIn();
    
    const idToken = userInfo.data?.idToken;
    if (!idToken) {
      console.error('No ID token received');
      return { success: false, error: 'No ID token received' };
    }

    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);
    
    return {
      success: true,
      user: userCredential.user,
      email: userInfo.data?.user?.email || '',
      name: userInfo.data?.user?.name || '',
    };
  } catch (error: any) {
    console.error('Google Sign-In Error:', error);
    let message = 'Google sign-in failed';
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      message = 'Sign-in cancelled';
    } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      message = 'Google Play Services not available';
    } else if (error.code === statusCodes.IN_PROGRESS) {
      message = 'Sign-in already in progress';
    } else if (error.code === 'auth/invalid-credential') {
      message = 'Invalid Google OAuth configuration. Check Firebase Console.';
    } else if (error.message) {
      message = error.message;
    }
    return { success: false, error: message };
  }
};

export const checkOrCreateUser = async (uid: string, email: string, name: string): Promise<UserData> => {
  const userDoc = await getDoc(doc(db, 'users', uid));
  
  if (!userDoc.exists()) {
    await setDoc(doc(db, 'users', uid), {
      email,
      name,
      designation: 'admin',
      createdAt: new Date().toISOString(),
    });
    
    return {
      uid,
      email,
      name,
      designation: 'admin',
      isNewUser: true,
    };
  }

  const userData = userDoc.data();
  return {
    uid,
    email: userData.email || email,
    name: userData.name || name,
    designation: userData.designation || 'admin',
    companyName: userData.companyName || '',
    companyAddress: userData.companyAddress || '',
    companyPhone: userData.companyPhone || '',
    companyEmail: userData.companyEmail || '',
    sheetId: userData.sheetId || '',
    folderId: userData.folderId || '',
    isNewUser: false,
  };
};

export const signOutUser = async () => {
  try {
    await GoogleSignin.signOut();
    await signOut(auth);
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Sign out failed' };
  }
};

export { auth, db };
