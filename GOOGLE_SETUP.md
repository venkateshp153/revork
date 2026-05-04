# Google Sign-In & Google Cloud Console Setup Guide

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Create Project** or select existing project
3. Name it "Revork" (or your preferred name)
4. Click **Create**

## Step 2: Enable Required APIs

1. In Google Cloud Console, go to **APIs & Services** → **Library**
2. Search and enable these APIs:
   - **Google Sheets API**
   - **Google Drive API**
   - **Google People API** (for user info)

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type
3. Click **Create**
4. Fill in:
   - **App name**: Revork
   - **User support email**: your-email@gmail.com
   - **Developer contact email**: your-email@gmail.com
5. Click **Save and Continue**
6. **Scopes**: Add these scopes:
   - `.../auth/spreadsheets`
   - `.../auth/drive`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
7. Click **Save and Continue**
8. **Test users**: Add your Google email as test user
9. Click **Save and Continue**

## Step 4: Create OAuth 2.0 Credentials

### For Android:

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select **Android**
4. Fill in:
   - **Name**: Revork Android
   - **Package name**: `com.venky534.revork`
   - **SHA-1 certificate fingerprint**: 
     ```
     # Run this command to get your SHA-1:
     cd C:\Users\ALIENWARE\Downloads\ReactNative\revork\android
     ./gradlew signingReport
     ```
5. Click **Create**
6. Copy the **Client ID** (looks like: `xxxxx.apps.googleusercontent.com`)

### For iOS:

1. Click **Create Credentials** → **OAuth client ID**
2. Select **iOS**
3. Fill in:
   - **Name**: Revork iOS
   - **Bundle ID**: `com.venky534.revork`
4. Click **Create**
5. Copy the **Client ID**

### For Web (required for Google Sign-In):

1. Click **Create Credentials** → **OAuth client ID**
2. Select **Web application**
3. Name: Revork Web
4. **Authorized redirect URIs**: Add `https://auth.expo.io/@venky534/revork`
5. Click **Create**
6. Copy the **Web Client ID**

## Step 5: Update App Configuration

### Update `app/(auth)/login.tsx`:

```typescript
GoogleSignin.configure({
  webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com', // From Step 4
  offlineAccess: true,
  forceCodeForRefreshToken: true,
  iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com', // Optional, for iOS
});
```

### Update `app.json`:

```json
"plugins": [
  "expo-router",
  [
    "@react-native-google-signin/google-signin",
    {
      "iosUrlScheme": "com.googleusercontent.apps.YOUR_IOS_CLIENT_ID"
    }
  ]
]
```

## Step 6: Get SHA-1 Fingerprint (Android)

Run this in your project directory:

```bash
cd C:\Users\ALIENWARE\Downloads\ReactNative\revork
npx expo run:android
```

Or manually:

```bash
cd C:\Users\ALIENWARE\.android
keytool -list -v -keystore debug.keystore -alias androiddebugkey -storepass android -keypass android
```

## Step 7: Create API Key for Google Sheets (Optional - for public sheets)

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **API Key**
3. Copy the API key
4. Add to `.env` file:

```env
EXPO_PUBLIC_API_KEY=YOUR_API_KEY_HERE
EXPO_PUBLIC_SHEET_ID=YOUR_SPREADSHEET_ID
EXPO_PUBLIC_SHEET_NAME=MyProfile
EXPO_PUBLIC_RANGE=A1:E100
EXPO_PUBLIC_SHEETS_URL=https://sheets.googleapis.com/v4/spreadsheets/
```

## Step 8: Test Google Sign-In

1. Run the app:
   ```bash
   npm start
   ```
2. Press `a` for Android or `i` for iOS
3. Click "Login/Signup with Google"
4. Select your test account
5. You should be redirected to profile modal

## Troubleshooting

### Error: "Sign in failed"
- Check SHA-1 fingerprint is correct
- Verify package name matches
- Ensure OAuth consent screen is configured

### Error: "Network error"
- Check internet connection
- Verify APIs are enabled
- Check web client ID is correct

### Error: "Access denied"
- Ensure test user is added to OAuth consent
- Check app is in testing mode (not published)

## Additional Resources

- [Google Sign-In Documentation](https://github.com/react-native-google-signin/google-signin)
- [Google Sheets API Docs](https://developers.google.com/sheets/api)
- [Google Drive API Docs](https://developers.google.com/drive/api)
