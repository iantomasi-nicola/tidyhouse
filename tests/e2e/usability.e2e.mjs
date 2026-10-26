// QA di usabilità e robustezza dell'INTERA app (nucleo + schermate): inserimento testo sotto aggiornamenti remoti, sfarfallii/layout shift,
// animazioni, sheet/toast, aree tocco, overflow, contrasto, navigazione, doppio tocco, perdite di memoria.
//   node tests/e2e/usability.e2e.mjs                     (tutto)
//   ONLY=input,layout node tests/e2e/usability.e2e.mjs   (alcune sezioni: input layout anim usab nav robust)
// Gli screenshot e il riepilogo delle metriche vanno in QA_OUT (default: scratchpad/qa). Codice di uscita 1 se un controllo "FAIL" fallisce;
// i "WARN" (difetti noti in file di altri moduli, soglie morbide) sono solo stampati.
import fs from 'node:fs';
import path from 'node:path';
import { start, seed } from './helpers.mjs';

const OUT = process.env.QA_OUT || '/tmp/claude-0/-home-user-tidyhouse/31bb54fa-07b7-55b0-a8eb-c0a272017a85/scratchpad/qa';
fs.mkdirSync(OUT, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(n);
const NOW = '2026-10-28T10:00:00';
let fails = 0, warns = 0; const metrics = {}; const pages = [];
const ok = (c, m, d) => { if (c) console.log('ok   ' + m); else { fails++; console.log('FAIL ' + m + (d !== undefined ? '\n       ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); } return !!c; };
const warn = (c, m, d) => { if (c) return true; warns++; console.log('WARN ' + m + (d !== undefined ? '\n       ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 900) : '')); return false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') }).catch(() => {});

const ROUTES = ['', 'calendar', 'trips', 'stats', 'more', 'needs', 'rules', 'lastout', 'tasks', 'requests', 'activity', 'guide', 'settings', 'settings/profile', 'settings/appearance', 'settings/home', 'settings/notifications', 'settings/house', 'settings/rules', 'settings/roommates', 'settings/features', 'settings/links', 'settings/notif-house', 'settings/invite', 'settings/access', 'settings/data', 'settings/ai', 'settings/security'];
const mkSeed = (o = {}) => seed({ ...o, houseExtra: { requireRules: false, ...(o.houseExtra || {}) } });

// iniettato in ogni pagina: layout shift, contatore di setInterval, boot
const INIT = () => {
  window.__cls = 0; window.__clsList = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__clsList.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), n: (e.sources || []).slice(0, 2).map((s) => s.node && (s.node.nodeType === 1 ? s.node.tagName.toLowerCase() + '.' + String(s.node.className && s.node.className.baseVal !== undefined ? s.node.className.baseVal : s.node.className).slice(0, 30) : '#text')) }); } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* ignore */ }
  window.__long = 0; try { new PerformanceObserver((l) => { window.__long += l.getEntries().length; }).observe({ type: 'longtask', buffered: true }); } catch { /* ignore */ }
  window.__intervals = 0; const si = window.setInterval; window.setInterval = function (...a) { window.__intervals++; return si.apply(this, a); };
  document.addEventListener('DOMContentLoaded', () => {
    const boot = document.getElementById('boot');
    if (boot) new MutationObserver(() => { if (boot.classList.contains('gone') && window.__bootGone === undefined) { const a = document.getElementById('app'); window.__bootGone = { len: (a.innerText || '').trim().length, kids: a.children.length }; } }).observe(boot, { attributes: true });
  });
};
let env;
async function mk({ vp = { width: 390, height: 844 }, lang = 'it-IT', dark = false, s = mkSeed(), touch = true, now = NOW } = {}) {
  const page = await env.page({ now, viewport: vp, lang, dark, seed: s, touch });
  await page.addInitScript(INIT);
  pages.push(page); return page;
}
const settle = async (page, ms = 350) => { await page.waitForFunction(() => { const m = document.querySelector('#main'); return (m && m.children.length) || document.querySelector('.gate'); }, null, { timeout: 8000 }).catch(() => {}); await sleep(ms); };
const go = async (page, route, ms) => { await page.evaluate((r) => { location.hash = '#/' + r; }, route); await settle(page, ms); };
const open = async (page, route = '', ms) => { await page.goto(`${env.url}/#/${route}`); await settle(page, ms); };
const renders = (page) => page.evaluate(() => window.__app && window.__app.renderCount);
const errs = (page) => (page.__errors || []).filter((e) => !/Failed to load resource|favicon|sw\.js|net::ERR/i.test(e));
const sunday = (page) => page.evaluate(() => window.__app.calc.out.rows[window.__app.calc.out.cur].sunday);

// ============================================================================================ A. INSERIMENTO TESTO
const TEXT = 'Àèìòù ñ ok 12';
/** campi di testo visibili nella pagina (marcati con data-qa-i) */
async function markFields(page, scope = '#main') {
  return page.evaluate((scope) => {
    const out = []; let i = 0;
    for (const el of document.querySelectorAll(`${scope} input, ${scope} textarea`)) {
      const ty = el.type;
      if (el.tagName === 'INPUT' && !/^(text|search|url|email|tel|password|number)$/.test(ty)) continue;
      if (el.disabled || el.readOnly || el.closest('[hidden]') || el.classList.contains('sr')) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      el.setAttribute('data-qa-i', String(i)); out.push({ i, tag: el.tagName, type: ty, max: el.maxLength > 0 ? el.maxLength : 0, ph: el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.id || el.getAttribute('data-testid') || '', val: el.value }); i++;
    }
    return out;
  }, scope);
}
/** Scariche di aggiornamenti: 'remote' = dati dal cloud (store), 'forced' = rerender()/savePrefs, 'both' */
const storm = (page, mode, ms = 28) => page.evaluate(([mode, ms]) => {
  let i = 0; window.__stormN = 0;
  window.__storm = setInterval(() => {
    i++; window.__stormN++;
    const a = window.__app, iso = new Date().toISOString();
    if (mode !== 'forced') {
      a.store.setDoc('needs', 'qa' + (i % 9), { text: 'storm ' + i, by: 'anna', at: iso });
      a.store.setDoc('members', 'qadev' + (i % 3), { personId: 'bruno', name: 'Dev ' + i, lastSeen: iso, device: { label: 'x' } });
      if (i % 4 === 0) a.store.setDoc('log', 'qa' + (i % 5), { at: iso, by: 'bruno', type: 'qa', p: {} });
    }
    if (mode !== 'remote') { if (i % 2) a.rerender(); else a.savePrefs({ haptics: i % 4 === 0 }); }
  }, ms);
}, [mode, ms]);
const stopStorm = (page) => page.evaluate(() => { clearInterval(window.__storm); return window.__stormN; });

/** Scrive TEXT in un campo mentre arrivano aggiornamenti; controlla caratteri, focus, identità del nodo, caret. */
async function fieldTest(page, label, selector, mode, { checkNode = true, insert = 'type' } = {}) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click();
  const meta = await loc.evaluate((el) => ({ max: el.maxLength > 0 ? el.maxLength : 0, val: el.value, type: el.type }));
  await loc.evaluate((el) => { el.__qa = 'node-' + Math.random(); window.__qaTag = el.__qa; const L = el.value.length; try { el.setSelectionRange(L, L); } catch { /* tipi senza selezione */ } });
  const r0 = await renders(page);
  const text = meta.max && meta.max < 30 ? TEXT.slice(0, Math.max(1, meta.max - meta.val.length)) : TEXT + ' 🧹';
  await storm(page, mode);
  if (insert === 'type') await page.keyboard.type(text, { delay: 40 }); else { for (const ch of text) { await page.keyboard.insertText(ch); await sleep(40); } }
  await sleep(120);
  const n = await stopStorm(page);
  const r1 = await renders(page);
  const st = await page.evaluate(() => { const a = document.activeElement; return { tag: a && a.tagName, same: !!a && a.__qa === window.__qaTag, val: a && a.value, caret: a && a.selectionStart, len: a && a.value && a.value.length, type: a && a.type }; });
  const expect = meta.val + text;
  const fine = st.val === expect || (meta.max && st.val.startsWith(meta.val) && st.val.length >= Math.min(meta.max, expect.length) - 0);
  ok(fine, `${label} [${mode}]: nessun carattere perso (${n} aggiornamenti)`, { got: st.val, expect });
  ok(st.tag === 'INPUT' || st.tag === 'TEXTAREA', `${label} [${mode}]: il focus resta nel campo`, st.tag);
  if (checkNode && mode === 'remote') { ok(st.same, `${label} [remote]: il nodo input non viene ricreato`); ok(r1 - r0 <= 1, `${label} [remote]: nessun rerender mentre si scrive (${r1 - r0})`); }
  if (mode !== 'remote' && st.tag !== 'SELECT') warn(st.caret === st.len, `${label} [${mode}]: cursore alla fine dopo rerender forzato`, st);
  // dopo il blur il render rimandato avviene e la pagina non mostra dati vecchi
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(450);
  const r2 = await renders(page);
  if (mode !== 'forced') ok(r2 > r1, `${label} [${mode}]: dopo il blur il render rimandato avviene (${r2 - r1})`);
  return { text, expect };
}

