// E2E (Playwright) di "Altro" - seconda parte: lista della spesa senza perdite di input, richieste (scambi, sostituzioni,
// offerte, avvisi), checklist ricorrenti per mansione/frequenza, registro attività e registro ingressi (Impostazioni > Accessi).
// Esegui con:  node tests/e2e/more2.e2e.mjs [filtro]      Screenshot in SHOT_DIR (default: scratchpad/more2).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const SHOT = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-tidyhouse/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/more2/';
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
  const m = txt.match(/\b(onb|moreX|moreY|moreZ|more|needs|rules|tasks|lastout|req|act|acc|setX|guide|misc|home|chore)\.[a-zA-Z][\w.]*/);
  assert.doesNotMatch(txt, /\b(null|undefined|NaN)\b/, 'valori grezzi in ' + label);
  assert.ok(!m, `chiave non tradotta in ${label}: ${m && m[0]}`);
}
async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.error('FAIL ', name, '\n', e && e.stack ? e.stack : e); }
}
const S = (o = {}) => seed({ ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });
const wait = (page, ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------- lista della spesa
await scenario('needs: digitazione lenta con aggiornamenti remoti (nessun carattere perso, nodo input stabile)', async () => {
  const page = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', dark: true });
  await goto(page, '/needs');
  await page.waitForSelector('#mx-need');
  // osservatore: quanti input/textarea vengono aggiunti o tolti dal documento
  await page.evaluate(() => {
    window.__mut = { added: 0, removed: 0 };
    const cnt = (n) => (n.nodeType === 1 ? (n.matches('input,textarea,select') ? 1 : 0) + n.querySelectorAll('input,textarea,select').length : 0);
    new MutationObserver((recs) => { for (const r of recs) { r.addedNodes.forEach((n) => { window.__mut.added += cnt(n); }); r.removedNodes.forEach((n) => { window.__mut.removed += cnt(n); }); } }).observe(document.body, { childList: true, subtree: true });
    window.__inp = document.getElementById('mx-need');
  });
  const typed = 'Latte intero 1L, pane integrale & ciliegie àèìòù – fine';
  assert.ok(typed.length < 80);
  await page.click('#mx-need');
  // aggiornamenti "remoti" (altri coinquilini) mentre si digita: nuove voci, voci spuntate, settimane
  const remote = page.evaluate(async () => {
    const s = window.__app.store; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 16; i++) {
      s.setDoc('needs', 'rem' + i, { text: 'Remoto ' + i, urgent: i % 5 === 0, by: i % 2 ? 'bruno' : 'carla', at: new Date(Date.now() + i).toISOString(), done: false });
      s.setDoc('weeks', '2026-11-01', { note: 'nota ' + i });
      if (i % 3 === 2) s.setDoc('needs', 'rem' + (i - 1), { done: true, doneBy: 'carla', doneAt: new Date().toISOString() });
      await sleep(110);
    }
  });
  await page.keyboard.type(typed, { delay: 75 });
  await remote;
  assert.equal(await page.inputValue('#mx-need'), typed, 'testo identico a quanto digitato');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mx-need', 'focus mantenuto');
  assert.equal(await page.evaluate(() => document.getElementById('mx-need').selectionStart), typed.length, 'caret in fondo');
  assert.equal(await page.evaluate(() => document.getElementById('mx-need') === window.__inp), true, 'stesso nodo input');
  const mut = await page.evaluate(() => window.__mut);
  assert.deepEqual(mut, { added: 0, removed: 0 }, 'nessun input ricreato durante la digitazione');
  // la lista si è aggiornata dal vivo anche mentre si scriveva
  const nOpen = await page.locator('.mx-need:not(.done)').count();
  assert.ok(nOpen >= 10, 'voci remote comparse dal vivo: ' + nOpen);
  assert.ok(await page.locator('.mx-done .mx-need').count() >= 3, 'voci remote spuntate nella sezione comprati');
  await shot(page, 'needs-typing-en-dark');
  // dopo il blur il rerender rimandato non ricrea il campo né perde il testo
  await page.locator('h1').first().click();
  await wait(page, 500);
  assert.equal(await page.evaluate(() => document.getElementById('mx-need') === window.__inp), true, 'stesso nodo dopo il rerender differito');
  assert.equal(await page.inputValue('#mx-need'), typed);
  // rerender FORZATO mentre si digita (es. cambio tema/online): focus e caret vengono rimessi, nessun carattere mangiato
  await page.fill('#mx-need', ''); await page.click('#mx-need');
  await Promise.all([
    page.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: 55 }),
    (async () => { for (let i = 0; i < 4; i++) { await wait(page, 260); await page.evaluate(() => window.__app.rerender()); } })(),
  ]);
  assert.equal(await page.inputValue('#mx-need'), 'abcdefghijklmnopqrstuvwxyz', 'nessun carattere perso con rerender forzato');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mx-need');
  assert.equal(await page.evaluate(() => document.getElementById('mx-need') === window.__inp), true);
  await noOverflow(page, 'needs typing'); await noRawKeys(page, 'needs typing');
  await done(page);
});

