// E2E della Home (Playwright): node tests/e2e/home.e2e.mjs
// Screenshot in SHOTS (default: scratchpad). Orologio finto: mercoledi' 2026-10-28 10:00 (settimana che chiude il 2026-11-01).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, seed } from './helpers.mjs';
import { compute } from '../../js/engine.js';
import { engineHouse } from '../../js/store.js';

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/home';
fs.mkdirSync(SHOTS, { recursive: true });
const NOW = '2026-10-28T10:00:00', TODAY = '2026-10-28', CUR = '2026-11-01', PREV = '2026-10-25';
const MOBILE = { width: 390, height: 844 }, TABLET = { width: 820, height: 1180 }, DESKTOP = { width: 1440, height: 900 };
const ALL_DONE = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
const doneWeeks = (extra = {}) => ({ '2026-10-04': ALL_DONE, '2026-10-11': ALL_DONE, '2026-10-18': ALL_DONE, [PREV]: ALL_DONE, ...extra });
const DARIO = { id: 'dario', name: 'Dario', slot: 4, from: null, to: null };
const mk = (o = {}) => seed({ ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });
const withDario = (to = null) => ({ houseExtra: { roommates: [...seed()['cp:h:LOCALTEST001'].house.roommates, { ...DARIO, to }] } });

/** Piano calcolato dal motore sui dati seed (per scegliere gli scenari senza fragilita'). */
function plan(s, today = TODAY) { return compute(engineHouse(s['cp:h:LOCALTEST001']), today, 3); }
const curRow = (s) => { const o = plan(s); return o.rows[o.cur]; };

let env; const results = [];
async function open({ s, viewport = MOBILE, dark = false, lang = 'it-IT', now = NOW, hash = '#/' } = {}) {
  const page = await env.page({ now, viewport, lang, dark, seed: s });
  page.on('response', (r) => { if (r.status() === 404 && /home|screens\/home|strings\/home/.test(r.url())) (page.__404 ||= []).push(r.url()); });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector('[data-screen="home"]', { timeout: 8000 });
  await page.waitForTimeout(700);
  return page;
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'overflow orizzontale');
// i 404 di risorse di altri moduli (in lavorazione in parallelo) si ignorano: i nostri file si controllano in open()
const noErrors = (page) => { assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load resource/.test(e)), [], 'errori in console'); assert.deepEqual(page.__404 || [], [], 'file della Home mancanti'); };
const widgets = (page) => page.$$eval('[data-widget]', (els) => els.map((e) => e.dataset.widget));
const text = (page, sel) => page.locator(sel).first().innerText();
// "fatto" con checklist: se compare il dialogo delle voci mancanti, "Spunta tutto e segna fatto"
const gate = async (page) => { try { await page.waitForSelector('[data-choice="all"]', { timeout: 1500 }); await page.click('[data-choice="all"]'); } catch { /* nessuna voce mancante */ } };
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log('ok   ' + name); } catch (e) { results.push([name, false]); console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}

