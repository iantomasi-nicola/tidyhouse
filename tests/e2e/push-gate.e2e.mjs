// E2E dell'attivazione obbligatoria delle notifiche su mobile (gate) e del promemoria su desktop.
// Esecuzione: node tests/e2e/push-gate.e2e.mjs [filtro]. Orologio finto 2026-10-28T10:00:00. Esce con codice 1 se un test fallisce.
// Il browser di test non può registrarsi a un vero servizio push: Notification, serviceWorker e PushManager sono simulati
// con defineProperty (come fa settings.e2e.mjs per «notifiche attive»). Resta da provare su telefoni veri.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { start, seed } from './helpers.mjs';

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'tidyhouse-shots', 'push-gate') + '/';
const NOW = '2026-10-28T10:00:00';
fs.mkdirSync(SHOTS, { recursive: true });

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
const VAPID = (() => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return e.getPublicKey().toString('base64url'); })();

const env = await start();
const results = [];
const only = process.argv[2];
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  const t0 = Date.now(); let page = null;
  const pages = [];
  /**
   * Apre l'app (casa locale) con un dispositivo finto: ua, permesso iniziale, esito della richiesta, standalone (iOS).
   * Poi simula il cloud (mode/cloud) e rilancia la valutazione come al ritorno in primo piano.
   */
  const mk = async ({ ua, perm = 'default', grant = 'granted', standalone = false, houseExtra = {}, seedOpts = {}, dark = false, lang } = {}) => {
    page = await env.page({ now: NOW, dark, lang, seed: seed({ houseExtra: { requireRules: false, vapidPublic: VAPID, ...houseExtra }, ...seedOpts }) });
    pages.push(page);
    await page.context().addInitScript((c) => {
      if (c.ua) Object.defineProperty(navigator, 'userAgent', { get: () => c.ua, configurable: true });
      Object.defineProperty(navigator, 'standalone', { get: () => c.standalone, configurable: true });
      window.__perm = c.perm; window.__asked = 0; window.__sub = null; window.__grant = c.grant;
      Object.defineProperty(Notification, 'permission', { get: () => window.__perm, configurable: true });
      Notification.requestPermission = async () => { window.__asked++; window.__perm = window.__grant === 'denied' ? 'denied' : window.__grant === 'granted' ? 'granted' : 'default'; return window.__perm; };
      if (!('PushManager' in window)) window.PushManager = function PushManager() {};
      const reg = { active: {}, waiting: null, installing: null, update: async () => {}, addEventListener() {}, pushManager: {
        getSubscription: async () => window.__sub,
        subscribe: async () => { window.__sub = { endpoint: 'https://push.example/sub1', options: {}, toJSON() { return { endpoint: 'https://push.example/sub1', keys: { p256dh: 'p', auth: 'a' } }; }, unsubscribe: async () => { window.__sub = null; return true; } }; return window.__sub; },
      } };
      Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async () => reg, configurable: true }); Object.defineProperty(navigator.serviceWorker, 'register', { value: async () => reg, configurable: true });
    }, { ua, perm, grant, standalone });
    await page.goto(env.url + '/#/');
    await page.waitForSelector('.shell', { timeout: 10000 });
    await page.evaluate(() => { Object.defineProperty(window.__app, 'mode', { get: () => 'cloud', configurable: true }); Object.defineProperty(window.__app, 'cloud', { get: () => true, configurable: true }); });
    await foreground(page);
    return page;
  };
  try { await fn(mk, () => page); results.push([name, true, Date.now() - t0]); console.log('ok   ', name); }
  catch (e) { results.push([name, false, Date.now() - t0, e]); console.log('FAIL ', name, '\n', e && e.stack || e); if (page) { try { await page.screenshot({ path: SHOTS + 'FAIL-' + name.replace(/\W+/g, '_') + '.png' }); } catch { /* ignore */ } } }
  finally { for (const p of pages) { try { await p.context().close(); } catch { /* ignore */ } } }
}

const tid = (id) => `[data-testid="${id}"]`;
/** L'app torna in primo piano: stesso evento che il telefono manda dopo le impostazioni di sistema. */
const foreground = (page) => page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.__app.rerender(); });
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png', fullPage: true });
const noErrors = (page) => assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW /.test(e)), [], 'errori in console');
const member = (page) => page.evaluate(() => { const m = window.__app.state.members || {}; return JSON.parse(JSON.stringify(m[window.__app.deviceId] || null)); });
const inApp = (page) => page.waitForFunction(() => document.querySelector('.shell') && !document.querySelector('[data-testid=push-enable], [data-testid=push-recheck]'), null, { timeout: 8000 });

