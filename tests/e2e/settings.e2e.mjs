// E2E delle impostazioni (Playwright + server statico di helpers.mjs). Esecuzione: node tests/e2e/settings.e2e.mjs
// Orologio finto 2026-10-28T10:00:00. Screenshot in SHOTS (default: scratchpad). Esce con codice 1 se un test fallisce.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { start, seed } from './helpers.mjs';
import { hashPin } from '../../js/actions.js';
import { encryptBackup } from '../../js/backupcrypto.js';

const require = createRequire(import.meta.url);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'tidyhouse-shots', 'settings') + '/';
const XLSX_REAL = process.env.XLSX_FILE || '/root/.claude/uploads/31bb54fa-07b7-55b0-a8eb-c0a272017a85/1f8df62c-House_Cleaning_Plan_Magliocco.xlsx';
const NOW = '2026-10-28T10:00:00';
fs.mkdirSync(SHOTS, { recursive: true });

const env = await start();
const results = [];
const only = process.argv[2];
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  const t0 = Date.now(); let page = null;
  const ctxPages = [];
  const mk = async (opts = {}) => {
    const { houseExtra = {}, seedOpts = {}, viewport, dark, lang, hash = '/settings' } = opts;
    page = await env.page({ now: NOW, viewport, dark, lang, seed: seed({ houseExtra: { requireRules: false, ...houseExtra }, ...seedOpts }) });
    ctxPages.push(page);
    await page.goto(env.url + '/#' + hash);
    await page.waitForSelector('[data-testid=settings-index], [data-testid=settings-page]', { timeout: 10000 });
    return page;
  };
  try { await fn(mk, () => page); results.push([name, true, Date.now() - t0]); console.log('ok   ', name); }
  catch (e) { results.push([name, false, Date.now() - t0, e]); console.log('FAIL ', name, '\n', e && e.stack || e); if (page) { try { await page.screenshot({ path: SHOTS + 'FAIL-' + name.replace(/\W+/g, '_') + '.png' }); } catch { /* ignore */ } } }
  finally { for (const p of ctxPages) { try { await p.context().close(); } catch { /* ignore */ } } }
}

// ---------- helper ----------
const go = async (page, sub = '') => { await page.evaluate((h) => { location.hash = h; }, '#/settings' + (sub ? '/' + sub : '')); await page.waitForSelector(sub ? `.st-page[data-sub="${sub}"]` : '[data-testid=settings-index]'); await page.waitForTimeout(80); };
const house = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.house)));
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state)));
const commit = async (loc, v) => { await loc.fill(v); await loc.blur(); };
const noErrors = (page) => assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW /.test(e)), [], 'errori in console');
const toast = (page, re) => page.waitForFunction((s) => [...document.querySelectorAll('.toast')].some((x) => new RegExp(s).test(x.textContent)), re.source, { timeout: 4000 });
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 6000 });
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png', fullPage: true });
const tid = (id) => `[data-testid="${id}"]`;
/** Sezione richiudibile (<details>): la apre se è chiusa. */
const openFold = async (page, id) => { if (!(await page.locator(tid(id)).evaluate((d) => d.open))) await page.click(`${tid(id)} > summary`); await page.waitForFunction((s) => document.querySelector(s).open, tid(id)); };
const isOpen = (page, id) => page.locator(tid(id)).evaluate((d) => d.open);

const members = {
  devB: { personId: 'bruno', name: 'iPhone di Bruno', device: { os: 'iPhone', browser: 'Safari', kind: 'device', label: 'iPhone · Safari' }, lastSeen: '2026-10-28T08:00:00.000Z', firstSeen: '2026-10-05T09:00:00.000Z', push: { endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } }, standalone: true, version: '1.0.0', lang: 'it', isAdmin: false, rulesAck: { version: '1', at: '2026-10-05T09:00:00.000Z' } },
  devA2: { personId: 'anna', name: 'Mac di Anna', device: { os: 'Mac', browser: 'Chrome', kind: 'desktop', label: 'Mac · Chrome' }, lastSeen: '2026-10-26T10:00:00.000Z', push: null, version: '1.0.0', lang: 'en', isAdmin: true },
};
const views = Object.fromEntries(Array.from({ length: 3 }, (_, i) => ['v' + i, { at: `2026-10-28T0${6 + i}:00:00.000Z`, device: 'devB', personId: 'bruno', screen: i % 2 ? 'calendar' : 'home' }]));

// ============================================================================
await test('indice: personali + admin, non-admin vede solo personali', async (mk) => {
  const page = await mk();
  assert.equal(await page.locator('a.li[href^="#/settings/"]').count(), 15);
  await shot(page, 'index-admin-390');
  const p2 = await env.page({ now: NOW, seed: seed({ admin: false, houseExtra: { requireRules: false } }) });
  await p2.goto(env.url + '/#/settings'); await p2.waitForSelector(tid('settings-index'));
  assert.equal(await p2.locator('a.li[href^="#/settings/"]').count(), 4);
  await go(p2, 'house');
  assert.ok(await p2.locator(tid('admin-only')).isVisible());
  await go(p2, 'data'); assert.ok(await p2.locator(tid('admin-only')).isVisible());
  // invito: codice visibile, rotazione no
  await go(p2, 'invite'); assert.ok(await p2.locator(tid('invite-code')).isVisible()); assert.equal(await p2.locator(tid('rot-go')).count(), 0);
  await p2.evaluate(() => { location.hash = '#/settings'; }); await p2.waitForSelector(tid('settings-index'));
  await shot(p2, 'index-nonadmin-390'); noErrors(p2); await p2.context().close();
  noErrors(page);
});

await test('profilo: chi sei, nome dispositivo, lingua, sblocco admin', async (mk) => {
  const page = await mk({ seedOpts: { admin: false } });
  await go(page, 'profile');
  await page.click(tid('who-bruno'));
  await until(page, () => window.__app.me === 'bruno');
  await commit(page.locator(tid('device-name')), 'Il mio telefono');
  await until(page, () => window.__app.prefs.deviceName === 'Il mio telefono');
  const st = await state(page);
  assert.equal(Object.values(st.members).find((m) => m.personId === 'bruno').name, 'Il mio telefono');
  await page.click(`${tid('seg-lang')} button:has-text("English")`);
  await until(page, () => document.documentElement.lang === 'en' && window.__app.prefs.lang === 'en');
  await page.waitForFunction(() => /Profile/.test(document.querySelector('.st-title').textContent));
  await shot(page, 'profile-en-390');
  // PIN errato / giusto
  await page.fill(tid('admin-pin'), '0000'); await page.click(tid('admin-unlock')); await toast(page, /PIN/i);
  assert.equal(await page.evaluate(() => window.__app.isAdmin), false);
  noErrors(page);
});

