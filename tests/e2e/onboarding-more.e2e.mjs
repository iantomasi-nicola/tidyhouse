// E2E (Playwright) di onboarding + "Altro". Esegui con:  node tests/e2e/onboarding-more.e2e.mjs
// Screenshot in SHOT_DIR (variabile d'ambiente, di default la scratchpad). Nessun errore in console ammesso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';
import { hashPin } from '../../js/actions.js';

const SHOT = (process.env.SHOT_DIR || path.join(os.tmpdir(), 'tidyhouse-onboarding')).replace(/\/?$/, '/');
// foglio Excel reale (non nel repo): se manca lo scenario di import viene saltato, come in settings.e2e.mjs
const XLSX = process.env.XLSX_FILE || '/root/.claude/uploads/31bb54fa-07b7-55b0-a8eb-c0a272017a85/1f8df62c-House_Cleaning_Plan_Magliocco.xlsx';
const NOW = '2026-10-28T10:00:00';
const M = { width: 390, height: 844 };
const D = { width: 1440, height: 900 };
const HID = 'LOCALTEST001';
const CODE_A = 'ABCD2345EFGH';   // «Casa Rossi» nel cloud finto
fs.mkdirSync(SHOT, { recursive: true });

const salt = 'SALT1234ABCD';
const ADMIN = { adminSalt: salt, adminHash: await hashPin('1234', salt) };
const NORULES = { requireRules: false };

const env = await start();
let failed = 0; const only = process.argv[2];

// Cloud finto in memoria: sostituisce vendor/firebase.js con un mini Firestore (nessuna rete, nessuna scrittura reale).
// `fake` = { CODICE: documentoCasa } -> abilita il cloud con quelle case; lo stato e' leggibile in window.__fakeDb.
function fakeFirebase(docs) {
  return `
const DB = ${JSON.stringify(docs)};
window.__fakeDb = DB;
const clone = (x) => JSON.parse(JSON.stringify(x));
const DEL = { __del: true };
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) { if (v && v.__del) delete o[k]; else if (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) o[k] = merge(o[k], v); else o[k] = v; } return o; };
export const initializeApp = () => ({});
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const connectFirestoreEmulator = () => {};
export const deleteField = () => DEL;
export const doc = (_db, ...p) => ({ path: p.join('/') });
export const collection = (_db, ...p) => ({ path: p.join('/'), coll: true });
export const query = (c) => c; export const orderBy = () => ({}); export const limit = () => ({});
const snap = (path) => ({ id: path.split('/').pop(), exists: () => path in DB, data: () => clone(DB[path]), metadata: { hasPendingWrites: false, fromCache: false } });
const list = (c) => { const pre = c.path + '/'; const ds = Object.keys(DB).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(snap); return { forEach: (f) => ds.forEach(f), docs: ds, size: ds.length }; };
export const getDoc = async (r) => snap(r.path);
export const getDocs = async (c) => list(c);
export const deleteDoc = async (r) => { delete DB[r.path]; };
export const onSnapshot = (ref, a, b) => { const cb = typeof a === 'function' ? a : b; Promise.resolve().then(() => cb(ref.coll ? list(ref) : snap(ref.path))); return () => {}; };
export const writeBatch = () => { const ops = []; return { set: (r, d, o) => ops.push(['s', r.path, d, o]), delete: (r) => ops.push(['d', r.path]), commit: async () => { for (const [t, p, d, o] of ops) { if (t === 'd') delete DB[p]; else DB[p] = o && o.merge ? merge(DB[p] || {}, clone(d)) : clone(d); } } }; };
`;
}
const rossi = (extra = {}) => {
  const base = seed({ houseExtra: { ...NORULES, ...extra } })['cp:h:' + HID].house;
  return { ...base, id: CODE_A, name: 'Casa Rossi' };
};

// Di default il cloud e' spento (config.js vuoto): niente rete. Con { cloud: true } resta la config reale (solo per vedere la UI, mai per scrivere).
async function open({ cloud = false, fake = null, ...opts } = {}) {
  const page = await env.page({ now: NOW, viewport: M, ...opts });
  if (fake) {
    const docs = Object.fromEntries(Object.entries(fake).map(([code, house]) => ['houses/' + code, house]));
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.CASA_CONFIG = { firebase: { apiKey: "fake", projectId: "fake" }, publicUrl: "" };' }));
    await page.route('**/vendor/firebase.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fakeFirebase(docs) }));
  } else if (!cloud) await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.CASA_CONFIG = { firebase: { apiKey: "", projectId: "" }, publicUrl: "" };' }));
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
const store = (page, id = HID) => page.evaluate((k) => JSON.parse(localStorage.getItem('cp:h:' + k) || 'null'), id);
const reg = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cp:houses') || '[]'));
async function noOverflow(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(w.sw <= w.iw + 1, `overflow orizzontale in ${label}: ${w.sw} > ${w.iw}`);
}
async function noRawKeys(page, label) {
  const txt = await body(page);
  const m = txt.match(/\b(onb|moreX|more|needs|rules|tasks|lastout|req|act|guide|join|setup|inv|data|misc|home|chore)\.[a-zA-Z][\w.]*/);
  assert.doesNotMatch(txt, /\b(null|undefined|NaN)\b/, 'valori grezzi in ' + label);
  assert.ok(!m, `chiave non tradotta in ${label}: ${m && m[0]}`);
}
async function passRules(page) {
  if (!(await page.locator('.onb-rules').count())) return;
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForSelector('[data-testid=rules-accept][data-ready="1"]');
  await page.click('[data-testid=rules-accept]');
  await page.waitForSelector('.nav', { timeout: 6000 });
}

async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.error('FAIL ', name, '\n', e && e.stack ? e.stack : e); }
}

// ---------------------------------------------------------------- onboarding
await scenario('landing: it, mobile+dark+desktop, cloud assente', async () => {
  const page = await open();
  await goto(page);
  assert.match(await body(page), /Tidy House/);
  assert.match(await body(page), /La sincronizzazione cloud non è configurata/);
  assert.equal(await page.locator('a[href*="tidyhouse#readme"]').first().getAttribute('href'), 'https://github.com/iantomasi-nicola/tidyhouse#readme');
  assert.ok(await page.getByRole('button', { name: /Crea una nuova casa/ }).isVisible());
  // formattazione del codice e pulsante
  const inp = page.locator('input.code').first();
  const go = page.locator('form.onb-code button[type=submit]');
  assert.ok(await go.isDisabled());
  await inp.fill('abcd');
  assert.equal(await inp.inputValue(), 'ABCD');
  await inp.fill('abcdefghjkmn');
  assert.equal(await inp.inputValue(), 'ABCD-EFGH-JKMN');
  assert.ok(await go.isEnabled());
  await inp.fill('https://x.github.io/app/#/join/abcdefghjkmn');
  assert.equal(await inp.inputValue(), 'ABCD-EFGH-JKMN');
  await go.click();
  await page.waitForSelector('.onb-err:not([hidden])');
  assert.match(await page.locator('.onb-err').first().innerText(), /cloud non è configurata/);
  await noOverflow(page, 'landing'); await noRawKeys(page, 'landing');
  await shot(page, 'landing-it-mobile');
  await done(page);
  const p2 = await open({ dark: true }); await goto(p2); await shot(p2, 'landing-it-dark'); await done(p2);
  const p3 = await open({ viewport: D }); await goto(p3); await shot(p3, 'landing-it-desktop'); await done(p3);
});