// ============================================================================
await test('Android: un solo tocco su «Attiva le notifiche» (permesso + iscrizione + salvataggio) e prosegue da sola', async (mk) => {
  const page = await mk({ ua: ANDROID, perm: 'default', grant: 'granted' });
  await page.waitForSelector(tid('push-enable'));
  assert.equal(await page.locator('.gate h1').innerText(), 'Attiva le notifiche');
  assert.equal(await page.locator('.shell').count(), 0, 'su mobile blocca finché non sono attive');
  assert.equal(await page.locator(tid('push-ios-steps')).count(), 0);
  await shot(page, 'gate-android-390');
  await page.click(tid('push-enable'));
  await inApp(page);
  assert.equal(await page.evaluate(() => window.__asked), 1, 'un solo permesso richiesto');
  const m = await member(page);
  assert.equal(m.push.endpoint, 'https://push.example/sub1', 'iscrizione salvata sul dispositivo');
  assert.equal(await page.evaluate(() => localStorage.getItem('cp:pushsub')), '1');
  assert.equal(await page.locator(tid('notif-reminder')).count(), 0, 'attive: nessun promemoria');
  noErrors(page);
});

await test('permesso rifiutato nella richiesta: spiega come riattivarlo in 2 passi e offre «Ricontrolla»', async (mk) => {
  const page = await mk({ ua: ANDROID, perm: 'default', grant: 'denied' });
  await page.click(tid('push-enable'));
  await page.waitForSelector(tid('push-denied-steps'));
  assert.equal(await page.locator(`${tid('push-denied-steps')} li`).count(), 2);
  assert.match(await page.locator(tid('push-denied-steps')).innerText(), /Android/);
  assert.equal(await page.locator(tid('push-enable')).count(), 0);
  assert.equal(await page.locator('.shell').count(), 0, 'resta bloccante');
  await shot(page, 'gate-denied-android-390');
  // «Ricontrolla» con il permesso ancora negato: resta qui
  await page.click(tid('push-recheck'));
  await page.waitForSelector(tid('push-denied-steps'));
  // l'utente riattiva il permesso nelle impostazioni del telefono e torna nell'app: ricontrolla da sola e completa senza altri tocchi
  await page.evaluate(() => { window.__perm = 'granted'; });
  await foreground(page);
  await inApp(page);
  assert.equal((await member(page)).push.endpoint, 'https://push.example/sub1');
  noErrors(page);
});

await test('permesso negato, poi riattivato: il tasto «Ricontrolla» completa', async (mk) => {
  const page = await mk({ ua: ANDROID, perm: 'denied' });
  await page.waitForSelector(tid('push-denied-steps'));
  await page.evaluate(() => { window.__perm = 'granted'; });
  await page.click(tid('push-recheck'));
  await inApp(page);
  noErrors(page);
});

await test('iPhone non installato: 3 passi (Condividi → Aggiungi a Home → riapri), nessun pulsante di attivazione', async (mk) => {
  const page = await mk({ ua: IPHONE, standalone: false });
  await page.waitForSelector(tid('push-ios-steps'));
  assert.equal(await page.locator(`${tid('push-ios-steps')} li`).count(), 3);
  const txt = await page.locator(tid('push-ios-steps')).innerText();
  assert.match(txt, /Condividi/); assert.match(txt, /Aggiungi a Home/); assert.match(txt, /Riapri/);
  assert.equal(await page.locator(tid('push-enable')).count(), 0);
  assert.equal(await page.locator(tid('push-safari')).count(), 0, 'in Safari nessun avviso sul browser');
  assert.equal(await page.locator('.shell').count(), 0);
  await shot(page, 'gate-ios-390');
  noErrors(page);
});

await test('iPhone con altro browser (Chrome): avviso «usa Safari»', async (mk) => {
  const page = await mk({ ua: IPHONE_CHROME, standalone: false });
  await page.waitForSelector(tid('push-safari'));
  noErrors(page);
});

await test('iPhone installato (Home): compare il grande pulsante e un tocco basta', async (mk) => {
  const page = await mk({ ua: IPHONE, standalone: true, perm: 'default', grant: 'granted' });
  await page.waitForSelector(tid('push-enable'));
  assert.equal(await page.locator(tid('push-ios-steps')).count(), 0);
  await page.click(tid('push-enable'));
  await inApp(page);
  assert.equal((await member(page)).push.endpoint, 'https://push.example/sub1');
  noErrors(page);
});

await test('permesso già concesso ma iscrizione mancante: completa da sola, senza toccare nulla', async (mk) => {
  const page = await mk({ ua: ANDROID, perm: 'granted' });
  await page.waitForFunction(() => window.__sub, null, { timeout: 8000 });
  await inApp(page);
  assert.equal((await member(page)).push.endpoint, 'https://push.example/sub1');
  noErrors(page);
});

