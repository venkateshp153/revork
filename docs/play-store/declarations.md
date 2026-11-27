# Play Console — declarations answers for Revork

## Developer Program Policies
Tick **"Yes"**. It is an attestation that the app and store listing comply. The
sections reviewers actually check for this app:

- Privacy policy URL live and reachable (required — the app has accounts).
- Data safety form matches that policy (see `data-safety.md`).
- In-app account deletion **and** a web deletion URL.
- Location/camera/photo permissions used only for the stated feature, with
  in-app disclosure. Background location stays off.
- No misleading metadata; screenshots must show real app UI.

## Play App Signing
Tick **"Yes"**, then choose **"Let Google generate the app signing key"** unless
you already have a keystore you must preserve. Google keeps the app signing key;
EAS Build keeps an upload key (`eas credentials` → Android).

Back up the upload keystore and its two passwords offline. Losing it costs a
support request, not the app.

## US export laws
Tick **"Yes"** and, in the export-compliance question, declare:

- Uses encryption: **Yes**
- Type: **standard encryption (HTTPS/TLS) only**
- Classification: falls under the publicly-available / mass-market encryption
  exemption — no BIS/ENC notification required

This is accurate because the app uses only platform TLS (`axios`, Firebase,
Google APIs). If custom or proprietary cryptography is ever added, revisit this
answer before shipping that version.

## Before the first production release

- [ ] Privacy policy hosted; URL in Store listing
- [ ] Data safety submitted and in sync with the policy
- [ ] Account deletion page published; URL entered
- [ ] Content rating questionnaire completed
- [ ] Ads declared as "No ads"; target audience 18+
- [ ] `eas build -p android --profile production` produces an `.aab`
- [ ] Closed test with 12+ testers for 14 continuous days (required for personal
      developer accounts created after 13 Nov 2023; business accounts exempt)
- [ ] Rebuild the dev/production client after adding `expo-secure-store` — it is a
      native module, so it does not arrive over OTA
