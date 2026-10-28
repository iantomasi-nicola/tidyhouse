// E2E del calendario e dei fogli turno (Playwright). Esecuzione: node tests/e2e/calendar.e2e.mjs
// Orologio finto: mercoledì 2026-10-28 10:00 (settimana corrente = quella che chiude 2026-11-01, indice 4).
// Variabili: SHOTS=<cartella> per salvare gli screenshot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';
const CUR = '2026-11-01';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/calendar/';
fs.mkdirSync(SHOTS, { recursive: true });

const env = await start();
const MINE = /(calendar|choresheet|strings\/cal)/;

/** Apre #/calendar con i dati di prova. */
async function mk({ me = 'anna', admin = true, lang = 'it-IT', viewport, dark, houseExtra = {}, weeks, features, path: hash = '#/calendar' } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: seed({ me, admin, weeks, houseExtra: { requireRules: false, ...(features ? { features } : {}), ...houseExtra } }) });
  page.__bad = [];
  page.on('response', (r) => { if (r.status() >= 400) page.__bad.push(r.status() + ' ' + r.url()); });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector('.cal .week', { timeout: 8000 });
  await page.waitForTimeout(250);
  return page;
}
const topSheet = (page) => page.locator('#layer .sheet').last();
const sheetCount = (page) => page.locator('#layer .sheet').count();
const closed = (page) => page.waitForFunction(() => !document.querySelector('#layer .sheet'), null, { timeout: 4000 });
const curRow = (page) => page.evaluate(() => { const o = window.__app.calc.out; const r = o.rows[o.cur]; return { sunday: r.sunday, assigned: r.assigned, res: r.res, cleaner: r.cleaner, sk: r.sk, away: r.away, swapped: r.swapped, status: r.status, subs: r.subs, isMakeup: r.isMakeup }; });
const wkDoc = (page, s = CUR) => page.evaluate((sun) => JSON.parse(JSON.stringify(window.__app.state.weeks[sun] || {})), s);
const openChore = async (page, chore, sunday = CUR) => { await page.evaluate(([s, c]) => import('/js/choresheet.js').then((m) => m.openChoreSheet(window.__app, s, c)), [sunday, chore]); await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450); };
const openWeek = async (page, sunday = CUR) => { await page.locator(`.week[data-sunday="${sunday}"]`).click(); await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450); };
const noOverflow = async (page, label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'overflow orizzontale: ' + label);
const noErrors = (page, label) => {
  const errs = (page.__errors || []).filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(errs, [], `errori in console (${label})`);
  assert.deepEqual((page.__bad || []).filter((u) => MINE.test(u)), [], `risorse mancanti (${label})`);
};
// "fatto" con checklist: se compare il dialogo delle voci mancanti, "Spunta tutto e segna fatto"
const gate = async (page) => { try { await page.waitForSelector('[data-choice="all"]', { timeout: 1500 }); await page.click('[data-choice="all"]'); } catch { /* nessuna voce mancante */ } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });

const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log('  ok   ' + name + ` (${Date.now() - t0}ms)`); }
  catch (e) { results.push([name, false]); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')); }
}

// ---------------------------------------------------------------- scenari
await scenario('elenco: card, corrente evidenziata, scroll automatico, stati', async () => {
  const page = await mk();
  assert.equal(await page.locator('.cal .title').innerText(), 'Settimane');
  assert.equal(await page.locator('.cal .week').count(), 6, 'corrente + 4 prossime per esteso + la settimana scorsa compatta (le altre passate stanno nei mesi chiusi)');
  assert.equal(await page.locator('.cal .week.compact').count(), 1);
  assert.equal(await page.locator('.cal [data-act=month]').count(), 1, 'ottobre: le altre 3 passate');
  assert.equal(await page.locator('.cal [data-act=month]').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.week.cur').count(), 1);
  assert.equal(await page.locator('.week.cur').getAttribute('data-sunday'), CUR);
  await page.waitForFunction(() => { const r = document.querySelector('.week.cur').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 3000 }).catch(() => {});   // lo scroll automatico parte dopo due frame
  const box = await page.locator('.week.cur').boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 844, 'la settimana corrente è nel viewport: ' + JSON.stringify(box));
  assert.match(await page.locator('.week.cur').innerText(), /In corso/);
  assert.match(await page.locator('.week[data-sunday="2026-11-08"]').innerText(), /Anteprima/);
  assert.match(await page.locator('.week[data-sunday="2026-10-25"]').innerText(), /Con salti/);
  assert.equal(await page.locator('.week.cur .wk-chore').count(), 3);
  assert.match(await page.locator('.week.cur').innerText(), /Anna[\s\S]*Bruno[\s\S]*Carla/);
  await noOverflow(page, 'lista');
  await shot(page, 'list-390-light');
  noErrors(page, 'elenco');
  await page.close();
});

