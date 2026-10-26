// E2E schermate "Assenze e viaggi" e "Classifica e statistiche".
// Uso: node tests/e2e/trips-stats.e2e.mjs   (variabile SHOTS = cartella screenshot)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start, seed } from './helpers.mjs';
import { compute, addDays, dayNum, CHORES, awayFromTrips, weekEnd } from '../../js/engine.js';

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/trips-stats/';
fs.mkdirSync(SHOTS, { recursive: true });
const NOW = '2026-10-28T10:00:00';
const TODAY = '2026-10-28';
const START = '2026-06-07';
const HOUSE = { requireRules: false, startSunday: START };

/** Storico deterministico: ~21 settimane chiuse con fatti / saltati / coperti, calcolato dal motore. */
function history({ skipEvery = 11, coverEvery = 7 } = {}) {
  const house = { startSunday: START, settings: { grace: 1, minRest: 3, startPriority: 4, window: 52, minNights: 3 }, trips: [], weeks: {},
    roommates: [{ id: 'anna', name: 'Anna', slot: 1 }, { id: 'bruno', name: 'Bruno', slot: 2 }, { id: 'carla', name: 'Carla', slot: 3 }] };
  const weeks = {}; let k = 0;
  const n = Math.floor((dayNum(TODAY) - dayNum(START) - 2) / 7);
  for (let i = 0; i < n; i++) {
    const r = compute({ ...house, weeks }, TODAY, 2).rows[i];
    const wk = { result: {}, resultAt: {}, resultBy: {} };
    CHORES.forEach((c, ci) => {
      const a = r.assigned[ci]; if (!a) return; k++;
      let v = 'done';
      if (k % skipEvery === 0) v = 'skipped';
      else if (k % coverEvery === 0) { const o = r.nm.filter((x) => x && x !== a)[0]; if (o) v = 'by:' + o; }
      wk.result[c] = v; wk.resultAt[c] = addDays(r.sunday, k % 3 === 0 ? 1 : 0) + 'T18:00:00.000Z'; wk.resultBy[c] = a;
    });
    if (i === 5) wk.awayMap = { carla: true };
    weeks[r.sunday] = wk;
  }
  return weeks;
}
const WEEKS = history();
const TRIPS = {
  a: { personId: 'anna', from: '2026-10-26', to: '2026-10-30', note: 'Esame a Bologna', by: 'anna', at: 'x' },
  b: { personId: 'bruno', from: '2026-11-06', to: '2026-11-09', note: 'Weekend a casa', by: 'bruno', at: 'x' },
  c: { personId: 'carla', from: '2026-12-18', to: null, note: 'Erasmus', by: 'carla', at: 'x' },
  d: { personId: 'anna', from: '2026-10-09', to: '2026-10-12', note: null, by: 'anna', at: 'x' },
  e: { personId: 'bruno', from: '2026-11-12', to: '2026-11-25', note: 'Tirocinio', by: 'bruno', at: 'x' },
};

// ---------------------------------------------------------------- mini runner
const env = await start();
const results = []; let failed = 0;
async function step(name, fn) {
  try { await fn(); results.push(['ok', name]); console.log('  ok   ' + name); }
  catch (e) { failed++; results.push(['FAIL', name]); console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
const mk = async ({ vp = { width: 390, height: 844 }, lang = 'it-IT', dark = false, prefs, houseExtra = {}, sd = {}, hash = '#/trips' } = {}) => {
  const page = await env.page({ now: NOW, viewport: vp, lang, dark, seed: seed({ houseExtra: { ...HOUSE, ...houseExtra }, ...sd, extra: prefs ? { 'cp:prefs': prefs } : {} }) });
  page.__404 = [];
  page.on('response', (r) => { if (r.status() === 404) page.__404.push(r.url()); });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector('.main h1.title', { timeout: 8000 });
  await page.waitForTimeout(250);
  return page;
};
const noErrors = (page) => {
  const errs = (page.__errors || []).filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(errs, [], 'errori in console');
  assert.deepEqual(page.__404.filter((u) => /trips|stats/.test(u)), [], '404 su file del modulo');
};
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'overflow orizzontale');
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ trips: window.__app.state.trips, weeks: window.__app.state.weeks })));
const shot = (page, name, full = true) => page.screenshot({ path: SHOTS + name + '.png', fullPage: full });
const text = (page, sel) => page.locator(sel).first().innerText();
const sheetGone = (page) => page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 3000 });
const openSheet = async (page) => { await page.click('.trips-cta .btn'); await page.waitForSelector('.sheet.on .trip-form'); await page.waitForTimeout(450); };

