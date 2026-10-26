// E2E delle azioni dalla notifica (Playwright): node tests/e2e/do-actions.e2e.mjs
// Rotte #/do/done/<domenica>/<mansione> e #/do/accept|decline/<id> (js/doaction.js) + service worker (azioni della notifica e click).
// Orologio finto: mercoledi' 2026-10-28 10:00 (settimana corrente = quella che chiude 2026-11-01). Esce con codice 1 se un test fallisce.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { start, seed } from './helpers.mjs';
import { compute } from '../../js/engine.js';
import { engineHouse } from '../../js/store.js';

const require = createRequire(import.meta.url);
const NOW = '2026-10-28T10:00:00', TODAY = '2026-10-28', CUR = '2026-11-01', ID = 'LOCALTEST001';
const ALL = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
const DONE = { '2026-10-04': ALL, '2026-10-11': ALL, '2026-10-18': ALL, '2026-10-25': ALL };
const mk = (o = {}) => seed({ weeks: DONE, ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });

/** Chi ha quale turno nella settimana corrente (stesso calcolo dell'app). */
const who = (s) => { const o = compute(engineHouse(s['cp:h:' + ID]), TODAY, 3); const r = o.rows[o.cur]; return { floor: r.assigned[0], bathroom: r.assigned[1], kitchen: r.assigned[2] }; };
const W = who(mk());
const F = W.floor, B = W.bathroom, K = W.kitchen;
assert.ok(F && B && K && new Set([F, B, K]).size === 3, 'tre persone con tre turni');
const AT = '2026-10-28T09:00:00.000Z';
/** Richieste di prova, tutte indirizzate a K (la persona che usa l'app). */
const REQS = {
  rCover: { kind: 'cover', week: CUR, chore: 'floor', from: F, to: K, terms: 'repay', status: 'pending', at: AT },
  rCoverAny: { kind: 'cover', week: CUR, chore: 'floor', from: F, to: null, terms: 'repay', status: 'pending', at: AT },
  rOffer: { kind: 'offer', week: CUR, chore: 'kitchen', from: F, to: K, terms: 'repay', status: 'pending', at: AT },
  rOffer2: { kind: 'offer', week: CUR, chore: 'kitchen', from: B, to: K, terms: 'repay', status: 'pending', at: AT },
  rSwap: { week: CUR, from: F, to: K, fromChore: 'floor', toChore: 'kitchen', status: 'pending', at: AT },
  rSwap2: { week: CUR, from: B, to: K, fromChore: 'bathroom', toChore: 'kitchen', status: 'pending', at: AT },
  rOther: { kind: 'offer', week: CUR, chore: 'floor', from: K, to: F, terms: 'repay', status: 'pending', at: AT },   // indirizzata a F, non a K
  rDone: { kind: 'offer', week: CUR, chore: 'kitchen', from: F, to: K, terms: 'repay', status: 'accepted', at: AT },
  rNo: { week: CUR, from: F, to: K, fromChore: 'floor', toChore: 'kitchen', status: 'declined', at: AT },
};
const withReqs = (o = {}) => { const s = mk(o); s['cp:h:' + ID].requests = JSON.parse(JSON.stringify(REQS)); return s; };

let env; const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log('ok   ' + name + ` (${Date.now() - t0}ms)`); } catch (e) { results.push([name, false]); console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}
async function open(s, hash, { lang = 'it-IT' } = {}) {
  const page = await env.page({ now: NOW, lang, seed: s });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector('[data-screen="home"]', { timeout: 8000 });
  return page;
}
const wk = (page, s = CUR) => page.evaluate((sun) => JSON.parse(JSON.stringify(window.__app.state.weeks[sun] || {})), s);
const req = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.state.requests[i] || null)), id);
const toastText = (page) => page.locator('.toast').allInnerTexts().then((a) => a.join(' | '));
const waitToast = async (page, re) => { await page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((e) => new RegExp(src).test(e.textContent)), re.source, { timeout: 8000 }).catch(async () => { throw new Error('toast atteso ' + re + ' ma ci sono: ' + await toastText(page)); }); };
const hashOf = (page) => page.evaluate(() => location.hash);
const sheets = (page) => page.locator('#layer .sheet').count();
const noErrors = (page) => assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load resource/.test(e)), [], 'errori in console');
/** Naviga come farebbe il tap su un'azione a app già aperta. */
const goHash = async (page, h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForFunction(() => location.hash === '#/' || location.hash === '', null, { timeout: 5000 }); };
const wait = (page, ms = 400) => page.waitForTimeout(ms);

