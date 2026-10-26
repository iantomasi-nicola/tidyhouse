// Nucleo dell'app: avvio, registro case, identità, tema, router, shell, aggiornamento pagina, accessi.
// Le schermate vivono in js/screens/*.js e ricevono un `ctx` (vedi ARCHITECTURE.md).
import { h, clear, icon, toast, sheet, closeAllSheets, hasOpenSheets, cssReady, deviceInfo, haptic } from './ui.js';
import { t, tr, setLang, getLang, detectLang, registerStrings } from './i18n.js';
import { it as coreIt, en as coreEn } from './strings/core.js';
import { compute } from './engine.js';
import { Store, LocalBackend, CloudBackend, engineHouse } from './store.js';
import { Actions, buildHouse, verifyPin, localDate, importBackupOps, exportBackup, normalizeStartSunday } from './actions.js';
import { feature, nameOf, colorOf, randomCode, normCode, fmtCode, uid, DEFAULT_HOME, HOME_WIDGETS, personById } from './extras.js';

registerStrings(coreIt, coreEn);
const CFG = window.CASA_CONFIG || {};
const cloudAvailable = !!(CFG.firebase && CFG.firebase.apiKey && CFG.firebase.projectId);
const VERSION = '1.5.0';
let pushMod = null;
// all'avvio controlla il browser (permesso + sottoscrizione) PRIMA di decidere se chiedere le notifiche: evita il falso "non attive"
const pushReady = import('./push.js').then(async (m) => { await Promise.race([m.probe(), new Promise((r) => setTimeout(r, 1500))]); pushMod = m; }).catch(() => {});
pushReady.then(() => { if (S.stage === 'push' || (S.stage === 'app' && needPushGate())) evaluate(); else scheduleRender(true); });
const isMobile = () => /Android.*Mobile|iPhone|iPod/.test(navigator.userAgent) || /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) || (/Android/.test(navigator.userAgent));

