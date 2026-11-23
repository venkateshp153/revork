# Production build guide — Revork (Android)

Project: `@venky534/revork`
Package: `com.venky534.revork`
Build profile: `production` (outputs `.aab` for Google Play)

> **Current status (checked):**
> - EAS CLI is installed and logged in as `venky534`.
> - The **production environment has no variables on EAS**. The local `.env` is
>   git-ignored and is **not** uploaded automatically, so a build without
>   pushing variables will ship with missing Firebase/Google configuration.
> - All API keys in `.env` are the same values that were committed to git
>   history, so they must be treated as leaked.
> - Only development builds exist so far (last `versionCode` = 4).
> - Local Java/Android SDK is not installed, so use the EAS cloud build.

---

## 0. Before the build (do these first)

### 0.1 Rotate the leaked keys

The `.env` values are still in git history. Before uploading a production build
to Play:

1. Create new keys in Google Cloud Console:
   - Sheets/Drive API key
   - Maps / Places / Routes API key
   - Cloud Vision API key (optional)
2. Restrict each key to:
   - Android app `com.venky534.revork`
   - the release SHA-1
   - only the APIs it needs
3. Put the new values in `.env`.

Firebase web API key and OAuth client IDs are public identifiers, but the
Firebase key should still be restricted to your app/SHA-1 and you should enable
Firebase App Check before scaling.

If you must build before rotating, treat that build as a **test build only** and
do not roll it out to production.

### 0.2 Add the Play-specific variables to `.env`

Add these to `.env` (they are not in the file yet):

```dotenv
EXPO_PUBLIC_PRIVACY_URL=https://your-domain.com/privacy-policy.html
EXPO_PUBLIC_SUPPORT_EMAIL=support@your-domain.com
```

Optional:

```dotenv
EXPO_PUBLIC_VISION_API_KEY=...
EXPO_PUBLIC_OSRM_URL=https://your-own-osrm-server
```

If `EXPO_PUBLIC_PRIVACY_URL` is missing, the app still opens its offline policy
screen; Play Console still requires a public URL (see `docs/privacy-policy.html`).

### 0.3 Commit the security fixes

EAS includes uncommitted changes by default, but commit so the build is
traceable:

```bash
git add -A
git commit -m "security hardening and Play Store readiness"
git push
```

Do **not** add `.env` (it is git-ignored).

### 0.4 Push variables to EAS production

```bash
npx eas-cli env:push production --path .env --force
```

`EXPO_PUBLIC_*` variables are uploaded as **public** (they are inlined into the
app bundle anyway). Other variables become **sensitive**.

Verify:

```bash
npx eas-cli env:list --environment production
```

You should see all `EXPO_PUBLIC_*` names plus the privacy/support values.

### 0.5 Remove the leaked keystore password from EAS

The `preview` environment currently stores
`REVORK_KEYSTORE_PASSWORD` in plaintext. It is not referenced anywhere in the
repo and is not needed by an EAS-managed keystore. Delete it:

```bash
npx eas-cli env:delete preview --variable-name REVORK_KEYSTORE_PASSWORD
```

If you later discover it was the password of a manually created upload
keystore, rotate that key (Play Console → App integrity → Upload key reset) and
let EAS manage the keystore instead.

---

## 1. Build the production AAB

```bash
npx eas-cli build --platform android --profile production
```

At the prompts:

- **Android Keystore**: choose **No / use existing** if EAS offers to generate
  a new one. Reusing the existing keystore keeps the SHA-1 already registered
  in Firebase and Google Cloud. Generating a new keystore means you must add
  its SHA-1 and rebuild `google-services.json`.
- Confirm the build. It runs in the cloud (about 10–20 minutes).
- `autoIncrement: true` gives the build a new `versionCode` (the next one after
  the last development build, which was 4).

The output is an **`.aab`**. This is the file you upload to Play. Do not upload
an APK.

---

## 2. Build an installable test APK (recommended)

You cannot install an `.aab` directly. Build the same production config as an
APK for device testing:

```bash
npx eas-cli build --platform android --profile production-apk
```

Install it on a real device and verify:

- [ ] Fresh install → **Continue with Google** works.
- [ ] Company onboarding creates a private Google Sheet (Share settings does
      **not** say "Anyone with the link").
- [ ] Add an employee and join from a second device with that Google account.
- [ ] A different Google account **cannot** use the same join link.
- [ ] Deny location and camera → app still opens and does not crash.
- [ ] Privacy policy link opens.
- [ ] Create a delivery + proof photo.
- [ ] Logout → next launch shows login and old workspace data is gone.

---

## 3. Upload to Play Console

1. Play Console → create the app if needed:
   - App name: **Revork**
   - Package: `com.venky534.revork`
   - Category: Business
2. **Testing → Internal testing → Create new release**.
3. Upload the `.aab` from the production build.
4. Add testers and roll out.
5. Complete **App content**:
   - App access (demo Google account + demo workspace)
   - Data safety (see `PLAY_STORE_CHECKLIST.md`)
   - Content rating
   - Ads: No
   - Target audience: 18+ / business
   - Privacy policy URL
6. Complete the store listing (icon 512×512, feature graphic, screenshots,
   descriptions).

### Important: Play App Signing SHA-1

Play re-signs the app with its own **app signing key**. Google Sign-In checks
the installed certificate, so the Play signing SHA-1 must be registered:

1. Upload the first AAB to Internal testing.
2. Play Console → **Setup → App signing** → copy the **App signing key
   certificate SHA-1**.