await test('aspetto: tema, accento, colore personalizzato, testo, switch', async (mk) => {
  const page = await mk(); await go(page, 'appearance');
  await page.click(`${tid('seg-theme')} button:has-text("Scuro")`);
  await until(page, () => document.documentElement.getAttribute('data-theme') === 'dark');
  await shot(page, 'appearance-dark-390');
  await page.click(`${tid('seg-theme')} button:has-text("Chiaro")`);
  await until(page, () => document.documentElement.getAttribute('data-theme') === 'light');
  await page.click(tid('accent-00796b'));
  await until(page, () => document.documentElement.style.getPropertyValue('--accent') === '#00796b');
  await page.locator(tid('accent-custom')).fill('#123456');
  await until(page, () => document.documentElement.style.getPropertyValue('--accent') === '#123456');
  await page.locator(tid('text-size')).evaluate((el) => { el.value = '1.15'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(page, () => document.documentElement.style.getPropertyValue('--fs') === '1.15');
  await page.click(tid('sw-motion-row')); await until(page, () => document.documentElement.classList.contains('no-motion'));
  await page.click(tid('sw-compact-row')); await until(page, () => document.documentElement.classList.contains('compact'));
  await page.click(tid('sw-haptics-row')); await until(page, () => window.__app.prefs.haptics === false);
  await page.click(`${tid('seg-theme')} button:has-text("Automatico")`);
  await until(page, () => !document.documentElement.hasAttribute('data-theme'));
  noErrors(page);
});

await test('layout Home: ordine, nascondi, reset, layout della casa', async (mk) => {
  const page = await mk(); await go(page, 'home');
  assert.deepEqual((await page.evaluate(() => window.__app.homeLayout())).order.slice(0, 2), ['hero', 'alerts']);
  assert.equal(await page.locator(tid('w-up-hero')).isDisabled(), true); // layout della casa: sola lettura
  await page.click(tid('sw-use-house-row'));
  await until(page, () => window.__app.prefs.useHouseHome === false);
  await page.click(tid('w-down-hero'));
  await until(page, () => window.__app.homeLayout().order[1] === 'hero');
  await page.click(tid('wrow-alerts') + ' .switch');
  await until(page, () => window.__app.homeLayout().hidden.includes('alerts'));
  await page.click(tid('wrow-needs') + ' .switch');
  await until(page, () => !window.__app.homeLayout().hidden.includes('needs'));
  const lay = await page.evaluate(() => window.__app.homeLayout());
  assert.equal(lay.order[0], 'alerts'); assert.equal(lay.order[1], 'hero');
  await shot(page, 'home-editor-390');
  await page.click(tid('home-set-house'));
  await until(page, () => window.__app.house.home && window.__app.house.home.order[1] === 'hero');
  assert.ok((await house(page)).home.hidden.includes('alerts'));
  await page.click(tid('home-reset'));
  await until(page, () => window.__app.prefs.useHouseHome === true && !window.__app.prefs.home);
  assert.equal((await page.evaluate(() => window.__app.homeLayout())).order[1], 'hero'); // ora segue il layout della casa
  noErrors(page);
});

await test('notifiche personali: stato, tipi, prefs sul member', async (mk) => {
  const page = await mk({ houseExtra: { notif: { needs: { on: false } } } }); await go(page, 'notifications');
  assert.equal(await page.locator(tid('push-state')).getAttribute('data-state'), 'nocloud');
  // cinque righe (non dieci); l'admin vede anche il riepilogo
  assert.equal(await page.locator('input[data-testid^="nt-group-"]').count(), 5);
  assert.equal(await page.locator('input[data-testid^="nt-group-"]:checked').count(), 5);
  await page.click(tid('nt-group-shifts-row'));
  await until(page, () => ['satDuty', 'sunMark', 'late', 'planDay', 'monNew'].every((k) => window.__app.prefs.notif && window.__app.prefs.notif[k] === false));
  const st = await state(page);
  const pr = Object.values(st.members).find((m) => m.personId === 'anna').prefs;
  for (const k of ['satDuty', 'sunMark', 'late', 'planDay', 'monNew']) assert.equal(pr[k], false, k);
  assert.equal(pr.friAbsence, undefined, 'gli altri gruppi non cambiano');
  assert.equal(await page.locator(tid('nt-group-shifts')).isChecked(), false);
  // il gruppo è acceso se nessuna chiave è spenta: una sola chiave spenta lo spegne, e riaccendendo le riaccende tutte
  await page.click(tid('nt-group-shifts-row'));
  await until(page, () => ['satDuty', 'late', 'monNew'].every((k) => window.__app.prefs.notif[k] === true));
  await page.click(tid('nt-group-requests-row'));
  await until(page, () => window.__app.prefs.notif.requests === false && window.__app.prefs.notif.nudges === false);
  await page.evaluate(() => { window.__app.savePrefs({ notif: { ...window.__app.prefs.notif, requests: true } }); });   // nudges resta false
  await page.waitForFunction(() => !document.querySelector('[data-testid="nt-group-requests"]').checked);
  assert.match(await page.locator(tid('nt-group-needs-row')).innerText(), /spenta dall'admin/);
  assert.ok(await page.locator(tid('nt-group-admin')).count()); // admin vede anche il riepilogo
  assert.equal(await page.locator(tid('nt-satDuty')).count(), 0, 'niente più interruttori per tipo');
  await shot(page, 'notifications-390');
  // funzioni di push (contesto finto)
  const r = await page.evaluate(async () => {
    const push = await import('/js/push.js');
    const base = { deviceId: 'd', state: { members: {} }, house: { vapidPublic: 'abc' }, mode: 'cloud' };
    const out = {};
    out.nopush = push.status({ ...base, house: {} }).state; out.local = push.status({ ...base, mode: 'local' }).state;
    out.lt = await push.localTest(base); out.denied = push.status(base).state;
    const ua = navigator.userAgent; Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true });
    out.ios = push.status(base).state; Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    const k = await push.generateVapid(); out.k = k;
    return out;
  });
  await page.context().grantPermissions(['notifications'], { origin: env.url });
  r.off = await page.evaluate(async () => (await import('/js/push.js')).status({ deviceId: 'd', state: { members: {} }, house: { vapidPublic: 'abc' }, mode: 'cloud' }).state);
  assert.equal(r.denied, 'denied');
  assert.equal(r.nopush, 'nopush'); assert.equal(r.local, 'nocloud'); assert.ok(['off', 'denied'].includes(r.off)); assert.equal(r.ios, 'ios-install');
  assert.equal(Buffer.from(r.k.publicKey, 'base64url').length, 65); assert.equal(Buffer.from(r.k.privateKey, 'base64url').length, 32);
  assert.equal(r.lt.ok, false);
  noErrors(page);
});

await test('casa: nome, fuso, regole richieste, lingua', async (mk) => {
  const page = await mk(); await go(page, 'house');
  await commit(page.locator(tid('house-name')), 'Casa Nuova');
  await until(page, () => window.__app.house.name === 'Casa Nuova');
  await page.selectOption(tid('house-tz'), 'America/New_York');
  await until(page, () => window.__app.house.tz === 'America/New_York');
  await page.click(tid('sw-requireRules-row'));
  await until(page, () => window.__app.house.requireRules === true);
  await page.click(`${tid('house-lang')} button:has-text("English")`);
  await until(page, () => window.__app.house.lang === 'en');
  assert.ok(await page.locator(tid('start-sunday')).isVisible());
  assert.equal((await house(page)).startSunday, '2026-10-04');
  await shot(page, 'house-390'); noErrors(page);
});

await test('regole: stepper, sforzo, rankBy', async (mk) => {
  const page = await mk(); await go(page, 'rules');
  await page.click(`${tid('step-grace')} button[aria-label="+"]`); await until(page, () => window.__app.house.settings.grace === 2);
  await page.click(`${tid('step-minNights')} button[aria-label="−"]`); await until(page, () => window.__app.house.settings.minNights === 2);
  // i valori rari stanno in «Avanzate» (chiusa di default)
  assert.equal(await isOpen(page, 'fold-rules-adv'), false);
  await openFold(page, 'fold-rules-adv');
  await page.click(`${tid('step-window')} button[aria-label="+"]`); await until(page, () => window.__app.house.settings.window === 56);
  await page.click(`${tid('effort-floor')} .seg button:has-text("3")`); await until(page, () => window.__app.house.effort.floor === 3);
  await page.click(`${tid('effort-kitchen')} .seg button:has-text("5")`); await until(page, () => window.__app.house.effort.kitchen === 5);
  await page.click(`${tid('seg-rankBy')} button:has-text("Punti fatica")`); await until(page, () => window.__app.house.settings.rankBy === 'effort');
  assert.equal(await page.evaluate(() => window.__app.calc.out.settings.minNights), 2);
  await shot(page, 'rules-390'); noErrors(page);
});

await test('coinquilini: bozza, avvisi, uscita, sostituzione, ricalcolo', async (mk) => {
  const page = await mk(); await go(page, 'roommates');
  const before = (await house(page)).roommates.map((r) => r.id);
  assert.equal(await page.locator(tid('rm-bar')).isHidden(), true);
  // avviso posto doppio
  await page.click(`${tid('rm-card-0')} .seg button:has-text("2")`);
  assert.match(await page.locator(tid('rm-warn')).innerText(), /stesso posto/);
  await page.click(tid('rm-cancel')); await page.waitForSelector(`${tid('rm-card-0')} .seg button[aria-pressed="true"]:has-text("1")`);
  // date: Carla parte
  await page.fill(tid('rm-from-2'), '2026-11-02'); await page.fill(tid('rm-to-0'), '2026-12-31');
  await page.click(tid('rm-save'));
  await until(page, () => window.__app.house.roommates[2].from === '2026-11-02' && window.__app.house.roommates[0].to === '2026-12-31');
  assert.deepEqual((await house(page)).roommates.map((r) => r.id), before);
  // uscita di Bruno
  await page.click(tid('rm-out-1')); await page.fill(tid('out-date'), '2026-10-28'); await page.click(tid('out-confirm'));
  await until(page, () => window.__app.house.roommates[1].to === '2026-10-28');
  await page.waitForSelector(tid('rm-rotate-hint'));
  await shot(page, 'roommates-after-exit-390');
  // sostituzione di Anna con Dario dal 2026-11-30 (Anna: to 2026-11-29)
  await page.click(tid('rm-replace-0')); await page.fill(tid('rep-name'), 'Dario'); await page.fill(tid('rep-date'), '2026-11-29'); await page.click(tid('rep-confirm'));
  await until(page, () => window.__app.house.roommates.length === 4);
  const rm = (await house(page)).roommates;
  assert.deepEqual(rm.slice(0, 3).map((r) => r.id), before);
  assert.equal(rm[0].to, '2026-11-29'); assert.deepEqual([rm[3].name, rm[3].slot, rm[3].from, rm[3].to], ['Dario', 1, '2026-11-30', null]);
  assert.ok(rm[3].id && !before.includes(rm[3].id));
  const calc = await page.evaluate((id) => { const o = window.__app.calc.out; return { future: o.rows.filter((r) => r.nm.includes(id)).length, rows: o.rows.length }; }, rm[3].id);
  assert.ok(calc.future >= 0 && calc.rows > 0);
  // nuova persona + nome vuoto non salvato
  await page.click(tid('rm-add')); assert.ok(await page.locator(tid('rm-card-4')).isVisible());
  await page.fill(tid('rm-name-4'), 'Elena'); await page.click(`${tid('rm-card-4')} .seg button:has-text("2")`);
  await page.click(tid('rm-save')); await until(page, () => window.__app.house.roommates.length === 5);
  await go(page, 'roommates'); await shot(page, 'roommates-390'); noErrors(page);
});

await test('coinquilini: uscita non nota, prevista (indicativa) e certa', async (mk) => {
  const page = await mk({ houseExtra: { roommates: [
    { id: 'anna', name: 'Anna', slot: 1, from: null, to: null },
    { id: 'bruno', name: 'Bruno', slot: 2, from: null, to: null, expectedTo: '2026-11-10' },
    { id: 'carla', name: 'Carla', slot: 3, from: null, to: '2026-12-20' }] } });
  await go(page, 'roommates');
  assert.match(await page.locator(tid('rm-chips-0')).innerText(), /Uscita non nota/);
  assert.doesNotMatch(await page.locator(tid('rm-chips-0')).innerText(), /prevista/);
  assert.match(await page.locator(tid('rm-chips-1')).innerText(), /uscita prevista il 10 nov/);
  assert.match(await page.locator(tid('rm-chips-2')).innerText(), /esce il 20 dic/);
  assert.equal(await page.locator(tid('rm-expected-2')).count(), 0, 'con uscita certa non c\'è il campo indicativo');
  assert.match(await page.locator(tid('rm-expected-hint')).innerText(), /Bruno/);
  assert.equal(await page.locator(tid('rm-bar')).isHidden(), true, 'uscita non nota non è un errore né una modifica');
  assert.equal(await page.locator(tid('rm-warn')).innerText(), '');
  await shot(page, 'roommates-expected-390');
  // l'uscita prevista non cambia i turni
  const plan = () => page.evaluate(() => JSON.stringify(window.__app.calc.out.rows.map((r) => r.assigned)));
  const p0 = await plan();
  await page.fill(tid('rm-expected-0'), '2026-12-01'); await page.click(tid('rm-save'));
  await until(page, () => window.__app.house.roommates[0].expectedTo === '2026-12-01');
  assert.equal(await plan(), p0);
  // conferma uscita di Bruno: to certa, expectedTo svuotata
  await page.click(tid('rm-out-1'));
  assert.equal(await page.locator(tid('out-date')).inputValue(), '2026-11-10');
  await page.fill(tid('out-date'), '2026-11-12'); await page.click(tid('out-confirm'));
  await until(page, () => window.__app.house.roommates[1].to === '2026-11-12');
  const rm = (await house(page)).roommates;
  assert.ok(!('expectedTo' in rm[1]) || !rm[1].expectedTo); assert.equal(rm[0].expectedTo, '2026-12-01');
  assert.deepEqual(rm.map((r) => r.id), ['anna', 'bruno', 'carla']);
  // se si imposta "fino al" l'indicativa sparisce e non viene conservata
  await page.waitForTimeout(400);
  await page.fill(tid('rm-to-0'), '2026-12-05'); assert.equal(await page.locator(tid('rm-expected-0')).count(), 0);
  await page.click(tid('rm-save')); await until(page, () => window.__app.house.roommates[0].to === '2026-12-05');
  assert.ok(!(await house(page)).roommates[0].expectedTo);
  noErrors(page);
});

await test('funzioni: spegnere una funzione la toglie dalla navigazione', async (mk) => {
  const page = await mk(); await go(page, 'features');
  assert.ok(await page.locator('.nav a[href="#/trips"]').count());
  await page.click(tid('feat-trips-row'));
  await until(page, () => window.__app.feature('trips') === false);
  await until(page, () => !document.querySelector('.nav a[href="#/trips"]'));
  await page.click(tid('feat-needs-row')); await until(page, () => window.__app.house.features.needs === false);
  await page.click(tid('feat-selfDone-row')); await until(page, () => window.__app.house.features.selfDone === false);
  await shot(page, 'features-390'); noErrors(page);
});

await test('link: Tricount, WhatsApp, personalizzati, validazione https', async (mk) => {
  const page = await mk(); await go(page, 'links');
  await commit(page.locator(tid('link-tricount')), 'tricount.com/xyz');
  await until(page, () => window.__app.house.links.tricount.url === 'https://tricount.com/xyz');
  await commit(page.locator(tid('link-tricount')), 'ftp://x.y');
  await toast(page, /https/);
  assert.equal((await house(page)).links.tricount.url, 'https://tricount.com/xyz');
  await page.click(tid('link-show-tricount-row')); await until(page, () => window.__app.house.links.tricount.show === false);
  await commit(page.locator(tid('link-whatsapp')), 'https://chat.whatsapp.com/abc');
  await page.click(tid('link-show-whatsapp-row')); await until(page, () => window.__app.house.links.whatsapp.show === true);
  await page.click(tid('link-add')); await page.fill(tid('add-label'), 'Wi-Fi'); await page.fill(tid('add-url'), 'router.local'); await page.click(tid('add-confirm'));
  await until(page, () => window.__app.house.links.custom.length === 1);
  assert.equal((await house(page)).links.custom[0].url, 'https://router.local');
  await commit(page.locator(tid('custom-label-0')), 'Router'); await until(page, () => window.__app.house.links.custom[0].label === 'Router');
  await shot(page, 'links-390');
  await page.click(tid('custom-del-0')); await until(page, () => window.__app.house.links.custom.length === 0);
  noErrors(page);
});

await test('notifiche attive: diagnosi registrazione sul server e prove sempre disponibili', async (mk) => {
  const page = await mk({ houseExtra: { vapidPublic: 'BAAA', serverRun: '2026-10-28T09:30:00.000Z' } });
  // «attive» solo sul browser (permesso + sottoscrizione ricordata), cloud simulato, nessun push salvato sul server: il caso «attive ma non arrivano»
  await page.evaluate(() => { localStorage.setItem('cp:pushsub', '1'); Object.defineProperty(window.__app, 'mode', { get: () => 'cloud', configurable: true }); Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }); });
  await go(page, 'notifications');
  assert.equal(await page.locator(tid('push-state')).getAttribute('data-state'), 'on');
  // dispositivo «attivo» ma non registrato sul server: «Diagnostica e prove» si apre da sola
  assert.equal(await isOpen(page, 'nt-diag'), true);
  assert.ok(await page.locator(tid('push-test')).isVisible()); assert.ok(await page.locator(tid('push-test-server')).isVisible());
  assert.ok(await page.locator(tid('push-disable')).isVisible());
  assert.ok(await page.locator(tid('test-all')).isVisible(), 'l\'admin ha la prova a tutti dentro la diagnostica');
  assert.equal(await page.locator(tid('diag-saved')).getAttribute('data-ok'), '0');
  assert.equal(await page.locator(tid('diag-server')).getAttribute('data-ok'), '1');
  assert.ok(await page.locator(tid('push-repair')).isVisible());
  // richiesta di prova dal server: compare «in attesa»
  await page.click(tid('push-test-server'));
  await until(page, () => Object.values(window.__app.state.requests).some((r) => r.kind === 'test'));
  await page.waitForSelector(tid('diag-pending'));
  await shot(page, 'notifications-diag-390'); noErrors(page);
});