await scenario('needs: Invio aggiunge e svuota, doppio invio, trim, 80 caratteri, urgente, comprato, svuota, annulla rimozione', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/needs');
  await page.click('#mx-need');
  await page.keyboard.type('  Pane  ', { delay: 20 });
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');     // doppio invio
  await page.waitForSelector('.mx-need');
  assert.equal(await page.inputValue('#mx-need'), '');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mx-need', 'la tastiera resta aperta (focus nel campo)');
  let st = await store(page);
  assert.equal(Object.keys(st.needs).length, 1, 'nessun doppione');
  assert.equal(Object.values(st.needs)[0].text, 'Pane');
  // doppione già in lista: avviso, nessuna nuova voce
  await page.keyboard.type('pane', { delay: 20 }); await page.keyboard.press('Enter');
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').first().innerText(), /già in lista/);
  assert.equal(Object.keys((await store(page)).needs).length, 1);
  // oltre 80 caratteri (incolla/programmatico): tagliato a 80
  await page.fill('#mx-need', '   ' + 'y'.repeat(95)); assert.equal((await page.inputValue('#mx-need')).length, 80, 'maxlength 80 del campo');
  await page.fill('#mx-need', '');
  await page.evaluate(() => { const i = document.getElementById('mx-need'); i.value = '   ' + 'x'.repeat(95) + '   '; i.focus(); });   // valore impostato da script (aggira maxlength)
  await page.press('#mx-need', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mx-need').length === 2);
  st = await store(page);
  assert.ok(Object.values(st.needs).some((n) => n.text === 'x'.repeat(80)), 'tagliato a 80');
  // solo spazi: niente voce
  await page.fill('#mx-need', '     '); await page.press('#mx-need', 'Enter'); await wait(page, 200);
  assert.equal(Object.keys((await store(page)).needs).length, 2);
  // urgente + pulsante Aggiungi (non ruba il focus)
  await page.fill('#mx-need', 'Detersivo'); await page.locator('.mx-needform .switch').click();
  await page.locator('.mx-needform button[type=submit]').click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-need').length === 3);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mx-need');
  const first = await page.locator('.mx-need').first().innerText();
  assert.match(first, /Detersivo/); assert.match(first, /Urgente/); assert.match(first, /Aggiunto da Anna/);
  assert.equal(await page.locator('.mx-needform .switch input').isChecked(), false, 'urgente si azzera');
  await shot(page, 'needs-list');
  // comprato: un tocco sulla riga intera, breve animazione, poi passa a "Comprate" (sezione chiusa) + toast Annulla
  await page.locator('.mx-need', { hasText: 'Pane' }).locator('.mx-needmain').click();
  await page.waitForSelector('.mx-need.buying');
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  assert.equal(await page.locator('.mx-done').isVisible(), false, 'le comprate sono collassate');
  assert.match(await page.locator('.toast').last().innerText(), /Comprato: Pane/);
  await page.locator('.mx-donetoggle').click();
  assert.equal(await page.locator('.mx-done').isVisible(), true);
  assert.match(await page.locator('.mx-done').innerText(), /Comprato da Anna/);
  assert.equal(await page.locator('.mx-need.buying').count(), 0);
  // rimetti da comprare (tocco sulla riga comprata)
  await page.locator('.mx-done .mx-needmain').click();
  await page.waitForFunction(() => !document.querySelector('.mx-done'));
  await page.locator('.mx-need', { hasText: 'Pane' }).locator('.mx-needmain').click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  // Svuota: nessuna conferma, ma Annulla nel messaggio
  await page.getByRole('button', { name: /Clear bought|Svuota comprati/ }).click();
  await page.waitForFunction(() => !document.querySelector('.mx-done'));
  assert.equal(await page.locator('.sheet').count(), 0, 'nessuna conferma');
  assert.equal(Object.keys((await store(page)).needs).length, 2);
  await page.locator('.toast-action', { hasText: 'Annulla' }).last().click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  assert.equal(Object.keys((await store(page)).needs).length, 3, 'Annulla ha rimesso la voce comprata');
  await page.getByRole('button', { name: /Clear bought|Svuota comprati/ }).click();
  await page.waitForFunction(() => !document.querySelector('.mx-done'));
  assert.equal(Object.keys((await store(page)).needs).length, 2);
  // elimina con "Annulla"
  await page.locator('.mx-need', { hasText: 'Detersivo' }).locator('button.icon-btn').click();
  await page.waitForFunction(() => !/Detersivo/.test(document.querySelector('.mx-needlist').innerText));
  await page.locator('.toast-action').last().click();
  await page.waitForFunction(() => /Detersivo/.test(document.querySelector('.mx-needlist').innerText));
  assert.ok(Object.values((await store(page)).needs).some((n) => n.text === 'Detersivo' && n.urgent === true));
  await noOverflow(page, 'needs'); await noRawKeys(page, 'needs');
  await done(page);
  const p2 = await open({ seed: S({ needs: { a: { text: 'Sale', by: 'bruno', at: '2026-10-27T10:00:00.000Z', done: false, urgent: true }, b: { text: 'Uova', by: 'carla', at: '2026-10-27T11:00:00.000Z', done: true, doneBy: 'anna', doneAt: '2026-10-28T08:00:00.000Z' } }, houseExtra: { lang: 'en' } }), lang: 'en-US', viewport: D, dark: true });
  await goto(p2, '/needs'); await noRawKeys(p2, 'needs en'); await shot(p2, 'needs-en-desktop-dark'); await done(p2);
});

