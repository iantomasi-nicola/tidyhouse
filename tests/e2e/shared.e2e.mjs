// E2E (Playwright): pagina Compiti «Da fare a turno» (#/tasks, alias #/more/shared), penalità extra in Classifica e in Impostazioni > Regole.
// Esegui con:  node tests/e2e/shared.e2e.mjs [filtro]      Screenshot in SHOT_DIR (default: scratchpad/shared).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const SHOT = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-tidyhouse/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/shared/';
const NOW = '2026-10-28T10:00:00';
const M = { width: 390, height: 844 };
const D = { width: 1440, height: 900 };
const HID = 'LOCALTEST001';
const SUN = '2026-11-01';   // domenica della settimana corrente (mercoledì 28/10/2026)
fs.mkdirSync(SHOT, { recursive: true });

const env = await start();
let failed = 0; const only = process.argv[2];

async function open({ ...opts } = {}) {
  const page = await env.page({ now: NOW, viewport: M, ...opts });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.CASA_CONFIG = { firebase: { apiKey: "", projectId: "" }, publicUrl: "" };' }));
  return page;
}
async function done(page) {
  const errs = (page.__errors || []).filter((e) => !/favicon|manifest/i.test(e));
  await page.context().close();
  assert.deepEqual(errs, [], 'errori in console: ' + errs.join(' | '));
}
const shot = async (page, name) => { await page.waitForTimeout(650); return page.screenshot({ path: SHOT + name + '.png', fullPage: true }); };
const ready = async (page) => { await page.waitForSelector('#app > *', { timeout: 8000 }); await page.waitForTimeout(250); };
const goto = async (page, hash = '/') => { await page.goto(env.url + '/#' + hash); await ready(page); };
const body = (page) => page.evaluate(() => document.body.innerText);
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('cp:h:' + k) || 'null'), HID);
async function noOverflow(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(w.sw <= w.iw + 1, `overflow orizzontale in ${label}: ${w.sw} > ${w.iw}`);
}
async function noRawKeys(page, label) {
  const txt = await body(page);
  const m = txt.match(/\b(onb|moreX|moreY|more|needs|rules|tasks|lastout|req|act|acc|setX|guide|misc|home|chore)\.[a-zA-Z][\w.]*/);
  assert.doesNotMatch(txt, /\b(null|undefined|NaN)\b/, 'valori grezzi in ' + label);
  assert.ok(!m, `chiave non tradotta in ${label}: ${m && m[0]}`);
}
async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.error('FAIL ', name, '\n', e && e.stack ? e.stack : e); }
}
const S = (o = {}) => seed({ ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });
const wait = (page, ms) => page.waitForTimeout(ms);


const SHARED = [
  { id: 's2', text: 'Portare fuori il riciclo', every: 7, enabled: true },
  { id: 's1', text: 'Buttare la spazzatura', every: 3, enabled: true },
  { id: 's3', text: 'Svuotare la lavastoviglie', every: 2, enabled: false },
];
const STATE = { s1: { history: [{ by: 'bruno', at: '2026-10-24T18:00:00.000Z' }, { by: 'anna', at: '2026-10-25T18:00:00.000Z' }] }, s2: { history: [{ by: 'carla', at: '2026-10-27T09:00:00.000Z' }] } };
const sharedSeed = (o = {}) => S({ ...o, houseExtra: { shared: SHARED, sharedState: STATE, ...(o.houseExtra || {}) } });