// ---------------- storage helpers ----------------
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const deviceId = (() => { let d = ls.get('cp:device'); if (!d) { d = randomCode(12); ls.set('cp:device', d); } return d; })();
/** Un dispositivo è admin se ha sbloccato con l'epoca corrente (cambiando admin l'epoca cresce e i vecchi dispositivi si bloccano). */
const adminOn = (id, house) => { const v = ls.get('cp:admin', {})[id]; if (!v) return false; return (v === true ? 1 : v) === ((house && house.adminEpoch) || 1); };
const markAdmin = (id, house) => { const a = ls.get('cp:admin', {}); a[id] = (house && house.adminEpoch) || 1; ls.set('cp:admin', a); };
const saveRulesAck = (v) => { const r = ls.get('cp:rules', {}); r[S.houseId] = v || S.actions.rulesVersion(); ls.set('cp:rules', r); };
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
  S.actions = new Actions(S.store, { get meId() { return (regEntry(id) || {}).me || null; }, get isAdmin() { return adminOn(id, S.store && S.store.state.house); }, deviceId, now: () => new Date(), localRulesAck: () => (ls.get('cp:rules', {})[id] || null), localRulesAckSave: (v) => saveRulesAck(v) });
  S.store.on(() => { S.version++; if (S.switching) return; if (S.stage === 'app' && S.ready && S.actions.rulesRequired() && !S.actions.rulesAccepted()) { evaluate(); return; } scheduleRender(); });
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
  get isAdmin() { return adminOn(S.houseId, S.store && S.store.state.house); },
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
  get renderCount() { return renders; },
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
        // stessa regola di awaitingMe() in more.js: scambi/offerte indirizzati a me; sostituzioni (cover) a me o aperte a tutti tranne il richiedente
        out.more = Object.values(this.state.requests || {}).filter((q) => {
          if (q.status !== 'pending' || ['notice', 'nudge'].includes(q.kind)) return false;
          if (q.kind === 'cover') return q.from !== me && (!q.to || q.to === me);
          return q.to === me;
        }).length;
      }
    } catch { /* ignore */ }
    return out;
  },
  // ----- operazioni di casa (usate da impostazioni/onboarding) -----
  /** Nuova versione dell'app scaricata e in attesa. */
  get updateReady() { return !!S.updateReady; },
  markUpdateReady() { if (!S.updateReady) { S.updateReady = true; scheduleRender(true); } },
  /** Applica la nuova versione (attiva il service worker in attesa e ricarica, senza interrompere chi sta scrivendo). */
  applyUpdate() { if (S.waitingSW) { try { S.waitingSW.postMessage({ type: 'SKIP_WAITING' }); } catch { location.reload(); } } else location.reload(); },
  async unlockAdmin(pin) { if (await verifyPin(this.house, pin)) { markAdmin(S.houseId, this.house); scheduleRender(true); return true; } return false; },
  lockAdmin() { const a = ls.get('cp:admin', {}); delete a[S.houseId]; ls.set('cp:admin', a); scheduleRender(true); },
  setMe(personId) { regUpdate(S.houseId, { me: personId }); if (S.actions) S.actions.touchMember({}).catch(() => {}); evaluate(); },
  async rotateCode(opts) {
    const wasAdmin = this.isAdmin, me = this.me, oldId = S.houseId, mode = S.mode, epoch = this.house.adminEpoch || 1;
    S.switching = true;   // la cancellazione della vecchia casa svuota lo store: non deve far scattare «chi sei»/«regole»
    let newId;
    try { ({ newId } = await S.actions.rotateCode(opts)); } catch (e) { S.switching = false; throw e; }
    { const r = ls.get('cp:rules', {}); if (r[oldId]) { r[newId] = r[oldId]; ls.set('cp:rules', r); } }
    regRemove(oldId); { const a = ls.get('cp:admin', {}); delete a[oldId]; if (wasAdmin) a[newId] = epoch; ls.set('cp:admin', a); }
    regUpdate(newId, { name: this.house.name, mode, me, lastUsed: Date.now() });
    ls.set('cp:last', newId);
    S.switching = false;
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
    regRemove(oldId); const a = ls.get('cp:admin', {}); delete a[oldId]; if (wasAdmin) a[newId] = (bk.data.house.adminEpoch || 1); ls.set('cp:admin', a);
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
    if (r.ok) { await S.actions.touchMember({ ua: navigator.userAgent, device: deviceInfo(), lang: getLang(), firstSeen: new Date().toISOString(), rulesAck: { version: S.actions.rulesVersion(), at: new Date().toISOString() } }); saveRulesAck(); evaluate(); }
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
    if (admin) markAdmin(code, house);
    ls.set('cp:last', code);
    evaluate();
    return { ok: true, house, autoMe: !!me };
  },
  setMe: (id) => ctx.setMe(id),
  unlockAdmin: (pin) => ctx.unlockAdmin(pin),
  async acceptRules() { await S.actions.acceptRules(); saveRulesAck(); evaluate(); },
  evaluate: () => evaluate(),
  async importExcel(file) { const [{ default: XLSX }, { parseWorkbook }] = await Promise.all([import('../vendor/xlsx.js'), import('./xlsx-import.js')]); return parseWorkbook(XLSX, new Uint8Array(await file.arrayBuffer())); },
};
window.__boot = boot;

async function loadOnboarding() { return import('./screens/onboarding.js'); }
let stageToken = 0;
const hideBoot = () => { const b = document.getElementById('boot'); if (b && !b.classList.contains('gone')) { b.classList.add('gone'); setTimeout(() => { b.hidden = true; }, 400); } };
/** Mostra una schermata di accesso (landing/crea/entra/...). Le chiamate ravvicinate si annullano a vicenda: vince l'ultima. */
async function renderStage() {
  const root = appEl(); const tk = ++stageToken;
  let node;
  try {
    const m = await loadOnboarding();
    node = S.stage === 'push' ? renderPushGate() : await m.renderGate(S.stage, boot, S.stageParams || {});
    await cssReady();
    if (tk !== stageToken) return;
    if (['landing', 'join', 'who', 'rules'].includes(S.stage)) { const panel = node.querySelector ? (node.querySelector('.panel') || node) : node; const b = installBanner(); if (b) panel.append(b); }
  } catch (e) {
    if (tk !== stageToken) return;
    node = h('div', { class: 'gate' }, h('div', { class: 'panel' }, h('h1', null, t('error')), h('p', { class: 'muted' }, String(e && e.message || e)), h('button', { class: 'btn soft', type: 'button', onclick: () => location.reload() }, icon('refresh'), t('refresh.now')))); console.error(e);
  }
  root.replaceChildren(node);
  shell = null; window.scrollTo(0, 0); hideBoot();
}

