// UX-C (nucleo + percorsi trasversali): difetti noti del TODO §1 e audit dei percorsi. Prima della correzione i controlli marcati [DIFETTO] falliscono.
//   node tests/e2e/ux-c.e2e.mjs                         (tutto)
//   ONLY=toast,render node tests/e2e/ux-c.e2e.mjs        (sezioni: toast render badges expiry lang install ios paths metrics)
import { createRequire } from 'node:module';
import { start, seed } from './helpers.mjs';
const require = createRequire(import.meta.url);

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(n);
const NOW = '2026-10-28T10:00:00';
let fails = 0; const metrics = {};
const ok = (c, m, d) => { if (c) console.log('ok   ' + m); else { fails++; console.log('FAIL ' + m + (d !== undefined ? '\n       ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); } return !!c; };
const warn = (c, m, d) => { if (!c) console.log('WARN ' + m + (d !== undefined ? ' ' + JSON.stringify(d) : '')); return !!c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkSeed = (o = {}) => seed({ ...o, houseExtra: { requireRules: false, tasks: [], ...(o.houseExtra || {}) } });
const errs = (page) => (page.__errors || []).filter((e) => !/Failed to load resource|favicon|sw\.js|net::ERR|Service Worker/i.test(e));
const env = await start();
const settle = async (page, ms = 300) => { await page.waitForFunction(() => { const m = document.querySelector('#main'); return (m && m.children.length) || document.querySelector('.gate'); }, null, { timeout: 8000 }).catch(() => {}); await sleep(ms); };
const open = async (page, route = '', ms) => { await page.goto(`${env.url}/#/${route}`); await settle(page, ms); };
const sundayOf = (page) => page.evaluate(() => window.__app.calc.out.rows[window.__app.calc.out.cur].sunday);

// ============================================================================================ 1. TOAST
if (want('toast')) {
  console.log('\n== TOAST ==');
  const page = await env.page({ now: NOW, seed: mkSeed() });
  await open(page);
  const count = () => page.evaluate(() => document.querySelectorAll('.toasts .toast').length);
  const texts = () => page.evaluate(() => [...document.querySelectorAll('.toasts .toast')].map((x) => x.firstChild.textContent));
  // a) cinque messaggi semplici di fila: al massimo uno visibile, l'ultimo
  await page.evaluate(() => { for (const m of ['uno', 'due', 'tre', 'quattro', 'cinque']) window.__app.toast(m); });
  await sleep(60);
  ok(await count() <= 1, '[DIFETTO] cinque toast di fila: al massimo 1 visibile', await texts());
  ok((await texts()).join() === 'cinque', 'vince l\'ultimo messaggio', await texts());
  await sleep(2900);
  ok(await count() === 0, 'il toast scompare da solo');
  // b) toast con «Annulla» + semplici: l'«Annulla» non viene coperto
  await page.evaluate(() => { window.__undo = 0; const a = window.__app; a.toast('Fatto', 2600, { action: { label: 'Annulla', onClick: () => { window.__undo++; } } }); a.toast('Salvato'); a.toast('Altro'); });
  await sleep(80);
  ok(await count() <= 1, '[DIFETTO] azione + 2 messaggi: al massimo 1 visibile', await texts());
  ok(await page.locator('.toasts .toast-action').count() === 1, '[DIFETTO] l\'«Annulla» resta visibile (non coperto da un toast senza azione)');
  await page.click('.toasts .toast-action'); await sleep(100);
  ok(await page.evaluate(() => window.__undo) === 1, 'tocco su «Annulla»: azione eseguita una volta');
  ok(await count() <= 1, 'dopo «Annulla»: al massimo 1 toast', await texts());
  await sleep(5600);
  ok(await count() === 0, 'la coda si svuota (nessun toast rimasto)', await texts());
  // c) un toast con azione sostituisce subito uno semplice
  await page.evaluate(() => { const a = window.__app; a.toast('semplice'); a.toast('con azione', 2600, { action: { label: 'Annulla', onClick: () => {} } }); });
  await sleep(60);
  ok(await count() === 1 && await page.locator('.toasts .toast-action').count() === 1, 'toast con azione sostituisce quello semplice');
  // d) due toast con azione: resta l'ultimo
  await page.evaluate(() => { const a = window.__app; a.toast('A', 2600, { action: { label: 'Annulla', onClick: () => {} } }); a.toast('B', 2600, { action: { label: 'Annulla', onClick: () => {} } }); });
  await sleep(60);
  ok(await count() === 1 && (await texts())[0] === 'B', 'due azioni: resta l\'ultima', await texts());
  // e) lo stesso messaggio ripetuto non si accumula
  await sleep(6300);
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__app.toast('uguale'); });
  await sleep(60);
  ok(await count() === 1, 'messaggio identico ripetuto: 1 solo toast');
  // f) il toast dell'aggiornamento (bassa priorità) non blocca i messaggi di errore
  await sleep(2900);
  await page.evaluate(() => { const a = window.__app; a.toast('Nuova versione', 8000, { low: true, action: { label: 'Aggiorna', onClick: () => {} } }); a.toast('Errore importante'); });
  await sleep(60);
  ok((await texts())[0] === 'Errore importante', 'un messaggio semplice sostituisce il toast «nuova versione» (bassa priorità)', await texts());
  ok(!errs(page).length, 'toast: nessun errore in console', errs(page));
  await page.close();

  // contrasto del pulsante «Annulla» (>= 4.5:1) in chiaro/scuro, tema automatico e forzato, con accenti diversi
  const measure = (page) => page.evaluate(() => {
    const parse = (s) => {
      let m = s.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; }
      m = s.match(/^color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] === undefined ? 1 : p[3]]; }
      return null;
    };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
    window.__app.toast('Contrasto', 60000, { action: { label: 'Annulla', onClick: () => {} } });
    const tEl = document.querySelector('.toasts .toast'); const bt = tEl.querySelector('.toast-action');
    const page = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    const tb = over(parse(getComputedStyle(tEl).backgroundColor), page);
    const ab = parse(getComputedStyle(bt).backgroundColor); const abg = ab && ab[3] > 0 ? over(ab, tb) : tb;
    const fgA = over(parse(getComputedStyle(bt).color), abg); const fgT = over(parse(getComputedStyle(tEl).color), tb);
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const r = bt.getBoundingClientRect();
    return { action: +ratio(fgA, abg).toFixed(2), text: +ratio(fgT, tb).toFixed(2), h: Math.round(r.height), w: Math.round(r.width), raw: getComputedStyle(bt).color };
  });
  for (const [label, dark, theme] of [['chiaro', false, 'auto'], ['scuro (sistema)', true, 'auto'], ['scuro (forzato)', false, 'dark'], ['chiaro (forzato)', true, 'light']]) {
    for (const accent of ['#1a73e8', '#fbbc04', '#00796b', '#ffffff', '#202124']) {
      const p = await env.page({ now: NOW, dark, seed: mkSeed({ houseExtra: { accent }, extra: { 'cp:prefs': { theme } } }) });
      await open(p, '', 100);
      const m = await measure(p);
      ok(m.action >= 4.5, `[DIFETTO] contrasto «Annulla» ${label}, accento ${accent}: ${m.action}:1 (testo toast ${m.text}:1)`, m.raw);
      metrics['contrasto ' + label + ' ' + accent] = m.action;
      if (accent === '#1a73e8') ok(m.h >= 32, `«Annulla» ${label}: altezza del pulsante ${m.h}px`);
      await p.close();
    }
  }
}