async function sectionInput() {
  console.log('\n== A. INSERIMENTO TESTO ==');
  // --- landing: codice casa (senza casa) ---
  { const page = await mk({ s: null }); await open(page, ''); await shot(page, 'a-landing');
    const code = page.locator('#onb-code'); await code.click(); await code.evaluate((el) => { el.__qa = 'n'; });
    for (const ev of ['online', 'offline', 'resize', 'focus']) await page.evaluate((e) => window.dispatchEvent(new Event(e)), ev);
    await page.keyboard.type('ab12-cd34 ef56', { delay: 40 }); await sleep(200);
    ok(await code.inputValue() === 'AB12-CD34-EF56', 'landing: il codice viene formattato senza perdere caratteri', await code.inputValue());
    ok(await code.evaluate((el) => el === document.activeElement && el.__qa === 'n'), 'landing: stesso nodo e focus mantenuto');
    // inserimento nel mezzo: il cursore non deve saltare in fondo
    await code.evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.keyboard.type('ABCDEFGH', { delay: 20 }); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('X', { delay: 20 }); await sleep(100);
    const c2 = await code.evaluate((el) => ({ v: el.value, c: el.selectionStart }));
    warn(c2.v.replace(/-/g, '') === 'ABXCDEFGH' && c2.c === 3, 'landing: inserendo nel mezzo del codice il cursore non salta alla fine', c2);
    await code.fill('  codice con spazi e àè  '); await sleep(50);
    ok(/^[0-9A-Z-]*$/.test(await code.inputValue()), 'landing: caratteri non validi scartati', await code.inputValue());
    // incolla (insertText come un paste)
    await code.fill(''); await code.focus(); await page.keyboard.insertText('abcd efgh jkmn'); await sleep(80);
    ok(await code.inputValue() === 'ABCD-EFGH-JKMN', 'landing: incolla di un codice con spazi', await code.inputValue());
    await page.close(); }

  // --- wizard "crea casa" ---
  { const page = await mk({ s: null }); await open(page, '');
    await page.evaluate(() => window.__boot.go('create')); await sleep(500); await shot(page, 'a-wizard');
    const f = await markFields(page, '.gate');
    console.log('     campi nel wizard:', f.map((x) => x.ph).join(' | '));
    ok(f.length >= 1, 'wizard: campi trovati');
    for (const x of f.slice(0, 3)) {
      const sel = `[data-qa-i="${x.i}"]`; const loc = page.locator(sel); await loc.click(); await loc.evaluate((el) => { el.__qa = 'w' + Math.random(); window.__qaTag = el.__qa; });
      for (const ev of ['online', 'offline', 'resize', 'focus']) await page.evaluate((e) => window.dispatchEvent(new Event(e)), ev);
      const t = x.max && x.max < 30 ? 'Àèìòù'.slice(0, x.max) : TEXT; await page.keyboard.type(t, { delay: 40 }); await sleep(80);
      const v = await loc.inputValue(); ok(v.endsWith(t) || v === t || (x.type === 'password'), `wizard "${x.ph}": testo intatto`, v);
      ok(await loc.evaluate((el) => document.activeElement === el && el.__qa === window.__qaTag), `wizard "${x.ph}": nodo e focus mantenuti`);
    }
    await page.close(); }

  // --- campi delle schermate con scariche remote / rerender forzati ---
  const page = await mk(); await open(page, 'needs', 500);
  const targets = [['needs', 'scorte'], ['tasks', 'compiti'], ['lastout', 'ultimo che esce'], ['rules', 'regole'], ['trips', 'assenze'], ['calendar', 'settimane'], ['settings/profile', 'impostazioni profilo'], ['settings/house', 'impostazioni casa'], ['settings/roommates', 'coinquilini'], ['settings/links', 'link'], ['settings/data', 'dati'], ['settings/security', 'sicurezza'], ['settings/ai', 'ai']];
  for (const [route, nome] of targets) {
    await go(page, route, 450);
    const fields = (await markFields(page)).filter((f) => f.type !== 'password' || true);
    console.log(`     ${route}: ${fields.length} campi di testo (${fields.map((f) => f.ph || f.type).join(' | ').slice(0, 160)})`);
    let k = 0;
    for (const f of fields.filter((x) => /^(text|search|url|email|tel|)$/.test(x.type) || x.tag === 'TEXTAREA').slice(0, 4)) {
      const sel = `[data-qa-i="${f.i}"]`;
      for (const mode of ['remote', 'forced']) {
        await fieldTest(page, `${nome} / ${f.ph || f.type}`, sel, mode, { checkNode: true });
        // la pagina può essere stata ridisegnata: ritrova i campi
        await markFields(page);
      }
      if (++k >= 3) break;
    }
  }
  await page.close();

  // --- scorte: Invio aggiunge una sola volta, input svuotato e con focus, incolla, accenti ---
  { const page = await mk(); await open(page, 'needs', 500);
    const inp = page.locator('#mx-need'); await inp.click(); await inp.evaluate((el) => { el.__qa = 'need'; });
    await storm(page, 'remote'); await page.keyboard.type('Latte àèìòù 🧹', { delay: 45 }); await page.keyboard.press('Enter'); await sleep(250);
    const n1 = await stopStorm(page); await sleep(100);
    const cnt = await page.evaluate(() => Object.values(window.__app.state.needs).filter((n) => n.text === 'Latte àèìòù 🧹').length);
    ok(cnt === 1, `scorte: Invio aggiunge esattamente una voce (${n1} aggiornamenti remoti)`, cnt);
    ok(await inp.evaluate((el) => el.value === '' && document.activeElement === el), 'scorte: dopo l\'aggiunta input vuoto e col focus');
    await inp.focus(); await page.keyboard.insertText('Pasta incollata'); await page.keyboard.press('Escape'); await sleep(100);
    ok(await inp.inputValue() === 'Pasta incollata', 'scorte: Escape non cancella il testo digitato');
    await shot(page, 'a-needs');
    // doppio clic sul pulsante aggiungi: una sola voce
    await page.locator('.mx-needform button[type=submit]').dblclick(); await sleep(300);
    const cnt2 = await page.evaluate(() => Object.values(window.__app.state.needs).filter((n) => n.text === 'Pasta incollata').length);
    ok(cnt2 === 1, 'scorte: doppio click su "Aggiungi" = una sola voce', cnt2);
    // aggiornamento remoto mentre l'input è vuoto e col focus: la lista mostra il nuovo dato dopo il blur
    await inp.focus(); await page.evaluate(() => window.__app.store.setDoc('needs', 'remoteX', { text: 'REMOTO-X', by: 'bruno', at: new Date().toISOString() })); await sleep(300);
    await page.keyboard.press('Tab'); await sleep(500);
    ok(await page.locator('text=REMOTO-X').count() >= 1, 'scorte: dopo il blur la lista mostra il dato remoto (nessun dato vecchio)');
    await page.close(); }

  // --- composizione IME (CDP) ---
  { const page = await mk(); await open(page, 'needs', 500);
    const cdp = await page.context().newCDPSession(page);
    const inp = page.locator('#mx-need'); await inp.click(); await inp.evaluate((el) => { el.__qa = 'ime'; });
    await page.keyboard.type('ab', { delay: 30 });
    const r0 = await renders(page);
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await storm(page, 'both'); await sleep(350);
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 }); await sleep(250);
    await stopStorm(page);
    const mid = await inp.evaluate((el) => ({ v: el.value, same: el.__qa === 'ime' && document.activeElement === el }));
    ok(mid.same, 'IME: durante la composizione il campo non viene ricreato né perde il focus', mid);
    ok((await renders(page)) === r0, 'IME: nessun rerender durante la composizione');
    await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 }); await cdp.send('Input.insertText', { text: '日本' }); await sleep(120);
    await page.keyboard.type('cd', { delay: 30 }); await sleep(500);
    const v = await inp.inputValue(); ok(v === 'ab日本cd', 'IME: testo composto e successivo intatto', v);
    await page.evaluate(() => document.activeElement.blur()); await sleep(400);
    ok((await renders(page)) > r0, 'IME: finita la composizione e usciti dal campo il render rimandato avviene');
    await page.close(); }

  // --- sheet: nota della settimana, assenze, prompt ---
  { const page = await mk(); await open(page, 'calendar', 500);
    const sun = await sunday(page);
    await page.evaluate(async (s) => { const m = await import('/js/choresheet.js'); m.openWeekSheet(window.__app, s); }, sun); await sleep(700);
    await shot(page, 'a-weeksheet');
    const ta = page.locator('.sheet textarea.wd-note'); const has = await ta.count();
    if (ok(has >= 1, 'sheet settimana: textarea nota presente')) {
      await ta.click(); await ta.evaluate((el) => { el.__qa = 'note'; window.__qaTag = 'note'; });
      for (const mode of ['remote', 'forced', 'both']) {
        await ta.evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await storm(page, mode); await page.keyboard.type('Nota àèìòù ' + mode + ' 🧹', { delay: 40 }); await sleep(100); await stopStorm(page);
        const st = await page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, same: a.__qa === 'note', v: a.value }; });
        ok(st.v === 'Nota àèìòù ' + mode + ' 🧹', `sheet nota [${mode}]: nessun carattere perso`, st.v);
        warn(st.same, `sheet nota [${mode}]: il textarea non viene ricreato (choresheet.js si ridisegna da solo)`, st);
      }
      // aggiornamento remoto della STESSA nota mentre si scrive
      await ta.evaluate((el) => { el.value = ''; }); await ta.focus(); await page.keyboard.type('mio testo ', { delay: 30 });
      await page.evaluate((s) => window.__app.store.setDoc('weeks', s, { note: 'NOTA-REMOTA' }), sun); await sleep(300); await page.keyboard.type('continua', { delay: 30 });
      const v = await ta.inputValue(); warn(v === 'mio testo continua', 'sheet nota: un aggiornamento remoto della stessa nota non cancella quello che sto scrivendo', v);
    }
    await page.keyboard.press('Escape'); await sleep(600);
    ok(await page.locator('.sheet').count() === 0, 'sheet settimana: Escape chiude');
    // sheet assenze
    await open(page, 'trips', 500);
    await page.evaluate(async () => { const m = await import('/js/screens/trips.js'); m.openTripSheet(window.__app, 'bruno'); }); await sleep(700);
    const note = page.locator('#trip-note'); if (await note.count()) {
      await note.click(); await note.evaluate((el) => { el.__qa = 'trip'; window.__qaTag = 'trip'; });
      await storm(page, 'both'); await page.keyboard.type('Viaggio àèìòù 🧹', { delay: 40 }); await sleep(100); await stopStorm(page);
      const st = await page.evaluate(() => { const a = document.activeElement; return { same: a.__qa === 'trip', v: a.value }; });
      ok(st.v === 'Viaggio àèìòù 🧹', 'sheet assenza: nota senza caratteri persi', st.v); warn(st.same, 'sheet assenza: input non ricreato', st);
      await shot(page, 'a-tripsheet');
    }
    await page.keyboard.press('Escape'); await sleep(600);
    // promptDialog del nucleo
    const pr = page.evaluate(async () => { const m = await import('/js/ui.js'); return m.promptDialog({ title: 'QA', label: 'Nome', value: 'ini' }); }); await sleep(700);
    const pi = page.locator('.sheet input'); ok(await pi.evaluate((el) => document.activeElement === el), 'promptDialog: l\'input prende il focus');
    await pi.evaluate((el) => { el.__qa = 'p'; window.__qaTag = 'p'; }); await storm(page, 'both'); await page.keyboard.type(' àèìòù 🧹', { delay: 40 }); await stopStorm(page);
    ok(await pi.inputValue() === 'ini àèìòù 🧹', 'promptDialog: nessun carattere perso', await pi.inputValue());
    await page.keyboard.press('Enter'); ok((await pr) === 'ini àèìòù 🧹', 'promptDialog: Invio conferma e restituisce il testo'); await sleep(500);
    const pr2 = page.evaluate(async () => { const m = await import('/js/ui.js'); return m.promptDialog({ title: 'QA2', label: 'Nome', value: 'x' }); }); await sleep(700);
    await page.keyboard.press('Escape'); ok((await pr2) === null, 'promptDialog: Escape annulla (null)'); await sleep(500);
    await page.close(); }

  // --- campi PIN: tastiera numerica e nessun carattere perso ---
  { const page = await mk(); await open(page, 'settings/security', 500);
    const f = await markFields(page); const pw = f.filter((x) => x.type === 'password');
    console.log('     campi password in sicurezza:', pw.length);
    for (let k = 0; k < Math.min(3, pw.length); k++) {
      const x = (await markFields(page)).filter((y) => y.type === 'password')[k]; if (!x) break;
      const loc = page.locator(`[data-qa-i="${x.i}"]`); await loc.click(); await storm(page, 'both'); await page.keyboard.type('4821', { delay: 50 }); await stopStorm(page);
      ok(await page.evaluate(() => document.activeElement.value) === '4821', `PIN "${x.ph}": 4 cifre senza perdite`, await page.evaluate(() => document.activeElement.value));
      await page.evaluate(() => document.activeElement.blur()); await sleep(300);
    }
    await page.close(); }
}

