// Service worker: aggiornamento affidabile. Verifica con un browser vero (copia temporanea dell'app + server con ETag):
//  1) avvio offline dopo la sola prima apertura, su tutte le rotte;
//  2) uscita di una nuova VERSION: la cache vecchia NON si mescola con i file nuovi finché l'utente non applica l'aggiornamento;
//  3) applicando l'aggiornamento arriva tutto il nuovo e sparisce la cache vecchia;
//  4) modifica senza nuova VERSION: la cache si riallinea in blocco alla riapertura successiva.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { seed } from './helpers.mjs';
const require = createRequire(import.meta.url);
const SRC = path.resolve(new URL('../../', import.meta.url).pathname);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'th-sw-'));
for (const d of ['js', 'css', 'icons', 'vendor']) fs.cpSync(path.join(SRC, d), path.join(TMP, d), { recursive: true });
for (const f of ['index.html', 'sw.js', 'config.js', 'manifest.webmanifest']) fs.copyFileSync(f === 'sw.js' && process.env.SW_SRC ? process.env.SW_SRC : path.join(SRC, f), path.join(TMP, f));   // SW_SRC: prova con un altro sw.js (es. quello vecchio)
const rd = (f) => fs.readFileSync(path.join(TMP, f), 'utf8');
const wr = (f, s) => { fs.writeFileSync(path.join(TMP, f), s); const t = new Date(Date.now() + Math.random() * 1000); fs.utimesSync(path.join(TMP, f), t, t); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
let down = false;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(TMP, p);
  if (down || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(down ? 503 : 404); return res.end('x'); }
  const st = fs.statSync(f); const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=0', etag });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const { chromium } = require('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', locale: 'it-IT' });
await context.addInitScript((data) => { if (!localStorage.getItem('cp:seeded')) { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('cp:seeded', '1'); } }, seed({ houseExtra: { requireRules: false } }));
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const marker = () => page.evaluate(() => window.__uiMarker || null);
const cacheNames = () => page.evaluate(() => caches.keys());
const ready = () => page.waitForFunction(() => document.querySelector('#app .shell main')?.children.length > 0, null, { timeout: 15000 });
const settle = async (ms = 1200) => page.waitForTimeout(ms);

// versione 1 con un marcatore in ui.js
wr('js/ui.js', rd('js/ui.js') + "\nwindow.__uiMarker = 'v1';\n");
await page.goto(url + '/#/'); await ready();
await page.evaluate(() => navigator.serviceWorker.ready.then(() => 1)); await settle(800);

// 1) offline dopo la sola prima apertura
await context.setOffline(true);
await page.reload(); await ready();
ok(await marker() === 'v1', '1) riapertura offline: app avviata dalla cache (v1)');
for (const r of ['calendar', 'trips', 'stats', 'more', 'settings/appearance', 'guide']) {
  await page.evaluate((r) => { location.hash = '#/' + r; }, r); await page.waitForTimeout(350);
  const txt = await page.evaluate(() => (document.querySelector('#app main')?.innerText || '').trim());
  ok(txt.length > 15 && !/Qualcosa è andato storto/.test(txt), `1) offline, rotta ${r}`);
}
await context.setOffline(false);
await page.evaluate(() => { location.hash = '#/'; });

// 2) esce la 9.9.9 (sw.js + file cambiati): fino all'applicazione la pagina resta sulla v1, anche dopo più riaperture
const oldVersion = (rd('sw.js').match(/const VERSION = '([^']+)'/) || [])[1];
wr('sw.js', rd('sw.js').replace(/const VERSION = '[^']+'/, "const VERSION = '9.9.9'"));
wr('js/ui.js', rd('js/ui.js').replace("'v1'", "'v2'"));
wr('js/screens/stats.js', rd('js/screens/stats.js') + "\nwindow.__statsMarker = 'v2';\n");
await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r.waiting; }, null, { timeout: 15000 });
ok(true, '2) il nuovo worker è in attesa');
for (let i = 0; i < 3; i++) { await page.reload(); await ready(); await settle(700); }
await page.evaluate(() => { location.hash = '#/stats'; }); await page.waitForTimeout(500);
ok(await marker() === 'v1', '2) dopo 3 riaperture con la versione nuova in attesa: ancora tutto v1 (niente mescolanza)');
ok(await page.evaluate(() => window.__statsMarker || null) === null, '2) anche la schermata caricata dopo è ancora la vecchia');
ok(JSON.stringify(await cacheNames()) .includes(oldVersion) && JSON.stringify(await cacheNames()).includes('9.9.9'), '2) in cache le due versioni, ciascuna a sé: ' + JSON.stringify(await cacheNames()));

// 3) applico l'aggiornamento: ricarica da sola con tutto il nuovo, cache vecchia eliminata
await page.evaluate(() => window.__app.applyUpdate());
await page.waitForFunction(() => window.__uiMarker === 'v2', null, { timeout: 15000 });
await ready(); await settle(800);
ok(await marker() === 'v2', '3) dopo «Aggiorna»: file nuovi (v2)');
ok(JSON.stringify(await cacheNames()) === JSON.stringify(['tidyhouse-9.9.9']), '3) rimane solo la cache 9.9.9: ' + JSON.stringify(await cacheNames()));

// 4) modifica senza nuova VERSION: al ciclo successivo la cache si riallinea (in blocco)
wr('js/ui.js', rd('js/ui.js').replace("'v2'", "'v3'"));
wr('js/screens/trips.js', rd('js/screens/trips.js') + "\nwindow.__tripsMarker = 'v3';\n");
await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');   // il worker riparte con la memoria vuota, come dopo un po' di inattività
await page.reload(); await ready(); await settle(2500);   // apre dalla cache (v2) e riconferma in sottofondo
await page.reload(); await ready();
ok(await marker() === 'v3', '4) stessa VERSION, file cambiati: alla riapertura dopo la riconferma arrivano i nuovi (v3)');
await page.evaluate(() => { location.hash = '#/trips'; }); await page.waitForTimeout(500);
ok(await page.evaluate(() => window.__tripsMarker || null) === 'v3', '4) anche una schermata mai aperta prima è stata riallineata');

// 5) server giù durante l'installazione: il worker non si installa a metà (resta la versione precedente)
wr('sw.js', rd('sw.js').replace("'9.9.9'", "'9.9.10'"));
down = true;
const res5 = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); try { await r.update(); } catch (e) { return 'update-error'; } return r.installing ? 'installing' : r.waiting ? 'waiting' : 'none'; });
down = false;
ok(res5 !== 'waiting', '5) con il server giù non si arriva a «in attesa» (' + res5 + ')');
ok(await page.evaluate(() => navigator.serviceWorker.controller ? 'ctl' : 'none') === 'ctl', '5) la pagina resta sotto il worker precedente');

await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true });
console.log(fails ? `${fails} problemi` : 'OK: service worker, aggiornamento affidabile');
process.exit(fails ? 1 : 0);