await scenario('vai a oggi riporta alla settimana corrente', async () => {
  const page = await mk();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  assert.ok(!(await page.locator('.week.cur').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })));
  await page.locator('[data-act=today]').click();
  await page.waitForFunction(() => { const r = document.querySelector('.week.cur').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 4000 });
  await page.close();
});

await scenario('segna fatto dal dettaglio turno (stato nel motore)', async () => {
  const page = await mk();
  await openWeek(page);
  assert.match(await topSheet(page).innerText(), /Pavimenti[\s\S]*Bagno[\s\S]*Cucina/i);
  await page.locator('#layer .sheet [data-chore=floor]').click();
  await page.waitForTimeout(500);
  assert.equal(await sheetCount(page), 2, 'foglio turno sopra il foglio settimana');
  assert.match(await topSheet(page).innerText(), /Anna/);
  assert.match(await topSheet(page).innerText(), /Recupero/);
  await shot(page, 'chore-sheet-390');
  await topSheet(page).locator('[data-act=done]').click();
  await gate(page);
  await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'done');
  const r = await curRow(page);
  assert.equal(r.cleaner[0], 'anna');
  const w = await wkDoc(page);
  assert.equal(w.result.floor, 'done'); assert.equal(w.resultBy.floor, 'anna'); assert.ok(w.resultAt.floor);
  await page.waitForTimeout(500);
  assert.equal(await sheetCount(page), 1, 'il foglio turno si chiude, resta quello della settimana');
  assert.equal(await page.locator('#layer .sheet [data-toggle=floor]').getAttribute('aria-pressed'), 'true', 'interruttore "fatto" nel foglio settimana');
  // riaperto mostra "Segnato da Anna, oggi HH:MM" e il pulsante per annullare
  await openChore(page, 'floor');
  assert.match(await topSheet(page).innerText(), /Segnato da Anna, oggi \d\d:\d\d/);
  assert.equal(await topSheet(page).locator('[data-act=done]').count(), 0);
  await topSheet(page).locator('[data-act=reset]').click();
  await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === '');
  assert.equal((await wkDoc(page)).result?.floor ?? null, null);
  noErrors(page, 'segna fatto');
  await page.close();
});

await scenario('"Segnato da X, ieri 18:40"', async () => {
  const page = await mk({ weeks: { [CUR]: { result: { bathroom: 'done' }, resultBy: { bathroom: 'bruno' }, resultAt: { bathroom: '2026-10-27T18:40:00' } } } });
  await openChore(page, 'bathroom');
  assert.match(await topSheet(page).innerText(), /Segnato da Bruno, ieri 18:40/);
  await page.close();
});

await scenario('ha pulito un altro: lista, sostituto suggerito, stato nel motore', async () => {
  const page = await mk();
  const before = await curRow(page);
  await openChore(page, 'bathroom');
  await topSheet(page).locator('[data-act=cover]').click();
  await page.waitForTimeout(200);
  const picks = topSheet(page).locator('.cs-pick');
  assert.equal(await picks.count(), 2, 'tutti i presenti tranne l\'assegnato');
  const sug = before.subs[1];
  assert.ok(sug && sug !== 'bruno');
  assert.equal(await topSheet(page).locator('.cs-pick.sug').getAttribute('data-who'), sug);
  assert.equal(await picks.first().getAttribute('data-who'), sug, 'il suggerito è in cima');
  assert.match(await topSheet(page).innerText(), /Sostituto equo suggerito/);
  await shot(page, 'cover-390');
  const other = sug === 'anna' ? 'carla' : 'anna';
  await topSheet(page).locator(`.cs-pick[data-who=${other}]`).click();
  await gate(page);
  await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[1].kind === 'by');
  const r = await curRow(page);
  assert.equal(r.res[1].id, other); assert.equal(r.cleaner[1], other);
  assert.equal((await wkDoc(page)).result.bathroom, 'by:' + other);
  await page.waitForFunction(() => !document.querySelector('#layer .sheet'), null, { timeout: 3000 });
  assert.match(await page.locator('.week.cur').innerText(), /Bagno[\s\S]*Bruno/i);
  noErrors(page, 'cover');
  await page.close();
});

