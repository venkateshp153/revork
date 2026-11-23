# Revork Security Notes

Last reviewed: 23 November 2026

This file records the security work done in the app and the steps that can only
be completed in Google Cloud, Firebase and Play Console.

## What was fixed in this pass

### 1. Company data is no longer public (critical)

Older builds shared every company spreadsheet and Drive folder as
**"Anyone with the link → Viewer"** so the API key could read them. Because the
sheet id travels inside every join link, anyone who received or found a link
could read the whole workspace: employee names, emails, phones, pay rates,
delivery addresses and proof photos.

- New workspaces are private. `createGoogleDriveStructure` no longer creates an
  `anyone` permission.
- `ensurePublicReadAccess` was replaced with `removePublicLinkAccess`, which
  deletes any `type: anyone` permission from the spreadsheet and its parent
  folder.
- Admins run the cleanup automatically on login and when the app returns to the
  foreground (`SyncManager`).
- Join links now only work when the signed-in Google account has been granted
  access to the sheet. A link is no longer a bearer token for the data.
- Join-link reads no longer fall back to the public API key.
- Sheet reads prefer the signed-in user's OAuth token and only try the API key
  once for a legacy public sheet before remembering that the sheet is private.

### 2. Firestore least privilege

`firestore.rules` was rewritten:

- `user_tracking` is readable by the owner, by same-company admins, or by a
  platform admin. Previously **every** company admin could read every company's
  tracking records.
- `users` is readable by the owner only (plus an optional `platformAdmin`
  custom claim). Company admins can no longer read other companies' accounts.
- Self-service updates cannot change `designation` or `email`.
- New accounts require a verified Google email that matches the auth token.
- `worker_tracking` and `company_tracking` stay scoped to the owning company.
- Leave requests cannot be self-approved; managers cannot change the owner.
- Notification updates are limited to read-state fields.
- Platform-only collections (`system_settings`, `admin_logs`, `sheets_data`) are
  server-only and require a `platformAdmin` custom claim.
- The platform-wide lists in `admin-dashboard.tsx` now require that
  `platformAdmin` claim; a normal company admin only sees their own company's
  records. Set the claim with the Admin SDK for support/operator accounts.

### 3. Client-side hardening

- External links from spreadsheet/user-controlled values are validated by
  `src/utils/safeUrl.ts`. Only `https` URLs on an allow-list of hosts (Drive),
  validated phone numbers and validated email addresses can reach
  `Linking.openURL`. This blocks `intent://`, `javascript:`, `file://` and
  look-alike-host attacks.
- Logout and account deletion now clear the local cache (sheet snapshots with
  names/phones/pay, routes, delivery-proof queue, offline mutations). A shared
  phone no longer keeps a previous employee's data.
- Access tokens are cached in memory for 50 minutes and dropped on sign-out.
- Release builds remove `console.*`, so tokens, emails and sheet ids are not
  written to logcat.
- Android still blocks cleartext HTTP (`usesCleartextTraffic="false"`), disables
  backups (`allowBackup="false"`) and no longer requests `SYSTEM_ALERT_WINDOW`.
- Dangerous permissions are explicitly blocked in `app.json` and
  `AndroidManifest.xml` (`SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES`,
  `MANAGE_EXTERNAL_STORAGE`, SMS and call-log permissions).
- The route-map WebView keeps its CSP, SRI-pinned Leaflet build, file/popup
  restrictions and range-checked message handler.

### 4. Dependency advisories

`npm audit` went from 30 to 27 findings (12 → 10 high). The remaining findings
are transitive build-tooling packages (`postcss`, `minimatch`, `glob`,
`brace-expansion`, `image-size`) plus `@grpc/grpc-js` inside the Firebase web
SDK. `npm audit fix` cannot remove them without downgrading Expo to SDK 52
(`npm audit fix --force`), which would break the app. They are not reachable
from user-supplied data in the shipped app.

## What you must do (cannot be done from the repo)

1. **Rotate the Google API keys.** `.env` was committed in older git history.
   Treat every key that ever lived there as leaked:
   - Google Sheets key
   - Maps/Places/Routes key
   - Cloud Vision key
   - Firebase web API key (rotate in Firebase/Google Cloud if possible)

   The old values stay in git history until you rewrite it. Create new keys,
   update `.env`, then optionally purge history with `git filter-repo`.
2. **Restrict keys in Google Cloud Console → Credentials:**
   - Sheets key → Google Sheets API + Google Drive API, Android app
     `com.venky534.revork` + release SHA-1.
   - Maps key → Maps SDK for Android, Places API (New), Routes API, same app
     restriction.
   - Vision key → Cloud Vision API, same app restriction.
   - Never leave a key unrestricted ("Don't restrict key").
3. **Add the release SHA-1** from `npx eas-cli credentials` to:
   - Firebase Console → Project settings → your Android app.
   - Google Cloud OAuth Android client.
   Then download a fresh `google-services.json`.
4. **Deploy the rules:**
   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules
   ```
5. **Re-share existing employees** after the first admin login. The app revokes
   the old "anyone with the link" permission automatically, so workers who were
   relying on public access must be granted access with their own Google email.
   Open **Workers → share icon** for each existing employee (new employees are
   shared automatically when they are added).
6. **Revoke existing public sharing manually** for workspaces created before
   this fix. The app does it automatically for admins, but you can check now:
   for each company sheet, Drive → Share → remove "Anyone with the link".
7. **Set the production environment variables** (including
   `EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL`) and push them:
   ```bash
   npx eas-cli env:push production --path .env
   ```
8. **Host the privacy policy** at a public HTTPS URL and put that URL in Play
   Console. The app also ships an offline copy at
   `app/privacy-policy.tsx` for reviewers.
9. **Enable Firebase App Check** (Play Integrity provider) and enforce it for
   Firestore/Auth before scaling. This stops scripted abuse of your Firebase
   project even if an API key is extracted.
10. **Use Play App Signing** and keep the EAS keystore offline/backed up.

## Residual risks (accepted or architectural)

- **Sheets editor access:** workers are granted Drive *Editor* so clock-in/out
  can be written directly. An employee can still open the sheet in Google Sheets
  and edit it outside the app. For stronger protection, make the sheet read-only
  and route writes through Cloud Functions or Apps Script with server-side role
  checks.
- **Client-side API keys:** anything shipped in the APK can be extracted. App
  restrictions raise the bar but are not a secret. A backend proxy is the only
  real fix.
- **Custom URL scheme:** `revork://` can be claimed by another installed app. Use
  Android App Links (`assetlinks.json`) for sensitive links when you have a
  domain.
- **Auth token storage:** Firebase React Native persistence currently uses
  AsyncStorage (app-private but not hardware-encrypted). Consider
  `expo-secure-store` or an encrypted storage adapter for high-risk deployments.
- **No screenshot blocking:** payroll and personal data can be screenshotted.
  Add `expo-screen-capture` if your threat model requires it.
- **Multi-tenancy:** the workspace model is one Google account = one company.
  Rules scope records by `companyId`, but a server-side permission model is still
  recommended as the app grows.
