// Utility per test end-to-end con Playwright (Chromium preinstallato). Uso:
//   const { start, seed } = await import('./helpers.mjs');
//   const env = await start();                          // server statico + browser
//   const page = await env.page({ now: '2026-10-28T10:00:00', viewport: {width:390,height:844}, lang: 'it-IT', seed: seed() });
//   await page.goto(env.url + '/#/');  ... env.close()
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function start() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const contexts = [];
  return {
    url,
    async page({ now, viewport = { width: 390, height: 844 }, lang = 'it-IT', seed: s, dark = false, touch = true } = {}) {
      const context = await browser.newContext({ viewport, locale: lang, colorScheme: dark ? 'dark' : 'light', hasTouch: touch && viewport.width < 900, isMobile: touch && viewport.width < 600, serviceWorkers: 'block', deviceScaleFactor: 2 });
      contexts.push(context);
      if (s) await context.addInitScript((data) => { if (!localStorage.getItem('cp:seeded')) { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('cp:seeded', '1'); } }, s);
      const page = await context.newPage();
      page.on('pageerror', (e) => { (page.__errors ||= []).push(String(e)); });
      page.on('console', (m) => { if (m.type() === 'error') (page.__errors ||= []).push(m.text()); });
      if (now) await page.clock.install({ time: new Date(now) });
      return page;
    },
    async close() { await browser.close(); server.close(); },
  };
}

/** Dati di prova: casa locale "LOCALTEST001" con Anna (admin), Bruno, Carla; inizio 2026-10-04. `me` = id persona o null. */
export function seed({ me = 'anna', admin = true, extra = {}, houseExtra = {}, weeks = {}, trips = {}, needs = {}, members = {} } = {}) {
  const id = 'LOCALTEST001';
  const house = { id, name: 'Casa Test', startSunday: '2026-10-04', lang: 'it', tz: 'Europe/Rome', createdAt: '2026-10-01T10:00:00.000Z', adminIds: ['anna'], settings: { grace: 1, minRest: 3, startPriority: 4, window: 52, minNights: 3 }, features: {}, effort: {}, notif: {},
    roommates: [{ id: 'anna', name: 'Anna', slot: 1, from: null, to: null }, { id: 'bruno', name: 'Bruno', slot: 2, from: null, to: null }, { id: 'carla', name: 'Carla', slot: 3, from: null, to: null }],
    tasks: [{ id: 't1', chore: 'floor', text: 'Svuota il contenitore dell\'aspirapolvere', every: 2, anchor: '2026-10-04', enabled: true }, { id: 't2', chore: 'bathroom', text: 'Cambia il tappetino', every: 1, anchor: '2026-10-04', enabled: true }],
    links: { tricount: { url: 'https://tricount.com/abc', show: true }, whatsapp: { url: '', show: false }, custom: [] }, ...houseExtra };
  const state = { house, weeks, trips, needs, members, log: {}, requests: {}, views: {} };
  return { 'cp:houses': [{ id, name: house.name, mode: 'local', me, lastUsed: 1 }], 'cp:last': id, 'cp:admin': admin ? { [id]: true } : {}, [`cp:h:${id}`]: state, ...extra };
}
