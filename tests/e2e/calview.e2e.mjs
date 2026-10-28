// E2E della lista Settimane con storico lungo (60 passate + corrente + 14 future): mesi richiudibili, riepiloghi,
// «Mostra altre», «Oggi», ritorno con «indietro», deep link, a11y, viewport, IT/EN. Esecuzione: node tests/e2e/calview.e2e.mjs
// Orologio finto: mer 2026-10-28 (corrente = settimana che chiude il 2026-11-01). Variabili: SHOTS=<cartella> per gli screenshot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start } from './helpers.mjs';
import { longSeed, NOW, CUR, addDays } from './calview-seed.mjs';

const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user-tidyhouse/c243bc09-3166-5024-8c63-241289e91a58/scratchpad/calview/';
fs.mkdirSync(SHOTS, { recursive: true });
const env = await start();

// casi per mese: set 2026 = 1 turno saltato; ago 2026 = due settimane senza risultati (6 turni saltati); ott 2026 = settimana non ancora registrata (tolleranza 10 giorni)
const SEED = { skips: ['2026-09-13'], blank: ['2026-08-09', '2026-08-16', '2026-10-18'], grace: 10 };
const monthOf = (sunday) => addDays(sunday, -3).slice(0, 7);

async function mk({ lang = 'it-IT', viewport = { width: 390, height: 844 }, dark = false, hash = '#/calendar', seedOpts = SEED, textSize = 1, me = 'anna', admin = true } = {}) {
  const page = await env.page({ now: NOW, viewport, lang, dark, seed: longSeed({ ...seedOpts, me, admin, houseExtra: lang === 'en-US' ? { lang: 'en' } : {} }) });
  page.__bad = [];
  page.on('response', (r) => { if (r.status() >= 400) page.__bad.push(r.status() + ' ' + r.url()); });
  await page.goto(env.url + '/' + hash);
  await page.waitForSelector('.cal', { timeout: 8000 });
  await page.waitForTimeout(350);
  if (textSize !== 1) { await page.evaluate((f) => window.__app.savePrefs({ textSize: f }), textSize); await page.waitForTimeout(300); }
  return page;
}
const noOverflow = async (page, label) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('#layer .sheet')].every((s) => s.scrollWidth <= s.clientWidth + 1)), 'overflow orizzontale: ' + label);
const noErrors = (page, label) => {
  const errs = (page.__errors || []).filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(errs, [], `errori in console (${label})`);
  assert.deepEqual((page.__bad || []).filter((u) => /(calendar|choresheet|strings\/cal)/.test(u)), [], `risorse mancanti (${label})`);
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const sheetOn = (page) => page.locator('#layer .sheet.on').count();
const months = (page) => page.evaluate(() => [...document.querySelectorAll('.cal-month')].map((m) => ({ key: m.dataset.month, open: m.querySelector('.cal-mh').getAttribute('aria-expanded') === 'true', text: m.querySelector('.cal-mh').innerText.replace(/\s+/g, ' ').trim(), rows: m.querySelectorAll('.week').length })));
const toggle = async (page, key) => { const b = page.locator(`[data-act=month][data-month="${key}"]`); await b.evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(120); await b.click(); await page.waitForTimeout(420); };
const closeSheet = async (page) => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#layer .sheet'), null, { timeout: 4000 }); await page.waitForTimeout(150); };

const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log('  ok   ' + name + ` (${Date.now() - t0}ms)`); }
  catch (e) { results.push([name, false]); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 7).join('\n       ')); }
}

