# Hosting the privacy policy

`privacy-policy.html` is a self-contained page (no external CSS/JS) that you can
publish on any static host.

## Before publishing

Open `privacy-policy.html` and replace:

- `support@revork.app` → your real, monitored support email (appears 3 times).
- `Revork` in the footer/contact → your legal company or developer name.

The same values must be used in `PRIVACY_POLICY.md`, the Play Console listing and
the Data safety form. Keep them consistent.

## Option A: GitHub Pages (repo: `venkateshp153/revork`)

1. Commit and push this `docs/` folder to the default branch.
2. GitHub → repository **Settings → Pages**.
3. Source: **Deploy from a branch** → Branch: `main` (or `master`) → Folder:
   **/docs** → Save.
4. Wait for the deployment, then open:
   `https://venkateshp153.github.io/revork/privacy-policy.html`
   - If the repository is private, GitHub Pages requires a paid plan. Use
     Option B instead.
5. Put that URL in:
   - `EXPO_PUBLIC_PRIVACY_URL` (local `.env` and EAS production environment)
   - Play Console → **Store presence → Privacy policy**

## Option B: Netlify Drop (fastest, free)

1. Open https://app.netlify.com/drop
2. Drag the `docs` folder onto the page.
3. Copy the generated `https://….netlify.app/privacy-policy.html` URL.
4. (Recommended) Add a custom domain in Netlify → Domain settings.
5. Put the URL in `EXPO_PUBLIC_PRIVACY_URL` and Play Console.

## Option C: Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets.
2. Upload the `docs` folder.
3. Use the generated `https://<project>.pages.dev/privacy-policy.html` URL.

## Verify before submitting

- The page opens in a private/incognito window without logging in.
- It is served over **HTTPS**.
- The support email is a working mailbox.
- The Play Console Data safety answers match the page.
