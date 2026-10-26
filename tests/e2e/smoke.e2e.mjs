// Verifica d'insieme: ogni rotta si apre senza errori, in mobile e desktop, IT ed EN.
import { start, seed } from './helpers.mjs';
const env = await start();
let bad = 0;
const routes = ['', 'calendar', 'trips', 'stats', 'more', 'needs', 'rules', 'lastout', 'tasks', 'requests', 'activity', 'guide', 'settings', 'settings/profile', 'settings/appearance', 'settings/home', 'settings/notifications', 'settings/house', 'settings/rules', 'settings/roommates', 'settings/features', 'settings/links', 'settings/notif-house', 'settings/invite', 'settings/access', 'settings/data', 'settings/ai', 'settings/security'];
for (const [vp, lang, dark] of [[{ width: 390, height: 844 }, 'it-IT', false], [{ width: 1440, height: 900 }, 'en-US', true]]) {
  const page = await env.page({ now: '2026-10-28T10:00:00', viewport: vp, lang, dark, seed: seed({ houseExtra: { requireRules: false } }) });
  for (const r of routes) {
    await page.goto(`${env.url}/#/${r}`); await page.waitForTimeout(350);
    const txt = await page.evaluate(() => document.querySelector('#app')?.innerText || '');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    const errs = (page.__errors || []).filter((e) => !/Failed to load resource|favicon|sw\.js/.test(e)); page.__errors = [];
    if (errs.length || txt.trim().length < 20 || overflow || /Qualcosa è andato storto|Something went wrong/.test(txt)) { bad++; console.log('PROBLEMA', vp.width, lang, '#/' + r, errs.slice(0, 2), txt.length, overflow ? 'overflow' : ''); }
  }
}
await env.close();
console.log(bad ? `${bad} problemi` : 'OK: tutte le rotte si aprono senza errori');
process.exit(bad ? 1 : 0);
