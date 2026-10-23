(() => {
  'use strict';

  const KEY_PROFILE = 'healthguardlite.profile.v1';
  const KEY_HISTORY = 'healthguardlite.history.v1';
  const KEY_STEPS = 'healthguardlite.steps.v1';
  const KEY_STEPS_ON = 'healthguardlite.stepson.v1';
  const MAX_RECORDS = 100;
  const MAX_STEP_DAYS = 60;
  const SCAN_MS = 30000;          // contiguous fingertip signal required
  const SETTLE_MS = 3000;         // discarded while exposure/flash settle
  const SCAN_TIMEOUT_MS = 90000;  // give up if a steady run is never achieved
  const VIEWS = ['home', 'history', 'emergency', 'profile'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isHttp = location.protocol === 'http:' || location.protocol === 'https:';

  /* ---------- Safe storage ---------- */
  const store = {
    read(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    write(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    }
  };

  const num = (v) => typeof v === 'number' && isFinite(v);
  // Records: { kind:'hr', t, hr, q } are camera measurements.
  // Older simulated records (no kind) are kept as { kind:'demo', t, hr, steps } and labelled; their SpO2 is dropped.
  function cleanHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
      if (!r || !num(r.t) || !num(r.hr)) continue;
      if (r.kind === 'hr') {
        if (r.hr < 30 || r.hr > 220) continue;
        out.push({ kind: 'hr', t: r.t, hr: Math.round(r.hr), q: r.q === 'good' ? 'good' : 'fair' });
      } else if (r.kind === undefined && num(r.spo2) && num(r.steps)) {
        out.push({ kind: 'demo', t: r.t, hr: Math.round(r.hr), steps: Math.round(r.steps) });
      }
    }
    return out.slice(-MAX_RECORDS);
  }
  function cleanSteps(raw) {
    const days = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && num(raw[k]) && raw[k] >= 0 && raw[k] < 1e6) days[k] = Math.round(raw[k]);
      }
    }
    const keys = Object.keys(days).sort().slice(-MAX_STEP_DAYS);
    const out = {};
    keys.forEach(k => { out[k] = days[k]; });
    return out;
  }
  function cleanProfile(raw) {
    const p = { name: '', age: '', cName: '', cPhone: '' };
    if (raw && typeof raw === 'object') {
      for (const k of Object.keys(p)) if (typeof raw[k] === 'string' || typeof raw[k] === 'number') p[k] = String(raw[k]).slice(0, 60);
    }
    return p;
  }

  let history = cleanHistory(store.read(KEY_HISTORY, []));
  let profile = cleanProfile(store.read(KEY_PROFILE, null));
  let stepDays = cleanSteps(store.read(KEY_STEPS, {}));

  /* ---------- Helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const fmtTime = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtNum = (n) => Number(n).toLocaleString();
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function openDialog(d) {
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  function closeDialog(d) {
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  /* ====================================================================
     Pure signal processing (exposed for testing as window.HealthGuardSignal)
     ==================================================================== */
  const median = (a) => { const b = Array.from(a).sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; };
  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };
  const stdev = (a) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length ? Math.sqrt(s / a.length) : 0; };

  function resample(samples, fs) {
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    const n = Math.floor(((t1 - t0) / 1000) * fs) + 1;
    const out = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + (i * 1000) / fs;
      while (j < samples.length - 2 && samples[j + 1].t < t) j++;
      const a = samples[j], b = samples[j + 1];
      const u = b.t === a.t ? 0 : clamp((t - a.t) / (b.t - a.t), 0, 1);
      out[i] = a.v + (b.v - a.v) * u;
    }
    return out;
  }
  function movingAvg(x, w) {
    const n = x.length, h = Math.floor(w / 2), out = new Float64Array(n), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n - 1, i + h); out[i] = (pre[b + 1] - pre[a]) / (b - a + 1); }
    return out;
  }
  function bandpass(x, fs) {
    const base = movingAvg(x, Math.round(fs * 1.5) | 1);
    const d = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) d[i] = x[i] - base[i];
    return movingAvg(d, 5);
  }
  function spectrum(y, fs) {
    const n = y.length, freqs = [], powers = [];
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    for (let f = 0.7; f <= 3.0001; f += 0.02) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) { const a = (2 * Math.PI * f * i) / fs; re += y[i] * w[i] * Math.cos(a); im += y[i] * w[i] * Math.sin(a); }
      freqs.push(f); powers.push(re * re + im * im);
    }
    return { freqs, powers };
  }
  function findPeaks(y, fs, minDistS) {
    const minD = Math.round(minDistS * fs), peaks = [];
    for (let i = 1; i < y.length - 1; i++) {
      if (y[i] > y[i - 1] && y[i] >= y[i + 1] && y[i] > 0.15) {
        const last = peaks.length - 1;
        if (last >= 0 && i - peaks[last].i < minD) { if (y[i] > y[peaks[last].i]) peaks[last] = refine(y, i); }
        else peaks.push(refine(y, i));
      }
    }
    return peaks;
  }
  function refine(y, i) {
    const a = y[i - 1], b = y[i], c = y[i + 1], d = a - 2 * b + c;
    return { i, pos: Math.abs(d) < 1e-12 ? i : i + (0.5 * (a - c)) / d };
  }

  /* Returns { ok:true, bpm, quality } or { ok:false, code, reason }. Never returns a number unless every check passes. */
  function analyzePPG(samples) {
    const fail = (code, reason) => ({ ok: false, code, reason });
    if (!Array.isArray(samples) || samples.length < 60) return fail('short', 'Not enough camera signal was captured.');
    let maxGap = 0;
    for (let i = 1; i < samples.length; i++) maxGap = Math.max(maxGap, samples[i].t - samples[i - 1].t);
    const startT = samples[0].t + SETTLE_MS;
    const s = samples.filter(p => p.t >= startT);
    if (s.length < 60) return fail('short', 'The scan was too short to analyse.');
    const dur = (s[s.length - 1].t - s[0].t) / 1000;
    if (dur < 20) return fail('short', 'The scan was too short to analyse.');
    if (maxGap > 700) return fail('gaps', 'The camera feed was interrupted during the scan.');
    const rate = (s.length - 1) / dur;
    if (rate < 15) return fail('rate', `This camera delivered only ${rate.toFixed(0)} frames per second, which is too few for a reliable estimate.`);

    const fs = 30;
    const filt = bandpass(resample(s, fs), fs);
    const y = filt.slice(fs, filt.length - fs);       // drop filter edge effects
    const sd = stdev(y);
    if (!(sd > 1e-6)) return fail('weak', 'No pulse signal was found in the video.');
    const m0 = mean(y);
    for (let i = 0; i < y.length; i++) y[i] = (y[i] - m0) / sd;

    const sp = spectrum(y, fs);
    let pk = 0;
    for (let i = 1; i < sp.powers.length; i++) if (sp.powers[i] > sp.powers[pk]) pk = i;
    let others = 0, cnt = 0;
    for (let i = 0; i < sp.powers.length; i++) if (Math.abs(sp.freqs[i] - sp.freqs[pk]) > 0.15) { others += sp.powers[i]; cnt++; }
    const ratio = sp.powers[pk] / (others / Math.max(1, cnt) || 1e-12);
    const specBpm = sp.freqs[pk] * 60;
    if (ratio < 8) return fail('noisy', 'The pulse signal was too weak or too irregular to trust.');

    const peaks = findPeaks(y, fs, 0.33);
    if (peaks.length < 15) return fail('noisy', 'Too few clear heartbeats were detected.');
    const iv = [];
    for (let k = 1; k < peaks.length; k++) iv.push((peaks[k].pos - peaks[k - 1].pos) / fs);
    const med = median(iv);
    const good = iv.filter(v => v >= 0.33 && v <= 1.5 && Math.abs(v - med) <= 0.3 * med);
    const frac = good.length / iv.length;
    if (good.length < 12 || frac < 0.7) return fail('noisy', 'The beat timing was too uneven to trust. Try holding still.');
    const gm = mean(good), cv = stdev(good) / gm;
    const bpm = 60 / median(good);
    if (cv > 0.2) return fail('noisy', 'The beat timing was too uneven to trust. Try holding still.');
    if (Math.abs(bpm - specBpm) > 6) return fail('disagree', 'Two independent checks of your pulse did not agree.');
    if (bpm < 40 || bpm > 180) return fail('range', 'The estimate was outside the range this method can measure reliably.');
    const q = ratio >= 15 && cv <= 0.1 && Math.abs(bpm - specBpm) <= 3 && frac >= 0.85 ? 'good' : 'fair';
    return { ok: true, bpm: Math.round(bpm), quality: q, stats: { ratio, cv, frac, beats: good.length, specBpm } };
  }

  /* Step detector: gravity-removed acceleration magnitude, peak picking, cadence check.
     A run of 4 consistent peaks is needed before steps count, which ignores single shakes and taps. */
  function createStepDetector(onSteps) {
    let lastT = null, g = 0, sm = 0, p1 = 0, p2 = 0, p1t = 0, lastPeakT = -1e9, streak = 0, avgPeak = 2.5;
    const api = {
      reset() { lastT = null; g = 0; sm = 0; p1 = 0; p2 = 0; p1t = 0; lastPeakT = -1e9; streak = 0; },
      push(t, x, y, z) {
        const m = Math.sqrt(x * x + y * y + z * z);
        if (!isFinite(m)) return;
        if (lastT === null) { lastT = t; g = m; p1t = t; return; }
        const dt = clamp((t - lastT) / 1000, 0.001, 0.2);
        lastT = t;
        g += (m - g) * (1 - Math.exp(-dt / 0.8));
        sm += (m - g - sm) * (1 - Math.exp(-dt / 0.04));
        if (p1 > p2 && p1 >= sm) {
          const thr = Math.max(0.8, 0.4 * avgPeak);
          if (p1 > thr && p1t - lastPeakT >= 300) {
            const gap = p1t - lastPeakT;
            streak = gap <= 1200 ? streak + 1 : 1;
            lastPeakT = p1t;
            avgPeak += (Math.min(p1, 8) - avgPeak) * 0.1;
            if (streak === 4) onSteps(4); else if (streak > 4) onSteps(1);
          }
        }
        p2 = p1; p1 = sm; p1t = t;
      }
    };
    return api;
  }
  window.HealthGuardSignal = Object.freeze({ analyzePPG, createStepDetector });

  /* ====================================================================
     Home
     ==================================================================== */
  function animateNumber(node, to, format) {
    const fmt = format || String;
    const from = Number(node.dataset.v);
    node.dataset.v = String(to);
    if (!isFinite(from) || node.dataset.v === '' || reduceMotion() || from === to) { node.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 650;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(tick); else node.textContent = fmt(to);
    };
    requestAnimationFrame(tick);
  }

  const measured = () => history.filter(r => r.kind === 'hr');

  function renderHeart(animate) {
    const m = measured().pop();
    const state = $('#hrState'), val = $('#hrValue');
    if (m) {
      animateNumber(val, m.hr);
      state.textContent = 'Measured';
      state.classList.add('measured');
      $('#summary').textContent = `Camera estimate from ${fmtTime(m.t)}, ${m.q === 'good' ? 'good' : 'fair'} signal. Not a medical measurement.`;
      if (animate) { const home = $('#view-home'); home.classList.remove('updated'); void home.offsetWidth; home.classList.add('updated'); }
    } else {
      delete val.dataset.v;
      val.textContent = '--';
      state.textContent = 'Not measured';
      state.classList.remove('measured');
      $('#summary').textContent = 'Not measured yet. Use Measure heart rate for a 30-second camera scan.';
    }
  }

  function renderRecent() {
    const ul = $('#recentList');
    ul.textContent = '';
    const items = history.slice(-3).reverse();
    $('#recentEmpty').hidden = items.length > 0;
    items.forEach(r => ul.appendChild(readingRow(r)));
  }

  function readingRow(r) {
    const li = el('li');
    const time = el('span', 'row-time', fmtTime(r.t));
    time.appendChild(el('span', 'tag', r.kind === 'hr' ? 'Camera estimate' : 'Old demo'));
    const vals = el('span', 'row-vals');
    const add = (b, tail) => { const s = el('span'); s.appendChild(el('b', '', String(b))); s.appendChild(document.createTextNode(tail)); vals.appendChild(s); };
    add(r.hr, ' bpm');
    if (r.kind === 'hr') vals.appendChild(el('span', '', r.q === 'good' ? 'Good signal' : 'Fair signal'));
    else add(fmtNum(r.steps), ' steps');
    li.append(time, vals);
    return li;
  }

  function updateGreeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const first = profile.name.trim().split(/\s+/)[0];
    $('#greeting').textContent = first ? `${part}, ${first}` : part;
    $('#today').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ====================================================================
     Step counting (DeviceMotionEvent, foreground only)
     ==================================================================== */
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let stepStatus = 'off', listening = false, motionSeen = false, watchdog = 0, saveTimer = 0, lastRenderKey = dayKey();

  const detector = createStepDetector((n) => {
    const k = dayKey();
    stepDays[k] = (stepDays[k] || 0) + n;
    renderSteps();
    if (!saveTimer) saveTimer = setTimeout(flushSteps, 4000);
  });

  function flushSteps() {
    clearTimeout(saveTimer); saveTimer = 0;
    stepDays = cleanSteps(stepDays);
    store.write(KEY_STEPS, stepDays);
  }

  const STEP_TEXT = {
    off: ['Not counting. Counts only while this app is open.', 'Start counting'],
    'needs-tap': ['Tap to resume step counting.', 'Resume'],
    waiting: ['Waiting for motion sensor data…', 'Stop'],
    counting: ['Counting while this app is open.', 'Stop'],
    denied: ['Motion access was blocked. Allow motion sensors for this site in browser settings, then try again.', 'Try again'],
    nodata: ['No motion data received. This device or browser may not provide it.', 'Try again'],
    insecure: ['Motion sensors need a secure (HTTPS) connection.', null],
    unsupported: ["Step counting isn't supported in this browser.", null]
  };
  function setStepStatus(st) {
    stepStatus = st;
    const [text, label] = STEP_TEXT[st];
    $('#stepsStatus').textContent = text;
    const b = $('#stepsBtn');
    b.hidden = !label;
    if (label) b.textContent = label;
    renderSteps();
  }
  function renderSteps() {
    const k = dayKey();
    lastRenderKey = k;
    const n = stepDays[k];
    const node = $('#stepsValue');
    if (n === undefined && stepStatus !== 'counting') node.textContent = '--';
    else node.textContent = fmtNum(n || 0);
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    if (!motionSeen) { motionSeen = true; clearTimeout(watchdog); setStepStatus('counting'); }
    const t = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now();
    detector.push(t, a.x, a.y, a.z);
  }

  async function startSteps(fromTap) {
    if (!('DeviceMotionEvent' in window)) { setStepStatus('unsupported'); return; }
    if (window.isSecureContext === false) { setStepStatus('insecure'); return; }
    const DME = window.DeviceMotionEvent;
    if (typeof DME.requestPermission === 'function') {
      if (!fromTap) { setStepStatus('needs-tap'); return; }
      try {
        const r = await DME.requestPermission();
        if (r !== 'granted') { setStepStatus('denied'); store.write(KEY_STEPS_ON, false); return; }
      } catch (e) { setStepStatus('denied'); return; }
    }
    if (!listening) { window.addEventListener('devicemotion', onMotion); listening = true; }
    detector.reset(); motionSeen = false;
    setStepStatus('waiting');
    store.write(KEY_STEPS_ON, true);
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (!motionSeen) { stopListening(); setStepStatus('nodata'); store.write(KEY_STEPS_ON, false); }
    }, 3500);
  }
  function stopListening() {
    if (listening) { window.removeEventListener('devicemotion', onMotion); listening = false; }
    clearTimeout(watchdog);
  }
  function stopSteps() {
    stopListening();
    flushSteps();
    store.write(KEY_STEPS_ON, false);
    setStepStatus('off');
  }
  function onStepsBtn() {
    if (stepStatus === 'counting' || stepStatus === 'waiting') stopSteps(); else startSteps(true);
  }

  /* ====================================================================
     Camera heart-rate scan
     ==================================================================== */
  const scan = { token: 0, running: false, stream: null, track: null, video: null, samples: [], runStart: 0, lastOk: 0, t0: 0, frame: 0, cancelFrame: null, wake: null, tick: 0 };
  const RING = 2 * Math.PI * 52;

  function setStage(name) {
    $('#scanGuide').hidden = name !== 'guide';
    $('#scanLive').hidden = name !== 'live';
    $('#scanResult').hidden = name !== 'result';
  }

  function openScan() {
    const d = $('#scanDialog');
    setStage('guide');
    const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
    $('#scanSupport').textContent = supported ? '' : 'Camera access is not available here. Open HealthGuard Lite over HTTPS in Chrome (Android) or Safari (iPhone).';
    $('#startScan').disabled = !supported;
    openDialog(d);
  }

  function camMessage(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera permission was blocked. Allow camera access for this site in your browser settings, then scan again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No usable rear camera was found on this device.';
    if (n === 'NotReadableError' || n === 'AbortError') return 'The camera is busy or unavailable. Close other apps that use it and try again.';
    return 'The camera could not be started.';
  }

  function stopScanHardware() {
    scan.token++;
    scan.running = false;
    try { if (scan.cancelFrame) scan.cancelFrame(); } catch (e) { /* ignore */ }
    scan.cancelFrame = null;
    clearInterval(scan.tick);
    const track = scan.track;
    if (track) { try { track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {}); } catch (e) { /* ignore */ } }
    if (scan.stream) scan.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* ignore */ } });
    if (scan.video) { try { scan.video.pause(); } catch (e) { /* ignore */ } scan.video.srcObject = null; }
    if (scan.wake) { try { scan.wake.release(); } catch (e) { /* ignore */ } scan.wake = null; }
    scan.stream = null; scan.track = null;
  }

  async function beginScan() {
    const my = ++scan.token;
    setStage('live');
    $('#scanMsg').textContent = 'Starting camera…';
    $('#scanFlash').textContent = '';
    $('#scanTime').textContent = `${SCAN_MS / 1000} s left`;
    $('#ringFg').style.strokeDashoffset = String(RING);
    $('#qBars').dataset.level = '0';
    $('#qText').textContent = 'Searching for fingertip';
    scan.samples = []; scan.runStart = 0; scan.lastOk = 0; scan.frame = 0; scan.restarted = false;
    scan.video = $('#scanVideo');
    let stream;
    try {
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotFoundError' });
      try {
        stream = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30, min: 15 } } });
      } catch (e) {
        if (e && e.name === 'OverconstrainedError') stream = await md.getUserMedia({ audio: false, video: true }); else throw e;
      }
    } catch (e) {
      if (my === scan.token) showScanResult({ ok: false, reason: camMessage(e), camera: true });
      return;
    }
    if (my !== scan.token) { stream.getTracks().forEach(t => t.stop()); return; }
    scan.stream = stream;
    scan.track = stream.getVideoTracks()[0] || null;
    const v = scan.video;
    v.srcObject = stream; v.muted = true; v.setAttribute('playsinline', '');
    try { await v.play(); } catch (e) { /* frame callbacks may still run */ }
    if (my !== scan.token) return;
    let torch = false;
    try {
      const caps = scan.track && scan.track.getCapabilities ? scan.track.getCapabilities() : {};
      if (caps && caps.torch) { await scan.track.applyConstraints({ advanced: [{ torch: true }] }); torch = true; }
    } catch (e) { torch = false; }
    $('#scanFlash').textContent = torch ? 'Flash is on.' : 'Flash is not available on this device or browser. Use bright, steady light and cover only the lens.';
    try { if (navigator.wakeLock) scan.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
    if (my !== scan.token) return;
    scan.running = true; scan.t0 = 0;
    $('#scanMsg').textContent = 'Cover the camera and flash fully with your fingertip.';
    startFrames(my);
  }

  const cvs = document.createElement('canvas'); cvs.width = cvs.height = 24;
  let cctx = null;
  function grabRGB(v) {
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    if (!cctx) cctx = cvs.getContext('2d', { willReadFrequently: true });
    if (!cctx) return null;
    const side = Math.min(vw, vh) * 0.5;
    cctx.drawImage(v, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, 24, 24);
    const d = cctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return { r: r / n, g: g / n, b: b / n };
  }

  function startFrames(my) {
    const v = scan.video;
    if (typeof v.requestVideoFrameCallback === 'function') {
      const loop = (now) => {
        if (my !== scan.token || !scan.running) return;
        onFrame(now);
        if (scan.running && my === scan.token) { const id = v.requestVideoFrameCallback(loop); scan.cancelFrame = () => v.cancelVideoFrameCallback && v.cancelVideoFrameCallback(id); }
      };
      const id = v.requestVideoFrameCallback(loop);
      scan.cancelFrame = () => v.cancelVideoFrameCallback && v.cancelVideoFrameCallback(id);
    } else {
      let lastVt = -1;
      scan.tick = setInterval(() => {
        if (my !== scan.token || !scan.running) return;
        if (v.currentTime === lastVt) return;
        lastVt = v.currentTime;
        onFrame(performance.now());
      }, 33);
    }
  }

  function fingerOk(c) { return c.r >= 80 && c.r <= 252 && c.r >= 1.6 * c.g && c.r >= 1.6 * c.b; }

  function onFrame(now) {
    const c = grabRGB(scan.video);
    if (!c) return;
    if (!scan.t0) scan.t0 = now;
    const ok = fingerOk(c);
    const S = scan.samples;
    if (ok) {
      if (S.length && now - scan.lastOk > 600) { S.length = 0; scan.restarted = true; }
      if (!S.length) scan.runStart = now;
      S.push({ t: now, v: c.r });
      scan.lastOk = now;
    } else if (S.length && now - scan.lastOk > 600) {
      S.length = 0; scan.restarted = true;
    }
    scan.frame++;
    const elapsed = S.length ? now - scan.runStart : 0;
    $('#ringFg').style.strokeDashoffset = String(RING * (1 - Math.min(1, elapsed / SCAN_MS)));
    $('#scanTime').textContent = `${Math.max(0, Math.ceil((SCAN_MS - elapsed) / 1000))} s left`;

    // live hint
    let lvl = 0, txt = 'No fingertip detected', msg;
    if (!ok) {
      if (c.r > 252) { lvl = 1; txt = 'Too bright: press more lightly'; }
      msg = scan.restarted && !S.length ? 'Fingertip moved or lifted. The 30-second scan restarts when you cover the camera again.' : 'Cover the camera and flash fully with your fingertip.';
    } else {
      msg = elapsed < SETTLE_MS ? 'Hold still…' : 'Keep your finger in place and stay still.';
      if (S.length < 60) { lvl = 2; txt = 'Checking signal'; }
      else {
        const tail = S.slice(-60).map(p => p.v);
        const a = mean(tail.slice(0, 30)), b = mean(tail.slice(30));
        if (Math.abs(a - b) > 5) { lvl = 2; txt = 'Unsteady: hold still'; } else { lvl = 3; txt = 'Steady: keep still'; }
      }
    }
    if (scan.frame % 3 === 0) {
      $('#scanMsg').textContent = msg;
      $('#qBars').dataset.level = String(lvl);
      $('#qText').textContent = txt;
      if (scan.frame % 6 === 0) drawWave(S);
    }
    if (elapsed >= SCAN_MS) { finishScan(); return; }
    if (now - scan.t0 > SCAN_TIMEOUT_MS) {
      stopScanHardware();
      showScanResult({ ok: false, reason: 'A steady 30-second fingertip signal could not be held.' });
    }
  }

  function drawWave(S) {
    const c = $('#scanWave');
    if (!c || !c.getContext) return;
    const w = c.clientWidth || 300, h = 64, dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = S.slice(-150).map(p => p.v);
    if (pts.length < 5) return;
    const m = mean(pts);
    const sc = Math.max(1, ...pts.map(x => Math.abs(x - m)));
    ctx.strokeStyle = cssVar('--teal'); ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((v, i) => { const x = (i / (pts.length - 1)) * w, y = h / 2 - ((v - m) / sc) * (h / 2 - 6); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }

  function finishScan() {
    const samples = scan.samples.slice();
    stopScanHardware();
    showScanResult(analyzePPG(samples));
  }

  function showScanResult(res) {
    setStage('result');
    const pill = $('#resState'), num = $('#resNum'), text = $('#resText'), tips = $('#resTips');
    if (res.ok) {
      const rec = { kind: 'hr', t: Date.now(), hr: res.bpm, q: res.quality };
      history.push(rec);
      history = history.slice(-MAX_RECORDS);
      const saved = store.write(KEY_HISTORY, history);
      pill.textContent = 'Measured'; pill.className = 'pill ok';
      $('#resBpm').textContent = String(res.bpm); num.hidden = false;
      text.textContent = `Estimated from your fingertip. Signal quality: ${res.quality}. This is a wellness estimate, not a medical measurement.` + (saved ? '' : ' It could not be saved because browser storage is unavailable.');
      tips.textContent = '';
      renderHeart(true); renderRecent();
    } else {
      pill.textContent = 'Not measured'; pill.className = 'pill';
      num.hidden = true;
      text.textContent = res.reason + ' No result was saved.';
      tips.textContent = res.camera ? '' : 'Tips: cover the lens and flash fully, press gently, rest your hand on a table, stay quiet, and avoid very cold fingers. If it keeps failing, try again later.';
    }
  }

  function abortScan(reason) {
    if (!scan.running && !scan.stream) return;
    stopScanHardware();
    showScanResult({ ok: false, reason, camera: true });
  }

  /* ---------- History + chart ---------- */
  let chartRaf = 0;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function renderHistory(animate) {
    const days = Object.keys(stepDays).sort().reverse().slice(0, 7);
    const hasHr = history.length > 0, hasSteps = days.length > 0, any = hasHr || hasSteps;
    $('#chartCard').hidden = !any;
    $('#historyListCard').hidden = !any;
    $('#historyEmpty').hidden = any;
    $('#stepsHistoryCard').hidden = !hasSteps;
    if (!any) return;
    const ul = $('#historyList');
    ul.textContent = '';
    history.slice(-30).reverse().forEach(r => ul.appendChild(readingRow(r)));
    $('#historyListEmpty').hidden = hasHr;
    const m = measured();
    $('#chartEmpty').hidden = m.length > 0;
    $('.chart-wrap').hidden = m.length === 0;
    const shown = Math.min(m.length, 20);
    $('#chartNote').textContent = m.length ? `Showing your last ${shown} camera heart-rate estimate${shown === 1 ? '' : 's'}. Not a medical measurement.` : '';
    const sl = $('#stepsHistoryList');
    sl.textContent = '';
    days.forEach(k => {
      const li = el('li');
      const d = new Date(k + 'T00:00:00');
      li.appendChild(el('span', 'row-time', k === dayKey() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })));
      const v = el('span', 'row-vals'); const s2 = el('span'); s2.appendChild(el('b', '', fmtNum(stepDays[k]))); s2.appendChild(document.createTextNode(' steps')); v.appendChild(s2);
      li.appendChild(v); sl.appendChild(li);
    });
    if (m.length) drawChart(animate);
  }

  function drawChart(animate) {
    const c = $('#chart');
    if (!c || !c.getContext || !measured().length) return;
    const w = c.parentElement.clientWidth, h = 220;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    cancelAnimationFrame(chartRaf);
    const pts = measured().slice(-20);
    if (animate && !reduceMotion() && pts.length > 1) {
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / 900);
        paintChart(ctx, w, h, dpr, pts, 1 - Math.pow(1 - p, 3));
        if (p < 1) chartRaf = requestAnimationFrame(tick);
      };
      chartRaf = requestAnimationFrame(tick);
    } else paintChart(ctx, w, h, dpr, pts, 1);
  }

  function paintChart(ctx, w, h, dpr, pts, prog) {
    const teal = cssVar('--teal'), navy2 = cssVar('--navy-2'), line = cssVar('--line');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = 34, R = 14, T = 14, B = 28, pw = w - L - R, ph = h - T - B;
    const vals = pts.map(p => p.hr);
    let lo = Math.min(...vals) - 4, hi = Math.max(...vals) + 4;
    if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
    const X = (i) => L + (pts.length === 1 ? pw / 2 : (i / (pts.length - 1)) * pw);
    const Y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;

    ctx.font = '11px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
    ctx.fillStyle = navy2; ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3, y = Y(v);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
      ctx.fillText(String(Math.round(v)), L - 6, y);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(fmtClock(pts[0].t), L, h - B + 8);
    if (pts.length > 1) { ctx.textAlign = 'right'; ctx.fillText(fmtClock(pts[pts.length - 1].t), w - R, h - B + 8); }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, L + (pw + R) * prog, h); ctx.clip();
    if (pts.length > 1) {
      const path = new Path2D();
      path.moveTo(X(0), Y(pts[0].hr));
      for (let i = 1; i < pts.length; i++) {
        const mx = (X(i - 1) + X(i)) / 2;
        path.bezierCurveTo(mx, Y(pts[i - 1].hr), mx, Y(pts[i].hr), X(i), Y(pts[i].hr));
      }
      const area = new Path2D(path);
      area.lineTo(X(pts.length - 1), T + ph); area.lineTo(X(0), T + ph); area.closePath();
      const g = ctx.createLinearGradient(0, T, 0, T + ph);
      g.addColorStop(0, 'rgba(15,139,141,.28)'); g.addColorStop(1, 'rgba(15,139,141,0)');
      ctx.fillStyle = g; ctx.fill(area);
      ctx.strokeStyle = teal; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(path);
    }
    ctx.restore();
    if (prog >= 0.98) {
      const i = pts.length - 1;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = teal; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(X(i), Y(pts[i].hr), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  /* ---------- Emergency ---------- */
  const phoneDigits = (s) => s.replace(/\D/g, '');
  const telHref = (s) => 'tel:' + (s.trim().startsWith('+') ? '+' : '') + phoneDigits(s);
  const hasContact = () => !!(profile.cName.trim() && phoneDigits(profile.cPhone).length >= 5);

  function renderEmergency() {
    const ok = hasContact();
    $('#contactCard').hidden = !ok;
    $('#noContact').hidden = ok;
    if (ok) { $('#emName').textContent = profile.cName; $('#emNum').textContent = profile.cPhone; }
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function smsHref() {
    const who = profile.name.trim();
    const body = (who ? `This is ${who}. ` : '') + 'I need help. Please call me as soon as you can.';
    const to = (profile.cPhone.trim().startsWith('+') ? '+' : '') + phoneDigits(profile.cPhone);
    return `sms:${to}${isIOS ? '&' : '?'}body=${encodeURIComponent(body)}`;
  }

  function onSos() {
    $('#sosStatus').textContent = '';
    if (!hasContact()) {
      $('#sosStatus').textContent = 'No emergency contact saved yet. Add one in your profile first.';
      $('#noContact').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    $('#dName').textContent = profile.cName;
    $('#dNum').textContent = profile.cPhone;
    $('#callLink').setAttribute('href', telHref(profile.cPhone));
    $('#smsLink').setAttribute('href', smsHref());
    openDialog($('#sosDialog'));
  }

  /* ---------- Profile ---------- */
  const F = { name: '#pName', age: '#pAge', cName: '#cName', cPhone: '#cPhone' };
  const E = { name: '#eName', age: '#eAge', cName: '#eCName', cPhone: '#ePhone' };

  function fillForm() {
    for (const k of Object.keys(F)) $(F[k]).value = profile[k];
    clearErrors();
  }
  function clearErrors() {
    for (const k of Object.keys(F)) { $(E[k]).textContent = ''; $(F[k]).removeAttribute('aria-invalid'); }
  }
  function validate(v) {
    const e = {};
    if (v.name.length < 2) e.name = 'Enter your name (at least 2 characters).';
    const age = Number(v.age);
    if (v.age === '' || !Number.isInteger(age) || age < 1 || age > 120) e.age = 'Enter a whole-number age between 1 and 120.';
    const hasName = v.cName.length > 0, hasPhone = v.cPhone.length > 0;
    if (hasName && v.cName.length < 2) e.cName = 'Contact name needs at least 2 characters.';
    if (hasPhone) {
      const d = phoneDigits(v.cPhone).length;
      if (!/^\+?[0-9\s\-()]+$/.test(v.cPhone) || d < 5 || d > 15) e.cPhone = 'Enter a phone number with 5 to 15 digits. Spaces, dashes and a leading + are fine.';
    }
    if (hasName && !hasPhone && !e.cPhone) e.cPhone = 'Add a phone number for this contact.';
    if (hasPhone && !hasName && !e.cName) e.cName = 'Add a name for this contact.';
    return e;
  }
  function onSave(ev) {
    ev.preventDefault();
    const v = {};
    for (const k of Object.keys(F)) v[k] = $(F[k]).value.trim();
    const errs = validate(v);
    clearErrors();
    $('#profStatus').textContent = '';
    const keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach(k => { $(E[k]).textContent = errs[k]; $(F[k]).setAttribute('aria-invalid', 'true'); });
      $(F[keys[0]]).focus();
      return;
    }
    profile = cleanProfile(v);
    const ok = store.write(KEY_PROFILE, profile);
    $('#profStatus').textContent = ok ? 'Profile saved.' : 'Saved for this session only. Storage is unavailable in this browser.';
    toast(ok ? 'Profile saved' : 'Could not save to browser storage');
    updateGreeting();
    renderEmergency();
  }

  /* ---------- Navigation ---------- */
  function route() {
    const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    $$('.view').forEach(v => {
      const on = v.dataset.view === name;
      if (on && v.hidden) { v.hidden = false; v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
      else if (!on) v.hidden = true;
    });
    $$('.nav a').forEach(a => {
      if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (name === 'history') renderHistory(true);
    if (name === 'emergency') { renderEmergency(); $('#sosStatus').textContent = ''; }
    if (name === 'profile') fillForm();
    window.scrollTo(0, 0);
    const h = $(`#view-${name} h1`);
    if (h) h.focus({ preventScroll: true });
  }

  /* ---------- PWA ---------- */
  let deferredPrompt = null;
  function setupPwa() {
    if (!isHttp) {
      $('#installText').textContent = 'Installing as an app needs HTTPS hosting (for example GitHub Pages) or localhost. It is not available when this page is opened directly as a file.';
      return;
    }
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = 'manifest.json';
    document.head.appendChild(link);
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false;
    });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; $('#installBtn').hidden = true; toast('App installed'); });
    $('#installBtn').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
      deferredPrompt = null; $('#installBtn').hidden = true;
    });
  }

  function updateOnline() { $('#offlineChip').hidden = navigator.onLine !== false; }

  /* ---------- Init ---------- */
  function init() {
    updateGreeting();
    renderHeart(false);
    renderRecent();
    renderSteps();

    $('#measureBtn').addEventListener('click', openScan);
    $('#startScan').addEventListener('click', beginScan);
    $('#againScan').addEventListener('click', () => { setStage('guide'); });
    $('#stopScan').addEventListener('click', () => { stopScanHardware(); closeDialog($('#scanDialog')); });
    $('#scanDialog').addEventListener('close', () => { stopScanHardware(); });
    $('#stepsBtn').addEventListener('click', onStepsBtn);
    $('#sosBtn').addEventListener('click', onSos);
    $('#callLink').addEventListener('click', () => {
      closeDialog($('#sosDialog'));
      $('#sosStatus').textContent = `Asked your phone to open its dialer for ${profile.cName}. You still need to press call there. If no dialer opened, this device may not support calls.`;
    });
    $('#smsLink').addEventListener('click', () => {
      closeDialog($('#sosDialog'));
      $('#sosStatus').textContent = `Asked your phone to open a draft message to ${profile.cName}. Nothing is sent until you press Send in your messaging app. If no app opened, this device may not support text messages.`;
    });
    $$('dialog').forEach(d => {
      d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'scanDialog') closeDialog(d); });
      $$('[data-close]', d).forEach(b => b.addEventListener('click', () => closeDialog(d)));
    });
    $('#clearBtn').addEventListener('click', () => openDialog($('#clearDialog')));
    $('#confirmClear').addEventListener('click', () => {
      history = [];
      stepDays = {};
      store.write(KEY_HISTORY, history);
      flushSteps();
      renderHeart(false); renderSteps();
      closeDialog($('#clearDialog'));
      renderHistory(false); renderRecent();
      toast('History cleared');
    });
    $('#profileForm').addEventListener('submit', onSave);
    $('#resetBtn').addEventListener('click', () => { fillForm(); $('#profStatus').textContent = 'Edits discarded.'; });

    window.addEventListener('hashchange', route);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        flushSteps();
        abortScan('The app moved to the background, so the scan stopped.');
      } else {
        updateGreeting();
        detector.reset();
        if (dayKey() !== lastRenderKey) renderSteps();
      }
    });
    window.addEventListener('pagehide', () => { flushSteps(); stopScanHardware(); });
    setInterval(() => { if (dayKey() !== lastRenderKey) renderSteps(); }, 60000);
    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (!$('#view-history').hidden) drawChart(false); }, 120);
    });
    updateOnline();
    setupPwa();
    route();
    if (store.read(KEY_STEPS_ON, false) === true) startSteps(false);
    else if (!('DeviceMotionEvent' in window)) setStepStatus('unsupported');
    else setStepStatus('off');
  }
  init();
})();