/** Decide cosa mostrare: landing / chi sei / regole / app. */
function evaluate() {
  if (!S.store) { S.stage = S.stageHint || 'landing'; S.stageHint = null; applyPrefs(); return renderStage(); }
  const house = S.store.state.house || {};
  applyPrefs();
  const me = ctx.me;
  if (!me || !(house.roommates || []).some((r) => r.id === me)) { S.stage = 'who'; return renderStage(); }
  if (S.actions.rulesRequired() && !S.actions.rulesAccepted() && S.store.state.members !== undefined && memberLoaded()) { S.stage = 'rules'; return renderStage(); }
  if (!pushMod && ctx.cloud && isMobile()) { pushReady.then(() => evaluate()); return; }   // aspetta il controllo del browser (max ~1,5 s) prima di decidere sulle notifiche
  if (needPushGate()) { S.stage = 'push'; return renderStage(); }
  const first = !S.ready;
  S.stage = 'app'; S.ready = true; stageToken++;   // una schermata di accesso ancora in preparazione non deve coprire l'app
  if (first) { try { recordView('open'); } catch { /* ignore */ } }
  registerDevice();
  renderApp(true);
}
const memberLoaded = () => true;
/** Su mobile le notifiche sono obbligatorie (se il cloud e le chiavi push sono configurati e l'admin non l'ha disattivato). */
function pushState() { try { const st = pushMod && pushMod.status(ctx); return (st && st.state) || null; } catch { return null; } }
function needPushGate() {
  if (!S.store || !ctx.cloud || !isMobile() || S.pushSkip) return false;
  if (ctx.house.requirePush === false) return false;
  return ['off', 'ios-install', 'denied'].includes(pushState());
}
function renderPushGate() {
  const state = pushState(); const msg = h('p', { class: 'small', style: { color: 'var(--bad)' }, 'aria-live': 'polite' });
  const kids = [h('div', { class: 'logo' }, icon('bell')), h('h1', null, t('onb.push.title')), h('p', { class: 'lead' }, t('onb.push.why'))];
  if (state === 'ios-install') { kids.push(h('div', { class: 'note warn' }, icon('alert'), t('onb.push.ios'))); const b = installBanner(); if (b) kids.push(b); }
  if (state === 'denied') kids.push(h('div', { class: 'note warn' }, icon('alert'), t('onb.push.denied')));
  if (state === 'off') kids.push(h('button', { class: 'btn lg block', 'data-testid': 'push-enable', onclick: async () => { let r = null; try { r = await pushMod.enable(ctx); } catch { /* ignore */ } if (r && r.ok) evaluate(); else { msg.textContent = t('onb.push.fail'); } } }, icon('bell'), t('onb.push.enable')));
  else kids.push(h('button', { class: 'btn lg block soft', 'data-testid': 'push-recheck', onclick: () => evaluate() }, icon('refresh'), t('onb.push.recheck')));
  kids.push(msg);
  if (ctx.isAdmin) kids.push(h('button', { class: 'btn ghost block', 'data-testid': 'push-skip', onclick: () => { S.pushSkip = true; evaluate(); } }, t('onb.push.skip')));
  return h('div', { class: 'gate' }, h('div', { class: 'panel' }, ...kids));
}