await test('notifiche attive e registrate: diagnostica chiusa, si apre a mano e resta aperta', async (mk) => {
  const page = await mk({ houseExtra: { vapidPublic: 'BAAA', serverRun: '2026-10-28T09:30:00.000Z' } });
  await page.evaluate(() => { localStorage.setItem('cp:pushsub', '1'); Object.defineProperty(window.__app, 'mode', { get: () => 'cloud', configurable: true }); Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }); });
  // l'avvio azzera i push salvati finché non sono «attivi»: il dispositivo si registra ora, come dopo «Attiva»
  await page.evaluate(() => window.__app.actions.touchMember({ push: { endpoint: 'https://push.example/dev1', keys: { p256dh: 'a', auth: 'b' } } }));
  await go(page, 'notifications');
  assert.equal(await page.locator(tid('push-state')).getAttribute('data-state'), 'on');
  assert.equal(await isOpen(page, 'nt-diag'), false, 'tutto ok: chiusa');
  assert.equal(await page.locator(tid('push-test')).isVisible(), false);
  assert.equal(await page.locator(tid('push-state')).isVisible(), true, 'lo stato resta in vista');
  await openFold(page, 'nt-diag');
  assert.equal(await page.locator(tid('diag-saved')).getAttribute('data-ok'), '1');
  assert.ok(await page.locator(tid('push-test')).isVisible());
  // un rerender (es. cambio di una preferenza) non richiude la sezione aperta dall'utente
  await page.click(tid('nt-group-needs-row'));
  await until(page, () => window.__app.prefs.notif && window.__app.prefs.notif.needs === false);
  await page.waitForTimeout(150);
  assert.equal(await isOpen(page, 'nt-diag'), true);
  // non-admin: nessun riepilogo admin
  assert.equal(await page.locator(tid('nt-group-admin')).count(), 1);
  const p2 = await mk({ seedOpts: { admin: false, me: 'bruno' }, hash: '/settings/notifications' });
  assert.equal(await p2.locator(tid('nt-group-admin')).count(), 0, 'il riepilogo admin è solo per l\'admin');
  noErrors(page);
});