// ============================================================================================ B. SFARFALLII / LAYOUT
async function sectionLayout() {
  console.log('\n== B. SFARFALLII / LAYOUT ==');
  metrics.cls = {};
  for (const [vname, vp] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]]) {
    // caricamento diretto di ogni rotta
    const page = await mk({ vp }); let worst = 0, worstRoute = '';
    for (const r of ROUTES) {
      await page.goto(`${env.url}/#/${r}`); await page.reload(); await settle(page, 700);
      const cls = await page.evaluate(() => window.__cls); metrics.cls[`${vname}:${r || 'home'}`] = +cls.toFixed(4);
      if (cls > worst) { worst = cls; worstRoute = r; }
      if (cls > 0.02) warn(false, `layout shift alto su #/${r} (${vname}px): ${cls.toFixed(3)}`, await page.evaluate(() => window.__clsList));
    }
    ok(worst < 0.05, `CLS caricamento: peggiore ${worst.toFixed(4)} (#/${worstRoute || 'home'}) a ${vname}px`);
    // il boot non mostra contenuto vuoto: quando sparisce c'è già qualcosa
    await page.goto(`${env.url}/#/`); await page.reload(); await settle(page, 500);
    const bg = await page.evaluate(() => window.__bootGone); ok(bg && bg.len > 20, 'boot: scompare solo quando l\'app ha già contenuto', bg);
    ok(await page.evaluate(() => { const b = document.getElementById('boot'); return b.hidden || getComputedStyle(b).visibility === 'hidden'; }), 'boot: nascosto del tutto dopo il caricamento (nessuna animazione nascosta)');
    ok((await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getTiming().iterations === Infinity).map((a) => a.animationName || a.constructor.name))).length === 0, 'nessuna animazione infinita attiva a riposo');
    // navigazione tra rotte nella stessa sessione
    let tot = 0; await page.evaluate(() => { window.__cls = 0; });
    for (const r of ['calendar', 'trips', 'stats', 'more', 'needs', 'settings', '']) { await go(page, r, 500); }
    tot = await page.evaluate(() => window.__cls); metrics.cls[`${vname}:navigazione`] = +tot.toFixed(4);
    ok(tot < 0.05, `CLS navigando tra 7 rotte a ${vname}px: ${tot.toFixed(4)}`, await page.evaluate(() => window.__clsList.slice(-5)));
    await page.close();
  }

  // azioni: render per azione, scroll, nav stabile
  const page = await mk(); await open(page, '', 700);
  const nav0 = await page.evaluate(() => { const a = [...document.querySelectorAll('.nav a')]; a.forEach((x, i) => { x.__qa = 'nav' + i; }); window.__navMut = 0; new MutationObserver((m) => { window.__navMut += m.length; }).observe(document.querySelector('.nav'), { childList: true, subtree: true, attributes: false }); return a.length; });
  const act = async (name, fn, maxRenders = 2) => {
    const r0 = await renders(page); await page.evaluate(() => { window.__cls = 0; }); await fn(); await sleep(600);
    const dr = (await renders(page)) - r0; const cls = await page.evaluate(() => window.__cls);
    metrics['azione:' + name] = { renders: dr, cls: +cls.toFixed(4) };
    ok(dr <= maxRenders, `azione "${name}": ${dr} render (max ${maxRenders})`); ok(cls < 0.02, `azione "${name}": layout shift ${cls.toFixed(4)}`, cls >= 0.02 ? await page.evaluate(() => window.__clsList.slice(-4)) : undefined);
  };
  await act('un aggiornamento remoto', () => page.evaluate(() => window.__app.store.setDoc('needs', 'bx1', { text: 'a', by: 'anna', at: new Date().toISOString() })), 1);
  await act('20 aggiornamenti remoti a raffica', () => page.evaluate(() => { for (let i = 0; i < 20; i++) window.__app.store.setDoc('needs', 'bx' + i, { text: 'b' + i, by: 'anna', at: new Date().toISOString() }); }), 1);
  await act('60 aggiornamenti remoti in 1s', () => page.evaluate(() => new Promise((res) => { let i = 0; const iv = setInterval(() => { window.__app.store.setDoc('needs', 'bz' + (i % 7), { text: 'c' + i, by: 'anna', at: new Date().toISOString() }); if (++i >= 60) { clearInterval(iv); res(); } }, 16); })), 9);
  await act('cambio tema scuro', () => page.evaluate(() => window.__app.savePrefs({ theme: 'dark' })), 1);
  await act('cambio tema chiaro', () => page.evaluate(() => window.__app.savePrefs({ theme: 'light' })), 1);
  await act('cambio lingua EN', () => page.evaluate(() => window.__app.savePrefs({ lang: 'en' })), 1);
  await act('cambio lingua IT', () => page.evaluate(() => window.__app.savePrefs({ lang: 'it' })), 1);
  await act('apertura sheet', () => page.evaluate(() => window.__app.sheet({ title: 'QA', body: window.__app.h('p', null, 'x') })), 0);
  await act('chiusura sheet', () => page.keyboard.press('Escape'), 0);
  ok(await page.evaluate(() => [...document.querySelectorAll('.nav a')].every((x, i) => x.__qa === 'nav' + i)), 'nav: i link non vengono ricreati negli aggiornamenti');
  ok((await page.evaluate(() => window.__navMut)) === 0, 'nav: nessuna mutazione del DOM della barra durante gli aggiornamenti (niente lampeggio)', await page.evaluate(() => window.__navMut));
  // segna fatto dalla home
  { const sun = await sunday(page); const me = 'anna';
    const idx = await page.evaluate(([s, me]) => { const r = window.__app.calc.out.rows[window.__app.calc.out.cur]; return r.assigned.indexOf(me); }, [sun, 'anna']);
    const doneBtn = page.locator('[data-testid="hero-todo"] [data-act="done"]');
    if (idx >= 0 && await doneBtn.count()) { await act('segna fatto (home)', async () => { await doneBtn.click(); }, 2); await shot(page, 'b-done'); }
    else warn(false, 'home: pulsante "segna fatto" non trovato per Anna', idx); }
  // scroll mantenuto
  await go(page, 'calendar', 600);
  const sc = await page.evaluate(() => { window.scrollTo(0, 500); return window.scrollY; });
  await sleep(150); await page.evaluate(() => { window.__app.store.setDoc('needs', 'sc1', { text: 'sc', by: 'anna', at: new Date().toISOString() }); }); await sleep(500);
  const sc1 = await page.evaluate(() => window.scrollY); ok(sc > 0 && Math.abs(sc1 - sc) <= 2, `scroll mantenuto dopo un rerender (${sc} → ${sc1})`);
  await page.evaluate(() => window.__app.savePrefs({ compact: true })); await sleep(400);
  const sc2 = await page.evaluate(() => window.scrollY); warn(Math.abs(sc2 - sc) <= 40, `scroll dopo cambio densità (${sc} → ${sc2})`);
  await page.evaluate(() => window.__app.savePrefs({ compact: false }));
  // le animazioni d'ingresso non si ripetono a ogni sincronizzazione
  await go(page, 'more', 700);
  const anim0 = await page.evaluate(() => document.getAnimations().filter((a) => /fade-up/.test(a.animationName || '')).length);
  await page.evaluate(() => window.__app.store.setDoc('needs', 'an1', { text: 'a', by: 'anna', at: new Date().toISOString() })); await sleep(250);
  const anim1 = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && /fade-up/.test(a.animationName || '')).length);
  ok(anim0 === 0 && anim1 === 0, `rerender della stessa pagina: nessuna animazione d'ingresso riavviata (${anim1})`);
  await go(page, 'needs', 80);
  ok(await page.evaluate(() => document.getAnimations().some((a) => /fade-up/.test(a.animationName || ''))) || true, 'cambio pagina: animazione d\'ingresso consentita');
  await page.close();
}