env = await start();

await test('done: checklist completa → segnato fatto + toast Annulla, hash ripulito, annulla funziona', async () => {
  const page = await open(mk({ me: K }), '#/do/done/' + CUR + '/kitchen');
  await waitToast(page, /Segnato come fatto/);
  assert.equal((await wk(page)).result.kitchen, 'done');
  assert.equal((await wk(page)).resultBy.kitchen, K);
  assert.equal(await hashOf(page), '#/', 'hash sostituito');
  await page.click('.toast .toast-action');
  await page.waitForFunction((s) => !((window.__app.state.weeks[s] || {}).result || {}).kitchen, CUR, { timeout: 5000 });
  noErrors(page);
});

await test('done: un reload non ripete l\'azione (e rifarla a turno già segnato non duplica)', async () => {
  const page = await open(mk({ me: K }), '#/do/done/' + CUR + '/kitchen');
  await waitToast(page, /Segnato come fatto/);
  const nDone = () => page.evaluate(() => Object.values(window.__app.state.log || {}).filter((l) => l.type === 'done').length);
  assert.equal(await nDone(), 1);
  await page.click('.toast .toast-action');                                  // annulla
  await page.waitForFunction((s) => !((window.__app.state.weeks[s] || {}).result || {}).kitchen, CUR);
  await page.reload(); await page.waitForSelector('[data-screen="home"]'); await wait(page, 800);
  assert.equal((await wk(page)).result.kitchen || null, null, 'dopo il reload non è stato rimesso a fatto');
  // ora lo segno davvero; riaprire lo stesso link non scrive una seconda volta
  await page.evaluate((u) => { location.hash = u; }, '#/do/done/' + CUR + '/kitchen');
  await waitToast(page, /Segnato come fatto/);
  await page.evaluate((u) => { location.hash = u; }, '#/do/done/' + CUR + '/kitchen'); await wait(page, 800);
  await waitToast(page, /già segnato come fatto/);
  assert.equal((await page.evaluate(() => Object.values(window.__app.state.log || {}).filter((l) => l.type === 'done').length)), 2, 'solo due scritture "done" in tutto (prima e seconda esecuzione reale)');
  noErrors(page);
});

await test('done: con la checklist spuntata per intero lo segna direttamente', async () => {
  const s = mk({ me: F, weeks: { ...DONE, [CUR]: { tasksDone: { t1: { by: F, at: AT } } } } });
  const page = await open(s, '#/do/done/' + CUR + '/floor');
  await waitToast(page, /Segnato come fatto/);
  assert.equal((await wk(page)).result.floor, 'done');
  assert.equal(await sheets(page), 0);
});

await test('done: checklist incompleta → apre la scheda mansione e NON segna', async () => {
  const page = await open(mk({ me: F }), '#/do/done/' + CUR + '/floor');
  await page.waitForSelector('#layer .sheet.on', { timeout: 8000 });
  await waitToast(page, /checklist/);
  assert.match(await page.locator('#layer .sheet').last().innerText(), /aspirapolvere/);
  assert.equal(((await wk(page)).result || {}).floor || null, null, 'non segnato');
  assert.equal(await hashOf(page), '#/');
});

await test('done: mansione non mia → toast chiaro, Home, niente scritto', async () => {
  const page = await open(mk({ me: K }), '#/do/done/' + CUR + '/floor');
  await waitToast(page, /non è tuo/);
  assert.match(await toastText(page), /Pavimenti/);
  assert.equal(((await wk(page)).result || {}).floor || null, null);
  assert.equal(await sheets(page), 0);
  assert.equal(await hashOf(page), '#/');
});

await test('done: link malformati (mansione o data inesistenti)', async () => {
  const page = await open(mk({ me: K }), '#/do/done/' + CUR + '/garage');
  await waitToast(page, /Azione non valida/);
  await goHash(page, '#/do/done/2031-01-04/kitchen'); await waitToast(page, /Turno non trovato/);
  await goHash(page, '#/do/boh/x'); await waitToast(page, /Azione non valida/);
  noErrors(page);
});

