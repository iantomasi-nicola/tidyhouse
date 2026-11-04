// Service worker di Tidy House: funzionamento offline + notifiche push.
// Per pubblicare una nuova versione dell'app basta cambiare VERSION: il nuovo worker rifà la cache da zero.
const VERSION = '1.12.1';
const CACHE = `tidyhouse-${VERSION}`;

// File di partenza del precache. Il resto dell'app (moduli, stringhe, css) viene scoperto da solo leggendo gli import
// (statici e dinamici) e i loadCss('css/...') di ogni file: una nuova schermata o un nuovo modulo entra nel precache senza toccare questa lista.
// Fuori dal precache restano solo i due pacchetti grandi caricati su richiesta (Firebase, SheetJS): si salvano in cache al primo uso.
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'config.js',
  'css/app.css',
  'js/app.js',
  'js/screens/home.js', 'js/screens/calendar.js', 'js/screens/trips.js', 'js/screens/stats.js', 'js/screens/more.js', 'js/screens/settings.js', 'js/screens/onboarding.js',   // importate con un nome calcolato (app.js)
  'vendor/qr.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'icons/favicon.svg', 'icons/logo.svg', 'icons/badge-96.png', 'icons/monochrome-512.png',
];
// Senza questi l'app non parte: se uno non si scarica l'installazione fallisce (resta la versione precedente e si riprova), invece di attivare una cache a metà.
const CORE = ['index.html', 'config.js', 'css/app.css', 'js/app.js', 'js/screens/home.js'];
const LAZY_BIG = /^vendor\/(firebase|xlsx)\.js$/;

const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;
const rel = (u) => (u.origin === self.location.origin && u.pathname.startsWith(SCOPE_PATH) ? u.pathname.slice(SCOPE_PATH.length) : null);
/** File (relativi allo scope) a cui rimanda un modulo JS: import statici, import('…') e loadCss('css/…'). */
function refsOf(path, text) {
  const out = new Set(); const base = new URL(path, SCOPE);
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"?#]+\.js)['"]/g)) { const r = rel(new URL(m[1], base)); if (r) out.add(r); }
  for (const m of text.matchAll(/\bloadCss\(\s*['"]([^'"?#]+\.css)['"]/g)) { const r = rel(new URL(m[1], SCOPE)); if (r) out.add(r); }
  return out;
}
/** Scarica (saltando la cache HTTP) tutti i file dell'app e li mette nella cache di questa versione. Ritorna i file di CORE mancanti. */
async function precacheAll(cache) {
  const seen = new Set(); const failedCore = []; let wave = SHELL.slice();
  const get = async (u) => {
    for (let k = 0; k < 2; k++) {
      try { const res = await fetch(new Request(u, { cache: 'reload' })); if (res && res.ok) return res; } catch { /* riprova una volta */ }
    }
    return null;
  };
  while (wave.length) {
    const next = [];
    await Promise.all(wave.map(async (u) => {
      if (seen.has(u)) return; seen.add(u);
      const res = await get(u);
      if (!res) { if (CORE.includes(u)) failedCore.push(u); return; }
      await cache.put(u, res.clone());
      if (/\.js$/.test(u)) { try { for (const r of refsOf(u, await res.text())) if (!seen.has(r) && !LAZY_BIG.test(r)) next.push(r); } catch { /* ignore */ } }
    }));
    wave = next;
  }
  return failedCore;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const failed = await precacheAll(cache);
    if (failed.length) throw new Error('precache incompleto: ' + failed.join(', '));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tidyhouse-') && k !== CACHE) await caches.delete(k);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- strategie di cache ----------
// La cache di una versione è completa e si serve da lì (nessuna attesa di rete all'avvio, funziona offline su ogni rotta).
// In sottofondo i file si riconfermano con il server, ma SOLO se sul server c'è ancora la stessa VERSION: se è uscita una versione nuova
// questa cache resta com'è (niente file nuovi mescolati a file vecchi) e l'aggiornamento arriva con il nuovo worker.
let serverVersion = { at: 0, same: true };
async function sameVersionOnServer() {
  if (Date.now() - serverVersion.at < 60000) return serverVersion.same;
  let same = false;
  try {
    const r = await fetch(new Request('sw.js', { cache: 'no-cache' }));
    const m = r.ok && (await r.text()).match(/const VERSION = '([^']+)'/);
    same = !!m && m[1] === VERSION;
  } catch { same = false; }
  serverVersion = { at: Date.now(), same };
  return same;
}
const frozen = () => !!(self.registration.waiting || self.registration.installing);
const checked = new Map();   // url → ultimo controllo (il worker dorme dopo pochi secondi: vale per la sessione)
let refreshing = null;
const stamp = (r) => (r.headers.get('etag') || '') + '|' + (r.headers.get('last-modified') || '');

