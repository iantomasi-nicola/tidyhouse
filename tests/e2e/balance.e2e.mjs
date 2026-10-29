// E2E dei controlli admin su recuperi/riposi (js/balance.js) e della scelta «Senza recupero / Con recupero» in «Assegna la settimana». Esecuzione: node tests/e2e/balance.e2e.mjs
// Orologio finto: mercoledì 2026-10-28 10:00 (settimana corrente = quella che chiude 2026-11-01). Persone: anna (admin), bruno, carla.
// Variabili: SHOTS=<cartella> per salvare gli screenshot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { start, seed } from './helpers.mjs';

const NOW = '2026-10-28T10:00:00';
const CUR = '2026-11-01';
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'balance-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHORES = ['floor', 'bathroom', 'kitchen'];
const IDX = { floor: 0, bathroom: 1, kitchen: 2 };
const NAME = { anna: 'Anna', bruno: 'Bruno', carla: 'Carla' };
const GAP = 450;   // ~400ms tra click ravvicinati (toast/ridisegno)

const env = await start();
const MINE = /(balance|weekassign|assignlogic|choresheet|strings\/(balance|assign)|\/actions\.js)/;

// storico pulito: le settimane passate sono tutte fatte, quindi nessuno parte con recuperi (altrimenti il seed ne produce da sé)
const CLEAN = Object.fromEntries(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map((w) => [w, { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } }]));
async function mk({ me = 'anna', admin = true, lang = 'it-IT', viewport, dark, houseExtra = {}, weeks, path: hash = '#/more' } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: seed({ me, admin, weeks: { ...CLEAN, ...weeks }, houseExtra: { requireRules: false, ...houseExtra } }) });
  page.__bad = [];
  page.on('response', (r) => { if (r.status() >= 400) page.__bad.push(r.status() + ' ' + r.url()); });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector(hash === '#/calendar' ? '.cal .week' : '#app *', { timeout: 8000 });
  await page.waitForTimeout(300);
  return page;
}
const rowOf = (page, sunday = CUR) => page.evaluate((s) => { const r = window.__app.calc.out.rows.find((x) => x.sunday === s); return { assigned: r.assigned, swapped: r.swapped, debts: r.debts, credits: r.credits, nm: r.nm, restName: r.restName, closed: r.closed }; }, sunday);
const wkDoc = (page, s = CUR) => page.evaluate((sun) => JSON.parse(JSON.stringify(window.__app.state.weeks[sun] || {})), s);
const logs = (page, type) => page.evaluate((ty) => Object.values(window.__app.state.log).filter((l) => l.type === ty).map((l) => l.p), type);
const debtOf = async (page, id, chore) => { const r = await rowOf(page); return r.debts[r.nm.indexOf(id)][IDX[chore]]; };
const creditOf = async (page, id) => { const r = await rowOf(page); return Math.max(0, r.credits[r.nm.indexOf(id)]); };
const gap = (page) => page.waitForTimeout(GAP);
const N = async (page, key, id) => Number(await page.locator(`[data-testid="bal-n-${key}-${id}"]`).innerText());
const btn = (page, act, who) => page.locator(`#layer .sheet [data-act="${act}"][data-who="${who}"]`);
const toastText = (page) => page.locator('.toast').last().innerText();
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const noErrors = (page, label) => {
  const errs = (page.__errors || []).filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(errs, [], `errori in console (${label})`);
  assert.deepEqual((page.__bad || []).filter((u) => MINE.test(u)), [], `risorse mancanti (${label})`);
};
const noOverflow = async (page, label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#layer .sheet')].every((s) => s.scrollWidth <= s.clientWidth + 1)), 'overflow orizzontale: ' + label);
/** Apre «Altro» > riga «Recuperi e riposi» (testo bal.btn). */
async function openBalance(page, label = 'Recuperi e riposi') {
  await page.locator('#app .li, #app a, #app button').filter({ hasText: label }).first().click();
  await page.waitForSelector('#layer .sheet.on .bal');
  await page.waitForTimeout(450);
}
/** Tap target: tutti i pulsanti del pannello hanno almeno 44px in entrambe le direzioni. */
const smallTargets = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.width < 43.5 || r.height < 43.5); }).map((b) => (b.dataset.act || b.dataset.testid || b.className) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)), sel);