// ---------------- invito all'installazione ----------------
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installBanner() {
  if (isStandalone()) return null;
  const ua = navigator.userAgent; const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); const android = /Android/.test(ua);
  const steps = ios ? ['guide.ios1', 'guide.ios2', 'guide.ios3', 'guide.ios4'] : android ? ['guide.android1', 'guide.android2', 'guide.android3'] : ['guide.desktop1', 'guide.desktop2'];
  const notSafari = ios && /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//.test(ua);
  const card = h('div', { class: 'card tonal stack tight', 'data-testid': 'install-banner' },
    notSafari ? h('div', { class: 'note warn', 'data-testid': 'install-safari' }, icon('alert'), t('onb.install.safari')) : null,
    h('div', { class: 'row' }, icon('download'), h('strong', null, t('onb.install.title'))),
    h('p', { class: 'small muted' }, t('onb.install.why')),
    h('ol', { class: 'small', style: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px' } }, steps.map((k) => h('li', null, t(k)))),
    window.__bip ? h('button', { class: 'btn tonal sm', onclick: async () => { try { window.__bip.prompt(); await window.__bip.userChoice; } catch { /* ignore */ } } }, icon('download'), t('guide.install')) : null);
  return card;
}

// ---------------- dispositivo / accessi / push ----------------
let lastTouch = 0; const lastView = {};
function registerDevice() {
  if (!S.actions) return;
  const now = Date.now();
  if (now - lastTouch > 90000) {
    lastTouch = now; const info = deviceInfo();
    const m = (S.store.state.members || {})[deviceId] || {};
    S.actions.touchMember({ ua: navigator.userAgent, device: info, lang: getLang(), name: prefs.deviceName || m.name || info.label, firstSeen: m.firstSeen || new Date().toISOString(), version: VERSION, standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true }).catch(() => {});
    import('./push.js').then(async (p) => { if (p.resync) await p.resync(ctx); const st = p.status(ctx); const stateNow = (st && st.state) || st; const m2 = (S.store.state.members || {})[deviceId]; if (stateNow !== 'on' && m2 && m2.push) S.actions.touchMember({ push: null }).catch(() => {}); }).catch(() => {});
  }
}
function recordView(screen) {
  if (!S.actions || !S.ready) return;
  const now = Date.now(); if (now - (lastView[screen] || 0) < 45000) return; lastView[screen] = now;   // ogni ingresso/schermata (max 1 ogni 45 s)
  S.actions.recordView(screen).catch(() => {});
}

// ---------------- router ----------------
const safeDecode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean).map(safeDecode);
  return { path: parts.join('/'), parts, root: parts[0] || '' };
}
const SCREENS = { '': 'home', calendar: 'calendar', trips: 'trips', stats: 'stats', more: 'more', settings: 'settings', needs: 'more', rules: 'more', lastout: 'more', tasks: 'more', requests: 'more', activity: 'more', guide: 'more' };
const TABS = [['', 'home', 'nav.home'], ['calendar', 'calendar', 'nav.calendar'], ['trips', 'plane', 'nav.trips'], ['stats', 'trophy', 'nav.stats'], ['more', 'more', 'nav.more']];
const SUBS = ['needs', 'rules', 'lastout', 'tasks', 'requests', 'activity', 'guide'];
const tabOf = (root) => (SUBS.includes(root) || root === 'settings' ? 'more' : Object.prototype.hasOwnProperty.call(SCREENS, root) ? root : '');