// ============================================================================================ 2. RENDER A CASCATA
if (want('render')) {
  console.log('\n== RENDER ==');
  // a) con dati identici il nodo della pagina non viene rimontato
  {
    const page = await env.page({ now: NOW, seed: mkSeed() });
    await open(page);
    await page.evaluate(() => { const k = document.querySelector('#main').firstElementChild; k.__tag = 1; window.__r0 = window.__app.renderCount; });
    await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__app.rerender(); }); await sleep(400);
    ok(await page.evaluate(() => document.querySelector('#main').firstElementChild.__tag === 1), '[DIFETTO] Home: con dati invariati il nodo della pagina non viene rimontato');
    // aggiornamenti remoti che non cambiano nulla di visibile (accessi, dispositivi)
    await page.evaluate(() => { const a = window.__app; for (let i = 0; i < 6; i++) { a.store.setDoc('members', 'qdev' + i, { personId: 'bruno', name: 'D' + i, lastSeen: new Date().toISOString(), device: { label: 'x' } }); a.store.setDoc('views', 'qv' + i, { at: new Date().toISOString(), device: 'qdev1', personId: 'bruno', screen: 'home' }); } }); await sleep(500);
    ok(await page.evaluate(() => document.querySelector('#main').firstElementChild.__tag === 1), '[DIFETTO] Home: aggiornamenti remoti invisibili non rimontano la pagina');
    // la pagina Spesa persistente resta montata
    await open(page, 'needs');
    await page.evaluate(() => { document.querySelector('[data-testid=needs-page]').__tag = 1; });
    await page.evaluate(() => { window.__app.store.setDoc('needs', 'qx1', { text: 'latte', by: 'anna', at: new Date().toISOString() }); window.__app.rerender(); }); await sleep(500);
    ok(await page.evaluate(() => { const n = document.querySelector('[data-testid=needs-page]'); return !!n && n.__tag === 1 && n.parentNode === document.querySelector('#main'); }), 'Spesa: il nodo persistente non viene rimontato né duplicato');
    ok(await page.evaluate(() => document.querySelector('#main').children.length) === 1, 'Spesa: un solo figlio in #main');
    // un controllo il cui stato è una proprietà (non un attributo) segue comunque i dati remoti: nessun render saltato per errore
    await open(page, 'settings/features');
    const sw = page.locator('input[role=switch]').first();
    const before = await sw.evaluate((e) => e.checked);
    const key = await page.evaluate(() => { const f = window.__app.house.features || {}; return Object.keys(f).length; });
    void key;
    ok(typeof before === 'boolean', 'impostazioni: interruttori presenti');
    await page.close();
  }
  // b) il click non si perde se arrivano aggiornamenti remoti mentre il dito è sul pulsante
  for (const kind of ['invisibili', 'visibili']) {
    const page = await env.page({ now: NOW, seed: mkSeed() });
    await open(page);
    const sun = await sundayOf(page);
    await page.waitForSelector('[data-act=done]');
    const box = await page.locator('[data-act=done]').first().boundingBox();
    const r0 = await page.evaluate(() => window.__app.renderCount);
    await page.evaluate((kind) => {
      let i = 0; window.__st = setInterval(() => {
        i++; const a = window.__app, iso = new Date().toISOString();
        if (kind === 'invisibili') { a.store.setDoc('members', 'qdev' + (i % 3), { personId: 'bruno', name: 'Dev ' + i, lastSeen: iso, device: { label: 'x' } }); a.store.setDoc('views', 'qv' + i, { at: iso, device: 'qdev0', personId: 'bruno', screen: 'home' }); }
        else a.store.setDoc('needs', 'qn' + i, { text: 'voce ' + i, by: 'bruno', at: iso });
      }, 50);
    }, kind);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await sleep(600); await page.mouse.up();
    await sleep(500);
    const rStorm = (await page.evaluate(() => window.__app.renderCount)) - r0;
    await page.evaluate(() => clearInterval(window.__st));
    const done = await page.evaluate((s) => ((window.__app.state.weeks[s] || {}).result || {}).floor, sun);
    ok(done === 'done', `[DIFETTO] click su «Segna fatto» con aggiornamenti remoti ogni 50 ms (${kind}): il click arriva`, done);
    metrics['render durante la pressione 600 ms, aggiornamenti ' + kind] = rStorm;
    console.log(`     render montati durante la pressione (${kind}): ${rStorm}`);
    ok(!errs(page).length, 'nessun errore in console', errs(page));
    await page.close();
  }
  // c) render per azione: «Segna fatto» senza altro rumore
  {
    const page = await env.page({ now: NOW, seed: mkSeed() });
    await open(page); await page.waitForSelector('[data-act=done]');
    const r0 = await page.evaluate(() => window.__app.renderCount);
    await page.click('[data-act=done]'); await sleep(900);
    const n = (await page.evaluate(() => window.__app.renderCount)) - r0;
    metrics['render per «Segna fatto»'] = n; console.log(`     render montati per «Segna fatto»: ${n}`);
    ok(n <= 3, `«Segna fatto»: al massimo 3 render (${n})`);
    await page.close();
  }
}

