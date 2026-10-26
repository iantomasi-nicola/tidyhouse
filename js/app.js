// Nucleo dell'app: avvio, registro case, identità, tema, router, shell, aggiornamento pagina, accessi.
// Le schermate vivono in js/screens/*.js e ricevono un `ctx` (vedi ARCHITECTURE.md).
import { h, clear, icon, toast, sheet, closeAllSheets, deviceInfo, haptic } from './ui.js';
import { t, tr, setLang, getLang, detectLang } from './i18n.js';
import { compute } from './engine.js';
import { Store, LocalBackend, CloudBackend, engineHouse } from './store.js';
import { Actions, buildHouse, verifyPin, localDate, importBackupOps, exportBackup, normalizeStartSunday } from './actions.js';
import { feature, nameOf, colorOf, randomCode, normCode, fmtCode, uid, DEFAULT_HOME, HOME_WIDGETS, personById } from './extras.js';

const CFG = window.CASA_CONFIG || {};
const cloudAvailable = !!(CFG.firebase && CFG.firebase.apiKey && CFG.firebase.projectId);
const VERSION = '1.0.0';

// ---------------- storage helpers ----------------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const deviceId = (() => { let d = ls.get('cp:device'); if (!d) { d = randomCode(12); ls.set('cp:device', d); } return d; })();
const registry = () => ls.get('cp:houses', []);
const saveRegistry = (r) => ls.set('cp:houses', r);
const regEntry = (id) => registry().find((x) => x.id === id);
const regUpdate = (id, patch) => { const r = registry(); const e = r.find((x) => x.id === id); if (e) Object.assign(e, patch); else r.push({ id, ...patch }); saveRegistry(r); };
const regRemove = (id) => saveRegistry(registry().filter((x) => x.id !== id));