await scenario('non fatto (solo admin): saltata e saltata con sostituto di riserva', async () => {
  const page = await mk();
  const before = await curRow(page);
  await openChore(page, 'kitchen');
  await topSheet(page).locator('[data-act=skip]').click();
  await page.waitForTimeout(200);
  assert.match(await topSheet(page).innerText(), /recupero e un CDM/);
  assert.match(await topSheet(page).innerText(), /Nessuno \(saltata\)/);
  assert.match(await topSheet(page).innerText(), /Anche \w+ non ha pulito/);
  await shot(page, 'skip-390');
  await topSheet(page).locator('[data-value=skipped]').click();
  await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[2].kind === 'skipped');
  let r = await curRow(page);
  assert.equal(r.sk[2], 'carla');
  await closed(page);
  // anche il sostituto di riserva non ha pulito
  const sub = before.subs[0];
  await openChore(page, 'floor');
  await topSheet(page).locator('[data-act=skip]').click();
  await page.waitForTimeout(200);
  await topSheet(page).locator(`[data-value="skipped:${sub}"]`).click();
  await page.waitForFunction(() => window.__app.calc.out.rows[window.__app.calc.out.cur].res[0].kind === 'skippedBy');
  r = await curRow(page);
  assert.equal(r.res[0].id, sub); assert.equal(r.sk[0], sub);
  assert.equal((await wkDoc(page)).result.floor, 'skipped:' + sub);
  noErrors(page, 'skip');
  await page.close();
});

await scenario('giorno scelto: chip, passati attenuati, toggle e "Togli giorno"', async () => {
  const page = await mk();
  await openChore(page, 'floor');
  const chips = topSheet(page).locator('.daychips button');
  assert.equal(await chips.count(), 7);
  assert.equal(await chips.first().getAttribute('data-day'), '2026-10-26');
  assert.equal(await chips.last().getAttribute('data-day'), '2026-11-01');
  assert.match(await chips.first().getAttribute('class'), /past/);
  assert.match(await chips.nth(1).getAttribute('class'), /past/);
  assert.doesNotMatch(await chips.nth(2).getAttribute('class') || '', /past/);
  await chips.nth(4).click(); // venerdì 30
  await page.waitForFunction(() => (window.__app.state.weeks['2026-11-01'] || {}).plan?.floor === '2026-10-30');
  await page.waitForTimeout(150);
  assert.equal(await topSheet(page).locator('.daychips button[data-day="2026-10-30"]').getAttribute('aria-pressed'), 'true');
  assert.match(await topSheet(page).innerText(), /Lo fa venerdì/);
  assert.equal(await sheetCount(page), 1, 'il foglio resta aperto e si aggiorna');
  assert.match(await page.locator('.week.cur .wk-chore[data-chore=floor]').innerText(), /ven/i);
  await shot(page, 'plan-390');
  await topSheet(page).locator('[data-act=plan-clear]').click();
  await page.waitForFunction(() => !((window.__app.state.weeks['2026-11-01'] || {}).plan || {}).floor);
  await page.waitForTimeout(150);
  assert.equal(await topSheet(page).locator('.daychips button[aria-pressed=true]').count(), 0);
  noErrors(page, 'giorno scelto');
  await page.close();
});

await scenario('extra ricorrenti del turno: spunta', async () => {
  const page = await mk();
  await openChore(page, 'bathroom');
  assert.match(await topSheet(page).innerText(), /Cambia il tappetino/);
  await topSheet(page).locator('[data-task=t2]').click();
  await page.waitForFunction(() => !!((window.__app.state.weeks['2026-11-01'] || {}).tasksDone || {}).t2);
  await page.waitForTimeout(150);
  assert.equal(await topSheet(page).locator('[data-task=t2]').getAttribute('aria-pressed'), 'true');
  assert.match(await topSheet(page).innerText(), /Fatto da Anna/);
  await page.close();
});

