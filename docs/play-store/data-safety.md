# Play Console — Data safety answers for Revork

Fill this in at **Play Console → App content → Data safety**. It must match the
privacy policy and what the app actually does. Everything below reflects the
current code: Firebase Auth/Firestore, Google Sign-In, Sheets/Drive access,
foreground location, and camera/photo-library access. No ads, no analytics SDK,
no crash-reporting SDK.

## 1. Overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS/TLS only) |
| Do you provide a way for users to request that their data is deleted? | **Yes** |
| Deletion request URL | `https://[your-domain]/delete-account` — must be a live page reachable without installing the app |
| Do you share user data with third parties? | **No** — Google/Firebase act as service providers under contract, which Play does not count as "sharing". Do **not** tick "shared" for these. |
| Is any collected data sold? | **No** |
| Has your app been independently validated against a global security standard? | **No** |

## 2. Data types to declare (collected)

For each row: **Collected = yes**, **Shared = no**.

| Play category | Specific type | Purposes | Optional? |
|---|---|---|---|
| Personal info | Name | App functionality, Account management | Required (account) |
| Personal info | Email address | App functionality, Account management | Required (account) |
| Personal info | Phone number | App functionality | Required for worker profiles |
| Personal info | User IDs (Firebase UID) | App functionality, Account management | Required |
| Personal info | Address (customer delivery addresses in workspace sheets) | App functionality | Required for the feature |
| Location | Approximate location | App functionality (route start, delivery geotag) | **Optional** — user may deny the permission |
| Location | Precise location | App functionality (route start, delivery geotag) | **Optional** — user may deny the permission |
| Photos and videos | Photos | App functionality (delivery proof) | **Optional** — camera/library access can be denied |

### What to leave unticked

- **Financial info** — hourly pay rate is employment data, not payment or card
  data. Do not declare "Payment info" or "Purchase history".
- **Contacts, SMS, call logs, calendar** — never requested; they are explicitly
  blocked in `app.json` (`blockedPermissions`).
- **Audio (microphone)** — disabled: `microphonePermission: false`.
- **Device or other IDs** — no advertising ID, no install ID, no analytics.
- **App activity / In-app search history / Installed apps** — not collected.
- **Health and fitness, Messages, Web browsing** — not collected.

## 3. Location details (the follow-up screen)

- **Purpose:** app functionality only — (a) choosing a start point for a delivery
  route, (b) recording where a delivery was completed, (c) warning when a driver
  marks a stop delivered far from the address (the `geofenceMeters` setting).
- **Not** used for advertising or analytics.
- **Background location is off** — `isAndroidBackgroundLocationEnabled: false`,
  and the manifest permission is foreground-only. Do not apply for background
  location access.
- **Derived data:** coordinates may be written into the workspace's own
  spreadsheet/proof record. That makes it "collected", not "ephemeral".

## 4. Photo details

- Purpose: app functionality (delivery proof).
- Photos are stored on the device first, then uploaded to the workspace owner's
  Google Drive. Local copies of uploaded proofs are pruned after the retention
  period (default 7 days).

## 5. Data deletion (required for account-based apps)

The app already has in-app deletion at **Profile → Delete account**, which removes
the Firestore user record, the tracking record, the Firebase Auth account, and the
local cache. Play additionally requires a **web** deletion route:

1. Publish a short page at the URL you enter (a GitHub Pages/Notion page is fine).
2. It should say: what is deleted, what is retained (workspace-owned sheets),
   the in-app path, and an email address for requests.
3. Keep the URL live for as long as the app is published.

## 6. Keep these in sync

- **Privacy policy URL** (Store listing) must describe the same data types.
- **Content rating** questionnaire: category Utility/Productivity, no user
  interaction features beyond workspace chat-less collaboration.
- **Ads:** declare "No ads".
- **Target audience:** 18+ / business tool — do not select an audience under 13,
  otherwise the Families policy applies.