// Rendering: un solo render alla volta, richieste ravvicinate fuse in una (rAF), aggiornamenti remoti al massimo ogni MIN_GAP ms.
const MIN_GAP = 120;
let rafId = 0, timerId = 0, pendingForce = false, lastRenderAt = 0, renders = 0;
let shell = null, mainEl = null, navEl = null, topEl = null, renderToken = 0, lastPath = null, navSig = '', topSig = '';
const scrollMemo = new Map(); let popNav = false;
function scheduleRender(force) {
  if (!S.ready || S.stage !== 'app') return;
  if (force) pendingForce = true;
  if (rafId) return;
  if (timerId) { if (force) { clearTimeout(timerId); timerId = 0; } else return; }
  const wait = pendingForce ? 0 : Math.max(0, MIN_GAP - (performance.now() - lastRenderAt));
  if (wait > 4) { timerId = setTimeout(() => { timerId = 0; queueRender(); }, wait); } else queueRender();
}
function queueRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; const f = pendingForce; pendingForce = false; lastRenderAt = performance.now(); renderApp(f); });
}
// Si sta scrivendo/scegliendo in un campo della pagina? (i campi dentro gli sheet vivono fuori dal rerender)
let compFlag = false, compAt = 0;   // composizione IME in corso (si azzera da sola se la tastiera non chiude mai la composizione)
const NOT_TEXT = /^(checkbox|radio|range|button|submit|reset|image)$/;
function activeField() { const a = document.activeElement; return a && mainEl && mainEl.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !NOT_TEXT.test(a.type) ? a : null; }
const composing = () => compFlag && performance.now() - compAt < 4000;
const typing = () => composing() || !!activeField();
// tipi il cui valore "grezzo" (spazi finali, data a metà, picker aperto) non si può ricopiare in un nuovo nodo: non si ricreano mai mentre hanno il focus
const COMPLEX = /^(url|email|number|date|time|datetime-local|month|week)$/;
/** Rimandare il render? Mai se cambia pagina; sempre durante una composizione IME; per i dati remoti con un campo attivo; per i render forzati solo con campi "complessi". */
function mustDefer(force, routeChanged) {
  if (routeChanged) return false;
  if (composing()) return true;
  const a = activeField(); if (!a) return false;
  return !force || COMPLEX.test(a.type) || a.tagName === 'SELECT';
}
/** Un campo di testo qualsiasi (anche dentro uno sheet) ha il focus: non interrompere con popup o ricariche. */
const editingAnywhere = () => { const a = document.activeElement; return composing() || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !NOT_TEXT.test(a.type)); };
document.addEventListener('compositionstart', () => { compFlag = true; compAt = performance.now(); }, true);
document.addEventListener('compositionupdate', () => { compAt = performance.now(); }, true);
document.addEventListener('compositionend', () => { compFlag = false; setTimeout(flushDeferred, 80); }, true);
document.addEventListener('focusout', () => { compFlag = false; }, true);
document.addEventListener('input', (e) => { if (e.isTrusted && e.target) e.target.__typed = true; }, true);
function flushDeferred() { if (S.deferred && !typing()) scheduleRender(true); }

// ---- doppio tocco: il secondo click ravvicinato sullo stesso punto di un pulsante d'azione viene ignorato (niente azioni/sheet duplicati) ----
const ONCE = 'button.btn, a.btn, button.checkcircle, button.chore, button.li, a.li, button.week, button.who, button.hm-act';
let lastClick = { t: -1e9, x: -999, y: -999 };
document.addEventListener('click', (e) => {
  const el = e.isTrusted && e.target && e.target.closest ? e.target.closest(ONCE) : null;
  if (!el || el.closest('.num, .seg')) return;
  const now = performance.now();
  if (now - lastClick.t < 350 && Math.abs(e.clientX - lastClick.x) < 24 && Math.abs(e.clientY - lastClick.y) < 24) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  lastClick = { t: now, x: e.clientX, y: e.clientY };
}, true);

// ---- il focus sopravvive al rerender forzato (stesso campo, valore digitato, posizione del cursore) ----
const FIELD = 'input,textarea,select,button,a[href],[tabindex]';
const sigOf = (el) => [el.tagName, el.type || '', el.id, el.getAttribute('data-testid') || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '', el.getAttribute('name') || '', el.getAttribute('href') || '', /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? '' : (el.textContent || '').trim().slice(0, 40)].join('|');
const isTextField = (el) => /^(INPUT|TEXTAREA)$/.test(el.tagName) && !NOT_TEXT.test(el.type);
const kindOf = (el) => el.tagName + '|' + (el.type || '');
function captureFocus() {
  const a = document.activeElement;
  if (!a || a === document.body || !mainEl || !mainEl.contains(a)) return null;
  const sig = sigOf(a); const all = [...mainEl.querySelectorAll(FIELD)];
  const same = all.filter((x) => sigOf(x) === sig), kind = all.filter((x) => kindOf(x) === kindOf(a));
  let ss = null, se = null, sd = null; try { if (isTextField(a)) { ss = a.selectionStart; se = a.selectionEnd; sd = a.selectionDirection; } } catch { /* tipi senza selezione */ }
  return { sig, idx: Math.max(0, same.indexOf(a)), kind: kindOf(a), ord: kind.indexOf(a), nKind: kind.length, id: a.id, tid: a.getAttribute('data-testid'), value: a.value, dirty: !!a.__typed, ss, se, sd, st: a.scrollTop };
}
/** Ritrova lo stesso campo nel nuovo nodo: per id, data-testid, firma, e (cambio lingua) per posizione tra campi dello stesso tipo. */
function findAgain(snap) {
  const all = [...mainEl.querySelectorAll(FIELD)];
  if (snap.id) { const e = all.find((x) => x.id === snap.id); if (e) return e; }
  if (snap.tid) { const e = all.find((x) => x.getAttribute('data-testid') === snap.tid); if (e) return e; }
  const same = all.filter((x) => sigOf(x) === snap.sig); if (same.length) return same[Math.min(snap.idx, same.length - 1)];
  const kind = all.filter((x) => kindOf(x) === snap.kind); return kind.length === snap.nKind ? kind[snap.ord] : null;
}
function restoreFocus(snap) {
  if (!snap) return;
  const el = findAgain(snap);
  if (!el) return;
  if (snap.dirty && 'value' in el && el.type !== 'file' && el.value !== snap.value) el.value = snap.value;
  if (snap.dirty) el.__typed = true;
  try { el.focus({ preventScroll: true }); } catch { return; }
  try { if (snap.ss !== null && el.setSelectionRange) { el.setSelectionRange(snap.ss, snap.se, snap.sd || 'none'); el.scrollTop = snap.st; } } catch { /* ignore */ }
}

