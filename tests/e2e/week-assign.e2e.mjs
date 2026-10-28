// E2E dell'assegnazione manuale della settimana (admin) e delle assegnazioni proposte dall'IA. Esecuzione: node tests/e2e/week-assign.e2e.mjs
// Orologio finto: mercoledì 2026-10-28 10:00 (settimana corrente = quella che chiude 2026-11-01). Persone: anna (admin), bruno, carla.
// Variabili: SHOTS=<cartella> per salvare gli screenshot. L'IA è simulata con page.route (nessuna rete, nessuna chiave reale).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';
const CUR = '2026-11-01', FUT = '2026-11-15', PAST = '2026-10-18';
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'week-assign-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHORES = ['floor', 'bathroom', 'kitchen'];

const env = await start();
const MINE = /(weekassign|assignlogic|choresheet|strings\/assign|ai-ui|\/ai\.js)/;

async function mk({ me = 'anna', admin = true, lang = 'it-IT', viewport, dark, houseExtra = {}, weeks, extra, path: hash = '#/calendar' } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: seed({ me, admin, weeks, extra, houseExtra: { requireRules: false, ...houseExtra } }) });
  page.__bad = [];
  page.on('response', (r) => { if (r.status() >= 400) page.__bad.push(r.status() + ' ' + r.url()); });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector(hash === '#/calendar' ? '.cal .week' : '#app *', { timeout: 8000 });
  await page.waitForTimeout(250);
  return page;
}
const rowOf = (page, sunday = CUR) => page.evaluate((s) => { const r = window.__app.calc.out.rows.find((x) => x.sunday === s); return { assigned: r.assigned, swapped: r.swapped, closed: r.closed }; }, sunday);
const wkDoc = (page, s = CUR) => page.evaluate((sun) => JSON.parse(JSON.stringify(window.__app.state.weeks[sun] || {})), s);
const openWeek = async (page, sunday = CUR) => { await page.evaluate((s) => { if (!document.querySelector(`.week[data-sunday="${s}"]`)) for (const b of document.querySelectorAll('[data-act=month][aria-expanded=false]')) { b.click(); if (document.querySelector(`.week[data-sunday="${s}"]`)) break; } document.querySelector(`.week[data-sunday="${s}"]`).click(); }, sunday);   // le settimane passate stanno nei mesi richiudibili: si apre quello giusto await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450); };
const openAssign = async (page, sunday = CUR) => { await openWeek(page, sunday); await page.click('[data-act="assign-week"]'); await page.waitForTimeout(500); };
const sheets = (page) => page.locator('#layer .sheet').count();
const noOverflow = async (page, label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#layer .sheet')].every((s) => s.scrollWidth <= s.clientWidth + 1)), 'overflow orizzontale: ' + label);
const noErrors = (page, label) => {
  const errs = (page.__errors || []).filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(errs, [], `errori in console (${label})`);
  assert.deepEqual((page.__bad || []).filter((u) => MINE.test(u)), [], `risorse mancanti (${label})`);
};
const chip = (page, chore, who) => page.locator(`.wa-opt[data-chore="${chore}"][data-who="${who}"]`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const calNames = (page, sunday = CUR) => page.evaluate((s) => [...document.querySelectorAll(`.week[data-sunday="${s}"] .wk-chore .n`)].map((n) => n.textContent.trim()), sunday);

const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log('  ok   ' + name + ` (${Date.now() - t0}ms)`); }
  catch (e) { results.push([name, false]); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')); }
}

// ---------------------------------------------------------------- manuale
await scenario('admin: scheda settimana → Assegna → cambia due mansioni → anteprima → salva → calendario e Home aggiornati; Annulla ripristina', async () => {
  const page = await mk();
  const before = await rowOf(page);
  const [f0, b0] = before.assigned;
  assert.notEqual(f0, b0);
  const names = { anna: 'Anna', bruno: 'Bruno', carla: 'Carla' };
  await openAssign(page);
  assert.match(await page.locator('#layer .sheet').last().locator('h2').innerText(), /Assegna la settimana/);
  // preselezione: «Come da regole» (con il nome di chi è assegnato oggi) è attiva su tutte le mansioni
  for (const [i, c] of CHORES.entries()) {
    assert.equal(await chip(page, c, '').getAttribute('aria-checked'), 'true');
    assert.match(await chip(page, c, '').innerText(), new RegExp('Come da regole \\(' + names[before.assigned[i]] + '\\)'));
  }
  assert.equal(await page.locator('[data-testid="wa-nochange"]').count(), 1);
  assert.equal(await page.locator('[data-act="wa-save"]').isDisabled(), true, 'senza modifiche non si salva');
  // scambio pavimenti <-> bagno
  await chip(page, 'floor', b0).click();
  await chip(page, 'bathroom', f0).click();
  assert.equal(await chip(page, 'floor', b0).getAttribute('aria-checked'), 'true');
  assert.equal(await chip(page, 'floor', '').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('.wa-change').count(), 2);
  const prev = await page.locator('[data-testid="wa-preview"]').innerText();
  assert.match(prev, new RegExp(`${names[f0]} → ${names[b0]}`)); assert.match(prev, new RegExp(`${names[b0]} → ${names[f0]}`));
  assert.match(await page.locator('[data-testid="wa-who"]').innerText(), new RegExp(`${names[f0]} prende bagno e perde pavimenti`));
  await page.click('[data-act="wa-save"]');
  await page.waitForFunction(() => document.querySelectorAll('#layer .sheet.on').length === 1, null, { timeout: 4000 });
  await page.waitForTimeout(400);
  const after = await rowOf(page);
  assert.deepEqual(after.assigned, [b0, f0, before.assigned[2]]);
  assert.deepEqual(after.swapped, [true, true, false]);
  assert.deepEqual((await wkDoc(page)).swap, { floor: b0, bathroom: f0 });
  assert.match(await page.locator('.toast').last().innerText(), /Settimana assegnata[\s\S]*Annulla/);
  // registro attività
  const log = await page.evaluate(() => Object.values(window.__app.state.log).filter((l) => l.type === 'assign').map((l) => l.p.text));
  assert.equal(log.length, 1); assert.match(log[0], /assegnazione manuale/);
  // calendario (sotto lo sheet della settimana) e dettaglio mostrano le nuove assegnazioni
  assert.deepEqual((await calNames(page)).slice(0, 3), [names[b0], names[f0], names[before.assigned[2]]]);
  assert.match(await page.locator('#layer .sheet').last().innerText(), /Scambio concordato/);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.goto(env.url + '/#/'); await page.waitForTimeout(700);
  const home = await page.locator('#app').innerText();
  assert.ok(home.includes(names[b0]) || home.includes(names[f0]), 'Home mostra la settimana');
  // Annulla (il toast resta ~7s): torna al calendario per ritrovare il toast ancora visibile
  await page.locator('.toast .toast-action').click();
  await page.waitForTimeout(500);
  const undone = await rowOf(page);
  assert.deepEqual(undone.assigned, before.assigned); assert.deepEqual(undone.swapped, [false, false, false]);
  assert.equal((await wkDoc(page)).swap, undefined);
  assert.match(await page.locator('.toast').last().innerText(), /Assegnazione annullata/);
  noErrors(page, 'manuale'); await page.close();
});

await scenario('«Come da regole» azzera l\'override, una persona può avere più mansioni (avviso), niente doppi override uguali alle regole', async () => {
  const page = await mk();
  const before = await rowOf(page, FUT);
  const [f0, b0] = before.assigned;
  await openAssign(page, FUT);
  await chip(page, 'bathroom', f0).click();                       // anche il pavimento è di f0 → f0 ha 2 mansioni
  assert.equal(await page.locator('[data-testid="wa-multi"]').count(), 1);
  assert.match(await page.locator('[data-testid="wa-multi"]').innerText(), /2 mansioni/);
  await chip(page, 'kitchen', before.assigned[2]).click();        // uguale alle regole → torna «Come da regole», nessun override
  assert.equal(await chip(page, 'kitchen', '').getAttribute('aria-checked'), 'true');
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(600);
  assert.deepEqual((await wkDoc(page, FUT)).swap, { bathroom: f0 });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  // riapro: il bagno è preselezionato su f0; «Come da regole» lo azzera
  await openAssign(page, FUT);
  assert.equal(await chip(page, 'bathroom', f0).getAttribute('aria-checked'), 'true');
  await chip(page, 'bathroom', '').click();
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(600);
  assert.equal((await wkDoc(page, FUT)).swap, undefined);
  assert.deepEqual((await rowOf(page, FUT)).assigned, before.assigned);
  assert.ok(b0);
  noErrors(page, 'regole'); await page.close();
});

await scenario('solo persone presenti nella lista; settimana conclusa chiede conferma', async () => {
  const page = await mk({ weeks: { [FUT]: { awayMap: { carla: true } } } });
  await openAssign(page, FUT);
  assert.equal(await page.locator('.wa-opt[data-chore="floor"][data-who="carla"]').count(), 0, 'Carla è via: non selezionabile');
  assert.equal(await page.locator('.wa-opt[data-chore="floor"][data-who="bruno"]').count(), 1);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  // settimana conclusa
  const before = await rowOf(page, PAST);
  assert.equal(before.closed, 1);
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== before.assigned[0]);
  await openAssign(page, PAST);
  assert.equal(await page.locator('[data-testid="wa-closed"]').count(), 1);
  await chip(page, 'floor', other).click();
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-testid="wa-confirm-note"]').count(), 1, 'chiede conferma');
  assert.equal((await wkDoc(page, PAST)).swap, undefined, 'finché non confermi non scrive');
  await page.click('[data-act="wa-back"]'); await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-testid="wa-confirm-note"]').count(), 0);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(200);
  await page.click('[data-act="wa-confirm"]'); await page.waitForTimeout(600);
  assert.deepEqual((await wkDoc(page, PAST)).swap, { floor: other });
  noErrors(page, 'conclusa'); await page.close();
});

