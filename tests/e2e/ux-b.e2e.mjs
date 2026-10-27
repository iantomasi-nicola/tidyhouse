// E2E dell'audit di usabilità di «Altro» e «Impostazioni» (UX-B). Ogni scenario riproduce una criticità trovata
// (vedi docs/ux/more-settings.md) e prima della correzione falliva. Esegui con:  node tests/e2e/ux-b.e2e.mjs [filtro]
// Orologio finto 2026-10-28T10:00 (mercoledì): la settimana corrente finisce domenica 2026-11-01.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const SHOT = process.env.SHOT_DIR || '/tmp/claude-0/-home-user-tidyhouse/c243bc09-3166-5024-8c63-241289e91a58/scratchpad/uxb/';
const NOW = '2026-10-28T10:00:00';
const M = { width: 390, height: 844 };
const T = { width: 820, height: 1180 };
const D = { width: 1440, height: 900 };
const HID = 'LOCALTEST001';
const SUN = '2026-11-01';
fs.mkdirSync(SHOT, { recursive: true });

const env = await start();
let failed = 0; let ran = 0; const only = process.argv[2];

async function open({ ...opts } = {}) {
  const page = await env.page({ now: NOW, viewport: M, ...opts });
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.CASA_CONFIG = { firebase: { apiKey: "", projectId: "" }, publicUrl: "" };' }));
  return page;
}
async function done(page) {
  const errs = (page.__errors || []).filter((e) => !/favicon|manifest|Service Worker|SW /i.test(e));
  await page.context().close();
  assert.deepEqual(errs, [], 'errori in console: ' + errs.join(' | '));
}
const shot = async (page, name) => { await page.waitForTimeout(500); return page.screenshot({ path: SHOT + name + '.png', fullPage: true }); };
const ready = async (page) => { await page.waitForSelector('#app > *', { timeout: 8000 }); await page.waitForTimeout(250); };
const goto = async (page, hash = '/') => { await page.goto(env.url + '/#' + hash); await ready(page); };
const hop = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, '#' + hash); await page.waitForTimeout(350); };
const body = (page) => page.evaluate(() => document.body.innerText);
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('cp:h:' + k) || 'null'), HID);
const tid = (id) => `[data-testid="${id}"]`;
async function noOverflow(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(w.sw <= w.iw + 1, `overflow orizzontale in ${label}: ${w.sw} > ${w.iw}`);
}
async function noRawKeys(page, label) {
  const txt = await body(page);
  const m = txt.match(/\b(uxb|onb|moreX|moreY|moreZ|more|needs|rules|tasks|lastout|req|act|acc|setX|set|guide|misc|home|chore)\.[a-zA-Z][\w.]*/);
  assert.doesNotMatch(txt, /\b(null|undefined|NaN)\b/, 'valori grezzi in ' + label);
  assert.ok(!m, `chiave non tradotta in ${label}: ${m && m[0]}`);
}
async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  ran++;
  try { await fn(); console.log('ok   ', name); } catch (e) { failed++; console.error('FAIL ', name, '\n', e && e.stack ? e.stack : e); }
}
const S = (o = {}) => seed({ ...o, houseExtra: { requireRules: false, requirePush: false, ...(o.houseExtra || {}) } });
const withState = (s, patch) => { Object.assign(s['cp:h:' + HID], patch); return s; };
/** Elementi toccabili sotto i 44 px (gli interruttori contano con l'area estesa dell'input). */
const smallTargets = (page) => page.evaluate(() => {
  const out = []; const seen = new Set();
  for (const el of document.querySelectorAll('#app a[href], #app button, #app select, #app summary, #app input:not([type=hidden]):not(.sr):not([type=range]), #app textarea')) {
    const cs = getComputedStyle(el); let r = el.getBoundingClientRect();
    const lab = el.closest('label'); if (/^(checkbox|radio)$/.test(el.type) && lab && r.height < 43.5 && !lab.classList.contains('switch')) r = lab.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || !r.width || !r.height || el.closest('[hidden],.sr')) continue;
    if (r.height < 43.5 || r.width < 43.5) {
      const k = (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
      if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
  }
  return out;
});

const REQ = () => ({
  r1: { kind: 'cover', terms: 'gift', week: SUN, chore: 'kitchen', from: 'bruno', to: null, status: 'pending', at: '2026-10-27T10:00:00.000Z' },
  r3: { kind: 'offer', terms: 'gift', week: SUN, chore: 'bathroom', from: 'bruno', to: 'anna', status: 'pending', at: '2026-10-27T11:00:00.000Z' },
  old1: { kind: 'cover', terms: 'repay', week: '2026-10-11', chore: 'floor', from: 'carla', to: null, status: 'pending', at: '2026-10-09T10:00:00.000Z' },
  old2: { kind: 'offer', terms: 'repay', week: '2026-10-11', chore: 'kitchen', from: 'anna', to: 'bruno', status: 'pending', at: '2026-10-09T11:00:00.000Z' },
});

// ============================================================ BLOCCO 1 · Altro
await scenario('hub: «Esporta dati» solo all\'admin, «Invita» anche a chi non è admin', async () => {
  const p = await open({ seed: S({ admin: false, me: 'bruno' }) });
  await goto(p, '/more');
  assert.equal(await p.locator('a.li[href="#/settings/data"]').count(), 0, 'il non-admin non deve vedere un link che porta a «solo admin»');
  assert.equal(await p.locator('a.li[href="#/settings/invite"]').count(), 1, 'il codice è visibile a tutti: il link serve anche a loro');
  await p.locator('a.li[href="#/settings/invite"]').click();
  await p.waitForSelector(tid('invite-code'));
  assert.equal(await p.locator(tid('rot-go')).count(), 0, 'la rotazione resta solo admin');
  await done(p);
  const a = await open({ seed: S() });
  await goto(a, '/more');
  assert.equal(await a.locator('a.li[href="#/settings/data"]').count(), 1);
  assert.equal(await a.locator('a.li[href="#/settings/invite"]').count(), 1);
  await done(a);
});

await scenario('hub: «Da fare ora» risponde alle richieste in 1 tap dall\'hub (prima 3 tap)', async () => {
  const p = await open({ seed: withState(S(), { requests: REQ() }) });
  await goto(p, '/more');
  assert.ok(await p.locator(tid('hub-todo')).isVisible(), 'blocco «da fare ora» visibile');
  assert.equal(await p.locator(tid('hub-todo') + ' [data-testid^="hub-req-"][data-req]').count(), 2, 'solo le richieste attuali (r1, r3), non le scadute');
  assert.equal(await p.locator(tid('hub-req-decline-r1')).count(), 0, 'la richiesta aperta a tutti si accetta o si ignora, non si rifiuta');
  await shot(p, 'hub-todo-390');
  await p.locator(tid('hub-req-accept-r3')).click();
  await p.waitForFunction(() => !document.querySelector('[data-testid="hub-req-accept-r3"]'));
  const st = await store(p);
  assert.equal(st.requests.r3.status, 'accepted'); assert.equal(st.weeks[SUN].agreed.bathroom, 'bruno');
  assert.match(await p.locator('a.li[href="#/requests"]').innerText(), /1 in attesa/);
  await p.waitForTimeout(400);
  await p.locator(tid('hub-req-accept-r1')).click();
  await p.waitForFunction(() => !document.querySelector('[data-testid="hub-todo"]'));
  assert.equal((await store(p)).requests.r1.status, 'accepted');
  await noOverflow(p, 'hub'); await done(p);
});

await scenario('richieste scadute: non fanno rumore (badge/elenco), pulizia in 1 tap con Annulla', async () => {
  const p = await open({ seed: withState(S(), { requests: REQ() }) });
  await goto(p, '/more');
  assert.equal(await p.locator('a.li[href="#/requests"] .chip').innerText(), '2', 'il badge conta solo le richieste ancora valide');
  await goto(p, '/requests');
  assert.equal(await p.locator('[data-testid="req-incoming"] [data-testid^="req-old"]').count(), 0);
  assert.ok(await p.locator(tid('req-stale')).isVisible(), 'sezione «scadute»');
  assert.equal(await p.locator(tid('req-stale') + ' .li').count(), 2, 'old1 e old2');
  await shot(p, 'requests-stale-390');
  await p.locator(tid('req-stale-clear')).click();
  await p.waitForFunction(() => !document.querySelector('[data-testid="req-stale"]'));
  let st = await store(p);
  assert.ok(!st.requests.old1 && !st.requests.old2 && st.requests.r1 && st.requests.r3, 'rimosse solo le scadute');
  await p.locator('.toast-action', { hasText: 'Annulla' }).last().click();
  await p.waitForSelector(tid('req-stale'));
  st = await store(p);
  assert.ok(st.requests.old1 && st.requests.old2, 'Annulla le rimette');
  await noOverflow(p, 'requests'); await noRawKeys(p, 'requests'); await done(p);
  // chi non c\'entra non vede le scadute degli altri
  const q = await open({ seed: withState(S({ admin: false, me: 'carla' }), { requests: REQ() }) });
  await goto(q, '/requests');
  assert.equal(await q.locator(tid('req-stale') + ' .li').count(), 1, 'carla vede solo la propria (old1)');
  await done(q);
});

await scenario('registro: l\'assegnazione manuale ha icona e frase tradotta (IT/EN)', async () => {
  const log = { l1: { at: '2026-10-27T10:00:00Z', by: 'admin', type: 'assign', p: { week: SUN, text: 'floor: bruno', n: 2 } } };
  const p = await open({ seed: withState(S(), { log }) });
  await goto(p, '/activity');
  const txt = await body(p);
  assert.match(txt, /Admin ha assegnato a mano i turni di 26 ott – 1 nov/);
  assert.doesNotMatch(txt, /floor: bruno/, 'niente id grezzi');
  await noRawKeys(p, 'activity'); await done(p);
  const e = await open({ seed: withState(S({ houseExtra: { lang: 'en' } }), { log }), lang: 'en-US' });
  await goto(e, '/activity');
  assert.match(await body(e), /Admin set the shifts for 26 Oct – 1 Nov by hand/);
  await done(e);
});

await scenario('tap target ≥ 44 px su Altro e Impostazioni (390 e 320 con testo 130%, IT/EN)', async () => {
  const routes = ['more', 'needs', 'rules', 'lastout', 'tasks', 'more/shared', 'requests', 'activity', 'guide', 'more/about', 'settings', 'settings/profile', 'settings/appearance', 'settings/home', 'settings/notifications', 'settings/house', 'settings/rules', 'settings/roommates', 'settings/features', 'settings/links', 'settings/notif-house', 'settings/invite', 'settings/access', 'settings/data', 'settings/ai', 'settings/security'];
  const bad = [];
  for (const [vp, lang, fs] of [[M, 'it-IT', 1], [{ width: 320, height: 640 }, 'en-US', 1.3]]) {
    const st = withState(S({ extra: { 'cp:prefs': { textSize: fs } }, houseExtra: { lang: lang.startsWith('en') ? 'en' : 'it' } }), { requests: REQ(), needs: { n1: { text: 'Latte', urgent: true, by: 'anna', at: '2026-10-27T10:00:00Z', done: false } } });
    const p = await open({ seed: st, viewport: vp, lang });
    for (const r of routes) { await goto(p, '/' + r); const sm = await smallTargets(p); if (sm.length) bad.push(`${vp.width}/${lang} #/${r}: ${sm.join(' ; ')}`); await noOverflow(p, r); }
    await done(p);
  }
  assert.deepEqual(bad, [], 'target sotto i 44 px');
});

// ============================================================ BLOCCO 2 · Impostazioni
await scenario('funzioni: ogni interruttore ha icona e una riga che spiega cosa cambia (anche «Compiti condivisi»)', async () => {
  const p = await open({ seed: S() });
  await goto(p, '/settings/features');
  const rows = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="feat-"][data-testid$="-row"]')].map((r) => ({ id: r.getAttribute('data-testid'), ico: !!r.querySelector('.ico svg'), d: (r.querySelector('.d') || {}).textContent || '' })));
  assert.ok(rows.length >= 15, 'righe funzioni: ' + rows.length);
  assert.deepEqual(rows.filter((r) => !r.ico).map((r) => r.id), [], 'icona mancante');
  assert.deepEqual(rows.filter((r) => !r.d.trim()).map((r) => r.id), [], 'spiegazione mancante');
  await noRawKeys(p, 'features'); await shot(p, 'features-390'); await done(p);
});