await scenario('landing: en + elenco case', async () => {
  const page = await open({ lang: 'en-US', seed: { 'cp:houses': [{ id: HID, name: 'Casa Test', mode: 'local', me: 'anna', lastUsed: 1 }, { id: 'ZZZZ00000001', name: 'Second', mode: 'local', me: null, lastUsed: 5 }] } });
  await goto(page, '/join/');
  const t = await body(page);
  assert.match(t, /Join a house/);
  await noRawKeys(page, 'join en');
  await page.evaluate(() => window.__boot.go('landing'));
  await page.waitForSelector('.onb-houses');
  const txt = await body(page);
  assert.match(txt, /Houses on this device/); assert.match(txt, /Create a new house/); assert.match(txt, /Second/);
  await noRawKeys(page, 'landing en');
  await shot(page, 'landing-en-houses');
  await done(page);
});

await scenario('join: messaggi di errore senza cloud', async () => {
  let page = await open();
  await goto(page, '/join/ABCDEFGHJKMN');
  await page.waitForSelector('.note.bad');
  assert.match(await body(page), /cloud non è configurata/);
  assert.ok(await page.getByRole('button', { name: /Prova in locale/ }).first().isVisible());
  await shot(page, 'join-nocloud');
  await done(page);
  page = await open();
  await goto(page, '/join/XYZ');
  await page.waitForSelector('.note.bad');
  assert.match(await body(page), /Codice non trovato/);
  assert.ok(await page.locator('input.code').isVisible());
  await done(page);
  page = await open();
  await goto(page, '/join/');
  await page.waitForSelector('input.code');
  assert.doesNotMatch(await body(page), /Codice non trovato/);
  await done(page);
});

// ---------------------------------------------------------------- join in un tocco (cloud finto in memoria: mai la rete vera)
const cloudSeed = (me, extra = {}) => ({ 'cp:houses': [{ id: CODE_A, name: 'Casa Rossi', mode: 'cloud', me, lastUsed: 9 }], 'cp:last': CODE_A, ...extra });

await scenario('join: un tocco sul proprio nome = dentro (nome casa in alto, nessun campo)', async () => {
  const page = await open({ fake: { [CODE_A]: rossi() } });
  let taps = 0;
  await goto(page, '/join/' + CODE_A);
  await page.waitForSelector('.who');
  assert.equal((await page.locator('.onb-housename').innerText()).trim(), 'Casa Rossi');
  assert.equal(await page.locator('.who').count(), 3);
  assert.equal(await page.locator('input:visible').count(), 0, 'nessun campo da compilare');
  const box = await page.locator('.who').first().boundingBox();
  assert.ok(box.height >= 64, 'pulsanti grandi: ' + box.height);
  await noOverflow(page, 'who join'); await noRawKeys(page, 'who join');
  await shot(page, 'join-who-mobile');
  await page.locator('.who', { hasText: 'Bruno' }).click(); taps++;
  await page.waitForSelector('.nav', { timeout: 6000 });
  const r = await reg(page);
  assert.equal(r.length, 1); assert.equal(r[0].id, CODE_A); assert.equal(r[0].me, 'bruno');
  assert.equal(await page.evaluate(() => location.hash), '#/');
  assert.equal(taps, 1, 'tocchi dal link alla Home (regole escluse)');
  const dev = await page.evaluate(() => Object.values(window.__fakeDb).filter((d) => d && d.personId === 'bruno').length);
  assert.ok(dev >= 1, 'il dispositivo e\' registrato sulla casa');
  await done(page);
  // scuro + inglese
  const p2 = await open({ fake: { [CODE_A]: rossi({ lang: 'en' }) }, dark: true, lang: 'en-US' });
  await goto(p2, '/join/' + CODE_A); await p2.waitForSelector('.who');
  assert.match(await body(p2), /Tap your name to get in/); await noRawKeys(p2, 'who join en');
  await shot(p2, 'join-who-dark-en'); await done(p2);
});

await scenario('join: con regole obbligatorie dopo il tocco restano le regole', async () => {
  const page = await open({ fake: { [CODE_A]: rossi({ requireRules: true }) } });
  await goto(page, '/join/' + CODE_A);
  await page.waitForSelector('.who');
  await page.locator('.who', { hasText: 'Carla' }).click();
  await page.waitForSelector('.onb-rules', { timeout: 6000 });
  await passRules(page);
  assert.equal((await reg(page))[0].me, 'carla');
  await done(page);
});

await scenario('join: stessa casa gia\' salvata -> entra senza chiedere nulla', async () => {
  const page = await open({ fake: { [CODE_A]: rossi() }, seed: cloudSeed('carla') });
  await goto(page, '/join/' + CODE_A);
  await page.waitForSelector('.nav', { timeout: 6000 });
  assert.equal(await page.locator('.gate .who, .onb-ask, input.code').count(), 0);
  assert.equal((await reg(page))[0].me, 'carla', 'identita\' conservata');
  assert.equal(await page.evaluate(() => location.hash), '#/');
  assert.match(await body(page), /Casa Rossi/);
  await done(page);
  // link aperto mentre la casa e' gia' caricata (app aperta)
  const p2 = await open({ fake: { [CODE_A]: rossi() }, seed: cloudSeed('anna') });
  await goto(p2, '/'); await p2.waitForSelector('.nav');
  await p2.evaluate((c) => { location.hash = '#/join/' + c; }, CODE_A);
  await p2.waitForFunction(() => location.hash === '#/');
  assert.equal(await p2.locator('.gate .who, .onb-ask').count(), 0);
  assert.ok(await p2.locator('.nav').isVisible());
  await done(p2);
});

await scenario('join: link di una casa diversa -> una riga di domanda', async () => {
  const s = () => ({ ...seed({ me: 'anna', houseExtra: NORULES }) });
  const page = await open({ fake: { [CODE_A]: rossi() }, seed: s() });
  await goto(page, '/join/' + CODE_A);
  await page.waitForSelector('.onb-ask');
  assert.match(await page.locator('.onb-askq').innerText(), /Hai già «Casa Test» su questo dispositivo\. Aggiungere anche questa casa\?/);
  assert.equal(await page.locator('.nav, .gate .who').count(), 0, 'non entra da solo');
  assert.equal((await reg(page)).length, 1, 'niente aggiunto prima della risposta');
  await noOverflow(page, 'join ask'); await noRawKeys(page, 'join ask');
  await shot(page, 'join-ask-mobile');
  // «No»: resta nella casa salvata
  await page.locator('#onb-join-no').click();
  await page.waitForSelector('.nav', { timeout: 6000 });
  await page.waitForFunction(() => /Casa Test/.test(document.body.innerText));
  assert.equal((await reg(page)).length, 1);
  assert.equal(await page.evaluate(() => location.hash), '#/');
  await done(page);
  // «Si»: aggiunge e chiede chi sei (2 tocchi in tutto)
  const p2 = await open({ fake: { [CODE_A]: rossi() }, seed: s(), dark: true });
  await goto(p2, '/join/' + CODE_A);
  await p2.waitForSelector('.onb-ask');
  await shot(p2, 'join-ask-dark');
  let taps = 0;
  await p2.locator('#onb-join-yes').click(); taps++;
  await p2.waitForSelector('.who', { timeout: 6000 });
  await p2.locator('.who', { hasText: 'Carla' }).click(); taps++;
  await p2.waitForSelector('.nav', { timeout: 6000 });
  assert.equal(taps, 2);
  const r = await reg(p2);
  assert.equal(r.length, 2); assert.equal(r.find((x) => x.id === CODE_A).me, 'carla');
  await done(p2);
  // inglese
  const p3 = await open({ fake: { [CODE_A]: rossi() }, seed: s(), lang: 'en-US' });
  await goto(p3, '/join/' + CODE_A); await p3.waitForSelector('.onb-ask');
  assert.match(await body(p3), /You already have “Casa Test” on this device\. Add this house too\?/);
  await noRawKeys(p3, 'join ask en'); await done(p3);
});