// ---------------------------------------------------------------- richieste
const REQ = {
  r1: { kind: 'cover', terms: 'gift', week: SUN, chore: 'kitchen', from: 'bruno', to: null, status: 'pending', at: '2026-10-27T10:00:00.000Z' },
  r2: { kind: 'cover', terms: 'repay', week: SUN, chore: 'floor', from: 'carla', to: 'anna', status: 'pending', at: '2026-10-27T10:30:00.000Z' },
  r3: { kind: 'offer', terms: 'gift', week: SUN, chore: 'bathroom', from: 'bruno', to: 'anna', status: 'pending', at: '2026-10-27T11:00:00.000Z' },
  r4: { kind: 'cover', week: SUN, chore: 'bathroom', from: 'anna', to: null, status: 'pending', at: '2026-10-27T12:00:00.000Z' },
  r5: { kind: 'offer', week: SUN, chore: 'kitchen', from: 'anna', to: 'carla', status: 'pending', at: '2026-10-27T12:30:00.000Z' },
  r6: { kind: 'notice', code: 'volunteer', week: '2026-10-25', chore: 'kitchen', from: 'bruno', to: 'anna', status: 'info', at: '2026-10-26T09:00:00.000Z' },
  r7: { kind: 'cover', terms: 'repay', week: '2026-10-25', chore: 'floor', from: 'anna', to: null, status: 'accepted', by: 'carla', at: '2026-10-20T09:00:00.000Z', answeredAt: '2026-10-21T09:00:00.000Z' },
  r8: { kind: 'cover', week: SUN, chore: 'floor', from: 'bruno', to: 'carla', status: 'pending', at: '2026-10-27T13:00:00.000Z' },
  r9: { kind: 'offer', week: '2026-10-25', chore: 'bathroom', from: 'carla', to: 'bruno', status: 'declined', at: '2026-10-20T10:00:00.000Z', answeredAt: '2026-10-21T10:00:00.000Z' },
  r10: { week: '2026-10-25', from: 'carla', to: 'anna', fromChore: 'kitchen', toChore: 'floor', status: 'accepted', at: '2026-10-20T11:00:00.000Z', answeredAt: '2026-10-21T11:00:00.000Z' },
  n1: { kind: 'nudge', to: 'anna', from: 'bruno', text: 'ciao', status: 'pending', at: '2026-10-27T10:00:00.000Z' },
};
const reqSeed = (o = {}) => { const s = S(o); s['cp:h:' + HID].requests = JSON.parse(JSON.stringify(REQ)); return s; };