// ---------------- preferenze di dispositivo ----------------
const PREF_DEFAULT = { lang: null, theme: 'auto', accent: null, textSize: 1, reduceMotion: false, haptics: true, compact: false, home: null, useHouseHome: true, notif: {}, deviceName: '' };
let prefs = { ...PREF_DEFAULT, ...ls.get('cp:prefs', {}) };
function applyPrefs() {
  const r = document.documentElement;
  if (prefs.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', prefs.theme);
  r.style.setProperty('--accent', prefs.accent || (S.store && S.store.state.house && S.store.state.house.accent) || '#1a73e8');
  r.style.setProperty('--fs', String(prefs.textSize || 1));
  r.classList.toggle('no-motion', !!prefs.reduceMotion);
  r.classList.toggle('compact', !!prefs.compact);
  const lang = prefs.lang || (S.store && S.store.state.house && S.store.state.house.lang) || detectLang();
  setLang(lang); r.lang = lang;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || null; if (meta) meta.content = getComputedStyle(r).getPropertyValue('--bg');
}

// ---------------- stato applicativo ----------------
const S = { houseId: null, mode: null, store: null, actions: null, version: 0, stage: 'boot', route: { path: '', parts: [] }, calcKey: -1, calc: null, lastRefresh: Date.now(), refreshOpen: false, ready: false, deferred: false, offlineJoin: false };
const appEl = () => document.getElementById('app');
const baseUrl = () => (CFG.publicUrl || (location.origin + location.pathname)).replace(/index\.html$/, '').replace(/#.*$/, '');

// ---------------- backend ----------------
function makeBackend(mode) { return mode === 'cloud' ? new CloudBackend(CFG.firebase) : new LocalBackend(); }
async function attach(id, mode) {
  detach();
  const b = makeBackend(mode);
  let res;
  try { res = await b.open(id); } catch (e) { return { ok: false, reason: navigator.onLine === false ? 'offline' : 'error', error: e }; }
  if (!res.exists) { b.close && b.close(); return { ok: false, reason: 'notfound' }; }
  S.houseId = id; S.mode = mode;
  S.store = new Store(b);
  S.actions = new Actions(S.store, { get meId() { return (regEntry(id) || {}).me || null; }, get isAdmin() { return !!ls.get('cp:admin', {})[id]; }, deviceId, now: () => new Date() });
  S.store.on(() => { S.version++; if (S.stage === 'app' && S.ready && S.actions.rulesRequired() && !S.actions.rulesAccepted()) { evaluate(); return; } scheduleRender(); });
  S.version++;
  return { ok: true };
}
function detach() { if (S.store) { try { S.store.close(); } catch { /* ignore */ } } S.store = null; S.actions = null; S.houseId = null; S.mode = null; S.calc = null; }

// ---------------- ctx per le schermate ----------------
const ctx = {
  t, tr, h, icon, toast, sheet, closeAllSheets, haptic, config: CFG, cloudAvailable, deviceId, VERSION, feature: (k) => feature((S.store && S.store.state.house) || {}, k),
  get store() { return S.store; }, get actions() { return S.actions; }, get state() { return S.store.state; }, get house() { return S.store.state.house || {}; },
  get houseId() { return S.houseId; }, get mode() { return S.mode; }, get cloud() { return S.mode === 'cloud'; }, get status() { return S.store ? S.store.status : 'synced'; },
  get lang() { return getLang(); }, get prefs() { return prefs; }, get route() { return S.route; },
  get me() { return (regEntry(S.houseId) || {}).me || null; },
  get isAdmin() { return !!ls.get('cp:admin', {})[S.houseId]; },
  get meName() { return nameOf(this.house, this.me); },
  today: () => localDate(new Date()), now: () => new Date(),
  name: (id) => nameOf(S.store.state.house, id), color: (id) => colorOf(S.store.state.house, id), person: (id) => personById(S.store.state.house, id),
  /** Piano calcolato dal motore (memoizzato per versione dei dati): { eh, out, today } */
  get calc() {
    const today = localDate(new Date());
    const key = S.version + '|' + today;
    if (S.calcKey !== key) { const eh = engineHouse(S.store.state); S.calc = { eh, out: compute(eh, today, 14), today }; S.calcKey = key; }
    return S.calc;
  },
  get weeks() { return this.calc.eh.weeks; },
  baseUrl, joinLink: () => `${baseUrl()}#/join/${S.houseId}`, code: () => fmtCode(S.houseId),
  nav(path) { location.hash = '#/' + String(path || '').replace(/^#?\/?/, ''); },
  rerender: () => scheduleRender(true),
  savePrefs(patch) { prefs = { ...prefs, ...patch }; ls.set('cp:prefs', prefs); applyPrefs(); scheduleRender(true); },
  /** Layout Home effettivo (personale oppure della casa). */
  homeLayout() {
    const mine = prefs.home && !prefs.useHouseHome ? prefs.home : null;
    const base = mine || (this.house.home) || DEFAULT_HOME;
    const order = [...(base.order || []).filter((w) => HOME_WIDGETS.includes(w)), ...HOME_WIDGETS.filter((w) => !(base.order || []).includes(w))];
    return { order, hidden: (base.hidden || []).filter((w) => HOME_WIDGETS.includes(w)) };
  },
  badges() {
    const out = { home: 0, more: 0 };
    try {
      const me = this.me; const { out: o } = this.calc;
      if (me && o.cur >= 0) {
        for (let i = Math.max(0, o.cur - 1); i <= o.cur; i++) { const r = o.rows[i]; for (let c = 0; c < 3; c++) if (r.assigned[c] === me && !r.res[c].kind && (i < o.cur || r.isCur)) out.home += i < o.cur ? 1 : 0; }
        out.more = Object.values(this.state.requests || {}).filter((q) => q.to === me && q.status === 'pending' && q.kind !== 'nudge').length;
      }
    } catch { /* ignore */ }
    return out;
  },
  // ----- operazioni di casa (usate da impostazioni/onboarding) -----
  async unlockAdmin(pin) { if (await verifyPin(this.house, pin)) { const a = ls.get('cp:admin', {}); a[S.houseId] = true; ls.set('cp:admin', a); scheduleRender(true); return true; } return false; },
  lockAdmin() { const a = ls.get('cp:admin', {}); delete a[S.houseId]; ls.set('cp:admin', a); scheduleRender(true); },
  setMe(personId) { regUpdate(S.houseId, { me: personId }); if (S.actions) S.actions.touchMember({}).catch(() => {}); evaluate(); },
  async rotateCode(opts) {
    const wasAdmin = this.isAdmin, me = this.me, oldId = S.houseId, mode = S.mode;
    const { newId } = await S.actions.rotateCode(opts);
    regRemove(oldId); { const a = ls.get('cp:admin', {}); delete a[oldId]; if (wasAdmin) a[newId] = true; ls.set('cp:admin', a); }
    regUpdate(newId, { name: this.house.name, mode, me, lastUsed: Date.now() });
    ls.set('cp:last', newId);
    const r = await attach(newId, mode); if (r.ok) { await S.actions.touchMember({}); evaluate(); }
    return newId;
  },
  async migrateToCloud() {
    if (!cloudAvailable || S.mode !== 'local') throw new Error('nocloud');
    const bk = exportBackup(S.store.state); const oldId = S.houseId; const me = this.me, wasAdmin = this.isAdmin;
    const newId = randomCode(12); const cb = new CloudBackend(CFG.firebase); await cb.open(newId);
    await cb.write(importBackupOps(JSON.parse(JSON.stringify(bk)), newId));
    cb.close();
    const old = new LocalBackend(); await old.open(oldId); await old.wipe(); old.close();
    regRemove(oldId); const a = ls.get('cp:admin', {}); delete a[oldId]; if (wasAdmin) a[newId] = true; ls.set('cp:admin', a);
    regUpdate(newId, { name: bk.data.house.name, mode: 'cloud', me, lastUsed: Date.now() }); ls.set('cp:last', newId);
    const r = await attach(newId, 'cloud'); if (r.ok) { await S.actions.touchMember({}); evaluate(); }
    return newId;
  },
  /** Sostituisce i dati della casa con un backup (JSON esportato). */
  async importBackup(bk) {
    const ops = importBackupOps(bk, S.houseId); const st = S.store.state;
    const dels = []; for (const c of ['weeks', 'trips', 'needs', 'requests', 'log']) for (const id of Object.keys(st[c] || {})) dels.push({ coll: c, id, del: true });
    await S.store.write([...dels, ...ops]);
  },
  leaveHouse() { const id = S.houseId; regRemove(id); ls.del('cp:last'); detach(); evaluate(); },
  async deleteHouse() { const id = S.houseId; const b = S.store.b; if (b.wipe) await b.wipe(); regRemove(id); ls.del('cp:last'); detach(); evaluate(); },
  async switchHouse(id) { const e = regEntry(id); if (!e) return; const r = await attach(id, e.mode); if (r.ok) { ls.set('cp:last', id); evaluate(); } else toast(t('join.invalid')); },
  houses: () => registry(),
  cloudStatusLabel() { return this.mode === 'cloud' ? t('data.mode.cloud') : t('data.mode.local'); },
};
window.__app = ctx; // utile per debug e test end-to-end

// ---------------- boot / onboarding ----------------
const boot = {
  config: CFG, cloudAvailable, t, h, icon, toast, sheet,
  get houses() { return registry(); },
  get stage() { return S.stage; },
  get house() { return S.store ? S.store.state.house : null; },
  get params() { return S.stageParams || {}; },
  go(stage, params) { S.stage = stage; S.stageParams = params || {}; renderStage(); },
  /** Crea casa. mode 'cloud' | 'local'. Ritorna l'id. */
  async createHouse({ name, startSunday, roommates, adminName, pin, mode, imported }) {
    const useCloud = mode === 'cloud' && cloudAvailable;
    const id = randomCode(12);
    const house = await buildHouse({ id, name, startSunday: normalizeStartSunday(startSunday), roommates: imported ? imported.roommates : roommates, adminPersonId: adminName, pin, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: getLang() });
    if (imported && imported.settings) house.settings = { ...house.settings, ...imported.settings };
    const b = makeBackend(useCloud ? 'cloud' : 'local'); await b.open(id);
    const st = new Store(b);
    const ops = [{ coll: 'house', data: house, set: true }];
    if (imported) for (const [k, w] of Object.entries(imported.weeks || {})) ops.push({ coll: 'weeks', id: k, data: w, set: true });
    await st.write(ops); st.close();
    regUpdate(id, { name: house.name, mode: useCloud ? 'cloud' : 'local', me: house.adminIds[0], lastUsed: Date.now() });
    const a = ls.get('cp:admin', {}); a[id] = true; ls.set('cp:admin', a); ls.set('cp:last', id);
    const r = await attach(id, useCloud ? 'cloud' : 'local');
    if (!r.ok) throw new Error('attach-' + (r.reason || 'error') + (r.error && r.error.message ? ': ' + r.error.message : ''));
    if (r.ok) { await S.actions.touchMember({ ua: navigator.userAgent, device: deviceInfo(), lang: getLang(), firstSeen: new Date().toISOString(), rulesAck: { version: S.actions.rulesVersion(), at: new Date().toISOString() } }); evaluate(); }
    return id;
  },
  /** Entra con codice: non imposta l'identità. */
  async join(rawCode) {
    const code = normCode(rawCode);
    if (code.length !== 12) return { ok: false, reason: 'invalid' };
    if (!cloudAvailable) return { ok: false, reason: 'nocloud' };
    if (navigator.onLine === false) return { ok: false, reason: 'offline' };
    const r = await attach(code, 'cloud');
    if (!r.ok) return r;
    const house = S.store.state.house;
    // se questo dispositivo conosceva una versione precedente della casa (codice cambiato), riprende identità e admin
    const prev = registry().filter((e) => (house.prevIds || []).includes(e.id));
    let me = null, admin = false;
    for (const e of prev) { if (e.me && (house.roommates || []).some((x) => x.id === e.me)) me = e.me; if (ls.get('cp:admin', {})[e.id]) admin = true; regRemove(e.id); }
    const existing = regEntry(code);
    regUpdate(code, { name: house.name, mode: 'cloud', me: (existing && existing.me) || me, lastUsed: Date.now() });
    if (admin) { const a = ls.get('cp:admin', {}); a[code] = true; ls.set('cp:admin', a); }
    ls.set('cp:last', code);
    evaluate();
    return { ok: true, house, autoMe: !!me };
  },
  setMe: (id) => ctx.setMe(id),
  unlockAdmin: (pin) => ctx.unlockAdmin(pin),
  async acceptRules() { await S.actions.acceptRules(); evaluate(); },
  evaluate: () => evaluate(),
  async importExcel(file) { const [{ default: XLSX }, { parseWorkbook }] = await Promise.all([import('../vendor/xlsx.js'), import('./xlsx-import.js')]); return parseWorkbook(XLSX, new Uint8Array(await file.arrayBuffer())); },
};
window.__boot = boot;

async function loadOnboarding() { return import('./screens/onboarding.js'); }
async function renderStage() {
  const root = appEl(); clear(root);
  document.getElementById('boot').classList.add('gone');
  try {
    const m = await loadOnboarding();
    const node = await m.renderGate(S.stage, boot, S.stageParams || {});
    clear(root); root.append(node);
  } catch (e) { root.append(h('div', { class: 'gate' }, h('div', { class: 'panel' }, h('h1', null, t('error')), h('p', { class: 'muted' }, String(e && e.message || e))))); console.error(e); }
}

/** Decide cosa mostrare: landing / chi sei / regole / app. */
function evaluate() {
  if (!S.store) { S.stage = S.stageHint || 'landing'; S.stageHint = null; applyPrefs(); return renderStage(); }
  const house = S.store.state.house || {};
  applyPrefs();
  const me = ctx.me;
  if (!me || !(house.roommates || []).some((r) => r.id === me)) { S.stage = 'who'; return renderStage(); }
  if (S.actions.rulesRequired() && !S.actions.rulesAccepted() && S.store.state.members !== undefined && memberLoaded()) { S.stage = 'rules'; return renderStage(); }
  S.stage = 'app'; S.ready = true;
  registerDevice();
  document.getElementById('boot').classList.add('gone');
  renderApp(true);
}
const memberLoaded = () => true;

// ---------------- dispositivo / accessi / push ----------------
let lastTouch = 0; const lastView = {};
function registerDevice() {
  if (!S.actions) return;
  const now = Date.now();
  if (now - lastTouch > 90000) {
    lastTouch = now; const info = deviceInfo();
    const m = (S.store.state.members || {})[deviceId] || {};
    S.actions.touchMember({ ua: navigator.userAgent, device: info, lang: getLang(), name: prefs.deviceName || m.name || info.label, firstSeen: m.firstSeen || new Date().toISOString(), version: VERSION, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true }).catch(() => {});
    import('./push.js').then((p) => p.resync && p.resync(ctx)).catch(() => {});
  }
}
function recordView(screen) {
  if (!S.actions || !S.ready) return;
  if (screen !== 'home' && screen !== 'calendar') return;
  const now = Date.now(); if (now - (lastView[screen] || 0) < 5 * 60000) return; lastView[screen] = now;
  S.actions.recordView(screen).catch(() => {});
}

// ---------------- router ----------------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: parts.join('/'), parts, root: parts[0] || '' };
}
const SCREENS = { '': 'home', calendar: 'calendar', trips: 'trips', stats: 'stats', more: 'more', settings: 'settings', needs: 'more', rules: 'more', lastout: 'more', tasks: 'more', requests: 'more', activity: 'more', guide: 'more' };
const TABS = [['', 'home', 'nav.home'], ['calendar', 'calendar', 'nav.calendar'], ['trips', 'plane', 'nav.trips'], ['stats', 'trophy', 'nav.stats'], ['more', 'more', 'nav.more']];
const tabOf = (root) => (['needs', 'rules', 'lastout', 'tasks', 'requests', 'activity', 'guide', 'settings'].includes(root) ? 'more' : root);

let rafId = 0, shell = null, mainEl = null, navEl = null, topEl = null, renderToken = 0, lastPath = null;
function scheduleRender(force) {
  if (!S.ready || S.stage !== 'app') return;
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; renderApp(!!force); });
}
function typing() { const a = document.activeElement; return a && mainEl && mainEl.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'range'; }

async function renderApp(force) {
  if (S.stage !== 'app') return;
  const route = parseHash(); S.route = route;
  if (route.root === 'join') { // link d'invito aperto con casa già caricata
    const code = normCode(route.parts[1] || '');
    if (code && code !== S.houseId) { S.stageHint = 'landing'; detach(); history.replaceState(null, '', '#/join/' + code); return startFromHash(); }
    location.hash = '#/'; return;
  }
  if (!shell || !shell.isConnected) { buildShell(); force = true; }
  if (!force && typing()) { S.deferred = true; return; }
  S.deferred = false;
  const token = ++renderToken;
  const root = route.root; const name = SCREENS[root] ?? 'home';
  const tab = tabOf(root);
  updateNav(tab); updateTop();
  const samePage = lastPath === route.path; const y = samePage ? window.scrollY : 0; lastPath = route.path;
  let node;
  try {
    const mod = await import(`./screens/${name}.js`);
    const params = { sub: ['needs', 'rules', 'lastout', 'tasks', 'requests', 'activity', 'guide'].includes(root) ? root : route.parts[1] || '', parts: route.parts };
    node = await mod.render(ctx, params);
  } catch (e) {
    console.error(e);
    node = h('div', { class: 'card stack' }, h('h2', null, t('error')), h('p', { class: 'muted small' }, String(e && e.message || e)), h('a', { class: 'btn soft', href: '#/' }, t('nav.home')));
  }
  if (token !== renderToken) return;
  clear(mainEl); mainEl.append(node);
  if (samePage) window.scrollTo(0, y); else window.scrollTo(0, 0);
  recordView(tab === '' ? 'home' : tab);
  document.title = `${ctx.house.name || 'Tidy House'} · Tidy House`;
}

function buildShell() {
  const root = appEl(); clear(root);
  topEl = h('div', { class: 'top' });
  mainEl = h('main', { class: 'main', id: 'main' }, topEl);
  navEl = h('nav', { class: 'nav', 'aria-label': 'Navigazione' });
  shell = h('div', { class: 'shell' }, navEl, h('div', { class: 'content' }, mainEl));
  root.append(shell);
  // top va ricostruito in updateTop, mainEl viene svuotato a ogni render: sposto top fuori da mainEl
  mainEl.removeChild(topEl); shell.querySelector('.content').insertBefore(topEl, mainEl);
  topEl.className = 'top main'; topEl.style.paddingBottom = '0'; topEl.style.minHeight = '0';
  topEl.style.marginBottom = '-8px';
}
function updateNav(tab) {
  const b = ctx.badges();
  const items = TABS.filter(([k]) => (k !== 'trips' || ctx.feature('trips')) && (k !== 'stats' || ctx.feature('stats') || ctx.feature('ranking')));
  navEl.style.gridTemplateColumns = window.innerWidth < 900 ? `repeat(${items.length}, 1fr)` : '';
  clear(navEl);
  for (const [k, ic, label] of items) {
    const badge = k === '' ? b.home : k === 'more' ? b.more : 0;
    navEl.append(h('a', { href: '#/' + k, 'aria-current': tab === k ? 'page' : null, onclick: () => haptic(prefs.haptics, 6) }, icon(ic), h('span', null, t(label)), badge ? h('span', { class: 'badge' }, badge) : null));
  }
}
function updateTop() {
  clear(topEl);
  const st = ctx.status;
  topEl.append(
    h('div', { class: 'who' }, h('div', { class: 'house' }, ctx.house.name || 'Tidy House'), h('span', { class: 'sync ' + (ctx.cloud ? st : 'local'), title: ctx.cloudStatusLabel() }, h('i'), ctx.cloud ? (st === 'syncing' ? t('misc.syncing') : st === 'offline' ? t('misc.offline').split(':')[0] : '') : t('misc.localOnly'))),
    h('div', { class: 'actions' },
      ctx.isAdmin ? h('span', { class: 'chip acc' }, icon('shield'), t('misc.admin')) : null,
      h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': t('more.settings') }, icon('settings')),
    ));
}

// ---------------- avvio ----------------
async function startFromHash() {
  const r = parseHash();
  if (r.root === 'join') {
    const code = normCode(r.parts[1] || '');
    S.stage = 'join'; S.stageParams = { code }; return renderStage();
  }
  const last = ls.get('cp:last'); const e = last && regEntry(last);
  if (e) {
    const res = await attach(e.id, e.mode);
    if (res.ok) { evaluate(); return; }
    if (res.reason === 'notfound') { S.stage = 'notfound'; S.stageParams = { id: e.id, name: e.name }; return renderStage(); }
    if (res.reason === 'offline' || res.reason === 'error') { S.stage = 'offline'; S.stageParams = { id: e.id, name: e.name }; return renderStage(); }
  }
  S.stage = 'landing'; renderStage();
}

function setupRefreshPrompt() {
  const check = () => {
    if (!S.ready || S.stage !== 'app' || S.refreshOpen || document.visibilityState !== 'visible') return;
    if (!ctx.feature('refresh')) return;
    const mins = Math.max(1, Number(ctx.house.refreshMin) || 5);
    if (Date.now() - S.lastRefresh < mins * 60000) return;
    S.refreshOpen = true;
    const s = sheet({ title: t('refresh.title'), onClose: () => { S.refreshOpen = false; S.lastRefresh = Date.now(); }, body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('refresh.text')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn soft', onclick: () => s.close() }, t('refresh.later')), h('button', { class: 'btn', onclick: () => location.reload() }, icon('refresh'), t('refresh.now')))) });
  };
  setInterval(check, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { check(); registerDevice(); if (S.deferred) scheduleRender(true); } });
  window.addEventListener('focus', () => { if (S.deferred && !typing()) scheduleRender(true); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (S.deferred && !typing()) scheduleRender(true); }, 60); });
}

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const offer = (w) => { if (!w) return; toast(t('update.available'), 8000); w.postMessage({ type: 'SKIP_WAITING' }); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; if (S.ready) setTimeout(() => location.reload(), 600); });
  } catch (e) { console.warn('SW', e); }
}

window.addEventListener('hashchange', () => { if (S.stage === 'app') { closeAllSheets(); renderApp(true); } else if (!S.store || S.stage === 'landing') startFromHash(); });
window.addEventListener('online', () => scheduleRender(true));
window.addEventListener('offline', () => scheduleRender(true));
window.addEventListener('resize', () => { if (S.ready && navEl) updateNav(tabOf(S.route.root)); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__bip = e; });
applyPrefs();
registerSW();
setupRefreshPrompt();
startFromHash();
