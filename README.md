# HealthGuard Lite (Web)

A mobile-first health dashboard and emergency call shortcut built with plain HTML, CSS and JavaScript. No frameworks, no build step, no backend.

**Important: HealthGuard Lite is a wellness app, not a medical device.** Heart rate is an estimate from your fingertip and camera, steps are estimated from motion sensors, and blood oxygen (SpO₂) is never estimated.

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
On first load over HTTPS or localhost, `service-worker.js` saves the app files (pages, styles, script, icons) in the browser cache. After that, the app opens without internet, and the Offline chip appears when the device is offline. The cache is named `healthguard-lite-v2`. If you change any file, change that version string so phones pick up the update.

## 5. Sensor features
**Heart rate (camera).** Press Measure heart rate, cover the rear camera and flash with a fingertip, and hold still for 30 seconds. The app reads tiny colour changes in the video, checks signal quality, and shows a number only if the signal is clean and two independent calculations agree. Otherwise it shows Not measured and saves nothing. It is a rough wellness estimate: skin tone, cold fingers, pressure, movement and phone hardware all affect it. If the flash can't be switched on from the browser (common on iPhone), use bright steady light.

**Steps (motion).** Press Start counting on the Steps card. Steps are estimated from the phone's motion sensor and counted only while the app is open and the screen is on. Daily totals are saved on this device. On iPhone, Safari asks for motion access when you tap the button. Carrying the phone in a pocket or hand changes accuracy, and shaking or other repetitive movement can add false steps.

**SpO₂.** Shown as Unavailable. A phone camera cannot measure it safely, and the app never invents it. It would need a genuine compatible pulse oximeter or health data source.

**Old demo records.** If the earlier simulated readings are still stored in your browser, they stay in History labelled Old demo. Clear history removes them.

## 6. Limitations
**Emergency calling**
- The SOS button only opens a confirmation. There you can choose Call now (opens your dialer through a `tel:` link) or Open text message (opens your messaging app with a drafted message through an `sms:` link). You still press call or send yourself.
- The app cannot tell whether you sent the message. Nothing is sent automatically: no alerts, no location, no contact with emergency services.
- `tel:` and `sms:` links need a device with calling and messaging. Most desktop browsers will do nothing or ask which app to use.
- Your emergency contact is stored only in this browser.
- In a real emergency, call your local emergency number directly.

**Sensors**
- Camera and motion access need HTTPS (the Vercel link is fine) and your permission. Neither works from a plain file.
- Step counting stops when the app is in the background or the screen is off.

**PWA and storage**
- Installation and offline mode need HTTPS or localhost. They do not work when opening the file directly (`file://`).
- Data lives only in this browser. Clearing site data or using private browsing removes it. Different devices do not share data.
- Install prompts and menu wording vary between browsers. iPhone Safari offers Add to Home Screen but not all PWA features.