// ---------------------------------------------------------------- crea casa (3 passi)
const openWizard = async (page) => {
  await page.getByRole('button', { name: /Crea una nuova casa|Create a new house/ }).click();
  await page.waitForSelector('#onb-name');
  await page.waitForFunction(() => { const i = document.getElementById('onb-name'); return document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length; });
};
// il cursore va da solo nel campo principale del passo (la tastiera del telefono si apre subito)
const waitFocus = (page, sel) => page.waitForFunction((q) => document.activeElement && document.activeElement.matches(q), sel);
const NEXT = /^(Avanti|Next)/;
// il filtro anti doppio tocco dell'app ignora un secondo click sullo stesso punto entro 350 ms: un utente vero non lo raggiunge
const tapNext = async (page) => { await page.waitForTimeout(400); await page.getByRole('button', { name: NEXT }).click(); };
const tapNextFocus = async (page, sel) => { await tapNext(page); await waitFocus(page, sel); };

await scenario('create: default sensati + wizard locale completo -> Home', async () => {
  const page = await open();
  await goto(page);
  await openWizard(page);
  // nome proposto e selezionato: scrivere sovrascrive
  const sel = await page.evaluate(() => { const i = document.getElementById('onb-name'); return { v: i.value, s: i.selectionStart, e: i.selectionEnd, f: document.activeElement === i }; });
  assert.equal(sel.v, 'La nostra casa'); assert.equal(sel.s, 0); assert.equal(sel.e, sel.v.length); assert.ok(sel.f, 'campo nome gia\' attivo');
  assert.match(await body(page), /Passo 1 di 3/);
  // domenica della settimana corrente gia' impostata, nascosta sotto «Altre opzioni»
  assert.ok(await page.locator('#onb-start').isHidden());
  await page.getByText('Altre opzioni').click();
  assert.equal(await page.inputValue('#onb-start'), '2026-11-01');   // 28/10/2026 e' mercoledi'
  await page.fill('#onb-start', '2026-10-28');
  assert.equal(await page.inputValue('#onb-start'), '2026-11-01');
  assert.ok(await page.locator('.onb-adjusted').isVisible());
  assert.ok(await page.locator('.onb-choice[data-v=cloud] input').isDisabled());   // cloud non configurato -> solo locale
  assert.ok(await page.locator('.onb-choice[data-v=local] input').isChecked());
  await shot(page, 'create-1-options');
  // il foglio Excel resta disponibile, come opzione secondaria
  assert.ok(await page.locator('label[for=onb-xlsx]').isVisible());
  // validazione nome
  await page.fill('#onb-name', '');
  await tapNext(page);
  assert.match(await page.locator('.onb-err').innerText(), /nome alla casa/);
  await page.locator('#onb-name').click();
  await page.keyboard.type('Casa Rossi');
  await tapNextFocus(page, ".onb-prow input");
  // passo 2: cursore gia' sul primo campo, tastiera con tasto «avanti»
  await page.waitForSelector('.onb-person');
  assert.equal(await page.locator('.onb-person').count(), 3);
  assert.equal(await page.locator('.onb-person input[type=text]').first().getAttribute('enterkeyhint'), 'next');
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('.onb-person input[type=text]')), 'focus sul primo nome');
  assert.match(await body(page), /Passo 2 di 3/);
  // nessun nome: errore
  await tapNext(page);
  assert.match(await page.locator('.onb-err').innerText(), /almeno 1 persona/);
  const names = page.locator('.onb-person input[type=text]');
  await names.nth(0).fill('Anna'); await names.nth(1).fill('anna');
  await tapNext(page);
  assert.match(await page.locator('.onb-err').innerText(), /stesso nome/);
  await names.nth(1).fill('Bruno');
  // aggiunta rapida: Invio nell'ultima riga compilata aggiunge una riga e ci porta il cursore (max 4)
  await names.nth(2).fill('Carla');
  await names.nth(2).press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.onb-person').length === 4);
  assert.ok(await page.getByRole('button', { name: /Aggiungi persona/ }).isDisabled());
  assert.ok(await page.waitForFunction(() => document.activeElement === document.querySelectorAll('.onb-person input[type=text]')[3]));
  await page.locator('.onb-person').nth(3).getByRole('button', { name: /Rimuovi/ }).click();
  assert.equal(await page.locator('.onb-person').count(), 3);
  // date avanzate (facoltative)
  await page.locator('.onb-person').nth(2).locator('button[aria-expanded]').click();
  assert.ok(await page.locator('.onb-adv').nth(2).isVisible());
  assert.match(await page.locator('.onb-adv').nth(2).innerText(), /Uscita non nota: potrai segnarla più avanti/);
  await page.locator('.onb-adv').nth(2).locator('input[type=date]').nth(2).fill('2027-02-28');
  await noOverflow(page, 'create step 2');
  await shot(page, 'create-2');
  await tapNextFocus(page, "#onb-pin");
  // passo 3: solo il PIN, tastiera numerica
  await page.waitForSelector('#onb-pin');
  assert.match(await body(page), /Passo 3 di 3/);
  assert.equal(await page.getAttribute('#onb-pin', 'inputmode'), 'numeric');
  assert.ok(await page.evaluate(() => document.activeElement === document.getElementById('onb-pin')), 'focus sul PIN');
  assert.equal(await page.locator('#onb-pin2').count(), 0, 'nessuna conferma del PIN');
  assert.match(await page.locator('.onb-adminline').innerText(), /Admin:\s*Anna/);   // il primo (tu) e' gia' admin
  await page.getByRole('button', { name: /^Crea casa/ }).click();
  assert.match(await page.locator('.onb-err').innerText(), /PIN troppo corto/);
  await page.getByRole('button', { name: /^Cambia/ }).click();
  assert.equal(await page.locator('.onb-admin').count(), 3);
  await page.locator('.onb-admin').nth(1).click();
  assert.match(await page.locator('.onb-adminline').innerText(), /Admin:\s*Bruno/);
  await page.fill('#onb-pin', '1234');
  await noOverflow(page, 'create step 3');
  await shot(page, 'create-3');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Crea casa/ }).click();
  await page.waitForSelector('.onb-done');
  assert.match(await body(page), /Casa creata!/);
  assert.match(await body(page), /Casa Rossi/);
  await page.waitForTimeout(700);
  await shot(page, 'create-done-local');
  const r = await reg(page);
  assert.equal(r.length, 1); assert.equal(r[0].mode, 'local'); assert.equal(r[0].name, 'Casa Rossi');
  const st = await store(page, r[0].id);
  assert.equal(st.house.startSunday, '2026-11-01');
  assert.deepEqual(st.house.roommates.map((x) => x.name), ['Anna', 'Bruno', 'Carla']);
  assert.deepEqual(st.house.adminIds, [st.house.roommates[1].id]);
  assert.equal(st.house.tz, await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), 'fuso orario del dispositivo');
  assert.ok(!st.house.roommates[2].to);   // nota: buildHouse (nucleo) scarta expectedTo
  assert.equal(r[0].me, st.house.roommates[1].id);
  await page.locator('#onb-go').click();
  await page.waitForSelector('.nav, .onb-rules', { timeout: 6000 });
  await passRules(page);
  await page.waitForSelector('.nav');
  assert.ok(!(await page.locator('.onb-done').count()));
  assert.match(await body(page), /Casa Rossi/);
  await done(page);
});

