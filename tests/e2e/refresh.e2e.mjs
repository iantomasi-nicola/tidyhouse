// Il tasto aggiorna nella Home ricarica l'app, mantiene casa e identità, e non produce errori.
import { start, seed } from './helpers.mjs';
const env = await start(); let bad = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
for (const [vp, dark] of [[{ width: 390, height: 844 }, false], [{ width: 1440, height: 900 }, true]]) {
  const page = await env.page({ now: '2026-10-28T10:00:00', viewport: vp, dark, seed: seed({ houseExtra: { requireRules: false } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-testid=home-refresh]');
  const box = await page.locator('[data-testid=home-refresh]').boundingBox();
  ok(box.width >= 44 && box.height >= 44, `area di tocco ${vp.width}px: ${Math.round(box.width)}x${Math.round(box.height)}`);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'nessun overflow orizzontale');
  ok(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hm-title')).paddingRight) >= 44), 'il titolo lascia spazio al pulsante');
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 8000 }).then(() => true).catch(() => false);
  await page.click('[data-testid=home-refresh]'); ok(await nav, 'la pagina si ricarica');
  await page.waitForSelector('[data-testid=home-refresh]'); ok(await page.evaluate(() => !!window.__app.me && window.__app.houseId === 'LOCALTEST001'), 'casa e identità restano dopo il ricaricamento');
  ok(!(page.__errors || []).filter((e) => !/Failed to load resource/.test(e)).length, 'nessun errore in console');
}
await env.close(); console.log(bad ? bad + ' PROBLEMI' : 'OK refresh'); process.exit(bad ? 1 : 0);