await scenario('requests: sostituzioni, offerte, avvisi, stato, annulla, badge hub', async () => {
  const page = await open({ seed: reqSeed() });
  await goto(page, '/more');
  assert.equal(await page.locator('a.li[href="#/requests"] .chip').innerText(), '3', 'badge nell\'hub: r1 (a tutti), r2, r3');
  assert.match(await page.locator('a.li[href="#/requests"]').innerText(), /3 in attesa di una tua risposta/);
  await goto(page, '/requests');
  let t = await body(page);
  assert.match(t, /Bruno cerca un sostituto per cucina/); assert.match(t, /Carla ti chiede di fare pavimenti al suo posto/);
  assert.match(t, /Bruno si offre di fare bagno al posto tuo/);
  assert.match(t, /Cerchi un sostituto per bagno/); assert.match(t, /Ti sei offerto di fare cucina al posto di Carla/);
  assert.match(t, /Bruno ha pulito cucina al posto tuo/); assert.match(t, /Solo informativo/);
  // condizioni: chip, spiegazione di una riga, conseguenze prima di rispondere
  assert.match(await page.locator('[data-testid=req-r1]').innerText(), /Regalo/);
  assert.match(await page.locator('[data-testid=terms-r1]').innerText(), /Regalo: il turno passa a chi se ne fa carico, nessun recupero\./);
  assert.match(await page.locator('[data-testid=terms-r1]').innerText(), /Se accetti[\s\S]*Il turno passa a Anna[\s\S]*Bruno non deve recuperarlo/);
  assert.match(await page.locator('[data-testid=terms-r2]').innerText(), /Con recupero: la settimana prossima il turno si recupera, chi lo fa guadagna un riposo\./);
  assert.match(await page.locator('[data-testid=terms-r2]').innerText(), /Anna fa il turno e guadagna un riposo[\s\S]*Carla lo recupera la settimana prossima/);
  assert.match(await page.locator('[data-testid=terms-r3]').innerText(), /Il turno passa a Bruno/);
  assert.match(await page.locator('[data-testid=req-r4]').innerText(), /Con recupero/, 'senza terms = con recupero');
  assert.match(await page.locator('[data-testid=req-history] [data-testid=req-r7]').innerText(), /Con recupero/);
  assert.match(t, /Concordata/); assert.match(t, /Rifiutata/); assert.match(t, /Lo farà Carla/);
  assert.match(t, /Altre richieste in attesa/); assert.match(t, /Bruno ha chiesto a Carla di fare pavimenti al suo posto/);
  assert.equal(await page.locator('[data-testid=req-r1] [data-testid=req-decline-r1]').count(), 0, 'sostituzione aperta a tutti: solo "Ci penso io"');
  assert.equal(await page.locator('[data-testid=req-r2] [data-testid=req-decline-r2]').count(), 1);
  await shot(page, 'requests-it-mobile');
  await noOverflow(page, 'requests'); await noRawKeys(page, 'requests');
  // accetto la sostituzione aperta a tutti
  await page.locator('[data-testid=req-accept-r1]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=req-accept-r1]'));
  let st = await store(page);
  assert.equal(st.requests.r1.status, 'accepted'); assert.equal(st.requests.r1.by, 'anna');
  assert.equal(st.weeks[SUN].agreed.kitchen, 'anna');
  // rifiuto la sostituzione indirizzata a me
  await page.locator('[data-testid=req-decline-r2]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=req-decline-r2]'));
  assert.equal((await store(page)).requests.r2.status, 'declined');
  // accetto l'offerta: l'assegnato risponde
  await page.locator('[data-testid=req-accept-r3]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=req-accept-r3]'));
  st = await store(page);
  assert.equal(st.requests.r3.status, 'accepted'); assert.equal(st.weeks[SUN].agreed.bathroom, 'bruno');
  assert.ok(Object.values(st.log).some((l) => l.type === 'agreed' && l.p.who === 'bruno'));
  // annullo una mia richiesta (cover) e una mia offerta
  await page.locator('[data-testid=req-cancel-r4]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=req-r4]'));
  assert.ok(!(await store(page)).requests.r4, 'r4 cancellata');
  await page.locator('[data-testid=req-cancel-r5]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=req-r5]'));
  // l'admin annulla la richiesta di un altro
  await page.locator('[data-testid=req-cancel-r8]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=req-r8]'));
  st = await store(page);
  assert.ok(!st.requests.r5 && !st.requests.r8);
  assert.match(await body(page), /Storico/);
  assert.equal(await page.locator('[data-testid=req-history] .li').count(), 6, 'storico: r1 r2 r3 r7 r9 r10');
  await shot(page, 'requests-after');
  await done(page);
  // non admin (Carla): vede la sostituzione aperta e quella indirizzata a lei, non può annullare le altrui
  const p2 = await open({ seed: reqSeed({ me: 'carla', admin: false }) });
  await goto(p2, '/more');
  assert.equal(await p2.locator('a.li[href="#/requests"] .chip').innerText(), '4', 'carla: r1 e r4 (a tutti), r8 (a lei), r5 (offerta di Anna a lei)');
  await goto(p2, '/requests');
  t = await body(p2);
  assert.doesNotMatch(t, /Altre richieste in attesa/);
  assert.equal(await p2.locator('[data-testid=req-cancel-r1]').count(), 0);
  assert.equal(await p2.locator('[data-testid=req-cancel-r2]').count(), 1, 'r2 è sua (from carla)');
  await p2.locator('[data-testid=req-decline-r8]').click();
  await p2.waitForFunction(() => !document.querySelector('[data-testid=req-decline-r8]'));
  assert.equal((await store(p2)).requests.r8.status, 'declined');
  await done(p2);
  // EN desktop dark
  const p3 = await open({ seed: reqSeed({ houseExtra: { lang: 'en' } }), lang: 'en-US', viewport: D, dark: true });
  await goto(p3, '/requests'); await noRawKeys(p3, 'requests en');
  assert.match(await body(p3), /Bruno is looking for someone to cover kitchen/);
  await shot(p3, 'requests-en-desktop-dark'); await done(p3);
});