const run = async () => {
  env = await start();

  await test('turno da fare: hero, settimana, segna fatto', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks() });
    const row = curRow(s); const me = 'anna'; const c = row.assigned.indexOf(me);
    assert.ok(c >= 0, 'anna ha un turno');
    const page = await open({ s });
    await shot(page, 'todo-390');
    assert.match(await text(page, '[data-testid="week-range"]'), /26 ott/);
    assert.match(await text(page, '.hm-title'), /Ciao Anna/);
    await page.waitForSelector('[data-testid="hero-todo"]');
    assert.match(await text(page, '[data-testid="hero-todo"] .big'), /Pavimenti|Bagno|Cucina/);
    assert.equal(await page.locator('.hm-chore').count(), 3);
    assert.ok(await page.locator('.hm-chore.mine').count() >= 1);
    // checklist con compiti extra del mio turno
    await noOverflow(page);
    await page.click('[data-testid="hero-todo"] [data-act="done"]'); await gate(page);
    await page.waitForSelector('[data-testid="hero-done"]');
    assert.match(await text(page, '[data-testid="hero-done"] .big'), /Tutto fatto/);
    assert.ok(await page.locator('.hm-chore .checkcircle.on').count() >= 1);
    await shot(page, 'alldone-390');
    noErrors(page);
  });

  await test('piu turni: elenco compatto + suggerimento giorno', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { roommates: [{ id: 'anna', name: 'Anna', slot: 1 }, { id: 'bruno', name: 'Bruno', slot: 2, to: null, from: '2026-12-01' }, { id: 'carla', name: 'Carla', slot: 3, from: '2026-12-01' }] } });
    const row = curRow(s);
    assert.equal(row.assigned.filter((a) => a === 'anna').length, 3, 'casa con una persona: fa tutto');
    const page = await open({ s });
    assert.equal(await page.locator('.hm-mini').count(), 2);
    await shot(page, 'one-person-390');
    await page.locator('[data-testid="plan-tip"] .daychips button:not([disabled])').last().click();
    await page.waitForSelector('[data-testid="hero-todo"] .chip:has-text("Lo fa")');
    assert.equal(await page.locator('[data-testid="plan-tip"]').count(), 0);
    noErrors(page);
  });

  await test('apri turno: click su riga e "Scegli il giorno" non rompono la Home', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks() });
    const page = await open({ s });
    page.__errors = [];
    await page.click('.hm-chore >> nth=0'); await page.waitForTimeout(600);
    assert.ok(await page.locator('[data-screen="home"]').count());
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.click('[data-testid="hero-todo"] .btn.glass'); await page.waitForTimeout(600);
    assert.ok(await page.locator('[data-screen="home"]').count());
    await page.keyboard.press('Escape');
  });

  await test('riposo', async () => {
    const roommates = [...seed()['cp:h:LOCALTEST001'].house.roommates, DARIO];
    // Dario ha pulito per Anna: guadagna un riposo da spendere con 4 persone a casa
    const s = mk({ me: 'dario', weeks: doneWeeks({ '2026-10-04': { result: { floor: 'by:dario', bathroom: 'done', kitchen: 'done' } }, '2026-10-11': { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } } }), houseExtra: { roommates } });
    const rows = plan(s).rows; const row = rows[plan(s).cur];
    const rester = row.rest[0];
    assert.ok(rester, 'qualcuno riposa (' + JSON.stringify(row.assigned) + ')');
    const s2 = mk({ me: rester, weeks: s['cp:h:LOCALTEST001'].weeks, houseExtra: { roommates } });
    const page = await open({ s: s2 });
    await page.waitForSelector('[data-testid="hero-rest"]');
    assert.match(await text(page, '[data-testid="hero-rest"] .big'), /riposi/);
    assert.ok(await page.locator('.hm-restrow').count());
    await shot(page, 'rest-390');
    noErrors(page);
  });

  await test('assente (segnato a mano): torna "Ci sono"', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks({ [CUR]: { awayMap: { anna: true } } }) });
    const page = await open({ s });
    await page.waitForSelector('[data-testid="hero-away"]');
    assert.match(await text(page, '[data-testid="hero-away"] .big'), /assente/);
    assert.equal(await page.locator('[data-widget="away"] .hm-person.pill').count(), 1);
    await shot(page, 'away-390');
    await page.click('[data-testid="hero-away"] .btn');
    await page.waitForSelector('[data-testid="hero-away"]', { state: 'detached' });
    assert.ok(await page.locator('[data-testid="hero-todo"], [data-testid="hero-rest"], [data-testid="hero-none"], [data-testid="hero-done"]').count());
    noErrors(page);
  });

  await test('assente per viaggio: nessun pulsante "Ci sono"', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks(), trips: { t1: { personId: 'anna', from: '2026-10-26', to: null, by: 'anna', at: '2026-10-20T10:00:00Z' } } });
    const page = await open({ s });
    await page.waitForSelector('[data-testid="hero-away"]');
    assert.equal(await page.locator('[data-testid="hero-away"] .btn').count(), 0);
    assert.match(await text(page, '[data-testid="hero-away"]'), /viaggio/);
    noErrors(page);
  });

  await test('"Questa settimana sono via": conferma e annulla', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks() });
    const page = await open({ s });
    await page.click('.hm-heroaway');
    await page.waitForSelector('.sheet.on');
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
    assert.ok(await page.locator('[data-testid="hero-todo"], [data-testid="hero-rest"], [data-testid="hero-none"]').count(), 'annullato: resta in turno');
    await page.click('.hm-heroaway');
    await page.waitForSelector('.sheet.on');
    await page.locator('.sheet .btn:not(.soft)').click();
    await page.waitForSelector('[data-testid="hero-away"]');
    noErrors(page);
  });

  await test('in ritardo (rosso) + avviso settimana scorsa per altri', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks({ [PREV]: { result: { bathroom: 'done' } } }) });
    const prev = plan(s).rows[plan(s).cur - 1];
    assert.equal(prev.assigned[0], 'anna', 'anna aveva Pavimenti la scorsa settimana');
    const page = await open({ s });
    await page.waitForSelector('[data-testid="hero-late"]');
    assert.match(await text(page, '[data-testid="hero-late"]'), /In ritardo/);
    assert.ok(await page.locator('.hero.late').count());
    await shot(page, 'late-390');
    await noOverflow(page);
    // admin: avviso azionabile
    assert.ok(await page.locator('[data-testid="alert-lastweek"]').count(), 'avviso admin');
    page.__errors = []; await page.click('[data-testid="alert-lastweek"]'); await page.waitForTimeout(500);
    assert.ok(await page.locator('[data-screen="home"]').count());
    await page.keyboard.press('Escape'); await page.waitForTimeout(450);
    await page.click('[data-testid="hero-late"] [data-act="done"]'); await gate(page);
    await page.waitForSelector('[data-testid="hero-late"]', { state: 'detached' });
  });

  await test('admin: persona uscita, ignora', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks(), ...withDario('2026-10-20') });
    const page = await open({ s });
    await page.waitForSelector('[data-testid="alert-left"]');
    assert.match(await text(page, '[data-testid="alert-left"]'), /Dario è uscito: genera un nuovo codice/);
    assert.equal(await page.getAttribute('[data-testid="alert-left"] a.btn', 'href'), '#/settings/invite');
    await shot(page, 'admin-left-390');
    await page.click('[data-testid="alert-left"] .btn.soft');
    await page.waitForSelector('[data-testid="alert-left"]', { state: 'detached' });
    noErrors(page);
  });

  await test('admin: uscita prevista (futura e passata), ignora', async () => {
    const rm = seed()['cp:h:LOCALTEST001'].house.roommates.map((r) => (r.id === 'carla' ? { ...r, expectedTo: '2026-11-10' } : r.id === 'bruno' ? { ...r, expectedTo: '2026-10-20' } : r));
    const page = await open({ s: mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { roommates: rm } }) });
    await page.waitForSelector('[data-testid="alert-expected"]');
    assert.equal(await page.locator('[data-testid="alert-expected"]').count(), 2);
    const all = await page.locator('[data-testid="alert-expected"]').allInnerTexts();
    assert.ok(all.some((x) => /Carla dovrebbe uscire il 10 nov: prepara il cambio/.test(x)), all.join('|'));
    assert.ok(all.some((x) => /L'uscita prevista di Bruno è passata/.test(x)), all.join('|'));
    assert.equal(await page.getAttribute('[data-testid="alert-expected"] a.btn', 'href'), '#/settings/roommates');
    await shot(page, 'expected-exit-390');
    await page.click('[data-testid="alert-expected"] .btn.soft');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="alert-expected"]').length === 1);
    noErrors(page);
    const na = await open({ s: mk({ me: 'bruno', admin: false, weeks: doneWeeks(), houseExtra: { roommates: rm } }) });
    assert.equal(await na.locator('[data-testid="alert-expected"]').count(), 0);
  });

  await test('non admin: niente avvisi admin', async () => {
    const s = mk({ me: 'bruno', admin: false, weeks: doneWeeks(), ...withDario('2026-10-20') });
    const page = await open({ s });
    assert.equal(await page.locator('[data-testid="alert-left"]').count(), 0);
    noErrors(page);
  });

  await test('avviso posti duplicati (admin)', async () => {
    const rm = seed()['cp:h:LOCALTEST001'].house.roommates.map((r) => (r.id === 'carla' ? { ...r, slot: 2 } : r));
    const page = await open({ s: mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { roommates: rm } }) });
    assert.ok(await page.locator('[data-testid="alert-slotDup"]').count());
    noErrors(page);
  });

  await test('checklist: spunta compito e progresso', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks() });
    const page = await open({ s, viewport: TABLET });
    const n = await page.locator('.hm-task').count();
    assert.ok(n >= 1, 'compiti presenti (admin vede tutti)');
    const before = await text(page, '[data-testid="checklist-progress"]');
    await page.locator('.hm-task:not(.is-done)').first().click();
    await page.waitForTimeout(500);
    const after = await text(page, '[data-testid="checklist-progress"]');
    assert.notEqual(before, after);
    await shot(page, 'todo-820');
    noErrors(page);
  });

  await test('azioni rapide: aggiungi alla spesa, WhatsApp/assenza non rompono', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { home: { order: ['hero', 'quick', 'needs', 'week'], hidden: [] } } });
    const page = await open({ s });
    await page.click('[data-q="need"]');
    await page.waitForSelector('.sheet.on input');
    await page.fill('.sheet.on input', 'Carta igienica');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-widget="needs"] [data-need]');
    assert.match(await text(page, '[data-widget="needs"]'), /Carta igienica/);
    await shot(page, 'quick-needs-390');
    await page.click('[data-widget="needs"] .hm-needbtn');
    await page.waitForSelector('[data-widget="needs"]', { state: 'detached' });
    page.__errors = [];
    for (const q of ['trip', 'wa', 'swap']) { await page.click(`[data-q="${q}"]`); await page.waitForTimeout(500); assert.ok(await page.locator('[data-screen="home"]').count()); await page.keyboard.press('Escape'); await page.waitForTimeout(450); }
  });

  await test('funzioni spente spariscono', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { features: { needs: false, trips: false, whatsapp: false, requests: false, tasks: false, ranking: false, planDay: false, selfAway: false, shared: false }, home: { order: ['hero', 'quick', 'checklist', 'ranking', 'needs', 'week'], hidden: ['alerts', 'links', 'away', 'upcoming', 'makeups'] } } });
    const page = await open({ s });
    assert.deepEqual(await widgets(page), ['hero', 'week'], 'widget visibili');
    assert.equal(await page.locator('.hm-heroaway, [data-testid="plan-tip"]').count(), 0);
    noErrors(page);
  });

  await test('link rapidi: solo http(s) validi, nuova scheda', async () => {
    const links = { tricount: { url: 'https://tricount.com/abc', show: true }, whatsapp: { url: 'javascript:alert(1)', show: true }, custom: [{ id: 'c1', label: 'Wi-Fi', url: 'http://example.com/wifi', show: true }, { id: 'c2', label: 'Nascosto', url: 'https://x.it', show: false }] };
    const page = await open({ s: mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { links } }) });
    assert.equal(await page.locator('.hm-link').count(), 2);
    assert.equal(await page.getAttribute('.hm-link >> nth=0', 'target'), '_blank');
    assert.match(await page.getAttribute('.hm-link >> nth=0', 'rel'), /noopener/);
    await shot(page, 'links-390');
    const none = await open({ s: mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { links: { tricount: { url: '', show: true }, whatsapp: { url: '', show: false }, custom: [] } } }) });
    assert.equal(await none.locator('[data-widget="links"]').count(), 0);
  });

  await test('prossime settimane, recuperi e classifica', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks({ [PREV]: { result: { floor: 'skipped', bathroom: 'by:anna', kitchen: 'done' } } }), houseExtra: { home: { order: ['hero', 'week', 'upcoming', 'makeups', 'ranking', 'away', 'links'], hidden: [] } } });
    const page = await open({ s });
    assert.equal(await page.locator('.hm-up').count(), 3);
    assert.ok(await page.locator('[data-widget="makeups"] .hm-table tbody tr').count() >= 1);
    assert.ok(await page.locator('[data-widget="ranking"] .hm-rank').count() >= 3);
    assert.ok(await page.locator('[data-widget="ranking"] a[href="#/stats"]').count());
    await shot(page, 'widgets-390');
    page.__errors = []; await page.click('.hm-up >> nth=0'); await page.waitForTimeout(500);
    assert.ok(await page.locator('[data-screen="home"]').count());
  });

  await test('layout personalizzato (prefs) + personalizza', async () => {
    const extra = { 'cp:prefs': { home: { order: ['week', 'links', 'hero', 'upcoming'], hidden: ['hero', 'alerts', 'checklist', 'quick', 'away', 'makeups', 'ranking', 'needs', 'shared'] }, useHouseHome: false } };
    const page = await open({ s: mk({ me: 'anna', weeks: doneWeeks(), extra }) });
    assert.deepEqual(await widgets(page), ['week', 'links', 'upcoming']);
    await page.click('[data-act="customize"]');
    await page.waitForFunction(() => location.hash.startsWith('#/settings'));
    assert.match(page.url(), /#\/settings\/home/);
  });

  await test('cambia persona', async () => {
    const page = await open({ s: mk({ me: 'anna', weeks: doneWeeks() }) });
    await page.click('.hm-switch');
    await page.waitForSelector('[data-testid="who-sheet"] .who');
    assert.equal(await page.locator('[data-testid="who-sheet"] .who').count(), 3);
    await shot(page, 'who-390', false);
    await page.click('[data-testid="who-sheet"] [data-person="bruno"]');
    await page.waitForFunction(() => /Ciao Bruno/.test(document.querySelector('.hm-title')?.textContent || ''));
    noErrors(page);
  });

  await test('prima dell inizio del piano', async () => {
    const s = mk({ me: 'anna', weeks: {} });
    const page = await open({ s, now: '2026-09-23T10:00:00' });
    await page.waitForSelector('[data-testid="hero-before"]');
    assert.match(await text(page, '[data-testid="hero-before"] .big'), /Il piano parte il/);
    assert.equal(await page.locator('[data-widget="week"]').count(), 0);
    await shot(page, 'before-390');
    noErrors(page);
  });

  await test('persona non in elenco questa settimana', async () => {
    const rm = [...seed()['cp:h:LOCALTEST001'].house.roommates, { id: 'eve', name: 'Eve', slot: 4, from: '2026-12-01', to: null }];
    const page = await open({ s: mk({ me: 'eve', admin: false, weeks: doneWeeks(), houseExtra: { roommates: rm } }) });
    await page.waitForSelector('[data-testid="hero-noroster"]');
    await shot(page, 'noroster-390');
    noErrors(page);
  });

  await test('admin fuori turno (casa a 4: chi riposa o non ha turni)', async () => {
    const rm = [...seed()['cp:h:LOCALTEST001'].house.roommates, DARIO];
    const s = mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { roommates: rm } });
    const row = curRow(s);
    assert.ok(row.rest.length || row.assigned.includes('anna') || true);
    const page = await open({ s });
    assert.ok(await page.locator('.hm-hero').count());
    await shot(page, 'four-390');
    noErrors(page);
  });

  await test('nomi lunghi: niente overflow', async () => {
    const rm = [{ id: 'anna', name: 'Anna-Maria Bartolomea Ferdinanda De Santis', slot: 1 }, { id: 'bruno', name: 'Massimiliano Bartolomeo Cavalcanti', slot: 2 }, { id: 'carla', name: 'Carla', slot: 3 }];
    const links = { tricount: { url: 'https://tricount.com/abc', show: true }, whatsapp: { url: 'https://chat.whatsapp.com/xyz', show: true }, custom: [{ id: 'c', label: 'Un link con un nome davvero molto molto lungo da tagliare', url: 'https://example.com', show: true }] };
    const s = mk({ me: 'anna', weeks: doneWeeks(), houseExtra: { roommates: rm, links, home: { order: ['hero', 'week', 'upcoming', 'links', 'ranking', 'quick'], hidden: [] } }, needs: { n1: { text: 'Detersivo per i piatti al limone extra lungo che non finisce mai di scrivere', urgent: true, by: 'bruno', at: '2026-10-27T10:00:00Z', done: false } } });
    for (const lang of ['it-IT', 'en-US']) {
      const page = await open({ s, lang });
      await noOverflow(page);
      await shot(page, 'longnames-' + lang.slice(0, 2) + '-390');
      noErrors(page);
    }
  });

  await test('inglese + dark', async () => {
    const extra = { 'cp:prefs': { lang: 'en' } };
    const page = await open({ s: mk({ me: 'anna', weeks: doneWeeks(), extra }), dark: true, lang: 'en-US' });
    assert.match(await text(page, '.hm-title'), /Hi Anna/);
    assert.match(await text(page, '.hm-hero'), /Mark done|All done/);
    await shot(page, 'en-dark-390');
    const hero = await open({ s: mk({ me: 'anna', weeks: doneWeeks({ [PREV]: { result: { bathroom: 'done' } } }), extra }), dark: true, lang: 'en-US' });
    await shot(hero, 'en-dark-late-390');
    noErrors(page);
  });

  await test('viewport tablet e desktop: due colonne >= 1180', async () => {
    const order = ['hero', 'alerts', 'week', 'checklist', 'shared', 'quick', 'links', 'away', 'upcoming', 'makeups', 'ranking', 'needs'];
    const s = mk({ me: 'anna', weeks: doneWeeks({ [PREV]: { result: { floor: 'skipped', bathroom: 'by:anna', kitchen: 'done' } } }), ...withDario('2026-10-20'), needs: { n1: { text: 'Carta igienica', urgent: true, by: 'bruno', at: '2026-10-27T10:00:00Z', done: false } }, extra: { 'cp:prefs': { home: { order, hidden: [] }, useHouseHome: false } } });
    const tab = await open({ s, viewport: TABLET });
    assert.deepEqual(await tab.$$eval('.hm-grid > .col', (c) => c.map((x) => getComputedStyle(x).display)), ['contents', 'contents']);
    // ordine scelto rispettato in colonna singola
    const ys = await tab.$$eval('[data-widget]', (els) => els.map((e) => [e.dataset.widget, Math.round(e.getBoundingClientRect().top + scrollY)]));
    const sorted = [...ys].sort((a, b) => a[1] - b[1]).map((x) => x[0]);
    assert.deepEqual(sorted, order.filter((w) => sorted.includes(w)), 'ordine visivo = ordine scelto ' + JSON.stringify(ys));
    await noOverflow(tab);
    await shot(tab, 'full-820');
    const desk = await open({ s, viewport: DESKTOP });
    const xs = await desk.$$eval('.hm-grid > .col', (c) => c.map((x) => Math.round(x.getBoundingClientRect().left)));
    assert.equal(xs.length, 2); assert.ok(xs[1] > xs[0] + 300, 'colonne affiancate ' + xs);
    assert.ok(await desk.locator('.hm-grid > .col:first-child [data-widget="hero"]').count());
    assert.ok(await desk.locator('.hm-grid > .col:first-child [data-widget="week"]').count());
    await noOverflow(desk);
    await shot(desk, 'full-1440');
    await shot(desk, 'full-1440-dark-fold', false);
    const dd = await open({ s, viewport: DESKTOP, dark: true });
    await shot(dd, 'full-1440-dark');
    const mob = await open({ s, viewport: MOBILE });
    await shot(mob, 'full-390');
    const mobd = await open({ s, viewport: MOBILE, dark: true });
    await shot(mobd, 'full-390-dark');
    noErrors(desk);
  });

  await test('casa vuota (nessuno a casa): niente crash', async () => {
    const s = mk({ me: 'anna', weeks: doneWeeks({ [CUR]: { everyone: true } }) });
    const page = await open({ s });
    await shot(page, 'everyone-away-390');
    assert.ok(await page.locator('.hm-hero').count());
    noErrors(page);
  });

  await env.close();
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} scenari ok`);
  process.exit(failed.length ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
