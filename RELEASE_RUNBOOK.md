# Revork — Google Play release runbook

Package: `com.venky534.revork`
Firebase project: `revork-e7d8a`
Current commit: `9c49ca8` (security hardening + Play Store readiness)

## Current state

- ✅ Production AAB built: versionCode **5** (test only — uses the old keys)
- ✅ Test APK built: versionCode **6**
- ✅ Production env vars pushed to EAS
- ✅ No Play submissions yet
- ❌ Google Cloud API keys are still the leaked ones
- ❌ `EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` are not in `.env`
- ❌ It is not confirmed that `firestore.rules` was deployed to `revork-e7d8a`

**Do not promote the current AAB to production.** Finish Phase 1 first.

---

## Phase 1 — Security and config (blocking)

### 1.1 Rotate and restrict the Google Cloud keys

Create new keys for:

- Sheets/Drive (`EXPO_PUBLIC_API_KEY`)
- Maps/Places/Routes (`EXPO_PUBLIC_MAPS_API_KEY`)
- Cloud Vision (`EXPO_PUBLIC_VISION_API_KEY`, optional)

For each key:

1. Google Cloud Console → **APIs & Services → Credentials**.
2. **Application restrictions → Android apps → Add an item**:
   - Package: `com.venky534.revork`
   - SHA-1: your EAS upload key now; Play App Signing SHA-1 after the first
     upload.
3. **API restrictions → Restrict key** to only the APIs that key needs.
4. Update `.env`.

Firebase web keys and OAuth client IDs are public identifiers, but restrict the
Firebase API key to the app/SHA-1 as well and enable App Check before scaling.

### 1.2 Host the privacy policy

`docs/privacy-policy.html` is ready. See `docs/README.md` for GitHub Pages /
Netlify / Cloudflare Pages.

Before publishing, replace:

- `support@revork.app` → your real support email
- `Revork` in the footer → your legal company name

Add to `.env`:

```dotenv
EXPO_PUBLIC_PRIVACY_URL=https://your-domain.com/privacy-policy.html
EXPO_PUBLIC_SUPPORT_EMAIL=support@your-domain.com
```

### 1.3 Deploy the Firestore rules

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project revork-e7d8a
```

Verify in Firebase Console → Firestore → Rules that the new rules are live.

### 1.4 Re-share existing employees

The new build revokes legacy public link access. After an admin signs in,
open **Workers → share icon** for each existing employee so their Google account
has access. New employees are shared automatically.

### 1.5 Push env vars and build the final AAB

```bash
git add -A
git commit -m "rotate API keys and add Play release config"
git push

