import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, updateDoc, arrayUnion } from 'firebase/firestore';
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
    scopes: [
    'https://www.googleapis.com/auth/drive.file', 
    'https://www.googleapis.com/auth/spreadsheets'
  ],
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
  photoURL?: string;
  phoneNumber?: string;
}

export interface UserTrackingData {
  uid: string;
  email: string;
  name: string;
  photoURL?: string;
  phoneNumber?: string;
  authProvider: 'google' | 'email' | 'anonymous';
  authProviderId?: string;
  designation: 'admin' | 'manager' | 'worker' | string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  sheetId?: string;
  folderId?: string;
  companyId?: string;
  workerId?: string;
  createdAt: string;
  lastLoginAt: string;
  loginCount: number;
  isActive: boolean;
}

const saveUserTrackingData = async (userData: Partial<UserTrackingData>, isUpdate = false) => {
  try {
    const userRef = doc(db, 'user_tracking', userData.uid!);
    const existingDoc = await getDoc(userRef);
    
    const now = new Date().toISOString();
    
    if (existingDoc.exists() && isUpdate) {
      const existingData = existingDoc.data() as UserTrackingData;
      await updateDoc(userRef, {
        ...userData,
        lastLoginAt: now,
        loginCount: (existingData.loginCount || 0) + 1,
      });
      console.log('User tracking data updated:', userData.uid);
    } else if (!existingDoc.exists()) {
      await setDoc(userRef, {
        ...userData,
        createdAt: now,
        lastLoginAt: now,
        loginCount: 1,
        isActive: true,
      });
      console.log('User tracking data created:', userData.uid);
    }
  } catch (error) {
    console.error('Error saving user tracking data:', error);
  }
};

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
    
    const googleUserInfo: GoogleUserInfo = {
      email: userInfo.data?.user?.email || '',
      name: userInfo.data?.user?.name || '',
      idToken,
      photoURL: userInfo.data?.user?.photo || '',
    };
    
    return {
      success: true,
      user: userCredential.user,
      googleUserInfo,
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

export const checkOrCreateUser = async (
  uid: string, 
  email: string, 
  name: string, 
  authProvider: 'google' | 'email' = 'email',
  photoURL?: string
): Promise<UserData> => {
  const userDoc = await getDoc(doc(db, 'users', uid));
  
  if (!userDoc.exists()) {
    const userData = {
      email,
      name,
      designation: 'admin',
      createdAt: new Date().toISOString(),
      isNewUser: true,
    };
    
    await setDoc(doc(db, 'users', uid), userData);
    
    await saveUserTrackingData({
      uid,
      email,
      name,
      photoURL,
      authProvider,
      authProviderId: authProvider === 'google' ? uid : undefined,
      designation: 'admin',
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
  
  await saveUserTrackingData({
    uid,
    email: userData.email || email,
    name: userData.name || name,
    designation: userData.designation || 'admin',
    companyName: userData.companyName,
    companyAddress: userData.companyAddress,
    companyPhone: userData.companyPhone,
    companyEmail: userData.companyEmail,
    sheetId: userData.sheetId,
    folderId: userData.folderId,
  }, true);
  
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

export const saveWorkerToTracking = async (workerData: {
  workerId: string;
  name: string;
  email: string;
  phone: string;
  companyId: string;
  sheetId: string;
}) => {
  try {
    const workersRef = collection(db, 'worker_tracking');
    const q = query(workersRef, where('workerId', '==', workerData.workerId));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      await addDoc(workersRef, {
        ...workerData,
        createdAt: new Date().toISOString(),
        isActive: true,
      });
      console.log('Worker tracking data created:', workerData.workerId);
    } else {
      const docRef = querySnapshot.docs[0].ref;
      await updateDoc(docRef, {
        ...workerData,
        lastUpdatedAt: new Date().toISOString(),
        isActive: true,
      });
      console.log('Worker tracking data updated:', workerData.workerId);
    }
  } catch (error) {
    console.error('Error saving worker tracking data:', error);
  }
};

export const updateCompanyTracking = async (companyId: string, userId: string, companyName: string) => {
  try {
    const companiesRef = collection(db, 'company_tracking');
    const q = query(companiesRef, where('companyId', '==', companyId));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      await addDoc(companiesRef, {
        companyId,
        companyName,
        ownerId: userId,
        createdAt: new Date().toISOString(),
        isActive: true,
        workerCount: 0,
      });
      console.log('Company tracking data created:', companyId);
    }
  } catch (error) {
    console.error('Error updating company tracking data:', error);
  }
};

export const updateUserDriveFolder = async (uid: string, folderId: string) => {
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      folderId: folderId,
    });
    console.log('User Drive folder ID updated in Firestore:', uid);
  } catch (error) {
    console.error('Error updating user Drive folder ID:', error);
    throw error;
  }
};

export const getAllUsers = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'user_tracking'));
    const users: UserTrackingData[] = [];
    querySnapshot.forEach((doc) => {
      users.push(doc.data() as UserTrackingData);
    });
    return users;
  } catch (error) {
    console.error('Error fetching all users:', error);
    return [];
  }
};

export const getUsersByCompany = async (companyId: string) => {
  try {
    const querySnapshot = await getDocs(
      query(collection(db, 'user_tracking'), where('companyId', '==', companyId))
    );
    const users: UserTrackingData[] = [];
    querySnapshot.forEach((doc) => {
      users.push(doc.data() as UserTrackingData);
    });
    return users;
  } catch (error) {
    console.error('Error fetching users by company:', error);
    return [];
  }
};

export const getAllWorkers = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'worker_tracking'));
    const workers: any[] = [];
    querySnapshot.forEach((doc) => {
      workers.push(doc.data());
    });
    return workers;
  } catch (error) {
    console.error('Error fetching all workers:', error);
    return [];
  }
};

export const getAllCompanies = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'company_tracking'));
    const companies: any[] = [];
    querySnapshot.forEach((doc) => {
      companies.push(doc.data());
    });
    return companies;
  } catch (error) {
    console.error('Error fetching all companies:', error);
    return [];
  }
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