async function renderApp(force) {
  if (S.stage !== 'app') return;
  const route = parseHash(); S.route = route;
  if (route.root === 'join') { // link d'invito aperto con casa già caricata
    const code = normCode(route.parts[1] || '');
    if (code && code !== normCode(S.houseId || '')) { S.stageHint = 'landing'; detach(); history.replaceState(null, '', '#/join/' + code); return startFromHash(); }
    history.replaceState(null, '', '#/'); return renderApp(true);
  }
  if (!shell || !shell.isConnected) { buildShell(); force = true; }
  if (mustDefer(force, lastPath !== route.path)) { S.deferred = true; return; }
  S.deferred = false;
  const token = ++renderToken;
  const root = route.root; const name = SCREENS[root] ?? 'home';
  const tab = tabOf(root);
  const samePage = lastPath === route.path;
  if (lastPath !== null && !samePage) scrollMemo.set(lastPath, window.scrollY);
  let node;
  try {
    const mod = await import(`./screens/${name}.js`);
    const params = { sub: SUBS.includes(root) ? root : route.parts[1] || '', parts: route.parts };
    node = await mod.render(ctx, params);
  } catch (e) {
    console.error(e);
    node = h('div', { class: 'card stack' }, h('h2', null, t('error')), h('p', { class: 'muted small' }, String(e && e.message || e)), h('a', { class: 'btn soft', href: '#/' }, t('nav.home')));
  }
  if (token !== renderToken) return;
  await cssReady();   // il foglio di stile della schermata è già caricato quando compare il contenuto
  let reminder = null; try { reminder = await notifReminder(); } catch { /* ignore */ }
  if (token !== renderToken || S.stage !== 'app') return;
  // mentre la schermata si preparava l'utente può aver iniziato a scrivere: non togliergli il campo di sotto
  if (mustDefer(force, lastPath !== route.path)) { S.deferred = true; return; }
  if (!shell || !shell.isConnected) return;
  const snap = samePage ? captureFocus() : null;
  const y = samePage ? window.scrollY : (popNav && scrollMemo.has(route.path) ? scrollMemo.get(route.path) : 0);
  updateNav(tab); updateTop();
  shell.classList.toggle('no-enter', samePage);   // le animazioni d'ingresso solo cambiando pagina, non a ogni aggiornamento dati
  // una pagina persistente (nodo già montato in mainEl) non si rimonta: niente perdita di focus/selezione/scroll interno
  if (node.parentNode === mainEl && !reminder && mainEl.children.length === 1) { /* già al suo posto */ }
  else if (node.parentNode === mainEl) { for (const c of [...mainEl.children]) if (c !== node) c.remove(); if (reminder) mainEl.prepend(reminder); }
  else mainEl.replaceChildren(...(reminder ? [reminder, node] : [node]));
  lastPath = route.path; popNav = false; renders++;
  window.scrollTo(0, y);
  restoreFocus(snap);
  hideBoot();
  recordView(tab === '' ? 'home' : tab);
  const title = `${ctx.house.name || 'Tidy House'} · Tidy House`; if (document.title !== title) document.title = title;
}