await test('admin: prova di notifica a tutti (una richiesta per persona con push)', async (mk) => {
  const page = await mk({ seedOpts: { members: { ...members } } }); await go(page, 'notif-house');
  assert.match(await page.locator(`${tid('test-all')} .st-foot`).innerText(), /1 person/);
  await page.click(tid('push-test-all'));
  await until(page, () => Object.values(window.__app.state.requests).filter((r) => r.kind === 'test').length === 1);
  const q = Object.values((await state(page)).requests).find((r) => r.kind === 'test');
  assert.equal(q.to, 'bruno'); assert.ok(!q.device, 'a tutti i suoi dispositivi'); await toast(page, /1 persone|1 people|per 1/i);
  // non-admin: nessun pulsante
  const p2 = await mk({ seedOpts: { admin: false, me: 'bruno' }, hash: '/settings/notifications' });
  assert.equal(await p2.locator(tid('push-test-all')).count(), 0);
  noErrors(page);
});

await test('notifiche immediate: token, prova e avvio dopo una voce della spesa', async (mk) => {
  const page = await mk({ houseExtra: { kick: null } });
  const calls = [];
  await page.route('https://api.github.com/**', (route) => { calls.push({ url: route.request().url(), auth: route.request().headers()['authorization'], body: route.request().postData() }); route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' }); });
  await page.evaluate(() => { window.__app.house.id; });
  await go(page, 'notif-house');
  assert.equal(await isOpen(page, 'fold-kick'), false, 'notifiche immediate: richiudibile e chiusa di default');
  await openFold(page, 'fold-kick');
  assert.equal(await page.locator(tid('kick-state')).getAttribute('data-on'), '0');
  await page.fill(tid('kick-token'), 'github_pat_TEST'); await page.click(tid('kick-save'));
  await until(page, () => window.__app.house.kick && window.__app.house.kick.token === 'github_pat_TEST');
  // il repository viene dedotto solo da GitHub Pages: in locale lo impostiamo nella casa
  await page.evaluate(() => window.__app.actions.setHouse({ kick: { token: 'github_pat_TEST', repo: 'o/r' } }));
  await until(page, () => window.__app.house.kick.repo === 'o/r');
  await page.waitForSelector(`${tid('kick-state')}[data-on="1"]`);
  await page.click(tid('kick-test'));
  await page.waitForFunction(() => /Fatto/.test(document.querySelector('[data-testid=kick-status]').textContent));
  assert.equal(calls.length, 1); assert.match(calls[0].url, /repos\/o\/r\/actions\/workflows\/notify\.yml\/dispatches$/); assert.equal(calls[0].auth, 'Bearer github_pat_TEST'); assert.deepEqual(JSON.parse(calls[0].body), { ref: 'main' });
  // una voce della spesa avvia il server dopo qualche secondo (e una sola volta anche con più voci)
  await page.evaluate(async () => { await window.__app.actions.addNeed('Latte'); await window.__app.actions.addNeed('Pane'); });
  await page.waitForTimeout(7500);
  assert.equal(calls.length, 2, 'un solo avvio per due voci ravvicinate');
  await shot(page, 'kick-390'); noErrors(page);
});

await test('programma notifiche: salva, anteprima, chiavi VAPID', async (mk) => {
  const page = await mk({ viewport: { width: 390, height: 844 } }); await go(page, 'notif-house');
  await page.selectOption(tid('dow-satDuty'), '5'); await until(page, () => window.__app.house.notif.satDuty.dow === 5);
  await page.fill(tid('time-satDuty'), '11:30'); await until(page, () => window.__app.house.notif.satDuty.time === '11:30');
  await page.click(tid('ncard-monNew') + ' .switch'); await until(page, () => window.__app.house.notif.monNew.on === true);
  // i valori di partenza dei solleciti sono quelli di DEFAULT_NOTIF (2 orari, massimo 2): si controlla «uno in più»
  const late0 = (await house(page)).notif.late || {}; const n0 = (late0.times || []).length || 2, m0 = late0.max || 2;
  await page.click(tid('late-add')); await until(page, (n) => window.__app.house.notif.late.times.length === n, n0 + 1);
  await page.waitForTimeout(400);   // l'app ignora un secondo tocco ravvicinato sui pulsanti d'azione
  await page.click(`${tid('step-late-max')} button[aria-label="+"]`); await until(page, (m) => window.__app.house.notif.late.max === m, m0 + 1);
  await page.click(`${tid('step-catchUp')} button[aria-label="+"]`); await until(page, () => window.__app.house.notif.catchUpHours === 6);
  // in vista: master e card dei tipi; anteprima, chiavi, notifiche immediate e server sono sezioni richiudibili
  assert.ok(await page.locator(tid('sw-notif-master')).isVisible()); assert.ok(await page.locator(tid('ncard-satDuty')).isVisible());
  for (const f of ['fold-preview', 'fold-kick', 'fold-server']) assert.equal(await isOpen(page, f), false, f + ' chiusa');
  assert.equal(await isOpen(page, 'fold-keys'), true, 'senza chiavi la sezione si apre da sola');
  assert.equal(await page.locator(tid('preview')).isVisible(), false);
  await openFold(page, 'fold-preview');
  assert.ok(await page.locator(`${tid('preview')} .li`).count() > 0);
  assert.match(await page.locator(tid('preview')).innerText(), /Sabato|ven|Venerdì/i);
  await page.click(tid('sw-notif-master-row')); await until(page, () => window.__app.house.notif.enabled === false);
  await page.waitForSelector(tid('preview-empty'));
  await page.click(tid('sw-notif-master-row')); await until(page, () => window.__app.house.notif.enabled === true);
  // chiavi
  assert.match(await page.locator(tid('vapid-state')).innerText(), /non ancora/);
  await page.click(tid('vapid-generate'));
  await page.waitForSelector(tid('vapid-fresh'));
  const pub = await page.locator(tid('vapid-public')).innerText(), priv = await page.locator(tid('vapid-private')).innerText();
  assert.equal(Buffer.from(pub, 'base64url').length, 65); assert.equal(Buffer.from(priv, 'base64url').length, 32);
  assert.match(pub, /^[A-Za-z0-9_-]+$/); assert.match(priv, /^[A-Za-z0-9_-]+$/);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
  assert.equal(ecdh.getPublicKey().toString('base64url'), pub, 'la privata deriva la pubblica (compatibile con web-push)');
  assert.equal((await house(page)).vapidPublic, pub);
  await shot(page, 'notif-house-keys-390');
  await page.click(tid('vapid-hide')); await page.waitForSelector(tid('vapid-fresh'), { state: 'detached' });
  assert.equal(await isOpen(page, 'fold-preview'), true, 'le sezioni aperte restano aperte dopo i salvataggi');
  await openFold(page, 'fold-server');
  assert.equal(await page.locator(tid('server-run')).innerText(), 'Il server delle notifiche non si è ancora attivato');
  assert.equal(await page.locator(tid('readme-link')).getAttribute('href'), 'https://github.com/iantomasi-nicola/tidyhouse#readme');
  noErrors(page);
});

await test('chiave pubblica esistente: valida, avviso, salva (stesso server per due case)', async (mk) => {
  const page = await mk({ viewport: { width: 390, height: 844 } }); await go(page, 'notif-house');
  assert.equal(await page.locator(tid('vapid-gen-have')).count(), 0, 'nessun avviso senza chiave');
  const good = crypto.createECDH('prime256v1'); good.generateKeys();
  const pub = good.getPublicKey().toString('base64url'); assert.equal(pub.length, 87);
  // non valide: troppo corta, caratteri sbagliati, 87 caratteri ma non una chiave non compressa
  for (const bad of ['abc', pub.slice(0, 86) + '!', 'A'.repeat(87)]) {
    await page.waitForTimeout(400);   // lascia passare i ridisegni dovuti ai salvataggi in background
    await page.evaluate(() => { document.querySelector('[data-testid=vapid-existing-err]').textContent = ''; });
    await page.fill(tid('vapid-existing'), bad); await page.click(tid('vapid-existing-save'));
    await page.waitForFunction(() => document.querySelector('[data-testid=vapid-existing-err]').textContent.length > 0, null, { timeout: 5000 });
    assert.equal((await house(page)).vapidPublic, undefined, 'non salvata: ' + bad);
  }
  await page.fill(tid('vapid-existing'), '  ' + pub + '  '); await page.click(tid('vapid-existing-save'));
  await until(page, (p) => window.__app.house.vapidPublic === p, pub);
  await page.waitForFunction(() => /configurate/i.test((document.querySelector('[data-testid=vapid-state]') || {}).textContent || ''));
  await page.waitForFunction((p) => (document.querySelector('[data-testid=vapid-public]') || {}).textContent === p, pub);
  assert.equal(await page.locator(tid('vapid-fresh')).count(), 0, 'nessuna chiave privata mostrata');
  // ora la casa ha una chiave: avviso accanto a «Genera chiavi» e conferma prima di sostituirla
  assert.ok(await page.locator(tid('vapid-gen-have')).isVisible());
  const other = crypto.createECDH('prime256v1'); other.generateKeys(); const pub2 = other.getPublicKey().toString('base64url');
  await page.fill(tid('vapid-existing'), pub2); await page.click(tid('vapid-existing-save'));
  await page.waitForSelector('.sheet .btn.danger');
  assert.equal((await house(page)).vapidPublic, pub, 'in attesa di conferma');
  await shot(page, 'notif-house-usekey-390');
  await page.click('.sheet .btn.danger');
  await until(page, (p) => window.__app.house.vapidPublic === p, pub2);
  noErrors(page);
});

await test('invito: codice, link, QR; rotazione codice in locale', async (mk) => {
  const page = await mk({ seedOpts: { members: { ...members } }, houseExtra: { roommates: [{ id: 'anna', name: 'Anna', slot: 1, from: null, to: null }, { id: 'bruno', name: 'Bruno', slot: 2, from: null, to: '2026-10-20' }, { id: 'carla', name: 'Carla', slot: 3, from: null, to: null }] } });
  await go(page, 'invite');
  const oldId = await page.evaluate(() => window.__app.houseId);
  assert.equal(await page.locator(tid('invite-code')).innerText(), await page.evaluate(() => window.__app.code()));
  assert.equal(await page.locator(tid('invite-link')).innerText(), await page.evaluate(() => window.__app.joinLink()));
  assert.ok(await page.locator(`${tid('invite-qr')} svg`).count()); assert.ok(await page.locator(tid('invite-local')).isVisible());
  assert.match(await page.locator(tid('invite-wa')).getAttribute('href'), /^https:\/\/wa\.me\/\?text=/);
  // Bruno è preselezionato (uscito)
  assert.equal(await page.locator(tid('rot-bruno')).isChecked(), true); assert.equal(await page.locator(tid('rot-carla')).isChecked(), false);
  const before = await state(page);
  await page.click(tid('rot-go'));
  await page.click('.sheet button:has-text("Genera nuovo codice")');
  await until(page, (o) => window.__app.houseId !== o, oldId);
  await page.waitForSelector(tid('rot-result'));
  const newId = await page.evaluate(() => window.__app.houseId);
  const reg = await page.evaluate(() => JSON.parse(localStorage.getItem('cp:houses')));
  assert.ok(reg.some((e) => e.id === newId) && !reg.some((e) => e.id === oldId));
  assert.equal(await page.evaluate((o) => localStorage.getItem('cp:h:' + o), oldId), null);
  const after = await state(page);
  assert.deepEqual(Object.keys(after.weeks), Object.keys(before.weeks)); assert.deepEqual(after.house.roommates, before.house.roommates);
  assert.ok(after.house.prevIds.includes(oldId)); assert.ok(after.house.rotatedAt);
  assert.ok(!Object.values(after.members).some((m) => m.personId === 'bruno'), 'le notifiche di Bruno sono state rimosse');
  assert.ok(Object.values(after.members).some((m) => m.personId === 'anna'));
  assert.equal(await page.evaluate(() => window.__app.isAdmin), true); assert.equal(await page.evaluate(() => window.__app.me), 'anna');
  assert.equal(await page.locator(tid('rot-new-code')).innerText(), await page.evaluate(() => window.__app.code()));
  assert.match(await page.locator(tid('rot-wa')).getAttribute('href'), /wa\.me/);
  await shot(page, 'invite-rotated-390'); noErrors(page);
});

await test('accessi: dispositivi, sollecita, rimuovi, registro', async (mk) => {
  const page = await mk({ seedOpts: { members: { ...members } }, hash: '/settings' });
  await page.evaluate((v) => { for (const [id, x] of Object.entries(v)) window.__app.store.setDoc('views', id, x); }, views);
  await go(page, 'access');
  assert.ok(await page.locator(tid('dev-devB')).isVisible());
  assert.match(await page.locator(tid('dev-devB')).innerText(), /iPhone/); assert.match(await page.locator(tid('dev-devB')).innerText(), /Attive/);
  assert.match(await page.locator(tid('dev-devA2')).innerText(), /Non attive/);
  assert.match(await page.locator(tid('dev-devB')).innerText(), /ore fa|ora/);
  assert.ok(await page.locator(tid('acc-carla')).evaluate((e) => e.classList.contains('never')));
  assert.equal(await page.locator(tid('kpi-push')).innerText(), '1');
  assert.ok(await page.locator(`${tid('views')} .li`).count() >= 3);
  await shot(page, 'access-390');
  await page.click(tid('nudge-carla'));
  await until(page, () => Object.values(window.__app.state.requests).some((r) => r.kind === 'nudge' && r.to === 'carla'));
  await page.click(tid('dev-del-devB')); await page.click('.sheet button:has-text("Rimuovi dispositivo")');
  await until(page, () => !window.__app.state.members.devB);
  await page.click(tid('views-clear')); await page.click('.sheet button:has-text("Cancella registro")');
  await until(page, () => Object.keys(window.__app.state.views).length === 0);
  await page.waitForSelector(tid('views-empty')); noErrors(page);
});

await test('dati: export JSON/CSV/XLSX, import JSON, cifrato, Excel reale', async (mk) => {
  const page = await mk({ seedOpts: { weeks: { '2026-10-11': { result: { floor: 'done' } } } } });
  await go(page, 'data');
  const dl = async (text) => { const [d] = await Promise.all([page.waitForEvent('download'), page.getByText(text, { exact: true }).click()]); return { name: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) }; };
  const j = await dl('Backup completo (JSON)'); assert.match(j.name, /\.json$/);
  const bk = JSON.parse(j.buf.toString()); assert.equal(bk.app, 'casa-pulita'); assert.equal(bk.data.house.name, 'Casa Test');
  const c = await dl('Storico turni (CSV)'); assert.match(c.name, /\.csv$/); assert.ok(c.buf.toString().includes('week_ending'));
  const x = await dl('Foglio Excel'); assert.equal(x.buf.slice(0, 2).toString(), 'PK');
  // import JSON
  bk.data.house.name = 'Casa Importata'; bk.data.weeks['2026-10-18'] = { result: { bathroom: 'done' } }; bk.data.house.adminHash = 'xx';
  const sel = tid('import-file');
  await page.setInputFiles(sel, { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) });
  await page.waitForSelector(tid('import-summary')); await shot(page, 'import-summary-390');
  await page.click(tid('import-confirm'));
  await until(page, () => window.__app.house.name === 'Casa Importata');
  const st = await state(page);
  assert.ok(st.weeks['2026-10-18']); assert.notEqual(st.house.adminHash, 'xx', 'il PIN attuale resta'); assert.equal(st.house.id, 'LOCALTEST001');
  // import cifrato: passphrase errata poi giusta
  const enc = await encryptBackup({ ...bk, data: { ...bk.data, house: { ...bk.data.house, name: 'Casa Cifrata' } } }, 'segreta123');
  await page.setInputFiles(sel, { name: 'b.enc.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(enc)) });
  await page.fill(tid('pass-1'), 'sbagliata'); await page.click(tid('pass-ok'));
  await page.waitForFunction(() => document.querySelector('[data-testid=pass-error]').textContent.length > 0);
  await page.waitForTimeout(400);   // anti doppio tocco: stesso pulsante, stessa posizione
  await page.fill(tid('pass-1'), 'segreta123'); await page.click(tid('pass-ok'));
  await page.waitForSelector(tid('import-summary')); await page.click(tid('import-confirm'));
  await until(page, () => window.__app.house.name === 'Casa Cifrata');
  // file non valido
  await page.setInputFiles(sel, { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await toast(page, /non riconosciuto/);
  noErrors(page);
});

await test('dati: import del foglio Excel originale', async (mk) => {
  if (!fs.existsSync(XLSX_REAL)) { console.log('  (file Excel reale non trovato: imposta XLSX_FILE=<percorso del foglio> per provare questa parte; salto)'); return; }
  const page = await mk(); await go(page, 'data');
  await page.setInputFiles(tid('import-file'), XLSX_REAL);
  await page.waitForSelector(tid('import-summary'), { timeout: 15000 }); await shot(page, 'import-xlsx-390');
  await page.click(tid('import-confirm'));
  await until(page, () => window.__app.house.roommates[0].name === 'Antonio');
  const r = await page.evaluate(() => { const o = window.__app.calc.out; return { rm: window.__app.house.roommates.map((x) => x.name), weeks: Object.keys(window.__app.state.weeks).length, rows: o.rows.length, start: window.__app.house.startSunday, admin: window.__app.house.adminIds }; });
  console.log('  excel:', JSON.stringify({ rm: r.rm, weeks: r.weeks, start: r.start }));
  assert.deepEqual(r.rm, ['Antonio', 'Duygu', 'Nicola']); assert.ok(r.weeks >= 1 && r.rows > 5); assert.ok(r.admin.length >= 1);
  noErrors(page);
});

await test('dati: cancella tutto con conferma del nome, esci dalla casa', async (mk) => {
  const page = await mk(); await go(page, 'data');
  await page.click(tid('data-reset'));
  assert.equal(await page.locator(tid('reset-confirm')).isDisabled(), true);
  await page.fill(tid('reset-name'), 'sbagliato'); assert.equal(await page.locator(tid('reset-confirm')).isDisabled(), true);
  await page.fill(tid('reset-name'), 'casa test'); assert.equal(await page.locator(tid('reset-confirm')).isDisabled(), false);
  await page.click(tid('reset-confirm'));
  await until(page, () => !JSON.parse(localStorage.getItem('cp:houses') || '[]').length && localStorage.getItem('cp:h:LOCALTEST001') === null);
  const p2 = await mk(); await go(p2, 'data');
  await p2.click(tid('data-leave')); await p2.click('.sheet button:has-text("Esci da questa casa")');
  await until(p2, () => JSON.parse(localStorage.getItem('cp:houses') || '[]').length === 0);
  assert.notEqual(await p2.evaluate(() => localStorage.getItem('cp:h:LOCALTEST001')), null, 'i dati restano nella casa');
});

const AI_JSON = JSON.stringify({ trips: [{ person: 'Bruno', from: '2026-11-02', to: '2026-11-09', note: 'Natale' }, { person: 'Zoe', from: '2026-11-02', to: null, note: '' }], results: [{ week: '2026-10-25', chore: 'bathroom', outcome: 'by', by: 'Carla' }] });
const AI_BODY = {
  anthropic: { url: 'https://api.anthropic.com/**', body: { content: [{ type: 'text', text: AI_JSON }] }, keyHeader: 'x-api-key' },
  openai: { url: 'https://api.openai.com/**', body: { choices: [{ message: { content: AI_JSON } }] }, keyHeader: 'authorization' },
  gemini: { url: 'https://generativelanguage.googleapis.com/**', body: { candidates: [{ content: { parts: [{ text: AI_JSON }] } }] }, keyHeader: 'x-goog-api-key' },
};
for (const prov of Object.keys(AI_BODY)) {
  await test('IA: provider ' + prov + ' (fetch intercettato)', async (mk) => {
    const page = await mk(); let seenKey = null, calls = 0;
    await page.route(AI_BODY[prov].url, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      calls++; seenKey = req.headers()[AI_BODY[prov].keyHeader];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(AI_BODY[prov].body) });
    });
    await go(page, 'ai');
    await page.click(tid('sw-ai-row')); await until(page, () => window.__app.house.ai && window.__app.house.ai.enabled === true);
    await page.selectOption(tid('ai-provider'), prov);
    if (prov !== 'anthropic') { await until(page, (p) => JSON.parse(localStorage.getItem('cp:ai') || '{}').provider === p, prov); await page.waitForTimeout(400); }
    await commit(page.locator(tid('ai-key')), 'sk-test-123');
    await until(page, () => JSON.parse(localStorage.getItem('cp:ai') || '{}').key === 'sk-test-123');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('cp:ai'))).provider, prov);
    assert.ok(!JSON.stringify(await state(page)).includes('sk-test-123'), 'la chiave non va nel cloud');
    await page.click(tid('ai-test')); await toast(page, /Connessione riuscita/);
    assert.ok(seenKey && seenKey.includes('sk-test-123'));
    await shot(page, 'ai-' + prov + '-390');
    await page.click(tid('ai-import'));
    await page.fill(tid('ai-text'), 'Bruno è via dal 2 al 9 novembre. Carla ha fatto il bagno al posto di Bruno.');
    await page.click(tid('ai-run'));
    await page.waitForSelector('.sheet label.check');
    assert.equal(await page.locator('.sheet label.check').count(), 2, 'la persona sconosciuta viene scartata');
    assert.equal(Object.keys((await state(page)).trips).length, 0, 'nulla applicato senza conferma');
    await shot(page, 'ai-results-' + prov);
    await page.click(tid('ai-apply'));
    await until(page, () => Object.values(window.__app.state.trips).length === 1 && window.__app.state.weeks['2026-10-25'] && window.__app.state.weeks['2026-10-25'].result.bathroom === 'by:carla');
    assert.ok(calls >= 2); noErrors(page);
  });
}
await test('IA: senza chiave e con errore del servizio', async (mk) => {
  const page = await mk(); await go(page, 'ai');
  await page.click(tid('ai-import')); await page.waitForSelector(tid('ai-open-settings'));
  await page.fill(tid('ai-text'), 'prova'); await page.click(tid('ai-run'));
  await page.waitForSelector('.sheet .note.warn');
  await page.evaluate(() => localStorage.setItem('cp:ai', JSON.stringify({ provider: 'openai', key: 'k' })));
  await page.route('https://api.openai.com/**', (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }) : route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'bad key' } }) }));
  await page.waitForTimeout(400);   // anti doppio tocco: stesso pulsante, stessa posizione
  await page.click(tid('ai-run')); await page.waitForSelector(tid('ai-error'));
  assert.match(await page.locator(tid('ai-error')).innerText(), /bad key/);
  await page.click('.sheet .icon-btn[aria-label="Chiudi"]');
  await page.evaluate(() => window.__app.rerender()); await page.waitForFunction(() => !document.querySelector('[data-testid=ai-remove]') || !document.querySelector('[data-testid=ai-remove]').disabled);
  await page.click(tid('ai-remove')); await until(page, () => !JSON.parse(localStorage.getItem('cp:ai') || '{}').key);
  assert.deepEqual((page.__errors || []).filter((e) => !/status of 401/.test(e)), []);
});