const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log('  ok   ' + name + ` (${Date.now() - t0}ms)`); }
  catch (e) { results.push([name, false]); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 7).join('\n       ')); }
}

// ---------------------------------------------------------------- pannello recuperi e riposi
await scenario('admin: Altro → «Recuperi e riposi» → +/− recupero e riposo con Annulla, «Togli tutti i recuperi», «Togli i riposi»', async () => {
  const page = await mk();
  await openBalance(page);
  const title = await page.locator('#layer .sheet.on h2').first().innerText();
  assert.match(title, /Recuperi e riposi/);
  // una scheda per persona, con 3 mansioni + riposo; i «−» sono disabilitati a zero
  assert.equal(await page.locator('#layer .sheet .bal-card').count(), 3);
  assert.equal(await page.locator('#layer .sheet .bal-card[data-person="bruno"] .bal-row').count(), 4);
  assert.equal(await btn(page, 'bal-sub-floor', 'bruno').isDisabled(), true);
  assert.equal(await btn(page, 'bal-sub-credit', 'bruno').isDisabled(), true);
  assert.equal(await page.locator('[data-act="bal-clear-mk"], [data-act="bal-clear-rest"]').count(), 0, 'a zero non ci sono i pulsanti «togli tutti»');
  assert.equal(await page.locator('#layer .sheet .bal-card[data-person="bruno"]').getByRole('button', { name: 'Aggiungi un recupero di pavimenti a Bruno' }).count(), 1, 'etichette accessibili');
  const base = await rowOf(page);
  const bi = base.nm.indexOf('bruno');
  assert.deepEqual(base.debts[bi], [0, 0, 0]);

  // + recupero pavimenti a Bruno
  await btn(page, 'bal-add-floor', 'bruno').click(); await gap(page);
  assert.equal(await N(page, 'floor', 'bruno'), 1);
  assert.equal(await debtOf(page, 'bruno', 'floor'), 1);
  assert.equal((await rowOf(page)).assigned[0], 'bruno', 'con un recupero aperto Bruno è assegnato ai pavimenti');
  assert.equal((await wkDoc(page)).adj.bruno.floor, 1);
  assert.match(await toastText(page), /Fatto: recuperi di Bruno aggiornati[\s\S]*Annulla/);
  assert.equal(await btn(page, 'bal-sub-floor', 'bruno').isDisabled(), false);
  assert.equal(await page.locator('[data-act="bal-clear-mk"][data-who="bruno"]').count(), 1);
  // Annulla → torna a zero
  await page.locator('.toast .toast-action').click(); await gap(page);
  assert.equal(await N(page, 'floor', 'bruno'), 0);
  assert.equal(await debtOf(page, 'bruno', 'floor'), 0);
  assert.match(await toastText(page), /Annullato/);

  // +2 recuperi cucina e +1 bagno poi «−» cucina
  await btn(page, 'bal-add-kitchen', 'carla').click(); await gap(page);
  await btn(page, 'bal-add-kitchen', 'carla').click(); await gap(page);
  await btn(page, 'bal-add-bathroom', 'carla').click(); await gap(page);
  assert.equal(await N(page, 'kitchen', 'carla'), 2); assert.equal(await N(page, 'bathroom', 'carla'), 1);
  await btn(page, 'bal-sub-kitchen', 'carla').click(); await gap(page);
  assert.equal(await N(page, 'kitchen', 'carla'), 1); assert.equal(await debtOf(page, 'carla', 'kitchen'), 1);
  // Annulla della sottrazione: ripristina il 2
  await page.locator('.toast .toast-action').click(); await gap(page);
  assert.equal(await N(page, 'kitchen', 'carla'), 2);
  // «Togli tutti i recuperi» azzera le tre mansioni (e il pulsante sparisce); Annulla li rimette
  await page.locator('[data-act="bal-clear-mk"][data-who="carla"]').click(); await gap(page);
  assert.deepEqual([await N(page, 'floor', 'carla'), await N(page, 'bathroom', 'carla'), await N(page, 'kitchen', 'carla')], [0, 0, 0]);
  assert.equal(await page.locator('[data-act="bal-clear-mk"][data-who="carla"]').count(), 0);
  assert.deepEqual((await rowOf(page)).debts[(await rowOf(page)).nm.indexOf('carla')], [0, 0, 0]);
  await page.locator('.toast .toast-action').click(); await gap(page);
  assert.equal(await N(page, 'kitchen', 'carla'), 2); assert.equal(await N(page, 'bathroom', 'carla'), 1);
  await page.locator('[data-act="bal-clear-mk"][data-who="carla"]').click(); await gap(page);
  assert.equal(await N(page, 'kitchen', 'carla'), 0);

  // riposo: + a Anna → la porta a riposo; Annulla; poi «Togli i riposi»
  await btn(page, 'bal-add-credit', 'anna').click(); await gap(page);
  assert.equal(await N(page, 'credit', 'anna'), 1);
  assert.equal(await creditOf(page, 'anna'), 1);
  assert.equal((await rowOf(page)).restName, 'anna', 'il riposo porta Anna a riposo');
  assert.match(await toastText(page), /riposi di Anna aggiornati/);
  await page.locator('.toast .toast-action').click(); await gap(page);
  assert.equal(await N(page, 'credit', 'anna'), 0); assert.equal(await creditOf(page, 'anna'), 0);
  await btn(page, 'bal-add-credit', 'anna').click(); await gap(page);
  await btn(page, 'bal-add-credit', 'anna').click(); await gap(page);
  assert.equal(await N(page, 'credit', 'anna'), 2);
  await btn(page, 'bal-sub-credit', 'anna').click(); await gap(page);
  assert.equal(await N(page, 'credit', 'anna'), 1);
  await page.locator('[data-act="bal-clear-rest"][data-who="anna"]').click(); await gap(page);
  assert.equal(await N(page, 'credit', 'anna'), 0); assert.equal(await creditOf(page, 'anna'), 0);
  assert.equal(await page.locator('[data-act="bal-clear-rest"]').count(), 0);

  // registro attività: una voce per ogni correzione applicata, con la frase leggibile
  const adj = await logs(page, 'adjust');
  assert.ok(adj.length >= 8, 'voci nel registro: ' + adj.length);
  assert.ok(adj.every((p) => p.who && p.d && Object.keys(p.d).length));
  noErrors(page, 'pannello'); await page.close();
});

