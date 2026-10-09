/* =====================================================================
   School Digital Signage — app.js
   Vanilla ES6+. Data: Google Sheets CSV • Offline cache • Web Audio
   Debug: add ?at=2026-10-11T09:20 to the URL to simulate date/time.
   ===================================================================== */
(() => {
'use strict';

/* ------------------------------ helpers ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const AR = '٠١٢٣٤٥٦٧٨٩';
const ar = v => String(v).replace(/\d/g, d => AR[d]);
const unAr = s => String(s).replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const store = {
  get: (k, d) => safe(() => JSON.parse(localStorage.getItem(k)) ?? d, d),
  set: (k, v) => safe(() => localStorage.setItem(k, JSON.stringify(v))),
  del: k => safe(() => localStorage.removeItem(k)),
};

const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// time offset for testing
const clockOffset = (() => {
  const at = new URLSearchParams(location.search).get('at');
  const t = at && new Date(at).getTime();
  return t ? t - Date.now() : 0;
})();
const now = () => new Date(Date.now() + clockOffset);

const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const secOfDay = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

function parseDate(s) {
  s = unAr(s || '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return new Date(+m[3], m[2] - 1, +m[1]);
  return null;
}
function parseTime(s) { // -> seconds from midnight, or null
  s = unAr(s || '').trim();
  const m = s.match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?/i);
  if (!m) return null;
  let h = +m[1];
  const ap = (m[4] || '').toLowerCase();
  if ((ap === 'pm' || ap === 'م') && h < 12) h += 12;
  if ((ap === 'am' || ap === 'ص') && h === 12) h = 0;
  return h * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
}
const hhmmAr = sec => {
  const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60;
  return ar(`${h % 12 || 12}:${pad(m)}`) + (h < 12 ? ' ص' : ' م');
};
const truthy = v => !/^(false|0|no|n|لا|معطل|off)$/i.test(String(v ?? '').trim());

function fmtMS(sec) { sec = Math.max(0, Math.round(sec)); return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; }
function fmtCD(ms) { // long-range countdown
  if (ms <= 0) return 'الآن';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
  if (d >= 1) return `${ar(d)} ${d === 1 ? 'يوم' : d <= 10 ? 'أيام' : 'يوماً'}`;
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return ar(`${pad(h)}:${pad(m)}:${pad(s % 60)}`);
}

/* ------------------------------ config ------------------------------- */
const LAYOUTS = { classic: 'الكلاسيكي', mihrab: 'المحراب الذهبي', path: 'مسار اليوم', orchestra: 'الأوركسترا' };
const DEFAULTS = {
  sheetId: '', stage: 'primary', theme: 'royal', layout: 'classic', schoolName: 'مدرسة النور النموذجية', stageName: '',
  logoUrl: '', displayMode: 'regular', lat: 24.7136, lon: 46.6753, weekend: '5,6', pollSec: 60,
  defaultDuration: 12, sound: true, bellRepeat: 5,
};
const REMOTE_KEYS = {
  school_name: 'schoolName', stage_name: 'stageName', logo: 'logoUrl', display_mode: 'displayMode',
  theme: 'theme', layout: 'layout', stage: 'stage', lat: 'lat', lon: 'lon', weekend: 'weekend',
  default_duration: 'defaultDuration', bell_repeat: 'bellRepeat', poll_seconds: 'pollSec', sheet_id: null,
};
let local = store.get('sds.cfg', {});
let remote = store.get('sds.remote', {});
let cfg = {};
function mergeCfg() {
  cfg = { ...DEFAULTS, ...local, ...remote };
  if (local.themeManual) cfg.theme = local.theme;
  if (local.layoutManual) cfg.layout = local.layout;
  if (!LAYOUTS[cfg.layout]) cfg.layout = 'classic';
  cfg.sheetId = local.sheetId ?? '';
  const qs = new URLSearchParams(location.search).get('sheet');
  if (qs) cfg.sheetId = qs;
  cfg.sound = local.sound ?? true;
  if (!['regular', 'exams', 'staff'].includes(cfg.displayMode)) cfg.displayMode = 'regular';
}

/* -------------------------- stage presets ---------------------------- */
const mk = (spec) => spec.map(([name, s, e, type]) => ({ name, s: parseTime(s), e: parseTime(e), type }));
const ORD = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];
const C = i => [`الحصة ${ORD[i - 1]}`];
const STAGES = {
  primary: {
    label: 'المرحلة الابتدائية', grades: 'الصفوف ١ – ٥', range: [1, 5],
    periods: mk([
      [...C(1), '07:00', '07:40', 'class'], [...C(2), '07:40', '08:20', 'class'], [...C(3), '08:20', '09:00', 'class'],
      ['الفسحة', '09:00', '09:30', 'break'],
      [...C(4), '09:30', '10:10', 'class'], [...C(5), '10:10', '10:50', 'class'], [...C(6), '10:50', '11:30', 'class'],
      ['صلاة الظهر', '11:30', '11:55', 'prayer'],
    ]),
  },
  middle: {
    label: 'المرحلة المتوسطة', grades: 'الصفوف ٦ – ٩', range: [6, 9],
    periods: mk([
      [...C(1), '07:00', '07:45', 'class'], [...C(2), '07:45', '08:30', 'class'], [...C(3), '08:30', '09:15', 'class'],
      ['الفسحة', '09:15', '09:40', 'break'],
      [...C(4), '09:40', '10:25', 'class'], [...C(5), '10:25', '11:10', 'class'], [...C(6), '11:10', '11:55', 'class'],
      ['صلاة الظهر', '11:55', '12:20', 'prayer'], [...C(7), '12:20', '13:05', 'class'],
    ]),
  },
  secondary: {
    label: 'المرحلة الثانوية', grades: 'الصفوف ١٠ – ١٢ (علمي وأدبي)', range: [10, 12],
    periods: mk([
      [...C(1), '07:15', '08:00', 'class'], [...C(2), '08:00', '08:45', 'class'], [...C(3), '08:45', '09:30', 'class'],
      ['الفسحة', '09:30', '09:55', 'break'],
      [...C(4), '09:55', '10:40', 'class'], [...C(5), '10:40', '11:25', 'class'], [...C(6), '11:25', '12:10', 'class'],
      ['صلاة الظهر', '12:10', '12:35', 'prayer'], [...C(7), '12:35', '13:20', 'class'],
    ]),
  },
};

/* ------------------------------ state -------------------------------- */
const S = {
  data: { cards: [], news: [], exams: [], staff: [], schedule: [] },
  online: navigator.onLine, fetchOk: true, usingDemo: false,
  periods: [], lastKey: null, emergencyText: null,
};

/* ===================================================================== */
/*                               DATA LAYER                              */
/* ===================================================================== */
function parseCSV(t) {
  t = t.replace(/^﻿/, '');
  const rows = []; let r = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; rows.push(r); r = []; }
    else c += ch;
  }
  if (c !== '' || r.length) { r.push(c); rows.push(r); }
  const ok = rows.filter(x => x.some(v => v.trim() !== ''));
  if (!ok.length) return [];
  const head = ok[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return ok.slice(1).map(row => Object.fromEntries(head.map((k, i) => [k, (row[i] ?? '').trim()])));
}
const sheetIdOf = v => (String(v || '').match(/\/d\/([\w-]+)/) || [, String(v || '').trim()])[1];
const TABS = { settings: ['key', 'value'], cards: ['title', 'content', 'image'], news: ['text'], exams: ['subject'], staff: ['title'], schedule: ['name', 'start'] };

