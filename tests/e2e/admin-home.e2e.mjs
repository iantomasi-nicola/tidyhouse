// Sblocco admin dalla Home e cambio admin: dopo il cambio il vecchio admin si blocca e il nuovo PIN sblocca dalla Home.
//   node tests/e2e/admin-home.e2e.mjs
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';
import { hashPin } from '../../js/actions.js';

const NOW = '2026-10-28T10:00:00';
const pause = (page) => page.waitForTimeout(450);   // la guardia anti doppio tocco ignora due invii entro 350 ms
const env = await start();
let fails = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok   ', name); } catch (e) { fails++; console.log('FAIL ', name, '\n', e && e.stack || e); }
}
const mk = async (opts = {}) => {
  const salt = 'saltsalt';
  const page = await env.page({ now: NOW, seed: seed({ admin: false, houseExtra: { requireRules: false, adminSalt: salt, adminHash: await hashPin('1111', salt) }, ...opts }) });
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
  return page;
};

await test('Home: tasto «Sblocca admin» con PIN sbagliato e giusto', async () => {
  const page = await mk();
  assert.equal(await page.evaluate(() => window.__app.isAdmin), false);
  await page.click('[data-testid=home-admin]');
  await page.waitForSelector('[data-testid=home-admin-pin]');
  await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'home-admin-pin');
  await page.fill('[data-testid=home-admin-pin]', '0000'); await page.press('[data-testid=home-admin-pin]', 'Enter');
  await page.waitForFunction(() => /PIN/i.test(document.querySelector('[data-testid=home-admin-err]').textContent));
  assert.equal(await page.evaluate(() => window.__app.isAdmin), false);
  await pause(page);
  await page.fill('[data-testid=home-admin-pin]', '1111'); await page.press('[data-testid=home-admin-pin]', 'Enter');
  await page.waitForFunction(() => window.__app.isAdmin === true);
  await page.waitForSelector('[data-testid=home-admin-on]');
  assert.equal(await page.locator('[data-testid=home-admin]').count(), 0);
  await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 4000 });   // lo sheet si chiude
  assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW /.test(e)), []);
});

await test('cambio admin: il dispositivo si blocca e il nuovo PIN sblocca dalla Home', async () => {
  const page = await mk();
  await page.click('[data-testid=home-admin]'); await page.fill('[data-testid=home-admin-pin]', '1111'); await page.press('[data-testid=home-admin-pin]', 'Enter');
  await page.waitForFunction(() => window.__app.isAdmin === true);
  await page.goto(env.url + '/#/settings/security'); await page.waitForSelector('[data-testid=newadmin-who]');
  await pause(page);
  await page.selectOption('[data-testid=newadmin-who]', 'bruno'); await page.fill('[data-testid=newadmin-pin]', '2222'); await page.press('[data-testid=newadmin-pin]', 'Enter');
  await page.click('.sheet .btn.danger');
  await page.waitForFunction(() => window.__app.isAdmin === false);
  await page.goto(env.url + '/#/'); await page.waitForSelector('[data-testid=home-admin]');
  await page.click('[data-testid=home-admin]'); await page.fill('[data-testid=home-admin-pin]', '1111'); await page.press('[data-testid=home-admin-pin]', 'Enter');
  await page.waitForFunction(() => /PIN/i.test(document.querySelector('[data-testid=home-admin-err]').textContent));
  assert.equal(await page.evaluate(() => window.__app.isAdmin), false, 'il vecchio PIN non vale più');
  await pause(page);
  await page.fill('[data-testid=home-admin-pin]', '2222'); await page.press('[data-testid=home-admin-pin]', 'Enter');
  await page.waitForFunction(() => window.__app.isAdmin === true);
});

await env.close();
if (fails) { console.log(fails + ' falliti'); process.exit(1); }
console.log('OK');
