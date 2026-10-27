// E2E dell'audit di usabilita' UX-A (Home, Settimane, Assenze, Classifica + fogli collegati): node tests/e2e/ux-a.e2e.mjs
// Ogni test riproduce un difetto trovato dall'audit (docs/ux/home-calendar-trips-stats.md) e prima della correzione FALLIVA.
// Orologio finto: mercoledi' 2026-10-28 10:00 (settimana corrente = quella che chiude 2026-11-01). Screenshot in SHOTS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, seed } from './helpers.mjs';
import { compute } from '../../js/engine.js';
import { engineHouse } from '../../js/store.js';
import { swapPatch } from '../../js/extras.js';

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-tidyhouse/c243bc09-3166-5024-8c63-241289e91a58/scratchpad/ux/shots/';
fs.mkdirSync(SHOTS, { recursive: true });
const NOW = '2026-10-28T10:00:00', TODAY = '2026-10-28', CUR = '2026-11-01', PREV = '2026-10-25';
const MOBILE = { width: 390, height: 844 }, SMALL = { width: 320, height: 640 }, TABLET = { width: 820, height: 1180 }, DESKTOP = { width: 1440, height: 900 };
const ALL = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
const DONE3 = { '2026-10-04': ALL, '2026-10-11': ALL, '2026-10-18': ALL };      // la settimana scorsa resta da registrare
const DONE = { ...DONE3, [PREV]: ALL };
const DARIO = { id: 'dario', name: 'Dario', slot: 4, from: null, to: null };
const mk = (o = {}) => seed({ weeks: DONE, ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });
const withDario = { roommates: [...seed()['cp:h:LOCALTEST001'].house.roommates, DARIO] };

/** Chi ha quale turno (dal motore sui dati seed): stesso calcolo dell'app. */
const whoAt = (s, off = 0) => { const o = compute(engineHouse(s['cp:h:LOCALTEST001']), TODAY, 3); const r = o.rows[o.cur + off]; return { sunday: r.sunday, floor: r.assigned[0], bathroom: r.assigned[1], kitchen: r.assigned[2], row: r }; };
const P = whoAt(mk());
const F = P.floor, B = P.bathroom, K = P.kitchen;
assert.ok(F && B && K && new Set([F, B, K]).size === 3, 'tre persone con tre turni');
const P3 = whoAt(mk({ weeks: DONE3 }), -1);              // settimana scorsa (non registrata)

let env; const results = [];
async function open({ s, viewport = MOBILE, dark = false, lang = 'it-IT', hash = '#/', fs: textSize = 1 } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: s });
  await page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* ignore */ } });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector(hash.startsWith('#/calendar') ? '.cal .week' : hash.startsWith('#/trips') ? '.trips-page' : hash.startsWith('#/stats') ? '.stats-page' : '[data-screen="home"]', { timeout: 8000 });
  if (textSize !== 1) await page.evaluate((f) => window.__app.savePrefs({ textSize: f }), textSize);
  await page.waitForTimeout(600);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(500); return page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const noOverflow = async (page, label = '') => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#layer .sheet .body')].every((b) => b.scrollWidth <= b.clientWidth + 1)), 'overflow orizzontale ' + label);
const noErrors = (page) => assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load resource/.test(e)), [], 'errori in console');
const wk = (page, s = CUR) => page.evaluate((sun) => JSON.parse(JSON.stringify(window.__app.state.weeks[sun] || {})), s);
const reqs = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state.requests || {})));
const trips_ = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state.trips || {})));
const sheets = (page) => page.locator('#layer .sheet').count();
const closeSheets = async (page) => { for (let i = 0; i < 4 && (await sheets(page)); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(480); } };
const waitSheet = async (page) => { await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450); };
const openChore = async (page, chore, sunday = CUR) => { await page.evaluate(([s, c]) => import('/js/choresheet.js').then((m) => m.openChoreSheet(window.__app, s, c)), [sunday, chore]); await waitSheet(page); };
async function as(page, id, admin = false) {
  await closeSheets(page);
  await page.evaluate(([i, a]) => { window.__app.setMe(i); if (!a) window.__app.lockAdmin(); }, [id, admin]);
  await page.waitForTimeout(700);
}
/** Contatore di tocchi: ogni tap() dell'utente simulato conta 1 (l'obiettivo dell'audit e' <= 2 per le azioni frequenti). */
function tapper(page) { const t = { n: 0 }; t.tap = async (sel, opts) => { t.n++; await page.click(sel, opts); await page.waitForTimeout(420); }; return t; }
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log('ok   ' + name); } catch (e) { results.push([name, false]); console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 5).join('\n     ')); }
}

