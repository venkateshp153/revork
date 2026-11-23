# Google Play submission checklist — Revork

This is the practical list for getting the current build accepted. Items marked
**[you]** need information or actions that only the account owner can provide.

## 1. Build

- Build the **AAB** (not an APK) for production:
  ```bash
  npx eas-cli build --platform android --profile production
  ```
  `eas.json` already sets `"buildType": "app-bundle"` for the production profile.
- Expo SDK 54 / React Native 0.81 compiles against **compileSdk 36** and
  **targetSdk 36** (`expo-modules-core` default), which satisfies the current
  Play target-API requirement. `minSdk` is 24.
- The app includes arm64-v8a (required) and the other standard ABIs.
- Use **Play App Signing**. Keep the EAS keystore backed up; losing it means you
  cannot update the app.
- `autoIncrement: true` in `eas.json` bumps `versionCode` on every production
  build. Confirm the new build has a versionCode higher than the last upload.

## 2. Store listing basics

- App name: **Revork**
- Category: **Business**
- Contact email: a real, monitored mailbox **[you]**
- Privacy policy URL: a public HTTPS page **[you]**
  - `docs/privacy-policy.html` is a ready-to-host page. See `docs/README.md` for
    GitHub Pages / Netlify / Cloudflare Pages instructions.
  - Replace the support email and company name in that file before publishing.
  - `PRIVACY_POLICY.md` is the source text; the app also ships an offline copy
    at `app/privacy-policy.tsx`.
  - Set `EXPO_PUBLIC_PRIVACY_URL` so the in-app link opens the hosted page.
- App icon 512×512 PNG, feature graphic 1024×500, at least 2 phone screenshots.
- Short description (≤80 chars) and full description.
- Ads: **No**.
- In-app purchases: **No**.
- News app: **No**.
- COVID-19 apps: **No**.
- Target audience: **18+ / business users**. Do not select "children".

## 3. App access (most common rejection)

All app functionality is behind Google Sign-In, so reviewers cannot get past the
login screen without credentials.

In **Play Console → App content → App access**, choose **"All or some
functionality is restricted"** and add instructions like:

> Revork is a B2B workforce app. Sign in with the Google account below.
> 1. Open the app and tap **Continue with Google**.
> 2. Choose the test account (email: **[you]**, password: **[you]**).
> 3. The app opens the demo company workspace automatically.
> 4. To test the employee flow, use the invite link below on the login screen:
>    **[you]**
>
> Location and camera/photo permissions are optional. Denying them still lets
> the reviewer browse the workspace; only route maps and proof photos need them.

Create a dedicated **demo Google account** with a demo company workspace, and
keep it alive for the review period. Do not use a personal account with MFA that
the reviewer cannot complete.

## 4. Data safety form

Answer **"Yes"** to "Does your app collect or share any of the required user
data types?" and declare:

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Name | Yes | No | No | Account management, app functionality |
| Email address | Yes | No | No | Account management, app functionality |
| Phone number | Yes | No | No | Account management, app functionality |
| Address | Yes | No | Yes | App functionality (company/delivery addresses) |
| User IDs | Yes | No | No | Account management |
| Approximate location | Yes | No | Yes | App functionality (routes) |
| Precise location | Yes | No | Yes | App functionality (routes, proof check-in) |
| Photos | Yes | No | Yes | App functionality (delivery proof) |
| Files and docs | Yes | No | Yes | App functionality (workspace files) |
| App activity (in-app actions) | Yes | No | No | App functionality |
| Other financial info (pay rate) | Yes | No | No | App functionality (payroll display) |

- **Is data encrypted in transit?** Yes (HTTPS only; cleartext traffic is blocked).
- **Can users request data deletion?** Yes.
  - In-app: Profile → Privacy & account → Delete my account.
  - Also provide a deletion request email in the form **[you]**.
- **Data deletion URL** (optional but recommended): your privacy page with a
  deletion section.
- **Is data shared with third parties?** The app uses Google Cloud, Firebase,
  Google Sheets/Drive, Google Maps and Google Cloud Vision as **service
  providers** to run the app. Do not select "shared for advertising"; there is
  no advertising or data sale.
- **Family policy:** app is not directed to children.

Keep the form consistent with the privacy policy. A mismatch is a common
rejection reason.

## 5. Permissions declarations

The manifest requests:

- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` — route building and proof
  check-in. Declare in **Sensitive permissions** if Play asks. Foreground only;
  background location is disabled in `app.json`.
- `READ_EXTERNAL_STORAGE` (maxSdkVersion 32) — legacy gallery access on older
  Android only.
- `CAMERA` / photo picker access via the system picker (declared by
  `expo-image-picker`) — delivery proof photos and address scanning.
- `VIBRATE` — haptic feedback (no personal data).

Unused biometric and notification permissions were removed along with their
unused packages, so the app does not request them.

The following are explicitly **blocked** and must not appear in the merged
manifest: `SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES`,
`MANAGE_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `WRITE_EXTERNAL_STORAGE`, SMS and
call-log permissions. Verify after building:

```bash
# from the generated AAB/APK
aapt2 dump permissions app-release.apk
```

If any blocked permission still appears, check for a newly added native
dependency that declares it and add it to `android.blockedPermissions` in
`app.json` plus the manifest `tools:node="remove"` list.

> **Note:** this repository commits the native `android/` folder, so EAS Build
> uses that folder as-is and does **not** re-apply `app.json` plugin changes.
> The critical permission removals are therefore duplicated in
> `android/app/src/main/AndroidManifest.xml`. If you ever run
> `npx expo prebuild --clean`, re-check the merged manifest afterwards.

## 6. Content rating

Complete the questionnaire as a business/productivity app:

- Violence, sexual content, profanity, drugs, gambling: **No**
- User-generated content shared publicly: **No** (team-only workspace data)
- Users can interact/chat: **No public chat** (in-app alerts only)
- Shares location: **Yes**, but only with the user's company
- Purchases: **No**

Result should be a low rating (Everyone / PEGI 3).

## 7. Backend configuration before upload

- [ ] `firestore.rules` deployed.
- [ ] Google API keys rotated and restricted (see `SECURITY.md`).
- [ ] Release SHA-1 added to Firebase and the OAuth Android client.
- [ ] Fresh `google-services.json` committed (client config only).
- [ ] `EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` set in EAS
      production environment.
- [ ] Privacy policy hosted publicly and reachable without login.
- [ ] Demo workspace + demo Google account ready for reviewers.
- [ ] Account deletion tested end-to-end on a real device.
- [ ] Location-denied and camera-denied paths tested (app must not crash).

## 8. Final pre-upload smoke test

On a clean install of the production build:

1. Fresh install → Continue with Google → complete company onboarding.
2. Confirm the workspace sheet is **not** shared as "Anyone with the link".
3. Add an employee with their Google email → send the join link → join on a
   second device with that email.
4. Confirm a different Google account **cannot** open the same join link.
5. Create a delivery, attach a proof photo, mark it delivered.
6. Log out → confirm the next launch shows the login screen and the previous
   workspace data is gone.
7. Delete an account → confirm the Google account is removed and the app
   returns to login.