await scenario('create: solo con la tastiera (default + Invio) -> Home', async () => {
  const page = await open();
  await goto(page);
  await openWizard(page);
  await page.keyboard.press('Enter');                     // nome proposto «La nostra casa»
  await page.waitForSelector('.onb-person'); await waitFocus(page, '.onb-prow input');
  await page.keyboard.type('Io'); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');                     // riga 2 vuota -> riga 3
  await page.keyboard.press('Enter');                     // riga 3 vuota, ultima -> avanti
  await waitFocus(page, '#onb-pin');
  await page.keyboard.type('2468'); await page.keyboard.press('Enter');
  await page.waitForSelector('.onb-done');
  const r = await reg(page); const st = await store(page, r[0].id);
  assert.equal(r[0].name, 'La nostra casa');
  assert.deepEqual(st.house.roommates.map((x) => x.name), ['Io']);
  assert.deepEqual(st.house.adminIds, [st.house.roommates[0].id]);
  await done(page);
});

await scenario('create: cloud (finto) -> QR e link per invitare', async () => {
  const page = await open({ fake: {} });
  await goto(page);
  await openWizard(page);
  await page.getByText('Altre opzioni').click();
  assert.ok(await page.locator('.onb-choice[data-v=cloud] input').isChecked(), 'cloud predefinito se disponibile');
  await page.locator('#onb-name').click(); await page.keyboard.press('Control+A'); await page.keyboard.type('Casa Nuvola');
  await tapNextFocus(page, ".onb-prow input");
  await page.keyboard.type('Ada'); await page.keyboard.press('Enter'); await page.keyboard.type('Bea');
  await tapNextFocus(page, "#onb-pin");
  await page.waitForSelector('#onb-pin');
  await page.keyboard.type('1357'); await page.keyboard.press('Enter');
  await page.waitForSelector('.onb-done');
  await page.waitForSelector('[data-testid=invite-qr] svg');
  assert.match(await body(page), /Fai inquadrare il QR/);
  const link = await page.locator('.onb-linkbox').innerText();
  assert.match(link, /#\/join\/[0-9A-Z]{12}$/);
  assert.match(await page.locator('[data-testid=house-code]').innerText(), /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const bw = await page.locator('.onb-done .qr').boundingBox();
  assert.ok(bw.width <= 220);
  await noOverflow(page, 'created cloud'); await noRawKeys(page, 'created cloud');
  await shot(page, 'create-done-cloud');
  assert.equal((await reg(page))[0].mode, 'cloud');
  const keys = await page.evaluate(() => Object.keys(window.__fakeDb).filter((k) => /^houses\/[^/]+$/.test(k)));
  assert.equal(keys.length, 1);
  await done(page);
  const p2 = await open({ fake: {}, dark: true });
  await goto(p2); await openWizard(p2);
  await p2.keyboard.press('Enter'); await waitFocus(p2, '.onb-prow input'); await p2.keyboard.type('Ada'); await tapNextFocus(p2, "#onb-pin");
  await p2.keyboard.type('1357'); await p2.keyboard.press('Enter');
  await p2.waitForSelector('[data-testid=invite-qr] svg'); await shot(p2, 'create-done-cloud-dark');
  await done(p2);
});

await scenario('create: import del foglio Excel reale (salta se il file manca)', async () => {
  if (!fs.existsSync(XLSX)) { console.log('     (file Excel non trovato: ' + XLSX + ' - imposta XLSX_FILE; scenario saltato)'); return; }
  const page = await open();
  await goto(page);
  await openWizard(page);
  await page.fill('#onb-name', 'Casa Magliocco');
  await page.setInputFiles('#onb-xlsx', XLSX);
  await page.waitForSelector('.onb-dl', { timeout: 15000 });
  const prev = await page.locator('.onb-import').innerText();
  for (const n of ['Antonio', 'Duygu', 'Nicola']) assert.match(prev, new RegExp(n));
  assert.match(prev, /4 ott 2026|4 ott/);
  assert.match(prev, /Fabio/);
  assert.match(prev, /ignorat/);
  assert.match(prev, /settimane con dati/);
  await shot(page, 'create-import-preview');
  await tapNext(page);
  // il passo 2 e' bloccato con i nomi del foglio
  assert.match(await body(page), /Antonio/); assert.equal(await page.locator('.onb-person').count(), 0);
  await shot(page, 'create-import-step2');
  await tapNext(page);
  await page.fill('#onb-pin', 'abcd');
  await page.getByRole('button', { name: /^Cambia/ }).click();
  assert.equal(await page.locator('.onb-admin').count(), 3);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Crea casa/ }).click();
  await page.waitForSelector('.onb-done');
  const r = await reg(page); const st = await store(page, r[0].id);
  assert.equal(st.house.startSunday, '2026-10-04');
  assert.deepEqual(st.house.roommates.map((x) => x.name).sort(), ['Antonio', 'Duygu', 'Nicola']);
  assert.ok(Object.keys(st.weeks).length >= 1, 'settimane importate');
  await page.locator('#onb-go').click();
  await page.waitForSelector('.nav, .onb-rules', { timeout: 6000 });
  await passRules(page);
  await page.waitForSelector('.nav');
  await done(page);
});

await scenario('create: file non valido + annulla import', async () => {
  const page = await open();
  await goto(page);
  await openWizard(page);
  fs.writeFileSync(SHOT + 'bad.xlsx', 'questo non e un excel');
  await page.setInputFiles('#onb-xlsx', SHOT + 'bad.xlsx');
  await page.waitForSelector('.onb-import .onb-err');
  assert.match(await page.locator('.onb-import .onb-err').innerText(), /Non riesco a leggere il file/);
  assert.equal(await page.locator('#onb-name').inputValue(), 'La nostra casa', 'il nome non si perde');
  await done(page);
});