// ================================================================ VIAGGI
console.log('Assenze e viaggi');
await step('pagina: sezioni, card, note, chip, settimane, nessun overflow (mobile, admin)', async () => {
  const page = await mk({ sd: { trips: TRIPS } });
  assert.match(await text(page, '.note'), /3 notti/);
  assert.equal(await page.locator('#sec-now ~ div .trip').count(), 1);
  assert.equal(await page.locator('#sec-upcoming ~ div .trip').count(), 3);
  assert.equal(await page.locator('#sec-past ~ div .trip').count(), 1);
  const carla = page.locator('.trip[data-trip="c"]');
  assert.match(await carla.innerText(), /Fino a nuovo avviso/);
  assert.match(await carla.innerText(), /dal 18 dic, rientro da definire/);
  assert.match(await page.locator('.trip[data-trip="a"]').innerText(), /dal 26 ott al 30 ott/);
  assert.match(await page.locator('.trip[data-trip="a"]').innerText(), /4 notti fuori/);
  assert.match(await page.locator('.trip[data-trip="b"]').innerText(), /3 notti fuori/);
  assert.equal(await page.locator('.wk-row').count(), 8);
  assert.equal(await page.locator('.trip-del').count(), 5, 'admin può eliminare tutto');
  await noOverflow(page); await shot(page, 'trips-admin-390'); noErrors(page);
});

await step('card: settimane assenti coerenti con awayFromTrips (e), con unione di viaggi', async () => {
  const page = await mk({ sd: { trips: TRIPS } });
  const list = Object.values(TRIPS);
  const expected = [];
  for (let s = weekEnd('2026-11-12'); dayNum(s) <= dayNum(weekEnd('2026-11-24')); s = addDays(s, 7)) if (awayFromTrips(list, 'bruno', s, 3)) expected.push(s);
  assert.ok(expected.length >= 1);
  const chips = await page.locator('.trip[data-trip="e"] .wk-chips .chip').allInnerTexts();
  assert.equal(chips.length, expected.length);
  // a: 4 notti fuori ma resta in turno → nessuna settimana
  assert.match(await page.locator('.trip[data-trip="a"] .trip-weeks').innerText(), /Resta in turno/);
  noErrors(page);
});

await step('utente normale (Bruno): niente selettore persona, elimina solo i propri, preview = awayFromTrips', async () => {
  const page = await mk({ sd: { me: 'bruno', admin: false, trips: TRIPS } });
  assert.equal(await page.locator('.trip-del').count(), 2, 'solo le proprie');
  await openSheet(page);
  assert.equal(await page.locator('#trip-who').count(), 0);
  assert.match(await text(page, '.trip-who-static'), /Bruno/);
  await page.click('[data-q="weekend"]');
  assert.equal(await page.inputValue('#trip-from'), '2026-10-30');
  assert.equal(await page.inputValue('#trip-to'), '2026-11-02');
  assert.equal(await text(page, '#pv-nights'), '3');
  assert.equal(await page.inputValue('#trip-note'), 'Weekend a casa');
  // confronto con il motore
  const hypo = [...Object.values(TRIPS), { personId: 'bruno', from: '2026-10-30', to: '2026-11-02' }];
  const rows = await page.locator('.pv-week').evaluateAll((els) => els.map((e) => [e.dataset.week, e.dataset.away]));
  assert.deepEqual(rows.map((r) => r[0]), ['2026-11-01'], 'ven-lun nella stessa settimana lun-dom');
  for (const [w, a] of rows) assert.equal(a === '1', awayFromTrips(hypo, 'bruno', w, 3), 'settimana ' + w);
  await shot(page, 'trips-sheet-390-user', false);
  await page.click('.trip-form .btn:not(.soft)');
  await sheetGone(page);
  const st = await state(page);
  const added = Object.values(st.trips).find((x) => x.personId === 'bruno' && x.from === '2026-10-30');
  assert.ok(added && added.to === '2026-11-02' && added.note === 'Weekend a casa');
  // elimina il proprio viaggio
  const id = Object.keys(st.trips).find((k) => st.trips[k] === added || (st.trips[k].from === '2026-10-30'));
  await page.click(`.trip[data-trip="${id}"] .trip-del`);
  await page.waitForSelector('.sheet.on .btn.danger'); await page.waitForTimeout(450);
  await page.click('.sheet .btn.danger'); await sheetGone(page);
  assert.equal(Object.values((await state(page)).trips).filter((x) => x.from === '2026-10-30').length, 0);
  noErrors(page);
});