await test('nessun obbligo senza chiavi push o con requirePush spento', async (mk) => {
  const p1 = await mk({ ua: ANDROID, houseExtra: { vapidPublic: undefined } });
  assert.ok(await p1.locator('.shell').count(), 'senza vapidPublic non scatta');
  assert.equal(await p1.locator(tid('push-enable')).count(), 0);
  const p2 = await mk({ ua: ANDROID, houseExtra: { requirePush: false } });
  assert.ok(await p2.locator('.shell').count(), 'requirePush spento: non blocca');
  assert.equal(await p2.locator(tid('push-enable')).count(), 0);
});

await test('admin può saltare, un coinquilino no', async (mk) => {
  const a = await mk({ ua: ANDROID });
  await a.waitForSelector(tid('push-enable'));
  assert.equal(await a.locator(tid('push-skip')).count(), 1);
  await a.click(tid('push-skip'));
  await a.waitForSelector('.shell');
  const b = await mk({ ua: ANDROID, seedOpts: { admin: false, me: 'bruno' } });
  await b.waitForSelector(tid('push-enable'));
  assert.equal(await b.locator(tid('push-skip')).count(), 0, 'nessuna scorciatoia per i coinquilini');
  assert.equal(await b.locator('.shell').count(), 0);
});

await test('gate in inglese e tema scuro', async (mk) => {
  const page = await mk({ ua: ANDROID, dark: true, lang: 'en-US', houseExtra: { lang: 'en' } });
  await page.waitForSelector(tid('push-enable'));
  assert.equal(await page.locator('.gate h1').innerText(), 'Turn on notifications');
  assert.match(await page.locator(tid('push-enable')).innerText(), /Turn on notifications/);
  await shot(page, 'gate-android-dark-en-390');
  const i = await mk({ ua: IPHONE, standalone: false, dark: true });
  await i.waitForSelector(tid('push-ios-steps'));
  await shot(i, 'gate-ios-dark-390');
  noErrors(page);
});

await test('desktop: non blocca; promemoria con «Attiva» a un tocco, «Più tardi» non lo toglie per sempre', async (mk) => {
  const page = await mk({ perm: 'default', grant: 'granted', houseExtra: { features: { refresh: false } } });   // UA desktop; niente avviso «aggiorna» dopo 5 minuti
  assert.ok(await page.locator('.shell').count(), 'su desktop non è bloccante');
  await page.waitForSelector(tid('notif-reminder'));
  await shot(page, 'reminder-desktop-390');
  // «Più tardi»: sparisce subito...
  await page.click(tid('notif-reminder-later'));
  await page.waitForSelector(tid('notif-reminder'), { state: 'detached' });
  // ...ma se le notifiche restano spente ricompare (dopo un po', alla prima occasione di ridisegno)
  await page.clock.fastForward(5 * 60000); await page.evaluate(() => window.__app.rerender()); await page.waitForTimeout(150);
  assert.equal(await page.locator(tid('notif-reminder')).count(), 0, 'dopo 5 minuti è ancora rimandato');
  await page.clock.fastForward(30 * 60000); await page.evaluate(() => window.__app.rerender());
  await page.waitForSelector(tid('notif-reminder'));
  // un tocco su «Attiva»: permesso + iscrizione + salvataggio, il promemoria scompare
  await page.click(tid('notif-reminder-enable'));
  await page.waitForSelector(tid('notif-reminder'), { state: 'detached' });
  assert.equal(await page.evaluate(() => window.__asked), 1);
  assert.equal((await member(page)).push.endpoint, 'https://push.example/sub1');
  noErrors(page);
});

await test('desktop con notifiche bloccate: promemoria con «Come fare»', async (mk) => {
  const page = await mk({ perm: 'denied' });
  await page.waitForSelector(tid('notif-reminder-denied'));
  assert.ok(await page.locator('.shell').count());
  await page.click(`${tid('notif-reminder-denied')} a`);
  await page.waitForSelector('.st-page[data-sub="notifications"]');
  assert.equal(await page.locator(`${tid('push-denied-steps')} li`).count(), 2);
  noErrors(page);
});

await test('mobile con requirePush spento: niente gate ma il promemoria c\'è', async (mk) => {
  const page = await mk({ ua: ANDROID, houseExtra: { requirePush: false } });
  await page.waitForSelector(tid('notif-reminder'));
  assert.equal(await page.locator(tid('push-enable')).count(), 0);
  noErrors(page);
});

// ============================================================================
await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