await scenario('create: en + desktop + dark', async () => {
  const page = await open({ lang: 'en-US', viewport: D, dark: true });
  await goto(page);
  await openWizard(page);
  assert.match(await body(page), /Step 1 of 3/);
  assert.equal(await page.inputValue('#onb-name'), 'Our house');
  await noRawKeys(page, 'create en');
  await shot(page, 'create-1-en-desktop-dark');
  await tapNextFocus(page, ".onb-prow input");
  await noRawKeys(page, 'create en 2');
  assert.match(await body(page), /Step 2 of 3/);
  await page.keyboard.type('Ann'); await tapNextFocus(page, "#onb-pin");
  await page.waitForSelector('#onb-pin');
  assert.match(await body(page), /Choose an admin PIN/); await noRawKeys(page, 'create en 3');
  await shot(page, 'create-3-en-desktop-dark');
  await done(page);
  // mobile scuro: passi 1-3
  const p2 = await open({ dark: true });
  await goto(p2); await openWizard(p2); await shot(p2, 'create-1-dark');
  await tapNextFocus(p2, ".onb-prow input"); await p2.keyboard.type('Anna'); await shot(p2, 'create-2-dark');
  await tapNextFocus(p2, "#onb-pin"); await p2.waitForSelector('#onb-pin'); await p2.keyboard.type('1234'); await shot(p2, 'create-3-dark');
  await done(p2);
});

await scenario('who: lista persone, uscite, PIN admin', async () => {
  const hx = { ...ADMIN, ...NORULES, roommates: [{ id: 'anna', name: 'Anna', slot: 1, from: null, to: null }, { id: 'bruno', name: 'Bruno', slot: 2, from: null, to: '2026-10-01' }, { id: 'carla', name: 'Carla', slot: 3, from: null, to: null }] };
  const page = await open({ seed: seed({ me: null, admin: false, houseExtra: hx }) });
  await goto(page);
  assert.equal((await page.locator('.onb-housename').innerText()).trim(), 'Casa Test');
  assert.match(await body(page), /Tocca il tuo nome per entrare/);
  const order = await page.locator('.who .onb-wname').allInnerTexts();
  assert.deepEqual(order, ['Anna', 'Carla', 'Bruno']);
  assert.ok(await page.locator('.who.gone').count() === 1);
  assert.match(await page.locator('.who.gone').innerText(), /Uscito/);
  await page.getByRole('button', { name: /Non sono in elenco/ }).click();
  assert.match(await body(page), /Chiedi all'admin di aggiungerti/);
  await page.getByRole('button', { name: /Sono l'admin/ }).click();
  await page.fill('#onb-adminpin', '0000');
  await page.getByRole('button', { name: /^Sblocca/ }).click();
  await page.waitForSelector('.onb-err:not([hidden])');
  assert.match(await body(page), /PIN errato/);
  await shot(page, 'who-pin');
  await page.fill('#onb-adminpin', '1234');
  await page.getByRole('button', { name: /^Sblocca/ }).click();
  await page.waitForSelector('.note.ok'); assert.doesNotMatch(await body(page), /null/);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('cp:admin') || '{}').LOCALTEST001));
  assert.ok(await page.locator('.who .chip.acc').count() === 1);
  await shot(page, 'who');
  await noOverflow(page, 'who');
  await page.locator('.who', { hasText: 'Carla' }).click();
  await page.waitForSelector('.nav');
  assert.equal((await reg(page))[0].me, 'carla');
  await done(page);
  const p2 = await open({ viewport: D, dark: true, seed: seed({ me: null, houseExtra: NORULES }) });
  await goto(p2); await shot(p2, 'who-desktop-dark'); await done(p2);
});

await scenario('rules gate: scroll obbligatorio', async () => {
  const page = await open({ seed: seed({ me: 'anna' }) });
  await goto(page);
  await page.waitForSelector('.onb-rules');
  assert.match(await body(page), /passo 3 di 3/i);
  const btn = page.locator('[data-testid=rules-accept]');
  // il pulsante è sempre visibile (sticky) anche senza scorrere, ma finché non si è in fondo il tocco scorre
  assert.equal(await btn.getAttribute('data-ready'), '0');
  const box0 = await btn.boundingBox(); assert.ok(box0 && box0.y + box0.height <= 844 && box0.height >= 44, 'pulsante visibile e toccabile senza scorrere');
  await shot(page, 'rules-gate');
  await btn.click();   // da non-in-fondo: il tocco fa scorrere la pagina (con l'orologio finto l'animazione è lenta: poi si forza la fine)
  await page.waitForFunction(() => window.scrollY > 100, null, { timeout: 5000 });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForSelector('[data-testid=rules-accept][data-ready="1"]', { timeout: 5000 });
  await shot(page, 'rules-gate-end');
  await btn.click();
  await page.waitForSelector('.nav');
  const st = await store(page);
  const m = Object.values(st.members)[0];
  assert.equal(m.rulesAck.version, '1');
  await page.reload(); await ready(page);
  await page.waitForSelector('.nav');
  assert.ok(!(await page.locator('.onb-rules').count()));
  await done(page);
  // contenuto breve: nessuno scroll richiesto
  const p2 = await open({ viewport: D, seed: seed({ me: 'anna', houseExtra: { rules: { version: 1, text: { it: '## Una\n\nSolo una riga.' } } } }) });
  await goto(p2);
  await p2.waitForSelector('.onb-rules');
  await p2.waitForSelector('[data-testid=rules-accept][data-ready="1"]', { timeout: 4000 });   // contenuto corto: subito pronto
  assert.match(await body(p2), /Solo una riga/);
  await shot(p2, 'rules-gate-short-desktop');
  await done(p2);
  const p3 = await open({ dark: true, lang: 'en-US', seed: seed({ me: 'anna', houseExtra: { lang: 'en' } }) });
  await goto(p3); await p3.waitForSelector('.onb-rules'); await noRawKeys(p3, 'rules gate en');
  assert.match(await body(p3), /Scroll to the bottom to continue/);
  await shot(p3, 'rules-gate-en-dark'); await done(p3);
});

await scenario('notfound + offline', async () => {
  const page = await open({ seed: { 'cp:houses': [{ id: 'GONE00000000', name: 'Casa Vecchia', mode: 'local', me: 'x', lastUsed: 1 }], 'cp:last': 'GONE00000000' } });
  await goto(page);
  await page.waitForSelector('.onb-nf');
  const t = await body(page);
  assert.match(t, /Questo link non è più valido/); assert.match(t, /Casa Vecchia/);
  await shot(page, 'notfound');
  await page.locator('input.code').fill('ABCD-EFGH-JKMN');
  await page.locator('form.onb-code button[type=submit]').click();
  await page.waitForSelector('.onb-err:not([hidden])');
  await page.getByRole('button', { name: /Dimentica questa casa/ }).click();
  await page.locator('.sheet').getByRole('button', { name: /Dimentica questa casa/ }).click();
  await page.waitForSelector('.onb-landing');
  assert.deepEqual(await reg(page), []);
  await page.evaluate(() => window.__boot.go('offline', { name: 'Casa X' }));
  await page.waitForSelector('.onb-off');
  assert.match(await body(page), /Sei offline/);
  assert.ok(await page.getByRole('button', { name: /Riprova/ }).isVisible());
  await shot(page, 'offline');
  await done(page);
});

