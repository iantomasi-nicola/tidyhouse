// E2E: casa grande (7–8 persone) e mansioni aggiunte dall'admin (5 mansioni). Esegui con: node tests/e2e/chores-people.e2e.mjs [filtro]
// Onboarding a 8, aggiunta dell'ottava persona, nuova mansione (nome IT/EN, icona, fatica, ordine), mansione tolta, Home, Settimane,
// «Assegna la settimana», Classifica; 320px e 1440px, IT ed EN, niente overflow né errori in console. Screenshot in SHOTS (scratchpad).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, seed } from './helpers.mjs';
import { compute, DEFAULT_CHORES } from '../../js/engine.js';
import { engineHouse } from '../../js/store.js';

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'tidyhouse-chores-people');
fs.mkdirSync(SHOTS, { recursive: true });
const NOW = '2026-10-28T10:00:00', TODAY = '2026-10-28', CUR = '2026-11-01', NEXT_MON = '2026-11-02', LAST_SUN = '2026-10-25';
const HID = 'LOCALTEST001';
const NARROW = { width: 320, height: 720 }, MOBILE = { width: 390, height: 844 }, DESKTOP = { width: 1440, height: 900 };
const PEOPLE = ['Anna', 'Bruno', 'Carla', 'Dario', 'Elena', 'Fabio', 'Gaia'].map((name, i) => ({ id: name.toLowerCase(), name, slot: i + 1, from: null, to: null }));
const GARDEN = { id: 'c_garden', name: { it: 'Giardino', en: 'Garden' }, icon: 'leaf', effort: 3 };
const TRASH = { id: 'c_trash', name: 'Spazzatura', icon: 'trash', effort: 1 };
const CH5 = [...DEFAULT_CHORES.map((c) => ({ id: c.id, name: { ...c.name }, icon: c.icon, effort: 1 })), GARDEN, TRASH];
const ALL = { result: Object.fromEntries(CH5.map((c) => [c.id, 'done'])) };
const WEEKS = { '2026-10-04': ALL, '2026-10-11': { result: { ...ALL.result, c_trash: 'skipped' } }, '2026-10-18': ALL, [LAST_SUN]: ALL };
const big = (extra = {}, lang = null) => seed({ houseExtra: { requireRules: false, roommates: PEOPLE, chores: CH5, tasks: [], ...extra }, weeks: WEEKS, extra: lang ? { 'cp:prefs': { lang } } : {} });
const plan = (s) => compute(engineHouse(s['cp:h:' + HID]), TODAY, 4);

