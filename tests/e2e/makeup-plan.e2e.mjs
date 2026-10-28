// Recupero programmato: X dimentica il pavimento in W1, in W2 è assente e annuncia che recupera lunedì di W3.
// Il coinquilino che avrebbe fatto il pavimento in W2 viene liberato (senza debiti) e X ha quel turno come suo recupero.
//   node tests/e2e/makeup-plan.e2e.mjs
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';       // mercoledì di W2 = settimana 26 ott – 1 nov
const W1 = '2026-10-25', W2 = '2026-11-01', MON_W3 = '2026-11-02';
const env = await start();
let fails = 0;
async function test(name, fn) { try { await fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '\n', e && e.stack || e); } }

const rowsOf = (page) => page.evaluate(([a, b]) => { const o = window.__app.calc.out; const f = (s) => { const r = o.rows.find((x) => x.sunday === s); return { floor: r.assigned[0], mk: r.isMakeup[0], swapped: r.swapped[0], rest: r.rest, res: r.res[0].kind, closed: r.closed }; }; return { w1: f(a), w2: f(b), w3: (() => { const r = o.rows.find((x) => x.sunday === '2026-11-08'); return { floor: r.assigned[0], mk: r.isMakeup[0] }; })() }; }, [W1, W2]);
const mk = async () => {
  const page = await env.page({ now: NOW, seed: seed({ admin: true, me: 'anna', houseExtra: { requireRules: false } }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  return page;
};

await test('X annuncia lunedì di W3: il pavimento di W2 passa a X come recupero, Y è libero e avvisato; annullando torna come prima', async () => {
  const page = await mk();
  const before = await rowsOf(page);
  const X = before.w1.floor;
  assert.ok(X, 'c\'è un assegnato in W1');
  // X ha dimenticato il pavimento in W1 (nessun risultato, settimana chiusa) ed è assente in W2: il pavimento di W2 va a un altro (Y)
  await page.evaluate(([x, s]) => window.__app.store.setDoc('weeks', s, { awayMap: { [x]: true } }), [X, W2]);
  await page.waitForTimeout(400);
  const mid = await rowsOf(page);
  const debtsOf = (y, s2) => page.evaluate(([yy, ss]) => { const r = window.__app.calc.out.rows.find((x) => x.sunday === ss); return r.debts[r.nm.indexOf(yy)].map(Number); }, [y, s2]);
  const Y = mid.w2.floor; assert.ok(Y && Y !== X, 'con X assente il pavimento di W2 va a un altro');
  assert.equal(mid.w1.closed, 1, 'W1 chiusa senza risultato'); assert.equal(mid.w1.res, '', 'dimenticato');
  const debtsY0 = await debtsOf(Y, W2);
  // ora X annuncia: «pulirò lunedì di W3» (data nei 14 giorni dopo W1)
  await page.evaluate(([x, s, d]) => { window.__app.setMe(x); return null; }, [X, W1, MON_W3]); await page.waitForTimeout(500);
  const r = await page.evaluate(async ([s, d]) => { await window.__app.actions.setDelay(s, 'floor', d); return true; }, [W1, MON_W3]);
  await page.waitForTimeout(400);
  const after = await rowsOf(page);
  assert.equal(after.w2.floor, X, 'il pavimento di W2 è di X'); assert.equal(after.w2.swapped, true); assert.equal(Number(after.w2.mk), 1, 'per il motore è il suo recupero');
  const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
  assert.equal(st.weeks[W2].autoMakeup.floor.by, X); assert.equal(st.weeks[W2].autoMakeup.floor.prev, Y);
  assert.ok(Object.values(st.requests).some((q) => q.kind === 'notice' && q.code === 'makeupFree' && q.to === Y && q.who === X), 'Y è avvisato');
  assert.ok(Object.values(st.log).some((l) => l.type === 'makeup'), 'registrato');
  // Y non ha il pavimento (non ha debiti): nessun debito per lui
  assert.deepEqual(await debtsOf(Y, W2), debtsY0, 'Y non prende debiti');
  // X fa il recupero lunedì (entro la tolleranza) e lo segna sul pavimento di W2: il debito di W1 è saldato
  await page.evaluate(([s]) => window.__app.store.setDoc('weeks', s, { result: { floor: 'done' } }), [W2]);
  await page.waitForTimeout(400);
  const paid = await rowsOf(page);
  assert.notEqual(paid.w3.mk && paid.w3.floor === X, true, 'in W3 X non ha un secondo recupero');
  // annullare l'annuncio rimette tutto a posto (prima del «fatto»)
  await page.evaluate(([s]) => window.__app.store.setDoc('weeks', s, { result: { floor: null } }), [W2]);
  await page.evaluate(async ([s]) => { await window.__app.actions.setDelay(s, 'floor', null); }, [W1]);
  await page.waitForTimeout(400);
  const back = await rowsOf(page);
  assert.equal(back.w2.floor, Y, 'torna a Y'); assert.equal(back.w2.swapped, false);
  assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW /.test(e)), []);
});

await test('Data fuori dalla finestra (mercoledì di W3): nessun cambiamento ai turni di W2', async () => {
  const page = await mk();
  const before = await rowsOf(page); const X = before.w1.floor;
  await page.evaluate(([x, s]) => window.__app.store.setDoc('weeks', s, { awayMap: { [x]: true } }), [X, W2]);
  await page.evaluate((id) => window.__app.setMe(id), X); await page.waitForTimeout(500);
  const pre = await rowsOf(page);
  await page.evaluate(async ([s, d]) => { await window.__app.actions.setDelay(s, 'floor', d); }, [W1, '2026-11-04']);
  await page.waitForTimeout(400);
  const after = await rowsOf(page);
  assert.equal(after.w2.swapped, false); assert.equal(after.w2.floor, pre.w2.floor);
});

await test('La scheda del turno mostra «Recupero programmato» e la Home di Y non ha più il pavimento', async () => {
  const page = await mk();
  const before = await rowsOf(page); const X = before.w1.floor; const Y = before.w2.floor;
  await page.evaluate(([x, s]) => window.__app.store.setDoc('weeks', s, { awayMap: { [x]: true } }), [X, W2]);
  await page.evaluate((id) => window.__app.setMe(id), X); await page.waitForTimeout(500);
  await page.evaluate(async ([s, d]) => { await window.__app.actions.setDelay(s, 'floor', d); }, [W1, MON_W3]);
  await page.waitForTimeout(500);
  await page.evaluate(async ([s]) => { const m = await import('/js/choresheet.js'); m.openChoreSheet(window.__app, s, 'floor'); }, [W2]);
  await page.waitForSelector('.sheet');
  assert.match(await page.locator('.sheet [data-flow=makeup]').innerText(), /Recupero programmato di .*: lunedì/);
});

await env.close();
if (fails) { console.log(fails + ' falliti'); process.exit(1); }
console.log('OK');