// ---------------------------------------------------------------- checklist ricorrenti
const TASKS = [
  { id: 'f1', chore: 'floor', text: 'Aspira tutta la casa', every: 1, anchor: '2026-10-04', enabled: true },
  { id: 'f2', chore: 'floor', text: 'Lava i pavimenti', every: 1, anchor: '2026-10-04', enabled: true },
  { id: 'f3', chore: 'floor', text: 'Svuota il contenitore dell\'aspirapolvere', every: 2, anchor: '2026-10-04', enabled: true },
  { id: 'f4', chore: 'floor', text: 'Pulisci il filtro dell\'aspirapolvere', every: 2, anchor: '2026-10-04', enabled: true },
  { id: 'f5', chore: 'floor', text: 'Lava i battiscopa', every: 8, anchor: '2026-12-27', enabled: true },
  { id: 'b1', chore: 'bathroom', text: 'Pulisci il WC', every: 1, anchor: '2026-10-04', enabled: true },
  { id: 'b2', chore: 'bathroom', text: 'Pulisci le fughe della doccia', every: 4, anchor: '2026-10-04', enabled: true },
];
await scenario('tasks: checklist per mansione, raggruppo per frequenza, anteprima somma, interruttori, suggerimenti', async () => {
  const page = await open({ seed: S({ houseExtra: { tasks: TASKS } }) });
  await goto(page, '/tasks');
  const prev = (c) => page.locator(`[data-testid=prev-${c}]`).innerText();
  assert.equal((await prev('floor')).trim(), 'Questa settimana per Pavimenti: 4 voci (2 settimanali + 2 ogni 2 sett.)');
  assert.match(await prev('bathroom'), /Questa settimana per Bagno: 2 voci \(1 settimanale \+ 1 ogni 4 sett\.\)/);
  assert.equal(await page.locator('[data-testid=prev-kitchen]').count(), 0, 'cucina senza voci: nessuna anteprima');
  const t = await body(page);
  assert.match(t, /Ogni settimana/); assert.match(t, /Ogni 2 settimane/); assert.match(t, /Ogni 8 settimane/); assert.match(t, /Prossima:/);
  await shot(page, 'tasks-it-mobile');
  // interruttore singolo: spengo una voce ogni 2 settimane
  await page.locator('.mx-task', { hasText: 'Pulisci il filtro' }).locator('.switch').click();
  await page.waitForFunction(() => /3 voci \(2 settimanali \+ 1 ogni 2 sett\.\)/.test(document.body.innerText));
  assert.equal((await store(page)).house.tasks.find((x) => x.id === 'f4').enabled, false);
  // interruttore della mansione: spenta -> le voci spariscono e non bloccano "fatto"
  assert.equal((await page.evaluate(() => window.__app.actions.pendingChecklist('2026-11-01', 'bathroom'))).length, 2);
  await page.locator('[data-testid=chore-bathroom] .switch').click();
  await page.waitForFunction(() => /Spenta: queste voci non compaiono/.test(document.body.innerText));
  assert.equal((await store(page)).house.checklistOff.bathroom, true);
  assert.equal((await page.evaluate(() => window.__app.actions.pendingChecklist('2026-11-01', 'bathroom'))).length, 0, 'spenta: nessuna voce blocca "fatto"');
  const r = await page.evaluate(() => window.__app.actions.completeChore('2026-11-01', 'bathroom'));
  assert.equal(r.ok, true);
  await page.evaluate(() => window.__app.actions.undoResult('2026-11-01', 'bathroom'));
  await page.locator('[data-testid=chore-bathroom] .switch').click();
  await page.waitForFunction(() => !/Spenta: queste voci non compaiono/.test(document.body.innerText));
  assert.equal((await store(page)).house.checklistOff && (await store(page)).house.checklistOff.bathroom, undefined);
  // suggerimenti: tutti quelli della cucina (sfalsati nel tempo)
  await page.locator('[data-testid=addall-kitchen]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-task]').length === 7 + 6);
  const st = await store(page);
  const kit = st.house.tasks.filter((x) => x.chore === 'kitchen');
  assert.equal(kit.length, 6);
  for (const s of ['Pulisci piano cucina e fornelli', 'Pulisci il lavello', 'Svuota e lava il cestino']) assert.ok(kit.some((x) => x.text === s && x.every === 1), s);
  assert.equal((await prev('kitchen')).trim(), 'Questa settimana per Cucina: 4 voci (3 settimanali + 1 ogni 4 sett.)');
  assert.equal(await page.locator('[data-testid=addall-kitchen]').count(), 0, 'niente più da aggiungere per la cucina');
  // suggerimento singolo -> sheet precompilato, ogni 1 settimana
  await page.getByRole('button', { name: /Pulisci doccia\/vasca/ }).click();
  assert.equal(await page.inputValue('#mx-task-text'), 'Pulisci doccia/vasca');
  await page.locator('.sheet').getByRole('button', { name: /^Annulla/ }).click(); await wait(page, 500);
  // modifica: il campo testo resta stabile con aggiornamenti remoti
  await page.getByRole('button', { name: /Modifica: Lava i pavimenti/ }).click();
  await page.waitForSelector('#mx-task-text'); await wait(page, 450);
  await page.click('#mx-task-text'); await page.fill('#mx-task-text', '');
  await page.evaluate(() => { window.__tin = document.getElementById('mx-task-text'); });
  await Promise.all([page.keyboard.type('Lava bene i pavimenti', { delay: 60 }),
    page.evaluate(async () => { const s = window.__app.store; for (let i = 0; i < 8; i++) { s.setDoc('weeks', '2026-11-01', { note: 'x' + i }); s.setDoc('needs', 'q' + i, { text: 'q' + i, by: 'bruno', at: new Date().toISOString(), done: false }); await new Promise((r) => setTimeout(r, 120)); } })]);
  assert.equal(await page.inputValue('#mx-task-text'), 'Lava bene i pavimenti');
  assert.equal(await page.evaluate(() => document.getElementById('mx-task-text') === window.__tin && document.activeElement === window.__tin), true);
  await page.locator('.sheet').getByRole('button', { name: /^Salva/ }).click();
  await page.waitForFunction(() => /Lava bene i pavimenti/.test(document.body.innerText));
  assert.equal((await store(page)).house.tasks.find((x) => x.id === 'f2').text, 'Lava bene i pavimenti');
  await noOverflow(page, 'tasks'); await noRawKeys(page, 'tasks');
  await done(page);
  // non admin: sola lettura
  const p2 = await open({ seed: S({ admin: false, houseExtra: { tasks: TASKS, checklistOff: { bathroom: true } } }) });
  await goto(p2, '/tasks');
  assert.equal(await p2.locator('.switch').count(), 0);
  assert.equal(await p2.getByRole('button', { name: /Nuovo compito/ }).count(), 0);
  assert.equal(await p2.locator('[data-testid^=addall-]').count(), 0);
  assert.match(await body(p2), /Solo l'admin può modificare/); assert.match(await body(p2), /Checklist spenta/);
  await shot(p2, 'tasks-readonly'); await done(p2);
  const p3 = await open({ seed: S({ houseExtra: { lang: 'en', tasks: TASKS } }), lang: 'en-US', viewport: D, dark: true });
  await goto(p3, '/tasks'); await noRawKeys(p3, 'tasks en');
  assert.equal((await p3.locator('[data-testid=prev-floor]').innerText()).trim(), 'This week for Floor: 4 items (2 weekly + 2 every 2 wks)');
  await shot(p3, 'tasks-en-desktop-dark'); await done(p3);
});