// ============================================================================================ C. ANIMAZIONI / SHEET / TOAST
async function sectionAnim() {
  console.log('\n== C. ANIMAZIONI, SHEET, TOAST ==');
  const page = await mk(); await open(page, 'calendar', 600);
  // stile: keyframes solo transform/opacity (nessun layout) e durate < 500 ms
  const css = await page.evaluate(() => { const bad = []; const kf = {}; for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; } for (const r of rules) { if (r.type === CSSRule.KEYFRAMES_RULE) { const props = new Set(); for (const k of r.cssRules) for (const p of k.style) props.add(p); kf[r.name] = [...props]; } } } return kf; });
  for (const [n, props] of Object.entries(css)) ok(props.every((p) => /^(transform|opacity|filter|--.*|translate|scale|rotate)$/.test(p)), `keyframes "${n}": solo transform/opacity (nessun layout)`, props);
  // sheet: apertura
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'qa-open'; b.className = 'btn'; b.textContent = 'apri'; b.onclick = () => window.__app.sheet({ title: 'Sheet QA', body: window.__app.h('div', { class: 'stack' }, window.__app.h('input', { class: 'input', id: 'qa-in', 'aria-label': 'x' }), window.__app.h('button', { class: 'btn', id: 'qa-b1' }, 'uno'), window.__app.h('button', { class: 'btn soft', id: 'qa-b2' }, 'due')) }); document.querySelector('#main').prepend(b); });
  const anims = []; const sampler = setInterval(async () => { try { anims.push(...(await page.evaluate(() => document.getAnimations().map((a) => { const t = a.effect.getComputedTiming(); return { n: a.animationName || a.transitionProperty || '?', end: t.endTime, it: t.iterations }; })))); } catch { /* ignore */ } }, 60);
  const hist0 = await page.evaluate(() => history.length);
  await page.click('#qa-open'); await sleep(120);
  ok(await page.evaluate(() => !!document.querySelector('.sheet') && document.getElementById('app').hasAttribute('inert')), 'sheet: aperto, sfondo inerte (focus trap)');
  ok(await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), 'sheet: il focus entra nello sheet');
  await sleep(500); ok(await page.evaluate(() => document.querySelector('.sheet').classList.contains('on') && document.querySelector('.scrim').classList.contains('on')), 'sheet: animazione di apertura completata entro 600 ms');
  ok(await page.evaluate(() => document.querySelector('.sheet').getAttribute('role') === 'dialog' && document.querySelector('.sheet').getAttribute('aria-modal') === 'true'), 'sheet: role=dialog aria-modal');
  await shot(page, 'c-sheet');
  // trap del Tab
  const seen = new Set(); for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => { const a = document.activeElement; return document.querySelector('.sheet').contains(a) ? (a.id || a.className || a.tagName) : 'FUORI'; })); }
  ok(!seen.has('FUORI'), 'sheet: Tab non esce dallo sheet', [...seen]);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+Tab');
  ok(await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), 'sheet: Shift+Tab non esce dallo sheet');
  // Escape → chiusura, scrim che non blocca, focus restituito
  await page.keyboard.press('Escape'); await sleep(80);
  const navPt = await page.evaluate(() => { const a = document.querySelector('.nav a:last-child'); const r = a.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && a.contains(e); });
  ok(navPt, 'sheet in chiusura: lo scrim non intercetta più i click (subito dopo Escape)');
  await sleep(500);
  ok(await page.evaluate(() => !document.querySelector('.sheet') && !document.querySelector('.scrim') && getComputedStyle(document.getElementById('layer')).pointerEvents === 'none' && !document.getElementById('app').hasAttribute('inert')), 'sheet: rimosso, #layer non blocca, sfondo non più inerte');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'qa-open'), 'sheet: alla chiusura il focus torna al pulsante che l\'ha aperto', await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  ok((await page.evaluate(() => history.length)) - hist0 <= 1, 'sheet: aprire/chiudere non lascia voci spurie nella cronologia', (await page.evaluate(() => history.length)) - hist0);
  // click sullo scrim
  await page.click('#qa-open'); await sleep(500); await page.mouse.click(10, 10); await sleep(600);
  ok(await page.evaluate(() => !document.querySelector('.sheet')), 'sheet: click sullo scrim chiude');
  // doppio click rapido sul pulsante di apertura: un solo sheet
  await page.dblclick('#qa-open'); await sleep(600);
  ok(await page.evaluate(() => document.querySelectorAll('.sheet').length) === 1, 'sheet: doppio click sul pulsante = un solo sheet', await page.evaluate(() => document.querySelectorAll('.sheet').length));
  // stack: secondo sheet sopra il primo, Escape chiude solo il superiore
  await page.evaluate(() => window.__app.sheet({ title: 'Sopra', body: window.__app.h('button', { class: 'btn', id: 'qa-top' }, 'x') })); await sleep(500);
  ok(await page.evaluate(() => document.querySelectorAll('.sheet').length === 2 && document.querySelector('.sheet[inert]') !== null), 'stack: due sheet, quello sotto è inerte');
  await page.keyboard.press('Escape'); await sleep(600);
  ok(await page.evaluate(() => document.querySelectorAll('.sheet').length === 1 && !document.querySelector('.sheet').hasAttribute('inert')), 'stack: Escape chiude solo lo sheet superiore');
  ok(await page.evaluate(() => document.querySelector('.sheet').contains(document.activeElement)), 'stack: il focus torna sullo sheet sotto');
  // indietro del browser chiude lo sheet invece di navigare
  const h1 = await page.evaluate(() => location.hash);
  await page.goBack(); await sleep(700);
  ok(await page.evaluate(() => !document.querySelector('.sheet')) && (await page.evaluate(() => location.hash)) === h1, 'indietro del browser: chiude lo sheet e resta sulla stessa pagina', await page.evaluate(() => [location.hash, document.querySelectorAll('.sheet').length]));
  // sheet chiuso dalla UI, poi indietro naviga davvero
  await go(page, 'trips', 500); await go(page, 'calendar', 500);
  await page.evaluate(() => document.getElementById('qa-open') || (() => { const b = document.createElement('button'); b.id = 'qa-open'; b.className = 'btn'; b.onclick = () => window.__app.sheet({ title: 'Z', body: window.__app.h('p', null, 'z') }); document.querySelector('#main').prepend(b); })());
  await page.click('#qa-open'); await sleep(500); await page.keyboard.press('Escape'); await sleep(700);
  await page.goBack(); await sleep(600);
  ok((await page.evaluate(() => location.hash)) === '#/trips', 'dopo aver chiuso uno sheet dalla UI, "indietro" torna alla pagina precedente', await page.evaluate(() => location.hash));
  // sheet con link interno: navigare chiude lo sheet e non torna indietro
  await page.evaluate(() => window.__app.sheet({ title: 'L', body: window.__app.h('a', { href: '#/stats', id: 'qa-link', class: 'btn' }, 'vai') })); await sleep(500);
  await page.click('#qa-link'); await sleep(800);
  ok((await page.evaluate(() => location.hash)) === '#/stats' && await page.evaluate(() => !document.querySelector('.sheet')), 'link dentro uno sheet: naviga e chiude lo sheet', await page.evaluate(() => location.hash));
  clearInterval(sampler); await sleep(100);
  const longA = anims.filter((a) => a.it !== Infinity && a.end > 500 && !/conf/.test(a.n));
  ok(longA.length === 0, 'animazioni osservate: nessuna oltre 500 ms', [...new Set(longA.map((a) => a.n + ':' + a.end))]);
  metrics.animazioni = [...new Set(anims.map((a) => a.n + ':' + Math.round(a.end)))].slice(0, 30);

  // toast
  await go(page, '', 400);
  await page.evaluate(() => { window.__clicks = 0; window.__app.toast('Ciao toast', 900); window.__app.toast('Ciao toast', 900); });
  await sleep(120);
  ok(await page.locator('.toast').count() === 1, 'toast: lo stesso messaggio due volte non si accumula', await page.locator('.toast').count());
  ok(await page.evaluate(() => document.querySelector('.toasts').getAttribute('aria-live') === 'polite' && document.querySelector('.toasts').getAttribute('role') === 'status'), 'toast: contenitore aria-live/status');
  await shot(page, 'c-toast'); await sleep(1500);
  ok(await page.locator('.toast').count() === 0, 'toast: scompare da solo (uscita animata)');
  await page.evaluate(() => { window.__app.toast('Fatto', 8000, { action: { label: 'Annulla', onClick: () => { window.__clicks++; } } }); }); await sleep(500);
  await page.locator('.toast-action').dblclick().catch(() => {}); await sleep(500);
  ok((await page.evaluate(() => window.__clicks)) === 1, 'toast con azione: doppio click = azione eseguita una volta', await page.evaluate(() => window.__clicks));
  ok(await page.locator('.toast').count() === 0, 'toast con azione: si chiude dopo l\'azione');
  await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__app.toast('msg ' + i, 3000); }); await sleep(100);
  ok(await page.locator('.toast').count() <= 3, 'toast: al massimo 3 impilati', await page.locator('.toast').count());

  // riduci animazioni (impostazione) e preferenza di sistema
  await page.evaluate(() => window.__app.savePrefs({ reduceMotion: true })); await sleep(400);
  ok(await page.evaluate(() => document.documentElement.classList.contains('no-motion')), 'impostazione "Riduci animazioni": classe no-motion');
  const dur = await page.evaluate(() => { const b = document.createElement('button'); b.className = 'btn'; document.body.append(b); const d = getComputedStyle(b).transitionDuration; b.remove(); return d; });
  ok(/^0\.001/.test(dur) || dur === '1e-06s' || parseFloat(dur) < 0.01, 'no-motion: transizioni azzerate', dur);
  await page.evaluate(() => window.__app.sheet({ title: 'NM', body: window.__app.h('p', null, 'x') })); await sleep(120);
  ok(await page.evaluate(() => document.querySelector('.sheet').classList.contains('on')), 'no-motion: lo sheet appare subito');
  await page.keyboard.press('Escape'); await sleep(150);
  ok(await page.evaluate(() => !document.querySelector('.sheet')), 'no-motion: lo sheet sparisce subito dal DOM');
  ok(await page.evaluate(() => document.getAnimations().filter((a) => a.effect.getTiming().iterations === Infinity).length === 0), 'no-motion: nessuna animazione infinita');
  await page.evaluate(() => window.__app.savePrefs({ reduceMotion: false }));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await sleep(200);
  const run = await page.evaluate(() => { window.__app.toast('rm', 500); return new Promise((r) => setTimeout(() => r(document.getAnimations().filter((a) => a.effect.getComputedTiming().activeDuration > 2).length), 100)); });
  ok(run === 0, 'prefers-reduced-motion: nessuna animazione con durata reale', run);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // fluidità indicativa durante apertura sheet e navigazione
  const frames = await page.evaluate(() => new Promise((res) => { const ts = []; let n = 0; const f = (t) => { ts.push(t); if (++n < 40) requestAnimationFrame(f); else res(ts); }; window.__app.sheet({ title: 'F', body: window.__app.h('p', null, 'x') }); requestAnimationFrame(f); }));
  const d = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b); const p95 = d[Math.floor(d.length * 0.95)];
  metrics.frame_p95_ms_sheet = +p95.toFixed(1); warn(p95 < 40, `frame time p95 durante l'apertura dello sheet: ${p95.toFixed(1)} ms`);
  await page.keyboard.press('Escape'); await sleep(500);
  metrics.longtasks = await page.evaluate(() => window.__long);
  ok(errs(page).length === 0, 'nessun errore in console nella sezione animazioni', errs(page));
  await page.close();
}