await scenario('non admin: nessun pulsante «Assegna la settimana» e l\'azione è rifiutata', async () => {
  const page = await mk({ me: 'bruno', admin: false });
  await openWeek(page);
  assert.equal(await page.locator('[data-act="assign-week"]').count(), 0);
  const res = await page.evaluate(async (s) => {
    const m = await import('/js/weekassign.js'); const r = m.openAssignWeekSheet(window.__app, s);
    let denied = false; try { await window.__app.actions.setWeekAssignments(s, { floor: 'bruno' }); } catch (e) { denied = e.message === 'permission'; }
    return { opened: !!r, denied };
  }, CUR);
  assert.deepEqual(res, { opened: false, denied: true });
  assert.equal((await wkDoc(page)).swap, undefined);
  noErrors(page, 'non admin'); await page.close();
});

// ---------------------------------------------------------------- IA (risposte del provider simulate)
const AI_EXTRA = { 'cp:ai': { provider: 'anthropic', key: 'chiave-finta' } };
async function mockAi(page, json) {
  const seen = [];
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push(JSON.parse(req.postData()));
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(json) }] }) });
  });
  return seen;
}
const openAi = async (page) => { await page.evaluate(() => import('/js/ai-ui.js').then((m) => m.openAiImportSheet(window.__app))); await page.waitForSelector('#layer .sheet.on [data-testid="ai-text"]'); await page.waitForTimeout(450); };