await scenario('scambio concordato manuale (admin) e annullamento', async () => {
  const page = await mk();
  await openChore(page, 'floor');
  await topSheet(page).locator('[data-act=swap]').click();
  await page.waitForTimeout(200);
  assert.match(await topSheet(page).innerText(), /Bruno · Bagno/);
  await shot(page, 'swap-390');
  await topSheet(page).locator('.cs-pick[data-who=bruno]').click();
  await page.waitForFunction(() => !!(window.__app.state.weeks['2026-11-01'] || {}).swap);
  const w = await wkDoc(page);
  assert.deepEqual(w.swap, { floor: 'bruno', bathroom: 'anna' });
  let r = await curRow(page);
  assert.deepEqual(r.assigned.slice(0, 2), ['bruno', 'anna']);
  assert.deepEqual(r.swapped, [true, true, false]);
  await page.waitForTimeout(200);
  assert.match(await topSheet(page).innerText(), /Scambio concordato/);
  assert.match(await topSheet(page).innerText(), /Bruno/);
  await page.close();
  // dal foglio settimana: elenco scambi e annullamento
  const p2 = await mk({ weeks: { [CUR]: { swap: { floor: 'bruno', bathroom: 'anna' } } } });
  assert.ok(await p2.locator('.week.cur .ind[title="Scambio concordato"]').count() >= 1, 'indicatore di scambio sulla card');
  await openWeek(p2);
  assert.match(await topSheet(p2).innerText(), /Scambi concordati/);
  await topSheet(p2).locator('[data-act=swap-cancel-week]').click();
  await p2.waitForFunction(() => !(window.__app.state.weeks['2026-11-01'] || {}).swap);
  r = await curRow(p2);
  assert.deepEqual(r.assigned, ['anna', 'bruno', 'carla']);
  noErrors(p2, 'scambio');
  await p2.close();
});

await scenario('richiesta di scambio tra due persone', async () => {
  const page = await mk({ me: 'bruno', admin: false });
  await openChore(page, 'bathroom');
  await topSheet(page).locator('[data-act=request]').click();
  await page.waitForTimeout(500);
  assert.equal(await sheetCount(page), 2);
  assert.match(await topSheet(page).innerText(), /Il mio turno[\s\S]*Bagno/);
  assert.ok(await topSheet(page).locator('[data-act=req-send]').isDisabled());
  await topSheet(page).locator('.cs-pick[data-who=anna][data-chore=floor]').click();
  await shot(page, 'request-390');
  await topSheet(page).locator('[data-act=req-send]').click();
  await page.waitForFunction(() => Object.keys(window.__app.state.requests).length === 1);
  const rq = await page.evaluate(() => Object.values(window.__app.state.requests)[0]);
  assert.equal(rq.from, 'bruno'); assert.equal(rq.to, 'anna'); assert.equal(rq.fromChore, 'bathroom'); assert.equal(rq.toChore, 'floor'); assert.equal(rq.status, 'pending'); assert.equal(rq.week, CUR);
  await page.waitForTimeout(500);
  assert.match(await page.locator('.toast').first().innerText(), /Richiesta inviata/);
  assert.equal(await sheetCount(page), 1, 'solo il foglio turno resta (con la richiesta in attesa)');
  assert.match(await topSheet(page).innerText(), /In attesa/);
  // l'altra persona accetta (lo fa more.js: qui via azione)
  await page.evaluate(async () => { const a = window.__app; a.setMe('anna'); const id = Object.keys(a.state.requests)[0]; await a.actions.answerSwap(id, true); });
  await page.waitForFunction(() => !!(window.__app.state.weeks['2026-11-01'] || {}).swap);
  const r = await curRow(page);
  assert.deepEqual(r.assigned.slice(0, 2), ['bruno', 'anna'], 'il motore applica lo scambio');
  noErrors(page, 'richiesta scambio');
  await page.close();
});

