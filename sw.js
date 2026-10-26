// Service worker di Tidy House: funzionamento offline + notifiche push.
// Per pubblicare una nuova versione dell'app basta cambiare VERSION: il nuovo worker rifà la cache da zero.
const VERSION = '1.7.0';
const CACHE = `tidyhouse-${VERSION}`;

// File dell'app shell. I mancanti vengono ignorati; tutto il resto viene messo in cache la prima volta che serve.
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'config.js',
  'css/app.css', 'css/settings.css',
  'js/app.js', 'js/ui.js', 'js/i18n.js', 'js/engine.js', 'js/store.js', 'js/actions.js', 'js/extras.js', 'js/ai.js', 'js/ai-ui.js', 'js/push.js', 'js/kick.js',
  'js/backupcrypto.js', 'js/xlsx-import.js', 'js/choresheet.js', 'js/doaction.js',
  'js/screens/home.js', 'js/screens/calendar.js', 'js/screens/trips.js', 'js/screens/stats.js', 'js/screens/more.js', 'js/screens/settings.js', 'js/screens/onboarding.js',
  'js/strings/set.js', 'js/strings/push.js', 'js/strings/doaction.js',
  'vendor/qr.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'icons/favicon.svg', 'icons/logo.svg', 'icons/badge-96.png', 'icons/monochrome-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' salta la cache HTTP: il precache contiene sempre i file della versione appena pubblicata
    await Promise.allSettled(SHELL.map(async (u) => {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (res && res.ok) await cache.put(u, res);
    }));
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
function fetchTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
async function networkFirst(req, isNav) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchTimeout(isNav ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : req, isNav ? 6000 : 4000);
    if (res && res.ok) cache.put(isNav ? req.url.split('#')[0] : req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true }))
      || (isNav ? (await cache.match('index.html')) || (await cache.match('./')) : null);
    if (hit) return hit;
    throw err;
  }
}
async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req, { cache: 'no-cache' }).then((res) => { if (res && res.ok) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  const res = await refresh;
  if (res) return res;
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                  // Firebase, font, ecc.: gestiti dal browser
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, true)); return; }
  if (url.pathname.endsWith('/config.js')) { event.respondWith(networkFirst(req, false)); return; }
  event.respondWith(staleWhileRevalidate(event));
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
