import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  type Auth,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { configureGoogleSignin } from '@/src/services/googleAuth';
import { describeDriveLocation } from '@/src/utils/drivePaths';
import type { Persistence } from '@firebase/auth';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// firebase v12 no longer surfaces the React Native persistence helper through
// the `firebase/auth` typings (the runtime entrypoint still exports it), so
// declare it here to keep TypeScript in sync with what ships to the device.
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem: (key: string) => Promise<string | null | undefined>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  }): Persistence;
}

let auth: Auth;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    // Persist auth state across sessions (fixes "memory persistence" warning)
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // initializeAuth throws if auth was already initialized (e.g. hot reload)
    auth = getAuth(app);
  }
}
const db = getFirestore();

/** Firestore rejects `undefined` field values — strip them before writing. */
const sanitizeForFirestore = (
  data: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  );

// Shared with the Sheets/Drive helpers so a cold start into the tabs also has
// a usable Google session (see src/services/googleAuth.ts).
configureGoogleSignin();

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
  folderName?: string;
  folderUrl?: string;
  folderPath?: string;
  sheetUrl?: string;
  joinLink?: string;
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
        ...sanitizeForFirestore(userData),
        lastLoginAt: now,
        loginCount: (existingData.loginCount || 0) + 1,
      });
      console.log('[AuthDebug 6b] user_tracking/%s updated (login #%s). Written fields:',
        userData.uid,
        (existingData.loginCount || 0) + 1,
        Object.keys(sanitizeForFirestore(userData)).join(', '));
    } else if (!existingDoc.exists()) {
      await setDoc(userRef, {
        ...sanitizeForFirestore(userData),
        createdAt: now,
        lastLoginAt: now,
        loginCount: 1,
        isActive: true,
      });
      console.log('[AuthDebug 6b] user_tracking doc created for', userData.uid);
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
    console.log('[AuthDebug 1] Google button pressed → hasPlayServices…');
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    // Force the Google account chooser on every press. Without this, Google
    // can silently reuse the last account instead of listing the Gmail
    // accounts available on the device.
    try {
      await GoogleSignin.signOut();
      console.log('[AuthDebug 1b] Previous Google session cleared → showing account picker');
    } catch {
      // No previous Google session — the picker will appear anyway.
    }

    const userInfo = await GoogleSignin.signIn();
    console.log('[AuthDebug 2] Google chosen account email:', userInfo.data?.user?.email);

    const idToken = userInfo.data?.idToken;
    if (!idToken) {
      console.error('No ID token received');
      return { success: false, error: 'No ID token received' };
    }

    const credential = GoogleAuthProvider.credential(idToken);
    console.log('[AuthDebug 3] Signing into Firebase with Google credential…');
    const userCredential = await signInWithCredential(auth, credential);
    console.log('[AuthDebug 4] Firebase sign-in OK. uid:', userCredential.user.uid);

    // Drive/Sheets REST calls need an OAuth access token, not the idToken.
    // In google-signin v16, signIn() does not return accessToken — getTokens() does.
    let accessToken = '';
    try {
      const tokens = await GoogleSignin.getTokens();
      accessToken = tokens.accessToken || '';
      console.log('[AuthDebug 5] Drive access token obtained:', accessToken ? 'YES (length=' + accessToken.length + ')' : 'NO');
      console.log('[AuthDebug 5] Granted scopes:', JSON.stringify(userInfo.data?.scopes || []));
    } catch (tokenError) {
      console.error('[AuthDebug 5] Unable to fetch Google access token:', tokenError);
    }

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
      accessToken,
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
  photoURL?: string,
  options?: { createIfMissing?: boolean }
): Promise<UserData> => {
  console.log('[AuthDebug 6] Checking Firestore users doc for uid:', uid);
  const userDoc = await getDoc(doc(db, 'users', uid));

  if (!userDoc.exists()) {
    // Sign-in should only *check* the account. A brand-new user is not written
    // to Firestore until they finish the "Complete Your Profile" step.
    if (options?.createIfMissing === false) {
      console.log('[AuthDebug 6] No users doc → new user, deferring Firestore write');
      return {
        uid,
        email,
        name,
        designation: 'admin',
        isNewUser: true,
      };
    }

    console.log('[AuthDebug 6] NO existing users doc → creating brand-new admin account');
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
  console.log(
    '[AuthDebug 6] Existing users doc. Fields:',
    Object.keys(userData).join(', ')
  );
  console.log(
    '[AuthDebug 6] key values → companyName:',
    userData.companyName ?? '(missing)',
    '| folderId:',
    userData.folderId ?? '(missing)',
    '| sheetId:',
    userData.sheetId ?? '(missing)'
  );
  
  // Login tracking must never delay the tab navigation.
  void saveUserTrackingData({
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
  
  const location = describeDriveLocation({
    companyName: userData.companyName || '',
    folderId: userData.folderId || '',
    sheetId: userData.sheetId || '',
  });

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
    folderName: userData.folderName || location.folderName,
    folderUrl: userData.folderUrl || location.folderUrl,
    folderPath: userData.folderPath || location.folderPath,
    sheetUrl: userData.sheetUrl || location.sheetUrl,
    joinLink: userData.joinLink || '',
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
    // Link-based worker joins are not Firebase-authenticated, so Firestore
    // rules reject this write. Skip it instead of logging a permission error;
    // the workspace data itself lives in Google Sheets.
    if (!auth.currentUser) {
      console.log(
        '[WorkerTracking] Skipped (no Firebase session):',
        workerData.workerId
      );
      return;
    }
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
    console.log('[AuthDebug] updateCompanyTracking → companyId:', companyId, '| companyName:', companyName);
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

export const updateUserProfileFields = async (
  uid: string,
  fields: Record<string, unknown>
) => {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, sanitizeForFirestore(fields), { merge: true });
};

export const getUserWorkspace = async (uid: string) => {
  try {
    const snapshot = await getDoc(doc(db, 'users', uid));
    if (!snapshot.exists()) {
      return { folderId: '', sheetId: '', joinLink: '', companyName: '' };
    }
    const data = snapshot.data();
    return {
      folderId: data.folderId || '',
      sheetId: data.sheetId || '',
      joinLink: data.joinLink || '',
      companyName: data.companyName || '',
    };
  } catch (error) {
    console.error('[AuthDebug] Unable to read users/%s workspace:', uid, error);
    return { folderId: '', sheetId: '', joinLink: '', companyName: '' };
  }
};

export const updateUserDriveFolder = async (
  uid: string,
  folderId: string,
  extra?: Partial<{
    email: string;
    name: string;
    companyName: string;
    companyAddress: string;
    companyPhone: string;
    companyEmail: string;
    sheetId: string;
    joinLink: string;
    folderName: string;
    folderUrl: string;
    folderPath: string;
    sheetUrl: string;
    designation: string;
    isNewUser: boolean;
  }>
) => {
  try {
    const userRef = doc(db, 'users', uid);
    const location = describeDriveLocation({
      companyName: extra?.companyName || '',
      folderId,
      sheetId: extra?.sheetId || '',
    });
    const meta: Record<string, string> = {};
    if (extra?.folderName || location.folderName) {
      meta.folderName = extra?.folderName || location.folderName;
    }
    if (extra?.folderUrl || location.folderUrl) {
      meta.folderUrl = extra?.folderUrl || location.folderUrl;
      meta.folderPath = extra?.folderPath || location.folderUrl;
    }
    if (extra?.sheetUrl || location.sheetUrl) {
      meta.sheetUrl = extra?.sheetUrl || location.sheetUrl;
    }

    // Persist the full workspace (ids + Drive path) so returning users can be
    // restored from Firestore alone. merge:true creates the doc if missing.
    await setDoc(userRef, sanitizeForFirestore({
      folderId,
      ...extra,
      ...meta,
    }), { merge: true });
    console.log(
      '[AuthDebug] users/%s written (merge) with folderId + [%s]',
      uid,
      Object.keys(extra || {}).join(', ') || '(no extra fields)'
    );
  } catch (error) {
    console.error('[AuthDebug] Error updating user workspace data:', error);
    throw error;
  }
};

/**
 * Finalizes a brand-new admin account after the "Complete Your Profile" step.
 *
 * Sign-in only checks Firestore; this is the single place that writes the
 * account (users/{uid}), its analytics mirror (user_tracking/{uid}) and the
 * company record (company_tracking/...). The Drive folder + spreadsheet must
 * already have been created, and their ids are stored here.
 */
export const completeUserOnboarding = async (params: {
  uid: string;
  email: string;
  name: string;
  companyName: string;
  companyAddress?: string;
  companyPhone: string;
  companyEmail: string;
  folderId: string;
  folderName?: string;
  sheetId: string;
  joinLink: string;
  photoURL?: string;
  authProvider?: 'google' | 'email' | 'anonymous';
}): Promise<void> => {
  const now = new Date().toISOString();
  const userRef = doc(db, 'users', params.uid);
  const existing = await getDoc(userRef);
  const location = describeDriveLocation({
    companyName: params.companyName,
    folderId: params.folderId,
    sheetId: params.sheetId,
  });

  await setDoc(
    userRef,
    sanitizeForFirestore({
      uid: params.uid,
      email: params.email,
      name: params.name,
      designation: 'admin',
      companyName: params.companyName,
      companyAddress: params.companyAddress || '',
      companyPhone: params.companyPhone,
      companyEmail: params.companyEmail,
      folderId: params.folderId,
      folderName: params.folderName || location.folderName,
      folderUrl: location.folderUrl,
      folderPath: location.folderPath,
      sheetId: params.sheetId,
      sheetUrl: location.sheetUrl,
      joinLink: params.joinLink,
      isNewUser: false,
      updatedAt: now,
      ...(existing.exists() ? {} : { createdAt: now }),
    }),
    { merge: true }
  );

  await saveUserTrackingData(
    {
      uid: params.uid,
      email: params.email,
      name: params.name,
      photoURL: params.photoURL,
      authProvider: params.authProvider || 'google',
      designation: 'admin',
      companyName: params.companyName,
      companyAddress: params.companyAddress,
      companyPhone: params.companyPhone,
      companyEmail: params.companyEmail,
      folderId: params.folderId,
      sheetId: params.sheetId,
      companyId: `company_${params.uid}`,
    },
    true
  );

  await updateCompanyTracking(
    `company_${params.uid}`,
    params.uid,
    params.companyName
  );

  console.log('[AuthDebug] Onboarding completed for users/%s', params.uid);
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
  let googleOk = true;
  console.log('[AuthDebug 17b] signOutUser → Google sign out…');
  try {
    await GoogleSignin.signOut();
    console.log('[AuthDebug 17b] Google sign out ✔');
  } catch (error) {
    // Don't let a missing/failed Google session block Firebase sign-out,
    // otherwise the persisted Auth session survives and the app can
    // auto-restore the user instead of showing the login screen.
    console.error('[AuthDebug 17b] Google sign out failed (continuing to Firebase sign out):', error);
    googleOk = false;
  }
  console.log('[AuthDebug 17b] signOutUser → Firebase sign out…');
  try {
    await signOut(auth);
    console.log('[AuthDebug 17b] Firebase sign out ✔ (persisted Auth session cleared)');
  } catch (error) {
    console.error('[AuthDebug 17b] Firebase sign out FAILED:', error);
    return { success: false, error: 'Sign out failed' };
  }
  return { success: true, googleOk };
};

export { auth, db };