await scenario('registro attività: la voce «correzione recuperi/riposi» è leggibile (IT)', async () => {
  const page = await mk();
  await openBalance(page);
  await btn(page, 'bal-add-credit', 'bruno').click(); await gap(page);
  await btn(page, 'bal-add-floor', 'bruno').click(); await gap(page);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.goto(env.url + '/#/activity'); await page.waitForTimeout(600);
  const txt = await page.locator('#app').innerText();
  assert.match(txt, /Bruno: correzione recuperi\/riposi \(Riposo \+1\)/);
  assert.match(txt, /Bruno: correzione recuperi\/riposi \(Pavimenti \+1\)/);
  assert.doesNotMatch(txt, /\b(bal|act)\.[a-z]/i);
  noErrors(page, 'registro'); await page.close();
});

await scenario('non admin: la riga non compare e l\'azione è rifiutata', async () => {
  const page = await mk({ me: 'bruno', admin: false });
  assert.equal(await page.locator('#app').getByText('Recuperi e riposi').count(), 0);
  const res = await page.evaluate(async () => {
    const m = await import('/js/balance.js'); const r = m.openBalanceSheet(window.__app);
    let denied = false; try { await window.__app.actions.adjustBalance('bruno', { floor: 1 }); } catch (e) { denied = e.message === 'permission'; }
    return { opened: !!r, denied };
  });
  assert.deepEqual(res, { opened: false, denied: true });
  assert.equal((await wkDoc(page)).adj, undefined);
  noErrors(page, 'non admin'); await page.close();
});