/* Fallback reader: <script> loading (JSONP-style) needs no CORS, so it also works
   when the page is opened straight from disk (file://), where fetch() is blocked. */
const jsonpWait = new Map();
let jsonpSeq = 0;
function gvizToRows(t) {
  const norm = h => String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
  let head = t.cols.map(c => c.label || '');
  const rows = t.rows.map(r => (r.c || []).map(c => (c == null ? '' : String(c.f ?? c.v ?? ''))));
  if (head.every(l => !l)) head = rows.shift() || [];
  head = head.map(norm);
  return rows.filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()])));
}
function fetchTabJsonp(id, tab) {
  window.google = window.google || { visualization: { Query: {} } };
  window.google.visualization.Query.setResponse = resp => { const w = jsonpWait.get(String(resp.reqId)); if (w) w(resp); };
  return new Promise((resolve, reject) => {
    const req = String(++jsonpSeq), s = document.createElement('script');
    const done = () => { clearTimeout(to); jsonpWait.delete(req); s.remove(); };
    const to = setTimeout(() => { done(); reject(new Error('HTTP 403 (الجدول غير مشارك أو لا يمكن الوصول إليه)')); }, 15000);
    jsonpWait.set(req, resp => { done(); resp.status === 'ok' ? resolve(gvizToRows(resp.table)) : reject(new Error('HTTP 404 (' + (resp.errors?.[0]?.message || 'خطأ') + ')')); });
    s.onerror = () => { done(); reject(new Error('Failed to fetch (script)')); };
    s.src = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json;reqId:${req}&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
    document.head.append(s);
  });
}

async function fetchTab(id, tab) {
  if (new URLSearchParams(location.search).has('jsonp')) return validateTab(tab, await fetchTabJsonp(id, tab)); // diagnostic: force the no-CORS reader
  try { return await fetchTabCsv(id, tab); }
  catch (e) { if (e instanceof TypeError || /abort/i.test(e.name)) return validateTab(tab, await fetchTabJsonp(id, tab)); throw e; }
}
function validateTab(tab, rows) {
  // gviz silently returns the first sheet for unknown names -> validate headers
  return rows.length && !TABS[tab].some(k => k in rows[0]) ? [] : rows;
}
async function fetchTabCsv(id, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return validateTab(tab, parseCSV(await res.text()));
  } finally { clearTimeout(to); }
}

async function refreshData() {
  const id = sheetIdOf(cfg.sheetId);
  if (!id) {
    S.usingDemo = true; S.fetchOk = true;
    S.data = demoData(); remote = {}; mergeCfg();
    afterData(); return;
  }
  S.usingDemo = false;
  const names = Object.keys(TABS);
  const res = await Promise.allSettled(names.map(n => fetchTab(id, n)));
  let okCount = 0;
  res.forEach((r, i) => {
    const n = names[i];
    if (r.status === 'fulfilled') { okCount++; store.set('sds.cache.' + n, r.value); }
  });
  S.fetchOk = okCount > 0;
  const bad = res.find(r => r.status === 'rejected');
  S.fetchErr = okCount > 0 ? '' : String(bad?.reason?.message || bad?.reason || 'خطأ غير معروف');
  if (S.fetchErr) console.warn('[school-tv] تعذر قراءة الجدول:', S.fetchErr);
  const get = n => { const r = res[names.indexOf(n)]; return r.status === 'fulfilled' ? r.value : store.get('sds.cache.' + n, []); };
  const settingsRows = get('settings');
  const rem = {};
  settingsRows.forEach(({ key, value }) => {
    const k = REMOTE_KEYS[(key || '').toLowerCase()];
    if (k && value !== '') rem[k] = ['lat', 'lon', 'pollSec', 'defaultDuration', 'bellRepeat'].includes(k) ? +unAr(value) : value;
  });
  remote = rem; store.set('sds.remote', rem);
  S.data = { cards: get('cards'), news: get('news'), exams: get('exams'), staff: get('staff'), schedule: get('schedule') };
  mergeCfg();
  afterData();
}

/* demo content (shown until a sheet is connected) */
function demoData() {
  const t = now(), nowS = secOfDay(t), today = startOfDay(t);
  const hm = s => { const x = ((s % 86400) + 86400) % 86400; return `${pad(Math.floor(x / 3600))}:${pad(Math.floor(x / 60) % 60)}`; };
  const svg = (a, b, emoji, w, h) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-size="${Math.min(w, h) * .4}" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`);
  const st = STAGES[cfg.stage] || STAGES.primary;
  const grades = cfg.stage === 'secondary'
    ? ['١٠ علمي', '١٠ أدبي', '١١ علمي', '١١ أدبي', '١٢ علمي', '١٢ أدبي']
    : Array.from({ length: st.range[1] - st.range[0] + 1 }, (_, i) => `الصف ${ar(st.range[0] + i)}`);
  const subj = ['اللغة العربية', 'الرياضيات', 'العلوم', 'اللغة الإنجليزية', 'التربية الإسلامية', 'الاجتماعيات', 'الحاسب'];
  const exams = [];
  const days = []; for (let i = -1, n = 0; n < 7; i++) { const d = new Date(today); d.setDate(d.getDate() + i); if (!cfg.weekend.split(',').includes(String(d.getDay()))) { days.push(d); n++; } }
  grades.forEach((g, gi) => days.forEach((d, di) => {
    if ((di + gi) % 3 === 2) return; // rest days 🌴
    exams.push({ date: dateKey(d), grade: g, subject: subj[(di + gi) % subj.length], time: '08:00' });
  }));
  return {
    cards: [
      { title: 'أهلاً بكم في مدرستنا', content: 'نصنع جيلاً متميزاً بالعلم والأخلاق', type: 'text', duration: '10' },
      { title: 'يوم التميز', content: 'تكريم الطلاب المتفوقين الأسبوع القادم', image: svg('#4b1d9e', '#12072b', '🏆', 1600, 900), duration: '10' },
      { title: 'مسابقة القراءة', content: 'اقرأ.. وارتقِ بفكرك', image: svg('#0e7490', '#082f49', '📖', 800, 1400), duration: '10' },
      { title: 'تذكير', content: 'الحضور المبكر والالتزام بالزي المدرسي\nمسؤوليتنا جميعاً', type: 'text', duration: '10' },
    ],
    news: [
      { text: 'يسرّنا الترحيب بأولياء الأمور في أسبوع الاجتماعات الدورية', priority: 'normal' },
      { text: 'يرجى من الطلاب الحفاظ على نظافة الساحات والممرات', priority: 'normal' },
      { text: 'تذكير: موعد تسليم الأنشطة نهاية الأسبوع', priority: 'high' },
    ],
    exams,
    staff: [
      { title: 'الاجتماع الصباحي للمعلمين', start: hm(nowS - 3600), end: hm(nowS - 1800), date: dateKey(today), location: 'قاعة الاجتماعات' },
      { title: 'اجتماع لجنة الاختبارات', start: hm(nowS - 900), end: hm(nowS + 2700), date: dateKey(today), location: 'غرفة الإدارة' },
      { title: 'لقاء أولياء الأمور', start: hm(nowS + 5400), end: hm(nowS + 9000), date: dateKey(today), location: 'المسرح' },
      { title: 'ورشة التطوير المهني', start: hm(nowS + 12600), end: hm(nowS + 16200), date: dateKey(today), location: 'المختبر' },
    ],
    schedule: [],
  };
}

/* after any data refresh */
function afterData() {
  applyTheme(); applyLayout(); applyBrand(); applyMode();
  buildPeriods(); renderSchedule();
  buildCarousel(); buildTicker(); renderExams(); renderStaff(); checkEmergency();
  updateNet(); scheduleWeather(true);
  clearTimeout(pollT); pollT = setTimeout(refreshData, (S.fetchOk ? Math.max(15, +cfg.pollSec || 60) : 20) * 1000);
}
let pollT;

/* ===================================================================== */
/*                                 BRAND                                 */
/* ===================================================================== */
const driveId = u => (String(u).match(/\/d\/([\w-]+)/) || String(u).match(/[?&]id=([\w-]+)/) || [])[1];
const imgUrl = u => { const id = /drive\.google\.com/.test(u) && driveId(u); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1920` : u; };