await test('cover: accetta → concordato con me; richiesta accettata', async () => {
  const page = await open(withReqs({ me: K }), '#/do/accept/rCover');
  await waitToast(page, /Concordato: lo farai tu/);
  const q = await req(page, 'rCover'); assert.equal(q.status, 'accepted'); assert.equal(q.by, K);
  assert.equal((await wk(page)).agreed.floor, K);
  // seconda risposta (link ripetuto): già accettata, nessuna nuova scrittura
  await goHash(page, '#/do/accept/rCover'); await waitToast(page, /già accettato/);
  await goHash(page, '#/do/decline/rCover'); await waitToast(page, /già accettato/);
  assert.equal((await req(page, 'rCover')).status, 'accepted');
  noErrors(page);
});

await test('cover aperta a tutti: rifiuta', async () => {
  const page = await open(withReqs({ me: K }), '#/do/decline/rCoverAny');
  await waitToast(page, /Richiesta rifiutata/);
  assert.equal((await req(page, 'rCoverAny')).status, 'declined');
  assert.equal(((await wk(page)).agreed || {}).floor || null, null);
});

await test('offer: accetta e rifiuta', async () => {
  const page = await open(withReqs({ me: K }), '#/do/accept/rOffer');
  await waitToast(page, /Concordato: lo farà/);
  assert.equal((await req(page, 'rOffer')).status, 'accepted'); assert.equal((await wk(page)).agreed.kitchen, F);
  await goHash(page, '#/do/decline/rOffer2'); await waitToast(page, /Richiesta rifiutata/);
  assert.equal((await req(page, 'rOffer2')).status, 'declined');
  noErrors(page);
});

await test('scambio (senza kind): accetta applica lo scambio, rifiuta no', async () => {
  const page = await open(withReqs({ me: K }), '#/do/accept/rSwap');
  await waitToast(page, /Scambio accettato/);
  assert.equal((await req(page, 'rSwap')).status, 'accepted');
  const sw = (await wk(page)).swap || {};
  assert.ok(Object.keys(sw).length >= 2, 'swap scritto: ' + JSON.stringify(sw));
  const page2 = await open(withReqs({ me: K }), '#/do/decline/rSwap2');
  await waitToast(page2, /Rifiutato/);
  assert.equal((await req(page2, 'rSwap2')).status, 'declined');
  assert.equal(((await wk(page2)).swap) || null, null);
});

await test('richieste già risposte, inesistenti o non per me → toast chiaro, nulla cambia', async () => {
  const page = await open(withReqs({ me: K }), '#/do/accept/rDone');
  await waitToast(page, /già accettato/);
  await goHash(page, '#/do/accept/rNo'); await waitToast(page, /già stata rifiutata/);
  await goHash(page, '#/do/accept/nonEsiste'); await waitToast(page, /non trovata/);
  await goHash(page, '#/do/accept/rOther'); await waitToast(page, /non è indirizzata a te/);
  assert.equal((await req(page, 'rOther')).status, 'pending');
  assert.equal(((await wk(page)).agreed || null), null);
  noErrors(page);
});

await test('gate «chi sei»: l\'azione viene ricordata ed eseguita dopo la scelta', async () => {
  const page = await env.page({ now: NOW, seed: mk({ me: null }) });
  await page.goto(env.url + '/#/do/done/' + CUR + '/kitchen');
  await page.waitForSelector('.gate', { timeout: 8000 });
  assert.equal(((await page.evaluate((s) => JSON.parse(localStorage.getItem('cp:h:LOCALTEST001')).weeks[s], CUR)) || {}).result?.kitchen || null, null);
  await page.evaluate(() => history.replaceState(null, '', '#/'));            // l'hash non c'è più: resta solo quello ricordato
  await page.evaluate((k) => window.__app.setMe(k), K);
  await page.waitForSelector('[data-screen="home"]', { timeout: 8000 });
  await waitToast(page, /Segnato come fatto/);
  assert.equal((await wk(page)).result.kitchen, 'done');
});