await scenario('settimana corrente con risultati: la correzione vale dalla successiva', async () => {
  const page = await mk({ weeks: { [CUR]: { result: { floor: 'done' } } } });
  await openBalance(page);
  await btn(page, 'bal-add-credit', 'carla').click(); await gap(page);
  assert.deepEqual(await wkDoc(page), { result: { floor: 'done' } }, 'la settimana con risultati non viene toccata');
  const nxt = await wkDoc(page, '2026-11-08');
  assert.equal(nxt.adj.carla.credit, 1);
  noErrors(page, 'successiva'); await page.close();
});

await scenario('EN + scuro, 320px: testi inglesi, nessun overflow, tap target ≥44px', async () => {
  for (const dark of [false, true]) {
    const page = await mk({ lang: 'en-US', dark, viewport: { width: 320, height: 640 }, houseExtra: { lang: 'en' } });
    await page.locator('#app').getByText('Make-ups and rests').first().click();
    await page.waitForSelector('#layer .sheet.on .bal'); await page.waitForTimeout(450);
    const txt = await page.locator('#layer .sheet').last().innerText();
    assert.match(txt, /Make-ups and rests/); assert.doesNotMatch(txt, /Recuperi|Riposo|bal\./);
    // stato massimo: tutto valorizzato (i pulsanti «Remove all make-ups» / «Remove rests» sono visibili)
    await btn(page, 'bal-add-floor', 'anna').click(); await gap(page);
    await btn(page, 'bal-add-credit', 'anna').click(); await gap(page);
    await btn(page, 'bal-add-kitchen', 'bruno').click(); await gap(page);
    await btn(page, 'bal-add-kitchen', 'bruno').click(); await gap(page);
    assert.equal(await page.locator('[data-act="bal-clear-mk"]').count(), 2); assert.equal(await page.locator('[data-act="bal-clear-rest"]').count(), 1);
    assert.match(await page.locator('[data-act="bal-clear-mk"]').first().innerText(), /Remove all make-ups/);
    assert.match(await page.locator('[data-act="bal-clear-rest"]').first().innerText(), /Remove rests/);
    await noOverflow(page, 'pannello 320 ' + (dark ? 'scuro' : 'chiaro'));
    const small = await smallTargets(page, '#layer .sheet .bal button');
    assert.deepEqual(small, [], 'tap target < 44px: ' + small.join(', '));
    // anche «Altro» (la riga) non deve fare overflow
    await shot(page, `balance-320-${dark ? 'dark' : 'light'}`);
    noErrors(page, 'EN ' + dark); await page.close();
  }
});

await scenario('IT 320px con nomi lunghi: nessun overflow', async () => {
  const s = seed({ weeks: CLEAN, houseExtra: { requireRules: false } });
  const hk = Object.keys(s).find((k) => k.startsWith('cp:h:'));
  s[hk].house.roommates[1].name = 'Bartolomeo Maria Giovanni';
  const page = await env.page({ now: NOW, viewport: { width: 320, height: 640 }, seed: s });
  await page.goto(env.url + '/#/more'); await page.waitForSelector('#app *'); await page.waitForTimeout(300);
  await openBalance(page);
  await noOverflow(page, 'nome lungo');
  assert.deepEqual(await smallTargets(page, '#layer .sheet .bal button'), []);
  noErrors(page, 'nome lungo'); await page.close();
});

// ---------------------------------------------------------------- Assegna la settimana: senza / con recupero
const openAssign = async (page, sunday = CUR) => {
  await page.evaluate((s) => import('/js/weekassign.js').then((m) => m.openAssignWeekSheet(window.__app, s)), sunday);
  await page.waitForSelector('#layer .sheet.on [data-chore-card]'); await page.waitForTimeout(450);
};
const chip = (page, chore, who) => page.locator(`.wa-opt[data-chore="${chore}"][data-who="${who}"]`);
const term = (page, chore, k) => page.locator(`[data-testid="wa-terms-${chore}-${k}"]`);
const closeSheet = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(500); };

