// E2E audit v2 (docs/ux/home-stats-weeks-v2.md): Settimane su desktop (lista + pannello), «sono via» non duplicato in Home, podio a pari merito.
// Orologio finto mer 2026-10-28. Esecuzione: node tests/e2e/home-stats-weeks-v2.e2e.mjs
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';
const ALL = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
const DONE = { '2026-10-04': ALL, '2026-10-11': ALL, '2026-10-18': ALL, '2026-10-25': ALL };
const mk = (o = {}) => seed({ weeks: DONE, ...o, houseExtra: { requireRules: false } });
const DESK = { width: 1440, height: 900 };
let env; const results = [];
async function open(s, hash, viewport) {
  const page = await env.page({ now: NOW, viewport, seed: s });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector(hash.startsWith('#/calendar') ? '.cal .week' : hash.startsWith('#/stats') ? '.stats-page' : '[data-screen="home"]');
  await page.waitForTimeout(600);
  return page;
}
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log('ok   ' + name); } catch (e) { results.push([name, false]); console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n     ')); }
}
const selDay = (page) => page.locator('.week.sel').getAttribute('data-sunday');

env = await start();

await test('Settimane desktop: prossime come righe compatte (7+ in vista), selezione evidente, niente overflow', async () => {
  const page = await open(mk({ me: 'anna', admin: true }), '#/calendar', DESK);
  assert.equal(await page.locator('.cal .week:not(.compact)').count(), 1, 'solo la corrente per esteso');
  assert.ok(await page.locator('.cal-list .week.compact').count() >= 8);
  const vis = await page.evaluate(() => [...document.querySelectorAll('.cal-list .week.compact')].filter((e) => e.getBoundingClientRect().bottom < innerHeight).length);
  assert.ok(vis >= 5, 'righe compatte visibili senza scorrere: ' + vis);
  const box = await page.evaluate(() => { const l = document.querySelector('.cal-list').getBoundingClientRect(), p = document.querySelector('.cal-panel').getBoundingClientRect(); return { l: l.width, p: p.width }; });
  assert.ok(box.p >= 440 && box.p > box.l * 0.95, 'il pannello non è più stretto della lista: ' + JSON.stringify(box));
  assert.equal(await selDay(page), '2026-11-01');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load resource/.test(e)), []);
  await page.close();
});

await test('Settimane desktop: frecce su/giù spostano selezione e fuoco senza rifare la pagina; frecce del pannello', async () => {
  const page = await open(mk({ me: 'anna', admin: true }), '#/calendar', DESK);
  await page.evaluate(() => { document.querySelector('.cal').__tag = 1; });
  await page.locator('.week.cur').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await selDay(page), '2026-11-08');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-sunday')), '2026-11-08', 'il fuoco segue la selezione');
  assert.ok((await page.locator('.cal-panel .wd-title').innerText()).includes('2–8 nov'));
  await page.keyboard.press('ArrowDown');
  assert.equal(await selDay(page), '2026-11-15');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  assert.equal(await selDay(page), '2026-11-01');
  assert.equal(await page.evaluate(() => document.querySelector('.cal').__tag), 1, 'nessun rifacimento della pagina');
  await page.click('[data-act="wk-next"]');
  assert.equal(await selDay(page), '2026-11-08');
  await page.click('[data-act="wk-prev"]'); await page.click('[data-act="wk-prev"]');
  assert.equal(await selDay(page), '2026-10-25', 'dal pannello si arriva anche alla settimana scorsa');
  assert.ok((await page.locator('.cal-panel .wd-title').innerText()).includes('19–25 ott'));
  const tap = await page.evaluate(() => [...document.querySelectorAll('.cal-step')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  assert.ok(tap.every((x) => x >= 44), 'tap target pannello ' + tap);
  await page.close();
});

await test('Settimane desktop: lo scroll del pannello resta al rifacimento (dati che cambiano)', async () => {
  const page = await open(mk({ me: 'anna', admin: true }), '#/calendar', { width: 1440, height: 520 });
  const max = await page.evaluate(() => { const p = document.querySelector('.cal-panel'); return p.scrollHeight - p.clientHeight; });
  assert.ok(max > 40, 'il pannello deve scorrere: ' + max);
  await page.evaluate(() => { document.querySelector('.cal-panel').scrollTop = 120; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__app.store.setDoc('needs', 'qq1', { text: 'latte', by: 'anna', at: new Date().toISOString() }); window.__app.rerender(); });
  await page.waitForTimeout(700);
  assert.ok(await page.evaluate(() => document.querySelector('.cal-panel').scrollTop) >= 100, 'scroll del pannello perso');
  await page.close();
});

await test('Home: «sono via» una volta sola (Hero), non anche nel riquadro Assenti', async () => {
  const page = await open(mk({ me: 'anna' }), '#/', { width: 390, height: 844 });
  assert.equal(await page.locator('.hm-heroaway').count(), 1);
  assert.equal(await page.locator('[data-widget="away"]').count(), 0, 'nessun riquadro Assenti se non c\'è nessuno via');
  assert.equal(await page.locator('[data-widget="makeups"], [data-testid="alert-makeups"]').count() <= 1, true);
  await page.close();
});

await test('Classifica: a pari merito nessun podio duplicato', async () => {
  const p = await open(mk({ me: 'anna' }), '#/stats', { width: 390, height: 844 });
  assert.equal(await p.locator('.podium').count(), 0);
  await p.close();
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
if (failed.length) process.exit(1);
