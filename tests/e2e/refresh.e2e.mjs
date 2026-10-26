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
// nuova versione: il tasto si espande in "Aggiorna" col colore accento
for (const dark of [false, true]) {
  const page = await env.page({ now: '2026-10-28T10:00:00', dark, seed: seed({ houseExtra: { requireRules: false, accent: '#00796b' } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-testid=home-refresh]');
  ok(await page.getAttribute('[data-testid=home-refresh]', 'data-update') === null, 'senza aggiornamento: tasto normale');
  const w0 = (await page.locator('[data-testid=home-refresh]').boundingBox()).width;
  await page.evaluate(() => window.__app.markUpdateReady()); await page.waitForSelector('[data-testid=home-refresh][data-update="1"]'); await page.waitForTimeout(700);
  const b = page.locator('[data-testid=home-refresh]'); const box = await b.boundingBox();
  ok(box.width > w0 + 40 && box.height >= 44, `si espande (${Math.round(w0)} → ${Math.round(box.width)} px)`);
  ok((await b.innerText()).trim() === 'Aggiorna', 'etichetta "Aggiorna"');
  const bg = await b.evaluate((el) => getComputedStyle(el).backgroundColor); ok(bg === 'rgb(0, 121, 107)', 'colore accento della casa: ' + bg);
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'nessun overflow');
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 8000 }).then(() => true).catch(() => false);
  await b.click(); ok(await nav, 'il tocco applica l\'aggiornamento (ricarica)');
  ok(!(page.__errors || []).filter((e) => !/Failed to load resource/.test(e)).length, 'nessun errore in console');
}
await env.close(); console.log(bad ? bad + ' PROBLEMI' : 'OK refresh'); process.exit(bad ? 1 : 0);
