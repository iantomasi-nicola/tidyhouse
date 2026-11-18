// Più case sullo stesso dispositivo: selettore «Le mie case» in Impostazioni → Profilo (passa senza uscire, aggiungi senza dimenticare).
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';

const env = await start();
const results = [];
async function scenario(name, fn) { try { await fn(); results.push(true); console.log('  ok   ' + name); } catch (e) { results.push(false); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n       ')); } }

function twoHouses() {
  const s = seed({ me: 'anna', admin: true, houseExtra: { requireRules: false, name: 'Casa Uno' } });
  const id1 = s['cp:houses'][0].id;
  const id2 = 'LOCALTEST002';
  const st2 = JSON.parse(JSON.stringify(s[`cp:h:${id1}`]));
  st2.house = { ...st2.house, id: id2, name: 'Casa Due' };
  s[`cp:h:${id2}`] = st2;
  s['cp:houses'] = [...s['cp:houses'], { id: id2, name: 'Casa Due', mode: 'local', me: 'bruno', lastUsed: 0 }];
  s['cp:admin'] = { [id1]: true, [id2]: true };
  return { s, id1, id2 };
}

await scenario('Le mie case: elenco, passa all\'altra casa con un tocco, aggiungi senza dimenticare', async () => {
  const { s, id1, id2 } = twoHouses();
  const page = await env.page({ now: '2026-10-28T10:00:00', seed: s });
  await page.goto(env.url + '/#/settings/profile'); await page.waitForSelector(`[data-testid="house-${id1}"]`, { timeout: 8000 });
  assert.equal(await page.locator(`[data-testid="house-${id1}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator(`[data-testid="house-${id2}"]`).getAttribute('aria-pressed'), 'false');
  await page.click(`[data-testid="house-${id2}"]`); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__app.houseId), id2);
  assert.equal(await page.evaluate(() => window.__app.house.name), 'Casa Due');
  await page.goto(env.url + '/#/settings/profile'); await page.waitForSelector(`[data-testid="house-${id2}"]`);
  assert.equal(await page.locator(`[data-testid="house-${id2}"]`).getAttribute('aria-pressed'), 'true');
  await page.click('[data-testid="house-add"]'); await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__app.houseId || null), null, 'schermata iniziale');
  const reg = await page.evaluate(() => JSON.parse(localStorage.getItem('cp:houses') || '[]').map((x) => x.id));
  assert.ok(reg.includes(id1) && reg.includes(id2), 'entrambe le case restano nell\'elenco');
  assert.ok(/Casa Uno|Casa Due/.test(await page.locator('body').innerText()), 'elenco case nella schermata iniziale');
  await page.close();
});

console.log(results.every(Boolean) ? 'tutti gli scenari OK' : 'FALLITI');
await env.close?.(); process.exit(results.every(Boolean) ? 0 : 1);