let env; let failed = 0; const only = process.argv[2];
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}
async function open({ s, viewport = MOBILE, lang = 'it-IT', hash = '#/', dark = false } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: s });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.CASA_CONFIG = { firebase: { apiKey: "", projectId: "" }, publicUrl: "" };' }));
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector('#app > *', { timeout: 8000 });
  await page.waitForTimeout(600);
  return page;
}
const go = async (page, hash) => { await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(650); };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
const tid = (x) => `[data-testid="${x}"]`;
const body = (page) => page.evaluate(() => document.querySelector('#app').innerText);
const house = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.house)));
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });
async function noOverflow(page, label) {
  const w = await page.evaluate(() => {
    const iw = window.innerWidth; const bad = [];
    for (const el of document.querySelectorAll('#app *, .sheet *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > iw + 1 && getComputedStyle(el).position !== 'fixed') bad.push((el.className && String(el.className).slice(0, 40)) || el.tagName); }
    return { sw: document.documentElement.scrollWidth, iw, bad: bad.slice(0, 5) };
  });
  assert.ok(w.sw <= w.iw + 1, `overflow orizzontale in ${label}: ${w.sw} > ${w.iw} ${w.bad.join(', ')}`);
}
async function clean(page, label) {
  const txt = await body(page);
  assert.doesNotMatch(txt, /\b(chx|chore|stats|set|setX|home|cal)\.[a-zA-Z]+\b/, 'chiavi non tradotte in ' + label);
  assert.doesNotMatch(txt, /Mansione tolta|Removed chore/, 'mansione sconosciuta in ' + label);
  const errs = (page.__errors || []).filter((e) => !/favicon|manifest|Failed to load resource/i.test(e));
  assert.deepEqual(errs, [], 'errori in console in ' + label);
}
const close = (page) => page.context().close();

const run = async () => {
  env = await start();

  await test('onboarding: fino a 8 persone, posti 1..8', async () => {
    const page = await open({ s: null, viewport: NARROW });
    await page.getByRole('button', { name: /Crea una nuova casa/ }).click();
    await page.waitForSelector('#onb-name'); await page.fill('#onb-name', 'Casa Grande');
    await page.waitForTimeout(400); await page.getByRole('button', { name: /^Avanti/ }).click();
    await page.waitForSelector('.onb-person');
    const names = ['Anna', 'Bruno', 'Carla', 'Dario', 'Elena', 'Fabio', 'Gaia', 'Hugo'];
    for (let i = 0; i < names.length; i++) {
      if (i >= await page.locator('.onb-person').count()) { await page.getByRole('button', { name: /Aggiungi persona/ }).click(); await page.waitForTimeout(80); }
      await page.locator('.onb-person input[type=text]').nth(i).fill(names[i]);
    }
    assert.equal(await page.locator('.onb-person').count(), 8);
    assert.ok(await page.getByRole('button', { name: /Aggiungi persona/ }).isDisabled(), 'massimo 8');
    assert.match(await body(page), /Massimo 8 persone/);
    await noOverflow(page, 'onboarding 8 persone');
    await shot(page, 'onb-8-320');
    await page.waitForTimeout(400); await page.getByRole('button', { name: /^Avanti/ }).click();
    await page.waitForSelector('#onb-pin'); await page.fill('#onb-pin', '1234');
    await page.waitForTimeout(400); await page.getByRole('button', { name: /^Crea casa/ }).click();
    await page.waitForSelector('.onb-done');
    const reg = await page.evaluate(() => JSON.parse(localStorage.getItem('cp:houses')));
    const st = await page.evaluate((k) => JSON.parse(localStorage.getItem('cp:h:' + k)), reg[0].id);
    assert.deepEqual(st.house.roommates.map((r) => [r.name, r.slot]), names.map((n, i) => [n, i + 1]));
    await close(page);
  });

  await test('casa con 7 persone e 5 mansioni: Home, Settimane, Classifica, Impostazioni a 320 e 1440, IT ed EN', async () => {
    const out = plan(big());
    const row = out.rows[out.cur];
    assert.equal(row.chores.length, 5); assert.ok(row.assigned.every(Boolean), 'tutte e 5 assegnate');
    for (const [vp, lang] of [[NARROW, 'it-IT'], [DESKTOP, 'it-IT'], [NARROW, 'en-US'], [DESKTOP, 'en-US']]) {
      const page = await open({ s: big({}, lang.slice(0, 2)), viewport: vp, lang, dark: lang === 'en-US' && vp === DESKTOP });
      const tag = `${vp.width}-${lang.slice(0, 2)}`;
      const it = lang === 'it-IT';
      await page.waitForSelector('[data-screen="home"]');
      assert.equal(await page.locator('.hm-chore[data-chore]:not([data-chore=rest])').count(), 5, 'Home: 5 mansioni');
      const home = await body(page);
      assert.match(home, it ? /Giardino/ : /Garden/); assert.match(home, /Spazzatura/);
      assert.ok(await page.locator('.hm-chore[data-chore=c_garden] .tile.cx').count(), 'colore di ripiego per la mansione nuova');
      await noOverflow(page, 'home ' + tag); await clean(page, 'home ' + tag); await shot(page, 'home-' + tag);
      await go(page, '#/calendar');
      await page.waitForSelector('.week');
      assert.ok(await page.locator('.week [data-chore=c_trash]').count() > 0, 'Settimane: la mansione nuova c\'è');
      await noOverflow(page, 'calendar ' + tag); await clean(page, 'calendar ' + tag); await shot(page, 'calendar-' + tag);
      await go(page, '#/stats');
      await page.waitForSelector('.rank-list');
      assert.equal(await page.locator('.rank-list > li').count(), 7);
      assert.equal(await page.locator('.rank-row').first().locator('.rk-chore').count(), 5);
      assert.ok(await page.locator('.legend .seg-cx').count() === 2, 'legenda con le 2 mansioni nuove');
      await noOverflow(page, 'stats ' + tag); await clean(page, 'stats ' + tag); await shot(page, 'stats-' + tag);
      for (const sub of ['chores', 'roommates', 'rules']) {
        await go(page, '#/settings/' + sub);
        await page.waitForSelector(tid('settings-page'));
        await noOverflow(page, sub + ' ' + tag); await clean(page, sub + ' ' + tag);
      }
      await shot(page, 'settings-rules-' + tag);
      await close(page);
    }
  });

  await test('Impostazioni → coinquilini: aggiungi l\'ottava persona (posto 8)', async () => {
    const page = await open({ s: big(), viewport: NARROW, hash: '#/settings/roommates' });
    await page.waitForSelector(tid('rm-card-6'));
    await page.click(tid('rm-add'));
    await page.waitForSelector(tid('rm-card-7'));
    assert.equal(await page.locator(`${tid('rm-card-7')} .seg button[aria-pressed="true"]`).innerText(), '8');
    assert.equal(await page.locator(`${tid('rm-card-7')} .seg button`).count(), 8);
    await page.fill(tid('rm-name-7'), 'Hugo');
    await noOverflow(page, 'roommates 8');
    await shot(page, 'roommates-8-320');
    await page.click(tid('rm-save'));
    await until(page, () => (window.__app.house.roommates || []).length === 8);
    const h = await house(page);
    assert.deepEqual(h.roommates.map((r) => r.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(h.roommates[7].name, 'Hugo');
    await go(page, '#/');
    await page.waitForSelector('[data-screen="home"]');
    await noOverflow(page, 'home 8'); await clean(page, 'home 8');
    await go(page, '#/stats'); await page.waitForSelector('.rank-list'); await noOverflow(page, 'stats 8');
    await close(page);
  });

  await test('Impostazioni → Mansioni: nuova (IT/EN, icona, fatica, ordine), togli, rimetti; Home e Settimane si adattano', async () => {
    const page = await open({ s: big(), viewport: MOBILE, hash: '#/settings/chores' });
    await page.waitForSelector(tid('ch-card-4'));
    assert.equal(await page.locator('[data-testid^="ch-card-"]').count(), 5);
    // le mansioni già in turno non si scambiano tra loro (cambierebbero le settimane passate)
    assert.ok(await page.locator(tid('ch-up-1')).isDisabled()); assert.ok(await page.locator(tid('ch-down-0')).isDisabled());
    await page.click(tid('ch-add'));
    await page.waitForSelector(tid('ch-card-5'));
    await page.fill(tid('ch-name-5'), 'Bucato');
    await page.click(tid('ch-icon-5')); await page.click(`${tid('ch-iconpick-5')} [data-icon=shirt]`);
    await page.click(`${tid('ch-eff-5')} button:has-text("3")`);
    await page.click(tid('ch-bi-5'));
    await page.fill(tid('ch-en-5'), 'Laundry');
    assert.equal(await page.locator(tid('ch-it-5')).inputValue(), 'Bucato');
    assert.ok(!(await page.locator(tid('ch-up-5')).isDisabled()), 'la nuova si può spostare');
    await page.click(tid('ch-up-5'));
    await page.waitForSelector(`${tid('ch-card-4')}[data-chore=""]`);
    await noOverflow(page, 'editor mansioni'); await clean(page, 'editor mansioni');
    await shot(page, 'chores-editor-390');
    await page.click(tid('ch-save'));
    await until(page, () => (window.__app.house.chores || []).length === 6);
    let h = await house(page);
    const nw = h.chores[4];
    assert.match(nw.id, /^c_/); assert.deepEqual(nw.name, { it: 'Bucato', en: 'Laundry' }); assert.equal(nw.icon, 'shirt'); assert.equal(nw.effort, 3); assert.equal(nw.from, NEXT_MON);
    assert.deepEqual(h.chores.map((c) => c.id).filter((x) => x !== nw.id), CH5.map((c) => c.id), 'le altre restano nell\'ordine di prima');
    // togli la spazzatura: conferma con l'avviso che lo storico resta
    await page.waitForSelector('[data-chore=c_trash] [data-testid^="ch-del-"]');
    await page.click('[data-chore=c_trash] [data-testid^="ch-del-"]');
    await page.waitForSelector('.sheet .btn.danger');
    assert.match(await page.locator('.sheet').last().innerText(), /Lo storico resta/);
    await page.click('.sheet .btn.danger');
    await page.waitForTimeout(600);
    await page.click(tid('ch-save'));
    await until(page, () => (window.__app.house.chores || []).some((c) => c.id === 'c_trash' && c.to));
    h = await house(page);
    assert.equal(h.chores.find((c) => c.id === 'c_trash').to, LAST_SUN);
    await page.waitForSelector(tid('ch-removed'));
    assert.ok(await page.locator(tid('ch-restore-c_trash')).count());
    // Home: questa settimana 4 mansioni (niente spazzatura, il bucato parte lunedì)
    await go(page, '#/');
    await page.waitForSelector('[data-screen="home"]');
    assert.equal(await page.locator('.hm-chore[data-chore]:not([data-chore=rest])').count(), 4);
    await clean(page, 'home dopo le modifiche');
    // Settimane: la prossima ha il bucato, le passate hanno ancora la spazzatura
    await go(page, '#/calendar');
    await page.waitForSelector('.week');
    assert.ok(await page.locator(`.week[data-sunday="2026-11-08"] [data-chore="${nw.id}"]`).count(), 'bucato dalla settimana prossima');
    assert.equal(await page.locator(`.week[data-sunday="${CUR}"] [data-chore="c_trash"]`).count(), 0, 'niente spazzatura da questa settimana');
    await clean(page, 'calendar dopo le modifiche'); await shot(page, 'calendar-after-390');
    // EN: il nome inglese della nuova
    await page.evaluate(() => window.__app.savePrefs({ lang: 'en' }));
    await page.waitForTimeout(500);
    assert.match(await body(page), /Laundry/i);
    // rimetti la spazzatura
    await go(page, '#/settings/chores');
    await page.waitForSelector(tid('ch-restore-c_trash'));
    await page.click(tid('ch-restore-c_trash'));
    await page.waitForTimeout(400);
    await page.click(tid('ch-save'));
    await until(page, () => { const c = (window.__app.house.chores || []).find((x) => x.id === 'c_trash'); return c && !c.to; });
    h = await house(page);
    assert.equal(h.chores.find((c) => c.id === 'c_trash').from, NEXT_MON);
    await clean(page, 'editor dopo rimetti');
    await close(page);
  });

  await test('fatica per mansione (Regole) e classifica a punti con 5 mansioni', async () => {
    const page = await open({ s: big(), viewport: NARROW, hash: '#/settings/rules' });
    await page.waitForSelector(tid('fold-rules-adv'));
    await page.click(`${tid('fold-rules-adv')} summary`);
    await page.click(`${tid('effort-c_garden')} .seg button:has-text("4")`);
    await until(page, () => (window.__app.house.chores.find((c) => c.id === 'c_garden') || {}).effort === 4);
    const h = await house(page);
    assert.deepEqual(h.chores.map((c) => c.id), CH5.map((c) => c.id)); assert.ok(h.chores.every((c) => !c.to), 'nessuna mansione tolta');
    await go(page, '#/stats');
    await page.waitForSelector('.rank-seg');
    await page.click('.rank-seg [data-mode=effort]');
    await page.waitForTimeout(300);
    assert.match(await body(page), /Giardino 4/);
    await noOverflow(page, 'stats effort 320'); await clean(page, 'stats effort');
    await shot(page, 'stats-effort-320');
    await close(page);
  });

  await test('assegna la settimana e scheda settimana con 5 mansioni (admin)', async () => {
    const s = big(); const row = plan(s).rows[plan(s).cur];
    const g = row.chores.indexOf('c_garden'); const other = PEOPLE.map((p) => p.id).find((id) => id !== row.assigned[g] && row.nm.includes(id));
    const page = await open({ s, viewport: NARROW });
    await page.waitForSelector('[data-screen="home"]');
    await page.evaluate(async (w) => { const m = await import('/js/weekassign.js'); m.openAssignWeekSheet(window.__app, w); }, CUR);
    await page.waitForSelector('[data-chore-card=c_garden]');
    assert.equal(await page.locator('[data-chore-card]').count(), 5);
    await page.click(tid(`wa-c_garden-${other}`));
    await page.waitForSelector(tid('wa-preview'));
    assert.match(await page.locator(tid('wa-preview')).innerText(), /Giardino/);
    await noOverflow(page, 'assegna settimana'); await shot(page, 'assign-320');
    await page.click('[data-act=wa-save]');
    await until(page, (a) => ((window.__app.state.weeks[a.w] || {}).swap || {}).c_garden === a.id, { w: CUR, id: other });
    await page.waitForTimeout(400);
    await page.evaluate(async (w) => { const m = await import('/js/choresheet.js'); m.openWeekSheet(window.__app, w); }, CUR);
    await page.waitForSelector('.wd-chores');
    assert.equal(await page.locator('.sheet .wd-chore').count(), 5);
    assert.match(await page.locator('.sheet .wd-chore[data-chore=c_garden]').innerText(), new RegExp(PEOPLE.find((p) => p.id === other).name));
    await noOverflow(page, 'scheda settimana'); await clean(page, 'scheda settimana');
    await shot(page, 'week-sheet-320');
    // scheda del turno della mansione nuova
    await page.evaluate(async (w) => { const m = await import('/js/choresheet.js'); m.openChoreSheet(window.__app, w, 'c_trash'); }, CUR);
    await page.waitForTimeout(500);
    assert.match(await page.locator('.sheet').last().innerText(), /Spazzatura/);
    await noOverflow(page, 'scheda turno');
    await close(page);
  });

  await env.close();
  console.log(failed ? `${failed} test falliti` : 'OK: chores-people');
  process.exit(failed ? 1 : 0);
};
run().catch((e) => { console.error(e); process.exit(1); });