const run = async () => {
  env = await start();

  // ===== F1: «Annulla scambio» deve annullare SOLO lo scambio scelto =====
  await test('F1 annulla scambio: toglie solo quello scelto (non tutti)', async () => {
    const s0 = mk({ houseExtra: withDario });
    const r0 = whoAt(s0).row;
    // scambio 1: Pavimenti <-> Bagno ; scambio 2: Dario prende Cucina da chi ce l'ha
    const a = swapPatch(r0, { chore: 'floor', personId: r0.assigned[0] }, { chore: 'bathroom', personId: r0.assigned[1] });
    const ruledKitchen = r0.assigned[2];
    const dario = r0.assigned.includes('dario') ? null : 'dario';
    assert.ok(dario, 'dario deve essere a riposo per questo scenario (' + JSON.stringify(r0.assigned) + ')');
    const s = mk({ me: 'anna', admin: true, houseExtra: withDario, weeks: { ...DONE, [CUR]: { swap: { ...a, kitchen: 'dario' } } } });
    const page = await open({ s });
    const before = await wk(page); assert.deepEqual(Object.keys(before.swap).sort(), ['bathroom', 'floor', 'kitchen']);
    await openChore(page, 'floor');
    await page.click('[data-act="swap-cancel"]'); await page.waitForTimeout(700);
    const after = await wk(page);
    assert.deepEqual(after.swap || {}, { kitchen: 'dario' }, 'deve restare lo scambio della cucina: ' + JSON.stringify(after.swap));
    assert.ok(ruledKitchen);
    noErrors(page); await page.close();
  });

  await test('F1b annulla scambio dal dettaglio settimana: solo quello scelto', async () => {
    const s0 = mk({ houseExtra: withDario });
    const r0 = whoAt(s0).row;
    const a = swapPatch(r0, { chore: 'floor', personId: r0.assigned[0] }, { chore: 'bathroom', personId: r0.assigned[1] });
    const s = mk({ me: 'anna', admin: true, houseExtra: withDario, weeks: { ...DONE, [CUR]: { swap: { ...a, kitchen: 'dario' } } } });
    const page = await open({ s });
    await page.evaluate((c) => import('/js/choresheet.js').then((m) => m.openWeekSheet(window.__app, c)), CUR); await waitSheet(page);
    // un annulla per ogni scambio, non uno solo per tutta la settimana
    assert.equal(await page.locator('[data-act="swap-cancel-week"]').count(), 2, 'due scambi, due pulsanti');
    await page.locator('[data-act="swap-cancel-week"]').first().click(); await page.waitForTimeout(700);
    const after = await wk(page);
    assert.equal(Object.keys(after.swap || {}).length, 1, 'ne resta uno: ' + JSON.stringify(after.swap));
    await page.close();
  });

  // ===== F2: «Ha pulito un altro» propone anche chi e' assente questa settimana =====
  await test('F2 "ha pulito un altro" include anche gli assenti (non solo i presenti)', async () => {
    const s0 = mk({ houseExtra: withDario, weeks: { ...DONE, [CUR]: { awayMap: { dario: true } } } });
    const r0 = whoAt(s0);
    assert.ok(r0.row.away.includes('dario'), 'dario assente');
    const s = mk({ me: 'anna', admin: true, houseExtra: withDario, weeks: { ...DONE, [CUR]: { awayMap: { dario: true } } } });
    const page = await open({ s });
    await openChore(page, 'floor');
    await page.click('[data-act="cover"]'); await page.waitForTimeout(450);
    assert.equal(await page.locator('#layer .sheet [data-who="dario"]').count(), 1, 'Dario (assente) e\' nell\'elenco');
    assert.match(await page.locator('#layer .sheet [data-who="dario"]').innerText(), /Assent/);
    await page.click('#layer .sheet [data-who="dario"]'); await page.click('[data-choice="all"]'); await page.waitForTimeout(700);
    assert.equal((await wk(page)).result.floor, 'by:dario');
    noErrors(page); await page.close();
  });

  // ===== F3: l'admin che assegna un turno sceglie «con recupero» o «regalo» =====
  await test('F3 assegna (admin): scelta recupero/regalo come nelle altre richieste', async () => {
    const s = mk({ me: 'anna', admin: true });
    const page = await open({ s });
    const sub = (await wk(page)).agreed;
    assert.ok(!sub);
    await openChore(page, 'floor');
    await page.click('[data-act="assign"]'); await page.waitForTimeout(500);
    assert.equal(await page.locator('#layer .sheet [data-terms="repay"]').count(), 1, 'scheda con recupero');
    assert.equal(await page.locator('#layer .sheet [data-terms="gift"]').count(), 1, 'scheda regalo');
    assert.equal(await page.locator('#layer .sheet [data-terms="repay"]').getAttribute('aria-pressed'), 'true', 'predefinito: con recupero');
    const other = [F === 'anna' ? 'bruno' : 'anna'][0] === F ? 'carla' : (F === 'anna' ? 'bruno' : 'anna');
    // regalo -> concordato + il turno passa a chi lo fa (nessun debito)
    await page.click('#layer .sheet [data-terms="gift"]'); await page.waitForTimeout(300);
    await page.click(`#layer .sheet .cs-pick[data-who="${other}"]`); await page.waitForTimeout(800);
    let w = await wk(page);
    assert.equal(w.agreed.floor, other); assert.equal((w.swap || {}).floor, other, 'regalo: scambio concordato');
    // con recupero (predefinito) su un altro turno -> solo concordato
    await closeSheets(page);
    await openChore(page, 'bathroom');
    await page.click('[data-act="assign"]'); await page.waitForTimeout(500);
    const who2 = B === 'anna' ? 'carla' : 'anna';
    await page.click(`#layer .sheet .cs-pick[data-who="${who2}"]`); await page.waitForTimeout(800);
    w = await wk(page);
    assert.equal(w.agreed.bathroom, who2); assert.ok(!(w.swap || {}).bathroom, 'con recupero: nessuno swap');
    noErrors(page); await page.close();
  });

  // ===== F4/F5: dalla Home, le azioni frequenti in <= 2 tocchi =====
  await test('F4 ritardo: «Ha pulito qualcun altro» apre subito l\'elenco delle persone (2 tocchi)', async () => {
    const s = mk({ me: P3.floor, admin: false, weeks: DONE3 });
    const page = await open({ s });
    await page.waitForSelector('[data-testid="hero-late"]');
    const tp = tapper(page);
    await tp.tap('[data-testid="hero-late"] [data-act="hero-cover"]');
    await page.waitForSelector('#layer .sheet [data-who]', { timeout: 3000 });
    const who = await page.locator('#layer .sheet [data-who]').first().getAttribute('data-who');
    await tp.tap(`#layer .sheet [data-who="${who}"]`);
    await page.waitForTimeout(500);
    const w = await wk(page, PREV);
    assert.ok(Object.values(w.result || {}).some((v) => v === 'by:' + who), 'segnato come pulito da ' + who + ': ' + JSON.stringify(w.result));
    assert.ok(tp.n <= 2, 'tocchi: ' + tp.n);
    noErrors(page); await page.close();
  });

  await test('F5 «Non posso questa settimana» dalla Home: 2 tocchi (prima 3)', async () => {
    const s = mk({ me: F, admin: false });
    const page = await open({ s });
    await page.waitForSelector('[data-testid="hero-todo"]');
    const tp = tapper(page);
    await tp.tap('[data-testid="hero-todo"] [data-act="hero-cantdo"]');
    await page.waitForSelector('#layer .sheet [data-act="cantdo-confirm"]', { timeout: 3000 });
    await tp.tap('#layer .sheet [data-act="cantdo-confirm"]');
    await page.waitForTimeout(600);
    const w = await wk(page);
    assert.ok(w.agreed && w.agreed.floor && w.agreed.floor !== F, 'sostituto assegnato: ' + JSON.stringify(w.agreed));
    assert.ok(tp.n <= 2, 'tocchi: ' + tp.n);
    noErrors(page); await page.close();
  });

  // ===== B2: tap target dei giorni (Home), elimina assenza con Annulla =====
  await test('B2 giorni della Home: tocco >= 44px a 390 (a 320 su due righe, mai piu\' piccoli)', async () => {
    for (const vp of [MOBILE, SMALL]) {
      const page = await open({ s: mk({ me: F, admin: false }), viewport: vp, fs: vp === SMALL ? 1.3 : 1 });
      await page.waitForSelector('[data-testid="plan-tip"] .daychips button');
      const boxes = await page.$$eval('[data-testid="plan-tip"] .daychips button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      assert.equal(boxes.length, 7);
      for (const [w, h] of boxes) assert.ok(w >= 44 && h >= 44, `${vp.width}px: bottone ${w}x${h}`);
      await noOverflow(page, 'giorni ' + vp.width); await page.close();
    }
  });

  await test('B2 elimina assenza: 1 tocco, niente conferma, Annulla la ripristina', async () => {
    const trips = { t1: { personId: 'bruno', from: '2026-11-05', to: '2026-11-09', note: 'Weekend', by: 'bruno', at: '2026-10-20T10:00:00Z' } };
    const page = await open({ s: mk({ me: 'bruno', admin: false, trips }), hash: '#/trips' });
    const tp = tapper(page);
    await tp.tap('[data-trip="t1"] .trip-del');
    assert.equal(await sheets(page), 0, 'nessun dialogo di conferma');
    assert.equal(Object.keys(await trips_(page)).length, 0, 'eliminata subito');
    await tp.tap('.toast-action');
    await page.waitForTimeout(500);
    const back = Object.values(await trips_(page));
    assert.equal(back.length, 1, 'ripristinata'); assert.equal(back[0].from, '2026-11-05'); assert.equal(back[0].note, 'Weekend');
    assert.equal(tp.n, 2);
    noErrors(page); await page.close();
  });

  // ===== B3: scheda turno a testo grande, ritardo a 2 tocchi =====
  await test('B3 scheda turno: giorni >= 44px e nessun overflow (390, 320 a testo 130%)', async () => {
    for (const [vp, f] of [[MOBILE, 1], [MOBILE, 1.3], [SMALL, 1.3]]) {
      const page = await open({ s: mk({ me: F, admin: false }), viewport: vp, fs: f });
      await openChore(page, 'floor');
      const boxes = await page.$$eval('#layer .sheet .cs-sec .daychips button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      assert.equal(boxes.length, 7);
      for (const [w, h] of boxes) assert.ok(w >= 44 && h >= 44, `${vp.width}@${f}: ${w}x${h}`);
      await noOverflow(page, `scheda ${vp.width}@${f}`);
      await page.close();
    }
  });

  await test('B3 ritardo annunciato dalla Home: 2 tocchi (prima 4), Annulla lo toglie', async () => {
    const s = mk({ me: P3.floor, admin: false, weeks: DONE3 });
    const page = await open({ s });
    await page.waitForSelector('[data-testid="hero-late"]');
    const tp = tapper(page);
    await tp.tap('[data-testid="hero-late"] [data-act="hero-delay"]');
    await page.waitForSelector('#layer .sheet .fl-days');
    await tp.tap('#layer .sheet [data-day="2026-10-30"]');
    await page.waitForTimeout(500);
    assert.equal((await wk(page, PREV)).delay.floor, '2026-10-30');
    assert.equal(await sheets(page), 0, 'il foglio si chiude');
    assert.ok(tp.n <= 2, 'tocchi: ' + tp.n);
    await page.click('.toast-action'); await page.waitForTimeout(500);
    assert.ok(!((await wk(page, PREV)).delay || {}).floor, 'annullato');
    noErrors(page); await page.close();
  });

  await env.close();
  const bad = results.filter((r) => !r[1]);
  console.log(`\n${results.length - bad.length}/${results.length} ok`);
  if (bad.length) process.exit(1);
};
run().catch((e) => { console.error(e); process.exit(1); });
