# 🔧 Fix DEVELOPER_ERROR in Google Sign-In

## ⚠️ The Problem

**DEVELOPER_ERROR** occurs because:
1. You're using **Expo Go** which doesn't support native Google Sign-In
2. Your **SHA-1 fingerprint** is not registered in Google Cloud Console
3. You need a **Development Build** instead of Expo Go

---

## ✅ Solution: Step-by-Step

### **Step 1: Get Your SHA-1 Signing Certificate Fingerprint**

You need the SHA-1 from your debug keystore:

```powershell
# Run this in your project root
keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
```

**Copy the SHA-1 fingerprint** (looks like: `A1:B2:C3:...`)

---

### **Step 2: Add SHA-1 to Firebase Console**

1. Go to **Firebase Console**: https://console.firebase.google.com/
2. Select your project: **revork-e7d8a**
3. Click **⚙️ Settings** → **Project settings**
4. Scroll to **"Your apps"** section
5. Select your **Android app** (com.venky534.revork)
6. Click **"Add fingerprint"**
7. Paste your **SHA-1** fingerprint
8. Click **Save**

---

### **Step 3: Enable Google Sign-In in Firebase**

1. In Firebase Console → **Authentication** → **Sign-in method**
2. Click **Google** 
3. Enable it
4. Copy the **Web SDK configuration** client ID
5. Make sure it matches your `.env`:
   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=410003590123-s6gk4aoc4uh77u7eafs8l19d2v7api5n.apps.googleusercontent.com
   ```

---

### **Step 4: Create Development Build**

**You CANNOT use Expo Go** for Google Sign-In. You must create a development build:

```powershell
# Option A: Build locally (faster for testing)
npx expo run:android

# Option B: Build with EAS (recommended for production)
npm install -g eas-cli
eas build --platform android --profile development
```

---

### **Step 5: Update app.json with SHA-1 (Optional but Recommended)**

Add your SHA-1 to app.json for automatic configuration:

```json
{
  "expo": {
    "android": {
      "package": "com.venky534.revork",
      "googleServicesFile": "./google-services.json",
      "edgeToEdgeEnabled": true,
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "config": {
        "googleSignIn": {
          "certificateHash": "YOUR_SHA1_FINGERPRINT_HERE"
        }
      }
    }
  }
}
```

---

### **Step 6: Verify Google Cloud Console Settings**

1. Go to **Google Cloud Console**: https://console.cloud.google.com/
2. Select your project: **revork-e7d8a**
3. Navigate to **APIs & Services** → **Credentials**
4. Find your **OAuth 2.0 Client ID** (Android)
5. Verify:
   - **Package name**: `com.venky534.revork` ✓
   - **SHA-1**: Your debug keystore fingerprint ✓

---

## 🚀 Quick Fix Commands

### **Get SHA-1 Fingerprint:**
```powershell
keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android | findstr "SHA1"
```

### **Create Development Build:**
```powershell
# Clean previous builds
npx expo prebuild --clean

# Build and run on Android
npx expo run:android
```

### **Build with EAS (Cloud Build):**
```powershell
# Install EAS CLI
npm install -g eas-cli

# Login to EAS
eas login

# Configure EAS
eas build:configure

# Build for Android (Development)
eas build --platform android --profile development

# Build for Android (Production)
eas build --platform android --profile production
```

---

## 📱 Testing Google Sign-In

### **DO NOT use Expo Go:**
```
❌ expo start --go
❌ Scan QR code with Expo Go app
```

### **DO use Development Build:**
```
✅ npx expo run:android
✅ Install the built APK on your device/emulator
✅ Test Google Sign-In
```

---

## 🔍 Debugging Checklist

- [ ] **SHA-1 fingerprint added to Firebase Console**
- [ ] **SHA-1 fingerprint added to Google Cloud Console**
- [ ] **Package name matches**: `com.venky534.revork`
- [ ] **google-services.json** is in project root
- [ ] **EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID** in .env is correct
- [ ] **Using Development Build** (NOT Expo Go)
- [ ] **Google Sign-In plugin** configured in app.json
- [ ] **Firebase Authentication** → Google provider is enabled

---

## 📂 Required Files Check

### **1. google-services.json**
**Location:** `C:\Users\ALIENWARE\Downloads\ReactNative\revork\google-services.json`

**Verify package_name:**
```json
{
  "client": [
    {
      "client_info": {
        "android_client_info": {
          "package_name": "com.venky534.revork"  // ✓ Must match
        }
      }
    }
  ]
}
```

### **2. app.json**
**Location:** `C:\Users\ALIENWARE\Downloads\ReactNative\revork\app.json`

**Verify android.package:**
```json
{
  "expo": {
    "android": {
      "package": "com.venky534.revork"  // ✓ Must match google-services.json
    }
  }
}
```

### **3. .env**
**Location:** `C:\Users\ALIENWARE\Downloads\ReactNative\revork\.env`

**Verify Google OAuth:**
```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=410003590123-s6gk4aoc4uh77u7eafs8l19d2v7api5n.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=1058954361230-ksl2nk7actihrbtd1nsgo9rldd2oup2u.apps.googleusercontent.com
```

---

## 🎯 Common Mistakes

### **❌ Mistake 1: Using Expo Go**
```
Expo Go does NOT support @react-native-google-signin/google-signin
```
**Fix:** Use Development Build

### **❌ Mistake 2: Missing SHA-1**
```
Firebase Console doesn't have your SHA-1 fingerprint
```
**Fix:** Add SHA-1 to Firebase Console

### **❌ Mistake 3: Package Name Mismatch**
```
google-services.json package ≠ app.json package
```
**Fix:** Ensure both are `com.venky534.revork`

### **❌ Mistake 4: Wrong Web Client ID**
```
Using iOS client ID for Android
```
**Fix:** Use Android web client ID in .env

---

## 🛠️ Alternative: Get Production SHA-1

When you're ready for production, get the SHA-1 from your keystore:

```powershell
keytool -list -v -keystore path\to\your\keystore.jks -alias your-alias -storepass your-password -keypass your-key-password
```

Add this SHA-1 to Firebase Console as well.

---

## 📞 Still Having Issues?

### **Check Google Sign-In Error:**
```typescript
// In firebaseService.ts, the error handling already logs details
console.error('Google Sign-In Error:', error);
```

### **Common Error Codes:**
- `SIGN_IN_CANCELLED` - User cancelled (not an error)
- `PLAY_SERVICES_NOT_AVAILABLE` - Google Play Services missing on device
- `IN_PROGRESS` - Sign-in already in progress
- `DEVELOPER_ERROR` - Configuration issue (follow this guide)

### **Test on Emulator:**
```powershell
# Make sure emulator has Google Play Services
# Use Pixel or other Google-certified emulator
```

---

## ✅ Final Verification

After completing all steps:

1. **Clean build:**
   ```powershell
   npx expo prebuild --clean
   ```

2. **Run development build:**
   ```powershell
   npx expo run:android
   ```

3. **Test Google Sign-In:**
   - Tap "Continue with Google"
   - Select Google account
   - Should successfully sign in
   - Check Firebase Console → Authentication (user should appear)
   - Check Firestore → user_tracking (document should be created)

---

**Google Sign-In will work after these steps!** 🎉
