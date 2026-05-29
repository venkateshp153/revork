# 🚀 Complete Google Sign-In Setup Guide for Revork

## ⚡ Quick Start - Follow These Steps in Order

---

## **STEP 1: Generate Debug Keystore**

Run this command to create your debug keystore:

```powershell
# Create .android directory if it doesn't exist
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.android"

# Generate debug keystore
keytool -genkey -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"
```

---

## **STEP 2: Get Your SHA-1 Fingerprint**

After generating the keystore, get the SHA-1:

```powershell
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

**Look for this line in the output:**
```
SHA1: AA:BB:CC:DD:EE:FF:... (copy this value)
```

**Example output:**
```
Certificate fingerprint (SHA1): 24:5A:CD:3F:B1:99:E4:3A:12:AB:CD:EF:78:90:12:34:56:78:90:AB
```

✅ **Copy the SHA-1 value** (you'll need it in Step 3)

---

## **STEP 3: Add SHA-1 to Firebase Console**

1. **Go to:** https://console.firebase.google.com/
2. **Select project:** `revork-e7d8a`
3. **Click:** ⚙️ Settings (gear icon) → **Project settings**
4. **Scroll to:** "Your apps" section
5. **Click:** Your Android app (`com.venky534.revork`)
6. **Click:** **"Add fingerprint"** button
7. **Paste:** Your SHA-1 from Step 2
8. **Click:** Save

**Example:**
```
SHA-1: 24:5A:CD:3F:B1:99:E4:3A:12:AB:CD:EF:78:90:12:34:56:78:90:AB
```

---

## **STEP 4: Verify Google Cloud Console**

1. **Go to:** https://console.cloud.google.com/
2. **Select project:** `revork-e7d8a`
3. **Navigate to:** APIs & Services → Credentials
4. **Find:** OAuth 2.0 Client ID (Android)
5. **Verify:**
   - Package name: `com.venky534.revork` ✓
   - SHA-1 certificate fingerprint: (should match your debug keystore)

**If SHA-1 is missing in Google Cloud:**
1. Click on the OAuth 2.0 Client ID
2. Add your SHA-1 fingerprint
3. Click Save

---

## **STEP 5: Enable Google Sign-In in Firebase**

1. **Firebase Console** → **Authentication** → **Sign-in method**
2. **Click:** Google
3. **Enable:** Toggle ON
4. **Verify:** Web SDK configuration matches your .env
   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=410003590123-s6gk4aoc4uh77u7eafs8l19d2v7api5n.apps.googleusercontent.com
   ```
5. **Click:** Save

---

## **STEP 6: Build Development Build**

**⚠️ IMPORTANT: You CANNOT use Expo Go for Google Sign-In!**

### **Option A: Local Build (Faster for Testing)**

```powershell
# Clean and rebuild
npx expo prebuild --clean

# Build and run on Android
npx expo run:android
```

This will:
- Generate native Android code
- Build the APK
- Install on your device/emulator
- Start the app

### **Option B: EAS Build (Cloud Build - Recommended for Production)**

```powershell
# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Configure
eas build:configure

# Build development APK
eas build --platform android --profile development

# Or build production APK
eas build --platform android --profile production
```

---

## **STEP 7: Test Google Sign-In**

1. **Run the development build:**
   ```powershell
   npx expo run:android
   ```

2. **In the app:**
   - Go to login screen
   - Tap "Continue with Google"
   - Select a Google account
   - Should successfully sign in! ✅

3. **Verify in Firebase:**
   - Firebase Console → Authentication → Users
   - You should see the new user
   - Firestore → user_tracking collection
   - User document should be created

---

## 🔍 Troubleshooting

### **Still Getting DEVELOPER_ERROR?**

**Checklist:**
- [ ] SHA-1 added to Firebase Console
- [ ] SHA-1 added to Google Cloud Console
- [ ] Package name matches everywhere: `com.venky534.revork`
- [ ] Using Development Build (NOT Expo Go)
- [ ] google-services.json in project root
- [ ] .env has correct Google Web Client ID
- [ ] Google Sign-In enabled in Firebase Authentication

### **Clean and Rebuild:**

```powershell
# Remove all builds
Remove-Item -Recurse -Force .\android

# Regenerate
npx expo prebuild --clean

# Build again
npx expo run:android
```

### **Check .env Configuration:**

```env
# Google OAuth Configuration (MUST match Firebase Console)
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=410003590123-s6gk4aoc4uh77u7eafs8l19d2v7api5n.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=1058954361230-ksl2nk7actihrbtd1nsgo9rldd2oup2u.apps.googleusercontent.com
```

### **Verify google-services.json:**

```json
{
  "client": [
    {
      "client_info": {
        "android_client_info": {
          "package_name": "com.venky534.revork"  // ✓ Must match
        }
      },
      "oauth_client": [
        {
          "client_id": "410003590123-s6gk4aoc4uh77u7eafs8l19d2v7api5n.apps.googleusercontent.com",
          "client_type": 3  // ✓ Type 3 = Web client
        }
      ]
    }
  ]
}
```

---

## 📱 Testing on Device vs Emulator

### **Physical Device:**
✅ Recommended for testing Google Sign-In
- Install APK directly
- Has real Google Play Services
- More reliable

### **Emulator:**
⚠️ Must have Google Play Services
- Use **Pixel** or **Google-certified** emulator
- In Android Studio → Device Manager
- Choose emulator with **Play Store** icon

---

## 🎯 Verification Steps

After setup, verify everything:

### **1. Firebase Console:**
- Authentication → Sign-in method → Google: **Enabled** ✓
- Authentication → Users: **New user appears** ✓
- Firestore → user_tracking: **User document created** ✓

### **2. Google Cloud Console:**
- APIs & Services → Credentials: **OAuth client exists** ✓
- SHA-1 fingerprint: **Added** ✓

### **3. App Testing:**
- Google Sign-In button: **Clickable** ✓
- Google account selector: **Appears** ✓
- Sign-in successful: **No errors** ✓
- User data saved: **Firestore updated** ✓

---

## 📞 Common Error Codes

| Error Code | Meaning | Fix |
|------------|---------|-----|
| `DEVELOPER_ERROR` | Configuration mismatch | Follow this guide |
| `SIGN_IN_CANCELLED` | User cancelled | Not an error, ignore |
| `PLAY_SERVICES_NOT_AVAILABLE` | No Google Play | Use different device/emulator |
| `IN_PROGRESS` | Already signing in | Wait for current operation |
| `NETWORK_ERROR` | No internet | Check connection |

---

## ✅ Success Indicators

You'll know it's working when:

1. ✅ Tap "Continue with Google" → Google account selector appears
2. ✅ Select account → App signs in successfully
3. ✅ No error messages
4. ✅ Redirected to profile setup or home screen
5. ✅ Firebase Console shows new user in Authentication
6. ✅ Firestore shows new document in user_tracking

---

## 🎉 That's It!

Follow these steps in order and Google Sign-In will work in your Revork app!

**Key Points:**
- Generate debug keystore → Get SHA-1
- Add SHA-1 to Firebase + Google Cloud
- Build development build (NOT Expo Go)
- Test on device/emulator with Google Play Services

**Need help?** Check the error message and refer to the troubleshooting section above.