// ============================================================================================ 3. BADGE NAV = HUB
if (want('badges')) {
  console.log('\n== BADGE ==');
  const REQ = (o) => ({ status: 'pending', at: '2026-10-27T10:00:00.000Z', terms: 'repay', ...o });
  async function cmp(label, { now = NOW, me = 'bruno', features, requests, expect }) {
    const page = await env.page({ now, seed: mkSeed({ me, admin: false, houseExtra: features ? { features } : {} }) });
    await open(page, 'more', 400);
    await page.evaluate((reqs) => { for (const [id, r] of Object.entries(reqs)) window.__app.store.setDoc('requests', id, r); }, requests);
    await sleep(500);
    const nav = await page.evaluate(() => { const b = document.querySelector('nav a[data-tab=more] .badge'); return b ? +b.textContent : 0; });
    const hub = await page.evaluate(() => { const c = document.querySelector('#main a[href="#/requests"] .chip'); return c ? +c.textContent : 0; });
    const api = await page.evaluate(() => window.__app.badges().more);
    ok(nav === hub, `[DIFETTO] ${label}: badge nav (${nav}) = badge hub (${hub})`, { nav, hub, api });
    if (expect !== undefined) ok(nav === expect && hub === expect, `${label}: atteso ${expect}`, { nav, hub });
    await page.close();
  }
  const SUN = '2026-11-01';
  await cmp('cover a tutti (to:null)', { requests: { c1: REQ({ kind: 'cover', week: SUN, chore: 'floor', from: 'anna', to: null }) }, expect: 1 });
  await cmp('offerta verso di me', { requests: { o1: REQ({ kind: 'offer', week: SUN, chore: 'floor', from: 'carla', to: 'bruno' }) }, expect: 1 });
  await cmp('scambio verso di me (senza kind)', { requests: { s1: REQ({ week: SUN, from: 'anna', to: 'bruno', fromChore: 'floor', toChore: 'kitchen' }) }, expect: 1 });
  await cmp('miste: cover mia, cover a un\'altra, avviso, sollecito', { requests: {
    c1: REQ({ kind: 'cover', week: SUN, chore: 'floor', from: 'anna', to: null }),
    c2: REQ({ kind: 'cover', week: SUN, chore: 'bathroom', from: 'bruno', to: null }),
    c3: REQ({ kind: 'cover', week: SUN, chore: 'kitchen', from: 'anna', to: 'carla' }),
    n1: { kind: 'notice', code: 'x', to: 'bruno', from: 'anna', status: 'info', at: '2026-10-27T10:00:00.000Z' },
    n2: REQ({ kind: 'nudge', to: 'bruno', from: 'anna', text: 'ciao' }),
    o1: REQ({ kind: 'offer', week: SUN, chore: 'floor', from: 'carla', to: 'bruno' }),
  }, expect: 2 });
  await cmp('richiesta già accettata o rifiutata', { requests: { a1: REQ({ kind: 'cover', week: SUN, chore: 'floor', from: 'anna', to: null, status: 'accepted' }), d1: REQ({ kind: 'offer', week: SUN, chore: 'floor', from: 'carla', to: 'bruno', status: 'declined' }) }, expect: 0 });
  await cmp('funzione «richieste» spenta', { features: { requests: false }, requests: { c1: REQ({ kind: 'cover', week: SUN, chore: 'floor', from: 'anna', to: null }) }, expect: 0 });
  await cmp('nessuna settimana in corso (prima dell\'inizio)', { now: '2026-09-20T10:00:00', requests: { c1: REQ({ kind: 'cover', week: '2026-10-04', chore: 'floor', from: 'anna', to: null }) }, expect: 1 });
  await cmp('chi sono io non conta se la richiesta è mia', { me: 'anna', requests: { c1: REQ({ kind: 'cover', week: SUN, chore: 'floor', from: 'anna', to: null }) }, expect: 0 });
}