await scenario('shared: stato, a chi tocca, ordine per scadenza, Fatto con Annulla, due persone, equità', async () => {
  const page = await open({ seed: sharedSeed() });
  await goto(page, '/more');
  const hubRow = page.locator('a.li[href="#/tasks"]');
  assert.equal(await page.locator('a.li[href="#/more/shared"]').count(), 0, 'una sola voce «Compiti» nell\'hub');
  assert.match(await hubRow.innerText(), /1 da fare a turno/, 'hub: spazzatura scaduta (ogni 3 giorni, ultima il 25)');
  assert.match(await hubRow.locator('.chip').innerText(), /^[1-9]$/);
  await goto(page, '/more/shared');   // alias della pagina unica
  let t = await body(page);
  assert.match(t, /Compiti/); assert.match(t, /Da fare a turno/); assert.match(t, /Extra delle mansioni/);
  assert.match(t, /Buttare la spazzatura/); assert.match(t, /Portare fuori il riciclo/);
  assert.match(await page.locator('[data-testid=shared-s3]').innerText(), /Disattivato/);
  assert.equal(await page.locator('[data-testid=shared-done-s3]').count(), 0, 'compito disattivato: nessun pulsante Fatto');
  const order = await page.locator('[data-testid=turn-list] > [data-shared]').evaluateAll((els) => els.map((e) => e.dataset.shared));
  assert.deepEqual(order, ['s1', 's2', 's3'], 'per scadenza, disattivati in fondo');
  assert.match(await page.locator('[data-testid=shared-s1]').innerText(), /Da fare oggi/);
  assert.match(await page.locator('[data-testid=shared-s2]').innerText(), /tra \d giorni/);
  assert.match(await page.locator('[data-testid=shared-turn-s1]').innerText(), /Tocca a (Bruno|Carla)|Tocca a te/, 'suggerisce chi ne ha fatti meno');
  assert.doesNotMatch(await page.locator('[data-testid=shared-turn-s1]').innerText(), /Anna|te/, 'Anna l\'ha fatto per ultima: non tocca a lei');
  assert.match(await page.locator('[data-testid=shared-last-s1]').innerText(), /Ultimo: Anna/);
  await shot(page, 'shared-it-mobile');
  // Fatto + Annulla (toast 7 s)
  await page.locator('[data-testid=shared-done-s1]').click();
  await page.waitForFunction(() => (window.__app.house.sharedState.s1.history || []).length === 3);
  let st = await store(page);
  assert.equal(st.house.sharedState.s1.history.at(-1).by, 'anna');
  assert.ok(Object.values(st.log).some((l) => l.type === 'shared' && l.p.text === 'Buttare la spazzatura'));
  assert.match(await page.locator('.toast').first().innerText(), /fatto, grazie/);
  await page.locator('.toast-action').click();
  await page.waitForFunction(() => (window.__app.house.sharedState.s1.history || []).length === 2);
  // doppio click rapido su Fatto: una sola registrazione
  await page.locator('[data-testid=shared-done-s1]').dblclick();
  await wait(page, 400);
  assert.equal((await store(page)).house.sharedState.s1.history.length, 3, 'doppio tocco = una volta');
  // «Annulla l'ultimo» dallo storico (aperto toccando la riga)
  await page.locator('[data-testid=shared-open-s1]').click();
  await page.locator('[data-testid=shared-undo-s1]').click();
  await page.waitForFunction(() => (window.__app.house.sharedState.s1.history || []).length === 2);
  // un'altra persona (Bruno) segna dal suo dispositivo: la pagina si aggiorna e cambia chi tocca
  await page.locator('[data-testid=shared-open-s1]').click();   // chiudo il riquadro (con un campo in uso gli aggiornamenti aspettano)
  await page.waitForFunction(() => !document.querySelector('[data-testid=tk-panel-s1]'));
  await page.evaluate(() => window.__app.store.setHouse({ sharedState: { s1: { history: [...window.__app.house.sharedState.s1.history, { by: 'bruno', at: new Date().toISOString() }] } } }));
  await page.waitForFunction(() => /Ultimo: Bruno/.test(document.querySelector('[data-testid=shared-s1]').innerText));
  assert.match(await page.locator('[data-testid=shared-s1]').innerText(), /tra 3 giorni|domani|tra \d giorni/);
  const order2 = await page.locator('[data-testid=turn-list] > [data-shared]').evaluateAll((els) => els.map((e) => e.dataset.shared));
  assert.deepEqual(order2, ['s1', 's2', 's3'], 's1 (tra 3 giorni) prima di s2 (tra 6)');
  // equità: conteggi per persona
  const fair = await page.locator('[data-testid=shared-fair]').innerText();
  assert.match(fair, /Equità/); assert.match(fair, /Anna[\s\S]*1 volta/); assert.match(fair, /Bruno[\s\S]*2 volte/);
  await noOverflow(page, 'shared'); await noRawKeys(page, 'shared');
  await shot(page, 'shared-after');
  await done(page);
  // non admin (Carla): ultimo segnato da Anna, non può annullarlo; nessuna gestione
  const p2 = await open({ seed: sharedSeed({ me: 'carla', admin: false }) });
  await goto(p2, '/tasks');
  await p2.locator('[data-testid=shared-open-s1]').click(); await p2.waitForSelector('[data-testid=tk-panel-s1]');
  assert.equal(await p2.locator('[data-testid=shared-undo-s1]').count(), 0, 'solo chi ha segnato o admin (s1: ultimo Anna)');
  assert.equal(await p2.locator('[data-testid=tk-editor]').count(), 0, 'niente editor per chi non è admin');
  await wait(p2, 450); await p2.locator('[data-testid=shared-open-s2]').click(); await p2.waitForSelector('[data-testid=tk-panel-s2]');
  assert.equal(await p2.locator('[data-testid=shared-undo-s2]').count(), 1, 's2: ultimo Carla');
  assert.equal(await p2.locator('[data-testid=tk-add]').count(), 0);
  assert.match(await body(p2), /Solo l'admin può aggiungere/);
  await p2.locator('[data-testid=shared-done-s1]').click();
  await p2.waitForFunction(() => (window.__app.house.sharedState.s1.history || []).length === 3);
  await p2.locator('[data-testid=shared-open-s1]').click();
  await p2.waitForSelector('[data-testid=shared-undo-s1]');   // ora l'ultimo è suo
  await done(p2);
  // EN desktop dark
  const p3 = await open({ seed: sharedSeed({ houseExtra: { lang: 'en' } }), lang: 'en-US', viewport: D, dark: true });
  await goto(p3, '/more/shared'); await noRawKeys(p3, 'shared en');
  assert.match(await body(p3), /Tasks in turns/); assert.match(await body(p3), /every 3 days/); assert.match(await body(p3), /Chore extras/);
  await noOverflow(p3, 'shared desktop');
  await shot(p3, 'shared-en-desktop-dark'); await done(p3);
});

await scenario('shared: aggiunta in un gesto, modelli con Annulla, modifica in linea, disattiva, elimina con Annulla', async () => {
  const page = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', dark: true });
  await goto(page, '/tasks');
  assert.match(await body(page), /No tasks in turns/);
  await page.locator('[data-testid=shared-addall]').click();
  await page.waitForFunction(() => (window.__app.house.shared || []).length === 3);
  let st = await store(page);
  assert.deepEqual(st.house.shared.map((x) => [x.text, x.every]).sort(), [['Empty the dishwasher', 2], ['Take out the recycling', 7], ['Take out the trash', 3]]);
  await page.locator('.toast-action').click();   // Annulla: tornano vuoti
  await page.waitForFunction(() => (window.__app.house.shared || []).length === 0);
  await page.locator('[data-testid=tk-tpl-shared\\.t\\.trash]').click();   // un modello = un tocco
  await page.waitForFunction(() => (window.__app.house.shared || []).length === 1);
  await wait(page, 500);
  // nuovo compito: si digita lentamente mentre arrivano aggiornamenti remoti
  await page.locator('[data-testid=tk-add]').click();
  await page.waitForSelector('#tk-text'); await wait(page, 450);
  await page.evaluate(() => { window.__tin = document.getElementById('tk-text'); });
  await page.click('#tk-text');
  const typed = 'Water the plants & feed the cat, àèò';
  await Promise.all([page.keyboard.type(typed, { delay: 65 }),
    page.evaluate(async () => { const s = window.__app.store; for (let i = 0; i < 14; i++) { s.setHouse({ sharedState: { s_x: { history: [{ by: 'bruno', at: new Date().toISOString() }] } } }); s.setDoc('needs', 'q' + i, { text: 'q' + i, by: 'carla', at: new Date().toISOString(), done: false }); await new Promise((r) => setTimeout(r, 110)); } })]);
  assert.equal(await page.inputValue('#tk-text'), typed);
  assert.equal(await page.evaluate(() => document.getElementById('tk-text') === window.__tin && document.activeElement === window.__tin), true, 'stesso nodo e focus');
  await page.locator('[data-testid=tk-freq-7]').click();   // «ogni settimana» con un tocco
  await page.locator('.tk-ed .num button').nth(1).click();   // +1 -> 8 giorni: nessun tasto rapido acceso
  assert.equal(await page.locator('[data-testid=tk-freq-7]').getAttribute('aria-checked'), 'false');
  await shot(page, 'shared-editor-en-dark');
  await page.locator('[data-testid=tk-save]').click();
  await page.waitForFunction(() => (window.__app.house.shared || []).length === 2);
  st = await store(page);
  const nt = st.house.shared.find((x) => x.text === typed);
  assert.ok(nt && nt.every === 8 && nt.enabled === true);
  await page.waitForFunction(() => !document.querySelector('[data-testid=tk-editor]'));
  // Invio nel campo = aggiungi con le impostazioni predefinite (a turno, ogni 3 giorni)
  await wait(page, 500);
  await page.locator('[data-testid=tk-add]').click(); await page.waitForSelector('#tk-text'); await wait(page, 450);
  await page.fill('#tk-text', 'Mop the hall'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window.__app.house.shared || []).some((x) => x.text === 'Mop the hall' && x.every === 3));
  await wait(page, 500);
  // modifica in linea: tocco la riga, cambio il nome, Salva
  await page.locator('[data-testid=shared-open-' + nt.id + ']').click();
  await page.waitForSelector('[data-testid=tk-panel-' + nt.id + '] #tk-text'); await wait(page, 300);
  await page.fill('#tk-text', 'Water the plants'); await page.locator('[data-testid=tk-save]').click();
  await page.waitForFunction((i) => window.__app.house.shared.find((x) => x.id === i).text === 'Water the plants', nt.id);
  // disattiva dall'editor (interruttore «Attivo»), riattiva con l'interruttore della riga
  await wait(page, 500);
  await page.locator('[data-testid=shared-open-' + nt.id + ']').click();
  await page.waitForSelector('[data-testid=tk-panel-' + nt.id + '] .switch'); await wait(page, 300);
  await page.locator('[data-testid=tk-panel-' + nt.id + '] .switch').click(); await page.locator('[data-testid=tk-save]').click();
  await page.waitForFunction((i) => window.__app.house.shared.find((x) => x.id === i).enabled === false, nt.id);
  await wait(page, 500);
  await page.locator('[data-shared="' + nt.id + '"] .switch').click();
  await page.waitForFunction((i) => window.__app.house.shared.find((x) => x.id === i).enabled === true, nt.id);
  // elimina dall'editor: niente conferma, c'è «Undo» che ripristina anche lo storico
  await page.evaluate(() => window.__app.store.setHouse({ sharedState: { [window.__app.house.shared[0].id]: { history: [{ by: 'bruno', at: '2026-10-27T09:00:00.000Z' }] } } }));
  const first = await page.evaluate(() => window.__app.house.shared[0].id);
  await wait(page, 500);
  await page.locator('[data-testid=shared-open-' + first + ']').click();
  await page.waitForSelector('[data-testid=tk-del]'); await wait(page, 300);
  await page.locator('[data-testid=tk-del]').click();
  await page.waitForFunction(() => (window.__app.house.shared || []).length === 2);
  assert.match(await page.locator('.toast').first().innerText(), /Deleted/);
  await page.locator('.toast-action').click();
  await page.waitForFunction(() => (window.__app.house.shared || []).length === 3);
  assert.equal((await store(page)).house.sharedState[first].history.length, 1, 'lo storico torna con il compito');
  assert.equal((await store(page)).house.shared[0].id, first, 'stessa posizione');
  await noOverflow(page, 'shared manage'); await noRawKeys(page, 'shared manage');
  await done(page);
  // funzione «a turno» spenta: la pagina mostra solo gli extra; spente entrambe: funzione disattivata
  const p2 = await open({ seed: sharedSeed({ houseExtra: { features: { shared: false } } }) });
  await goto(p2, '/more'); assert.match(await body(p2), /Compiti/);
  await goto(p2, '/tasks'); assert.doesNotMatch(await body(p2), /Da fare a turno/); assert.match(await body(p2), /Extra delle mansioni/); await done(p2);
  const p4 = await open({ seed: sharedSeed({ houseExtra: { features: { shared: false, tasks: false } } }) });
  await goto(p4, '/more'); assert.equal(await p4.locator('a.li[href="#/tasks"]').count(), 0);
  await goto(p4, '/more/shared'); assert.match(await body(p4), /Funzione disattivata/); await done(p4);
});