await scenario('IA: propone assegnazioni + risultato + scartate, si applicano solo dopo conferma e si uniscono allo swap esistente', async () => {
  const page = await mk({ extra: AI_EXTRA, path: '#/' });
  const cur = await rowOf(page); const fut = await rowOf(page, FUT); const past = await rowOf(page, PAST);
  const others = (x) => ['anna', 'bruno', 'carla'].filter((p) => p !== x);
  const nm = { anna: 'Anna', bruno: 'Bruno', carla: 'Carla' };
  const floorTo = others(cur.assigned[0])[0], bathTo = others(cur.assigned[1])[0], futTo = others(fut.assigned[2])[0];
  // swap già presente nella settimana corrente: la cucina va a un'altra persona
  const kitchenTo = ['anna', 'bruno', 'carla'].find((x) => x !== cur.assigned[2]);
  await page.evaluate(([s, k]) => window.__app.actions.setSwap(s, { kitchen: k }), [CUR, kitchenTo]);
  await page.waitForTimeout(200);
  const seen = await mockAi(page, {
    trips: [],
    assignments: [{ week: CUR, chore: 'floor', person: nm[floorTo] }, { week: CUR, chore: 'bathroom', person: nm[bathTo] }, { week: FUT, chore: 'kitchen', person: nm[futTo] }, { week: CUR, chore: 'kitchen', person: 'Zoe' }],
    results: [{ week: PAST, chore: 'bathroom', outcome: 'by', by: 'Anna' }],
  });
  await openAi(page);
  assert.match(await page.locator('[data-testid="ai-assign-hint"]').innerText(), /io pavimenti, lei bagno/);
  await page.fill('[data-testid="ai-text"]', 'questa settimana io pavimenti, lei bagno, l\'altro cucina; il 15 novembre cucina Bruno. Il 18 ottobre ho fatto io il bagno');
  await page.click('[data-testid="ai-run"]');
  await page.waitForSelector('[data-testid="ai-apply"]:not([hidden])', { timeout: 5000 });
  // la richiesta contiene lo schema esteso, il nome dell'admin e la domenica corrente
  assert.equal(seen.length, 1);
  assert.match(seen[0].system, /"assignments":/); assert.match(seen[0].system, /"io", "me", "mi" = Anna/); assert.match(seen[0].system, /finisce domenica 2026-11-01/);
  assert.equal(seen[0].messages[0].content.includes('ho fatto io il bagno'), true);
  // nulla è ancora applicato
  assert.equal((await wkDoc(page, CUR)).swap.kitchen, kitchenTo); assert.equal((await wkDoc(page, FUT)).swap, undefined); assert.equal((await wkDoc(page, PAST)).result, undefined);
  const body = await page.locator('#layer .sheet').last().innerText();
  assert.match(body, /Assegnazioni/); assert.match(body, /Scartate/); assert.match(body, /Zoe: nome non riconosciuto/);
  const labels = await page.locator('#layer .sheet.on label.check').allInnerTexts();
  assert.equal(labels.length, 4, 'tre assegnazioni valide + un risultato: ' + JSON.stringify(labels));
  assert.ok(labels.some((l) => l.includes(`Pavimenti · settimana`) && l.includes(`${nm[cur.assigned[0]]} → ${nm[floorTo]}`)), 'prima → dopo: ' + JSON.stringify(labels));
  assert.ok(labels.some((l) => l.includes('Cucina') && l.includes(`${nm[fut.assigned[2]]} → ${nm[futTo]}`)));
  // deseleziono la prima assegnazione: non deve essere applicata
  const boxes = page.locator('#layer .sheet.on label.check input');
  const firstIdx = labels.findIndex((l) => l.includes('Pavimenti'));
  if (await boxes.nth(firstIdx).isChecked()) await boxes.nth(firstIdx).uncheck();
  await shot(page, 'ai-preview-390');
  noOverflow(page, 'anteprima IA');
  await page.click('[data-testid="ai-apply"]'); await page.waitForTimeout(700);
  const wc = await wkDoc(page, CUR);
  assert.equal(wc.swap.bathroom, bathTo, 'bagno alla persona proposta');
  assert.equal(wc.swap.floor, undefined, 'la voce deselezionata non è applicata');
  assert.equal(wc.swap.kitchen, kitchenTo, 'lo swap esistente resta (unione)');
  assert.deepEqual((await wkDoc(page, FUT)).swap, { kitchen: futTo });
  assert.equal((await wkDoc(page, PAST)).result.bathroom, 'by:anna');
  assert.equal(await page.evaluate(() => Object.values(window.__app.state.log).filter((l) => l.type === 'assign').length), 2, 'un log per settimana');
  assert.ok(past);
  noErrors(page, 'IA'); await page.close();
});