npx eas-cli env:push production --path .env --force
npx eas-cli build --platform android --profile production
```

This build will be versionCode **7 or higher** (6 was the test APK). Download
the AAB and keep the build ID.

---

## Phase 2 — Play Console setup

1. Complete **developer identity verification** (personal or organization).
   Organizations need a D-U-N-S number.
2. Play Console → **Create app**:
   - App name: **Revork**
   - Default language: English
   - App or game: **App**
   - Free or paid: **Free**
   - Declarations: accept the Play policies.
3. Confirm the package name: `com.venky534.revork`.
4. **App integrity**: use **Play App Signing** (required for new apps). The
   first AAB upload registers your EAS keystore as the **upload key**.

---

## Phase 3 — First upload and the Play signing SHA-1

1. **Testing → Internal testing → Create new release**.
2. Upload the final AAB from Phase 1.
3. Add yourself as a tester, roll out, and install from the Play link.
4. Play Console → **Setup → App signing**:
   - Copy the **App signing key certificate SHA-1**.
   - The **Upload key certificate** should match your EAS key.
5. Add the Play signing SHA-1:
   - Firebase Console → Project settings → Android app → **Add fingerprint**
   - Google Cloud Console → Credentials → Android OAuth client for
     `com.venky534.revork` (Firebase usually manages this)
6. Download the new `google-services.json`; replace:
   - `google-services.json`
   - `android/app/google-services.json`
7. Commit and **rebuild the production AAB** (versionCode increases again).
8. Upload the new AAB to Internal testing.

Until this is done, Google Sign-In works in the EAS APK but fails for users who
install from Play.

---

## Phase 4 — Play Console declarations

### App access

All functionality is behind Google Sign-In, so provide reviewer access:

- **All or some functionality is restricted**
- Demo Google account email + password (dedicated account, 2FA disabled or
  backup codes provided)
- Steps: open app → Continue with Google → choose the demo account → workspace
  opens
- For the employee flow: a join link + the matching demo worker Google account
- Note that location and camera are optional and can be denied

### Data safety

Answer **Yes** to collecting data, then declare:

| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Name | Yes | No | No | Account management, app functionality |
| Email address | Yes | No | No | Account management, app functionality |
| Phone number | Yes | No | No | Account management, app functionality |
| Address | Yes | No | Yes | App functionality |
| User IDs | Yes | No | No | Account management |
| Approximate location | Yes | No | Yes | App functionality (routes) |
| Precise location | Yes | No | Yes | App functionality (routes, proof check-in) |
| Photos | Yes | No | Yes | App functionality (delivery proof) |
| Files and docs | Yes | No | Yes | App functionality (workspace files) |
| App activity (other actions) | Yes | No | No | App functionality |
| Other financial info (pay rate) | Yes | No | No | App functionality (payroll) |

- **Encrypted in transit:** Yes.
- **Data deletion:** Yes — in-app **Profile → Privacy & account → Delete my
  account**, plus the support email.
- **Data sharing:** No sale, no ads. Google Cloud/Firebase/Sheets/Drive/Maps are
  service providers.
- Keep this consistent with the hosted privacy policy.

### Content rating

- Violence, sexual content, profanity, drugs, gambling: **No**
- Public user-generated content / social features: **No**
- Shares location: **Yes** (with the user's company only)
- Purchases: **No**

### Other app content

- **Ads:** No
- **Target audience:** 18+ / business users, not children
- **News app:** No
- **COVID-19 apps:** No
- **Government apps:** No
- **Financial features:** No (payroll records only, no banking/lending/crypto)
- **Health:** No
- **Privacy policy URL:** the hosted URL

### Permissions

- Location (foreground only) — routes and proof check-in
- Camera / photo picker — delivery proof and address scanning
- No background location, no SMS/call log, no overlay/install permissions

---

## Phase 5 — Store listing

Prepare:

- App icon **512 × 512 PNG**
- Feature graphic **1024 × 500**
- At least **2 phone screenshots** (16:9 or 9:16)
- Short description (≤ 80 characters)
- Full description
- Category: **Business**
- Contact email: your support mailbox
- Privacy policy URL
- Website / phone: optional

---

## Phase 6 — Testing tracks and production

1. **Internal testing** — fastest; up to 100 testers; verify Google Sign-In,
   onboarding, worker join, permissions, logout.
2. **Closed testing** — add testers. If Play Console shows **“Apply for
   production access”**, new personal developer accounts must run closed testing
   with at least **12 testers for 14 continuous days** before production access
   is granted. Organization accounts may not have this requirement.
3. **Open testing** — optional public beta.
4. **Production → Create new release** → upload the final AAB → review →
   **staged rollout** (for example 10% → 50% → 100%).

Google review can take hours to a few days. Watch for policy questions and
respond.

---

## Phase 7 — After release

- Check Play Console **pre-launch report**, Android vitals, crashes and ANRs.
- Keep the EAS keystore and Play upload key backed up.
- Rotate keys immediately if they were ever exposed.
- Enable **Firebase App Check** (Play Integrity) and enforce it.
- For future releases, increment the version and upload a new AAB (or use
  `npx eas-cli submit --platform android --profile production` with a Play
  service account).

---

## Quick command reference

```bash
# Deploy security rules
npx firebase-tools deploy --only firestore:rules --project revork-e7d8a

# Push production env vars
npx eas-cli env:push production --path .env --force

# Final Play AAB
npx eas-cli build --platform android --profile production

# Test APK
npx eas-cli build --platform android --profile production-apk

# Latest builds
npx eas-cli build:list --platform android --limit 5

# Upload-key SHA-1
npx eas-cli credentials --platform android
```