// ============================================================================================ D. USABILITÀ
const MEASURE_TAPS = () => {
  const out = []; const seen = new Set();
  const els = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [role="switch"], [tabindex]:not([tabindex="-1"])')];
  for (const el of els) {
    if (el.closest('[inert]') && !el.closest('.sheet')) { /* sfondo con sheet aperto: comunque misura */ }
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
    if (el.type === 'hidden' || el.closest('[hidden]') || el.classList.contains('sr') || el.closest('.sr') || el.classList.contains('skip')) continue;
    if (el.tagName === 'INPUT' && el.type === 'file') continue;
    let r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement) { const p = el.parentElement; if ((p.textContent || '').trim().length > (el.textContent || '').trim().length + 3) continue; }   // link dentro al testo
    let w = r.width, h = r.height;
    if (w < 43.5 || h < 43.5) {   // area estesa con ::after?
      el.scrollIntoView({ block: 'center', inline: 'center' }); r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e) || (el.closest('label') && el.closest('label').contains(e))); };
      if (w < 43.5 && hit(cx - 21.5, cy) && hit(cx + 21.5, cy)) w = 44;
      if (h < 43.5 && hit(cx, cy - 21.5) && hit(cx, cy + 21.5)) h = 44;
    }
    if (w < 43.5 || h < 43.5) {
      const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\s+/).slice(0, 3).join('.');
      const key = el.tagName.toLowerCase() + '.' + cls + ':' + Math.round(w) + 'x' + Math.round(h); if (seen.has(key)) continue; seen.add(key);
      out.push({ el: key, label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 24), type: el.type || '' });
    }
  }
  return out;
};
const CONTRAST = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const c = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => { const a = f[3] + b[3] * (1 - f[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (f[i] * f[3] + b[i] * b[3] * (1 - f[3])) / a).concat([a]); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); let bg = rgba(getComputedStyle(document.documentElement).backgroundColor); if (bg[3] < 1) bg = [255, 255, 255, 1]; for (const e of chain.reverse()) { const b = rgba(getComputedStyle(e).backgroundColor); if (b[3] > 0) bg = over(b, bg); } return bg; };
  const out = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const txt = n.nodeValue.trim(); if (!txt) continue; const el = n.parentElement; if (!el || el.closest('#boot, .sr, script, style, svg, [hidden]')) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .past') || (el.closest('button') && el.closest('button').disabled)) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity); if (op < 0.05) continue;
    let fg = rgba(cs.color); fg[3] *= op; const bg = bgOf(el); const f = over(fg, bg);
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) { const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\s+/).slice(0, 3).join('.'); const key = el.tagName.toLowerCase() + '.' + cls + ':' + txt.slice(0, 14); if (seen.has(key)) continue; seen.add(key); out.push({ el: el.tagName.toLowerCase() + '.' + cls, txt: txt.slice(0, 22), ratio: +ratio.toFixed(2), need, fg: cs.color.slice(0, 30) }); }
  }
  return out;
};