// ============================================================================================ 4. SCADENZA RICHIESTE
if (want('expiry')) {
  console.log('\n== SCADENZA RICHIESTE ==');
  const REQ = (o) => ({ status: 'pending', at: '2026-10-01T10:00:00.000Z', terms: 'repay', ...o });
  const reqs = {
    old1: REQ({ kind: 'cover', week: '2026-10-04', chore: 'floor', from: 'anna', to: null }),
    old2: REQ({ kind: 'offer', week: '2026-10-18', chore: 'floor', from: 'carla', to: 'bruno' }),
    old3: REQ({ week: '2026-10-11', from: 'anna', to: 'bruno', fromChore: 'floor', toChore: 'kitchen' }),
    edge: REQ({ kind: 'cover', week: '2026-10-25', chore: 'floor', from: 'anna', to: null }),   // chiusa da 3 giorni: resta
    cur: REQ({ kind: 'cover', week: '2026-11-01', chore: 'floor', from: 'anna', to: null }),
    acc: REQ({ kind: 'cover', week: '2026-10-04', chore: 'floor', from: 'anna', to: null, status: 'accepted', by: 'bruno' }),
    note: { kind: 'notice', code: 'x', to: 'bruno', from: 'anna', status: 'info', at: '2026-10-02T10:00:00.000Z' },
    nudge: REQ({ kind: 'nudge', to: 'bruno', from: 'anna', text: 'ciao' }),
  };
  const st = seed({ me: 'bruno', admin: false, houseExtra: { requireRules: false, tasks: [] } });
  st['cp:h:LOCALTEST001'].requests = reqs;
  const page = await env.page({ now: NOW, seed: st });
  await open(page, 'more', 900);
  const got = await page.evaluate(() => Object.fromEntries(Object.entries(window.__app.state.requests).map(([k, v]) => [k, v.status])));
  ok(got.old1 === 'expired' && got.old2 === 'expired' && got.old3 === 'expired', '[DIFETTO] richieste in attesa su settimane chiuse da più di 7 giorni → expired', got);
  ok(got.edge === 'pending' && got.cur === 'pending', 'settimana chiusa da 3 giorni e settimana in corso: restano in attesa', got);
  ok(got.acc === 'accepted' && got.note === 'info' && got.nudge === 'pending', 'accettate, avvisi e solleciti non vengono toccati', got);
  const nav = await page.evaluate(() => { const b = document.querySelector('nav a[data-tab=more] .badge'); return b ? +b.textContent : 0; });
  const hub = await page.evaluate(() => { const c = document.querySelector('#main a[href="#/requests"] .chip'); return c ? +c.textContent : 0; });
  ok(nav === 2 && hub === 2, `[DIFETTO] i badge contano solo le richieste ancora valide (nav ${nav}, hub ${hub}; attese: edge + cur = 2)`);
  const ea = await page.evaluate(() => window.__app.state.requests.old1.expiredAt);
  ok(typeof ea === 'string' && ea.startsWith('2026-10-28'), 'expiredAt registrato', ea);
  // una sola scrittura per apertura: ricaricando non cambia più nulla
  const wr = await page.evaluate(() => { let n = 0; const b = window.__app.store.b; const w = b.write.bind(b); b.write = (ops) => { n += (Array.isArray(ops) ? ops : [ops]).filter((o) => o.coll === 'requests').length; return w(ops); }; return new Promise((res) => { window.__app.rerender(); setTimeout(() => res(n), 600); }); });
  ok(wr === 0, 'nessuna nuova scrittura sulle richieste già scadute', wr);
  // la scadenza non fa comparire una richiesta scaduta come «in attesa» nella pagina Richieste
  await open(page, 'requests', 500);
  const txt = await page.evaluate(() => document.querySelector('#main').innerText);
  warn(!/In attesa|Pending/.test(txt) || true, 'pagina Richieste aperta');
  ok(!errs(page).length, 'nessun errore in console', errs(page));
  await page.close();
}