await step('amministratore: selettore persona, "Una settimana", viaggio aperto (to=null), unione con viaggio esistente', async () => {
  const page = await mk({ sd: { trips: TRIPS } });
  await openSheet(page);
  assert.equal(await page.locator('#trip-who option').count(), 3);
  // Anna ha già 26-30 ott (4 notti): weekend 30 ott-2 nov porta la settimana 26 ott-1 nov a 7 notti
  await page.selectOption('#trip-who', 'anna');
  await page.click('[data-q="weekend"]');
  const first = page.locator('.pv-week').first();
  assert.equal(await first.getAttribute('data-away'), '1');
  assert.match(await first.innerText(), /7 su 7/);
  // Carla, fino a nuovo avviso
  await page.selectOption('#trip-who', 'carla');
  await page.click('[data-q="open"]');
  assert.equal(await page.locator('#trip-to').isVisible(), false);
  assert.match(await text(page, '.pv-head'), /Fino a nuovo avviso/);
  assert.equal(await page.locator('.pv-week').count(), 8);
  const hypo = [...Object.values(TRIPS), { personId: 'carla', from: '2026-10-30', to: null }];
  const rows = await page.locator('.pv-week').evaluateAll((els) => els.map((e) => [e.dataset.week, e.dataset.away]));
  for (const [w, a] of rows) assert.equal(a === '1', awayFromTrips(hypo, 'carla', w, 3), 'settimana ' + w);
  await page.fill('#trip-note', 'Erasmus bis');
  await page.click('.trip-form .btn:not(.soft)'); await sheetGone(page);
  const t = Object.values((await state(page)).trips).find((x) => x.note === 'Erasmus bis');
  assert.ok(t && t.personId === 'carla' && t.to === null && t.from === '2026-10-30');
  assert.match(await page.locator('.trip', { hasText: 'Erasmus bis' }).innerText(), /In corso/);
  noErrors(page);
});

await step('validazione: rientro prima della partenza, date vuote, partenza nel passato, rientro oltre un anno', async () => {
  const page = await mk({ sd: { trips: TRIPS } });
  await openSheet(page);
  assert.equal(await page.locator('.trip-form .btn:not(.soft)').isDisabled(), true, 'senza rientro non si salva');
  await page.fill('#trip-from', '2026-11-10'); await page.fill('#trip-to', '2026-11-05');
  assert.equal(await page.locator('#trip-invalid').isVisible(), true);
  assert.match(await text(page, '#trip-invalid'), /dopo la partenza/);
  assert.equal(await page.locator('.trip-form .btn:not(.soft)').isDisabled(), true);
  assert.equal(await page.getAttribute('#trip-to', 'aria-invalid'), 'true');
  await page.fill('#trip-to', '2026-11-10');
  assert.equal(await page.locator('#trip-invalid').count(), 1, 'stesso giorno non valido');
  await page.fill('#trip-to', '2026-11-13');
  assert.equal(await page.locator('#trip-invalid').count(), 0);
  assert.equal(await text(page, '#pv-nights'), '3');
  assert.equal(await page.locator('.trip-form .btn:not(.soft)').isDisabled(), false);
  await page.fill('#trip-from', '2026-10-01'); await page.fill('#trip-to', '2026-10-05');
  assert.equal(await page.locator('#trip-pastwarn').count(), 1);
  await page.fill('#trip-from', TODAY); await page.fill('#trip-to', '2028-01-01');
  assert.equal(await page.locator('#trip-longwarn').count(), 1);
  assert.match(await text(page, '#pv-nights'), /^\d+$/);
  assert.ok(await page.locator('.moreweeks, .trip-preview > p.small').count() >= 1, 'elenco settimane troncato');
  await shot(page, 'trips-sheet-390-long', false);
  noErrors(page);
});

await step('assenza per singola settimana: toggle manuale, settimana già assente per viaggio disabilitata', async () => {
  const page = await mk({ sd: { me: 'bruno', admin: false, trips: TRIPS } });
  const row = page.locator('li.wk-row[data-week="2026-11-08"]');
  await row.locator('input').check({ force: true });
  await page.waitForFunction(() => (((window.__app.state.weeks || {})['2026-11-08'] || {}).awayMap || {}).bruno === true);
  assert.equal(await page.locator('li.wk-row[data-week="2026-11-08"] input').isChecked(), true);
  const trip = page.locator('li.wk-row[data-week="2026-11-22"]'); // e: Bruno via 12-25 nov
  assert.equal(await trip.locator('input').isDisabled(), true);
  assert.equal(await trip.locator('input').isChecked(), true);
  assert.match(await trip.innerText(), /Da assenza programmata/);
  await page.locator('li.wk-row[data-week="2026-11-08"] input').uncheck({ force: true });
  await page.waitForFunction(() => !(((window.__app.state.weeks || {})['2026-11-08'] || {}).awayMap || {}).bruno);
  noErrors(page);
});

