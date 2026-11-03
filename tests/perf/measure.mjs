// Misure di prestazioni (Playwright/Chromium). Uso: node tests/perf/measure.mjs [etichetta] > out.json
// Server statico che imita GitHub Pages (gzip + cache-control max-age=600 + ETag/304), service worker ATTIVO.
// Output: JSON con avvio a freddo/caldo/offline, byte e richieste per rotta, rerender, long task, memoria/listener, store con N settimane.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { seed } from '../e2e/helpers.mjs';
const require = createRequire(import.meta.url);
const ROOT = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : path.resolve(new URL('../../', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const WEEKS = Number(process.env.WEEKS || 70);
const LAT = Number(process.env.LAT || 0);   // ritardo simulato per richiesta (ms), per imitare una rete mobile

const server = http.createServer((req, res0) => {
  const res = res0;
  if (LAT) { const origEnd = res.end.bind(res); const origWH = res.writeHead.bind(res); let args = null; res.writeHead = (...a) => { args = a; return res; }; res.end = (b) => setTimeout(() => { if (args) origWH(...args); origEnd(b); }, LAT); }
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  const st = fs.statSync(f); const etag = `"${st.size}-${st.mtimeMs}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
  const ext = path.extname(f); const body = fs.readFileSync(f);
  const compress = /\.(js|css|html|json|webmanifest|svg)$/.test(f);
  const out = compress ? zlib.gzipSync(body) : body;
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'max-age=600', etag, ...(compress ? { 'content-encoding': 'gzip' } : {}) });
  res.end(out);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const { chromium } = require('playwright');
const browser = await chromium.launch();

function bigSeed(weeks) {
  const s = seed({ houseExtra: { requireRules: false } });
  const id = 'LOCALTEST001'; const st = s[`cp:h:${id}`];
  const start = new Date(Date.UTC(2026, 9, 4) - weeks * 7 * 86400000); st.house.startSunday = start.toISOString().slice(0, 10);
  const ppl = ['anna', 'bruno', 'carla'];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start.getTime() + i * 7 * 86400000).toISOString().slice(0, 10);
    const res = {}; ['floor', 'bathroom', 'kitchen'].forEach((c, k) => { res[c] = (i + k) % 11 === 0 ? 'skipped' : 'done'; });
    st.weeks[d] = { result: res, resultAt: { floor: d + 'T12:00:00.000Z' }, ...(i % 5 === 0 ? { awayMap: { [ppl[i % 3]]: true } } : {}), ...(i % 9 === 0 ? { note: 'nota ' + i } : {}) };
  }
  for (let i = 0; i < 120; i++) st.log['l' + i] = { at: new Date(Date.UTC(2026, 8, 1) + i * 3600000).toISOString(), by: 'anna', type: 'done', p: { week: '2026-09-06', chore: 'floor' } };
  for (let i = 0; i < 6; i++) st.trips['t' + i] = { personId: ppl[i % 3], from: '2026-11-0' + (i + 1), to: '2026-11-1' + i, note: '', by: 'anna', at: '2026-10-01T10:00:00.000Z' };
  return s;
}

async function newPage(opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, locale: 'it-IT', colorScheme: opts.dark ? 'dark' : 'light', hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'allow' });
  if (opts.seed) await context.addInitScript((data) => { if (!localStorage.getItem('cp:seeded')) { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('cp:seeded', '1'); } }, opts.seed);
  const page = await context.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.__errors.push(m.text()); });
  return { context, page };
}
/** Raccoglie richieste/byte con CDP (encodedDataLength = byte sul filo, già compressi). */
async function tap(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  let reqs = new Map(); const st = {};
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url }));
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.sw = !!e.response.fromServiceWorker; r.disk = !!e.response.fromDiskCache; r.status = e.response.status; } });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (!r) return; r.bytes = e.encodedDataLength; });
  st.snap = () => {
    const out = { reqs: 0, bytes: 0, netReqs: 0, swReqs: 0 }; const files = [];
    for (const r of reqs.values()) { if (r.bytes === undefined && r.status === undefined) continue; out.reqs++; out.bytes += r.bytes || 0; if (r.sw) out.swReqs++; if (!r.sw && !r.disk && (r.bytes || 0) > 0) out.netReqs++; files.push([r.url.replace(url, ''), r.bytes || 0, r.sw ? 'sw' : r.disk ? 'disk' : 'net']); }
    out.files = files; return out;
  };
  st.reset = () => { reqs = new Map(); };
  return st;
}
const ready = (page) => page.waitForFunction(() => document.querySelector('#app .shell main') && document.querySelector('#app .shell main').children.length > 0 && document.getElementById('boot')?.classList.contains('gone'), null, { timeout: 15000 });

const vitals = () => {
  window.__lt = []; window.__lcp = 0; window.__cls = 0;
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) { /* */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lcp = Math.round(e.startTime); })).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) { /* */ }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); } catch (e) { /* */ }
};
async function readVitals(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]; const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
    return { dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), fcp: Math.round(fcp), lcp: window.__lcp, cls: Math.round(window.__cls * 1000) / 1000, longTasks: window.__lt.length, longTaskMs: window.__lt.reduce((a, b) => a + b, 0), longTaskMax: Math.max(0, ...window.__lt) };
  });
}
const strip = (o) => { const { files, ...rest } = o; return rest; };

const out = { weeks: WEEKS, label: process.argv[2] || '' };
const S = bigSeed(WEEKS);

// ---- 1) avvio a freddo (nessun SW, nessuna cache), caldo (SW attivo, cache riempita), offline ----
{
  const { context, page } = await newPage({ seed: S });
  await page.addInitScript(vitals);
  const net = await tap(page);
  const t0 = Date.now();
  await page.goto(url + '/#/', { waitUntil: 'load' });
  await ready(page); const tReady = Date.now() - t0;
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => 1)); await page.waitForTimeout(800);   // lascia finire il precache del SW
  const c = net.snap();
  const cold = { ...(await readVitals(page)), readyMs: tReady, ...strip(c) };
  out.coldFiles = c.files.map((f) => f[0] + ' ' + f[1]);
  const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (r.active ? 'active' : 'installing') : 'none'; });
  const cacheInfo = await page.evaluate(async () => { const o = {}; let bytes = 0; for (const k of await caches.keys()) { const c = await caches.open(k); const ks = await c.keys(); o[k] = ks.length; for (const rq of ks) { const r = await c.match(rq); bytes += (await r.clone().arrayBuffer()).byteLength; } } return { entries: o, KB: Math.round(bytes / 1024) }; });
  net.reset(); await page.evaluate(() => performance.clearResourceTimings());
  const t1 = Date.now();
  await page.reload({ waitUntil: 'load' });
  await ready(page); const warmReady = Date.now() - t1; await page.waitForTimeout(800);
  const w = net.snap();
  const warm = { ...(await readVitals(page)), readyMs: warmReady, ...strip(w) };
  out.warmFiles = w.files.map((f) => f.join(' '));
  await context.setOffline(true); net.reset();
  const t2 = Date.now(); let offline;
  try { await page.reload({ waitUntil: 'load' }); await ready(page); offline = { ok: true, readyMs: Date.now() - t2 }; } catch (e) { offline = { ok: false, error: String(e).slice(0, 120) }; }
  await context.setOffline(false);
  out.start = { sw: swState, cache: cacheInfo, cold, warm, offline, errors: page.__errors };
  await context.close();
}

// ---- 2) per rotta: byte/richieste caricati navigando nell'app già avviata ----
const routes = ['', 'calendar', 'trips', 'stats', 'more', 'needs', 'settings', 'settings/appearance', 'settings/notifications', 'settings/data', 'guide', 'activity'];
{
  const { context, page } = await newPage({ seed: S });
  await page.addInitScript(vitals);
  const net = await tap(page);
  await page.goto(url + '/#/'); await ready(page); await page.waitForTimeout(1500);
  out.routes = {};
  for (const r of routes) {
    net.reset();
    await page.evaluate((r) => { location.hash = '#/' + r; }, r);
    await page.waitForTimeout(500);
    const s = net.snap(); out.routes[r || 'home'] = { reqs: s.reqs, kb: Math.round(s.bytes / 102.4) / 10, viaNet: s.files.filter((f) => f[2] === 'net').length, files: s.files.filter((f) => f[1] > 0).map((f) => f[0]).slice(0, 14) };
  }
  out.routeRender = {};
  for (const r of routes) {
    await page.evaluate((r) => { location.hash = '#/' + r; }, r); await page.waitForTimeout(350);
    const ms = await page.evaluate(async () => {
      const a = window.__app; const t0 = performance.now(); const n0 = a.renderCount + a.renderSkips; a.rerender();
      await new Promise((res) => { const iv = setInterval(() => { if (a.renderCount + a.renderSkips > n0 || performance.now() - t0 > 3000) { clearInterval(iv); res(); } }, 1); });
      return Math.round((performance.now() - t0) * 10) / 10;
    });
    out.routeRender[r || 'home'] = ms;
  }
  out.dataChange = await page.evaluate(async () => {
    const a = window.__app; location.hash = '#/'; await new Promise((r) => setTimeout(r, 400));
    const res = {};
    const r0 = a.renderCount, k0 = a.renderSkips;
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) { await a.actions.addNeed('latte ' + i); await new Promise((r) => setTimeout(r, 160)); }
    res.rendersFor10Writes = a.renderCount - r0; res.skipsFor10Writes = a.renderSkips - k0;
    // 10 scritture di accessi/dispositivi (nel cloud le fanno gli altri telefoni di continuo): non devono ridisegnare la Home
    const r1 = a.renderCount + a.renderSkips, q1 = a.quietSkips || 0;
    for (let i = 0; i < 10; i++) { await a.actions.recordView('home'); await a.actions.touchMember({}); await new Promise((r) => setTimeout(r, 160)); }
    res.screenBuildsFor20QuietWrites = a.renderCount + a.renderSkips - r1; res.quietSkips = (a.quietSkips || 0) - q1;
    return res;
  });
  out.errorsRoutes = page.__errors;
  await context.close();
}

// ---- 3) memoria / listener dopo molte navigazioni ----
{
  const { context, page } = await newPage({ seed: S });
  const cdp = await context.newCDPSession(page);
  await page.goto(url + '/#/'); await ready(page); await page.waitForTimeout(800);
  const snap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const c = await cdp.send('Memory.getDOMCounters'); const m = await cdp.send('Runtime.getHeapUsage'); return { heapMB: Math.round(m.usedSize / 104857.6) / 10, nodes: c.nodes, listeners: c.jsEventListeners, docs: c.documents }; };
  const tabs = ['calendar', 'trips', 'stats', 'more', 'settings', 'needs', ''];
  for (let i = 0; i < 14; i++) { await page.evaluate((r) => { location.hash = '#/' + r; }, tabs[i % tabs.length]); await page.waitForTimeout(40); }   // riscaldamento
  await page.waitForTimeout(500);
  const before = await snap();
  const t0 = Date.now();
  for (let i = 0; i < 210; i++) { await page.evaluate((r) => { location.hash = '#/' + r; }, tabs[i % tabs.length]); await page.waitForTimeout(30); }
  await page.waitForTimeout(600);
  const navMs = Date.now() - t0;
  const after = await snap();
  out.memory = { before, after, navigations: 210, navMs, errors: page.__errors };
  await context.close();
}

// ---- 4) dimensione dello store con N settimane ----
{
  const { context, page } = await newPage({ seed: S });
  await page.goto(url + '/#/'); await ready(page);
  out.store = await page.evaluate(async () => {
    const raw = localStorage.getItem('cp:h:LOCALTEST001'); const a = window.__app;
    const t0 = performance.now(); for (let i = 0; i < 20; i++) JSON.stringify(a.state); const stringify = (performance.now() - t0) / 20;
    const eng = await import('./js/engine.js'); const ex = await import('./js/store.js');
    const eh = ex.engineHouse(a.state); const t1 = performance.now(); for (let i = 0; i < 20; i++) eng.compute(eh, a.today(), 14); const comp = (performance.now() - t1) / 20;
    const t2 = performance.now(); for (let i = 0; i < 20; i++) ex.engineHouse(a.state); const eng2 = (performance.now() - t2) / 20;
    return { localStorageKB: Math.round(raw.length / 102.4) / 10, weeks: Object.keys(a.state.weeks).length, views: Object.keys(a.state.views).length, stringifyMs: Math.round(stringify * 100) / 100, computeMs: Math.round(comp * 100) / 100, engineHouseMs: Math.round(eng2 * 100) / 100, ls: Object.entries(localStorage).map(([k, v]) => [k, v.length]) };
  });
  await context.close();
}
// ---- 5) offline dopo la sola prima apertura (nessuna rotta visitata prima): quali rotte funzionano? ----
{
  const { context, page } = await newPage({ seed: S });
  await page.goto(url + '/#/'); await ready(page); await page.evaluate(() => navigator.serviceWorker.ready.then(() => 1)); await page.waitForTimeout(800);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  try { await ready(page); out.offlineHome = 'ok'; } catch (e) { out.offlineHome = 'KO: ' + (await page.evaluate(() => (document.querySelector('#app')?.innerText || '(vuoto)').slice(0, 80))); }
  out.offlineRoutes = {};
  const allRoutes = ['calendar', 'trips', 'stats', 'more', 'needs', 'rules', 'tasks', 'requests', 'activity', 'guide', 'settings', 'settings/appearance', 'settings/notifications', 'settings/house', 'settings/data', 'settings/ai', 'settings/invite'];
  for (const r of allRoutes) {
    page.__errors = [];
    await page.evaluate((r) => { location.hash = '#/' + r; }, r); await page.waitForTimeout(500);
    const txt = await page.evaluate(() => (document.querySelector('#app main')?.innerText || '').trim());
    out.offlineRoutes[r] = /Qualcosa è andato storto|Failed to fetch dynamically|error loading/i.test(txt) || txt.length < 15 ? 'KO' : 'ok';
  }
  // sheet che caricano moduli pigri (scheda turno dalla Home)
  await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(400);
  await context.close();
}

// ---- 6) risposta al tocco (Event Timing): navigazione tra tab, apertura scheda turno, spunte ----
{
  const { context, page } = await newPage({ seed: S });
  await page.addInitScript(() => { window.__ev = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.interactionId) window.__ev.push([e.name, Math.round(e.duration), Math.round(e.processingEnd - e.processingStart)]); })).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) { /* */ } });
  await page.goto(url + '/#/'); await ready(page); await page.waitForTimeout(1200);
  const tabs = ['calendar', 'trips', 'stats', 'more', ''];
  for (let k = 0; k < 2; k++) for (const tab of tabs) { const sel = `nav a[data-tab="${tab}"]`; if (await page.$(sel)) { await page.tap(sel).catch(() => {}); await page.waitForTimeout(450); } }
  const chore = await page.$('button.chore, .chore'); if (chore) { await chore.tap().catch(() => {}); await page.waitForTimeout(900); }
  const ev = await page.evaluate(() => window.__ev);
  const durs = ev.map((e) => e[1]).sort((a, b) => a - b);
  out.inp = { interactions: ev.length, worst: durs[durs.length - 1] || 0, p75: durs[Math.floor(durs.length * 0.75)] || 0, all: ev.slice(0, 20) };
  await context.close();
}
await browser.close(); server.close();
console.log(JSON.stringify(out, null, 1));