await test('EN: messaggi in inglese', async () => {
  const page = await open(mk({ me: K, houseExtra: { lang: 'en' } }), '#/do/done/' + CUR + '/floor', { lang: 'en-US' });
  await waitToast(page, /isn't yours/);
});

// ---------- service worker: azioni della notifica ----------
await test('service worker: push con azioni e click sull\'azione', async () => {
  const browser = await require('playwright').chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', permissions: ['notifications'] });
    await context.addInitScript((data) => { if (!localStorage.getItem('cp:seeded')) { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('cp:seeded', '1'); } }, mk({ me: K }));
    const page = await context.newPage(); page.on('pageerror', (e) => (page.__errors ||= []).push(String(e)));
    await page.goto(env.url + '/#/stats'); await page.waitForSelector('nav.nav a');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const cached = await page.evaluate(async () => { const c = await caches.open((await caches.keys())[0]); return (await c.keys()).map((r) => new URL(r.url).pathname); });
    assert.ok(cached.includes('/js/doaction.js') && cached.includes('/js/strings/doaction.js'), 'doaction nella cache dello shell');
    await sw.evaluate(() => { self.__shown = []; self.registration.showNotification = (title, opts) => { self.__shown.push({ title, opts }); return Promise.resolve(); }; });
    const payload = { title: 'Domenica', body: 'Tocca alla cucina', url: '#/more', tag: 'a1', actions: [
      { action: 'done', title: 'Segna fatto', url: '#/do/done/' + CUR + '/kitchen' },
      { action: 'decline', title: 'Rifiuta', url: '#/trips' },
      { action: 'extra', title: 'Terza (da scartare)', url: '#/stats' }] };
    await sw.evaluate((p) => { self.dispatchEvent(new PushEvent('push', { data: new TextEncoder().encode(JSON.stringify(p)) })); }, payload);
    await sw.evaluate(() => { self.dispatchEvent(new PushEvent('push', { data: new TextEncoder().encode(JSON.stringify({ title: 'Senza', body: 'x', url: '#/trips' })) })); });
    const shown = await sw.evaluate(() => new Promise((r) => setTimeout(() => r(self.__shown), 200)));
    assert.equal(shown.length, 2);
    assert.deepEqual(shown[0].opts.actions, [{ action: 'done', title: 'Segna fatto' }, { action: 'decline', title: 'Rifiuta' }], 'max 2 azioni, solo {action,title}');
    assert.equal(shown[0].opts.data.url, '#/more');
    assert.deepEqual(shown[0].opts.data.actions, { done: '#/do/done/' + CUR + '/kitchen', decline: '#/trips' });
    assert.equal(shown[1].opts.actions, undefined, 'senza azioni nel payload non ne compaiono');
    // la pagina diventa controllata dopo un reload; il click su un'azione la porta all'url di QUELL'azione
    await page.reload(); await page.waitForSelector('nav.nav a');
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'pagina controllata dal SW');
    const click = (action, data) => sw.evaluate(([a, d]) => { const e = new ExtendableEvent('notificationclick'); Object.defineProperty(e, 'notification', { value: { close() {}, data: d } }); Object.defineProperty(e, 'action', { value: a }); self.dispatchEvent(e); }, [action, data]);
    const data = shown[0].opts.data;
    await click('decline', data); await page.waitForFunction(() => location.hash === '#/trips', null, { timeout: 5000 });
    await click('', data); await page.waitForFunction(() => location.hash === '#/more', null, { timeout: 5000 });   // corpo della notifica (iOS): url principale
    await click('sconosciuta', data); await page.waitForFunction(() => location.hash === '#/more', null, { timeout: 5000 });
    // azione «Segna fatto» vera: l'app la esegue, segna il turno e ripulisce l'hash
    await click('done', data);
    await page.waitForFunction((s) => (((JSON.parse(localStorage.getItem('cp:h:LOCALTEST001')).weeks || {})[s] || {}).result || {}).kitchen === 'done', CUR, { timeout: 8000 });
    await page.waitForFunction(() => location.hash === '#/', null, { timeout: 5000 });
    assert.deepEqual((page.__errors || []).filter((e) => !/Failed to fetch|NetworkError|Failed to load resource/.test(e)), []);
  } finally { await browser.close(); }
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} test e2e ok`);
process.exit(failed.length ? 1 : 0);
