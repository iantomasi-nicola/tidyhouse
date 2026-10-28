// Motivo della sostituzione: si scrive in «Non posso questa settimana» e «Chiedi a una persona», lo vedono tutti.
//   node tests/e2e/reason.e2e.mjs
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';
const CH = ['floor', 'bathroom', 'kitchen'];
const env = await start();
let fails = 0;
async function test(name, fn) { try { await fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '\n', e && e.stack || e); } }
const info = (page) => page.evaluate(() => { const o = window.__app.calc.out; const r = o.rows[o.cur]; return { sunday: r.sunday, assigned: r.assigned }; });
const openSheet = async (page, sunday, chore) => { await page.evaluate(async ([s, c]) => { const m = await import('/js/choresheet.js'); m.openChoreSheet(window.__app, s, c); }, [sunday, chore]); await page.waitForSelector('.sheet'); };
const mk = async (me = 'anna', extra = {}) => {
  const page = await env.page({ now: NOW, seed: seed({ admin: false, me, houseExtra: { requireRules: false }, ...extra }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  return page;
};

await test('Non posso + motivo: salvato, avviso al sostituto con il motivo, visibile agli altri', async () => {
  const page = await mk();
  const { sunday, assigned } = await info(page);
  const who = assigned.find(Boolean); if (who !== 'anna') { await page.evaluate((id) => window.__app.setMe(id), who); await page.waitForTimeout(500); }
  const chore = CH[assigned.indexOf(who)];
  await openSheet(page, sunday, chore);
  await page.click('[data-act=cantdo]'); await page.waitForSelector('[data-testid=reason-input]');
  await page.waitForTimeout(450);
  await page.fill('[data-testid=reason-input]', '  va a ballare\nin discoteca ');
  await page.waitForTimeout(450);
  await page.click('[data-act=cantdo-confirm]');
  await page.waitForFunction(([s, c]) => (((window.__app.state.weeks[s] || {}).agreedNote || {})[c] || {}).text, [sunday, chore]);
  const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
  assert.equal(st.weeks[sunday].agreedNote[chore].text, 'va a ballare in discoteca', 'ripulito (una riga)');
  assert.ok(Object.values(st.requests).some((q) => q.kind === 'notice' && q.code === 'assigned' && q.note === 'va a ballare in discoteca'), 'il sostituto riceve il motivo');
  // un altro coinquilino lo vede nella scheda della mansione
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== who);
  await page.evaluate((id) => window.__app.setMe(id), other); await page.waitForTimeout(600);
  await openSheet(page, sunday, chore);
  assert.match(await page.locator('[data-testid=chore-note]').innerText(), /Motivo: va a ballare in discoteca/);
  assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW /.test(e)), []);
});

await test('Chiedi a una persona + motivo: la richiesta lo porta, lo vede chi risponde (Home e Altro → Richieste)', async () => {
  const page = await mk();
  const { sunday, assigned } = await info(page);
  const who = assigned.find(Boolean); if (who !== 'anna') { await page.evaluate((id) => window.__app.setMe(id), who); await page.waitForTimeout(500); }
  const ci = assigned.indexOf(who); const chore = CH[ci];
  await openSheet(page, sunday, chore);
  await page.click('[data-act=ask]'); await page.waitForSelector('[data-testid=reason-input]'); await page.waitForTimeout(450);
  await page.click('[data-reason=exam]'); await page.waitForTimeout(450);
  assert.equal(await page.inputValue('[data-testid=reason-input]'), 'Esame');
  await page.fill('[data-testid=reason-input]', 'Esame di analisi'); await page.waitForTimeout(450);
  await page.click('[data-act=ask-send]');
  await page.waitForFunction(() => Object.values(window.__app.state.requests).some((q) => q.kind === 'cover' && q.note));
  const q = await page.evaluate(() => Object.values(window.__app.state.requests).find((r) => r.kind === 'cover'));
  assert.equal(q.note, 'Esame di analisi');
  // chi risponde
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== who);
  await page.evaluate((id) => window.__app.setMe(id), other); await page.waitForTimeout(700);
  assert.match(await page.locator('[data-widget=alerts] [data-testid=req-note]').first().innerText(), /Motivo: Esame di analisi/);
  await page.evaluate(() => { location.hash = '#/requests'; }); await page.waitForTimeout(800);
  assert.match(await page.locator('[data-testid=req-note]').first().innerText(), /Motivo: Esame di analisi/);
  // lunghezza massima
  await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(500);
});

await test('Motivo troppo lungo: 80 caratteri; EN; nessun overflow a 320', async () => {
  const page = await env.page({ now: NOW, lang: 'en-US', dark: true, viewport: { width: 320, height: 640 }, seed: seed({ admin: false, me: 'anna', houseExtra: { requireRules: false, lang: 'en' } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  const { sunday, assigned } = await info(page);
  const who = assigned.find(Boolean); if (who !== 'anna') { await page.evaluate((id) => window.__app.setMe(id), who); await page.waitForTimeout(500); }
  await openSheet(page, sunday, CH[assigned.indexOf(who)]);
  await page.click('[data-act=cantdo]'); await page.waitForSelector('[data-testid=reason-input]');
  assert.equal(await page.getAttribute('[data-testid=reason-input]', 'maxlength'), '80');
  assert.match(await page.locator('.sheet').innerText(), /Reason \(optional, everyone sees it\)/);
  assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'nessun overflow');
  const boxes = await page.locator('.fl-reason-chip').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(boxes.length === 5 && boxes.every((h) => h >= 44), 'chip ≥ 44px');
});

await env.close();
if (fails) { console.log(fails + ' falliti'); process.exit(1); }
console.log('OK');