await scenario('Assegna la settimana: «Senza recupero» = scambio (swap), nessun accordo', async () => {
  const page = await mk({ path: '#/' });
  const before = await rowOf(page);
  const f0 = before.assigned[0];
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== f0);
  await openAssign(page);
  // finché si resta su «Come da regole» la scelta non compare
  assert.equal(await page.locator('.wa-terms').count(), 0);
  await chip(page, 'floor', other).click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('.wa-terms').count(), 1, 'solo per la mansione cambiata');
  assert.equal(await term(page, 'floor', 'free').getAttribute('aria-checked'), 'true', 'predefinito: senza recupero');
  assert.equal(await term(page, 'floor', 'repay').getAttribute('aria-checked'), 'false');
  assert.match(await term(page, 'floor', 'free').innerText(), /Senza recupero[\s\S]*nessun debito per nessuno/);
  assert.match(await term(page, 'floor', 'free').innerText(), new RegExp(NAME[other] + ' prende il turno al posto di ' + NAME[f0]));
  assert.equal(await page.locator('[data-testid="wa-repay-floor"]').count(), 0);
  assert.match(await page.locator('[data-testid="wa-preview"]').innerText(), new RegExp(`${NAME[f0]} → ${NAME[other]}`));
  await page.click('[data-act="wa-save"]');
  await page.waitForFunction(() => document.querySelectorAll('#layer .sheet.on').length === 0, null, { timeout: 4000 });
  await page.waitForTimeout(400);
  const wk = await wkDoc(page);
  assert.deepEqual(wk.swap, { floor: other });
  assert.ok(!wk.agreed || !wk.agreed.floor, 'nessun accordo');
  const after = await rowOf(page);
  assert.equal(after.assigned[0], other); assert.equal(after.swapped[0], true);
  // nessun debito per nessuno
  for (const d of after.debts.filter(Boolean)) assert.deepEqual(d, [0, 0, 0]);
  // riapro: la scelta ricorda «Senza recupero»
  await openAssign(page);
  assert.equal(await chip(page, 'floor', other).getAttribute('aria-checked'), 'true');
  assert.equal(await term(page, 'floor', 'free').getAttribute('aria-checked'), 'true');
  noErrors(page, 'senza recupero'); await page.close();
});