function applyBrand() {
  const st = STAGES[cfg.stage] || STAGES.primary;
  $('#schoolName').textContent = cfg.schoolName;
  $('#stageName').textContent = cfg.stageName || `${st.label} • ${st.grades}`;
  document.title = cfg.schoolName;
  const box = $('#logo'), cur = box.dataset.url || '';
  if ((cfg.logoUrl || '') !== cur) {
    box.dataset.url = cfg.logoUrl || '';
    if (cfg.logoUrl) {
      if (!box.dataset.svg) box.dataset.svg = box.innerHTML;
      box.innerHTML = '';
      const im = new Image(); im.alt = 'شعار'; im.src = imgUrl(cfg.logoUrl);
      im.onerror = () => { box.innerHTML = box.dataset.svg; };
      box.append(im);
    } else if (box.dataset.svg) box.innerHTML = box.dataset.svg;
  }
}
function applyTheme() {
  document.body.dataset.theme = cfg.theme;
  $('#btnTheme').textContent = cfg.theme === 'light' ? '☀️' : '🌙';
}
function applyLayout() { document.body.dataset.layout = cfg.layout; renderTimeline(); }
function applyMode() {
  document.body.dataset.mode = cfg.displayMode;
  ['regular', 'exams', 'staff'].forEach(m => { $('#mode-' + m).hidden = m !== cfg.displayMode; });
}

/* ===================================================================== */
/*                           CLOCK / NETWORK                             */
/* ===================================================================== */
function renderClock(t) {
  const h = t.getHours();
  $('#clkHM').textContent = ar(`${h % 12 || 12}:${pad(t.getMinutes())}`);
  $('#clkS').textContent = ar(pad(t.getSeconds()));
  $('#clkAP').textContent = h < 12 ? 'ص' : 'م';
  $('#clkDay').textContent = DAYS[t.getDay()];
  $('#clkDate').textContent = `${ar(t.getDate())} ${MONTHS[t.getMonth()]} ${ar(t.getFullYear())}م`;
}
function updateNet() {
  const on = navigator.onLine && S.fetchOk;
  S.online = on;
  const el = $('#net'); el.classList.toggle('on', on); el.classList.toggle('off', !on);
  let txt = 'متصل بالإنترنت', tip = 'الاتصال سليم';
  if (!navigator.onLine) { txt = 'وضع عدم الاتصال'; tip = 'لا يوجد اتصال بالإنترنت'; }
  else if (!S.fetchOk) {
    const e = S.fetchErr || '';
    txt = 'متصل · تعذر قراءة الجدول';
    tip = /40[134]/.test(e) ? 'الجدول غير مشارك أو الرابط خاطئ (' + e + '). اجعل المشاركة: أي شخص لديه الرابط - عارض.' : 'تعذر الوصول إلى Google Sheets (' + e + '). تحقق من الرابط ومن حجب الشبكة. يعرض آخر بيانات محفوظة.';
  }
  $('#netText').textContent = txt; el.title = tip;
}
addEventListener('online', () => { updateNet(); refreshData(); });
addEventListener('offline', updateNet);