await scenario('activity: log "shared"', async () => {
  const s = sharedSeed(); s['cp:h:' + HID].log = { l1: { at: '2026-10-28T09:30:00', by: 'bruno', type: 'shared', p: { text: 'Buttare la spazzatura' } } };
  const page = await open({ seed: s });
  await goto(page, '/activity');
  assert.match(await body(page), /Bruno ha fatto "Buttare la spazzatura"/); await noRawKeys(page, 'activity'); await done(page);
});

// ---------------------------------------------------------------- penalità checklist
const PEN_TASK = [{ id: 'k', chore: 'bathroom', text: 'Cambia il tappetino', every: 4, anchor: '2026-10-04', enabled: true }];
const DONE = { floor: 'done', bathroom: 'done', kitchen: 'done' };
async function penSeed(extra = {}) {
  const s = S({ houseExtra: { tasks: PEN_TASK, settings: { grace: 1, minRest: 3, startPriority: 4, window: 52, minNights: 3, rankBy: 'effort', taskPenalty: 1 }, ...extra } });
  return s;
}
await scenario('stats: penalità checklist per persona (chip, dettaglio, punti fatica) e regola in Impostazioni', async () => {
  const page = await open({ seed: await penSeed() });
  await goto(page, '/');
  const doer = await page.evaluate(() => window.__app.calc.out.rows[0].assigned[1]);
  await page.evaluate(async ({ doer, DONE }) => {
    const s = window.__app.store;
    await s.setDoc('weeks', '2026-10-04', { result: DONE });
    await s.setDoc('weeks', '2026-10-11', { result: DONE, awayMap: { [doer]: true } });
    await s.setDoc('weeks', '2026-10-18', { result: DONE, awayMap: { [doer]: true } });
    await s.setDoc('weeks', '2026-10-25', { result: DONE });
  }, { doer, DONE });
  await goto(page, '/stats');
  await page.waitForSelector('.rank-row');
  const chip = page.locator(`[data-testid=pen-chip-${doer}]`);
  await chip.waitFor();
  assert.match(await chip.innerText(), /−1 pt extra/);
  assert.equal(await page.locator('[data-testid^=pen-chip-]').count(), 1, 'solo chi ha lasciato l\'arretrato');
  assert.match(await page.locator('[data-testid=pen-rule]').innerText(), /ogni extra toglie 1 punti/);
  // i punti includono la penalità
  await page.locator(`.rank-row[data-person=${doer}]`).click();
  await page.waitForSelector('[data-testid=pen-detail]');
  const det = await page.locator('.sheet').innerText();
  assert.match(det, /Penalità extra: 1 \(−1 punti\)/); assert.match(det, /Compiti a turno fatti/);
  await shot(page, 'stats-pen-sheet');
  await page.keyboard.press('Escape'); await wait(page, 500);
  await shot(page, 'stats-pen-it-mobile');
  await noOverflow(page, 'stats pen'); await noRawKeys(page, 'stats pen');
  await done(page);
  // EN desktop dark
  const p2 = await open({ seed: await penSeed({ lang: 'en' }), lang: 'en-US', viewport: D, dark: true });
  await goto(p2, '/');
  const d2 = await p2.evaluate(() => window.__app.calc.out.rows[0].assigned[1]);
  await p2.evaluate(async ({ d2, DONE }) => {
    const s = window.__app.store;
    await s.setDoc('weeks', '2026-10-04', { result: DONE }); await s.setDoc('weeks', '2026-10-11', { result: DONE, awayMap: { [d2]: true } });
    await s.setDoc('weeks', '2026-10-18', { result: DONE, awayMap: { [d2]: true } }); await s.setDoc('weeks', '2026-10-25', { result: DONE });
  }, { d2, DONE });
  await goto(p2, '/stats'); await p2.waitForSelector(`[data-testid=pen-chip-${d2}]`);
  assert.match(await p2.locator(`[data-testid=pen-chip-${d2}]`).innerText(), /−1 pt extra/);
  await noRawKeys(p2, 'stats pen en'); await shot(p2, 'stats-pen-en-desktop-dark'); await done(p2);
  // Impostazioni > Regole: stepper della penalità
  const p3 = await open({ seed: S() });
  await goto(p3, '/settings/rules');
  const row = p3.locator('[data-testid=step-taskPenalty]');
  await row.waitFor();
  assert.match(await row.innerText(), /Penalità per arretrato lasciato/); assert.match(await row.innerText(), /0,5/);
  await row.locator('.num button').nth(1).click(); await row.locator('.num button').nth(1).click();   // 0,5 -> 1,5
  await p3.waitForFunction(() => window.__app.house.settings.taskPenalty === 1.5);
  await row.locator('.num button').nth(0).click(); await row.locator('.num button').nth(0).click(); await row.locator('.num button').nth(0).click(); await row.locator('.num button').nth(0).click();
  await p3.waitForFunction(() => window.__app.house.settings.taskPenalty === 0);
  await shot(p3, 'settings-rules-pen'); await noRawKeys(p3, 'settings rules'); await noOverflow(p3, 'settings rules'); await done(p3);
});

await env.close();
if (failed) { console.error(`${failed} scenari falliti`); process.exit(1); }
console.log('tutti gli scenari OK');