await test('sicurezza: cambio PIN, blocco e sblocco', async (mk) => {
  const salt = 'SALTSALTSALT1234'; const adminHash = await hashPin('1234', salt);
  const page = await mk({ houseExtra: { adminSalt: salt, adminHash } }); await go(page, 'security');
  await page.fill(tid('pin-old'), '9999'); await page.fill(tid('pin-new'), '5678'); await page.fill(tid('pin-new2'), '5678'); await page.click(tid('pin-save'));
  await page.waitForFunction(() => document.querySelector('[data-testid=pin-error]').textContent.includes('errato'));
  await page.waitForTimeout(400);   // anti doppio tocco
  await page.fill(tid('pin-old'), '1234'); await page.fill(tid('pin-new2'), '0000'); await page.click(tid('pin-save'));
  await page.waitForFunction(() => document.querySelector('[data-testid=pin-error]').textContent.includes('coincidono'));
  await page.waitForTimeout(400);
  await page.fill(tid('pin-new2'), '5678'); await page.click(tid('pin-save'));
  await until(page, () => window.__app.house.adminSalt !== 'SALTSALTSALT1234');
  const ok = await page.evaluate(async () => { const a = await import('/js/actions.js'); return [await a.verifyPin(window.__app.house, '5678'), await a.verifyPin(window.__app.house, '1234')]; });
  assert.deepEqual(ok, [true, false]);
  await page.click(tid('sec-lock'));
  await page.waitForSelector(tid('settings-index'));
  assert.equal(await page.locator('a.li[href^="#/settings/"]').count(), 4);
  await go(page, 'profile'); await page.fill(tid('admin-pin'), '5678'); await page.click(tid('admin-unlock'));
  await until(page, () => window.__app.isAdmin === true);
  noErrors(page);
});