/* ------------------------------ weather ------------------------------ */
const WMO = [
  [[0], 'صافٍ', '☀️'], [[1, 2], 'غائم جزئياً', '🌤️'], [[3], 'غائم', '☁️'], [[45, 48], 'ضباب', '🌫️'],
  [[51, 53, 55, 56, 57], 'رذاذ', '🌦️'], [[61, 63, 65, 66, 67], 'أمطار', '🌧️'], [[71, 73, 75, 77, 85, 86], 'ثلوج', '❄️'],
  [[80, 81, 82], 'زخات مطر', '🌦️'], [[95, 96, 99], 'عاصفة رعدية', '⛈️'],
];
let weatherT, wKey = '';
function scheduleWeather(force) {
  const key = cfg.lat + ',' + cfg.lon;
  if (!force && key === wKey) return;
  wKey = key; clearInterval(weatherT);
  showWeather(store.get('sds.weather'));
  loadWeather(); weatherT = setInterval(loadWeather, 15 * 60 * 1000);
}
async function loadWeather() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&current=temperature_2m,weather_code&timezone=auto`);
    const j = await r.json();
    const w = { t: Math.round(j.current.temperature_2m), c: j.current.weather_code };
    store.set('sds.weather', w); showWeather(w);
  } catch { /* keep last */ }
}
function showWeather(w) {
  if (!w) return;
  const m = WMO.find(x => x[0].includes(w.c)) || [[], 'طقس', '⛅'];
  $('#wIcon').textContent = m[2]; $('#wTemp').textContent = ar(w.t) + '°م'; $('#wText').textContent = m[1];
}

/* ===================================================================== */
/*                           SCHEDULE / BELLS                            */
/* ===================================================================== */
function buildPeriods() {
  const rows = S.data.schedule.filter(r => !r.stage || r.stage.toLowerCase() === cfg.stage)
    .map(r => ({ name: r.name, s: parseTime(r.start), e: parseTime(r.end), type: ['break', 'prayer'].includes((r.type || '').toLowerCase()) ? r.type.toLowerCase() : 'class' }))
    .filter(p => p.name && p.s != null && p.e != null).sort((a, b) => a.s - b.s);
  S.periods = rows.length ? rows : testMode() ? testPeriods() : (STAGES[cfg.stage] || STAGES.primary).periods;
}
/* TEST ONLY: while no sheet is connected, generate short periods around "now"
   so every state (warn / danger / break / prayer / bells) can be seen in minutes.
   Add ?real=1 to the URL to use the real stage timetables instead. */
const testMode = () => S.usingDemo && !new URLSearchParams(location.search).has('real');
let testBase = null;
function testPeriods() {
  if (testBase == null) testBase = Math.floor(secOfDay(now()) / 60) * 60 - 60; // current period began ~1 min ago
  const m = 60, b = testBase;
  return [
    ['الحصة الأولى', -6, 0, 'class'], ['الحصة الثانية', 0, 6, 'class'], ['الفسحة', 6, 9, 'break'],
    ['الحصة الثالثة', 9, 14, 'class'], ['صلاة الظهر', 14, 17, 'prayer'], ['الحصة الرابعة', 17, 22, 'class'], ['الحصة الخامسة', 22, 27, 'class'],
  ].map(([name, s, e, type]) => ({ name, s: b + s * m, e: b + e * m, type }));
}
const isWeekend = t => !testMode() && String(cfg.weekend).split(',').map(s => s.trim()).includes(String(t.getDay()));

function scheduleState(t) {
  const P = S.periods;
  if (isWeekend(t)) return { kind: 'weekend' };
  const n = secOfDay(t);
  if (!P.length) return { kind: 'after' };
  if (n < P[0].s) return { kind: 'before', next: P[0], remain: P[0].s - n };
  const i = P.findIndex(p => n >= p.s && n < p.e);
  if (i >= 0) return { kind: 'period', i, cur: P[i], remain: P[i].e - n, total: P[i].e - P[i].s, next: P[i + 1] };
  const j = P.findIndex(p => p.s > n);
  if (j < 0) return { kind: 'after' };
  return { kind: 'gap', next: P[j], remain: P[j].s - n, i: j };
}

function renderSchedule() {
  $('#schedList').innerHTML = S.periods.map((p, i) => {
    const num = p.type === 'class' ? ar(S.periods.slice(0, i + 1).filter(x => x.type === 'class').length) : (p.type === 'prayer' ? '🕌' : '☕');
    return `<li data-i="${i}" class="${p.type === 'class' ? '' : p.type === 'break' ? 'brk' : 'prayer'}">
      <span class="no">${num}</span><span>${esc(p.name)}</span><span class="tm">${hhmmAr(p.s)} – ${hhmmAr(p.e)}</span><span class="tg"></span></li>`;
  }).join('');
  S.lastKey = null; lastStatusKey = '';
  renderTimeline();
}

let lastStatusKey = '';
function updateSchedule(t) {
  const st = scheduleState(t), el = $('#status');
  const urgency = st.kind === 'period' ? (st.remain <= 120 ? 'danger' : st.remain <= 300 ? 'warn' : '') : '';
  el.dataset.state = st.kind; el.dataset.urgency = urgency;
  document.body.dataset.state = st.kind === 'period' ? st.cur.type : 'idle';
  el.style.setProperty('--p', (st.kind === 'period' ? st.remain / st.total * 100 : 0).toFixed(1) + '%');
  updateTimeline(t, st);
  const set = (label, icon, title, time, cdLbl, next) => {
    $('#stLabel').textContent = label; $('#stIcon').textContent = icon; $('#stTitle').textContent = title;
    $('#stTime').textContent = time; $('#stCdLbl').textContent = cdLbl; $('#stNext').textContent = next;
  };
  const range = p => `${hhmmAr(p.s)} – ${hhmmAr(p.e)}`;
  const key = st.kind + (st.i ?? '');
  if (st.kind === 'period') {
    const p = st.cur;
    if (key !== lastStatusKey) set(p.type === 'class' ? 'الحصة الحالية' : p.type === 'break' ? 'استراحة' : 'وقت الصلاة',
      p.type === 'class' ? '📚' : p.type === 'break' ? '🍎' : '🕌', p.name, range(p), 'المتبقي على الانتهاء',
      st.next ? `التالي: ${st.next.name} — ${hhmmAr(st.next.s)}` : 'آخر فقرة في اليوم الدراسي');
    $('#stCd').textContent = ar(fmtMS(st.remain));
    $('#stBar').style.width = (100 - st.remain / st.total * 100).toFixed(2) + '%';
  } else if (key !== lastStatusKey || st.kind === 'before' || st.kind === 'gap') {
    if (st.kind === 'before') {
      set('قبل الدوام', '🌅', 'صباح الخير', `بداية الدوام ${hhmmAr(st.next.s)}`, 'المتبقي على بداية الدوام', `أول فقرة: ${st.next.name}`);
      $('#stCd').textContent = ar(st.remain >= 3600 ? `${pad(Math.floor(st.remain / 3600))}:${fmtMS(st.remain % 3600)}` : fmtMS(st.remain));
    } else if (st.kind === 'gap') {
      set('استراحة بين الفقرات', '⏳', 'انتقال', '', 'المتبقي على الفقرة التالية', `التالي: ${st.next.name} — ${hhmmAr(st.next.s)}`);
      $('#stCd').textContent = ar(fmtMS(st.remain));
    } else if (st.kind === 'after') set('انتهى اليوم الدراسي', '🏡', 'نهاية الدوام', 'نراكم غداً بإذن الله', '', 'في أمان الله ورعايته');
    else set('عطلة', '🌴', 'عطلة نهاية الأسبوع', 'نتمنى لكم إجازة سعيدة', '', 'نلقاكم في أول يوم دراسي');
    $('#stBar').style.width = st.kind === 'after' ? '100%' : '0%';
  }
  lastStatusKey = key;

  // list rows
  $$('#schedList li').forEach(li => {
    const i = +li.dataset.i, p = S.periods[i];
    const n = secOfDay(t);
    const cls = st.kind === 'weekend' ? 'upcoming' : n >= p.e ? 'passed' : n >= p.s ? 'current' : 'upcoming';
    if (!li.classList.contains(cls)) {
      li.classList.remove('passed', 'current', 'upcoming'); li.classList.add(cls);
      li.querySelector('.tg').textContent = cls === 'passed' ? 'انتهت' : cls === 'current' ? 'الآن' : 'قادمة';
      if (cls === 'current') { const box = $('#schedList'); box.scrollTo({ top: li.offsetTop - box.offsetTop - box.clientHeight / 2 + li.clientHeight / 2, behavior: 'smooth' }); }
    }
  });

  // bells on transitions
  const bk = st.kind === 'period' ? 'p' + st.i : st.kind;
  if (S.lastKey !== null && bk !== S.lastKey && !isWeekend(t)) {
    if (st.kind === 'period' && st.cur.type === 'class') Sound.startBell();
    else if (String(S.lastKey).startsWith('p')) Sound.endBell();
  }
  S.lastKey = bk;
}

/* day timeline (used by the 'path' layout) */
function renderTimeline() {
  const P = S.periods, tr = $('#tlTrack'); if (!P.length) { tr.innerHTML = ''; return; }
  const a = P[0].s, b = P[P.length - 1].e, span = b - a; let n = 0;
  tr.innerHTML = P.map((p, i) => {
    const lbl = p.type === 'class' ? ar(++n) : p.type === 'prayer' ? '🕌' : '☕';
    return `<div class="seg ${p.type}" data-i="${i}" title="${esc(p.name)}" style="right:${((p.s - a) / span * 100).toFixed(2)}%;width:calc(${((p.e - p.s) / span * 100).toFixed(2)}% - .3rem)">${lbl}</div>`;
  }).join('') + '<div class="sun" id="tlSun"></div>';
}
function updateTimeline(t, st) {
  const P = S.periods; if (!P.length) return;
  const a = P[0].s, b = P[P.length - 1].e, n = secOfDay(t);
  const pct = st.kind === 'weekend' ? 0 : Math.min(100, Math.max(0, (n - a) / (b - a) * 100));
  const sun = $('#tlSun'); if (sun) sun.style.right = pct.toFixed(2) + '%';
  $$('#tlTrack .seg').forEach(s => { const p = P[+s.dataset.i]; s.classList.toggle('passed', st.kind !== 'weekend' && n >= p.e); s.classList.toggle('current', st.kind !== 'weekend' && n >= p.s && n < p.e); });
}

/* ===================================================================== */
/*                               CAROUSEL                                */
/* ===================================================================== */
const ytId = u => (String(u).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || [])[1];
function kindOf(c) {
  const url = c.image || c.media || c.url || '', ty = (c.type || '').toLowerCase();
  if (ty === 'video' && url) {
    if (/youtu/.test(url) && ytId(url)) return 'youtube';           // a YouTube link marked "video"
    if (/drive\.google\.com/.test(url) && driveId(url)) return 'drivevideo';
  }
  if (['image', 'video', 'youtube', 'drive', 'iframe', 'text'].includes(ty) && (ty === 'text' || url)) return ty;
  if (!url) return 'text';
  if (ytId(url) && /youtu/.test(url)) return 'youtube';
  if (/\.(mp4|webm|ogg|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(url) || /^data:image/.test(url) || /googleusercontent|drive\.google\.com\/thumbnail/.test(url)) return 'image';
  if (/drive\.google\.com/.test(url)) return 'drive';
  return 'image';
}
const CA = { list: [], sig: '', i: -1, end: 0, total: 1, cur: null, video: false };

function buildCarousel() {
  const t = now(), today = startOfDay(t);
  const list = S.data.cards.filter(c => truthy(c.active)).filter(c => {
    const a = parseDate(c.start_date), b = parseDate(c.end_date);
    return (!a || today >= a) && (!b || today <= b);
  }).filter(c => c.title || c.content || c.image || c.media || c.url);
  if (!list.length) list.push({ title: cfg.schoolName, content: 'أهلاً بكم', type: 'text' });
  const sig = JSON.stringify(list);
  if (sig === CA.sig) return;
  CA.sig = sig; CA.list = list;
  $('#dots').innerHTML = list.map(() => '<i></i>').join('');
  showCard(0);
}
let ytApi;
function loadYT() {
  return ytApi || (ytApi = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res();
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = rej; document.head.append(s);
    setTimeout(() => rej(new Error('YouTube API timeout')), 10000);
  }).catch(e => { ytApi = null; throw e; }));
}
function showCard(i) {
  const L = CA.list; if (!L.length) return;
  i = (i + L.length) % L.length; CA.i = i;
  const c = L[i], kind = kindOf(c), url = c.image || c.media || c.url || '';
  const explicit = +unAr(c.duration || '') || 0;           // a duration typed in the sheet always wins
  const dur = Math.max(4, explicit || +cfg.defaultDuration || 12);
  const old = CA.cur;
  const sl = document.createElement('div'); sl.className = 'slide';
  const advance = () => {
    if (CA.cur !== sl) return;
    if (CA.list.length > 1) showCard(CA.i + 1);
    else { const v = $('video', sl); if (v) { v.currentTime = 0; v.play().catch(() => { }); } }
  };
  clearTimeout(CA.cap);
  const cap = (c.title || c.content) && kind !== 'text'
    ? `<div class="cap">${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${c.content ? `<p>${esc(c.content)}</p>` : ''}</div>` : '';
  const fallbackText = () => { sl.className = 'slide txt on'; sl.innerHTML = textSlide(c); };
  CA.video = false;
  if (kind === 'image') {
    const u = imgUrl(url);
    sl.innerHTML = `<div class="bgblur" style="background-image:url('${u.replace(/'/g, '%27')}')"></div><img class="main" alt="">${cap}`;
    const im = $('img', sl); im.onerror = fallbackText; im.src = u;
  } else if (kind === 'video' || kind === 'drivevideo' || (kind === 'drive' && driveId(url))) {
    // Drive links are streamed straight into <video> so they autoplay (the Drive player never does)
    const dId = kind === 'video' ? null : driveId(url);
    const src = dId ? `https://drive.usercontent.google.com/download?id=${dId}&export=download&confirm=t` : url;
    sl.innerHTML = `<video muted autoplay playsinline preload="auto"></video>${cap}`;
    const v = $('video', sl); CA.video = true;
    const giveUp = () => {
      if (CA.cur !== sl) return;
      if (dId && !sl.dataset.fb) {
        sl.dataset.fb = 1; v.remove();
        CA.video = false; CA.total = dur; CA.end = Date.now() + dur * 1000;
        const preview = () => sl.insertAdjacentHTML('afterbegin', `<iframe allow="autoplay" src="https://drive.google.com/file/d/${dId}/preview"></iframe>`);
        if (kind === 'drive') { // not a playable video: maybe the file is a picture, otherwise use Drive's own viewer
          const u = imgUrl(url);
          sl.insertAdjacentHTML('afterbegin', `<div class="bgblur" style="background-image:url('${u}')"></div><img class="main" alt="">`);
          const im = $('img', sl); im.onerror = () => { im.remove(); $('.bgblur', sl)?.remove(); preview(); }; im.src = u;
        } else preview();
        return;
      }
      CA.video = false; CA.total = 2; CA.end = Date.now() + 2000; // skip a video that cannot play
    };
    v.onended = () => advance();
    v.onerror = giveUp;
    v.ontimeupdate = () => { if (CA.video && isFinite(v.duration)) { CA.total = v.duration; CA.end = Date.now() + (v.duration - v.currentTime) * 1000; } };
    v.src = src; v.play().catch(() => { });
    setTimeout(() => { if (CA.cur === sl && CA.video && (v.readyState < 2 || (v.paused && v.currentTime === 0))) giveUp(); }, 12000);
  } else if (kind === 'youtube') {
    const id = ytId(url), box = document.createElement('div'), mount = document.createElement('div');
    sl.innerHTML = cap; box.className = 'ytbox'; box.append(mount); sl.prepend(box);
    const plain = () => { if (CA.cur !== sl) return; box.innerHTML = `<iframe allow="autoplay; encrypted-media" src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1"></iframe>`; };
    loadYT().then(() => {
      if (CA.cur !== sl) return;
      let started = false;
      new YT.Player(mount, {
        videoId: id, width: '100%', height: '100%',
        playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3 },
        events: {
          onReady: e => { e.target.mute(); e.target.playVideo(); },
          onStateChange: e => {
            if (CA.cur !== sl) return;
            if (e.data === 1 && !started) { // playing: follow the real length unless the sheet sets a duration
              started = true;
              const d = e.target.getDuration();
              if (!explicit && d > 0) { CA.total = d; CA.end = Date.now() + (d - e.target.getCurrentTime() + 2) * 1000; }
            }
            if (e.data === 0) { if (CA.list.length > 1) advance(); else { e.target.seekTo(0); e.target.playVideo(); CA.end = Date.now() + CA.total * 1000; } }
          },
          onError: () => { CA.end = Date.now() + 2000; CA.total = 2; }, // not embeddable: skip
        },
      });
    }).catch(plain);
  } else if (kind === 'drive') {
    const id = driveId(url);
    sl.innerHTML = `<iframe allow="autoplay" src="${id ? `https://drive.google.com/file/d/${id}/preview` : esc(url)}"></iframe>${cap}`;
  } else if (kind === 'iframe') {
    sl.innerHTML = `<iframe src="${esc(url)}"></iframe>${cap}`;
  } else { sl.classList.add('txt'); sl.innerHTML = textSlide(c); }

  $('#slides').append(sl);
  const vv = $('video', sl);   // start playback only once the element is in the page (autoplay can silently fail before)
  if (vv) { const go = () => vv.play().catch(() => { }); go(); vv.addEventListener('canplay', go, { once: true }); setTimeout(go, 3000); }
  requestAnimationFrame(() => requestAnimationFrame(() => sl.classList.add('on')));
  if (old) { old.classList.remove('on'); setTimeout(() => { old.querySelector('video')?.pause(); old.remove(); }, 1000); }
  const wait = kind === 'youtube' && !explicit ? 25 : dur;   // give the YouTube player time to start
  CA.cur = sl; CA.total = wait; CA.end = CA.video ? Infinity : Date.now() + wait * 1000;
  if (explicit && (kind === 'video' || kind === 'drivevideo')) CA.cap = setTimeout(advance, explicit * 1000);
  $$('#dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  $('#cdBadge').style.visibility = L.length > 1 || kind === 'video' ? 'visible' : 'hidden';
}
const textSlide = c => `<div class="frame"></div><div class="inner"><div class="orn">✦</div>${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${c.content ? `<p>${esc(c.content)}</p>` : ''}</div>`;