await scenario('Assegna la settimana: «Con recupero» = nessuno swap + accordo (agreed); Annulla; si può tornare a «Senza recupero»', async () => {
  const page = await mk({ path: '#/' });
  const before = await rowOf(page);
  const f0 = before.assigned[0];
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== f0);
  await openAssign(page);
  await chip(page, 'floor', other).click(); await page.waitForTimeout(300);
  await term(page, 'floor', 'repay').click(); await page.waitForTimeout(300);
  assert.equal(await term(page, 'floor', 'repay').getAttribute('aria-checked'), 'true');
  assert.equal(await term(page, 'floor', 'free').getAttribute('aria-checked'), 'false');
  assert.match(await term(page, 'floor', 'repay').innerText(), new RegExp(`${NAME[other]} pulisce al posto di ${NAME[f0]}[\\s\\S]*${NAME[f0]} recupera, ${NAME[other]} guadagna un riposo`));
  assert.match(await page.locator('[data-testid="wa-repay-floor"]').innerText(), new RegExp(`${NAME[other]} pulisce pavimenti al posto di ${NAME[f0]}, con recupero`));
  assert.equal(await page.locator('[data-act="wa-save"]').isDisabled(), false, 'salvabile anche se l\'assegnato non cambia');
  await shot(page, 'terms-repay-390');
  await page.click('[data-act="wa-save"]');
  await page.waitForFunction(() => document.querySelectorAll('#layer .sheet.on').length === 0, null, { timeout: 4000 });
  await page.waitForTimeout(500);
  const wk = await wkDoc(page);
  assert.equal(wk.swap, undefined, 'con recupero: nessuno scambio');
  assert.equal(wk.agreed.floor, other, 'accordo registrato');
  const after = await rowOf(page);
  assert.equal(after.assigned[0], f0, 'l\'assegnato resta quello delle regole'); assert.equal(after.swapped[0], false);
  const lg = (await logs(page, 'agreed')).find((p) => p.chore === 'floor');
  assert.equal(lg && lg.who, other);
  assert.match(await toastText(page), /Settimana assegnata[\s\S]*Annulla/);
  // Annulla → accordo rimosso
  await page.locator('.toast .toast-action').click(); await page.waitForTimeout(600);
  assert.ok(!(await wkDoc(page)).agreed || !(await wkDoc(page)).agreed.floor, 'Annulla toglie l\'accordo');
  assert.equal((await rowOf(page)).assigned[0], f0);
  // di nuovo con recupero, poi riapro: preselezionato «Con recupero»; passo a «Senza recupero» → swap e accordo tolto
  await openAssign(page);
  await chip(page, 'floor', other).click(); await page.waitForTimeout(300);
  await term(page, 'floor', 'repay').click(); await page.waitForTimeout(300);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(700);
  assert.equal((await wkDoc(page)).agreed.floor, other);
  await openAssign(page);
  assert.equal(await chip(page, 'floor', other).getAttribute('aria-checked'), 'true', 'riaperto: persona preselezionata');
  assert.equal(await term(page, 'floor', 'repay').getAttribute('aria-checked'), 'true', 'riaperto: «Con recupero» preselezionato');
  assert.equal(await page.locator('[data-act="wa-save"]').isDisabled(), true, 'nessuna modifica');
  await term(page, 'floor', 'free').click(); await page.waitForTimeout(300);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(800);
  const wk2 = await wkDoc(page);
  assert.deepEqual(wk2.swap, { floor: other });
  assert.ok(!wk2.agreed || !wk2.agreed.floor, 'accordo tolto');
  assert.equal((await rowOf(page)).assigned[0], other);
  noErrors(page, 'con recupero'); await page.close();
});

await scenario('Assegna la settimana: due mansioni con scelte diverse; EN; 320px senza overflow e tap target ≥44px', async () => {
  const page = await mk({ lang: 'en-US', houseExtra: { lang: 'en' }, viewport: { width: 320, height: 640 }, path: '#/' });
  const before = await rowOf(page);
  const [f0, b0] = before.assigned;
  const ofF = ['anna', 'bruno', 'carla'].find((x) => x !== f0);
  const ofB = ['anna', 'bruno', 'carla'].find((x) => x !== b0);
  await openAssign(page);
  await chip(page, 'floor', ofF).click(); await page.waitForTimeout(300);
  await chip(page, 'bathroom', ofB).click(); await page.waitForTimeout(300);
  await term(page, 'bathroom', 'repay').click(); await page.waitForTimeout(300);
  const txt = await page.locator('#layer .sheet').last().innerText();
  assert.match(txt, /Without make-up/); assert.match(txt, /With make-up/); assert.doesNotMatch(txt, /Senza recupero|assign\.terms/);
  await noOverflow(page, 'assegna 320');
  const small = await smallTargets(page, '#layer .sheet .wa-term, #layer .sheet .wa-opt, #layer .sheet [data-act="wa-save"]');
  assert.deepEqual(small, [], 'tap target < 44px: ' + small.join(', '));
  await shot(page, 'terms-320');
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(800);
  const wk = await wkDoc(page);
  assert.deepEqual(wk.swap, { floor: ofF });
  assert.equal(wk.agreed.bathroom, ofB); assert.ok(!wk.agreed.floor);
  const after = await rowOf(page);
  assert.deepEqual(after.assigned, [ofF, b0, before.assigned[2]]);
  noErrors(page, 'due mansioni'); await page.close();
});