await scenario('assenza dal foglio settimana (persona e "tutti via")', async () => {
  const page = await mk();
  await openWeek(page);
  await shot(page, 'week-sheet-390');
  assert.equal(await topSheet(page).locator('input[data-person]').count(), 3);
  await topSheet(page).locator('input[data-person=carla]').click({ force: true });
  await page.waitForFunction(() => ((window.__app.state.weeks['2026-11-01'] || {}).awayMap || {}).carla === true);
  let r = await curRow(page);
  assert.deepEqual(r.away, ['carla']);
  assert.ok(!r.assigned.includes('carla'), 'chi è assente non ha turni');
  await page.waitForTimeout(200);
  assert.equal(await topSheet(page).locator('input[data-person=carla]').isChecked(), true);
  assert.match(await page.locator('.week.cur').innerText(), /Assenti: Carla/);
  await topSheet(page).locator('input[data-person=carla]').click({ force: true });
  await page.waitForFunction(() => !((window.__app.state.weeks['2026-11-01'] || {}).awayMap || {}).carla);
  await topSheet(page).locator('input[data-everyone]').click({ force: true });
  await page.waitForFunction(() => (window.__app.state.weeks['2026-11-01'] || {}).everyone === true);
  r = await curRow(page);
  assert.equal(r.status, 'empty');
  await page.waitForTimeout(300);
  assert.match(await page.locator('.week.cur').innerText(), /Casa vuota/);
  noErrors(page, 'assenze');
  await page.close();
});

await scenario('nota della settimana', async () => {
  const page = await mk();
  await openWeek(page);
  await topSheet(page).locator('textarea.wd-note').fill('Ricordate la spesa del sabato');
  await topSheet(page).locator('[data-act=note-save]').click();
  await page.waitForFunction(() => (window.__app.state.weeks['2026-11-01'] || {}).note === 'Ricordate la spesa del sabato');
  assert.match(await page.locator('.toast').first().innerText(), /Nota salvata/);
  assert.equal(await page.locator('.week.cur .ind.note').count(), 1, 'icona nota sulla card');
  await page.close();
});

await scenario('WhatsApp: testo, opzioni, settimana, invio e classifica', async () => {
  const page = await mk({ weeks: { [CUR]: { plan: { floor: '2026-10-30' } } } });
  await openWeek(page);
  await topSheet(page).locator('[data-act=whatsapp]').click();
  await page.waitForTimeout(500);
  const ta = topSheet(page).locator('textarea.cs-wa');
  const txt = await ta.inputValue();
  assert.match(txt, /\*Turni della settimana\* 26 ott – 1 nov/);
  assert.match(txt, /🧽 Pavimenti: Anna \(recupero\)/);
  assert.match(txt, /🚿 Bagno: Bruno/);
  assert.match(txt, /🍳 Cucina: Carla/);
  assert.match(txt, /Anna lo fa venerdì 30 ott/);
  assert.match(txt, /Cambia il tappetino/);
  assert.match(txt, /⏰ Entro domenica!/);
  await shot(page, 'whatsapp-390');
  const href = await topSheet(page).locator('[data-act=wa-send]').getAttribute('href');
  assert.ok(href.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(href.slice('https://wa.me/?text='.length)), txt);
  // opzioni
  await topSheet(page).locator('.li', { hasText: 'Promemoria scadenza' }).locator('input').click({ force: true });
  assert.doesNotMatch(await ta.inputValue(), /Entro domenica/);
  await topSheet(page).locator('.li', { hasText: 'Compiti extra' }).locator('input').click({ force: true });
  assert.doesNotMatch(await ta.inputValue(), /Cambia il tappetino/);
  // messaggio modificabile: l'invio usa il testo modificato
  await ta.fill('Ciao ciao');
  assert.equal(decodeURIComponent((await topSheet(page).locator('[data-act=wa-send]').getAttribute('href')).slice(20)), 'Ciao ciao');
  // settimana prossima
  await topSheet(page).locator('.seg button', { hasText: 'Prossima' }).click();
  assert.match(await ta.inputValue(), /2–8 nov/);
  await topSheet(page).locator('.seg button', { hasText: 'Scorsa' }).click();
  assert.match(await ta.inputValue(), /19–25 ott/);
  // copia
  await topSheet(page).locator('[data-act=wa-copy]').click();
  await page.waitForTimeout(200);
  assert.match(await page.locator('.toast').last().innerText(), /Copiato/);
  // classifica
  const rank = await topSheet(page).locator('[data-testid=ranking-text]').innerText();
  assert.match(rank, /Classifica/);
  const rh = await topSheet(page).locator('[data-act=rank-send]').getAttribute('href');
  assert.ok(rh.startsWith('https://wa.me/?text=') && decodeURIComponent(rh.slice(20)).trim() === rank.trim());
  noErrors(page, 'whatsapp');
  await page.close();
});