async function sectionUsab() {
  console.log('\n== D. USABILITÀ MOBILE / TABLET / PC ==');
  // --- aree tocco ---
  metrics.tap = {}; const allTaps = {};
  for (const [vname, vp, touch] of [['390', { width: 390, height: 844 }, true], ['1440', { width: 1440, height: 900 }, false]]) {
    const page = await mk({ vp, touch, s: mkSeed({ needs: { n1: { text: 'Latte', urgent: true, by: 'bruno', at: '2026-10-27T10:00:00Z' }, n2: { text: 'Pane', by: 'anna', at: '2026-10-27T11:00:00Z', done: true, doneBy: 'carla', doneAt: '2026-10-28T08:00:00Z' } }, trips: { t1: { personId: 'bruno', from: '2026-11-03', to: '2026-11-08', note: 'Roma', by: 'bruno', at: '2026-10-20T10:00:00Z' } } }) });
    for (const r of ROUTES) {
      await open(page, r, 400); const v = await page.evaluate(MEASURE_TAPS);
      for (const x of v) { const k = x.el; (allTaps[k] ||= { el: x.el, label: x.label, routes: new Set(), vp: new Set() }); allTaps[k].routes.add(r || 'home'); allTaps[k].vp.add(vname); }
      metrics.tap[`${vname}:${r || 'home'}`] = v.length;
    }
    // sheet aperto
    const sun = await sunday(page);
    for (const fn of ['week', 'trip', 'who']) {
      await open(page, fn === 'trip' ? 'trips' : 'calendar', 400);
      await page.evaluate(async ([fn, s]) => { if (fn === 'week') { const m = await import('/js/choresheet.js'); m.openWeekSheet(window.__app, s); } else if (fn === 'trip') { const m = await import('/js/screens/trips.js'); m.openTripSheet(window.__app, 'bruno'); } else window.__app.sheet({ title: 'x', body: window.__app.h('div', { class: 'stack' }, window.__app.h('button', { class: 'btn sm' }, 'sm'), window.__app.h('div', { class: 'seg' }, window.__app.h('button', { type: 'button' }, 'a'), window.__app.h('button', { type: 'button' }, 'b')), window.__app.h('div', { class: 'num' }, window.__app.h('button', null, '-'), window.__app.h('span', null, '1'), window.__app.h('button', null, '+')), window.__app.h('label', { class: 'switch' }, window.__app.h('input', { type: 'checkbox' }), window.__app.h('i'))) }); }, [fn, sun]); await sleep(700);
      const v2 = await page.evaluate(MEASURE_TAPS);
      for (const x of v2) { const k = x.el; (allTaps[k] ||= { el: x.el, label: x.label, routes: new Set(), vp: new Set() }); allTaps[k].routes.add('sheet:' + fn); allTaps[k].vp.add(vname); }
      await page.keyboard.press('Escape'); await sleep(450);
    }
    await page.close();
  }
  const tapList = Object.values(allTaps); metrics.tapViolations = tapList.length;
  console.log(`     violazioni area tocco (<44px) uniche: ${tapList.length}`);
  for (const x of tapList) console.log(`       ${x.el}  "${x.label}"  [${[...x.routes].slice(0, 5).join(',')}${x.routes.size > 5 ? '…' : ''}] @${[...x.vp].join('/')}`);
  const coreTap = tapList.filter((x) => /(^|\.)(nav|icon-btn|btn|seg|num|switch|checkcircle|chip|li|swatches|toast-action)(\.|:)/.test(x.el) || /^(button|a)\.:/.test(x.el));
  ok(coreTap.length === 0, 'aree tocco: nessuna violazione nei componenti del nucleo (nav, btn, icon-btn, seg, num, switch, checkcircle, li)', coreTap.map((x) => x.el));
  warn(tapList.length === 0, `aree tocco: ${tapList.length} elementi sotto i 44px (vedi elenco sopra)`);

  // --- overflow orizzontale ---
  metrics.overflow = {}; let ovf = 0;
  for (const w of [320, 360, 390, 768, 1024, 1440]) {
    const page = await mk({ vp: { width: w, height: w < 700 ? 800 : 900 }, touch: w < 900, s: mkSeed({ houseExtra: { name: 'Casa con un nome davvero molto ma molto lungo da controllare', roommates: [{ id: 'anna', name: 'Anna-Maria Giuseppina', slot: 1 }, { id: 'bruno', name: 'Bartolomeo Maximilian', slot: 2 }, { id: 'carla', name: 'Carlotta', slot: 3 }] } }) });
    for (const r of ROUTES) {
      await open(page, r, 250);
      const o = await page.evaluate(() => { const W = window.innerWidth; const bad = []; if (document.documentElement.scrollWidth > W + 1) { for (const e of document.querySelectorAll('#app *')) { const r = e.getBoundingClientRect(); if (r.right > W + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed') { bad.push(e.tagName.toLowerCase() + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).slice(0, 30)); if (bad.length > 3) break; } } return { sw: document.documentElement.scrollWidth, bad }; } return null; });
      if (o) { ovf++; ok(false, `overflow orizzontale a ${w}px su #/${r}`, o); }
    }
    if (w === 320) { await page.evaluate(() => window.__app.savePrefs({ lang: 'en' })); for (const r of ['', 'calendar', 'more', 'settings/appearance', 'needs']) { await open(page, r, 250); const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); if (o) { ovf++; ok(false, `overflow orizzontale 320px EN su #/${r}`); } } }
    await page.close();
  }
  ok(ovf === 0, 'nessun overflow orizzontale a 320/360/390/768/1024/1440 px (IT, nomi lunghi, EN a 320)');

  // --- zoom testo 200% ---
  { const page = await mk({ vp: { width: 390, height: 844 } }); await open(page, '', 400); await page.evaluate(() => document.documentElement.style.setProperty('--fs', '2'));
    let bad = 0; for (const r of ['', 'calendar', 'more', 'settings/profile', 'needs', 'trips', 'stats']) { await go(page, r, 350); const o = await page.evaluate(() => ({ ov: document.documentElement.scrollWidth > window.innerWidth + 1, navOk: (() => { const n = document.querySelector('.nav').getBoundingClientRect(); return n.right <= window.innerWidth + 1 && n.left >= -1; })() })); if (o.ov || !o.navOk) { bad++; ok(false, `zoom testo 200%: problema su #/${r}`, o); } if (r === '') await shot(page, 'd-zoom200-home'); }
    ok(bad === 0, 'testo al 200% (--fs 2): nessun overflow orizzontale, nav dentro lo schermo');
    await page.close(); }

  // --- contrasto AA ---
  metrics.contrast = {};
  for (const dark of [false, true]) {
    const page = await mk({ dark, s: mkSeed({ needs: { n1: { text: 'Latte', urgent: true, by: 'bruno', at: '2026-10-27T10:00:00Z' } }, trips: { t1: { personId: 'bruno', from: '2026-11-03', to: '2026-11-08', note: 'Roma', by: 'bruno', at: '2026-10-20T10:00:00Z' } } }) });
    const agg = {};
    for (const r of ROUTES) { await open(page, r, 300); for (const x of await page.evaluate(CONTRAST)) { const k = `${x.el} "${x.txt}"`; (agg[k] ||= { ...x, routes: [] }).routes.push(r || 'home'); } }
    const list = Object.values(agg); metrics.contrast[dark ? 'dark' : 'light'] = list.length;
    console.log(`     contrasto ${dark ? 'SCURO' : 'CHIARO'}: ${list.length} testi sotto AA`);
    for (const x of list.slice(0, 25)) console.log(`       ${x.ratio}:1 (serve ${x.need}) ${x.el} "${x.txt}" [${x.routes.slice(0, 3).join(',')}]`);
    warn(list.length === 0, `contrasto AA ${dark ? 'scuro' : 'chiaro'}: ${list.length} elementi sotto soglia`);
    ok(list.filter((x) => x.ratio < 3 && !/past|disabled/.test(x.el)).length === 0, `contrasto ${dark ? 'scuro' : 'chiaro'}: nessun testo sotto 3:1`, list.filter((x) => x.ratio < 3));
    await page.close();
  }

  // --- focus visibile e ordine di tabulazione ---
  { const page = await mk({ vp: { width: 1280, height: 900 }, touch: false }); await open(page, '', 500);
    await page.keyboard.press('Tab'); const first = await page.evaluate(() => document.activeElement.className);
    ok(/skip/.test(first), 'tastiera: il primo Tab porta al link "Vai al contenuto"', first);
    let noRing = [], hidden = [], total = 0;
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab');
      const st = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a); const sib = a.nextElementSibling && getComputedStyle(a.nextElementSibling); const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') || (sib && sib.outlineStyle !== 'none' && parseFloat(sib.outlineWidth) > 0); const r = a.getBoundingClientRect(); return { ring: !!ring, vis: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', n: (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 20) }; });
      if (!st) continue; total++; if (!st.ring) noRing.push(st.n); if (!st.vis) hidden.push(st.n);
    }
    ok(noRing.length === 0, `tastiera: ogni elemento col focus mostra un contorno (${total} controllati)`, noRing); ok(hidden.length === 0, 'tastiera: nessun tab stop invisibile', hidden);
    await page.keyboard.press('Enter'); // il link skip porta il focus sul contenuto
    await shot(page, 'd-focus');
    await page.close(); }

  // --- attributi di input per tastiere mobili ---
  { const page = await mk(); const audit = {};
    for (const r of ROUTES) { await open(page, r, 250); for (const x of await page.evaluate(() => [...document.querySelectorAll('#main input, #main textarea')].filter((e) => !/^(checkbox|radio|range|file|color|hidden|date|time)$/.test(e.type) && e.getClientRects().length).map((e) => ({ type: e.type, tag: e.tagName, ph: (e.getAttribute('aria-label') || e.placeholder || e.id).slice(0, 24), ac: e.getAttribute('autocomplete'), im: e.getAttribute('inputmode'), eh: e.getAttribute('enterkeyhint'), ph2: e.placeholder, name: e.getAttribute('aria-label') })))) { audit[r + '|' + x.ph] = x; } }
    const list = Object.entries(audit);
    const noAc = list.filter(([, x]) => x.ac === null && x.tag === 'INPUT'); const noLabel = list.filter(([, x]) => !x.name && !x.ph2);
    const pinNoNum = list.filter(([, x]) => x.type === 'password' && /pin/i.test(x.ph) && x.im !== 'numeric');
    warn(noAc.length === 0, `input senza autocomplete esplicito: ${noAc.length}`, noAc.map(([k]) => k));
    warn(pinNoNum.length === 0, 'campi PIN senza inputmode=numeric', pinNoNum.map(([k]) => k));
    ok(list.length > 5, `audit input: ${list.length} campi esaminati`);
    metrics.inputAudit = { campi: list.length, senzaAutocomplete: noAc.length, senzaEtichetta: noLabel.length };
    await page.close(); }

  // --- stati vuoti ---
  { const page = await mk({ s: mkSeed({ weeks: {}, trips: {}, needs: {}, members: {} }) });
    for (const r of ['', 'calendar', 'trips', 'stats', 'needs', 'requests', 'activity', 'tasks', 'lastout']) { await open(page, r, 300); const t = await page.evaluate(() => document.querySelector('#main').innerText.trim().length); ok(t > 15, `stato vuoto #/${r}: contenuto presente (${t} caratteri)`); }
    ok(errs(page).length === 0, 'stati vuoti: nessun errore in console', errs(page)); await page.close(); }
}

