// E2E del flusso turni (Playwright): node tests/e2e/flow.e2e.mjs
// Checklist obbligatoria prima di "fatto" (dialogo a 3 scelte), annulla (interruttore + toast), volontari, sostituti/offerte/risposte,
// ritardo annunciato, scelta admin, chip (concordato / ritardo / volontario / incompleto), scorciatoia spesa, EN, dark, viewport.
// Orologio finto: mercoledi' 2026-10-28 10:00 (settimana corrente = quella che chiude 2026-11-01). Screenshot in SHOTS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, seed } from './helpers.mjs';
import { compute } from '../../js/engine.js';
import { engineHouse } from '../../js/store.js';

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-tidyhouse/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/flow/';
fs.mkdirSync(SHOTS, { recursive: true });
const NOW = '2026-10-28T10:00:00', TODAY = '2026-10-28', CUR = '2026-11-01', PREV = '2026-10-25';
const MOBILE = { width: 390, height: 844 }, SMALL = { width: 320, height: 640 }, TABLET = { width: 820, height: 1180 }, DESKTOP = { width: 1440, height: 900 };
const ALL = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
const DONE3 = { '2026-10-04': ALL, '2026-10-11': ALL, '2026-10-18': ALL };      // la settimana scorsa resta da registrare
const DONE = { ...DONE3, [PREV]: ALL };
const NAME = { anna: 'Anna', bruno: 'Bruno', carla: 'Carla' };
const mk = (o = {}) => seed({ weeks: DONE, ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });

/** Chi ha quale turno (dal motore sui dati seed): stesso calcolo dell'app. */
const whoAt = (s, off = 0) => { const o = compute(engineHouse(s['cp:h:LOCALTEST001']), TODAY, 3); const r = o.rows[o.cur + off]; return { sunday: r.sunday, floor: r.assigned[0], bathroom: r.assigned[1], kitchen: r.assigned[2], row: r }; };
const P = whoAt(mk());
const F = P.floor, B = P.bathroom, K = P.kitchen;
assert.ok(F && B && K && new Set([F, B, K]).size === 3, 'tre persone con tre turni');
const P3 = whoAt(mk({ weeks: DONE3 }), -1);              // settimana scorsa (non registrata)

let env; const results = [];
async function open({ s, viewport = MOBILE, dark = false, lang = 'it-IT', hash = '#/' } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: s });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector(hash.startsWith('#/calendar') ? '.cal .week' : '[data-screen="home"]', { timeout: 8000 });
  await page.waitForTimeout(600);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(500); return page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const noOverflow = async (page, label = '') => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#layer .sheet .body')].every((b) => b.scrollWidth <= b.clientWidth + 1)), 'overflow orizzontale ' + label);
const noErrors = (page) => assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load resource/.test(e)), [], 'errori in console');
const wk = (page, s = CUR) => page.evaluate((sun) => JSON.parse(JSON.stringify(window.__app.state.weeks[sun] || {})), s);
const reqs = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state.requests || {})));
const logs = (page) => page.evaluate(() => Object.values(JSON.parse(JSON.stringify(window.__app.state.log || {}))));
const top = (page) => page.locator('#layer .sheet').last();
const sheets = (page) => page.locator('#layer .sheet').count();
const noSheets = (page) => page.waitForFunction(() => !document.querySelector('#layer .sheet'), null, { timeout: 4000 });
const closeSheets = async (page) => { for (let i = 0; i < 4 && (await sheets(page)); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(480); } };
const pressed = (page, sel, v) => page.waitForFunction(([q, x]) => { const e = document.querySelector(q); return e && e.getAttribute('aria-pressed') === x; }, [sel, String(v)], { timeout: 4000 });
const text = (page, sel) => page.locator(sel).first().innerText();
const openChore = async (page, chore, sunday = CUR) => { await page.evaluate(([s, c]) => import('/js/choresheet.js').then((m) => m.openChoreSheet(window.__app, s, c)), [sunday, chore]); await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450); };
/** Cambia persona (e admin si/no) come farebbe un altro dispositivo. */
async function as(page, id, admin = false) {
  await closeSheets(page);
  await page.evaluate(([i, a]) => { window.__app.setMe(i); if (!a) window.__app.lockAdmin(); }, [id, admin]);
  await page.waitForTimeout(700);
}
const gate = async (page, choice = 'all') => {
  try { await page.waitForSelector('[data-choice="' + choice + '"]', { timeout: 8000 }); } catch (e) { throw new Error('dialogo checklist non comparso; toast: ' + JSON.stringify(await page.locator('.toast').allInnerTexts()) + '; errori: ' + JSON.stringify(page.__errors || [])); }
  await page.click('[data-choice="' + choice + '"]');
};
async function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log('ok   ' + name + ` (${Date.now() - t0}ms)`); } catch (e) { results.push([name, false]); console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}