function updateCarousel() {
  if (CA.i < 0) return;
  const left = CA.end === Infinity ? null : Math.max(0, Math.ceil((CA.end - Date.now()) / 1000));
  if (left == null) { $('#cdNum').textContent = '▶'; return; }
  $('#cdNum').textContent = ar(left);
  $('#cdRing').style.strokeDashoffset = (119.4 * (1 - Math.min(1, left / CA.total))).toFixed(1);
  if (left <= 0 && !CA.video) { if (CA.list.length > 1) showCard(CA.i + 1); else CA.end = Date.now() + CA.total * 1000; }
}

/* ===================================================================== */
/*                         TICKER / EMERGENCY                            */
/* ===================================================================== */
let tickSig = '';
function buildTicker() {
  const items = S.data.news.filter(n => truthy(n.active) && n.text);
  const list = items.length ? items : [{ text: 'مرحباً بكم في مدرستنا — نتمنى لكم يوماً دراسياً موفقاً', priority: 'normal' }];
  const sig = JSON.stringify(list); if (sig === tickSig) return; tickSig = sig;
  const icon = { emergency: '🚨', high: '⚠️', normal: '✦' };
  const grp = '<div class="tk-grp">' + list.map(n => {
    const p = (n.priority || 'normal').toLowerCase(); const pr = icon[p] ? p : 'normal';
    return `<span class="it ${pr}">${icon[pr]} ${esc(n.text)}</span><span class="sep">◆</span>`;
  }).join('') + '</div>';
  const tr = $('#tkTrack'); tr.innerHTML = grp + grp;
  const chars = list.reduce((a, n) => a + n.text.length + 6, 0);
  tr.style.setProperty('--tk-dur', Math.max(25, chars * 0.32) + 's');
}