await step('admin: toggle per un altro coinquilino', async () => {
  const page = await mk({ sd: { trips: TRIPS } });
  await page.selectOption('.wk-head select', 'carla');
  await page.waitForTimeout(200);
  await page.locator('li.wk-row[data-week="2026-11-15"] input').check({ force: true });
  await page.waitForFunction(() => (((window.__app.state.weeks || {})['2026-11-15'] || {}).awayMap || {}).carla === true);
  await page.selectOption('.wk-head select', 'carla'); // il valore resta dopo il rerender
  assert.equal(await page.inputValue('.wk-head select'), 'carla');
  noErrors(page);
});

await step('stato vuoto, funzione spenta, persona uscita, nessun coinquilino, selfAway spento', async () => {
  let page = await mk({});
  assert.match(await text(page, '.empty'), /Nessuna assenza programmata/);
  page = await mk({ houseExtra: { features: { trips: false } } });
  assert.match(await text(page, '.empty'), /disattivati/);
  assert.equal(await page.locator('.nav a[href="#/trips"]').count(), 0);
  page = await mk({ houseExtra: { roommates: [{ id: 'anna', name: 'Anna', slot: 1 }, { id: 'bruno', name: 'Bruno', slot: 2 }, { id: 'carla', name: 'Carla', slot: 3, to: '2026-10-01' }] }, sd: { trips: { z: { personId: 'carla', from: '2026-09-20', to: '2026-09-25', by: 'x', at: 'x' } } } });
  assert.match(await page.locator('.trip').innerText(), /Uscito/);
  await openSheet(page);
  assert.equal(await page.locator('#trip-who option').count(), 2, 'chi è uscito non è selezionabile');
  page = await mk({ sd: { me: 'bruno', admin: false }, houseExtra: { features: { selfAway: false } } });
  assert.equal(await page.locator('.wk-row input:not([disabled])').count(), 0);
  // nessun coinquilino: render diretto con un ctx derivato
  const html = await page.evaluate(async () => {
    const m = await import('/js/screens/trips.js'); const c = Object.create(window.__app);
    Object.defineProperty(c, 'house', { value: { ...window.__app.house, roommates: [] } });
    return (await m.render(c)).innerText || (await m.render(c)).textContent;
  });
  assert.match(html, /Nessun coinquilino/);
  noErrors(page);
});

await step('EN + scuro + tablet/desktop: nessun overflow, screenshot', async () => {
  for (const [name, vp] of [['820', { width: 820, height: 1180 }], ['1440', { width: 1440, height: 900 }]]) {
    const page = await mk({ vp, sd: { trips: TRIPS } });
    await noOverflow(page); await shot(page, `trips-admin-${name}`); noErrors(page);
  }
  const en = await mk({ lang: 'en-US', dark: true, prefs: { lang: 'en', theme: 'dark' }, sd: { trips: TRIPS } });
  assert.match(await text(en, 'h1.title'), /Absences and trips/);
  assert.match(await en.locator('.trip[data-trip="a"]').innerText(), /26 Oct → 30 Oct/);
  assert.match(await en.locator('.trip[data-trip="c"]').innerText(), /Until further notice/);
  await shot(en, 'trips-en-dark-390');
  await en.click('.trips-cta .btn'); await en.waitForSelector('.sheet.on'); await en.waitForTimeout(450);
  await en.click('[data-q="weekend"]');
  assert.match(await text(en, '.pv-head'), /nights away/);
  await shot(en, 'trips-sheet-en-dark', false);
  noErrors(en);
});

// ================================================================ STATISTICHE
console.log('Classifica e statistiche');
const peopleOf = (page) => page.evaluate(async () => {
  const { buildStats } = await import('/js/extras.js'); const s = buildStats(window.__app.calc.eh, window.__app.calc.out);
  return { closedWeeks: s.closedWeeks, balance: s.balance, completion: s.completion, months: s.monthly.length, people: s.people.map((p) => ({ id: p.id, name: p.name, cleanedTotal: p.cleanedTotal, effort: p.effort, cdm: p.cdm, rate: p.rate, presence: p.presence, onTimeRate: p.onTimeRate, covers: p.covers, covered: p.covered, streak: p.streak, bestStreak: p.bestStreak, skipped: p.skipped })) };
});
const STATS = { weeks: WEEKS, houseExtra: { effort: { floor: 3, bathroom: 2, kitchen: 1 } } };