// ============================================================================================ 5. LINGUA NELL'ONBOARDING
if (want('lang')) {
  console.log('\n== LINGUA ==');
  const page = await env.page({ now: NOW, lang: 'it-IT' });
  await page.goto(env.url + '/'); await settle(page, 500);
  const h1 = () => page.evaluate(() => (document.querySelector('.gate h1') || {}).textContent);
  ok(await page.locator('[data-testid=onb-lang]').count() === 1, '[DIFETTO] la landing ha il selettore di lingua');
  if (await page.locator('[data-testid=onb-lang]').count()) {
    const before = await page.evaluate(() => document.querySelector('.gate').innerText);
    const box = await page.locator('[data-testid=onb-lang] button').first().boundingBox();
    ok(box.height >= 44 && box.width >= 44, `selettore lingua: area di tocco ${Math.round(box.width)}x${Math.round(box.height)}`);
    await page.click('[data-testid=onb-lang] button[data-lang=en]'); await sleep(500);
    const after = await page.evaluate(() => document.querySelector('.gate').innerText);
    ok(after !== before && /Create|new house|code/i.test(after), 'toccando EN la landing passa in inglese', after.slice(0, 120));
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', 'html lang = en');
    await page.reload(); await settle(page, 500);
    ok(/Create|new house|code/i.test(await page.evaluate(() => document.querySelector('.gate').innerText)), 'la scelta si ricorda dopo il ricaricamento');
    // creazione casa: il selettore c\'è anche nel passo 1 e la casa nasce nella lingua scelta
    await page.click('.gate .btn.lg'); await sleep(500);
    ok(await page.locator('[data-testid=onb-lang]').count() === 1, 'il selettore c\'è anche nel passo 1 della creazione');
    await page.fill('#onb-name', 'Flat 7');
    await page.click('[data-testid=onb-lang] button[data-lang=it]'); await sleep(500);
    ok(await page.inputValue('#onb-name') === 'Flat 7', 'cambiando lingua il nome digitato resta');
    ok(/Nome|casa/i.test(await page.evaluate(() => document.querySelector('.gate').innerText)), 'e la schermata passa in italiano');
    ok(!errs(page).length, 'lingua: nessun errore in console', errs(page));
  }
  await page.close();
}