/** Promemoria (chiudibile per la sessione) se le notifiche non sono ancora attive su questo dispositivo. */
async function notifReminder() {
  if (S.notifDismissed || !ctx.cloud || S.route.root === 'settings') return null;
  const pm = await import('./push.js'); const st = pm.status(ctx); const state = (st && st.state) || st;
  const close = h('button', { class: 'icon-btn', 'aria-label': t('close'), onclick: () => { S.notifDismissed = true; scheduleRender(true); } }, icon('x'));
  if (state === 'off') {
    return h('div', { class: 'card tonal row', style: { marginBottom: '16px' }, 'data-testid': 'notif-reminder' }, icon('bell'),
      h('div', { class: 'grow' }, h('strong', null, t('onb.notif.title')), h('div', { class: 'small muted' }, t('onb.notif.text'))),
      h('button', { class: 'btn sm', onclick: async () => { let r = null; try { r = await pm.enable(ctx); } catch { /* ignore */ } if (r && r.ok) { toast(t('set.notif.status.on')); S.notifDismissed = true; scheduleRender(true); } else ctx.nav('settings/notifications'); } }, t('onb.notif.enable')), close);
  }
  if (state === 'ios-install') {
    return h('div', { class: 'card tonal row', style: { marginBottom: '16px' }, 'data-testid': 'notif-reminder-ios' }, icon('bell'),
      h('div', { class: 'grow' }, h('strong', null, t('onb.notif.title')), h('div', { class: 'small muted' }, t('set.notif.status.ios'))),
      h('a', { class: 'btn sm', href: '#/guide' }, t('more.guide')), close);
  }
  return null;
}

