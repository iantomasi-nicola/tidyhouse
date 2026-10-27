// «Non posso questa settimana»: il turno passa in automatico al sostituto equo, chi non può lo recupera dopo; Annulla ripristina.
//   node tests/e2e/cantdo.e2e.mjs
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';
const env = await start();
let fails = 0;
async function test(name, fn) { try { await fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '\n', e && e.stack || e); } }
const info = (page) => page.evaluate(() => {
  const a = window.__app; const o = a.calc.out; const row = o.rows[o.cur];
  return { sunday: row.sunday, assigned: row.assigned, subs: row.subs, next: o.rows[o.cur + 1] && { assigned: o.rows[o.cur + 1].assigned, isMakeup: o.rows[o.cur + 1].isMakeup } };
});
const openSheet = async (page, sunday, chore) => {
  await page.evaluate(async ([s, c]) => { const m = await import('/js/choresheet.js'); m.openChoreSheet(window.__app, s, c); }, [sunday, chore]);
  await page.waitForSelector('.sheet');
};

await test('Non posso: assegnazione automatica, avviso al sostituto, Annulla', async () => {
  const page = await env.page({ now: NOW, seed: seed({ admin: false, me: 'anna', houseExtra: { requireRules: false } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  let { sunday, assigned } = await info(page);
  const ci = assigned.indexOf('anna');
  if (ci < 0) { await page.evaluate((id) => window.__app.setMe(id), assigned.find(Boolean)); await page.waitForTimeout(600); }
  const who = ci >= 0 ? 'anna' : assigned.find(Boolean); const chore = ['floor', 'bathroom', 'kitchen'][assigned.indexOf(who)];
  const exp = await page.evaluate(async ([s, c]) => { const e = await import('/js/extras.js'); const row = window.__app.calc.out.rows.find((r) => r.sunday === s); return e.autoSub(row, ['floor', 'bathroom', 'kitchen'].indexOf(c)); }, [sunday, chore]);
  assert.ok(exp && exp !== who, 'esiste un sostituto automatico');
  await openSheet(page, sunday, chore);
  await page.click('[data-act=cantdo]');
  await page.waitForSelector('[data-testid=cantdo-sub]');
  assert.match(await page.locator('[data-testid=cantdo-sub]').innerText(), /fa|farà/i);
  await page.click('[data-act=cantdo-confirm]');
  await page.waitForFunction(([s, c]) => ((window.__app.state.weeks[s] || {}).agreed || {})[c], [sunday, chore]);
  const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
  assert.equal(st.weeks[sunday].agreed[chore], exp, 'accordo con il sostituto suggerito');
  assert.ok(Object.values(st.requests).some((q) => q.kind === 'notice' && q.code === 'assigned' && q.to === exp), 'avviso al sostituto');
  assert.equal(await page.evaluate(([s, c]) => window.__app.calc.out.rows.find((r) => r.sunday === s).assigned[['floor', 'bathroom', 'kitchen'].indexOf(c)], [sunday, chore]), who, 'chi non può resta l\'assegnato (il debito è suo)');
  // Annulla dal messaggio
  await page.locator('.toast-action', { hasText: 'Annulla' }).last().click();
  await page.waitForFunction(([s, c]) => !((window.__app.state.weeks[s] || {}).agreed || {})[c], [sunday, chore]);
  assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW /.test(e)), []);
});

await test('Chi non può recupera dopo: se l\'altro pulisce, nella settimana successiva ha il recupero', async () => {
  const page = await env.page({ now: NOW, seed: seed({ admin: true, me: 'anna', houseExtra: { requireRules: false } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  const { sunday, assigned } = await info(page);
  const who = assigned.find(Boolean); const ci = assigned.indexOf(who); const chore = ['floor', 'bathroom', 'kitchen'][ci];
  const sub = await page.evaluate(async ([s, c]) => { const a = window.__app; const r = await a.actions.autoCover(s, c); return r; }, [sunday, chore]);
  assert.ok(sub && sub !== who);
  // il sostituto pulisce
  await page.evaluate(([s, c, id]) => window.__app.store.setDoc('weeks', s, { result: { [c]: 'by:' + id } }), [sunday, chore, sub]);
  await page.waitForTimeout(300);
  const { next } = await info(page);
  assert.ok(next.assigned.some((id, i) => id === who && next.isMakeup[i]), 'chi non poteva ha un turno di recupero la settimana dopo');
});

await test('Nessun altro a casa: avviso chiaro, niente assegnazione', async () => {
  const page = await env.page({ now: NOW, seed: seed({ admin: false, me: 'anna', houseExtra: { requireRules: false }, weeks: {} }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  const { sunday, assigned } = await info(page);
  const who = assigned.find(Boolean); const chore = ['floor', 'bathroom', 'kitchen'][assigned.indexOf(who)];
  // tutti gli altri via questa settimana
  await page.evaluate(([s, w]) => { const others = ['anna', 'bruno', 'carla'].filter((x) => x !== w); return window.__app.store.setDoc('weeks', s, { awayMap: Object.fromEntries(others.map((x) => [x, true])) }); }, [sunday, who]);
  await page.evaluate((id) => window.__app.setMe(id), who); await page.waitForTimeout(500);
  const sig = await page.evaluate(async ([s, c]) => { const e = await import('/js/extras.js'); const row = window.__app.calc.out.rows.find((r) => r.sunday === s); return e.autoSub(row, ['floor', 'bathroom', 'kitchen'].indexOf(c)); }, [sunday, chore]);
  assert.equal(sig, '', 'nessun sostituto possibile');
});

await test('Spiegazione in app: il link dalla scheda apre «Come funziona» già espansa', async () => {
  const page = await env.page({ now: NOW, seed: seed({ admin: false, me: 'anna', houseExtra: { requireRules: false } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  const { sunday, assigned } = await info(page);
  const who = assigned.find(Boolean); if (who !== 'anna') { await page.evaluate((id) => window.__app.setMe(id), who); await page.waitForTimeout(500); }
  const chore = ['floor', 'bathroom', 'kitchen'][assigned.indexOf(who)];
  await openSheet(page, sunday, chore);
  await page.click('[data-act=cantdo]'); await page.waitForTimeout(450); await page.click('[data-act=cantdo-how]');   // (la guardia anti doppio tocco ignora due click entro 350 ms)
  await page.waitForSelector('[data-testid=howto][open]');
  const txt = await page.locator('[data-testid=howto]').innerText();
  assert.match(txt, /Non posso questa settimana/); assert.match(txt, /turno doppio/);
  assert.ok(!/howto\./.test(await page.evaluate(() => document.body.innerText)), 'nessuna chiave non tradotta');
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/howto.png' : '/tmp/howto.png' });
  const en = await env.page({ now: NOW, lang: 'en-US', dark: true, seed: seed({ admin: false, me: 'anna', houseExtra: { lang: 'en', requireRules: false } }) });
  await en.goto(env.url + '/#/rules'); await en.waitForSelector('[data-testid=howto]'); await en.click('[data-testid=howto] summary');
  assert.match(await en.locator('[data-testid=howto]').innerText(), /I can't this week/);
  assert.ok(!(await en.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'nessun overflow');
});

await env.close();
if (fails) { console.log(fails + ' falliti'); process.exit(1); }
console.log('OK');