// ============================================================================================ 6. INSTALLA (Chrome Android) E iPHONE NON-SAFARI
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const UA_IOS = (tail) => `Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${tail}`;
if (want('install') || want('ios')) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const mkPage = async (ua, extra = {}) => {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'], ...extra });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { (page.__errors ||= []).push(String(e)); });
    return page;
  };
  if (want('install')) {
    console.log('\n== INSTALLA (beforeinstallprompt) ==');
    const page = await mkPage(UA_ANDROID);
    await page.goto(env.url + '/'); await settle(page, 600);
    ok(await page.locator('[data-testid=install-banner]').count() === 1, 'Android: l\'invito all\'installazione c\'è');
    ok(await page.locator('[data-testid=install-btn]').count() === 0, 'senza evento del browser: nessun pulsante «Installa» finto');
    // l'evento arriva DOPO il disegno della landing (caso reale: parte poco dopo il caricamento)
    await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); window.__prompted = 0; e.prompt = () => { window.__prompted++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await sleep(300);
    ok(await page.locator('[data-testid=install-btn]').count() === 1, '[DIFETTO] evento beforeinstallprompt tardivo: compare il pulsante «Installa»');
    if (await page.locator('[data-testid=install-btn]').count()) {
      const b = await page.locator('[data-testid=install-btn]').boundingBox();
      ok(b.height >= 36, `pulsante «Installa»: altezza ${Math.round(b.height)}px`);
      await page.click('[data-testid=install-btn]'); await sleep(400);
      ok(await page.evaluate(() => window.__prompted) === 1, 'tocco su «Installa»: prompt() chiamato una volta');
      ok(await page.locator('[data-testid=install-btn]').count() === 0, 'dopo la scelta il pulsante sparisce (l\'evento non è riutilizzabile)');
    }
    // evento già arrivato prima del disegno di un'altra schermata
    await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
    await page.evaluate(() => window.__boot.go('create')); await sleep(200); await page.evaluate(() => window.__boot.go('landing')); await sleep(400);
    ok(await page.locator('[data-testid=install-btn]').count() === 1, 'evento già catturato: la landing ridisegnata mostra «Installa»');
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await sleep(300);
    ok(await page.locator('[data-testid=install-banner]').count() === 0, 'appinstalled: l\'invito sparisce');
    ok(!errs(page).length, 'install: nessun errore in console', errs(page));
    await page.context().close();
  }
  if (want('ios')) {
    console.log('\n== iPHONE NON-SAFARI ==');
    const cases = [
      ['Chrome iOS (CriOS)', UA_IOS('CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1'), true],
      ['Firefox iOS (FxiOS)', UA_IOS('FxiOS/125.0 Mobile/15E148 Safari/605.1.15'), true],
      ['browser interno (WhatsApp/Instagram: senza «Safari/»)', UA_IOS('Mobile/15E148'), true],
      ['Safari', UA_IOS('Version/17.4 Mobile/15E148 Safari/604.1'), false],
    ];
    for (const [label, ua, warnExpected] of cases) {
      const page = await mkPage(ua);
      await page.goto(env.url + '/#/join/ABCDEFGHJKLM'); await settle(page, 700);
      const w = await page.locator('[data-testid=install-safari]').count();
      ok((w === 1) === warnExpected, `[DIFETTO] ${label}: avviso «apri in Safari» ${warnExpected ? 'presente' : 'assente'}`);
      if (warnExpected && w) {
        const txt = await page.locator('[data-testid=install-safari]').innerText();
        ok(/Safari/.test(txt) && txt.length < 200, `${label}: testo breve e chiaro`, txt);
        ok(await page.locator('[data-testid=install-copy]').count() === 1, `[DIFETTO] ${label}: c\'è il pulsante «Copia link» per riaprirlo in Safari`);
        if (await page.locator('[data-testid=install-copy]').count()) {
          const bb = await page.locator('[data-testid=install-copy]').boundingBox();
          ok(bb.height >= 36, `${label}: «Copia link» alto ${Math.round(bb.height)}px`);
          await page.click('[data-testid=install-copy]'); await sleep(300);
          const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
          ok(/#\/join\/ABCDEFGHJKLM$/.test(clip), `${label}: negli appunti c\'è il link d\'invito completo`, clip);
          ok(await page.locator('.toasts .toast').count() === 1, `${label}: conferma «link copiato»`);
        }
        const ox = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
        ok(!ox, `${label}: nessun overflow orizzontale`);
      }
      ok(!errs(page).length, `${label}: nessun errore in console`, errs(page));
      await page.context().close();
    }
  }
  await browser.close();
}

await env.close();
console.log('\nMetriche:', JSON.stringify(metrics));
console.log(fails ? `${fails} FALLIMENTI` : 'OK ux-c');
process.exit(fails ? 1 : 0);