await test('EN + dark + viewport desktop: nessun overflow, screenshot', async (mk) => {
  const subs = ['', 'roommates', 'notif-house', 'access', 'data', 'rules', 'invite', 'appearance'];
  for (const [vp, tag] of [[{ width: 390, height: 844 }, '390'], [{ width: 1440, height: 900 }, '1440']]) {
    const page = await mk({ viewport: vp, dark: true, lang: 'en-US', seedOpts: { members: { ...members } }, houseExtra: { lang: 'en' } });
    await page.evaluate(() => window.__app.savePrefs({ lang: 'en' }));
    for (const sub of subs) {
      await go(page, sub); await page.waitForTimeout(150);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(ov <= 1, `overflow orizzontale in ${sub || 'index'} @${tag}: ${ov}`);
      if (['', 'roommates', 'notif-house', 'access'].includes(sub)) await shot(page, `en-dark-${tag}-${sub || 'index'}`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
    assert.match(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), /rgb\(0, 0, 0\)/);
    noErrors(page);
  }
});

// ---------- service worker (contesto con SW consentiti) ----------
await test('service worker: offline, push, click, notifica locale', async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', permissions: ['notifications'] });
    await context.addInitScript((data) => { if (!localStorage.getItem('cp:seeded')) { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('cp:seeded', '1'); } }, seed({ houseExtra: { requireRules: false } }));
    const page = await context.newPage(); page.on('pageerror', (e) => (page.__errors ||= []).push(String(e)));
    await page.goto(env.url + '/#/settings'); await page.waitForSelector(tid('settings-index'));
    await page.evaluate(() => navigator.serviceWorker.ready);
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.match(sw.url(), /\/sw\.js$/);
    const keys = await page.evaluate(async () => (await caches.keys()));
    assert.equal(keys.length, 1); assert.match(keys[0], /^tidyhouse-/);
    const cached = await page.evaluate(async () => { const c = await caches.open((await caches.keys())[0]); return (await c.keys()).map((r) => new URL(r.url).pathname); });
    for (const f of ['/index.html', '/css/app.css', '/js/app.js', '/js/push.js', '/vendor/qr.js', '/icons/icon-192.png']) assert.ok(cached.includes(f), 'precache: ' + f);
    // notifica locale: senza permesso (headless) risponde ok:false/permission, con permesso mostra la notifica
    const lt = await page.evaluate(async () => { const p = await import('/js/push.js'); return p.localTest({ deviceId: 'd' }); });
    assert.ok(lt.ok === true || lt.reason === 'permission', JSON.stringify(lt));
    // il SW mostra SEMPRE una notifica a un push: intercetto showNotification
    await sw.evaluate(() => { self.__shown = []; self.registration.showNotification = (title, opts) => { self.__shown.push({ title, opts }); return Promise.resolve(); }; });
    await sw.evaluate(() => { const data = new TextEncoder().encode(JSON.stringify({ title: 'Sabato', body: 'Tocca a te', url: '#/trips', tag: 'k1' })); self.dispatchEvent(new PushEvent('push', { data })); });
    await sw.evaluate(() => self.dispatchEvent(new PushEvent('push')));
    await sw.evaluate(() => { const d = new TextEncoder().encode('testo semplice'); self.dispatchEvent(new PushEvent('push', { data: d })); });
    const shown = await sw.evaluate(() => new Promise((r) => setTimeout(() => r(self.__shown), 200)));
    assert.equal(shown.length, 3, 'una notifica per ogni push');
    assert.equal(shown[0].title, 'Sabato'); assert.equal(shown[0].opts.body, 'Tocca a te'); assert.equal(shown[0].opts.tag, 'k1'); assert.equal(shown[0].opts.data.url, '#/trips'); assert.match(shown[0].opts.icon, /icons\/icon-192\.png$/);
    assert.equal(shown[1].title, 'Tidy House'); assert.equal(shown[2].opts.body, 'testo semplice');
    // click sulla notifica: dopo un reload la pagina è controllata e il SW la porta all'hash indicato
    await page.goto(env.url + '/#/settings'); await page.reload(); await page.waitForSelector(tid('settings-index'));
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'pagina controllata dal SW');
    await sw.evaluate(() => { let closed = false; const e = new ExtendableEvent('notificationclick'); Object.defineProperty(e, 'notification', { value: { close() { closed = true; }, data: { url: '#/trips' } } }); self.dispatchEvent(e); self.__closed = () => closed; });
    await page.waitForFunction(() => location.hash === '#/trips', null, { timeout: 5000 });
    // offline: la pagina controllata si ricarica dalla cache
    await page.evaluate(() => { location.hash = '#/settings'; }); await page.waitForSelector(tid('settings-index'));
    await context.setOffline(true);
    await page.reload(); await page.waitForSelector(tid('settings-index'), { timeout: 10000 });
    assert.match(await page.locator('.title').first().innerText(), /Impostazioni/);
    await context.setOffline(false);
    assert.deepEqual((page.__errors || []).filter((e) => !/Failed to fetch|NetworkError/.test(e)), []);
  } finally { await browser.close(); }
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} test e2e ok`);
process.exit(failed.length ? 1 : 0);