await scenario('IA: assegnazioni tutte scartate → «nulla da registrare» con i motivi; nessun errore se la risposta è vuota', async () => {
  const page = await mk({ extra: AI_EXTRA, path: '#/' });
  await mockAi(page, { assignments: [{ week: '2026-11-02', chore: 'floor', person: 'Anna' }, { week: '2027-06-06', chore: 'floor', person: 'Anna' }] });
  await openAi(page);
  await page.fill('[data-testid="ai-text"]', 'boh'); await page.click('[data-testid="ai-run"]');
  await page.waitForSelector('[data-testid="ai-none"]', { timeout: 5000 });
  assert.equal(await page.locator('[data-testid="ai-apply"]').isHidden(), true);
  const rej = await page.locator('[data-testid="ai-rejected"]').innerText();
  assert.match(rej, /data non valida/); assert.match(rej, /fuori dal periodo/);
  noErrors(page, 'IA scartate'); await page.close();
});

// ---------------------------------------------------------------- EN, scuro, 390px
await scenario('EN + scuro: testi in inglese, nessun overflow a 390px, screenshot', async () => {
  for (const dark of [false, true]) {
    const page = await mk({ lang: 'en-US', dark, houseExtra: { lang: 'en' } });
    await openAssign(page);
    const txt = await page.locator('#layer .sheet').last().innerText();
    assert.match(txt, /Assign the week/); assert.match(txt, /By the rules \(/); assert.match(txt, /No change from today/); assert.doesNotMatch(txt, /Come da regole|Assegna/);
    const before = await rowOf(page);
    await chip(page, 'floor', before.assigned[1]).click();
    assert.match(await page.locator('[data-testid="wa-who"]').innerText(), /loses floor[\s\S]*takes floor/);
    await noOverflow(page, 'foglio EN ' + (dark ? 'scuro' : 'chiaro'));
    await shot(page, `assign-390-${dark ? 'dark' : 'light'}`);
    // pulsante visibile nella scheda settimana
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    assert.match(await page.locator('[data-act="assign-week"]').innerText(), /Assign the week/);
    await noOverflow(page, 'scheda settimana EN');
    noErrors(page, 'EN ' + dark); await page.close();
  }
  // IA in inglese
  const page = await mk({ lang: 'en-US', houseExtra: { lang: 'en' }, extra: AI_EXTRA, path: '#/' });
  await mockAi(page, { assignments: [{ week: CUR, chore: 'floor', person: 'Zoe' }] });
  await openAi(page);
  await page.fill('[data-testid="ai-text"]', 'x'); await page.click('[data-testid="ai-run"]');
  await page.waitForSelector('[data-testid="ai-rejected"]', { timeout: 5000 });
  assert.match(await page.locator('[data-testid="ai-rejected"]').innerText(), /Discarded[\s\S]*name not recognised/);
  await page.close();
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} scenari ok` + (failed.length ? ' — FALLITI: ' + failed.map((f) => f[0]).join('; ') : ''));
console.log('screenshot in ' + SHOTS);
process.exit(failed.length ? 1 : 0);