// ---------------------------------------------------------------- Altro
const S = (o = {}) => seed({ ...o, houseExtra: { ...NORULES, ...(o.houseExtra || {}) } });

await scenario('hub: voci, badge, admin/non admin, feature spente', async () => {
  const s = S({ needs: { n1: { text: 'Sale', by: 'bruno', at: '2026-10-27T10:00:00.000Z', done: false }, n2: { text: 'Pane', by: 'anna', at: '2026-10-27T11:00:00.000Z', done: false }, n3: { text: 'Uova', done: true } } });
  s['cp:h:' + HID].requests = { r1: { week: '2026-11-01', from: 'bruno', to: 'anna', fromChore: 'floor', toChore: 'bathroom', status: 'pending', at: '2026-10-27T10:00:00.000Z' } };
  const page = await open({ seed: s });
  await goto(page, '/more');
  const t = await body(page);
  for (const x of ['Scorte e spesa', 'Scambi turno', 'Ultimo che esce', 'Checklist ricorrenti', 'Regole della casa', 'Registro attività', 'Invita coinquilini', 'Esporta dati', 'Impostazioni', "Installa l'app", 'Informazioni', 'Versione \\d+\\.\\d+\\.\\d+']) assert.match(t, new RegExp(x), x);
  assert.match(t, /2 da comprare/);
  assert.equal(await page.locator('a.li[href="#/needs"] .chip').innerText(), '2');
  assert.equal(await page.locator('a.li[href="#/requests"] .chip').innerText(), '1');
  assert.equal(await page.locator('a.li[href="#/settings/invite"]').count(), 1);
  assert.equal(await page.locator('.mx-ai').count(), 0);
  await noOverflow(page, 'hub'); await noRawKeys(page, 'hub');
  await shot(page, 'hub-mobile');
  await done(page);
  // non admin + feature spente + AI
  const s2 = S({ admin: false, houseExtra: { features: { needs: false, activity: false, lastout: false }, ai: { enabled: true } } });
  const p2 = await open({ seed: s2 });
  await goto(p2, '/more');
  const t2 = await body(p2);
  assert.doesNotMatch(t2, /Scorte e spesa/); assert.doesNotMatch(t2, /Registro attività/); assert.doesNotMatch(t2, /Ultimo che esce/);
  assert.match(t2, /Invita coinquilini/); assert.doesNotMatch(t2, /Esporta dati/); assert.equal(await p2.locator('.mx-ai').count(), 0);   // UX-B: il codice è visibile a tutti, la pagina dati è solo admin
  await goto(p2, '/needs');
  assert.match(await body(p2), /Funzione disattivata/);
  await done(p2);
  const s3 = S({ houseExtra: { ai: { enabled: true } } });
  const p3 = await open({ seed: s3, viewport: D, dark: true });
  await goto(p3, '/more');
  assert.match(await body(p3), /Assistente IA – importa da messaggio/);
  await shot(p3, 'hub-desktop-dark');
  await done(p3);
  const p4 = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US' });
  await goto(p4, '/more'); await noRawKeys(p4, 'hub en');
  assert.match(await body(p4), /Supplies and shopping/);
  await shot(p4, 'hub-en'); await done(p4);
});

await scenario('needs: aggiungi, compra, svuota, focus', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/needs');
  await page.fill('#mx-need', 'Carta igienica');
  await page.locator('.mx-needform .switch').click();
  await page.locator('.mx-needform button[type=submit]').click();
  await page.waitForSelector('.mx-need');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'mx-need', 'il focus resta nel campo');
  assert.equal(await page.inputValue('#mx-need'), '');
  await page.fill('#mx-need', 'Sapone'); await page.press('#mx-need', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mx-need').length === 2);
  const rows = await page.locator('.mx-need').allInnerTexts();
  assert.match(rows[0], /Carta igienica/); assert.match(rows[0], /Urgente/); assert.match(rows[0], /Aggiunto da Anna/);
  const st = await store(page);
  assert.equal(Object.keys(st.needs).length, 2);
  assert.ok(Object.values(st.needs).some((n) => n.urgent && n.text === 'Carta igienica'));
  // la bozza non si perde se la pagina viene ridisegnata
  await page.fill('#mx-need', 'Bozza');
  await page.evaluate(() => window.__app.rerender());
  await page.locator('h1').first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#mx-need'), 'Bozza');
  await page.fill('#mx-need', '');
  await page.locator('.mx-need .mx-needmain').first().click();   // un tocco sulla riga intera
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  await page.locator('.mx-donetoggle').click();   // la sezione «Comprate» è chiusa di default
  assert.match(await page.locator('.mx-done').innerText(), /Comprato da Anna/);
  await shot(page, 'needs');
  await page.getByRole('button', { name: /Svuota comprat/ }).click();   // senza conferma: c'è Annulla nel messaggio
  await page.waitForFunction(() => !document.querySelector('.mx-done'));
  assert.equal(Object.keys((await store(page)).needs).length, 1);
  await page.locator('.mx-need button.icon-btn').first().click();
  await page.waitForSelector('.empty');
  assert.ok(await page.locator('a[href="https://tricount.com/abc"]').isVisible());
  await noOverflow(page, 'needs'); await noRawKeys(page, 'needs');
  await done(page);
  const p2 = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', dark: true, viewport: D });
  await goto(p2, '/needs'); await noRawKeys(p2, 'needs en'); await shot(p2, 'needs-en-desktop-dark'); await done(p2);
});

