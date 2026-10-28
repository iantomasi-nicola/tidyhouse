// Misure della schermata Settimane con storico lungo (60 passate + 12 future): node tests/e2e/calview.measure.mjs
// Stampa JSON: altezza pagina a 390 px, nodi DOM, tempo di render (mediana di 15), layout shift, tocchi per la settimana di 3 mesi fa.
import { start } from './helpers.mjs';
import { longSeed, NOW } from './calview-seed.mjs';

const TARGET = '2026-08-02';   // la settimana di circa 3 mesi fa (13 prima della corrente)
const env = await start();
const page = await env.page({ now: NOW, viewport: { width: 390, height: 844 }, lang: 'it-IT', seed: longSeed({ skips: ['2026-09-13', '2026-03-08'] }) });
await page.addInitScript(() => {
  window.__cls = 0; window.__shifts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(e.value); } }).observe({ type: 'layout-shift', buffered: true });
});
await page.goto(env.url + '/#/calendar');
await page.waitForSelector('.cal .week', { timeout: 10000 });
await page.waitForTimeout(1200);
const m = await page.evaluate(async () => {
  const doc = document.documentElement;
  const cal = document.querySelector('.cal');
  const ctx = window.__app;
  const mod = await import('/js/screens/calendar.js');
  const times = [];
  for (let i = 0; i < 15; i++) { const t0 = performance.now(); await mod.render(ctx); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  return { pageHeight: doc.scrollHeight, calHeight: Math.round(cal.getBoundingClientRect().height), nodesCal: cal.querySelectorAll('*').length, nodesDoc: document.querySelectorAll('*').length,
    weekEls: cal.querySelectorAll('.week').length, renderMedianMs: +times[7].toFixed(2), renderMaxMs: +times[14].toFixed(2), cls: +window.__cls.toFixed(4) };
});
await page.close();
// pagina nuova (il render ripetuto sopra lascia nodi orfani che il calendario scambia per «nuova visita»)
const page2 = await env.page({ now: NOW, viewport: { width: 390, height: 844 }, lang: 'it-IT', seed: longSeed({ skips: ['2026-09-13', '2026-03-08'] }) });
await page2.goto(env.url + '/#/calendar');
await page2.waitForSelector('.cal .week', { timeout: 10000 });
await page2.waitForTimeout(800);
// tocchi + scorrimento per aprire la settimana di 3 mesi fa
await page2.evaluate(() => window.scrollTo(0, 0));
let taps = 0, scrollPx = 0;
for (let guard = 0; guard < 6; guard++) {
  const el = page2.locator(`.week[data-sunday="${TARGET}"]`);
  if (await el.count()) break;
  const more = page2.locator('[data-act="show-prev"]');
  if (await more.count()) { await more.first().scrollIntoViewIfNeeded(); await more.first().click(); taps++; await page2.waitForTimeout(450); }
}
const t = page2.locator(`.week[data-sunday="${TARGET}"]`);
const y0 = await page2.evaluate(() => window.scrollY);
await t.scrollIntoViewIfNeeded();
scrollPx = Math.abs((await page2.evaluate(() => window.scrollY)) - y0);
await t.click(); taps++;
await page2.waitForSelector('#layer .sheet.on');
// caso peggiore: tutto lo storico aperto (prima: «Mostra precedenti» fino in fondo; dopo: tutti i mesi aperti)
await page2.keyboard.press('Escape'); await page2.waitForTimeout(500);
await page2.evaluate(() => window.scrollTo(0, 0));
const expand = async () => {
  for (let i = 0; i < 40; i++) {
    const more = page2.locator('[data-act="show-prev"], [data-act="month"][aria-expanded="false"]');
    if (!(await more.count())) break;
    await more.first().scrollIntoViewIfNeeded(); await more.first().click({ force: true }); await page2.waitForTimeout(420);
  }
};
await expand();
const full = await page2.evaluate(() => ({ pageHeight: document.documentElement.scrollHeight, nodesCal: document.querySelector('.cal').querySelectorAll('*').length, weekEls: document.querySelectorAll('.cal .week').length }));
console.log(JSON.stringify({ ...m, full, tapsTo3MonthsAgo: taps, scrollPxToTarget: scrollPx }, null, 1));
await env.close();