await scenario('storico lungo: in alto corrente + 4 prossime per esteso, mesi passati chiusi con riepilogo', async () => {
  const page = await mk();
  assert.equal(await page.locator('.cal .week.cur').count(), 1);
  assert.equal(await page.locator('.cal .week:not(.compact)').count(), 5, 'corrente + 4 prossime per esteso');
  assert.equal(await page.locator('.cal .week.compact').count(), 1, 'solo la settimana scorsa è visibile tra le passate');
  assert.equal(await page.locator('.cal .week.compact').getAttribute('data-sunday'), '2026-10-25');
  const ms = await months(page);
  assert.equal(ms.length, 6, 'primi 6 mesi');
  assert.deepEqual(ms.map((m) => m.key), ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  assert.ok(ms.every((m) => !m.open && m.rows === 0), 'tutti chiusi e senza righe nel DOM');
  assert.match(ms[0].text, /^Ottobre 2026 3 settimane · 3 turni da registrare$/);
  assert.match(ms[1].text, /^Settembre 2026 4 settimane · 1 turno saltato$/);
  assert.match(ms[2].text, /^Agosto 2026 4 settimane · 6 turni saltati$/);
  assert.match(ms[3].text, /^Luglio 2026 5 settimane · tutto fatto$/);
  // a11y: bottoni dentro titoli h3, aria-controls punta a un elemento esistente
  assert.equal(await page.locator('h3 > button.cal-mh').count(), 6);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cal-mh')].every((b) => document.getElementById(b.getAttribute('aria-controls')))));
  await noOverflow(page, 'lista lunga');
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(h < 2300, 'altezza pagina contenuta: ' + h);
  await shot(page, 'long-390-light');
  noErrors(page, 'storico lungo'); await page.close();
});

await scenario('riepilogo per mese coerente con il motore (tutti i mesi, tutte le situazioni)', async () => {
  const page = await mk();
  while (await page.locator('[data-act=show-months]').count()) { await page.locator('[data-act=show-months]').evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.locator('[data-act=show-months]').click(); await page.waitForTimeout(200); }
  const exp = await page.evaluate(() => {
    const o = window.__app.calc.out; const by = {};
    const mo = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 3)).toISOString().slice(0, 7); };
    for (const r of o.rows.slice(0, o.cur - 1)) { const k = mo(r.sunday); (by[k] ||= { n: 0, sk: 0, pend: 0, played: 0 }); by[k].n++; if (r.status !== 'empty' && r.status !== 'none') { by[k].played++; by[k].sk += r.nSk; by[k].pend += r.nPend; } }
    return by;
  });
  const ms = await months(page);
  assert.equal(ms.length, Object.keys(exp).length);
  let saw = { ok: 0, skip: 0, log: 0 };
  for (const m of ms) {
    const e = exp[m.key]; assert.ok(e, 'mese atteso ' + m.key);
    assert.ok(m.text.includes(e.n === 1 ? '1 settimana' : `${e.n} settimane`), m.text);
    if (e.sk) { saw.skip++; assert.ok(m.text.includes(e.sk === 1 ? '1 turno saltato' : `${e.sk} turni saltati`), m.text); }
    if (e.pend) { saw.log++; assert.ok(m.text.includes(e.pend === 1 ? '1 turno da registrare' : `${e.pend} turni da registrare`), m.text); }
    if (!e.sk && !e.pend) { saw.ok++; assert.ok(m.text.includes('tutto fatto'), m.text); }
  }
  assert.ok(saw.ok > 5 && saw.skip === 2 && saw.log === 1, JSON.stringify(saw));
  assert.equal(await page.locator('[data-act=show-months]').count(), 0);
  noErrors(page, 'riepiloghi'); await page.close();
});