await scenario('Assegna la settimana: «Nessuno questa settimana» (solo admin), nessun debito, riapertura e ritorno alle regole', async () => {
  const page = await mk({ path: '#/' });
  const before = await rowOf(page);
  await openAssign(page);
  assert.match(await chip(page, 'kitchen', '-').innerText(), /Nessuno questa settimana/);
  await chip(page, 'kitchen', '-').click(); await page.waitForTimeout(300);
  assert.equal(await chip(page, 'kitchen', '-').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('.wa-terms').count(), 0, 'niente con/senza recupero per «nessuno»');
  assert.match(await page.locator('[data-testid="wa-preview"]').innerText(), /nessuno/i);
  await page.click('[data-act="wa-save"]');
  await page.waitForFunction(() => document.querySelectorAll('#layer .sheet.on').length === 0, null, { timeout: 4000 });
  await page.waitForTimeout(400);
  assert.deepEqual((await wkDoc(page)).swap, { kitchen: '-' });
  const after = await rowOf(page);
  assert.equal(after.assigned[2], ''); assert.equal(after.assigned[0], before.assigned[0]);
  for (const d of after.debts.filter(Boolean)) assert.deepEqual(d, [0, 0, 0]);
  await openAssign(page);
  assert.equal(await chip(page, 'kitchen', '-').getAttribute('aria-checked'), 'true', 'riaperto: «nessuno» preselezionato');
  await chip(page, 'kitchen', '').click(); await page.waitForTimeout(300);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(700);
  assert.equal((await rowOf(page)).assigned[2], before.assigned[2]);
  noErrors(page, 'nessuno'); await page.close();
});

await scenario('Assegna la settimana: si può assegnare anche a un assente', async () => {
  const page = await mk({ path: '#/' });
  const before = await rowOf(page);
  const away = ['anna', 'bruno', 'carla'].find((x) => x !== before.assigned[0]);
  await page.evaluate(([w, id]) => window.__app.actions.setAway(w, id, true), [CUR, away]);
  await page.waitForTimeout(400);
  assert.ok((await page.evaluate((s) => window.__app.calc.out.rows.find((x) => x.sunday === s).away, CUR)).includes(away));
  await openAssign(page);
  assert.match(await chip(page, 'floor', away).innerText(), /assente/);
  await chip(page, 'floor', away).click(); await page.waitForTimeout(300);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(700);
  assert.equal((await rowOf(page)).assigned[0], away);
  noErrors(page, 'assente'); await page.close();
});

await scenario('Correggi chi ha pulito: settimana passata → ha pulito X / nessuno ha pulito / saltato anche X / azzera, con Annulla', async () => {
  const page = await mk({ path: '#/' });
  const PAST = '2026-10-25';
  const res = () => page.evaluate((w) => (window.__app.state.weeks[w].result || {}).floor || '', PAST);
  const r0 = await page.evaluate((w) => window.__app.calc.out.rows.find((x) => x.sunday === w).assigned, PAST);
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== r0[0]);
  // scheda turno → «Gestisci (admin)» → «Com'è andata»: un tocco per scelta, la scheda resta aperta
  await page.evaluate((w) => import('/js/choresheet.js').then((m) => m.openChoreSheet(window.__app, w, 'floor')), PAST);
  await page.waitForSelector('#layer .sheet.on [data-act="res-floor"]'); await page.waitForTimeout(450);
  assert.equal(await page.locator('#layer .sheet [data-act="res-floor"][data-value="done"]').getAttribute('aria-pressed'), 'true', 'stato attuale: fatto');
  await page.click(`#layer .sheet [data-act="res-floor"][data-value="by:${other}"]`); await page.waitForTimeout(700);
  assert.equal(await res(), `by:${other}`);
  assert.match(await toastText(page), /Risultato aggiornato/);
  await page.click('.toast button'); await page.waitForTimeout(600);
  assert.equal(await res(), 'done', 'Annulla ripristina');
  for (const v of ['skipped', `skipped:${other}`, '']) {
    await page.click(`#layer .sheet [data-act="res-floor"][data-value="${v || 'reset'}"]`); await page.waitForTimeout(700);
    assert.equal(await res(), v);
  }
  // anche come foglio a sé
  await page.evaluate((w) => import('/js/resultedit.js').then((m) => m.openResultEditSheet(window.__app, w, 'floor')), PAST);
  await page.waitForSelector('#layer .sheet.on [data-value="skipped"]'); await page.waitForTimeout(450);
  await page.locator('#layer .sheet.on').last().locator('[data-value="skipped"]').click(); await page.waitForTimeout(700);
  assert.equal(await res(), 'skipped');
  noErrors(page, 'correggi'); await page.close();
});