await scenario('calendario .ics: scaricato con i turni della persona', async () => {
  const page = await mk();
  await openWeek(page);
  await topSheet(page).locator('[data-act=ics]').click();
  await page.waitForTimeout(500);
  assert.match(await topSheet(page).innerText(), /Aggiungi al calendario/);
  assert.ok(await topSheet(page).locator('select').count(), 'admin: sceglie la persona');
  const [dl] = await Promise.all([page.waitForEvent('download'), topSheet(page).locator('[data-act=ics-download]').click()]);
  assert.equal(dl.suggestedFilename(), 'tidyhouse-anna.ics');
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:🧹 Pavimenti \(Recupero\)/);
  const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.ok(n >= 6 && n <= 8, 'eventi: ' + n);
  assert.doesNotMatch(ics, /UID:2026-10-25/);
  // altra persona
  await page.waitForSelector('.toast', { state: 'detached' });   // il toast "scaricato" copre il pulsante per qualche secondo
  await topSheet(page).locator('select').selectOption('bruno');
  const [dl2] = await Promise.all([page.waitForEvent('download'), topSheet(page).locator('[data-act=ics-download]').click()]);
  assert.equal(dl2.suggestedFilename(), 'tidyhouse-bruno.ics');
  assert.match(fs.readFileSync(await dl2.path(), 'utf8'), /UID:2026-11-01-bathroom-bruno@tidyhouse/);
  await shot(page, 'ics-390');
  await page.close();
  // non admin: nessun selettore, solo i propri turni
  const p2 = await mk({ me: 'carla', admin: false });
  await openWeek(p2);
  await topSheet(p2).locator('[data-act=ics]').click();
  await p2.waitForTimeout(500);
  assert.equal(await topSheet(p2).locator('select').count(), 0);
  const [dl3] = await Promise.all([p2.waitForEvent('download'), topSheet(p2).locator('[data-act=ics-download]').click()]);
  assert.equal(dl3.suggestedFilename(), 'tidyhouse-carla.ics');
  noErrors(page, 'ics');
  await p2.close();
});