let sirenT;
function checkEmergency() {
  const em = S.data.news.filter(n => truthy(n.active) && (n.priority || '').toLowerCase() === 'emergency' && n.text).map(n => n.text);
  setEmergency(em.length ? em.join('  •  ') : null);
}
function setEmergency(text) {
  if (text === S.emergencyText) return;
  S.emergencyText = text;
  $('#emergency').hidden = !text;
  clearInterval(sirenT);
  if (text) { $('#emText').textContent = text; Sound.siren(); sirenT = setInterval(Sound.siren, 4000); }
}

/* ===================================================================== */
/*                                EXAMS                                  */
/* ===================================================================== */
const ORDS = [['حادي عشر', 11], ['ثاني عشر', 12], ['عاشر', 10], ['تاسع', 9], ['ثامن', 8], ['سابع', 7], ['سادس', 6], ['خامس', 5], ['رابع', 4], ['ثالث', 3], ['ثاني', 2], ['أول', 1], ['اول', 1]];
function stageOfGrade(g) {
  const s = unAr(g); let n = (s.match(/\d+/) || [])[0];
  if (!n) n = (ORDS.find(([w]) => s.includes(w)) || [])[1];
  n = +n;
  if (n) return n <= 5 ? 'primary' : n <= 9 ? 'middle' : 'secondary';
  if (/ابتدائ/.test(s)) return 'primary'; if (/متوسط|اعدادي|إعدادي/.test(s)) return 'middle'; if (/ثانو/.test(s)) return 'secondary';
  return cfg.stage;
}
const examTs = e => e.d.getTime() + (e.tm ?? 8 * 3600) * 1000;
let examSig = '';
function renderExams() {
  const T = now(), todayK = dateKey(T), nowMs = T.getTime();
  const ex = S.data.exams.map(e => ({ d: parseDate(e.date), grade: e.grade || '—', subject: e.subject, time: e.time, tm: parseTime(e.time) })).filter(e => e.d && e.subject);
  if (!ex.length) { $('#examTable').innerHTML = '<div class="empty">لا توجد اختبارات مجدولة حالياً</div>'; $('#examChips').innerHTML = ''; examSig = ''; return; }
  const sorted = [...new Set(ex.map(e => dateKey(e.d)))].sort();
  const minD = parseDate(sorted[0]), maxD = parseDate(sorted[sorted.length - 1]);
  // columns: school days (skip weekends) from window start up to 8 columns
  const cols = []; const startD = new Date(Math.max(minD, new Date(startOfDay(T).getTime() - 864e5)) <= maxD ? Math.max(minD, startOfDay(T).getTime() - 864e5) : minD);
  for (let d = new Date(startD); d <= maxD && cols.length < 8; d.setDate(d.getDate() + 1)) {
    if (!isWeekend(d) || ex.some(e => dateKey(e.d) === dateKey(d))) cols.push(new Date(d));
  }
  const grades = [...new Set(ex.map(e => e.grade))].sort((a, b) => unAr(a).localeCompare(unAr(b), 'ar', { numeric: true }));
  const byG = g => ex.filter(e => e.grade === g);
  const nextOf = list => list.filter(e => examTs(e) + 3 * 3600e3 >= nowMs).sort((a, b) => examTs(a) - examTs(b))[0];

  let h = '<table><thead><tr><th class="rowh">الصف</th>' + cols.map(d => {
    const k = dateKey(d); return `<th class="${k === todayK ? 'tod' : k < todayK ? 'past' : ''}">${DAYS[d.getDay()]}<small>${ar(d.getDate())}/${ar(d.getMonth() + 1)}</small></th>`;
  }).join('') + '</tr></thead><tbody>';
  grades.forEach(g => {
    const mine = byG(g), first = dateKey(mine.reduce((a, b) => a.d < b.d ? a : b).d), last = dateKey(mine.reduce((a, b) => a.d > b.d ? a : b).d);
    const nx = nextOf(mine);
    h += `<tr><th class="rowh">${esc(g)}<em ${nx ? `data-target="${examTs(nx)}"` : ''}>${nx ? '' : 'انتهت الاختبارات'}</em></th>`;
    cols.forEach(d => {
      const k = dateKey(d), e = mine.find(x => dateKey(x.d) === k), cl = k === todayK ? 'tod' : k < todayK ? 'past' : '';
      if (e) h += `<td class="${cl}">${esc(e.subject)}${e.time ? `<small>${esc(e.time)}</small>` : ''}</td>`;
      else if (k > first && k < last) h += `<td class="rest ${cl}" title="يوم راحة">🌴</td>`;
      else h += `<td class="none ${cl}">—</td>`;
    });
    h += '</tr>';
  });
  $('#examTable').innerHTML = h + '</tbody></table>';

  // per-stage countdown chips
  const chips = ['primary', 'middle', 'secondary'].map(sk => {
    const list = ex.filter(e => stageOfGrade(e.grade) === sk); if (!list.length) return '';
    const nx = nextOf(list), isToday = nx && dateKey(nx.d) === todayK;
    return `<div class="stg-chip ${isToday ? 'today' : ''}"><b>${STAGES[sk].label}</b>
      <span>${nx ? (isToday ? 'اختبار اليوم: ' : 'التالي: ') + esc(nx.subject) : 'انتهت الاختبارات'}</span>
      ${nx ? `<strong data-target="${examTs(nx)}"></strong>` : ''}</div>`;
  }).join('');
  $('#examChips').innerHTML = chips;
  examSig = todayK;
  updateCountdowns(T);
}