await scenario('apertura/chiusura mese: aria-expanded, righe compatte, tastiera, ordine dal più recente', async () => {
  const page = await mk();
  await toggle(page, '2026-09');
  let ms = await months(page);
  assert.deepEqual(ms.filter((m) => m.open).map((m) => m.key), ['2026-09']);
  assert.equal(ms[1].rows, 4);
  const order = await page.locator('[data-month="2026-09"] .week').evaluateAll((els) => els.map((e) => e.dataset.sunday));
  assert.deepEqual(order, ['2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06'], 'dal più recente');
  assert.match(await page.locator('.week[data-sunday="2026-09-13"]').innerText(), /Con salti/);
  assert.equal(await page.locator('.week[data-sunday="2026-09-13"] .ind.bad').count() > 0, true, 'icona del turno saltato');
  assert.match(await page.locator('.week[data-sunday="2026-09-13"]').getAttribute('aria-label'), /Con salti/);
  await shot(page, 'month-open-390');
  // tastiera: Invio chiude, Spazio apre
  await page.locator('[data-month="2026-09"] .cal-mh').focus();
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-month="2026-09"] .cal-mh').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-month="2026-09"] .week').count(), 0);
  await page.keyboard.press('Space'); await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-month="2026-09"] .cal-mh').getAttribute('aria-expanded'), 'true');
  // il focus è visibile (anello) con la tastiera
  assert.notEqual(await page.locator('[data-month="2026-09"] .cal-mh').evaluate((e) => getComputedStyle(e).outlineStyle), 'none');
  // apertura scheda settimana da una riga compatta
  await page.locator('.week[data-sunday="2026-09-13"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.locator('.week[data-sunday="2026-09-13"]').click();
  await page.waitForSelector('#layer .sheet.on'); await page.waitForTimeout(450);
  assert.match(await page.locator('#layer .sheet.on').innerText(), /Pavimenti[\s\S]*Bagno[\s\S]*Cucina/i);
  await closeSheet(page);
  noErrors(page, 'apertura mese'); await page.close();
});

await scenario('la settimana di 3 mesi fa: 2 tocchi (mese, settimana)', async () => {
  const page = await mk();
  const target = '2026-08-02';
  let taps = 0;
  assert.equal(await page.locator(`.week[data-sunday="${target}"]`).count(), 0);
  await toggle(page, monthOf(target)); taps++;
  await page.locator(`.week[data-sunday="${target}"]`).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(120);
  await page.locator(`.week[data-sunday="${target}"]`).click(); taps++;
  await page.waitForSelector('#layer .sheet.on');
  assert.equal(taps, 2);
  assert.match(await page.locator('#layer .sheet.on').innerText(), /Settimana 4[0-9]/);
  await page.close();
});

await scenario('«Mostra altre settimane» (futuro) e «Mostra mesi precedenti»', async () => {
  const page = await mk();
  assert.equal(await page.locator('.cal .week.fut').count(), 4);
  const fb = page.locator('[data-act=show-next]');
  assert.match(await fb.innerText(), /Mostra altre 10 settimane/);
  await fb.evaluate((e) => e.scrollIntoView({ block: 'center' })); await fb.click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('.cal .week.fut').count(), 14);
  assert.equal(await page.locator('[data-act=show-next]').count(), 0);
  assert.ok(await page.locator('.cal-compact .week.fut').count() === 10, 'le oltre le prime sono compatte');
  const mb = page.locator('[data-act=show-months]');
  assert.match(await mb.innerText(), /Mostra mesi precedenti/);
  await mb.evaluate((e) => e.scrollIntoView({ block: 'center' })); await mb.click(); await page.waitForTimeout(300);
  assert.equal((await months(page)).length, 12);
  noErrors(page, 'mostra altre'); await page.close();
});

await scenario('«Oggi»: nascosto in cima, compare scorrendo, riporta alla corrente; tocco >= 44px', async () => {
  const page = await mk();
  assert.ok(!(await page.locator('[data-act=today]').isVisible()), 'in cima la corrente è in vista: niente pulsante');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300);
  const b = page.locator('[data-act=today]');
  assert.ok(await b.isVisible());
  const box = await b.boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44, JSON.stringify(box));
  assert.ok(box.y + box.height <= 844, 'dentro lo schermo');
  assert.equal(await b.getAttribute('aria-label'), 'Vai a oggi');
  await shot(page, 'today-pill-390');
  await b.click();
  await page.waitForFunction(() => { const r = document.querySelector('.week.cur').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 4000 });
  await page.waitForTimeout(300);
  assert.ok(!(await page.locator('[data-act=today]').isVisible()));
  await page.close();
});

