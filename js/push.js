// Notifiche push (Web Push standard). Funziona con il service worker di ./sw.js.
// Tutte le funzioni sono "difensive": non lanciano, restituiscono { ok, reason? }.
import { t, registerStrings } from './i18n.js';
import { it, en } from './strings/push.js';
registerStrings(it, en);

const UA = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';
export const isIOS = () => /iPad|iPhone|iPod/.test(UA()) || (/Macintosh/.test(UA()) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
export const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// ---------- base64url ----------
export function b64uToU8(s) {
  const pad = '='.repeat((4 - (String(s).length % 4)) % 4);
  const bin = atob((String(s) + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function u8ToB64u(u8) {
  let bin = ''; for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- service worker ----------
async function getReg(wait = 4000) {
  if (!('serviceWorker' in navigator)) return null;
  try { const r = await navigator.serviceWorker.getRegistration(); if (r && r.active) return r; } catch { /* ignore */ }
  return Promise.race([navigator.serviceWorker.ready, new Promise((res) => setTimeout(() => res(null), wait))]).catch(() => null);
}
const memberOf = (ctx) => ((ctx.state && ctx.state.members) || {})[ctx.deviceId] || {};
function sameKey(sub, key) {
  const k = sub && sub.options && sub.options.applicationServerKey;
  if (!k) return true; // non verificabile
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}
async function ensureSub(ctx) {
  const reg = await getReg();
  if (!reg) throw new Error('no-sw');
  const key = b64uToU8(ctx.house.vapidPublic);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return sub;
}

/** Stato delle notifiche su questo dispositivo (sincrono). */
// La sottoscrizione push dipende dal browser, non dal cloud: la ricordiamo in locale così lo stato è corretto
// subito all'apertura (il documento del dispositivo sul cloud arriva dopo, e prima sembrava "non attiva").
const FLAG = 'cp:pushsub';
const flag = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
const setFlag = (v) => { try { if (v) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* ignore */ } };
/** Controlla davvero il browser (permesso + sottoscrizione esistente) e aggiorna il ricordo locale. */
export async function probe() {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') { setFlag(false); return false; }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = !!(reg && reg.pushManager && await reg.pushManager.getSubscription());
    setFlag(sub); return sub;
  } catch { return flag(); }
}

export function status(ctx) {
  const ios = isIOS(), standalone = isStandalone();
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  const subscribed = (permission === 'granted' && flag()) || !!(memberOf(ctx).push && memberOf(ctx).push.endpoint);
  let state;
  if (ios && !standalone) state = 'ios-install';
  else if (!supported()) state = 'unsupported';
  else if (ctx.mode !== 'cloud') state = 'nocloud';
  else if (!(ctx.house && ctx.house.vapidPublic)) state = 'nopush';
  else if (permission === 'denied') state = 'denied';
  else state = permission === 'granted' && subscribed ? 'on' : 'off';
  return { state, permission, ios, standalone, subscribed, supported: supported() };
}

/** Chiede il permesso, si iscrive e salva la sottoscrizione sul dispositivo (member). Va chiamata da un gesto dell'utente. */
export async function enable(ctx) {
  const s = status(ctx);
  if (s.state !== 'off' && s.state !== 'on') return { ok: false, reason: s.state };
  let perm = Notification.permission;
  if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
  try {
    const sub = await ensureSub(ctx);
    const prefs = (ctx.prefs && ctx.prefs.notif) || {};
    await ctx.actions.touchMember({ push: sub.toJSON(), lang: ctx.lang, ...(Object.keys(prefs).length ? { prefs } : {}) });
    setFlag(true);
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'error', error: e }; }
}

export async function disable(ctx) {
  try {
    const reg = await getReg(2500);
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await sub.unsubscribe();
  } catch { /* ignore */ }
  setFlag(false);
  try { await ctx.actions.touchMember({ push: null }); return { ok: true }; } catch (e) { return { ok: false, reason: 'error', error: e }; }
}

/** Mostra subito una notifica locale (senza passare dal server). */
export async function localTest(ctx) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return { ok: false, reason: 'permission' };
  const icon = new URL('icons/icon-192.png', document.baseURI).href;
  const opts = { body: t('n.test.body'), icon, badge: icon, tag: 'tidyhouse-test', data: { url: '#/' } };
  try {
    const reg = await getReg(2500);
    if (reg && reg.showNotification) await reg.showNotification(t('n.test.title'), opts);
    else new Notification(t('n.test.title'), opts);
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'error', error: e }; }
}

let busy = false;
/**
 * Riallinea la sottoscrizione con il documento del dispositivo (anche dopo un cambio del codice casa o delle chiavi).
 * Silenziosa: non chiede permessi e non fa nulla se le notifiche non erano state attivate.
 */
export async function resync(ctx) {
  if (busy || !supported() || ctx.mode !== 'cloud' || !ctx.actions) return { ok: false, reason: 'skip' };
  if (!(ctx.house && ctx.house.vapidPublic) || Notification.permission !== 'granted') return { ok: false, reason: 'skip' };
  busy = true;
  try {
    const reg = await getReg(2500);
    if (!reg) return { ok: false, reason: 'no-sw' };
    const m = memberOf(ctx);
    const key = b64uToU8(ctx.house.vapidPublic);
    let sub = await reg.pushManager.getSubscription();
    setFlag(!!sub);
    if (!sub && !(m.push && m.push.endpoint)) return { ok: true, changed: false };   // mai attivate qui
    if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = sub.toJSON();
    const same = m.push && m.push.endpoint === json.endpoint && m.push.keys && json.keys && m.push.keys.p256dh === json.keys.p256dh && m.push.keys.auth === json.keys.auth;
    if (!same) { await ctx.actions.touchMember({ push: json }); return { ok: true, changed: true }; }
    return { ok: true, changed: false };
  } catch (e) { return { ok: false, reason: 'error', error: e }; }
  finally { busy = false; }
}

/** Genera una coppia di chiavi VAPID (ECDSA P-256) compatibile con la libreria web-push. */
export async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));            // 65 byte, non compressa
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const d = b64uToU8(jwk.d); const priv = new Uint8Array(32); priv.set(d.slice(-32), 32 - Math.min(32, d.length));
  return { publicKey: u8ToB64u(pub), privateKey: u8ToB64u(priv) };
}