await scenario('lastout: editor con campi persistenti', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/lastout');
  await page.getByRole('button', { name: /Modifica elenco/ }).click();
  await page.waitForSelector('.sheet .mx-edrow'); await wait(page, 450);
  await page.evaluate(() => { window.__first = document.querySelector('.sheet .mx-edrow input'); window.__second = document.querySelectorAll('.sheet .mx-edrow input')[1]; });
  await page.locator('.sheet .mx-edrow').nth(1).locator('input').fill('Chiudere il gas');
  await page.locator('.sheet .mx-edrow').nth(3).getByRole('button', { name: /Elimina/ }).click();
  await page.locator('.sheet .mx-edrow').nth(1).getByRole('button', { name: /Sposta giù/ }).click();
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sheet .mx-edrow input')[2] === window.__second && window.__second.value === 'Chiudere il gas'), true, 'il nodo e il testo sopravvivono allo spostamento');
  assert.equal(await page.evaluate(() => document.querySelector('.sheet .mx-edrow input') === window.__first), true);
  await done(page);
});

// ---------------------------------------------------------------- registro attività
await scenario('activity: nuovi tipi di log (incomplete, volunteer, delay, agreed, trip, reset)', async () => {
  const log = {
    l1: { at: '2026-10-28T09:30:00', by: 'anna', type: 'incomplete', p: { week: SUN, chore: 'floor', n: 2 } },
    l2: { at: '2026-10-28T09:00:00', by: 'bruno', type: 'volunteer', p: { week: SUN, chore: 'kitchen', who: 'carla' } },
    l3: { at: '2026-10-27T20:00:00', by: 'carla', type: 'delay', p: { week: SUN, chore: 'bathroom', day: '2026-11-03' } },
    l4: { at: '2026-10-27T19:00:00', by: 'admin', type: 'agreed', p: { week: SUN, chore: 'floor', who: 'bruno' } },
    l5: { at: '2026-10-26T19:00:00', by: 'anna', type: 'trip', p: { who: 'carla' } },
    l6: { at: '2026-10-25T19:00:00', by: 'bruno', type: 'reset', p: { week: SUN, chore: 'kitchen', who: null } },
    l7: { at: '2026-10-24T19:00:00', by: 'anna', type: 'incomplete', p: { week: SUN, chore: 'bathroom', n: 1 } },
    l8: { at: '2026-10-23T19:00:00', by: 'carla', type: 'agreed', p: { week: SUN, chore: 'kitchen', who: 'carla', terms: 'repay' } },
    l9: { at: '2026-10-22T19:00:00', by: 'carla', type: 'agreed', p: { week: SUN, chore: 'floor', who: 'anna', terms: 'gift' } },
  };
  const s = S(); s['cp:h:' + HID].log = log;
  const page = await open({ seed: s });
  await goto(page, '/activity');
  const t = await body(page);
  assert.match(t, /Anna ha segnato pavimenti come fatto, ma mancavano 2 voci della checklist/);
  assert.match(t, /Bruno ha pulito cucina al posto di Carla, di sua iniziativa/);
  assert.match(t, /Carla pulirà bagno in ritardo, martedì 3 nov/);
  assert.match(t, /Concordato: Bruno farà pavimenti/);
  assert.match(t, /Concordato con recupero: Carla farà cucina, il turno si recupera la settimana prossima/); assert.match(t, /Regalo: Anna farà pavimenti al posto dell'assegnato, nessun recupero/);
  assert.match(t, /Anna ha aggiunto un'assenza per Carla/); assert.match(t, /Bruno ha rimesso cucina da fare/);
  assert.match(t, /ma mancava 1 voce della checklist/);
  assert.deepEqual((await page.locator('.eyebrow').allInnerTexts()).slice(0, 2), ['Oggi', 'Ieri']);
  await noOverflow(page, 'activity'); await noRawKeys(page, 'activity'); await shot(page, 'activity-it');
  await done(page);
  const s2 = S({ houseExtra: { lang: 'en' } }); s2['cp:h:' + HID].log = log;
  const p2 = await open({ seed: s2, lang: 'en-US', dark: true, viewport: D });
  await goto(p2, '/activity'); await noRawKeys(p2, 'activity en');
  assert.match(await body(p2), /Bruno cleaned kitchen in place of Carla, on their own initiative/);
  assert.match(await body(p2), /Anna marked floor as done, but 2 checklist items were missing/);
  await shot(p2, 'activity-en-desktop-dark'); await done(p2);
});

// ---------------------------------------------------------------- registro ingressi (Impostazioni > Accessi)
await scenario('access: registro ingressi con persona, dispositivo, orario e schermata, per giorno, ultimi 100', async () => {
  const members = {
    devA: { personId: 'anna', name: 'iPhone di Anna', device: { os: 'iPhone', browser: 'Safari', kind: 'device', label: 'iPhone · Safari' }, lastSeen: '2026-10-28T08:00:00.000Z', firstSeen: '2026-10-01T08:00:00.000Z' },
    devB: { personId: 'bruno', name: 'Portatile', device: { os: 'Windows', browser: 'Chrome', kind: 'desktop', label: 'Windows · Chrome' }, lastSeen: '2026-10-27T08:00:00.000Z', firstSeen: '2026-10-02T08:00:00.000Z' },
  };
  const views = {}; const screens = ['open', 'home', 'calendar', 'stats', 'more', 'trips'];
  for (let i = 0; i < 120; i++) {
    const day = 28 - Math.floor(i / 12); const hh = String(8 + (i % 12)).padStart(2, '0');
    views['v' + String(i).padStart(3, '0')] = { at: `2026-10-${String(day).padStart(2, '0')}T${hh}:${String(i % 60).padStart(2, '0')}:00.000Z`, device: i % 3 ? 'devA' : 'devB', personId: i % 3 ? 'anna' : 'bruno', screen: screens[i % screens.length] };
  }
  views.orphan = { at: '2026-10-28T20:30:00.000Z', device: 'gone', personId: null, screen: 'open' };
  const s = S({ members }); s['cp:h:' + HID].views = views;
  const page = await open({ seed: s });
  await goto(page, '/settings/access');
  await page.waitForSelector('[data-testid=views] .mxa-row');
  assert.equal(await page.locator('[data-testid=views] .mxa-row').count(), 100, 'ultimi 100');
  assert.ok(await page.locator('[data-testid=views] .mxa-day').count() >= 8, 'raggruppati per giorno');
  const eb = await page.locator('[data-testid=views] .mxa-day .eyebrow').first().innerText();
  assert.match(eb, /Oggi/); assert.match(eb, /\d+ ingress/);
  const first = await page.locator('[data-testid=views] .mxa-row').first().innerText();
  assert.match(first, /Persona|Anna|Bruno/); assert.match(first, /\d\d:\d\d/);
  assert.match(await page.locator('[data-testid=views]').innerText(), /Apertura app/);
  assert.match(await page.locator('[data-testid=views]').innerText(), /iPhone di Anna · iPhone · Safari/);
  assert.match(await page.locator('[data-testid=views]').innerText(), /Dispositivo sconosciuto/);
  await page.locator('[data-testid=views] .mxa-day').first().screenshot({ path: SHOT + 'access-it-mobile-day1.png' });
  await page.locator('[data-testid=views] .mxa-day').nth(1).screenshot({ path: SHOT + 'access-it-mobile-day2.png' });
  await noOverflow(page, 'access'); await noRawKeys(page, 'access');
  await done(page);
  const s2 = S({ members, houseExtra: { lang: 'en' } }); s2['cp:h:' + HID].views = views;
  const p2 = await open({ seed: s2, lang: 'en-US', dark: true, viewport: D });
  await goto(p2, '/settings/access'); await p2.waitForSelector('[data-testid=views] .mxa-row');
  assert.match(await p2.locator('[data-testid=views]').innerText(), /App opened/); assert.match(await p2.locator('[data-testid=views]').innerText(), /Unknown device/);
  await noRawKeys(p2, 'access en'); await p2.locator('[data-testid=views] .mxa-day').first().screenshot({ path: SHOT + 'access-en-desktop-dark.png' }); await p2.screenshot({ path: SHOT + 'access-en-desktop-dark-top.png' }); await done(p2);
  // l'app registra da sola l'ingresso ("Apertura app") della persona corrente
  const p3 = await open({ seed: S() });
  await goto(p3, '/settings/access'); await p3.waitForSelector('[data-testid=views] .mxa-row');
  assert.match(await p3.locator('[data-testid=views]').innerText(), /Anna[\s\S]*Apertura app/); await done(p3);
});

await env.close();
if (failed) { console.error(`${failed} scenari falliti`); process.exit(1); }
console.log('tutti gli scenari OK');