await scenario('ritorno con «indietro»: mesi aperti e scroll mantenuti; dopo un ricarico si riparte dall\'alto', async () => {
  const page = await mk();
  await toggle(page, '2026-09'); await toggle(page, '2026-07');
  await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(200);
  const y0 = await page.evaluate(() => window.scrollY);
  assert.ok(y0 > 400);
  await page.evaluate(() => { location.hash = '#/trips'; });
  await page.waitForSelector('main:not(:has(.cal))'); await page.waitForTimeout(500);
  assert.equal(await page.locator('.cal').count(), 0);
  await page.goBack();
  await page.waitForSelector('.cal .week', { timeout: 5000 }); await page.waitForTimeout(600);
  assert.deepEqual((await months(page)).filter((m) => m.open).map((m) => m.key), ['2026-09', '2026-07']);
  const y1 = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(y1 - y0) <= 4, `scroll ripristinato (${y0} -> ${y1})`);
  // anche toccando la voce di menu la schermata riprende dov'era (come tutte le schede dell'app); «Oggi» riporta in cima
  await page.waitForTimeout(1000);
  await page.locator('.nav a[href="#/trips"]').click(); await page.waitForSelector('main:not(:has(.cal))'); await page.waitForTimeout(400);
  await page.locator('.nav a[href="#/calendar"]').click(); await page.waitForSelector('.cal .week'); await page.waitForTimeout(600);
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y0) <= 4, 'dal menu: stessa posizione');
  assert.deepEqual((await months(page)).filter((m) => m.open).map((m) => m.key), ['2026-09', '2026-07']);
  // ricaricando la pagina si riparte dall'alto, ma i mesi aperti restano ricordati per la sessione
  await page.reload(); await page.waitForSelector('.cal .week'); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.deepEqual((await months(page)).filter((m) => m.open).map((m) => m.key), ['2026-09', '2026-07']);
  noErrors(page, 'indietro'); await page.close();
});

await scenario('un aggiornamento dei dati non chiude i mesi aperti né sposta lo scroll', async () => {
  const page = await mk();
  await toggle(page, '2026-08');
  const y0 = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.__app.actions.setWeekNote ? window.__app.actions.setWeekNote('2026-08-09', 'ciao') : window.__app.store.setDoc('weeks', '2026-08-09', { note: 'ciao' }));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-month="2026-08"] .week').count(), 4);
  assert.equal(await page.locator('.week[data-sunday="2026-08-09"] .ind.note').count(), 1, 'nota visibile nella riga');
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y0) <= 4);
  noErrors(page, 'aggiornamento'); await page.close();
});

await scenario('deep link #/calendar?week=...: apre mese, scorre, apre la scheda (anche con un giorno qualsiasi)', async () => {
  for (const [dl, sunday] of [['2026-03-08', '2026-03-08'], ['2026-03-04', '2026-03-08'], ['2026-12-20', '2026-12-20']]) {
    const page = await mk({ hash: `#/calendar?week=${dl}` });
    await page.waitForSelector('#layer .sheet.on', { timeout: 5000 }); await page.waitForTimeout(500);
    assert.ok(await page.locator(`.week[data-sunday="${sunday}"]`).count(), 'la riga esiste: ' + sunday);
    assert.equal(await page.locator('#layer .sheet.on').count(), 1);
    assert.equal(await page.evaluate(() => location.hash), '#/calendar', 'il parametro viene consumato');
    if (sunday < CUR) assert.equal(await page.locator(`[data-month="${monthOf(sunday)}"] .cal-mh`).getAttribute('aria-expanded'), 'true');
    await closeSheet(page);
    const r = await page.locator(`.week[data-sunday="${sunday}"]`).evaluate((e) => { const b = e.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; });
    assert.ok(r, 'la settimana è in vista: ' + sunday);
    noErrors(page, 'deep link ' + dl); await page.close();
  }
  // parametro non valido o fuori intervallo: la schermata si apre normalmente
  const p2 = await mk({ hash: '#/calendar?week=1999-01-01' });
  await p2.waitForTimeout(500);
  assert.equal(await sheetOn(p2), 0); assert.equal(await p2.locator('.week.cur').count(), 1);
  // cambio di hash mentre si è già nel calendario
  await p2.evaluate(() => { location.hash = '#/calendar?week=2026-01-11'; });
  await p2.waitForSelector('#layer .sheet.on', { timeout: 5000 });
  assert.ok(await p2.locator('.week[data-sunday="2026-01-11"]').count());
  noErrors(p2, 'deep link in pagina'); await p2.close();
  // desktop: seleziona nel pannello, niente scheda
  const p3 = await mk({ hash: '#/calendar?week=2026-03-08', viewport: { width: 1440, height: 900 } });
  await p3.waitForTimeout(700);
  assert.equal(await sheetOn(p3), 0);
  assert.ok((await p3.locator('.cal-panel .wd-title').innerText()).includes('2–8 mar'));
  assert.equal(await p3.locator('.week.sel').getAttribute('data-sunday'), '2026-03-08');
  await p3.close();
});

