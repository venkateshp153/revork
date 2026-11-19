import React, { useEffect, useState } from 'react';
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
  StatusBar,
  Platform,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useDispatch } from 'react-redux';
import { setUserAuthenticated, setWorkerProfile } from '@/redux/store/userSlice';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { findAnyWorkspaceFolder, findFolderByName, findSheetInFolder } from '@/src/utils/checkDriveFolder';
import { createGoogleDriveStructure } from '@/src/utils/createGoogleDriveStructure';
import { signInWithGoogle, checkOrCreateUser, saveWorkerToTracking, updateCompanyTracking, updateUserDriveFolder } from '@/assets/services/firebaseService';
import { ensureAdminWorkerRow } from '@/src/utils/workerManagement';
import { ensurePublicReadAccess, getGoogleAccessToken } from '@/src/utils/sheets';
import {
  clearGoogleSession,
  resolveGoogleEmail,
  signInWithGoogleWorkspace,
} from '@/src/services/googleAuth';
import { parseWorkerJoinLink, sheetIdVariants, JOIN_LINK_SCHEME } from '@/src/utils/joinLink';
import { describeDriveLocation } from '@/src/utils/drivePaths';
import WorkerVerifyModal from '@/components/WorkerVerifyModal';

function linkFromParams(params: {
  sheetId?: string;
  workerId?: string;
  companyId?: string;
  v?: string;
}): string {
  const sheetId = (params.sheetId || '').trim();
  if (!sheetId) return '';
  const query = [
    ['v', params.v || '2'],
    ['sheetId', sheetId],
    ['workerId', (params.workerId || '').trim()],
    ['companyId', (params.companyId || '').trim()],
  ]
    .filter(([, value]) => !!value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${JOIN_LINK_SCHEME}://login?${query}`;
}

/** True when the admin account can read the saved workspace spreadsheet. */
async function canReadSheet(sheetId: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export default function LoginScreen() {
  const joinParams = useLocalSearchParams<{
    sheetId?: string;
    workerId?: string;
    companyId?: string;
    v?: string;
  }>();
  const { sheetId: paramSheetId, workerId: paramWorkerId } = joinParams;
  const { companyId: paramCompanyId, v: paramVersion } = joinParams;
  const deepLinkUrl = Linking.useURL();
  const [joinLink, setJoinLink] = useState(() => linkFromParams(joinParams));
  const [loading, setLoading] = useState(false);
  const [workerVerifyVisible, setWorkerVerifyVisible] = useState(false);
  const [joinLoadingVisible, setJoinLoadingVisible] = useState(false);
  const [fetchedWorkerData, setFetchedWorkerData] = useState<any>(null);
  const [fetchedWorkerCandidates, setFetchedWorkerCandidates] = useState<any[]>([]);
  const [inlineError, setInlineError] = useState('');
  // Popup shown while logging in a returning (already registered) account
  const [existingAccountPopup, setExistingAccountPopup] = useState(false);
  
  const router = useRouter();
  const dispatch = useDispatch();

  useEffect(() => {
    console.log('[AuthDebug 17c] Login screen mounted ✔ (destination reached — exit flow successful)');
  }, []);

  // If the app was opened from a shared link, pre-fill the join input so the
  // employee only has to tap "Join".
  useEffect(() => {
    const fromParams = linkFromParams({
      sheetId: paramSheetId,
      workerId: paramWorkerId,
      companyId: paramCompanyId,
      v: paramVersion,
    });
    if (fromParams) setJoinLink(fromParams);
  }, [paramSheetId, paramWorkerId, paramCompanyId, paramVersion]);

  // `useLocalSearchParams` can be empty when the app cold-starts through the
  // splash route. Reading the raw URL guarantees the invite is still captured.
  useEffect(() => {
    if (!deepLinkUrl) return;
    const parsed = parseWorkerJoinLink(deepLinkUrl);
    if (parsed) setJoinLink(deepLinkUrl);
  }, [deepLinkUrl]);

  const handleJoinLink = async () => {
    if (!joinLink.trim()) {
      setInlineError('Please enter a join link');
      return;
    }
    setInlineError('');
    setLoading(true);
    setJoinLoadingVisible(true);

    try {
      const link = parseWorkerJoinLink(joinLink);

      if (!link) {
        setInlineError('Invalid or expired link');
        setLoading(false);
        return;
      }

      const { sheetId, companyId } = link;
      let resolvedSheetId = sheetId;

      const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
      const workersUrlFor = (id: string) =>
        `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/Workers`;

      // 1. Identify the worker's Google account first. The spreadsheet is
      //    shared with a specific email, so this is the account that must be
      //    used. (The account is also used to read private sheets.)
      let googleToken = await getGoogleAccessToken(true);
      let googleEmail = googleToken
        ? (await resolveGoogleEmail(googleToken)) || ''
        : '';
      let googleScopes: string[] = [];

      const readWorkers = (id: string, token: string | null) =>
        fetch(
          token ? workersUrlFor(id) : `${workersUrlFor(id)}?key=${apiKey}`,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
        );

      // 2. Prefer the worker's OAuth token. Fall back to the public API key,
      //    then to a fresh account choice if the first account cannot read it.
      let response: Response | null = googleToken
        ? await readWorkers(resolvedSheetId, googleToken)
        : null;
      if ((!response || !response.ok) && apiKey) {
        response = await readWorkers(resolvedSheetId, null);
      }

      // A 403/404 often means the opaque id was copied with a visual mistake
      // (0 vs O, 1 vs l/I). Try those variants BEFORE prompting for another
      // Google account. Otherwise a simple typo causes a second account picker.
      if (
        (!response || !response.ok) &&
        (response?.status === 403 || response?.status === 404)
      ) {
        for (const candidate of sheetIdVariants(resolvedSheetId)) {
          if (candidate === resolvedSheetId) continue;
          let candidateResponse: Response | null = googleToken
            ? await readWorkers(candidate, googleToken)
            : null;
          if ((!candidateResponse || !candidateResponse.ok) && apiKey) {
            candidateResponse = await readWorkers(candidate, null);
          }
          if (candidateResponse?.ok) {
            resolvedSheetId = candidate;
            response = candidateResponse;
            console.log('[JoinLink] Recovered sheet id variant:', candidate);
            break;
          }
        }
      }

      // Only now, if the sheet still cannot be read, ask for a different
      // Google account (the first one may not be the shared email).
      if (!response || !response.ok) {
        const fresh = await signInWithGoogleWorkspace();
        if (fresh?.accessToken) {
          googleToken = fresh.accessToken;
          googleEmail =
            fresh.email ||
            (await resolveGoogleEmail(fresh.accessToken)) ||
            googleEmail;
          googleScopes = fresh.scopes || [];
          response = await readWorkers(resolvedSheetId, googleToken);
        }
      }

      if (!response || !response.ok) {
        const status = response?.status || 0;
        const detail = response
          ? await response.text().catch(() => '')
          : 'no response';
        console.warn(
          '[JoinLink] Workers read failed:',
          status,
          detail,
          '| sheet:',
          resolvedSheetId,
          '| google account:',
          googleEmail || '(none)',
          '| scopes:',
          googleScopes
        );
        setInlineError(
          googleEmail
            ? `This spreadsheet is not accessible to ${googleEmail} (${status}). Ask your admin to open Profile → Copy workspace link, then share that exact sheet with ${googleEmail} as Viewer.`
            : 'Sign in with Google using the email your admin shared, then try again.'
        );
        setLoading(false);
        return;
      }

      // 3. We need a Google identity to match against the shared email.
      if (!googleEmail) {
        googleEmail = (await resolveGoogleEmail(googleToken)) || '';
      }
      if (!googleEmail) {
        setInlineError(
          'Sign in with Google using the email your admin shared, then try again.'
        );
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (!data.values || data.values.length === 0) {
        setInlineError('Link not recognized. Please check with your admin.');
        setLoading(false);
        return;
      }

      const headers: string[] = (data.values[0] || []).map((header: unknown) =>
        String(header).trim()
      );
      const rows: string[][] = data.values.slice(1);
      const valueOf = (row: string[], header: string) => {
        const index = headers.indexOf(header);
        return index >= 0 ? String(row[index] || '').trim() : '';
      };
      const digits = (value: string) => (value || '').replace(/\D/g, '');

      // Resolve every row that matches the link. Normally there is exactly
      // one; keeping all matches lets verify-time details disambiguate old
      // duplicate WorkerIDs.
      const matches = link.workerId
        ? rows.filter((row) => valueOf(row, 'WorkerID') === link.workerId)
        : link.email
        ? rows.filter(
            (row) => valueOf(row, 'Email').toLowerCase() === link.email
          )
        : link.phone
        ? rows.filter(
            (row) => digits(valueOf(row, 'Phone')) === link.phone
          )
        : [];

      if (matches.length === 0) {
        setInlineError('Link not recognized. Please check with your admin.');
        setLoading(false);
        return;
      }

      const usableMatches = matches.filter((row) => {
        const rowDesignation = valueOf(row, 'Designation').toLowerCase();
        const rowStatus = valueOf(row, 'Status').toLowerCase();
        return (
          rowDesignation !== 'admin' &&
          rowStatus !== 'inactive' &&
          rowStatus !== 'removed'
        );
      });

      if (usableMatches.length === 0) {
        const onlyAdmin = matches.every(
          (row) => valueOf(row, 'Designation').toLowerCase() === 'admin'
        );
        setInlineError(
          onlyAdmin
            ? 'This link belongs to an admin account. Sign in with Google instead.'
            : 'Your access has been removed. Please contact your admin.'
        );
        setLoading(false);
        return;
      }

      // 4. The signed-in Google account must match the email the admin shared
      //    for this worker. Only then do we let them into the tabs.
      const normalizedGoogleEmail = googleEmail.trim().toLowerCase();
      const emailMatches = usableMatches.filter(
        (row) => valueOf(row, 'Email').toLowerCase() === normalizedGoogleEmail
      );

      if (emailMatches.length === 0) {
        const sharedEmails = Array.from(
          new Set(
            usableMatches
              .map((row) => valueOf(row, 'Email').toLowerCase())
              .filter(Boolean)
          )
        );
        // Clear the sticky Google session so the next Join tap prompts the
        // worker to choose the account the admin shared with.
        await clearGoogleSession().catch(() => {});
        console.warn(
          '[JoinLink] Email mismatch. Signed in as',
          normalizedGoogleEmail,
          '| shared emails:',
          sharedEmails
        );
        setInlineError(
          `You signed in as ${normalizedGoogleEmail}, but this link belongs to ${
            sharedEmails.join(' or ') || 'another email'
          }. Tap Join again and choose that Google account.`
        );
        setLoading(false);
        return;
      }

      console.log(
        '[JoinLink] Access OK → google:',
        normalizedGoogleEmail,
        '| worker:',
        valueOf(emailMatches[0], 'WorkerID')
      );

      const candidates = emailMatches.map((row) => {
        const rowDesignation = valueOf(row, 'Designation').toLowerCase();
        return {
          workerId: valueOf(row, 'WorkerID'),
          name: valueOf(row, 'Name'),
          email: valueOf(row, 'Email').toLowerCase(),
          phone: digits(valueOf(row, 'Phone')),
          payPerHour: valueOf(row, 'PayPerHour') || '0',
          designation: rowDesignation === 'manager' ? 'manager' : 'worker',
          joinDate: valueOf(row, 'JoinDate'),
          sheetId: resolvedSheetId,
          companyId,
        };
      });

      setFetchedWorkerCandidates(candidates);
      setFetchedWorkerData(candidates[0]);
      setWorkerVerifyVisible(true);
    } catch {
      setInlineError('Invalid or expired link');
    } finally {
      setLoading(false);
      setJoinLoadingVisible(false);
    }
  };

  const handleWorkerVerify = async (name: string, phone: string, email: string) => {
    if (!fetchedWorkerData) return;

    const normalizeName = (value: string) =>
      value.trim().replace(/\s+/g, ' ').toLowerCase();
    const digitsOnly = (value: string) => (value || '').replace(/\D/g, '');

    const candidates =
      fetchedWorkerCandidates.length > 0
        ? fetchedWorkerCandidates
        : [fetchedWorkerData];

    const matched = candidates.find(
      (candidate) =>
        normalizeName(name) === normalizeName(candidate.name) &&
        digitsOnly(phone) === digitsOnly(candidate.phone) &&
        email.trim().toLowerCase() ===
          candidate.email.trim().toLowerCase()
    );

    if (!matched) {
      Alert.alert('Error', "Details don't match. Please check with your admin.");
      return;
    }

    dispatch(setWorkerProfile({
      workerId: matched.workerId,
      name: matched.name,
      email: matched.email,
      phone: matched.phone,
      payPerHour: parseFloat(matched.payPerHour) || 0,
      designation: 'worker',
      companyName: matched.companyName || 'Company',
      sheetId: matched.sheetId,
      companyId: matched.companyId,
    }));

    // Tracking is optional and must never delay reaching the tabs.
    void saveWorkerToTracking({
      workerId: matched.workerId,
      name: matched.name,
      email: matched.email,
      phone: matched.phone,
      companyId: matched.companyId,
      sheetId: matched.sheetId,
    });

    router.replace('/(tabs)/home');
  };

  const checkIfNewUser = async (uid: string, email: string, name: string, authProvider?: 'google' | 'email', photoURL?: string, accessToken?: string) => {
    console.log('[AuthDebug 7] checkIfNewUser → checking Firestore user (accessToken available:', accessToken ? 'YES' : 'NO', ')');
    // Read-only: new users are only written to Firestore after profile setup.
    const userData = await checkOrCreateUser(uid, email, name, authProvider || 'email', photoURL, {
      createIfMissing: false,
    });
    console.log('[AuthDebug 8] checkOrCreateUser result → isNewUser:', userData.isNewUser,
      '| companyName:', userData.companyName || '(empty)',
      '| folderId:', userData.folderId || '(empty)',
      '| sheetId:', userData.sheetId || '(empty)');
    
    // No company profile on record → send to onboarding. This covers both
    // brand-new accounts AND returning accounts whose onboarding never
    // completed, so the tabs guard (which needs a profile) can't bounce us.
    if (userData.isNewUser || !userData.companyName) {
      console.log('[AuthDebug 9] No company profile → routing to /profile-modal for setup');
      return true;
    }

    // Returning user → show the "already have an account" popup while their
    // workspace is restored. (The old pre-sign-in email lookup in the `users`
    // collection is rejected by Firestore rules — only the signed-in user's
    // own doc is readable, so this uid-based check is the source of truth.)
    setExistingAccountPopup(true);
    
    // Returning user with a company profile → resolve their workspace. The
    // folderId/sheetId saved in Firestore are used directly when present; if
    // they are missing, Drive is searched by the company folder name and, as
    // a last resort, a fresh folder + sheet is created and saved back.
    let folderId = userData.folderId || '';
    let sheetId = userData.sheetId || '';
    let joinLink = userData.joinLink || '';
    let needsWorkspaceRepair = !folderId || !sheetId;

    // The saved sheet may have been deleted or belong to a different Google
    // account. Validate it so the app never hands out links to a dead sheet.
    if (!needsWorkspaceRepair && accessToken) {
      const readable = await canReadSheet(sheetId, accessToken);
      if (!readable) {
        console.warn(
          '[AuthDebug 10] Saved sheet is not readable; repairing workspace:',
          sheetId
        );
        sheetId = '';
        needsWorkspaceRepair = true;
      }
    }

    if (accessToken && needsWorkspaceRepair) {
      try {
        if (!folderId) {
          const folderName = `${userData.companyName} WorkForce Data`;
          console.log('[AuthDebug 10a] No saved folderId → searching Drive for folder:', folderName);
          const folderCheck = await findFolderByName(accessToken, folderName);
          folderId = folderCheck.folderId;
          console.log('[AuthDebug 10a] Drive folder search →', folderId || '(none found)');
        }

        // One account = one workspace: fall back to any existing workspace
        // folder before creating a duplicate.
        if (!folderId) {
          const anyFolder = await findAnyWorkspaceFolder(accessToken);
          folderId = anyFolder.folderId;
          console.log('[AuthDebug 10a] Workspace folder fallback →', folderId || '(none)');
        }

        if (!sheetId && folderId) {
          sheetId = (await findSheetInFolder(accessToken, folderId)) || '';
          console.log('[AuthDebug 10b] Sheet found inside folder:', sheetId || '(none)');
        }

        if (!sheetId) {
          console.log('[AuthDebug 10c] No usable workspace → creating sheet for:', userData.companyName);
          const created = await createGoogleDriveStructure(
            userData.companyName,
            accessToken,
            userData.companyEmail || userData.email,
            folderId || undefined
          );
          folderId = created.folderId;
          sheetId = created.sheetId;
          joinLink = created.joinLink;
        }

        // Persist the resolved workspace so the next launch can restore it
        // straight from Firestore without touching Drive.
        if (folderId) {
          await updateUserDriveFolder(userData.uid, folderId, {
            email: userData.email,
            name: userData.name,
            companyName: userData.companyName,
            companyAddress: userData.companyAddress,
            companyPhone: userData.companyPhone,
            companyEmail: userData.companyEmail,
            sheetId,
            joinLink,
            isNewUser: false,
          });
        }
        console.log('[AuthDebug 10d] Workspace saved → folderId:', folderId, '| sheetId:', sheetId);
      } catch (error) {
        console.error('[AuthDebug 10] Drive workspace resolution failed (continuing with saved data):', error);
      }
    }

    const resolvedFolderId = folderId || userData.folderId || '';
    const resolvedSheetId = sheetId || userData.sheetId || '';
    const resolvedLocation = describeDriveLocation({
      companyName: userData.companyName,
      folderId: resolvedFolderId,
      sheetId: resolvedSheetId,
    });

    console.log('[AuthDebug 11] Dispatching setUserAuthenticated → routing to /(tabs)/home');
    dispatch(setUserAuthenticated({
      uid: userData.uid,
      email: userData.email,
      name: userData.name,
      designation: userData.designation as 'admin' | 'manager' | 'worker',
      companyName: userData.companyName,
      companyAddress: userData.companyAddress,
      companyPhone: userData.companyPhone,
      companyEmail: userData.companyEmail,
      sheetId: resolvedSheetId,
      folderId: resolvedFolderId,
      folderName: userData.folderName || resolvedLocation.folderName,
      folderUrl: userData.folderUrl || resolvedLocation.folderUrl,
      folderPath: userData.folderPath || resolvedLocation.folderPath,
      sheetUrl: userData.sheetUrl || resolvedLocation.sheetUrl,
      isNewUser: false,
    }));

    // Navigate immediately with the data already loaded from Firestore. The
    // workspace maintenance below is non-blocking and self-healing.
    router.replace('/(tabs)/home');
    console.log('[AuthDebug 12] Navigation to home requested ✔');

    void (async () => {
      try {
        // Persist the Drive folder id + path for existing accounts created
        // before these fields existed, so future logins need no Drive lookup.
        if (resolvedFolderId) {
          await updateUserDriveFolder(userData.uid, resolvedFolderId, {
            email: userData.email,
            name: userData.name,
            companyName: userData.companyName,
            companyAddress: userData.companyAddress,
            companyPhone: userData.companyPhone,
            companyEmail: userData.companyEmail,
            sheetId: resolvedSheetId,
            joinLink: userData.joinLink || joinLink,
            folderName: userData.folderName || resolvedLocation.folderName,
            folderUrl: userData.folderUrl || resolvedLocation.folderUrl,
            folderPath: userData.folderPath || resolvedLocation.folderPath,
            sheetUrl: userData.sheetUrl || resolvedLocation.sheetUrl,
          });
        }

        if (
          accessToken &&
          resolvedSheetId &&
          (userData.designation === 'admin' || !userData.designation)
        ) {
          await ensurePublicReadAccess(resolvedSheetId, accessToken);
          await ensureAdminWorkerRow(resolvedSheetId, accessToken, {
            uid: userData.uid,
            name: userData.name,
            email: userData.email,
            phone: userData.companyPhone,
          });
        }
        await updateCompanyTracking(
          'company_' + userData.uid,
          uid,
          userData.companyName || ''
        );
      } catch (error) {
        console.warn('[AuthDebug] Post-login workspace maintenance failed:', error);
      }
    })();

    return false;
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setInlineError('');
    setExistingAccountPopup(false);

    const result = await signInWithGoogle();

    console.log('[AuthDebug 0] signInWithGoogle returned → success:',
      result.success,
      '| uid:', result.success && result.user ? result.user.uid : '(no user)',
      '| accessToken:', 'accessToken' in result && result.accessToken ? 'obtained' : 'MISSING');

    if (result.success && result.user) {
      // Use the OAuth access token (NOT the idToken) for Drive API calls
      try {
        const isNew = await checkIfNewUser(
          result.user.uid,
          result.googleUserInfo?.email || '',
          result.googleUserInfo?.name || '',
          'google',
          result.googleUserInfo?.photoURL,
          'accessToken' in result ? result.accessToken : undefined
        );
        console.log('[AuthDebug 13] checkIfNewUser returned isNew:', isNew);

        if (isNew) {
          setExistingAccountPopup(false); // not an existing account after all
          console.log('[AuthDebug 14] New user → dispatch + routing to /profile-modal');
          dispatch(setUserAuthenticated({
            uid: result.user.uid,
            email: result.googleUserInfo?.email || '',
            name: result.googleUserInfo?.name || '',
            designation: 'admin',
            isNewUser: true,
          }));
          router.replace('/profile-modal');
          console.log('[AuthDebug 14] Navigation to /profile-modal requested ✔');
        } else {
          console.log('[AuthDebug 14] Returning user — navigation already handled in checkIfNewUser');
        }
      } catch (error: any) {
        console.error('[AuthDebug 0] Login flow failed after Google sign-in:', error);
        setExistingAccountPopup(false);
        Alert.alert(
          'Login Error',
          error?.message || 'Something went wrong after sign-in. Please try again.'
        );
      }
    } else {
      setExistingAccountPopup(false);
      if (result.error && result.error !== 'cancelled') {
        console.error('[AuthDebug 0] Google Sign-In failed:', result.error);
        Alert.alert('Google Sign-In Failed', result.error + '\n\nCheck console for details.');
      }
    }
    setLoading(false);
    console.log('[AuthDebug 15] handleGoogleSignIn complete');
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

      {/* Blocking loader while the invite is validated. It is a plain overlay
          (not a Modal) so the native Google account picker can appear above it. */}
      {joinLoadingVisible && (
        <View style={styles.joinLoadingBackdrop}>
          <View style={styles.joinLoadingCard}>
            <ActivityIndicator size="large" color="#00af5bff" />
            <Text style={styles.joinLoadingTitle}>Checking your invite…</Text>
            <Text style={styles.joinLoadingSubtitle}>
              Please wait while we verify your access.
            </Text>
          </View>
        </View>
      )}

      <WorkerVerifyModal
        visible={workerVerifyVisible}
        onClose={() => {
          setWorkerVerifyVisible(false);
          setFetchedWorkerData(null);
        }}
        onVerify={handleWorkerVerify}
        workerData={fetchedWorkerData}
      />

      {/* "Already have an account" popup — shown right after an existing
          account is picked, while logging in and loading the workspace */}
      <Modal
        visible={existingAccountPopup}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.popupBackdrop}>
          <View style={styles.popupCard}>
            <MaterialCommunityIcons name="account-check" size={40} color="#00af5bff" />
            <Text style={styles.popupTitle}>You already have an account!</Text>
            <Text style={styles.popupSubtitle}>
              Signing you in and loading your workspace…
            </Text>
            <ActivityIndicator color="#00af5bff" style={styles.popupSpinner} />
          </View>
        </View>
      </Modal>
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
  popupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 26,
    paddingHorizontal: 30,
    alignItems: 'center',
    marginHorizontal: 40,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  popupTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222',
    marginTop: 12,
    textAlign: 'center',
  },
  popupSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 6,
    textAlign: 'center',
  },
  popupSpinner: {
    marginTop: 16,
  },
  joinLoadingBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  joinLoadingCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    paddingVertical: 26,
    paddingHorizontal: 30,
    alignItems: 'center',
    marginHorizontal: 40,
    minWidth: 220,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  joinLoadingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 14,
    textAlign: 'center',
  },
  joinLoadingSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 6,
    textAlign: 'center',
  },
});
