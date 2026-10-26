// E2E (Playwright) della Spesa veloce: aggiunta continua senza perdere il focus, voci frequenti, incolla di più righe,
// comprato con un tocco + Annulla (pagina e widget Home), stato vuoto con voci di partenza, tap target, nessun overflow.
// Esegui con:  node tests/e2e/needs-fast.e2e.mjs [filtro]      Screenshot in SHOT_DIR.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const SHOT = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-tidyhouse/c243bc09-3166-5024-8c63-241289e91a58/scratchpad/needs-fast/';
const NOW = '2026-10-28T10:00:00';
const M = { width: 390, height: 844 };
const HID = 'LOCALTEST001';
fs.mkdirSync(SHOT, { recursive: true });

const env = await start();
let failed = 0; const only = process.argv[2];
const ALL_DONE = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
const doneWeeks = { '2026-10-04': ALL_DONE, '2026-10-11': ALL_DONE, '2026-10-18': ALL_DONE, '2026-10-25': ALL_DONE };

/** Storico di una casa «rodata»: Latte 4 volte, Pane 3, Uova 2, + altre; Sale ancora in lista aperta. Il registro ha le stesse aggiunte (come fa l'app). */
function history() {
  const needs = {}; const log = {}; let i = 0;
  const add = (text, n, extra = {}) => {
    for (let k = 0; k < n; k++) {
      const at = new Date(Date.UTC(2026, 8, 1 + i, 9, 0, 0)).toISOString(); i++;
      needs['h' + i] = { text, urgent: false, by: 'bruno', at, done: true, doneBy: 'anna', doneAt: at, ...extra };
      log['l' + i] = { at, by: 'bruno', type: 'need', p: { text } };
    }
  };
  add('Latte', 4); add('Pane', 3); add('Uova', 2); add('Detersivo piatti', 2); add('Carta igienica', 1); add('Sapone mani', 1); add('Spugne', 1); add('Olio', 1); add('Caffè', 1); add('Sale', 1);
  needs.open1 = { text: 'sale', urgent: false, by: 'carla', at: '2026-10-27T10:00:00.000Z', done: false };
  return { needs, log };
}
function S({ hist = false, houseExtra = {}, needs = {} } = {}) {
  const h = hist ? history() : { needs: {}, log: {} };
  const s = seed({ needs: { ...h.needs, ...needs }, weeks: doneWeeks, houseExtra: { requireRules: false, ...houseExtra } });
  s['cp:h:' + HID].log = h.log;
  return s;
}
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
const goto = async (page, hash = '/') => { await page.goto(env.url + '/#' + hash); await page.waitForSelector('#app > *', { timeout: 8000 }); await page.waitForTimeout(250); };
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('cp:h:' + k) || 'null'), HID);
const active = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
const sugg = (page) => page.$$eval('.mx-sugg .mx-chip', (els) => els.map((e) => e.innerText.trim()));
async function noOverflow(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(w.sw <= w.iw + 1, `overflow orizzontale in ${label}: ${w.sw} > ${w.iw}`);
}
async function minSize(page, sel, min, label) {
  const sizes = await page.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  assert.ok(sizes.length, 'nessun elemento per ' + label);
  for (const [w, h] of sizes) assert.ok(w >= min && h >= min, `${label}: ${w}x${h} < ${min}px`);
}
async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.error('FAIL ', name, '\n', e && e.stack ? e.stack : e); }
}

await scenario('aggiunta continua: 5 voci di fila, focus sempre nel campo, nessun input ricreato', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/needs');
  await page.waitForSelector('#mx-need');
  assert.equal(await page.getAttribute('#mx-need', 'enterkeyhint'), 'send');
  assert.equal(await page.getAttribute('#mx-need', 'autocapitalize'), 'sentences');
  await page.evaluate(() => { window.__inp = document.getElementById('mx-need'); window.__mut = 0; new MutationObserver((rs) => { for (const r of rs) for (const n of [...r.addedNodes, ...r.removedNodes]) if (n.nodeType === 1 && (n.matches('input') || n.querySelector('input'))) window.__mut++; }).observe(document.body, { childList: true, subtree: true }); });
  await page.click('#mx-need');
  const t0 = Date.now();
  for (const w of ['Pane', 'Latte', 'Uova', 'Olio', 'Caffè']) {
    await page.keyboard.type(w, { delay: 5 });
    await page.keyboard.press('Enter');
    assert.equal(await active(page), 'mx-need', 'focus perso dopo ' + w);
    assert.equal(await page.inputValue('#mx-need'), '', 'campo non svuotato dopo ' + w);
  }
  const ms = Date.now() - t0;
  await page.waitForFunction(() => document.querySelectorAll('.mx-need').length === 5);
  assert.equal(await active(page), 'mx-need');
  assert.equal(await page.evaluate(() => document.getElementById('mx-need') === window.__inp && window.__mut === 0), true, 'input ricreato');
  const st = await store(page);
  assert.deepEqual(Object.values(st.needs).map((n) => n.text).sort(), ['Caffè', 'Latte', 'Olio', 'Pane', 'Uova']);
  console.log(`      5 voci scritte+Invio in ${ms} ms (battitura inclusa, 5 ms/tasto), 0 tocchi sul campo dopo il primo`);
  await done(page);
});