function updateCountdowns(t) {
  const ms = t.getTime();
  $$('[data-target]').forEach(el => { el.textContent = (el.tagName === 'EM' ? 'التالي بعد ' : '') + fmtCD(+el.dataset.target - ms); });
  if (cfg.displayMode === 'exams' && examSig && examSig !== dateKey(t)) renderExams();
  if (cfg.displayMode === 'staff') updateStaff(t);
}

/* ===================================================================== */
/*                                 STAFF                                 */
/* ===================================================================== */
function renderStaff() {
  const t = now(), today = startOfDay(t);
  const ev = S.data.staff.filter(e => truthy(e.active)).map(e => {
    const d = parseDate(e.date) || today, s = parseTime(e.start), en = parseTime(e.end);
    if (!e.title || s == null) return null;
    return { title: e.title, loc: e.location || e.place || '', d, s: d.getTime() + s * 1000, e: d.getTime() + (en ?? s + 3600) * 1000, sSec: s, eSec: en ?? s + 3600 };
  }).filter(Boolean).filter(e => e.e >= today.getTime()).sort((a, b) => a.s - b.s).slice(0, 6);
  $('#staffToday').textContent = `${DAYS[t.getDay()]} ${ar(t.getDate())} ${MONTHS[t.getMonth()]}`;
  $('#staffList').innerHTML = ev.length ? ev.map(e => `
    <div class="ev up" data-s="${e.s}" data-e="${e.e}">
      <div class="when">${hhmmAr(e.sSec)}<small>${dateKey(e.d) === dateKey(t) ? 'اليوم' : ar(e.d.getDate()) + ' ' + MONTHS[e.d.getMonth()]}</small></div>
      <div><h4>${esc(e.title)}</h4><p>${e.loc ? '📍 ' + esc(e.loc) + ' • ' : ''}${hhmmAr(e.sSec)} – ${hhmmAr(e.eSec)}</p></div>
      <div class="side"><span class="badge"></span><span class="cdv"></span></div>
    </div>`).join('') : '<div class="glass empty">لا توجد فعاليات أو مواعيد مجدولة</div>';
  updateStaff(t);
}
function updateStaff(t) {
  const ms = t.getTime();
  $$('#staffList .ev').forEach(el => {
    const s = +el.dataset.s, e = +el.dataset.e;
    const k = ms >= e ? 'done' : ms >= s ? 'cur' : 'up';
    if (!el.classList.contains(k)) { el.classList.remove('up', 'cur', 'done'); el.classList.add(k); }
    $('.badge', el).textContent = { done: 'منتهي', cur: 'جاري الآن', up: 'قادم' }[k];
    $('.cdv', el).textContent = k === 'cur' ? 'ينتهي بعد ' + fmtCD(e - ms) : k === 'up' ? 'بعد ' + fmtCD(s - ms) : '';
  });
}

/* ===================================================================== */
/*                       AUDIO (Web Audio — no files)                    */
/* ===================================================================== */
const Sound = (() => {
  let ctx = null;
  const ensure = () => {
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    return ctx;
  };
  const tone = (f, t0, dur, { type = 'sine', vol = .35, f2 } = {}) => {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.linearRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + .05);
  };
  const bell = (notes, gap) => {
    if (!cfg.sound || !ensure()) return;
    const t = ctx.currentTime + .05;
    const reps = Math.min(20, Math.max(1, Math.round(+cfg.bellRepeat) || 1)), cycle = notes.length * gap + 1.4;
    for (let r = 0; r < reps; r++) notes.forEach((f, i) => { const s = t + r * cycle + i * gap; tone(f, s, 1.6, { vol: .35 }); tone(f * 2.01, s, 1.1, { vol: .12 }); tone(f * 3, s, .6, { vol: .05 }); });
  };
  return {
    unlock: () => ensure(),
    isLocked: () => !ctx || ctx.state !== 'running',
    startBell: () => bell([783.99, 1046.5, 1318.5], .22),
    endBell: () => bell([1318.5, 1046.5, 783.99, 659.25], .26),
    siren: () => {
      if (!cfg.sound || !ensure()) return;
      const t = ctx.currentTime + .02;
      for (let i = 0; i < 3; i++) { tone(660, t + i * 1.1, .55, { type: 'sawtooth', vol: .22, f2: 990 }); tone(990, t + i * 1.1 + .55, .55, { type: 'sawtooth', vol: .22, f2: 660 }); }
    },
  };
})();
function updateAudioBtn() {
  const b = $('#btnAudio');
  b.textContent = cfg.sound ? '🔔' : '🔕'; b.classList.toggle('muted', !cfg.sound);
  b.classList.toggle('locked', cfg.sound && Sound.isLocked());
  b.title = cfg.sound && Sound.isLocked() ? 'اضغط في أي مكان لتفعيل الصوت' : 'الصوت (M)';
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { Sound.unlock(); setTimeout(updateAudioBtn, 100); }, { passive: true }));