await scenario('rules: contenuto, modifica admin, ripristino, ack', async () => {
  const s = S({ members: { d1: { personId: 'anna', rulesAck: { version: '1', at: '2026-10-20T10:00:00.000Z' } }, d2: { personId: 'bruno', rulesAck: { version: '0' } } } });
  const page = await open({ seed: s });
  await goto(page, '/rules');
  assert.ok((await page.locator('.rules-sec').count()) >= 12);
  const t = await body(page);
  assert.match(t, /3 persone: un turno a testa/); assert.match(t, /almeno 3 persone a casa/); assert.match(t, /ultime 52 settimane/);
  assert.match(t, /Chi ha letto le regole/); assert.match(t, /1 di 3/);
  assert.match(await page.locator('.list:has-text("Carla")').innerText(), /Da leggere/);
  await shot(page, 'rules-page');
  await noOverflow(page, 'rules');
  await page.getByRole('button', { name: /Modifica testo/ }).click();
  const ta = page.locator('.sheet textarea');
  const cur = await ta.inputValue();
  assert.match(cur, /^## La regola base/);
  await ta.fill('## Casa nostra\n\nSi lava **tutto** subito.\n\n- piatti\n- pentole\n\n## Seconda\n\nFine.');
  await page.locator('.sheet').getByRole('button', { name: /^Salva/ }).click();
  await page.waitForFunction(() => /Regole personalizzate/.test(document.body.innerText));
  assert.equal(await page.locator('.rules-sec').count(), 2);
  assert.equal(await page.locator('.rules-body strong').innerText(), 'tutto');
  assert.equal(await page.locator('.rules-body li').count(), 2);
  let st = await store(page);
  assert.equal(st.house.rules.version, 2); assert.match(st.house.rules.text.it, /Casa nostra/);
  assert.match(await body(page), /Versione 2/);
  await shot(page, 'rules-custom');
  await page.getByRole('button', { name: /Ripristina testo originale/ }).click();
  await page.locator('.sheet').getByRole('button', { name: /Ripristina testo originale/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.rules-sec').length >= 12);
  st = await store(page);
  assert.equal(st.house.rules.version, 3); assert.ok(!st.house.rules.text);
  await done(page);
  // non admin: niente modifica / niente ack; en
  const p2 = await open({ seed: S({ admin: false, houseExtra: { lang: 'en' } }), lang: 'en-US' });
  await goto(p2, '/rules');
  assert.doesNotMatch(await body(p2), /Edit text|Who has read/); assert.match(await body(p2), /The basic rule/);
  await noRawKeys(p2, 'rules en'); await shot(p2, 'rules-en');
  await done(p2);
});

await scenario('lastout: spunte, completamento, reset, editor, sheet', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/lastout');
  assert.equal(await page.locator('.mx-lo').count(), 7);
  for (let i = 0; i < 3; i++) await page.locator('.mx-lo').nth(i).click();
  await page.waitForFunction(() => /3 di 7/.test(document.body.innerText));
  assert.match(await page.locator('.mx-lo.on').first().innerText(), /Anna/);
  await shot(page, 'lastout-progress');
  for (let i = 3; i < 7; i++) await page.locator('.mx-lo').nth(i).click();
  await page.waitForSelector('.mx-progress.all');
  assert.match(await body(page), /Tutto a posto: buon viaggio!/);
  assert.match(await body(page), /Controllo completato da Anna/);
  const st = await store(page);
  assert.equal(st.house.lastOut.doneBy, 'anna'); assert.equal(Object.keys(st.house.lastOut.checked).length, 7);
  await shot(page, 'lastout-done');
  await page.getByRole('button', { name: /Nuovo controllo/ }).click();
  await page.waitForFunction(() => /0 di 7/.test(document.body.innerText));
  // editor admin
  await page.getByRole('button', { name: /Modifica elenco/ }).click();
  await page.getByRole('button', { name: /Aggiungi voce/ }).click();
  await page.locator('.sheet input').last().fill('Chiudere il gas');
  await page.locator('.sheet .mx-edrow').first().getByRole('button', { name: /Sposta giù/ }).click();
  await page.locator('.sheet .mx-edrow').nth(1).getByRole('button', { name: /Elimina/ }).click();
  await shot(page, 'lastout-editor');
  await page.locator('.sheet').getByRole('button', { name: /^Salva/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-lo').length === 7);
  const st2 = await store(page);
  assert.equal(st2.house.lastoutItems.length, 7); assert.equal(st2.house.lastoutItems.at(-1).text, 'Chiudere il gas');
  // sheet
  await page.evaluate(async () => { const m = await import('/js/screens/more.js'); m.openLastOutSheet(window.__app); });
  await page.waitForSelector('.sheet .mx-lo');
  await page.locator('.sheet .mx-lo').first().click();
  await page.waitForFunction(() => /1 di 7/.test(document.querySelector('.sheet').innerText));
  await shot(page, 'lastout-sheet');
  await noOverflow(page, 'lastout'); await noRawKeys(page, 'lastout');
  await done(page);
  const p2 = await open({ seed: S({ admin: false, houseExtra: { lang: 'en' } }), lang: 'en-US', dark: true });
  await goto(p2, '/lastout'); await noRawKeys(p2, 'lastout en');
  assert.doesNotMatch(await body(p2), /Edit list/); assert.match(await body(p2), /Nobody|Last one out/);
  await shot(p2, 'lastout-en-dark'); await done(p2);
});

await scenario('tasks: CRUD admin, suggerimenti, sola lettura', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/tasks');
  let t = await body(page);
  assert.match(t, /Svuota il contenitore dell'aspirapolvere/); assert.match(t, /Cambia il tappetino/); assert.match(t, /Suggerimenti/);
  assert.match(t, /Da fare questa settimana/);
  await shot(page, 'tasks');
  // crea
  await page.getByRole('button', { name: /Nuovo compito/ }).click();
  await page.fill('#mx-task-text', 'Pulisci il microonde');
  await page.locator('.sheet .seg button', { hasText: 'Cucina' }).click();
  await page.locator('.sheet .num button').nth(1).click(); await page.locator('.sheet .num button').nth(1).click();
  await shot(page, 'tasks-sheet');
  await page.locator('.sheet').getByRole('button', { name: /^Salva/ }).click();
  await page.waitForFunction(() => /Pulisci il microonde/.test(document.body.innerText));
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  let st = await store(page);
  assert.equal(st.house.tasks.length, 3);
  const nt = st.house.tasks.find((x) => x.text === 'Pulisci il microonde');
  assert.equal(nt.chore, 'kitchen'); assert.equal(nt.every, 3); assert.equal(nt.enabled, true);
  // modifica
  await page.getByRole('button', { name: /Modifica: Pulisci il microonde/ }).click();
  await page.fill('#mx-task-text', 'Pulisci il microonde a fondo');
  await page.locator('.sheet').getByRole('button', { name: /^Salva/ }).click();
  await page.waitForFunction(() => /microonde a fondo/.test(document.body.innerText));
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  // disattiva
  await page.locator('.mx-task', { hasText: 'microonde a fondo' }).locator('.switch').click();
  await page.waitForFunction(() => document.querySelector('.mx-task.off'));
  st = await store(page);
  assert.equal(st.house.tasks.find((x) => x.id === nt.id).enabled, false);
  // suggerimento -> sheet precompilato
  await page.getByRole('button', { name: /Pulisci il frigorifero/ }).click();
  assert.equal(await page.inputValue('#mx-task-text'), 'Pulisci il frigorifero');
  await page.locator('.sheet').getByRole('button', { name: /^Annulla/ }).click();
  await page.waitForTimeout(450);
  // elimina
  await page.getByRole('button', { name: /Modifica: Pulisci il microonde a fondo/ }).click();
  await page.locator('.sheet').getByRole('button', { name: /^Elimina/ }).click();
  await page.locator('.sheet').last().getByRole('button', { name: /^Elimina/ }).click();
  await page.waitForFunction(() => !/microonde/.test(document.body.innerText));
  assert.equal((await store(page)).house.tasks.length, 2);
  await noOverflow(page, 'tasks'); await noRawKeys(page, 'tasks');
  await done(page);
  // non admin: sola lettura
  const p2 = await open({ seed: S({ admin: false }) });
  await goto(p2, '/tasks');
  assert.equal(await p2.getByRole('button', { name: /Nuovo compito/ }).count(), 0);
  assert.equal(await p2.locator('.mx-task .switch').count(), 0);
  assert.match(await body(p2), /Solo l'admin può modificare/);
  await shot(p2, 'tasks-readonly'); await done(p2);
  // feature spenta
  const p3 = await open({ seed: S({ houseExtra: { features: { tasks: false } } }) });
  await goto(p3, '/tasks'); assert.match(await body(p3), /Funzione disattivata/); await done(p3);
  const p4 = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', viewport: D, dark: true });
  await goto(p4, '/tasks'); await noRawKeys(p4, 'tasks en'); await shot(p4, 'tasks-en-desktop-dark'); await done(p4);
});

await scenario('requests: in arrivo, inviate, storico', async () => {
  const s = S();
  s['cp:h:' + HID].requests = {
    r1: { week: '2026-11-01', from: 'bruno', to: 'anna', fromChore: 'floor', toChore: 'bathroom', status: 'pending', at: '2026-10-27T10:00:00.000Z' },
    r2: { week: '2026-11-01', from: 'anna', to: 'carla', fromChore: 'bathroom', toChore: 'kitchen', status: 'pending', at: '2026-10-27T11:00:00.000Z' },
    r3: { week: '2026-10-25', from: 'carla', to: 'anna', fromChore: 'kitchen', toChore: 'floor', status: 'accepted', at: '2026-10-20T11:00:00.000Z', answeredAt: '2026-10-21T11:00:00.000Z' },
    r4: { week: '2026-11-01', from: 'carla', to: 'bruno', fromChore: 'kitchen', toChore: 'floor', status: 'pending', at: '2026-10-20T12:00:00.000Z' },   // UX-B: una pendente su settimana chiusa ora finisce in «Scadute»
    n1: { kind: 'nudge', to: 'anna', from: 'bruno', text: 'ciao', status: 'pending', at: '2026-10-27T10:00:00.000Z' },
  };
  const page = await open({ seed: s });
  await goto(page, '/requests');
  let t = await body(page);
  assert.match(t, /Bruno vuole scambiare con te: il tuo bagno per il suo pavimenti/);
  assert.match(t, /Hai chiesto a Carla/); assert.match(t, /Altre richieste in attesa/); assert.match(t, /Storico/);
  await shot(page, 'requests');
  await noOverflow(page, 'requests'); await noRawKeys(page, 'requests');
  await page.getByRole('button', { name: /^Accetta/ }).first().click();
  await page.waitForFunction(() => !/vuole scambiare con te/.test(document.body.innerText));
  let st = await store(page);
  assert.equal(st.requests.r1.status, 'accepted'); assert.ok(st.weeks['2026-11-01'].swap);
  await page.getByRole('button', { name: /Annulla richiesta: .*Anna ↔ Carla/ }).click();
  await page.waitForFunction(() => !/Hai chiesto a Carla/.test(document.body.innerText));
  st = await store(page);
  assert.ok(!st.requests.r2);
  await done(page);
  const p2 = await open({ seed: S({ admin: false }) });
  await goto(p2, '/requests');
  assert.doesNotMatch(await body(p2), /Altre richieste in attesa/);
  await done(p2);
  const p3 = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', dark: true });
  await goto(p3, '/requests'); await noRawKeys(p3, 'requests en'); assert.match(await body(p3), /Chore swaps/); await done(p3);
  if (fs.existsSync(new URL('../../js/choresheet.js', import.meta.url))) {
    const p4 = await open({ seed: S() });
    await goto(p4, '/requests');
    await p4.getByRole('button', { name: /Chiedi uno scambio/ }).click();
    await p4.waitForTimeout(800);
    await shot(p4, 'requests-ask');
    await done(p4);
  }
});

await scenario('activity: raggruppato per giorno', async () => {
  const log = {
    l1: { at: '2026-10-28T08:30:00', by: 'anna', type: 'done', p: { chore: 'floor' } },
    l2: { at: '2026-10-28T07:00:00', by: 'bruno', type: 'cover', p: { chore: 'kitchen', who: 'carla' } },
    l3: { at: '2026-10-27T20:15:00', by: 'admin', type: 'need', p: { text: 'Sale' } },
    l4: { at: '2026-10-20T09:00:00', by: 'carla', type: 'plan', p: { chore: 'bathroom', day: '2026-10-24' } },
    l5: { at: '2026-10-19T09:00:00', by: 'anna', type: 'strano', p: { text: 'boh' } },
    l6: { at: '2026-10-18T09:00:00', by: 'anna', type: 'swap', p: { chore: 'floor', who: 'bruno' } },
  };
  const s = S(); s['cp:h:' + HID].log = log;
  const p = await open({ seed: s });
  await goto(p, '/activity');
  const eyebrows = await p.locator('.eyebrow').allInnerTexts();
  assert.deepEqual(eyebrows.slice(0, 2), ['Oggi', 'Ieri']);
  const t = await body(p);
  assert.match(t, /Anna ha segnato pavimenti come fatto/); assert.match(t, /Bruno ha segnato che Carla ha fatto cucina/);
  assert.match(t, /Admin ha aggiunto "Sale" alla spesa/); assert.match(t, /Carla farà bagno sabato 24 ott/);
  assert.match(t, /Anna: boh/); assert.match(t, /Anna e Bruno hanno scambiato pavimenti/);
  await noOverflow(p, 'activity'); await noRawKeys(p, 'activity');
  await shot(p, 'activity');
  await done(p);
  const p2 = await open({ seed: S({ houseExtra: { features: { activity: false } } }) });
  await goto(p2, '/activity'); assert.match(await body(p2), /Funzione disattivata/); await done(p2);
  const p3 = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US' });
  await goto(p3, '/activity'); assert.match(await body(p3), /No activity yet/); await done(p3);
});

await scenario('guide: piattaforme, installa, installata', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/guide');
  assert.equal(await page.locator('details.mx-guide').count(), 3);
  assert.ok(await page.locator('details.mx-guide').nth(0).evaluate((d) => d.open));
  assert.match(await body(page), /Il tuo dispositivo/);
  // evento di installazione
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); window.__app.rerender(); });
  await page.getByRole('button', { name: /^Installa$/ }).click();
  assert.ok(await page.evaluate(() => window.__prompted));
  await shot(page, 'guide-desktop-ua');
  await noOverflow(page, 'guide'); await noRawKeys(page, 'guide');
  await done(page);
  // iPhone
  const p2 = await open({ seed: S() });
  await p2.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' }));
  await goto(p2, '/guide');
  assert.match(await p2.locator('details.mx-guide').first().innerText(), /iPhone/);
  assert.match(await body(p2), /iOS 16\.4/);
  await shot(p2, 'guide-ios');
  await done(p2);
  // installata
  const p3 = await open({ seed: S(), dark: true });
  await p3.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await goto(p3, '/guide'); assert.match(await body(p3), /App già installata/); await done(p3);
  const p4 = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', viewport: D });
  await goto(p4, '/guide'); await noRawKeys(p4, 'guide en'); await shot(p4, 'guide-en-desktop'); await done(p4);
});

await scenario('about', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/more/about');
  const t = await body(page);
  assert.match(t, /Versione \d+\.\d+\.\d+/); assert.match(t, /github\.com\/iantomasi-nicola\/tidyhouse/);
  assert.equal(await page.locator('a[href="https://github.com/iantomasi-nicola/tidyhouse"]').count(), 1);
  await noOverflow(page, 'about'); await noRawKeys(page, 'about');
  await shot(page, 'about');
  await page.getByRole('link', { name: 'Indietro' }).click();
  await page.waitForFunction(() => /Altro/.test(document.querySelector('h1').innerText));
  await done(page);
});

await env.close();
if (failed) { console.error(`\n${failed} scenari falliti`); process.exit(1); }
console.log('\ntutti gli scenari OK');
