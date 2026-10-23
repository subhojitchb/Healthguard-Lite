# HealthGuard Lite (Web)

A mobile-first health dashboard and emergency call shortcut built with plain HTML, CSS and JavaScript. No frameworks, no build step, no backend.

**Important: every health reading in this app is simulated demo data. It is not a real sensor measurement and not a medical measurement.**

## Files
`index.html`, `style.css`, `script.js`, `manifest.json`, `service-worker.js`, `icons/`

## 1. Open it locally
- **Quickest:** double-click `index.html`. All four screens, profile saving, history and the SOS dialog work from a file.
- **For install and offline testing:** serve the folder on localhost, for example `python3 -m http.server 8000` inside the folder, then open `http://localhost:8000`.

## 2. Publish with GitHub Pages
1. Create a GitHub repository and upload the contents of this folder (files at the repository root).
2. Open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
4. After a minute, your site is live at `https://<your-username>.github.io/<repository-name>/`.

## 3. Install on Android (Chrome)
1. Open the GitHub Pages link in Chrome on your phone.
2. Tap the **three-dot menu** and choose **Install app** (or **Add to Home screen**).
3. Confirm. HealthGuard Lite appears on your home screen and opens full-screen.

The Profile screen also shows an **Install app** button when Chrome offers installation.

## 4. How offline caching works
On first load over HTTPS or localhost, `service-worker.js` saves the app files (pages, styles, script, icons) in the browser cache. After that, the app opens without internet, and the Offline chip appears when the device is offline. The cache is named `healthguard-lite-v1`. If you change any file, change that version string so phones pick up the update.

## 5. Simulated data
Readings (heart rate, SpO₂, steps) are random plausible numbers generated in the browser each time you press **Refresh readings**. Up to 100 records are kept in `localStorage` on the same browser and device, and each one is labelled Demo. The app does not diagnose anything and cannot detect emergencies.

## 6. Limitations
**Emergency calling**
- The SOS button only opens a confirmation. If you confirm, it opens your phone's dialer using a `tel:` link. You still press call yourself.
- Nothing is sent automatically: no SMS, no alerts, no location, no contact with emergency services.
- `tel:` links need a device with calling. Most desktop browsers will do nothing or ask which app to use.
- In a real emergency, call your local emergency number directly.

**PWA and storage**
- Installation and offline mode need HTTPS or localhost. They do not work when opening the file directly (`file://`).
- Data lives only in this browser. Clearing site data or using private browsing removes it. Different devices do not share data.
- Install prompts and menu wording vary between browsers. iPhone Safari offers Add to Home Screen but not all PWA features.
