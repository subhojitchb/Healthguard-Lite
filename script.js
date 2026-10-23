(() => {
  'use strict';

  const KEY_PROFILE = 'healthguardlite.profile.v1';
  const KEY_HISTORY = 'healthguardlite.history.v1';
  const MAX_RECORDS = 100;
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
  function cleanHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(r => r && num(r.t) && num(r.hr) && num(r.spo2) && num(r.steps))
      .map(r => ({ t: r.t, hr: Math.round(r.hr), spo2: Math.round(r.spo2), steps: Math.round(r.steps) }))
      .slice(-MAX_RECORDS);
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
  let current = null;

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
  const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
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

  /* ---------- Demo reading generator ---------- */
  function generateReading() {
    const now = Date.now();
    const last = history[history.length - 1] || current;
    const baseHr = last ? last.hr : 72;
    const hr = clamp(baseHr + randInt(-6, 7), 60, 96);
    const spo2 = randInt(96, 99);
    const d = new Date(now);
    const dayFrac = (d.getHours() + d.getMinutes() / 60) / 24;
    const floor = Math.round(dayFrac * 8200);
    const prev = last && sameDay(last.t, now) ? last.steps : 0;
    const steps = Math.max(prev, floor) + randInt(25, 240);
    return { t: now, hr, spo2, steps };
  }

  /* ---------- Home ---------- */
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

  function summaryFor(r) {
    if (r.steps >= 6000) return 'Great pace today. Your demo step count is well on its way.';
    if (r.steps >= 2500) return 'Nice and steady. A short walk would keep the demo streak going.';
    return 'A calm start to the day. These are demo values for show only.';
  }

  function renderReading(r, animate) {
    animateNumber($('#hrValue'), r.hr);
    animateNumber($('#spo2Value'), r.spo2);
    animateNumber($('#stepsValue'), r.steps, fmtNum);
    $('#summary').textContent = summaryFor(r);
    if (animate) {
      const home = $('#view-home');
      home.classList.remove('updated');
      void home.offsetWidth;
      home.classList.add('updated');
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
    time.appendChild(el('span', 'tag', 'Demo'));
    const vals = el('span', 'row-vals');
    [['', r.hr, ' bpm'], ['', r.spo2, '% SpO₂'], ['', fmtNum(r.steps), ' steps']].forEach(v => {
      const s = el('span');
      s.appendChild(el('b', '', String(v[1])));
      s.appendChild(document.createTextNode(v[2]));
      vals.appendChild(s);
    });
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

  let saveWarned = false;
  function refreshReadings() {
    const btn = $('#refreshBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('busy');
    btn.querySelector('span').textContent = 'Updating…';
    const delay = reduceMotion() ? 0 : 700;
    setTimeout(() => {
      const r = generateReading();
      current = r;
      history.push(r);
      history = history.slice(-MAX_RECORDS);
      const ok = store.write(KEY_HISTORY, history);
      renderReading(r, true);
      renderRecent();
      if (!ok && !saveWarned) { saveWarned = true; toast('Storage is unavailable, so readings will not be kept after you close the app.'); }
      else toast('Demo readings updated');
      btn.disabled = false;
      btn.classList.remove('busy');
      btn.querySelector('span').textContent = 'Refresh readings';
    }, delay);
  }

  /* ---------- History + chart ---------- */
  let chartRaf = 0;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function renderHistory(animate) {
    const has = history.length > 0;
    $('#chartCard').hidden = !has;
    $('#historyListCard').hidden = !has;
    $('#historyEmpty').hidden = has;
    if (!has) return;
    const ul = $('#historyList');
    ul.textContent = '';
    history.slice(-30).reverse().forEach(r => ul.appendChild(readingRow(r)));
    const shown = Math.min(history.length, 20);
    $('#chartNote').textContent = `Showing the last ${shown} simulated heart-rate reading${shown === 1 ? '' : 's'}. Demo data, not a medical measurement.`;
    drawChart(animate);
  }

  function drawChart(animate) {
    const c = $('#chart');
    if (!c || !c.getContext || !history.length) return;
    const w = c.parentElement.clientWidth, h = 220;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    cancelAnimationFrame(chartRaf);
    const pts = history.slice(-20);
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
    current = history[history.length - 1] || generateReading();
    renderReading(current, false);
    renderRecent();

    $('#refreshBtn').addEventListener('click', refreshReadings);
    $('#sosBtn').addEventListener('click', onSos);
    $('#callLink').addEventListener('click', () => {
      closeDialog($('#sosDialog'));
      $('#sosStatus').textContent = `Opening your phone's dialer for ${profile.cName}. Nothing was sent automatically. If no dialer opened, this device may not support calls.`;
    });
    $$('dialog').forEach(d => {
      d.addEventListener('click', (e) => { if (e.target === d) closeDialog(d); });
      $$('[data-close]', d).forEach(b => b.addEventListener('click', () => closeDialog(d)));
    });
    $('#clearBtn').addEventListener('click', () => openDialog($('#clearDialog')));
    $('#confirmClear').addEventListener('click', () => {
      history = [];
      store.write(KEY_HISTORY, history);
      closeDialog($('#clearDialog'));
      renderHistory(false); renderRecent();
      toast('History cleared');
    });
    $('#profileForm').addEventListener('submit', onSave);
    $('#resetBtn').addEventListener('click', () => { fillForm(); $('#profStatus').textContent = 'Edits discarded.'; });

    window.addEventListener('hashchange', route);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateGreeting(); });
    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (!$('#view-history').hidden) drawChart(false); }, 120);
    });
    updateOnline();
    setupPwa();
    route();
  }
  init();
})();