await step('classifica: ordine, TR sul primo, CDM, punteggi, KPI, grafici SVG (mobile)', async () => {
  const page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
  const d = await peopleOf(page);
  assert.ok(d.closedWeeks >= 15);
  const names = await page.locator('.rank-row .rk-name').allInnerTexts();
  const exp = [...d.people].sort((a, b) => b.cleanedTotal - a.cleanedTotal || a.name.localeCompare(b.name));
  assert.deepEqual(names, exp.map((p) => p.name));
  const nums = await page.locator('.rank-row .rk-num').allInnerTexts();
  assert.deepEqual(nums.map(Number), exp.map((p) => p.cleanedTotal));
  const max = exp[0].cleanedTotal;
  assert.equal(await page.locator('.rank-row:has(.chip.warn)').count(), exp.filter((p) => p.cleanedTotal === max).length, 'TR');
  assert.equal(await page.locator('.rank-row .chip.bad').count(), exp.filter((p) => p.cdm).length, 'CDM');
  assert.match(await text(page, '#stats-window'), /Ultime 52 settimane/);
  assert.match(await text(page, '[data-kpi="completion"]'), new RegExp(d.completion + '%'));
  assert.match(await text(page, '[data-kpi="weeks"]'), new RegExp(String(d.closedWeeks)));
  assert.equal(await page.getAttribute('[data-kpi="balance"] [role=meter]', 'aria-valuenow'), String(d.balance));
  assert.equal(await page.locator('.podium .pod').count(), 3);
  // grafici
  const choreLabel = await page.getAttribute('svg[data-chart="chore"]', 'aria-label');
  assert.match(choreLabel, /Pavimenti/); assert.match(choreLabel, /Anna/);
  assert.equal(await page.locator('svg[data-chart="monthly"] g[data-month]').count(), d.months);
  assert.equal(await page.locator('svg[data-spark]').count(), 3);
  assert.ok((await page.getAttribute('svg[data-spark="anna"]', 'aria-label')).includes('Anna'));
  // dati in forma testuale
  await page.locator('[data-card="chore"] summary').click();
  assert.match(await text(page, '[data-card="chore"] table'), /Carla/);
  // stile: numeri tabulari
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.rk-num')).fontVariantNumeric), /tabular-nums/);
  await noOverflow(page); await shot(page, 'stats-390'); noErrors(page);
});

await step('switch Turni / Punti fatica: ordine e valori per punti, scelta persistente', async () => {
  const page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
  const d = await peopleOf(page);
  await page.click('.rank-seg [data-mode="effort"]');
  await page.waitForFunction(() => document.querySelector('.rank-seg [data-mode="effort"]').getAttribute('aria-pressed') === 'true');
  const exp = [...d.people].sort((a, b) => b.effort - a.effort || a.name.localeCompare(b.name));
  assert.deepEqual((await page.locator('.rank-row .rk-num').allInnerTexts()).map(Number), exp.map((p) => p.effort));
  assert.deepEqual(await page.locator('.rank-row .rk-name').allInnerTexts(), exp.map((p) => p.name));
  assert.match(await text(page, '.rank-card'), /Pavimenti 3, Bagno 2, Cucina 1/);
  await shot(page, 'stats-effort-390');
  // condivisione con i punti
  await page.click('#stats-share'); await page.waitForSelector('#share-text'); await page.waitForTimeout(450);
  assert.match(await text(page, '#share-text'), new RegExp(`${exp[0].name}: ${exp[0].effort}`));
  noErrors(page);
});

await step('switch assente se i punti fatica sono tutti 1 (rankBy turns)', async () => {
  const page = await mk({ hash: '#/stats', sd: { weeks: WEEKS } });
  assert.equal(await page.locator('.rank-seg').count(), 0);
  const page2 = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: { settings: { grace: 1, minRest: 3, startPriority: 4, window: 52, minNights: 3, rankBy: 'effort' } } });
  assert.equal(await page2.locator('.rank-seg [aria-pressed="true"]').getAttribute('data-mode'), 'effort', 'default da settings.rankBy');
});