async function revalidate(url, cache) {
  if (frozen()) return;
  const last = checked.get(url); if (last && Date.now() - last < 5 * 60000) return;
  checked.set(url, Date.now());
  try {
    if (!(await sameVersionOnServer()) || frozen()) return;
    const res = await fetch(new Request(url, { cache: 'no-cache' }));   // richiesta condizionale: 304 (dal browser) se il file non è cambiato
    if (!res || !res.ok) return;
    const old = await cache.match(url);
    if (old) {
      const a = stamp(old), b = stamp(res);
      if (a !== '|' && a === b) return;
      if (a === '|' && (await old.clone().text()) === (await res.clone().text())) return;   // server senza ETag: confronto del contenuto
    }
    // un file è cambiato senza una nuova VERSION: si riscarica tutto l'insieme in un colpo solo, così la cache resta coerente
    if (!refreshing) refreshing = precacheAll(cache).catch(() => {}).then(() => { refreshing = null; });
    await refreshing;
  } catch { /* offline: resta la cache */ }
}

const INDEX = () => new URL('index.html', SCOPE).href;
async function navigate(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(INDEX());
  if (hit) { event.waitUntil(revalidate(INDEX(), cache)); return hit; }
  return fetch(event.request);
}
async function asset(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
  if (hit) { event.waitUntil(revalidate(req.url.split('#')[0].split('?')[0], cache)); return hit; }
  // non in cache (es. Firebase/SheetJS al primo uso): rete, e si conserva per le volte successive (solo se questa è la versione corrente)
  const res = await fetch(req);
  if (res && res.ok && !frozen()) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                  // Firebase, font, ecc.: gestiti dal browser
  if (req.mode === 'navigate') {
    // pagina dell'app (anche con ?emu=… o #…): dalla cache subito; altri percorsi: rete normale
    if (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html') event.respondWith(navigate(event).catch(() => Response.error()));
    return;
  }
  event.respondWith(asset(event).catch(() => Response.error()));
});

// ---------- push ----------
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { try { d = { body: event.data.text() }; } catch { d = {}; } }
  const icon = new URL('icons/icon-192.png', self.registration.scope).href;
  const badge = new URL('icons/badge-96.png', self.registration.scope).href;
  // azioni dalla notifica («Segna fatto», «Accetta», «Rifiuta»): max 2, al browser va solo {action,title}; gli url restano nel data
  const acts = (Array.isArray(d.actions) ? d.actions : []).filter((a) => a && typeof a.action === 'string' && a.action && typeof a.title === 'string' && a.title).slice(0, 2);
  const actionUrls = {};
  for (const a of acts) if (typeof a.url === 'string' && a.url.startsWith('#/')) actionUrls[a.action] = a.url;
  const opts = { body: d.body || '', icon, badge, data: { url: d.url || '#/', house: d.house || null, actions: actionUrls } };
  if (acts.length) opts.actions = acts.map((a) => ({ action: a.action, title: a.title }));
  if (d.tag) { opts.tag = String(d.tag); opts.renotify = true; }
  // iOS richiede che ogni push mostri una notifica: anche se il payload è vuoto o illeggibile
  event.waitUntil(self.registration.showNotification(d.title || 'Tidy House', opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // tocco su un'azione → url di quell'azione; tocco sul corpo (o iOS, senza azioni) → url della notifica
  const data = event.notification.data || {};
  const raw = (event.action && data.actions && data.actions[event.action]) || data.url || '#/';
  const scope = self.registration.scope;
  const target = /^https?:/.test(raw) ? raw : scope + (raw.startsWith('#') ? raw : '#/' + raw.replace(/^\/+/, ''));
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.find((c) => c.url.startsWith(scope)) || null;
    if (mine) {
      try { await mine.focus(); } catch { /* ignore */ }
      try { await mine.navigate(target); } catch { try { mine.postMessage({ type: 'NAVIGATE', url: target }); } catch { /* ignore */ } }
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // la sottoscrizione è scaduta: l'app la rinnova (resync) alla prossima apertura
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'PUSH_RESYNC' }))));
});