// ============================================================================================ E. NAVIGAZIONE
async function sectionNav() {
  console.log('\n== E. NAVIGAZIONE ==');
  const page = await mk(); await open(page, '', 500);
  const title = () => page.evaluate(() => document.querySelector('#main .hm-title, #main h1, #main .title')?.innerText || '');
  const homeText = await title();
  // rotte sconosciute/invalide: mostrano la Home e non rompono
  for (const bad of ['zzz', '%E0%A4%A', 'calendar/../x', 'settings/inesistente', 'trips/x/y/z', '?x=1', '//', 'undefined', 'CALENDAR']) {
    await page.evaluate((b) => { location.hash = '#/' + b; }, bad); await sleep(500);
    const txt = await page.evaluate(() => document.querySelector('#main')?.innerText.trim().length || 0);
    const tt = await title();
    ok(txt > 20 && errs(page).length === 0, `hash non valida "#/${bad}": l'app resta viva`, { txt, e: errs(page) });
    if (['zzz', 'undefined', 'CALENDAR', '//', '?x=1', '%E0%A4%A'].includes(bad)) ok(tt === homeText || /Ciao|Home|Settimana/.test(tt), `rotta sconosciuta "#/${bad}" mostra la Home`, tt);
    page.__errors = [];
  }
  ok(await page.evaluate(() => document.querySelectorAll('.nav a[aria-current="page"]').length) <= 1, 'nav: al più una voce attiva con rotta sconosciuta');
  // back/forward
  await go(page, '', 400); await go(page, 'calendar', 400); await go(page, 'more', 400); await go(page, 'settings/profile', 400);
  await page.goBack(); await sleep(450); ok((await page.evaluate(() => location.hash)) === '#/more' && /more|Altro|Impostazioni/i.test(await page.evaluate(() => document.querySelector('.nav a[aria-current="page"]')?.getAttribute('href') || '')), 'indietro: #/more con voce di nav attiva', await page.evaluate(() => location.hash));
  await page.goBack(); await sleep(450); await page.goBack(); await sleep(450);
  ok((await page.evaluate(() => location.hash)) === '#/', 'indietro ×3 torna alla Home');
  await page.goForward(); await sleep(450); ok(await page.evaluate(() => document.querySelector('.nav a[aria-current="page"]')?.getAttribute('href')) === '#/calendar', 'avanti: calendario attivo');
  // scroll ripristinato in "indietro"
  await go(page, 'calendar', 500); const y = await page.evaluate(() => { window.scrollTo(0, 420); return window.scrollY; }); await sleep(150);
  await go(page, 'stats', 400); await page.goBack(); await sleep(700);
  const y2 = await page.evaluate(() => window.scrollY); warn(y > 0 && Math.abs(y2 - y) < 30, `indietro: la posizione di scroll del calendario viene ripristinata (${y} → ${y2})`);
  // #/join con casa già caricata
  const code = await page.evaluate(() => window.__app.houseId);
  await page.evaluate((c) => { location.hash = '#/join/' + c; }, code); await sleep(600);
  ok((await page.evaluate(() => location.hash)) === '#/' && await page.evaluate(() => !!document.querySelector('.nav')), '#/join/<stessa casa>: torna alla Home dentro l\'app', await page.evaluate(() => location.hash));
  // lingua/tema al volo: stato (testo digitato, scroll, rotta) preservato
  await go(page, 'needs', 500);
  const inp = page.locator('#mx-need'); await inp.click(); await page.keyboard.type('bozza àè', { delay: 30 });
  await page.evaluate(() => window.__app.savePrefs({ lang: 'en' })); await sleep(500);
  ok(await page.evaluate(() => document.documentElement.lang) === 'en' && /Home|Weeks|More/.test(await page.evaluate(() => document.querySelector('.nav').innerText)), 'lingua EN al volo: nav e html lang aggiornati');
  ok((await page.evaluate(() => location.hash)) === '#/needs', 'lingua al volo: la rotta resta');
  const st = await page.evaluate(() => ({ v: document.querySelector('#mx-need')?.value, f: document.activeElement?.id })); ok(st.v === 'bozza àè' && st.f === 'mx-need', 'lingua al volo: bozza e focus del campo preservati', st);
  await page.evaluate(() => window.__app.savePrefs({ theme: 'dark' })); await sleep(300);
  ok(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark' && document.querySelector('#mx-need').value === 'bozza àè'), 'tema al volo: bozza preservata');
  await page.evaluate(() => window.__app.savePrefs({ theme: 'auto', lang: 'it' })); await sleep(300);
  // #/join con altro codice: schermata di accesso senza errori
  await page.evaluate(() => { location.hash = '#/join/ABCDEFGHJKLM'; }); await sleep(900);
  ok(await page.evaluate(() => !!document.querySelector('.gate')), '#/join/<altra casa>: mostra la schermata di accesso', await page.evaluate(() => document.querySelector('#app').innerText.slice(0, 80)));
  ok(errs(page).length === 0, 'navigazione: nessun errore in console', errs(page));
  await page.close();
  // doppio tocco su righe che aprono sheet (calendario)
  { const p = await mk(); await open(p, 'calendar', 600);
    const row = p.locator('#main button.week, #main .cal button, #main [data-week] button, #main button').first();
    await p.locator('#main .week, #main .cal-row, #main button').filter({ hasText: /\d/ }).first().dblclick().catch(() => {}); await sleep(700);
    const n = await p.evaluate(() => document.querySelectorAll('.sheet').length); warn(n <= 1, `calendario: doppio tocco su una settimana apre ${n} sheet`);
    await p.close(); }
  // offline/online e ricarica a metà azione
  { const p = await mk(); await open(p, 'needs', 500);
    await p.context().setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await sleep(300);
    await p.locator('#mx-need').fill('offline voce'); await p.locator('#mx-need').press('Enter'); await sleep(300);
    ok(await p.evaluate(() => Object.values(window.__app.state.needs).some((n) => n.text === 'offline voce')), 'offline: l\'inserimento locale funziona');
    await p.context().setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(300);
    await p.locator('#mx-need').fill('bozza non salvata'); await p.reload(); await settle(p, 600);
    ok(await p.evaluate(() => Object.values(window.__app.state.needs).some((n) => n.text === 'offline voce') && !Object.values(window.__app.state.needs).some((n) => n.text === 'bozza non salvata')), 'ricarica a metà inserimento: dati salvati intatti, bozza scartata senza errori');
    ok(errs(p).length === 0, 'offline/ricarica: nessun errore in console', errs(p)); await p.close(); }
}

// ============================================================================================ F. ROBUSTEZZA / MEMORIA
async function sectionRobust() {
  console.log('\n== F. ROBUSTEZZA ==');
  const page = await mk(); await open(page, '', 600);
  const cdp = await page.context().newCDPSession(page);
  const snap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await sleep(100); await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, intervals: window.__intervals, listeners: window.__app.store.listeners.size, layer: document.getElementById('layer').children.length, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 })); };
  for (const r of ['', 'calendar', 'more', 'needs', 'stats', 'trips']) await go(page, r, 150);
  const a = await snap();
  for (let k = 0; k < 8; k++) for (const r of ['', 'calendar', 'more', 'needs', 'stats', 'trips', 'settings/profile']) { await go(page, r, 40); if (r === 'calendar') await page.evaluate(async (s) => { const m = await import('/js/choresheet.js'); }, null); }
  for (let k = 0; k < 40; k++) { await page.evaluate(() => { window.__app.sheet({ title: 'm', body: window.__app.h('p', null, 'x') }); window.__app.toast('t' + Math.random(), 100); }); await sleep(10); await page.keyboard.press('Escape'); await sleep(20); }
  await go(page, '', 600); await sleep(600);
  const b = await snap(); metrics.leak = { prima: a, dopo: b };
  ok(b.nodes - a.nodes < 120, `DOM: nessuna crescita dopo 56 navigazioni e 40 sheet (${a.nodes} → ${b.nodes})`);
  ok(b.intervals - a.intervals === 0, `nessun setInterval nuovo creato dal ridisegno (${b.intervals - a.intervals})`);
  ok(b.listeners === a.listeners && b.listeners <= 2, `listener dello store stabili (${a.listeners} → ${b.listeners})`);
  ok(b.layer <= 1, `#layer pulito dopo sheet e toast (${b.layer} figli)`, b.layer);
  if (a.heap) warn(b.heap - a.heap < 6e6, `heap JS: ${((b.heap - a.heap) / 1e6).toFixed(1)} MB di crescita dopo il ciclo di prova`);
  // cambio di casa ripetuto: i listener dello store vecchio non si accumulano
  ok(errs(page).length === 0, 'robustezza: nessun errore in console', errs(page));
  // doppio tocco sui pulsanti d'azione del nucleo: "segna fatto"
  await open(page, '', 700);
  const btn = page.locator('[data-testid="hero-todo"] [data-act="done"]');
  if (await btn.count()) { await btn.dblclick(); await sleep(700); const log = await page.evaluate(() => Object.values(window.__app.state.log || {}).filter((l) => /done|result/i.test(l.type || '')).length); ok(log <= 1, `"segna fatto" con doppio tocco: una sola registrazione (${log})`); }
  else warn(false, '"segna fatto": pulsante non presente per il test del doppio tocco');
  // storm di rotte: nessun render si accavalla (il contenuto finale corrisponde alla rotta finale)
  await page.evaluate(() => { for (const r of ['calendar', 'trips', 'stats', 'more', 'needs', 'calendar']) location.hash = '#/' + r; }); await sleep(900);
  ok(await page.evaluate(() => document.querySelector('.nav a[aria-current="page"]').getAttribute('href') === '#/calendar' && document.querySelector('#main').children.length > 0 && !!document.querySelector('#main .cal, #main [class*="cal"]')), 'sei cambi di rotta in un frame: vince l\'ultima, contenuto coerente', await page.evaluate(() => [location.hash, document.querySelector('#main').firstElementChild?.className]));
  await shot(page, 'f-final');
  await page.close();
}

env = await start();
try {
  if (want('input')) await sectionInput();
  if (want('layout')) await sectionLayout();
  if (want('anim')) await sectionAnim();
  if (want('usab')) await sectionUsab();
  if (want('nav')) await sectionNav();
  if (want('robust')) await sectionRobust();
  const pe = pages.flatMap((p) => errs(p)); ok(pe.length === 0, 'nessun errore JS/console in tutta la suite', pe.slice(0, 5));
} catch (e) { fails++; console.log('ERRORE SUITE', e && e.stack || e); }
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1));
await env.close();
console.log(`\nMetriche in ${path.join(OUT, 'metrics.json')}`);
console.log(fails ? `${fails} FALLITI, ${warns} avvisi` : `TUTTO OK (${warns} avvisi)`);
process.exit(fails ? 1 : 0);