3. Firebase Console → Project settings → your Android app → **Add fingerprint**
   → paste the SHA-1.
4. Google Cloud Console → Credentials → your Android OAuth client
   (`com.venky534.revork`) → add the same SHA-1.
5. Download the new `google-services.json` and replace **both**:
   - `google-services.json`
   - `android/app/google-services.json`
6. Commit and **rebuild the production AAB**.
7. Upload the new AAB to Play.

Until you do this, Google Sign-In can work in the EAS APK but fail for users
who install from Play. Plan for two uploads.

---

## 4. Promote to production

Once internal testing passes:

1. **Closed testing → Open testing → Production** (as your rollout plan allows).
2. Use a staged rollout (for example 10% → 50% → 100%).
3. Watch Play Console pre-launch reports and crash/ANR reports.

Optional automatic submission:

```bash
npx eas-cli submit --platform android --profile production
```

This requires a Google Cloud service account with Play Developer API access and
a JSON key, granted release permissions in Play Console → Users and permissions.
Manual upload is simpler for the first release.

---

## 5. How to get the SHA-1 fingerprints

You need different SHA-1s at different stages. Google Cloud app restrictions
accept multiple "Android apps" entries per API key, so add all that apply.

| Fingerprint | Used for | Where to get it |
|---|---|---|
| **EAS upload key** | APKs built by EAS, internal testers, and the first Play upload | `eas credentials` (below) |
| **Play App Signing key** | Builds installed from Google Play | Play Console → Setup → App signing (after the first upload) |
| **Debug key** | Local debug builds only | `keytool` on `android/app/debug.keystore` (optional) |

### 5.1 EAS upload key SHA-1 (no Java required)

```bash
npx eas-cli credentials --platform android
```

Choose:

1. Project: `@venky534/revork`
2. Application identifier: `com.venky534.revork`
3. **Keystore: Manage everything needed to build your project**
4. **Download existing keystore** (or the option that views the current
   keystore)
5. If asked "Do you want to display the sensitive information?", choose **No**
   — you only need the fingerprints.

EAS prints:

```
Keystore
  Type: JKS
  Key Alias: ...
  MD5 Fingerprint: ...
  SHA1 Fingerprint: AA:BB:CC:...
  SHA256 Fingerprint: ...
```

Copy the **SHA1 Fingerprint**.

The command may also save a `.jks` file in the project root. Delete it
afterwards; never commit it (`*.jks` is git-ignored).

### 5.2 Play App Signing SHA-1

The Play signing key only exists after the first AAB upload:

1. Play Console → your app → **Test and release → Setup → App signing**
   (older UI: **Release → Setup → App integrity**).
2. Copy the **SHA-1 certificate fingerprint** under **App signing key
   certificate**.
3. Also note the **Upload key certificate** SHA-1 — it should match the EAS
   upload key above.

If it says the app signing certificate is not available yet, upload the first
production AAB to Internal testing first.

### 5.3 Debug SHA-1 (optional)

The standard React Native debug keystore fingerprint is:

```
5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

Your `google-services.json` currently contains this value and a second one
(`F3:99:E5:D6:8A:CD:22:B0:C7:73:23:36:C2:53:6F:E2:D2:2F:90:EC`), which is the
EAS upload key. Treat the EAS command as the authoritative source.

To read it with Java/Android Studio's `keytool`:

```bash
keytool -list -v \
  -keystore android/app/debug.keystore \
  -alias androiddebugkey \
  -storepass android \
  -keypass android
```

### 5.4 Where to paste the SHA-1 in Google Cloud

For **API keys** (Sheets/Drive, Maps, Vision):

1. Google Cloud Console → **APIs & Services → Credentials**.
2. Click the API key (the same value as `EXPO_PUBLIC_API_KEY` /
   `EXPO_PUBLIC_MAPS_API_KEY` / `EXPO_PUBLIC_VISION_API_KEY`).
3. **Application restrictions → Android apps → Add an item**.
4. Package name: `com.venky534.revork`
5. SHA-1: paste the fingerprint (with colons).
6. Add one item for the EAS upload key and one for the Play App Signing key
   (and the debug key if you use restricted keys for local testing).
7. **API restrictions → Restrict key** → select only the APIs that key needs.
8. Save. It can take a few minutes to apply.

For **Google Sign-In**, do not edit the OAuth client by hand — add the
fingerprint in **Firebase Console → Project settings → your Android app → Add
fingerprint**, then download the new `google-services.json`, replace both
copies, and rebuild. This is what makes Google Sign-In work for Play-installed
builds.

## 6. Do not do these

- Do not upload the APK to Play; upload the `.aab`.
- Do not commit `.env`, keystores or service-account JSON files.
- Do not run `npm audit fix --force` (it downgrades Expo to SDK 52 and breaks
  the app).
- Do not leave the Sheets/Maps/Vision keys unrestricted.
- Do not roll out the first Play build before adding the Play signing SHA-1 and
  rebuilding `google-services.json`.

---

## 7. Useful commands

```bash
# Latest builds
npx eas-cli build:list --platform android --limit 5

# View one build
npx eas-cli build:view <build-id>

# Production env vars
npx eas-cli env:list --environment production

# Re-run the build after rotating keys or updating google-services.json
npx eas-cli build --platform android --profile production

# Check the app config one last time
npx expo-doctor
npx tsc --noEmit

# Bundle check without a native build
npx expo export --platform android
```