await scenario('indice impostazioni: rapide in cima (tema in 1 tap), ricerca, «aperte spesso»', async () => {
  const p = await open({ seed: S() });
  await goto(p, '/settings');
  assert.ok(await p.locator(tid('st-quick')).isVisible(), 'impostazioni rapide');
  await p.locator(tid('st-quick') + ' button:has-text("Scuro")').click();
  await p.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await p.locator(tid('st-quick') + ' button:has-text("Automatico")').click();
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
  // ricerca
  const q = p.locator(tid('st-search'));
  await q.fill('penalità');
  await p.waitForSelector(tid('st-results') + ' a[href="#/settings/rules"]');
  assert.equal(await p.locator(tid('st-results') + ' a').count(), 1);
  assert.equal(await p.locator(tid('settings-groups')).isVisible(), false, 'durante la ricerca spariscono i gruppi');
  await q.fill('codice');
  await p.waitForSelector(tid('st-results') + ' a[href="#/settings/invite"]');
  await q.fill('zzzz');
  assert.match(await p.locator(tid('st-results')).innerText(), /Nessun risultato per «zzzz»/);
  assert.equal(await p.inputValue(tid('st-search')), 'zzzz');
  await p.evaluate(() => window.__app.rerender()); await p.waitForTimeout(300);
  assert.equal(await p.inputValue(tid('st-search')), 'zzzz', 'la ricerca sopravvive ai rerender');
  await q.fill('');
  assert.equal(await p.locator(tid('settings-groups')).isVisible(), true);
  // aperte spesso: dopo 2 aperture la sezione sale in cima
  assert.equal(await p.locator(tid('st-freq')).count(), 0);
  for (let i = 0; i < 2; i++) { await hop(p, '/settings/features'); await hop(p, '/settings'); }
  await p.waitForSelector(tid('st-freq') + ' a[href="#/settings/features"]');
  assert.equal(await p.locator('a.li[href^="#/settings/"]').count(), 15, 'le 15 sezioni restano raggiungibili dall\'indice');
  await noOverflow(p, 'settings'); await noRawKeys(p, 'settings'); await shot(p, 'settings-index-390'); await done(p);
  // non admin: la ricerca non porta a sezioni vietate
  const n = await open({ seed: S({ admin: false, me: 'bruno' }) });
  await goto(n, '/settings');
  await n.locator(tid('st-search')).fill('backup');
  assert.match(await n.locator(tid('st-results')).innerText(), /Nessun risultato/);
  await n.locator(tid('st-search')).fill('tema');
  await n.waitForSelector(tid('st-results') + ' a[href="#/settings/appearance"]');
  await done(n);
  // EN
  const e = await open({ seed: S({ houseExtra: { lang: 'en' } }), lang: 'en-US', viewport: D, dark: true });
  await goto(e, '/settings');
  await e.locator(tid('st-search')).fill('penalty');
  await e.waitForSelector(tid('st-results') + ' a[href="#/settings/rules"]');
  await noRawKeys(e, 'settings en'); await shot(e, 'settings-index-en-desktop'); await done(e);
});