await scenario('Classifica: l\'admin toglie e rimette il badge TR (non admin non vede i bottoni)', async () => {
  const page = await mk({ path: '#/stats' });
  await page.waitForSelector('[data-person]', { timeout: 8000 });
  const trRow = page.locator('[data-person]').filter({ has: page.locator('.chip:has-text("TR")') }).first();
  assert.ok(await trRow.count(), 'qualcuno ha il TR');
  const who = await trRow.getAttribute('data-person');
  await trRow.click(); await page.waitForSelector('#layer .sheet.on [data-act="badge-tr"]'); await page.waitForTimeout(450);
  assert.match(await page.locator('#layer .sheet [data-act="badge-tr"]').innerText(), /Togli TR/);
  await page.click('#layer .sheet [data-act="badge-tr"]'); await page.waitForTimeout(700);
  const off = await page.evaluate((id) => (window.__app.house.badgeOff || {})[id], who);
  assert.deepEqual(off, { tr: true });
  assert.equal(await page.locator(`[data-person="${who}"] .chip:has-text("TR")`).count(), 0, 'badge tolto dalla classifica');
  await page.locator(`[data-person="${who}"]`).first().click(); await page.waitForSelector('#layer .sheet.on [data-act="badge-tr"]'); await page.waitForTimeout(450);
  assert.match(await page.locator('#layer .sheet [data-act="badge-tr"]').innerText(), /Rimetti TR/);
  await page.click('#layer .sheet [data-act="badge-tr"]'); await page.waitForTimeout(700);
  assert.equal(await page.locator(`[data-person="${who}"] .chip:has-text("TR")`).count() > 0, true, 'badge rimesso');
  noErrors(page, 'badge'); await page.close();
  const np = await mk({ path: '#/stats', admin: false, me: 'bruno' });
  await np.waitForSelector('[data-person]', { timeout: 8000 });
  await np.locator('[data-person]').first().click(); await np.waitForTimeout(600);
  assert.equal(await np.locator('[data-act^="badge-"]').count(), 0);
  await np.close();
});

await scenario('Assegna la settimana: persona uguale alle regole → nessuna scelta; da «Senza» a «Con recupero» toglie lo scambio', async () => {
  const page = await mk({ path: '#/' });
  const before = await rowOf(page);
  await openAssign(page);
  await chip(page, 'floor', before.assigned[0]).click(); await page.waitForTimeout(300);
  assert.equal(await chip(page, 'floor', '').getAttribute('aria-checked'), 'true', 'uguale alle regole: torna a «Come da regole»');
  assert.equal(await page.locator('.wa-terms').count(), 0);
  // swap già salvato («senza recupero») → passo a «con recupero»: lo scambio sparisce e nasce l'accordo
  const other = ['anna', 'bruno', 'carla'].find((x) => x !== before.assigned[0]);
  await chip(page, 'floor', other).click(); await page.waitForTimeout(300);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(700);
  assert.deepEqual((await wkDoc(page)).swap, { floor: other });
  await openAssign(page);
  await term(page, 'floor', 'repay').click(); await page.waitForTimeout(300);
  await page.click('[data-act="wa-save"]'); await page.waitForTimeout(800);
  const wk = await wkDoc(page);
  assert.equal(wk.swap, undefined); assert.equal(wk.agreed.floor, other);
  assert.equal((await rowOf(page)).assigned[0], before.assigned[0]);
  noErrors(page, 'uguale alle regole'); await page.close();
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} scenari ok` + (failed.length ? ' — FALLITI: ' + failed.map((f) => f[0]).join('; ') : ''));
console.log('screenshot in ' + SHOTS);
process.exit(failed.length ? 1 : 0);