function buildShell() {
  const root = appEl();
  topEl = h('div', { class: 'top main' });
  mainEl = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  navEl = h('nav', { class: 'nav', 'aria-label': t('core.nav') });
  shell = h('div', { class: 'shell' }, h('button', { type: 'button', class: 'skip', onclick: () => { mainEl.focus({ preventScroll: false }); } }, t('core.skip')), navEl, h('div', { class: 'content' }, topEl, mainEl));
  navSig = ''; topSig = '';
  root.replaceChildren(shell);
  topEl.style.paddingBottom = '0'; topEl.style.minHeight = '0'; topEl.style.marginBottom = '-8px';
}
/** La barra di navigazione si aggiorna sul posto: i link non vengono ricreati (focus da tastiera e hover restano). */
function updateNav(tab) {
  const b = ctx.badges();
  const items = TABS.filter(([k]) => (k !== 'trips' || ctx.feature('trips')) && (k !== 'stats' || ctx.feature('stats') || ctx.feature('ranking')));
  const cols = window.innerWidth < 900 ? `repeat(${items.length}, 1fr)` : '';
  if (navEl.style.gridTemplateColumns !== cols) navEl.style.gridTemplateColumns = cols;
  const sig = items.map(([k]) => k).join(',') + '|' + getLang();
  if (sig !== navSig) {
    navSig = sig; navEl.setAttribute('aria-label', t('core.nav'));
    navEl.replaceChildren(...items.map(([k, ic, label]) => h('a', { href: '#/' + k, 'data-tab': k, onclick: () => haptic(prefs.haptics, 6) }, icon(ic), h('span', null, t(label)))));
  }
  for (const a of navEl.children) {
    const k = a.getAttribute('data-tab');
    if (k === tab) { if (a.getAttribute('aria-current') !== 'page') a.setAttribute('aria-current', 'page'); } else a.removeAttribute('aria-current');
    const n = k === '' ? b.home : k === 'more' ? b.more : 0; let bd = a.querySelector('.badge');
    if (n) { if (!bd) { bd = h('span', { class: 'badge', 'aria-hidden': 'true' }); a.append(bd); } if (bd.textContent !== String(n)) bd.textContent = n; a.setAttribute('aria-label', `${t(TABS.find((x) => x[0] === k)[2])}: ${n}`); } else { if (bd) bd.remove(); a.removeAttribute('aria-label'); }
  }
}
const adminLabel = () => (ctx.house.adminIds || []).map((id) => nameOf(ctx.house, id)).filter(Boolean).join(', ');
function updateTop() {
  const st = ctx.status;
  const houseLine = (ctx.house.name || 'Tidy House') + (adminLabel() ? ` · ${t('misc.admin')}: ${adminLabel()}` : '');
  const syncTxt = ctx.cloud ? (st === 'syncing' ? t('misc.syncing') : st === 'offline' ? t('misc.offline').split(':')[0] : '') : t('misc.localOnly');
  const sig = [houseLine, ctx.cloud ? st : 'local', syncTxt, ctx.isAdmin, getLang(), ctx.cloudStatusLabel()].join('|');
  if (sig === topSig) return;
  topSig = sig;
  topEl.replaceChildren(
    h('div', { class: 'who' }, h('div', { class: 'house', 'data-testid': 'house-line' }, houseLine), h('span', { class: 'sync ' + (ctx.cloud ? st : 'local'), title: ctx.cloudStatusLabel() }, h('i'), syncTxt)),
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
    if (!ctx.feature('refresh') || editingAnywhere() || hasOpenSheets()) return;   // mai sopra a chi sta scrivendo o ha uno sheet aperto
    const mins = Math.max(1, Number(ctx.house.refreshMin) || 5);
    if (Date.now() - S.lastRefresh < mins * 60000) return;
    S.refreshOpen = true;
    const s = sheet({ title: t('refresh.title'), onClose: () => { S.refreshOpen = false; S.lastRefresh = Date.now(); }, body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('refresh.text')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn soft', onclick: () => s.close() }, t('refresh.later')), h('button', { class: 'btn', onclick: () => location.reload() }, icon('refresh'), t('refresh.now')))) });
  };
  setInterval(check, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { check(); registerDevice(); try { recordView('open'); } catch { /* ignore */ } if (S.stage === 'push' || (S.stage === 'app' && needPushGate())) evaluate(); if (S.deferred) scheduleRender(true); } });
  window.addEventListener('focus', flushDeferred);
  document.addEventListener('focusout', () => { setTimeout(flushDeferred, 60); });
}

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    // nuova versione pronta: NON si applica da sola; il tasto nella Home diventa "Aggiorna" (colore accento) e un toast lo propone
    const offer = (w) => { if (!w) return; S.waitingSW = w; ctx.markUpdateReady(); toast(t('update.available'), 8000, { action: { label: t('update.apply'), onClick: () => ctx.applyUpdate() } }); };
    const check = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); };
    setInterval(check, 10 * 60 * 1000); document.addEventListener('visibilitychange', check);
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    // nuova versione attiva: ricarica appena l'utente non sta scrivendo e non ha uno sheet aperto (mai a metà di un inserimento)
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return; reloaded = true;
      if (!S.ready) return;
      const tick = () => { if (editingAnywhere() || hasOpenSheets()) setTimeout(tick, 1500); else location.reload(); };
      setTimeout(tick, 600);
    });
  } catch (e) { console.warn('SW', e); }
}

window.addEventListener('popstate', () => { popNav = true; setTimeout(() => { popNav = false; }, 600); });
window.addEventListener('hashchange', () => { if (S.stage === 'app') { closeAllSheets({ keepHistory: true }); scheduleRender(true); } else if (!S.store || S.stage === 'landing') startFromHash(); });
window.addEventListener('online', () => scheduleRender());
window.addEventListener('offline', () => scheduleRender());
let resizeT = 0;
window.addEventListener('resize', () => { if (!S.ready || !navEl) return; clearTimeout(resizeT); resizeT = setTimeout(() => updateNav(tabOf(S.route.root)), 80); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__bip = e; });
applyPrefs();
registerSW();
setupRefreshPrompt();
startFromHash().catch((e) => {
  console.error(e); hideBoot();
  appEl().replaceChildren(h('div', { class: 'gate' }, h('div', { class: 'panel' }, h('h1', null, t('error')), h('p', { class: 'muted' }, String(e && e.message || e)), h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, icon('refresh'), t('refresh.now')))));
});