await scenario('permessi non-admin: azioni riservate nascoste', async () => {
  const page = await mk({ me: 'bruno', admin: false });
  // turno di un altro (Anna, pavimenti)
  await openChore(page, 'floor');
  let s = topSheet(page);
  assert.equal(await s.locator('[data-act=done]').count(), 0, 'non può segnare fatto per altri');
  assert.equal(await s.locator('[data-act=skip]').count(), 0, 'saltato solo admin');
  assert.equal(await s.locator('[data-act=swap]').count(), 0, 'scambio manuale solo admin');
  assert.equal(await s.locator('[data-act=nudge]').count(), 0, 'sollecito solo admin');
  assert.equal(await s.locator('.daychips').count(), 0, 'giorno scelto solo per sé');
  assert.equal(await s.locator('[data-act=request]').count(), 0);
  assert.equal(await s.locator('[data-act=cover]').count(), 0, 'senza accordo non c\'è il "ho pulito io" diretto');
  assert.match(await s.locator('[data-act=volunteer]').innerText(), /Lo faccio io subito, anche se non spetta a me/);
  assert.equal(await s.locator('[data-act=offer]').count(), 1, 'offerta all\'assegnato');
  await page.keyboard.press('Escape');
  await closed(page);
  // il proprio turno (Bruno, bagno)
  await openChore(page, 'bathroom');
  s = topSheet(page);
  assert.equal(await s.locator('[data-act=done]').count(), 1);
  assert.equal(await s.locator('[data-act=skip]').count(), 0);
  assert.equal(await s.locator('[data-act=swap]').count(), 0);
  assert.equal(await s.locator('.daychips button').count(), 7);
  assert.equal(await s.locator('[data-act=request]').count(), 1);
  assert.equal(await s.locator('[data-task=t2]').count(), 1);
  await page.keyboard.press('Escape');
  await closed(page);
  // settimana: toggle assenza solo per sé
  await openWeek(page);
  assert.equal(await topSheet(page).locator('input[data-person]').count(), 1);
  assert.equal(await topSheet(page).locator('input[data-person=bruno]').count(), 1);
  assert.equal(await topSheet(page).locator('input[data-everyone]').count(), 0);
  // un'azione negata dal motore dà un errore gestito, non un'eccezione
  await page.keyboard.press('Escape');
  await closed(page);
  // funzioni spente: selfDone off, planDay/whatsapp/ics/requests off
  const p2 = await mk({ me: 'bruno', admin: false, features: { selfDone: false, planDay: false, whatsapp: false, ics: false, requests: false, tasks: false } });
  await openChore(p2, 'bathroom');
  s = topSheet(p2);
  assert.equal(await s.locator('[data-act=done]').count(), 0);
  assert.equal(await s.locator('[data-act=cover]').count(), 0);
  assert.equal(await s.locator('.daychips').count(), 0);
  assert.equal(await s.locator('[data-act=request]').count(), 0);
  assert.equal(await s.locator('[data-task]').count(), 0);
  assert.match(await s.innerText(), /Solo l'admin può modificare/);
  await p2.keyboard.press('Escape'); await closed(p2);
  await openWeek(p2);
  assert.equal(await topSheet(p2).locator('[data-act=whatsapp], [data-act=ics]').count(), 0);
  noErrors(page, 'permessi'); noErrors(p2, 'permessi 2');
  await page.close(); await p2.close();
});

await scenario('admin: sollecita', async () => {
  const page = await mk();
  await openChore(page, 'bathroom');
  await topSheet(page).locator('[data-act=nudge]').click();
  await page.waitForFunction(() => Object.values(window.__app.state.requests).some((q) => q.kind === 'nudge' && q.to === 'bruno'));
  assert.match(await page.locator('.toast').first().innerText(), /Sollecito inviato/);
  await page.close();
});

await scenario('storico: aprire un mese non sposta la corrente; «Mostra altre» per il futuro', async () => {
  const page = await mk({ houseExtra: { startSunday: '2026-06-07' } });
  assert.equal(await page.locator('.week.cur').getAttribute('data-sunday'), CUR);
  const n0 = await page.locator('.cal .week').count();
  assert.equal(n0, 6, 'corrente + 4 prossime + settimana scorsa');
  const topBefore = await page.locator('.week.cur').evaluate((el) => el.getBoundingClientRect().top);
  await page.locator('[data-act=month]').first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.locator('[data-act=month]').first().click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.week.compact').count() > 1);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  const topAfter = await page.locator('.week.cur').evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(Math.abs(topAfter - topBefore) < 4, `posizione mantenuta (${topBefore} -> ${topAfter})`);
  await page.locator('[data-act=show-next]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  assert.match(await page.locator('[data-act=show-next]').innerText(), /Mostra altre 10 settimane/);
  await page.locator('[data-act=show-next]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cal .week.fut').count(), 14, 'tutte le future (4 + 10)');
  assert.equal(await page.locator('[data-act=show-next]').count(), 0);
  noErrors(page, 'storico');
  await page.close();
});

await scenario('piano non iniziato, casa vuota, nomi lunghi, scambi', async () => {
  const page = await mk({ houseExtra: { startSunday: '2027-01-03' } });
  assert.match(await page.locator('.cal .note').innerText(), /Il piano parte il 28 dic 2026/);
  assert.equal(await page.locator('[data-act=today]').count(), 0);
  assert.ok(await page.locator('.cal .week').count() > 3);
  await noOverflow(page, 'piano non iniziato');
  noErrors(page, 'piano non iniziato');
  await page.close();
  const rm = [{ id: 'anna', name: 'Massimiliano-Bartolomeo Castelnuovo', slot: 1 }, { id: 'bruno', name: 'Bruno', slot: 2 }, { id: 'carla', name: 'Carla Maria Josefina de las Mercedes', slot: 3 }].map((r) => ({ ...r, from: null, to: null }));
  const p2 = await mk({ houseExtra: { roommates: rm }, weeks: { '2026-11-08': { everyone: true }, [CUR]: { swap: { floor: 'bruno', bathroom: 'anna' }, note: 'ciao' } } });
  assert.match(await p2.locator('.week[data-sunday="2026-11-08"]').innerText(), /Casa vuota/);
  assert.equal(await p2.locator(`.week.cur .ind.note`).count(), 1);
  await noOverflow(p2, 'nomi lunghi');
  await shot(p2, 'long-names-390');
  await openWeek(p2);
  await noOverflow(p2, 'foglio nomi lunghi');
  await shot(p2, 'long-names-sheet-390');
  noErrors(p2, 'nomi lunghi');
  await p2.close();
});

await scenario('inglese', async () => {
  const page = await mk({ lang: 'en-US', houseExtra: { lang: 'en' } });
  assert.equal(await page.locator('.cal .title').innerText(), 'Weeks');
  assert.match(await page.locator('.week.cur').innerText(), /In progress/);
  assert.match(await page.locator('.week.cur').innerText(), /Floor/i);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-act=today]').getAttribute('aria-label'), 'Go to today');
  assert.match(await page.locator('[data-act=today]').innerText(), /Today/);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await openWeek(page);
  assert.match(await topSheet(page).innerText(), /Week 5/);
  await topSheet(page).locator('[data-chore=bathroom]').click();
  await page.waitForTimeout(500);
  assert.match(await topSheet(page).innerText(), /Assigned to/);
  assert.match(await topSheet(page).innerText(), /Mark done/);
  assert.match(await topSheet(page).innerText(), /Someone else cleaned/);
  await shot(page, 'chore-sheet-en');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await topSheet(page).locator('[data-act=whatsapp]').click();
  await page.waitForTimeout(500);
  assert.match(await topSheet(page).locator('textarea.cs-wa').inputValue(), /This week's rota/);
  await shot(page, 'whatsapp-en');
  noErrors(page, 'inglese');
  await page.close();
});

await scenario('scuro e viewport (390x844, 820x1180, 1440x900)', async () => {
  for (const [name, vp] of [['390', { width: 390, height: 844 }], ['820', { width: 820, height: 1180 }], ['1440', { width: 1440, height: 900 }]]) {
    for (const dark of [false, true]) {
      const page = await mk({ viewport: vp, dark });
      const tag = `${name}-${dark ? 'dark' : 'light'}`;
      await noOverflow(page, 'lista ' + tag);
      const wide = vp.width >= 1180;
      assert.equal(await page.locator('.cal-panel').count(), wide ? 1 : 0, 'pannello desktop ' + tag);
      if (wide) {
        assert.ok(await page.locator('.cal-panel').isVisible());
        assert.match(await page.locator('.cal-panel').innerText(), /Pavimenti[\s\S]*Bagno[\s\S]*Cucina/i);
        await page.locator('.week[data-sunday="2026-11-08"]').click();
        await page.waitForFunction(() => document.querySelector('.cal-panel .wd-title')?.textContent.includes('2–8 nov'));
        assert.equal(await sheetCount(page), 0, 'su desktop il click non apre un foglio');
        assert.equal(await page.locator('.week.sel').getAttribute('data-sunday'), '2026-11-08');
        assert.match(await page.locator('.cal-panel').innerText(), /Anteprima/);
        await page.locator('.week.cur').click();
        await page.waitForFunction(() => document.querySelector('.cal-panel .wd-title')?.textContent.includes('26 ott'));
        await page.locator('.cal-panel [data-chore=floor]').click();
        await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450);
        await shot(page, `chore-sheet-${tag}`);
        await page.keyboard.press('Escape'); await closed(page);
      } else {
        await openWeek(page);
        await noOverflow(page, 'foglio ' + tag);
        await shot(page, `week-sheet-${tag}`);
        await page.keyboard.press('Escape'); await closed(page);
      }
      await shot(page, `list-${tag}`);
      noErrors(page, 'viewport ' + tag);
      await page.close();
    }
  }
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} scenari ok`);
if (failed.length) { console.log('Falliti: ' + failed.map((f) => f[0]).join(', ')); process.exit(1); }
