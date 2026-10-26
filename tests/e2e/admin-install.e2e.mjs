// Banner di installazione (iPhone Safari / Chrome iOS) e cambio admin con blocco del vecchio dispositivo.
import { start, seed } from './helpers.mjs';
const env = await start(); let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
// 1) iPhone con Chrome: avviso "usa Safari"; con Safari: solo istruzioni
for (const [ua, expectWarn] of [['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1', true], ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', false]]) {
  const ctx = await (await import('node:module')).createRequire(import.meta.url)('playwright').chromium.launch().then((b) => b.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }));
  const page = await ctx.newPage(); await page.goto(env.url + '/'); await page.waitForTimeout(600);
  ok(await page.locator('[data-testid=install-banner]').count() === 1, 'banner installazione presente');
  ok((await page.locator('[data-testid=install-safari]').count() === 1) === expectWarn, 'avviso Safari ' + expectWarn);
  await ctx.browser().close();
}
// 2) cambio admin: il dispositivo del vecchio admin si blocca, il nuovo PIN sblocca
const page = await env.page({ now: '2026-10-28T10:00:00', seed: seed({ houseExtra: { requireRules: false } }) });
await page.goto(env.url + '/#/settings/security'); await page.waitForTimeout(500);
// il seed non ha un PIN: ne impostiamo uno noto via store
await page.evaluate(async () => { const { hashPin } = await import('/js/actions.js'); const salt = 'sale'; await window.__app.actions.setHouse({ adminSalt: salt, adminHash: await hashPin('1234', salt) }); });
ok(await page.evaluate(() => window.__app.isAdmin), 'admin all\'inizio');
await page.selectOption('[data-testid=newadmin-who]', 'bruno'); await page.fill('[data-testid=newadmin-pin]', '9999');
await page.click('[data-testid=admin-change]'); await page.waitForTimeout(400);
await page.locator('.sheet button.btn.danger, .sheet button.btn:not(.soft)').last().click(); await page.waitForTimeout(700);
ok(await page.evaluate(() => window.__app.house.adminIds[0] === 'bruno' && window.__app.house.adminEpoch === 2), 'admin cambiato e epoca 2');
ok(!(await page.evaluate(() => window.__app.isAdmin)), 'vecchio dispositivo bloccato');
ok(!(await page.evaluate(() => window.__app.unlockAdmin('1234'))), 'vecchio PIN non funziona');
ok(await page.evaluate(() => window.__app.unlockAdmin('9999')), 'nuovo PIN sblocca');
ok(await page.evaluate(() => window.__app.isAdmin), 'di nuovo admin con il nuovo PIN');
await env.close(); console.log(bad ? bad + ' problemi' : 'OK admin + installazione'); process.exit(bad ? 1 : 0);