/* ===================================================================== */
/*                          SETTINGS / CONTROLS                          */
/* ===================================================================== */
const F = id => $('#f_' + id);
function openSettings() {
  F('sheet').value = local.sheetId || ''; F('school').value = cfg.schoolName; F('stageName').value = cfg.stageName || '';
  F('logo').value = cfg.logoUrl || ''; F('mode').value = cfg.displayMode; F('theme').value = cfg.theme; F('layout').value = cfg.layout;
  F('weekend').value = cfg.weekend; F('lat').value = cfg.lat; F('lon').value = cfg.lon; F('poll').value = cfg.pollSec; F('bell').value = cfg.bellRepeat;
  markStage(cfg.stage); $('#settings').hidden = false;
}
const markStage = s => $$('.stage-btns button').forEach(b => b.classList.toggle('on', b.dataset.stage === s));
let pendingStage = null;
function saveSettings() {
  local = {
    ...local, sheetId: F('sheet').value.trim(), schoolName: F('school').value.trim() || DEFAULTS.schoolName, stageName: F('stageName').value.trim(),
    logoUrl: F('logo').value.trim(), displayMode: F('mode').value, theme: F('theme').value, themeManual: true, layout: F('layout').value, layoutManual: true,
    weekend: F('weekend').value.trim() || DEFAULTS.weekend, lat: +F('lat').value || DEFAULTS.lat, lon: +F('lon').value || DEFAULTS.lon,
    pollSec: Math.max(15, +F('poll').value || 60), bellRepeat: Math.min(20, Math.max(1, Math.round(+F('bell').value) || 5)), stage: pendingStage || cfg.stage,
  };
  pendingStage = null; store.set('sds.cfg', local); mergeCfg(); $('#settings').hidden = true; refreshData();
}
function setStage(s) {
  local.stage = s; store.set('sds.cfg', local); mergeCfg();
  S.data = S.usingDemo ? demoData() : S.data; afterData();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => { });
}
function toggleSound() { local.sound = !(local.sound ?? true); store.set('sds.cfg', local); mergeCfg(); Sound.unlock(); updateAudioBtn(); if (cfg.sound) Sound.startBell(); }
function setLayout(l) {
  local.layout = l; local.layoutManual = true; store.set('sds.cfg', local); mergeCfg(); applyLayout();
  const t = $('#toast'); t.textContent = 'التصميم: ' + LAYOUTS[cfg.layout]; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 2200);
}
const cycleLayout = () => { const k = Object.keys(LAYOUTS); setLayout(k[(k.indexOf(cfg.layout) + 1) % k.length]); };
function toggleTheme() { local.theme = cfg.theme === 'light' ? 'royal' : 'light'; local.themeManual = true; store.set('sds.cfg', local); mergeCfg(); applyTheme(); }

$('#btnSettings').onclick = openSettings; $('#setClose').onclick = () => { $('#settings').hidden = true; };
$('#btnAudio').onclick = toggleSound; $('#btnTheme').onclick = toggleTheme; $('#btnLayout').onclick = cycleLayout;
$('#setSave').onclick = saveSettings; $('#setBell').onclick = () => { Sound.unlock(); Sound.startBell(); };
$('#setEmerg').onclick = () => { $('#settings').hidden = true; setEmergency('هذا اختبار لنظام التنبيه العاجل'); setTimeout(checkEmergency, 6000); };
$('#setFull').onclick = toggleFullscreen;
$('#setReset').onclick = () => { if (confirm('إعادة جميع الإعدادات للوضع الافتراضي؟')) { local = {}; store.del('sds.cfg'); store.del('sds.remote'); remote = {}; mergeCfg(); $('#settings').hidden = true; refreshData(); } };
$$('.stage-btns button').forEach(b => b.onclick = () => { pendingStage = b.dataset.stage; markStage(pendingStage); setStage(pendingStage); });
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').hidden = true; });
addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Escape') $('#settings').hidden = true; return; }
  const k = e.key.toLowerCase();
  if (k === 's' || k === 'س') $('#settings').hidden ? openSettings() : ($('#settings').hidden = true);
  else if (k === 'f' || k === 'ب') toggleFullscreen();
  else if (k === 'm' || k === 'ئ') toggleSound();
  else if (k === 't' || k === 'ف') toggleTheme();
  else if (k === 'l' || k === 'ل') cycleLayout();
  else if (k === 'escape') $('#settings').hidden = true;
  else if ('123'.includes(k) && k) setStage(['primary', 'middle', 'secondary'][+k - 1]);
});

/* ===================================================================== */
/*                         AMBIENT PARTICLES / BOOT                      */
/* ===================================================================== */
function makeParticles() {
  const box = $('#particles'); let h = '';
  for (let i = 0; i < 28; i++) {
    const s = 3 + Math.random() * 6;
    h += `<span style="left:${(Math.random() * 100).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${(14 + Math.random() * 22).toFixed(1)}s;animation-delay:-${(Math.random() * 30).toFixed(1)}s;--dx:${(Math.random() * 8 - 4).toFixed(1)}rem"></span>`;
  }
  box.innerHTML = h;
}

function tick() {
  const t = now();
  renderClock(t);
  if (cfg.displayMode === 'regular') updateSchedule(t); else { updateSchedule(t); }
  updateCountdowns(t);
  updateCarousel();
}

function boot() {
  mergeCfg(); makeParticles(); applyTheme(); applyLayout(); applyBrand(); applyMode();
  S.data = { cards: [], news: [], exams: [], staff: [], schedule: [] };
  // paint instantly from cache (offline-first), then refresh
  if (cfg.sheetId) {
    const c = n => store.get('sds.cache.' + n, []);
    S.data = { cards: c('cards'), news: c('news'), exams: c('exams'), staff: c('staff'), schedule: c('schedule') };
  } else { S.usingDemo = true; S.data = demoData(); }
  buildPeriods(); renderSchedule(); buildCarousel(); buildTicker(); renderExams(); renderStaff(); checkEmergency(); updateNet();
  showWeather(store.get('sds.weather'));
  tick(); setInterval(tick, 1000);
  setInterval(() => { renderExams(); }, 60000);
  setInterval(updateAudioBtn, 3000); updateAudioBtn();
  refreshData();
  // keep the screen awake where supported
  safe(() => navigator.wakeLock?.request('screen').catch(() => { }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) safe(() => navigator.wakeLock?.request('screen').catch(() => { })); });
}
boot();
})();