await scenario('a11y: tocco >= 44px su intestazioni, righe e pulsanti; nomi accessibili', async () => {
  const page = await mk({ textSize: 1 });
  await toggle(page, '2026-09');
  const small = await page.evaluate(() => [...document.querySelectorAll('.cal-mh, .cal .week, .cal-more, .cal-today')].filter((e) => e.offsetParent).map((e) => ({ c: e.className, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })).filter((r) => r.h < 44 || r.w < 44));
  assert.deepEqual(small, []);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.cal button')].every((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().length > 0)), 'ogni pulsante ha un nome');
  assert.equal(await page.locator('.week.cur').getAttribute('aria-current'), 'date');
  noErrors(page, 'a11y'); await page.close();
});

await scenario('viewport 320/390/820/1440, chiaro/scuro, testo 130%: nessun overflow', async () => {
  for (const [w, hgt] of [[320, 640], [390, 844], [820, 1180], [1440, 900]]) for (const dark of [false, true]) for (const ts of (w === 1440 ? [1] : [1, 1.3])) {
    const tag = `${w}-${dark ? 'dark' : 'light'}-${ts}`;
    const page = await mk({ viewport: { width: w, height: hgt }, dark, textSize: ts });
    await toggle(page, '2026-09'); await toggle(page, '2026-08');
    await noOverflow(page, tag);
    const bad = await page.evaluate(() => [...document.querySelectorAll('.cal-mh, .week.compact')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className));
    assert.deepEqual(bad, [], 'contenuto tagliato ' + tag);
    if (w >= 1180) { assert.ok(await page.locator('.cal-panel').isVisible()); await page.locator('.week[data-sunday="2026-09-13"]').click(); await page.waitForTimeout(300); assert.equal(await page.locator('.week.sel').getAttribute('data-sunday'), '2026-09-13'); assert.equal(await sheetOn(page), 0); }
    await page.evaluate(() => document.querySelector('.cal-prev').scrollIntoView({ block: 'start' })); await page.waitForTimeout(200);
    await shot(page, `view-${tag}`);
    noErrors(page, tag); await page.close();
  }
});

await scenario('inglese: mesi, riepiloghi e pulsanti tradotti', async () => {
  const page = await mk({ lang: 'en-US' });
  const ms = await months(page);
  assert.match(ms[0].text, /^October 2026 3 weeks · 3 chores to log$/);
  assert.match(ms[1].text, /^September 2026 4 weeks · 1 chore skipped$/);
  assert.match(ms[2].text, /^August 2026 4 weeks · 6 chores skipped$/);
  assert.match(ms[3].text, /^July 2026 5 weeks · all done$/);
  assert.match(await page.locator('[data-act=show-next]').innerText(), /Show 10 more weeks/);
  assert.match(await page.locator('[data-act=show-months]').innerText(), /Show earlier months/);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-act=today]').getAttribute('aria-label'), 'Go to today');
  assert.match(await page.locator('[data-act=today]').innerText(), /Today/);
  noErrors(page, 'inglese'); await page.close();
});

await env.close();
const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} scenari ok`);
if (failed.length) { console.log('Falliti: ' + failed.map((f) => f[0]).join(', ')); process.exit(1); }