const run = async () => {
  env = await start();

  await test('checklist: dialogo con tre scelte (annulla / comunque / spunta tutto) e toast Annulla', async () => {
    const page = await open({ s: mk({ me: F }) });
    await page.waitForSelector('[data-testid="hero-todo"]');
    // 1) il dialogo elenca le voci mancanti; "Annulla" non scrive nulla
    await page.click('[data-testid="hero-todo"] [data-act="done"]');
    await page.waitForSelector('[data-choice="all"]');
    assert.match(await top(page).innerText(), /Checklist non completata[\s\S]*Mancano 1[\s\S]*Svuota il contenitore dell'aspirapolvere/);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.choice), 'all', 'il focus va sul primo pulsante');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement.closest('.sheet') !== null), 'Tab resta nel dialogo');
    await shot(page, 'gate-390');
    await page.click('[data-choice="cancel"]');
    await noSheets(page);
    assert.equal((await wk(page)).result?.floor ?? null, null);
    assert.ok(await page.locator('[data-testid="hero-todo"] [data-act="done"]').isEnabled(), 'il pulsante torna attivo');
    // Esc = annulla, il focus torna al pulsante
    await page.click('[data-testid="hero-todo"] [data-act="done"]');
    await page.waitForSelector('[data-choice="all"]');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    assert.equal((await wk(page)).result?.floor ?? null, null);
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-testid="hero-todo"] [data-act="done"]')), 'il focus torna sul pulsante');
    // 2) "comunque": segnato fatto ma SEGNALATO come incompleto
    await page.click('[data-testid="hero-todo"] [data-act="done"]');
    await gate(page, 'force');
    await page.waitForSelector('[data-testid="hero-done"]');
    let w = await wk(page);
    assert.equal(w.result.floor, 'done'); assert.deepEqual(w.incomplete.floor, ["Svuota il contenitore dell'aspirapolvere"]);
    assert.match(await text(page, '[data-testid="hero-done"]'), /Incompleto: mancano 1/);
    assert.match(await text(page, '.hm-chore[data-chore=floor]'), /Incompleto: mancano 1/);
    assert.match(await page.locator('.toast').last().innerText(), /incompleto \(mancano 1\)[\s\S]*Annulla/);
    assert.ok((await logs(page)).some((l) => l.type === 'incomplete'), 'registro: incompleto');
    await shot(page, 'incomplete-home-390');
    // annulla dal toast
    await page.click('.toast .toast-action');
    await page.waitForSelector('[data-testid="hero-todo"]');
    w = await wk(page); assert.equal(w.result?.floor ?? null, null); assert.equal(w.incomplete?.floor ?? null, null);
    // 3) "spunta tutto": completa la checklist e segna fatto
    await page.click('[data-testid="hero-todo"] [data-act="done"]');
    await gate(page, 'all');
    await page.waitForSelector('[data-testid="hero-done"]');
    w = await wk(page);
    assert.equal(w.result.floor, 'done'); assert.ok(w.tasksDone.t1, 'voce spuntata'); assert.equal(w.incomplete?.floor ?? null, null);
    assert.doesNotMatch(await text(page, '[data-testid="hero-done"]'), /Incompleto/);
    noErrors(page);
  });

  await test('annulla: cerchio = interruttore (44px, aria-pressed), Rimetti da fare nella hero, permessi', async () => {
    const s = mk({ me: F, weeks: { ...DONE, [CUR]: { tasksDone: { t1: { by: F, at: '2026-10-28T09:00:00' } } } } });
    const page = await open({ s });
    const tg = page.locator('.hm-chore[data-chore=floor] [data-toggle=floor]');
    assert.equal(await tg.getAttribute('aria-pressed'), 'false');
    const box = await tg.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44, 'area di tocco >= 44px: ' + JSON.stringify(box));
    await tg.click();                                   // da fare -> fatto (checklist già completa: niente dialogo)
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
    await pressed(page, '.hm-chore[data-chore=floor] [data-toggle=floor]', true);
    assert.match(await page.locator('.toast').last().innerText(), /Annulla/);
    await tg.click();                                   // fatto -> da fare
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === '');
    await pressed(page, '.hm-chore[data-chore=floor] [data-toggle=floor]', false);
    assert.match(await page.locator('.toast').last().innerText(), /Rimesso da fare/);
    // da tastiera
    await tg.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
    // toast con azione "Annulla"
    await page.click('.toast .toast-action');
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === '');
    // hero: "Rimetti da fare"
    await page.click('[data-testid="hero-todo"] [data-act="done"]');
    await page.waitForSelector('[data-testid="hero-done"]');
    await shot(page, 'hero-undo-390');
    await page.click('[data-testid="hero-done"] [data-act="undo"]');
    await page.waitForSelector('[data-testid="hero-todo"]');
    assert.equal((await wk(page)).result?.floor ?? null, null);
    noErrors(page);
    // non assegnato e non admin: interruttore spento (disabilitato) sugli altri turni
    const p2 = await open({ s: mk({ me: B, admin: false, weeks: { ...DONE, [CUR]: { result: { floor: 'done' }, resultBy: { floor: F }, tasksDone: { t1: { by: F, at: 'x' } } } } }) });
    assert.ok(await p2.locator('[data-toggle=floor]').isDisabled(), 'floor: non è il mio turno');
    assert.equal(await p2.locator('[data-toggle=floor]').getAttribute('aria-pressed'), 'true');
    assert.ok(await p2.locator('[data-toggle=kitchen]').isDisabled());
    assert.ok(await p2.locator('[data-toggle=bathroom]').isEnabled(), 'il mio turno');
    noErrors(p2);
  });

  await test('scheda turno: checklist con progresso, gate e spunte', async () => {
    const page = await open({ s: mk({ me: F }) });
    await openChore(page, 'floor');
    const sh = top(page);
    assert.match(await sh.innerText(), /Checklist del turno/);
    assert.equal(await sh.locator('[data-testid=chore-progress]').innerText(), '0/1');
    await shot(page, 'chore-checklist-390');
    await sh.locator('[data-act=done]').click();
    await gate(page, 'cancel');
    await page.waitForTimeout(500);
    assert.equal(await sheets(page), 1, 'resta la scheda turno');
    await sh.locator('[data-task=t1]').click();
    await page.waitForFunction(() => document.querySelector('#layer .sheet [data-testid=chore-progress]').textContent === '1/1');
    assert.equal(await sh.locator('[data-task=t1]').getAttribute('aria-pressed'), 'true');
    await sh.locator('[data-act=done]').click();        // tutto spuntato: niente dialogo
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
    await noSheets(page);
    assert.equal((await wk(page)).incomplete?.floor ?? null, null);
    // riaperto: "Rimetti da fare" annulla
    await openChore(page, 'floor');
    await top(page).locator('[data-act=reset]').click();
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === '');
    noErrors(page);
    // checklist spenta per la mansione: niente sezione e nessun blocco
    const p2 = await open({ s: mk({ me: F, houseExtra: { checklistOff: { floor: true } } }) });
    await openChore(p2, 'floor');
    assert.equal(await top(p2).locator('[data-task]').count(), 0);
    await top(p2).locator('[data-act=done]').click();
    await p2.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
    assert.equal(await p2.locator('[data-choice]').count(), 0, 'nessun dialogo');
    noErrors(p2);
  });

  await test('incompleto: chip ovunque, dettaglio per tutti, in evidenza per l\'admin, sparisce se recuperato', async () => {
    const miss = "Svuota il contenitore dell'aspirapolvere";
    const weeks = { ...DONE, [CUR]: { result: { floor: 'done' }, resultBy: { floor: F }, resultAt: { floor: '2026-10-28T08:00:00' }, incomplete: { floor: [miss] } } };
    // non admin (Bruno/Carla)
    const page = await open({ s: mk({ me: B, admin: false, weeks }) });
    assert.match(await text(page, '.hm-chore[data-chore=floor]'), /Incompleto: mancano 1/);
    await openChore(page, 'floor');
    assert.match(await top(page).innerText(), /Segnato fatto, ma incompleto[\s\S]*Svuota il contenitore/);
    assert.match(await top(page).locator('[data-testid=chore-chips]').innerText(), /Incompleto: mancano 1/);
    assert.equal(await top(page).locator('[data-task=t1]').count(), 0, 'non è il mio turno: voci non spuntabili');
    await shot(page, 'incomplete-sheet-390');
    await closeSheets(page);
    // calendario e foglio settimana
    await page.goto(env.url + '/#/calendar'); await page.waitForSelector('.cal .week'); await page.waitForTimeout(500);
    assert.ok(await page.locator('.week.cur [data-flow=incomplete]').count(), 'indicatore sulla card');
    assert.match(await text(page, '.week.cur'), /Incompleto: Pavimenti/);
    await page.locator('.week.cur').click(); await page.waitForTimeout(500);
    assert.match(await top(page).locator('[data-chore=floor]').innerText(), /Incompleto: mancano 1/);
    await shot(page, 'incomplete-week-390');
    await closeSheets(page);
    noErrors(page);
    // admin: avviso in Home, evidenza e recupero
    const p2 = await open({ s: mk({ me: 'anna', admin: true, weeks }) });
    assert.match(await text(p2, '[data-testid=alert-incomplete]'), /incompleto[\s\S]*mancano 1 voci/i);
    await openChore(p2, 'floor');
    assert.match(await top(p2).locator('[data-testid=incomplete-note]').innerText(), /Controlla che vengano recuperate/);
    await top(p2).locator('[data-task=t1]').click();   // l'admin la recupera
    await p2.waitForSelector('#layer .sheet [data-testid=incomplete-note]', { state: 'detached' });
    await closeSheets(p2);
    assert.equal(await p2.locator('[data-testid=alert-incomplete]').count(), 0);
    assert.doesNotMatch(await text(p2, '.hm-chore[data-chore=floor]'), /Incompleto/);
    noErrors(p2);
  });

  await test('volontario: conferma con spiegazione, segnalato all\'assegnato e nel registro, lui può annullare', async () => {
    const page = await open({ s: mk({ me: B, admin: false }) });
    await openChore(page, 'floor');
    const sh = top(page);
    assert.equal(await sh.locator('[data-act=done]').count(), 0);
    assert.equal(await sh.locator('[data-act=cover]').count(), 0);
    assert.match(await sh.locator('[data-act=volunteer]').innerText(), /Lo faccio io subito, anche se non spetta a me/);
    await shot(page, 'others-sheet-390');
    await sh.locator('[data-act=volunteer]').click();
    await page.waitForSelector('[data-choice="ok"]');
    assert.match(await top(page).innerText(), new RegExp(`Questo turno spetta a ${NAME[F]}[\\s\\S]*segnalato a ${NAME[F]} e nel registro`));
    await shot(page, 'volunteer-confirm-390');
    await page.click('[data-choice="cancel"]'); await page.waitForTimeout(500);
    assert.equal((await wk(page)).volunteer?.floor ?? null, null);
    await sh.locator('[data-act=volunteer]').click();
    await page.waitForSelector('[data-choice="ok"]'); await page.click('[data-choice="ok"]');
    await gate(page, 'all');                                    // la checklist vale anche per i volontari
    await page.waitForFunction(() => window.__app.state.weeks['2026-11-01'] && window.__app.state.weeks['2026-11-01'].volunteer);
    const w = await wk(page);
    assert.equal(w.result.floor, 'by:' + B); assert.equal(w.volunteer.floor, B);
    assert.match(await page.locator('.toast').last().innerText(), new RegExp(`segnalato a ${NAME[F]}`));
    assert.ok((await logs(page)).some((l) => l.type === 'volunteer' && l.p.chore === 'floor'), 'registro: volontario');
    assert.ok(Object.values(await reqs(page)).some((q) => q.kind === 'notice' && q.code === 'volunteer' && q.to === F), 'avviso all\'assegnato');
    await closeSheets(page);
    assert.match(await text(page, '.hm-chore[data-chore=floor]'), new RegExp(`Volontario: ${NAME[B]}`));
    noErrors(page);
    // l'assegnato vede l'avviso e può annullare
    await as(page, F);
    assert.match(await text(page, '[data-testid=alert-volunteer]'), new RegExp(`${NAME[B]} ha fatto Pavimenti al posto tuo`));
    await shot(page, 'volunteer-alert-390');
    assert.ok(await page.locator('[data-toggle=floor]').isEnabled());
    await page.click('[data-toggle=floor]');
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === '');
    assert.equal((await wk(page)).volunteer?.floor ?? null, null);
    noErrors(page);
  });

  await test('sostituto: chiedi → risposta Accetta → concordato → "ho pulito io" senza segnalazione; Rifiuta', async () => {
    const page = await open({ s: mk({ me: F, admin: false }) });
    await openChore(page, 'floor');
    await top(page).locator('[data-act=ask]').click();
    await page.waitForSelector('#layer .sheet [data-act=ask-send]');
    assert.ok(await top(page).locator('.cs-pick').count() === 3, 'chiunque + 2 persone');
    await shot(page, 'ask-390');
    await top(page).locator(`.cs-pick[data-who=${B}]`).click();
    assert.equal(await top(page).locator(`.cs-pick[data-who=${B}]`).getAttribute('aria-pressed'), 'true');
    await top(page).locator('[data-act=ask-send]').click();
    await page.waitForSelector('#layer .sheet [data-testid=cover-req]');
    assert.match(await top(page).locator('[data-testid=cover-req]').innerText(), new RegExp(`Hai chiesto un sostituto a ${NAME[B]}`));
    const q = Object.values(await reqs(page)).find((r) => r.kind === 'cover');
    assert.equal(q.from, F); assert.equal(q.to, B); assert.equal(q.status, 'pending');
    await shot(page, 'cover-pending-390');
    // la persona interpellata risponde dalla Home
    await as(page, B);
    assert.match(await text(page, '[data-testid=alerts-badge]'), /1/);
    assert.match(await text(page, '[data-widget=alerts] [data-testid^=req-]'), new RegExp(`${NAME[F]} chiede a te: Pavimenti`));
    await shot(page, 'cover-alert-390');
    await page.click('[data-widget=alerts] [data-act=req-yes]');
    await page.waitForFunction((b) => (window.__app.state.weeks['2026-11-01'] || {}).agreed && window.__app.state.weeks['2026-11-01'].agreed.floor === b, B);
    await page.waitForSelector('[data-widget=alerts] [data-testid^=req-]', { state: 'detached' });   // la richiesta sparisce
    await page.waitForSelector('[data-testid=alert-agreed]');
    assert.match(await text(page, '.hm-chore[data-chore=floor]'), new RegExp(`Concordato con ${NAME[B]}`));
    assert.ok((await logs(page)).some((l) => l.type === 'agreed'));
    // ora "ho pulito io al posto di X" è diretto (concordato): nessuna segnalazione di volontariato
    assert.match(await text(page, '[data-testid=alert-agreed]'), /Hai concordato: Pavimenti/);
    await page.waitForTimeout(900);                       // la Home si ridisegna a cascata dopo la risposta: si aspetta che si fermi
    await page.click('[data-testid=alert-agreed] [data-act=done]');
    await gate(page, 'all');
    await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'by');
    const w = await wk(page);
    assert.equal(w.result.floor, 'by:' + B); assert.equal(w.volunteer?.floor ?? null, null);
    assert.ok(!Object.values(await reqs(page)).some((r) => r.code === 'volunteer'));
    noErrors(page);
    // richiesta a chiunque + rifiuto
    const p2 = await open({ s: mk({ me: B, admin: false }) });
    await openChore(p2, 'bathroom');
    await top(p2).locator('[data-act=ask]').click();
    await p2.waitForSelector('#layer .sheet [data-act=ask-send]');
    await p2.waitForTimeout(450);                              // la guardia anti doppio tocco ignora due click vicini entro 350 ms
    await top(p2).locator('[data-act=ask-send]').click();     // "Chiunque" è la scelta predefinita
    await p2.waitForSelector('#layer .sheet [data-testid=cover-req]');
    assert.match(await top(p2).locator('[data-testid=cover-req]').innerText(), /chiunque/);
    await as(p2, K);
    assert.match(await text(p2, '[data-widget=alerts] [data-testid^=req-]'), new RegExp(`${NAME[B]} cerca un sostituto: Bagno`));
    await p2.click('[data-widget=alerts] [data-act=req-no]');
    await p2.waitForFunction(() => Object.values(window.__app.state.requests).some((r) => r.kind === 'cover' && r.status === 'declined'));
    await p2.waitForSelector('[data-widget=alerts] [data-testid^=req-]', { state: 'detached' });
    assert.equal((await wk(p2)).agreed?.bathroom ?? null, null);
    noErrors(p2);
  });

  await test('offerta: serve il consenso dell\'assegnato (rifiuta / accetta)', async () => {
    const page = await open({ s: mk({ me: K, admin: false }) });
    await openChore(page, 'bathroom');
    assert.match(await top(page).locator('[data-act=offer]').innerText(), new RegExp(`Lo faccio io[\\s\\S]*${NAME[B]}`));
    await top(page).locator('[data-act=offer]').click();
    await page.waitForSelector('#layer .sheet [data-act=offer-send]');
    await top(page).locator('[data-act=offer-send]').click();
    await page.waitForSelector('#layer .sheet [data-act=offer-pending]');
    const q = Object.values(await reqs(page)).find((r) => r.kind === 'offer');
    assert.equal(q.from, K); assert.equal(q.to, B); assert.equal(q.chore, 'bathroom'); assert.equal(q.terms, 'repay');
    await closeSheets(page);
    await as(page, B);
    assert.match(await text(page, '[data-widget=alerts] [data-testid^=req-]'), new RegExp(`${NAME[K]} si offre di fare Bagno`));
    await page.click('[data-widget=alerts] [data-act=req-no]');
    await page.waitForFunction(() => Object.values(window.__app.state.requests).some((r) => r.kind === 'offer' && r.status === 'declined'));
    assert.equal((await wk(page)).agreed?.bathroom ?? null, null);
    // seconda offerta: accettata
    await as(page, K);
    await openChore(page, 'bathroom');
    await top(page).locator('[data-act=offer]').click();
    await page.waitForSelector('#layer .sheet [data-act=offer-send]');
    await top(page).locator('[data-act=offer-send]').click();
    await page.waitForSelector('#layer .sheet [data-act=offer-pending]');
    await as(page, B);
    await shot(page, 'offer-alert-390');
    await page.click('[data-widget=alerts] [data-act=req-yes]');
    await page.waitForFunction((k) => (window.__app.state.weeks['2026-11-01'] || {}).agreed && window.__app.state.weeks['2026-11-01'].agreed.bathroom === k, K);
    await page.waitForFunction((n) => /Concordato con/.test(document.querySelector('.hm-chore[data-chore=bathroom]').innerText) && document.querySelector('.hm-chore[data-chore=bathroom]').innerText.includes(n), NAME[K]);
    assert.match(await page.locator('.toast').last().innerText(), new RegExp(`lo farà ${NAME[K]}`));
    noErrors(page);
  });

  await test('ritardo: giorni (14), selezione che non si perde con gli aggiornamenti, chip e rimozione', async () => {
    const page = await open({ s: mk({ me: F, admin: false }) });
    await openChore(page, 'floor');
    await top(page).locator('[data-act=delay]').click();
    await page.waitForSelector('#layer .sheet .fl-days');
    assert.equal(await top(page).locator('.fl-days button').count(), 14);
    assert.equal(await top(page).locator('.fl-days button:disabled').count(), 0);
    assert.match(await top(page).innerText(), /Avvisa i coinquilini quando lo farai/);
    assert.ok(await top(page).locator('[data-act=delay-save]').isDisabled(), 'serve un giorno');
    await top(page).locator('[data-day="2026-11-03"]').click();
    // un aggiornamento dallo store (altro dispositivo) non deve far perdere la scelta
    await page.evaluate(() => window.__app.store.setDoc('weeks', '2026-11-15', { note: 'altro dispositivo' }));
    await page.waitForTimeout(400);
    assert.equal(await top(page).locator('[data-day="2026-11-03"]').getAttribute('aria-pressed'), 'true', 'scelta mantenuta');
    assert.match(await top(page).locator('[data-act=delay-save]').innerText(), /Annuncia: martedì 3 nov/);
    await shot(page, 'delay-390');
    await top(page).locator('[data-act=delay-save]').click();
    await page.waitForSelector('#layer .sheet [data-flow=delay]');
    assert.equal((await wk(page)).delay.floor, '2026-11-03');
    assert.match(await top(page).locator('[data-flow=delay]').innerText(), /In ritardo: lo farà il 3 nov/);
    assert.match(await text(page, '.hm-chore[data-chore=floor]'), /In ritardo: lo farà il 3 nov/);
    assert.ok((await logs(page)).some((l) => l.type === 'delay'));
    await top(page).locator('[data-act=delay-clear-quick]').click();
    await page.waitForFunction(() => !((window.__app.state.weeks['2026-11-01'] || {}).delay || {}).floor);
    assert.equal(await top(page).locator('[data-flow=delay]').count(), 0);
    noErrors(page);
    // settimana scorsa non registrata: i giorni già passati sono disattivati; l'admin può "scegliere chi lo fa"
    const s3 = mk({ me: P3.floor, admin: false, weeks: DONE3 });
    const p2 = await open({ s: s3 });
    await openChore(p2, 'floor', PREV);
    await top(p2).locator('[data-act=delay]').click();
    await p2.waitForSelector('#layer .sheet .fl-days');
    assert.equal(await top(p2).locator('.fl-days button:disabled').count(), 2, '26 e 27 ott già passati');
    noErrors(p2);
  });

  await test('admin: sceglie chi fa una mansione non svolta dal foglio settimana (sostituto equo evidenziato)', async () => {
    const page = await open({ s: mk({ me: 'anna', admin: true, weeks: DONE3 }), hash: '#/calendar' });
    await page.locator(`.week[data-sunday="${PREV}"]`).click(); await page.waitForTimeout(550);
    assert.equal(await top(page).locator('[data-assign]').count(), 3, 'una per mansione non svolta');
    await shot(page, 'week-assign-390');
    await top(page).locator('[data-assign=kitchen]').click();
    await page.waitForSelector('#layer .sheet [data-who]');
    await page.waitForTimeout(450);
    assert.match(await top(page).innerText(), /Chi deve farlo\?/);
    const sub = P3.row.subs[2];
    if (sub && sub !== P3.kitchen) assert.equal(await top(page).locator('.cs-pick.sug').getAttribute('data-who'), sub, 'consigliato in evidenza');
    assert.equal(await top(page).locator('.cs-pick').first().getAttribute('data-who'), sub && sub !== P3.kitchen ? sub : await top(page).locator('.cs-pick').first().getAttribute('data-who'));
    await shot(page, 'assign-390');
    const pick = ['bruno', 'carla', 'anna'].find((id) => id !== P3.kitchen && id !== 'anna');
    await top(page).locator(`.cs-pick[data-who=${pick}]`).click();
    await page.waitForFunction(([s, p]) => ((window.__app.state.weeks[s] || {}).agreed || {}).kitchen === p, [PREV, pick]);
    await page.waitForTimeout(500);
    assert.equal(await sheets(page), 1, 'si chiude solo la scelta');
    assert.match(await top(page).locator('[data-chore=kitchen]').innerText(), new RegExp(`Concordato con ${NAME[pick]}`));
    assert.ok(Object.values(await reqs(page)).some((q) => q.kind === 'notice' && q.code === 'assigned' && q.to === pick), 'avviso alla persona scelta');
    // togliere l'assegnazione
    await top(page).locator('[data-assign=kitchen]').click();
    await page.waitForSelector('#layer .sheet [data-act=assign-clear]'); await page.waitForTimeout(450);
    await top(page).locator('[data-act=assign-clear]').click();
    await page.waitForFunction((s) => !((window.__app.state.weeks[s] || {}).agreed || {}).kitchen, PREV);
    noErrors(page);
    // dalla scheda turno (admin) e non admin: niente scelta
    await closeSheets(page);
    await openChore(page, 'floor', PREV);
    assert.equal(await top(page).locator('[data-act=assign]').count(), 1);
    const p2 = await open({ s: mk({ me: B, admin: false, weeks: DONE3 }), hash: '#/calendar' });
    await p2.locator(`.week[data-sunday="${PREV}"]`).click(); await p2.waitForTimeout(550);
    assert.equal(await top(p2).locator('[data-assign]').count(), 0);
    noErrors(p2);
  });

  await test('chip ovunque: concordato, ritardo, volontario, incompleto (Home, card, foglio settimana, scheda)', async () => {
    const miss = "Svuota il contenitore dell'aspirapolvere";
    const weeks = { ...DONE, [PREV]: { result: { floor: 'done', bathroom: `by:${K}`, kitchen: 'done' }, volunteer: { bathroom: K }, resultBy: { bathroom: K } },
      [CUR]: { result: { floor: 'done' }, resultBy: { floor: F }, incomplete: { floor: [miss] }, agreed: { kitchen: B }, delay: { bathroom: '2026-11-03' } } };
    const s = mk({ me: 'anna', admin: true, weeks });
    const page = await open({ s });
    const t = await text(page, '[data-widget=week]');
    assert.match(t, /Incompleto: mancano 1/); assert.match(t, new RegExp(`Concordato con ${NAME[B]}`)); assert.match(t, /In ritardo: lo farà il 3 nov/);
    await shot(page, 'chips-home-390');
    await page.goto(env.url + '/#/calendar'); await page.waitForSelector('.cal .week'); await page.waitForTimeout(500);
    const card = page.locator('.week.cur');
    for (const k of ['incomplete', 'agreed', 'delay']) assert.ok(await card.locator(`[data-flow=${k}]`).count(), 'indicatore ' + k);
    assert.ok(await page.locator(`.week[data-sunday="${PREV}"] [data-flow=volunteer]`).count(), 'volontario nella card');
    await shot(page, 'chips-cal-390');
    await card.click(); await page.waitForTimeout(550);
    const sh = (await top(page).innerText());
    assert.match(sh, /Incompleto: mancano 1/); assert.match(sh, /Concordato con/); assert.match(sh, /In ritardo: lo farà il 3 nov/);
    await shot(page, 'chips-week-390');
    await closeSheets(page);
    await page.locator(`.week[data-sunday="${PREV}"]`).click(); await page.waitForTimeout(550);
    assert.match(await top(page).innerText(), new RegExp(`Volontario: ${NAME[K]}`));
    await closeSheets(page);
    await openChore(page, 'kitchen');
    assert.match(await top(page).locator('[data-testid=chore-chips]').innerText(), new RegExp(`Concordato con ${NAME[B]}`));
    noErrors(page);
  });

  await test('Home: scorciatoia "Lista della spesa" con badge, solo se la funzione è attiva', async () => {
    const needs = { n1: { text: 'Carta igienica', urgent: true, by: 'bruno', at: '2026-10-27T10:00:00Z', done: false }, n2: { text: 'Sapone', by: 'anna', at: '2026-10-27T11:00:00Z', done: false }, n3: { text: 'Sale', by: 'anna', at: '2026-10-27T12:00:00Z', done: true } };
    const page = await open({ s: mk({ me: 'anna', needs }) });
    const q = page.locator('[data-widget=quick] [data-q=shop]');
    assert.match(await q.innerText(), /Lista della spesa/);
    assert.equal(await q.locator('.hm-qbadge').innerText(), '2');
    assert.ok(await q.locator('svg').count());
    await shot(page, 'quick-shop-390');
    await q.click();
    await page.waitForFunction(() => location.hash === '#/needs');
    noErrors(page);
    const p2 = await open({ s: mk({ me: 'anna', needs, houseExtra: { features: { needs: false } } }) });
    assert.equal(await p2.locator('[data-q=shop]').count(), 0);
    noErrors(p2);
  });

  await test('niente sfarfallio: gli sheet non si ridisegnano se i dati rilevanti non cambiano; il focus resta', async () => {
    const page = await open({ s: mk({ me: F }) });
    await openChore(page, 'floor');
    await page.evaluate(() => { window.__mark = document.querySelector('#layer .sheet [data-act=done]'); });
    await page.evaluate(() => window.__app.store.setDoc('views', 'vx', { at: 'x', device: 'd', screen: 'home' }));
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => window.__mark.isConnected && document.querySelector('#layer .sheet [data-act=done]') === window.__mark), 'nessun ridisegno');
    await page.focus('#layer .sheet [data-task=t1]');
    await page.evaluate(() => window.__app.store.setDoc('weeks', '2026-11-08', { note: 'x' }));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.task), 't1', 'il focus torna sul controllo');
    noErrors(page);
  });

  await test('EN + dark: Home, scheda, dialogo (390 e 320)', async () => {
    const miss = "Svuota il contenitore dell'aspirapolvere";
    const weeks = { ...DONE, [CUR]: { agreed: { kitchen: B }, delay: { bathroom: '2026-11-03' }, result: { floor: 'done' }, resultBy: { floor: F }, incomplete: { floor: [miss] } } };
    const extra = { 'cp:prefs': { lang: 'en' } };
    for (const [vp, tag] of [[MOBILE, '390'], [SMALL, '320']]) {
      const page = await open({ s: mk({ me: K, admin: false, weeks, extra }), viewport: vp, dark: true, lang: 'en-US' });
      assert.match(await text(page, '[data-widget=week]'), /Incomplete: 1 missing/);
      assert.match(await text(page, '[data-widget=week]'), /Late: will do it on 3 Nov/);
      await noOverflow(page, 'home ' + tag);
      await shot(page, `en-dark-home-${tag}`);
      await openChore(page, 'floor');
      assert.match(await top(page).innerText(), /Marked done, but incomplete/);
      await noOverflow(page, 'sheet ' + tag);
      await shot(page, `en-dark-sheet-${tag}`);
      await top(page).locator('[data-act=offer]').count();
      await closeSheets(page);
      await openChore(page, 'kitchen');
      assert.match(await top(page).innerText(), /Agreed with Bruno|Agreed with Carla|Agreed with Anna/);
      assert.match(await top(page).innerText(), /Mark done|Put back/);
      await noOverflow(page, 'sheet kitchen ' + tag);
      await closeSheets(page);
      noErrors(page);
    }
    // dialogo checklist in EN a 320px
    const g = await open({ s: mk({ me: F, extra }), viewport: SMALL, dark: true, lang: 'en-US' });
    await g.click('[data-testid="hero-todo"] [data-act="done"]');
    await g.waitForSelector('[data-choice="all"]'); await g.waitForTimeout(450);
    assert.match(await top(g).innerText(), /Checklist not finished[\s\S]*Tick all and mark done[\s\S]*Mark done anyway/);
    await noOverflow(g, 'gate 320');
    await shot(g, 'en-dark-gate-320');
    noErrors(g);
  });

  await test('viewport: tablet 820 e desktop 1440 (pannello settimana con interruttori e chip)', async () => {
    const weeks = { ...DONE, [CUR]: { agreed: { kitchen: B }, delay: { bathroom: '2026-11-03' } } };
    const tab = await open({ s: mk({ me: 'anna', admin: true, weeks }), viewport: TABLET });
    await noOverflow(tab, 'tablet home');
    await shot(tab, 'home-820');
    await openChore(tab, 'kitchen');
    await shot(tab, 'sheet-820');
    await closeSheets(tab);
    noErrors(tab);
    const desk = await open({ s: mk({ me: 'anna', admin: true, weeks: { ...DONE3, [CUR]: weeks[CUR] } }), viewport: DESKTOP, hash: '#/calendar' });
    await desk.waitForSelector('.cal-panel [data-toggle=floor]');
    assert.ok(await desk.locator('.cal-panel [data-flow], .cal-panel .chip').count());
    await noOverflow(desk, 'desktop calendar');
    await shot(desk, 'calendar-1440');
    await desk.locator('.cal-panel [data-toggle=floor]').click();
    await gate(desk, 'all');
    await desk.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
    await pressed(desk, '.cal-panel [data-toggle=floor]', true);
    await shot(desk, 'calendar-1440-done');
    noErrors(desk);
    const home = await open({ s: mk({ me: 'anna', admin: true, weeks }), viewport: DESKTOP });
    await noOverflow(home, 'desktop home');
    await shot(home, 'home-1440');
    noErrors(home);
  });

  await test('arretrati di checklist: scalano a chi non li ha fatti (anche con un\'altra mansione); se è assente passano all\'assegnato', async () => {
    const task = { id: 't9', chore: 'floor', text: 'Pulisci dietro i mobili', every: 2, anchor: '2026-10-25', enabled: true };
    const hx = { tasks: [task] };
    const base = mk({ houseExtra: hx });
    const Xp = whoAt(base, -1).floor, Fc = whoAt(base).floor;      // chi aveva i pavimenti quando la voce scadeva / chi li ha adesso
    assert.ok(Xp && Fc && Xp !== Fc, 'persone diverse tra le due settimane');
    // 1) Xp (che ora ha un\'altra mansione) vede l\'arretrato come suo e lo può spuntare
    const page = await open({ s: mk({ me: Xp, admin: false, houseExtra: hx }) });
    const item = page.locator('[data-widget=checklist] [data-task=t9]');
    await item.waitFor();
    assert.equal(await item.getAttribute('data-reason'), 'arrears');
    assert.match(await item.innerText(), /Arretrato della settimana del 25 ott: tocca a te perché non l'hai fatto/);
    assert.ok(await item.isEnabled());
    await shot(page, 'arrears-home-390');
    await item.click();
    await page.waitForFunction(() => { const w = window.__app.state.weeks['2026-11-01'] || {}; return !!(w.tasksDone && w.tasksDone.t9); });
    assert.equal((await wk(page)).tasksDone.t9.by, Xp);
    noErrors(page);
    // 2) chi ha i pavimenti adesso (Fc) non è bloccato dall'arretrato di un altro che è a casa; lo vede col nome del responsabile
    const p2 = await open({ s: mk({ me: Fc, admin: false, houseExtra: hx }) });
    assert.equal(await p2.locator('[data-widget=checklist] [data-task=t9]').count(), 0, 'non è sua');
    await openChore(p2, 'floor');
    assert.match(await top(p2).locator('.cs-task').innerText(), new RegExp(`tocca a ${NAME[Xp]} perché non l'ha fatto`));
    await shot(p2, 'arrears-sheet-390');
    await top(p2).locator('[data-act=done]').click();
    await p2.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
    assert.equal(await p2.locator('[data-choice]').count(), 0, 'nessun dialogo: la voce non è sua');
    noErrors(p2);
    // 3) Xp assente: la voce passa a chi ha la mansione adesso, e blocca il suo "fatto"
    const away = { [CUR]: { awayMap: { [Xp]: true } } };
    const A2 = whoAt(mk({ weeks: { ...DONE, ...away }, houseExtra: hx })).floor;
    assert.notEqual(A2, Xp);
    const p3 = await open({ s: mk({ me: A2, admin: false, weeks: { ...DONE, ...away }, houseExtra: hx }) });
    assert.match(await text(p3, '[data-widget=checklist]'), /Pulisci dietro i mobili/);
    await p3.click('[data-testid="hero-todo"] [data-act="done"]');
    await p3.waitForSelector('[data-choice="all"]');
    assert.match(await top(p3).innerText(), /Pulisci dietro i mobili/);
    await p3.click('[data-choice="cancel"]');
    noErrors(p3);
  });

  await test('compiti condivisi: widget con stato, a chi tocca, Fatto + Annulla, invito admin, funzione spenta, editor layout', async () => {
    const hx = { shared: [{ id: 's1', text: 'Butta la spazzatura', every: 2, enabled: true }], sharedState: { s1: { history: [{ by: 'bruno', at: '2026-10-26T20:00:00.000Z' }] } } };
    const page = await open({ s: mk({ me: 'anna', admin: false, houseExtra: hx }) });
    const w = page.locator('[data-widget=shared]');
    await w.waitFor();
    const t = await w.innerText();
    assert.match(t, /Compiti condivisi/); assert.match(t, /Butta la spazzatura/); assert.match(t, /Da fare/); assert.match(t, /Tocca a/);
    assert.match(await w.locator('[data-testid=shared-last]').innerText(), /Ultimo: Bruno, 2 giorni fa/);
    const btn = w.locator('[data-act=shared-done]');
    const box = await btn.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44, 'area >= 44px');
    await w.scrollIntoViewIfNeeded(); await shot(page, 'shared-390');
    await noOverflow(page, 'shared');
    await btn.click();
    await page.waitForFunction(() => ((window.__app.house.sharedState || {}).s1 || {}).history.length === 2);
    assert.equal(await page.evaluate(() => window.__app.house.sharedState.s1.history[1].by), 'anna');
    assert.match(await page.locator('.toast').last().innerText(), /fatto, grazie[\s\S]*Annulla/);
    await page.waitForFunction(() => /tra 2 giorni/.test(document.querySelector('[data-widget=shared]').innerText));
    await page.click('.toast .toast-action');
    await page.waitForFunction(() => window.__app.house.sharedState.s1.history.length === 1);
    noErrors(page);
    // nessun compito: l'invito si vede solo all'admin
    const adm = await open({ s: mk({ me: 'anna', admin: true }) });
    assert.equal(await adm.getAttribute('[data-testid=shared-invite]', 'href'), '#/more/shared');
    await adm.locator('[data-widget=shared]').scrollIntoViewIfNeeded(); await shot(adm, 'shared-invite-390');
    const usr = await open({ s: mk({ me: 'anna', admin: false }) });
    assert.equal(await usr.locator('[data-widget=shared]').count(), 0);
    // funzione spenta: sparisce
    const off = await open({ s: mk({ me: 'anna', houseExtra: { ...hx, features: { shared: false } } }) });
    assert.equal(await off.locator('[data-widget=shared]').count(), 0);
    // inglese + dark
    const en = await open({ s: mk({ me: 'anna', admin: false, houseExtra: hx, extra: { 'cp:prefs': { lang: 'en' } } }), dark: true, lang: 'en-US', viewport: SMALL });
    assert.match(await text(en, '[data-widget=shared]'), /Shared tasks[\s\S]*To do[\s\S]*Last: Bruno, 2 days ago/);
    await noOverflow(en, 'shared en 320');
    await en.locator('[data-widget=shared]').scrollIntoViewIfNeeded(); await shot(en, 'shared-en-dark-320');
    // l'editor del layout Home elenca il widget
    await page.evaluate(() => { location.hash = '#/settings/home'; });
    await page.waitForSelector('[data-testid=w-shared]');
    assert.match(await page.locator('[data-testid=w-shared]').locator('xpath=ancestor::*[contains(@class,"li")][1]').innerText(), /Compiti condivisi/);
    noErrors(en);
  });

  await test('"lo faccio io": due schede (con recupero / favore) con conseguenze per entrambi; il favore passa il turno', async () => {
    // offerta: K propone un favore a B (assegnato del bagno)
    const page = await open({ s: mk({ me: K, admin: false }) });
    await openChore(page, 'bathroom');
    await top(page).locator('[data-act=offer]').click();
    await page.waitForSelector('#layer .sheet .fl-terms');
    const sh = top(page);
    assert.equal(await sh.locator('.fl-term').count(), 2);
    assert.equal(await sh.locator('[data-terms=repay]').getAttribute('aria-pressed'), 'true', 'preselezionato "con recupero", bene in vista');
    assert.match(await sh.locator('[data-terms=repay]').innerText(), /Lo faccio io, tu recuperi/);
    assert.match(await sh.locator('[data-testid=terms-effect-repay]').innerText(), new RegExp(`${NAME[B]}: recupera la settimana prossima · ${NAME[K]}: guadagna 1 riposo`));
    assert.match(await sh.locator('[data-terms=gift]').innerText(), /Lo faccio io al posto tuo e mi va bene così[\s\S]*Favore/);
    assert.match(await sh.locator('[data-testid=terms-effect-gift]').innerText(), new RegExp(`${NAME[B]}: nessun debito · ${NAME[K]}: il turno è suo`));
    await shot(page, 'terms-offer-390');
    await sh.locator('[data-terms=gift]').click();
    assert.equal(await sh.locator('[data-terms=gift]').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.__app.store.setDoc('weeks', '2026-11-15', { note: 'x' }));   // la scelta sopravvive agli aggiornamenti
    await page.waitForTimeout(300);
    assert.equal(await sh.locator('[data-terms=gift]').getAttribute('aria-pressed'), 'true');
    await sh.locator('[data-act=offer-send]').click();
    await page.waitForSelector('#layer .sheet [data-act=offer-pending]');
    assert.equal(Object.values(await reqs(page)).find((r) => r.kind === 'offer').terms, 'gift');
    // B vede la modalità prima di rispondere
    await as(page, B);
    const al = page.locator('[data-widget=alerts] [data-testid^=req-]');
    assert.match(await al.innerText(), new RegExp(`È un favore: il turno passa a ${NAME[K]}, nessun recupero per ${NAME[B]}`));
    assert.equal(await al.locator('.hm-terms').getAttribute('data-terms'), 'gift');
    await shot(page, 'terms-alert-390');
    await page.waitForTimeout(700);
    await al.locator('[data-act=req-yes]').click();
    await page.waitForFunction((k) => ((window.__app.state.weeks['2026-11-01'] || {}).swap || {}).bathroom === k, K);
    await page.waitForFunction((k) => window.__app.calc.out.rows[window.__app.calc.out.cur].assigned[1] === k, K);   // il turno è passato a K
    noErrors(page);
    // richiesta: F chiede un favore a chiunque; la richiesta mostra "con recupero" se lasciata predefinita
    const p2 = await open({ s: mk({ me: F, admin: false }) });
    await openChore(p2, 'floor');
    await top(p2).locator('[data-act=ask]').click();
    await p2.waitForSelector('#layer .sheet .fl-terms');
    assert.match(await top(p2).locator('[data-testid=terms-effect-repay]').innerText(), new RegExp(`${NAME[F]}: recupera la settimana prossima · chi accetta: guadagna 1 riposo`));
    await top(p2).locator(`.cs-pick[data-who=${B}]`).click();
    assert.match(await top(p2).locator('[data-testid=terms-effect-gift]').innerText(), new RegExp(`${NAME[F]}: nessun debito · ${NAME[B]}: il turno è suo`));
    await shot(p2, 'terms-ask-390');
    await top(p2).locator('[data-act=ask-send]').click();
    await p2.waitForSelector('#layer .sheet [data-testid=cover-req]');
    const q = Object.values(await reqs(p2)).find((r) => r.kind === 'cover');
    assert.equal(q.terms, 'repay');
    assert.match(await top(p2).locator('[data-testid=cover-req]').innerText(), /Con recupero/);
    // volontario: spiega le conseguenze e offre la via del favore (offerta con consenso)
    const p3 = await open({ s: mk({ me: B, admin: false }) });
    await openChore(p3, 'floor');
    await top(p3).locator('[data-act=volunteer]').click();
    await p3.waitForSelector('[data-choice="gift"]');
    assert.match(await top(p3).innerText(), /deve un recupero e tu guadagni 1 riposo[\s\S]*Proponi un favore/);
    await p3.click('[data-choice="gift"]');
    await p3.waitForFunction(() => Object.values(window.__app.state.requests).some((r) => r.kind === 'offer' && r.terms === 'gift'));
    assert.equal((await wk(p3)).result?.floor ?? null, null, 'nessun "fatto" senza consenso');
    noErrors(p3);
    // EN a 320
    const en = await open({ s: mk({ me: K, admin: false, extra: { 'cp:prefs': { lang: 'en' } } }), viewport: SMALL, dark: true, lang: 'en-US' });
    await openChore(en, 'bathroom');
    await top(en).locator('[data-act=offer]').click();
    await en.waitForSelector('#layer .sheet .fl-terms');
    assert.match(await top(en).innerText(), /I'll do it, you make it up[\s\S]*I'll do it for you and that's fine[\s\S]*Favor/);
    await noOverflow(en, 'terms 320');
    await shot(en, 'terms-en-dark-320');
    noErrors(en);
  });

  await env.close();
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} scenari ok`);
  process.exit(failed.length ? 1 : 0);
};
run().catch(async (e) => { console.error(e); try { await env.close(); } catch { /* ignore */ } process.exit(1); });