await scenario('sicurezza: il nuovo admin non è preselezionato su chi è già admin; errori che non spariscono', async () => {
  const p = await open({ seed: S({ houseExtra: { adminSalt: 'SALTSALTSALT1234', adminHash: 'xx' } }) });
  await goto(p, '/settings/security');
  const v = await p.locator(tid('newadmin-who')).inputValue();
  assert.notEqual(v, 'anna', 'il primo candidato non deve essere l\'admin attuale');
  assert.equal(await p.locator(tid('newadmin-pin')).getAttribute('enterkeyhint'), 'done');
  await p.fill(tid('pin-old'), '9999'); await p.fill(tid('pin-new'), '5678'); await p.fill(tid('pin-new2'), '5678'); await p.click(tid('pin-save'));
  await p.waitForFunction(() => /errato/.test(document.querySelector('[data-testid=pin-error]').textContent));
  await p.evaluate(() => window.__app.rerender()); await p.waitForTimeout(300);
  assert.match(await p.locator(tid('pin-error')).textContent(), /errato/, 'l\'errore resta dopo un rerender (arrivano dati da un altro telefono)');
  await done(p);
});

await scenario('impostazioni: parole semplici nelle regole e testo «Chiave API» tradotto', async () => {
  const p = await open({ seed: S() });
  await goto(p, '/settings/rules');
  const t = await body(p);
  assert.match(t, /Persone a casa per concedere un riposo/); assert.match(t, /Settimane contate in classifica/);
  assert.doesNotMatch(t, /Finestra classifica/);
  await goto(p, '/settings/ai');
  assert.equal(await p.locator(tid('ai-key')).getAttribute('placeholder'), 'Chiave API');
  await done(p);
});

// ============================================================ chiusura
console.log(`\n${ran - failed}/${ran} scenari ok`);
await env.close();
process.exit(failed ? 1 : 0);