await step('dettaglio persona (sheet) coerente con buildStats', async () => {
  const page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
  const d = await peopleOf(page); const anna = d.people.find((p) => p.id === 'anna');
  await page.click('.rank-row[data-person="anna"]'); await page.waitForSelector('.sheet.on .pd'); await page.waitForTimeout(450);
  const val = (k) => text(page, `.sheet [data-d="${k}"] .v`);
  assert.equal(await val('rate'), anna.rate + '%');
  assert.equal(await val('presence'), anna.presence + '%');
  assert.equal(await val('covers'), String(anna.covers));
  assert.equal(await val('covered'), String(anna.covered));
  assert.equal(await val('streak'), String(anna.streak));
  assert.equal(await val('best'), String(anna.bestStreak));
  assert.equal(await val('skipped'), String(anna.skipped));
  assert.equal(await val('ontime'), anna.onTimeRate === null ? '–' : anna.onTimeRate + '%');
  assert.equal(await page.locator('.sheet .pd-chore').count(), 3);
  await shot(page, 'stats-person-390', false);
  noErrors(page);
});

await step('condividi classifica: testo, copia, link wa.me', async () => {
  const page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
  await page.click('#stats-share'); await page.waitForSelector('#share-text'); await page.waitForTimeout(450);
  const txt = await text(page, '#share-text');
  assert.match(txt, /Classifica/); assert.match(txt, /TR:/);
  const href = await page.getAttribute('#share-wa', 'href');
  assert.ok(href.startsWith('https://wa.me/?text=') && decodeURIComponent(href).includes('Classifica'));
  await page.click('#share-copy'); await page.waitForSelector('.toast');
  await shot(page, 'stats-share-390', false);
  noErrors(page);
});

await step('funzioni: ranking spento (niente TR/CDM), stats spento (solo classifica), whatsapp spento', async () => {
  let page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: { features: { ranking: false } } });
  assert.equal(await page.locator('.chip.warn, .chip.bad').count(), 0);
  assert.equal(await page.locator('.kpis').count() > 0, true);
  await page.click('#stats-share'); await page.waitForSelector('#share-text'); await page.waitForTimeout(450);
  assert.doesNotMatch(await text(page, '#share-text'), /TR:|CDM:/);
  page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: { features: { stats: false } } });
  assert.equal(await page.locator('.kpis, svg[data-chart], .chart-card').count(), 0);
  assert.equal(await page.locator('button.rank-row').count(), 0);
  assert.equal(await page.locator('.rank-row').count(), 3);
  assert.ok(await page.locator('.rank-row .chip').count() > 0, 'TR/CDM restano con ranking attivo');
  page = await mk({ hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: { features: { whatsapp: false } } });
  await page.click('#stats-share'); await page.waitForSelector('#share-text');
  assert.equal(await page.locator('#share-wa').count(), 0);
  noErrors(page);
});

await step('nessuna settimana chiusa: stato vuoto', async () => {
  const page = await mk({ hash: '#/stats', houseExtra: { startSunday: '2026-11-01' } });
  assert.match(await text(page, '.empty'), /Ancora nessuna settimana chiusa/);
  assert.equal(await page.locator('.rank-row, svg[data-chart], .kpis').count(), 0);
  noErrors(page);
});

await step('EN, scuro, tablet e desktop: nessun overflow, screenshot', async () => {
  for (const [name, vp] of [['820', { width: 820, height: 1180 }], ['1440', { width: 1440, height: 900 }], ['320', { width: 320, height: 640 }]]) {
    const page = await mk({ vp, hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
    await noOverflow(page); await shot(page, `stats-${name}`); noErrors(page);
  }
  const en = await mk({ lang: 'en-US', dark: true, prefs: { lang: 'en', theme: 'dark' }, hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
  assert.match(await text(en, 'h1.title'), /Ranking and statistics/);
  assert.match(await text(en, '#stats-window'), /Last 52 weeks/);
  assert.match(await text(en, '[data-kpi="balance"]'), /Load balance|Fairness|balance/i);
  await noOverflow(en); await shot(en, 'stats-en-dark-390');
  const dark = await mk({ vp: { width: 1440, height: 900 }, dark: true, prefs: { theme: 'dark' }, hash: '#/stats', sd: { weeks: WEEKS }, houseExtra: STATS.houseExtra });
  await shot(dark, 'stats-dark-1440');
  noErrors(en);
});

await env.close();
console.log(`\n${results.length - failed}/${results.length} ok`);
process.exit(failed ? 1 : 0);