await scenario('suggerimenti: max 8, esclusi quelli in lista, filtro mentre si digita, un tocco aggiunge e tiene il focus', async () => {
  const page = await open({ seed: S({ hist: true }) });
  await goto(page, '/needs');
  await page.waitForSelector('.mx-sugg .mx-chip');
  let c = await sugg(page);
  assert.equal(c.length, 8, 'massimo 8: ' + c);
  assert.deepEqual(c.slice(0, 2), ['Latte', 'Pane'], 'ordine per uso');
  assert.ok(!c.some((x) => /^sale$/i.test(x)), 'Sale è già in lista aperta: ' + c);
  assert.equal(await page.locator('.mx-starter').count(), 0, 'niente voci di partenza con storico');
  await shot(page, 'sugg-390');
  // filtro per prefisso/inclusione
  await page.click('#mx-need');
  await page.keyboard.type('de', { delay: 20 });
  c = await sugg(page);
  assert.deepEqual(c, ['Detersivo piatti'], 'filtro "de": ' + c);
  await page.fill('#mx-need', 'ZZ');
  assert.deepEqual(await sugg(page), []);
  assert.equal(await page.locator('.mx-sugg').evaluate((e) => getComputedStyle(e).visibility), 'hidden', 'la riga tiene il posto (invisibile)');
  await page.fill('#mx-need', 'att');   // inclusione: «Latte»
  assert.ok((await sugg(page)).includes('Latte'));
  // un tocco su un chip = aggiunge; il testo digitato (filtro) si svuota; la tastiera resta aperta
  await page.locator('.mx-sugg .mx-chip', { hasText: 'Latte' }).click();
  await page.waitForFunction(() => /Latte/.test(document.querySelector('.mx-needlist').innerText));
  assert.equal(await page.inputValue('#mx-need'), '');
  assert.equal(await active(page), 'mx-need', 'focus mantenuto dopo il tocco sul chip');
  let st = await store(page);
  assert.equal(Object.values(st.needs).filter((n) => !n.done && n.text === 'Latte').length, 1);
  assert.ok(!(await sugg(page)).includes('Latte'), 'Latte ora è in lista: non più suggerito');
  // chip senza che il campo abbia il focus: non apre la tastiera
  await page.locator('h1').first().click();
  await page.locator('.mx-sugg .mx-chip', { hasText: 'Pane' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-need:not(.done)').length === 3);
  assert.notEqual(await active(page), 'mx-need', 'nessun focus forzato se il campo non era attivo');
  // il chip rispetta «Urgente»
  await page.locator('.mx-needform .switch').click();
  await page.locator('.mx-sugg .mx-chip', { hasText: 'Uova' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-need:not(.done)').length === 4);
  st = await store(page);
  assert.equal(Object.values(st.needs).find((n) => !n.done && n.text === 'Uova').urgent, true);
  await noOverflow(page, 'suggerimenti');
  await done(page);
});

await scenario('incolla più righe = più voci (elenchi puntati e doppioni puliti)', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/needs');
  await page.click('#mx-need');
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', '- Latte\n• Pane integrale\r\n1) Uova\n\n  latte  \nCarta   igienica');
    document.getElementById('mx-need').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.mx-need').length === 4);
  assert.deepEqual(Object.values((await store(page)).needs).map((n) => n.text).sort(), ['Carta igienica', 'Latte', 'Pane integrale', 'Uova']);
  assert.equal(await page.inputValue('#mx-need'), '');
  assert.equal(await active(page), 'mx-need');
  assert.match(await page.locator('.toast').last().innerText(), /Aggiunte 4 voci/);
  // una riga sola: la gestisce il campo, non il codice di incolla
  const prevented = await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Sapone'); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.getElementById('mx-need').dispatchEvent(ev); return ev.defaultPrevented; });
  assert.equal(prevented, false);
  await done(page);
});

await scenario('comprato: un tocco sulla riga intera, messaggio con Annulla, sezione Comprate chiusa', async () => {
  const page = await open({ seed: S({ needs: { a: { text: 'Sale grosso', by: 'bruno', at: '2026-10-27T10:00:00.000Z', done: false }, b: { text: 'Aceto', by: 'carla', at: '2026-10-27T11:00:00.000Z', done: false } } }) });
  await goto(page, '/needs');
  await page.waitForSelector('.mx-need');
  // il tocco cade lontano dal cerchio (sul testo, a destra): deve comunque segnare comprato
  const box = await page.locator('.mx-need', { hasText: 'Sale grosso' }).locator('.mx-needmain').boundingBox();
  assert.ok(box.height >= 44 && box.width > 250, `area della riga ${box.width}x${box.height}`);
  await page.touchscreen.tap(box.x + box.width - 30, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  assert.equal((await store(page)).needs.a.done, true);
  assert.equal(await page.locator('.mx-done').isVisible(), false, 'Comprate collassata');
  assert.match(await page.locator('.mx-donetoggle').innerText(), /Comprate\s*1/);
  const toast = page.locator('.toast', { hasText: 'Comprato: Sale grosso' });
  await toast.waitFor();
  await toast.locator('.toast-action').click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 0);
  assert.equal((await store(page)).needs.a.done, false, 'Annulla rimette in lista');
  assert.match(await page.locator('.mx-needlist').innerText(), /Sale grosso/);
  // di nuovo comprato, poi Svuota con Annulla (nessuna conferma)
  await page.locator('.mx-need', { hasText: 'Aceto' }).locator('.mx-needmain').click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  await page.locator('.mx-clear').click();
  await page.waitForFunction(() => !document.querySelector('.mx-done'));
  assert.equal(await page.locator('.sheet').count(), 0);
  assert.equal(Object.keys((await store(page)).needs).length, 1);
  await page.locator('.toast', { hasText: 'Rimosse 1 voci' }).locator('.toast-action').click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-done .mx-need').length === 1);
  assert.equal(Object.keys((await store(page)).needs).length, 2);
  await done(page);
});

await scenario('home: widget spesa, un tocco sulla riga = comprato con Annulla', async () => {
  const s = S({ needs: { a: { text: 'Carta igienica', by: 'bruno', at: '2026-10-27T10:00:00.000Z', done: false }, b: { text: 'Sapone', by: 'carla', at: '2026-10-27T11:00:00.000Z', done: false, urgent: true } }, houseExtra: { home: { order: ['hero', 'needs', 'week'], hidden: [] } } });
  const page = await open({ seed: s });
  await goto(page, '/');
  await page.waitForSelector('[data-widget="needs"] [data-need]');
  const row = page.locator('[data-widget="needs"] [data-need]', { hasText: 'Carta igienica' });
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  assert.ok(box.height >= 44 && box.width > 250, `riga ${box.width}x${box.height}`);
  await page.touchscreen.tap(box.x + box.width - 40, box.y + box.height / 2);   // sul testo, non sul cerchio
  await page.waitForFunction(() => !/Carta igienica/.test(document.querySelector('[data-widget="needs"]').innerText));
  assert.equal((await store(page)).needs.a.done, true);
  await page.locator('.toast', { hasText: 'Comprato: Carta igienica' }).locator('.toast-action').click();
  await page.waitForFunction(() => /Carta igienica/.test(document.querySelector('[data-widget="needs"]').innerText));
  assert.equal((await store(page)).needs.a.done, false);
  await shot(page, 'home-needs-390');
  await noOverflow(page, 'home spesa');
  await done(page);
});

await scenario('stato vuoto: voci di partenza (IT/EN), un tocco aggiunge; con storico niente voci di partenza', async () => {
  const page = await open({ seed: S() });
  await goto(page, '/needs');
  await page.waitForSelector('.mx-starter');
  assert.equal(await page.locator('.mx-sugg').isVisible(), false, 'nessun chip frequente senza storico');
  const names = await page.$$eval('.mx-starter .mx-chip', (els) => els.map((e) => e.innerText.trim()));
  assert.ok(names.includes('Carta igienica') && names.includes('Spugne') && names.includes('Sacchetti spazzatura') && names.includes('Detersivo piatti'), names.join(','));
  await shot(page, 'empty-390');
  await minSize(page, '.mx-starter .mx-chip', 44, 'chip di partenza');
  await page.locator('.mx-starter .mx-chip', { hasText: 'Spugne' }).click();
  await page.waitForFunction(() => /Spugne/.test(document.querySelector('.mx-needlist').innerText));
  assert.ok(!(await page.$$eval('.mx-starter .mx-chip', (els) => els.map((e) => e.innerText))).some((x) => /Spugne/.test(x)), 'la voce aggiunta esce dai suggerimenti');
  await page.locator('.mx-starter .mx-chip', { hasText: 'Carta igienica' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.mx-need').length === 2);
  await done(page);
  const en = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', dark: true });
  await goto(en, '/needs');
  await en.waitForSelector('.mx-starter');
  assert.match(await en.locator('.mx-starter').innerText(), /Toilet paper[\s\S]*Dish soap[\s\S]*Trash bags[\s\S]*Sponges/);
  assert.doesNotMatch(await en.evaluate(() => document.body.innerText), /\bmoreZ\./);
  await shot(en, 'empty-390-en-dark');
  await done(en);
  const h = await open({ seed: S({ hist: true }) });
  await goto(h, '/needs');
  assert.equal(await h.locator('.mx-starter').count(), 0);
  await done(h);
});

await scenario('aggiornamenti remoti mentre si scrive: input stabile, testo e focus intatti, suggerimenti vivi', async () => {
  const page = await open({ seed: S({ hist: true }) });
  await goto(page, '/needs');
  await page.waitForSelector('#mx-need');
  await page.evaluate(() => { window.__inp = document.getElementById('mx-need'); });
  await page.click('#mx-need');
  const remote = page.evaluate(async () => {
    const s = window.__app.store; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 12; i++) {
      s.setDoc('needs', 'rem' + i, { text: 'Remoto ' + i, urgent: false, by: 'carla', at: new Date(Date.now() + i).toISOString(), done: i % 3 === 2 });
      s.setDoc('log', 'rl' + i, { at: new Date().toISOString(), by: 'carla', type: 'need', p: { text: 'Remoto ' + i } });
      await sleep(90);
    }
  });
  const typed = 'Mandorle e noci 500 g';
  await page.keyboard.type(typed, { delay: 70 });
  await remote;
  assert.equal(await page.inputValue('#mx-need'), typed);
  assert.equal(await active(page), 'mx-need');
  assert.equal(await page.evaluate(() => document.getElementById('mx-need') === window.__inp), true);
  assert.equal(await page.evaluate(() => document.getElementById('mx-need').selectionStart), typed.length);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Mandorle/.test(document.querySelector('.mx-needlist').innerText));
  assert.equal(await active(page), 'mx-need');
  await done(page);
});

await scenario('tap target ≥ 44px e nessun overflow da 320 a 1440 px (chiaro e scuro)', async () => {
  const needs = { a: { text: 'Detersivo per i piatti al limone extra lungo che non finisce mai di scrivere davvero', urgent: true, by: 'bruno', at: '2026-10-27T10:00:00.000Z', done: false }, b: { text: 'Pane', by: 'carla', at: '2026-10-27T11:00:00.000Z', done: false }, c: { text: 'Uova', by: 'carla', at: '2026-10-26T11:00:00.000Z', done: true, doneBy: 'anna', doneAt: '2026-10-27T12:00:00.000Z' } };
  for (const dark of [false, true]) {
    for (const w of [320, 360, 390, 768, 1024, 1440]) {
      const page = await open({ seed: S({ hist: true, needs }), viewport: { width: w, height: w < 600 ? 780 : 900 }, dark });
      await goto(page, '/needs');
      await page.waitForSelector('.mx-need');
      await page.locator('.mx-donetoggle').click();
      await noOverflow(page, `spesa ${w}px ${dark ? 'scuro' : 'chiaro'}`);
      if (w === 320 || w === 390) {
        await minSize(page, '.mx-needmain', 44, 'riga');
        await minSize(page, '.mx-need .icon-btn', 44, 'cestino');
        await minSize(page, '.mx-sugg .mx-chip', 44, 'chip');
        await minSize(page, '.mx-donetoggle', 44, 'Comprate');
        await minSize(page, '.mx-clear', 44, 'Svuota');
        await minSize(page, '.mx-needform button[type=submit]', 44, 'Aggiungi');
        await minSize(page, '.mx-needform .switch input', 44, 'Urgente');
      }
      if (w === 390) { await page.locator('h1').first().click(); await shot(page, `list-390-${dark ? 'dark' : 'light'}`); }
      await done(page);
    }
  }
});

if (failed) { console.error(failed + ' scenari falliti'); await env.close(); process.exit(1); }
console.log('tutti gli scenari OK');
await env.close();
