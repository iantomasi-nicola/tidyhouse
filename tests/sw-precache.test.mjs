// Il precache del service worker deve contenere ogni modulo e ogni css dell'app (tranne Firebase/SheetJS, caricati su richiesta):
// così ogni rotta funziona offline già dopo la prima apertura e la cache di una versione è coerente. Esegue sw.js con un ambiente finto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const SCOPE = 'https://example.test/app/';
const SERVER_ONLY = new Set(['js/strings/notify.js']);   // usato solo dallo script delle notifiche (Node), non dall'app

function loadSw() {
  const listeners = {}; const put = new Map(); const fetched = [];
  const files = (u) => { const p = new URL(u, SCOPE).pathname.slice('/app/'.length) || 'index.html'; const f = path.join(ROOT, p); return fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };
  class Req { constructor(u, o) { this.url = new URL(u, SCOPE).href; this.cache = o && o.cache; } }
  const sandbox = {
    self: { registration: { scope: SCOPE }, location: new URL(SCOPE + 'sw.js'), addEventListener: (n, f) => { listeners[n] = f; } },
    caches: { open: async () => ({ put: async (k, r) => { put.set(new URL(typeof k === 'string' ? k : k.url, SCOPE).pathname.slice('/app/'.length), r); } }), keys: async () => [], delete: async () => true },
    Request: Req, Response: class { }, URL, console,
    fetch: async (rq) => {
      fetched.push(rq.url); const f = files(rq.url);
      if (!f) return { ok: false, status: 404 };
      const body = fs.readFileSync(f);
      const r = { ok: true, status: 200, clone: () => r, text: async () => body.toString('utf8') };
      return r;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8') + '\n;this.__precacheAll = precacheAll; this.__CORE = CORE;', sandbox);
  return { sandbox, put, fetched };
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('il precache copre tutti i moduli JS e CSS dell\'app (esclusi i pacchetti grandi su richiesta)', async () => {
  const { sandbox, put } = loadSw();
  const cache = { put: async (k, r) => { put.set(String(k).replace(/^\.\//, ''), r); } };
  const failed = await sandbox.__precacheAll(cache);
  assert.deepEqual([...failed], [], 'nessun file CORE mancante');
  const want = [...walk(path.join(ROOT, 'js')), ...walk(path.join(ROOT, 'css'))].map((f) => path.relative(ROOT, f)).filter((f) => /\.(js|css)$/.test(f) && !SERVER_ONLY.has(f));
  // moduli solo per Node/utili all'app? Tutto ciò che sta in js/ e css/ è dell'app: deve essere nel precache
  const missing = want.filter((f) => !put.has(f));
  assert.deepEqual(missing, [], 'file dell\'app fuori dal precache: ' + missing.join(', ') + ' (importali da un modulo oppure aggiungili a SHELL in sw.js)');
  for (const big of ['vendor/firebase.js', 'vendor/xlsx.js']) assert.ok(!put.has(big), big + ' resta fuori dal precache (si carica su richiesta)');
  for (const f of ['index.html', 'config.js', 'js/app.js', 'css/app.css', 'icons/icon-192.png']) assert.ok(put.has(f), f + ' nel precache');
});

test('un file CORE che non si scarica fa fallire l\'installazione (niente cache a metà)', async () => {
  const { sandbox } = loadSw();
  sandbox.fetch = async (rq) => (/config\.js/.test(rq.url) ? { ok: false, status: 503 } : { ok: true, status: 200, clone() { return this; }, text: async () => '' });
  const failed = await sandbox.__precacheAll({ put: async () => {} });
  assert.ok(failed.includes('config.js'));
});
