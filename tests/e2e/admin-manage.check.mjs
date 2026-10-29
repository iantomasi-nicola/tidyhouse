// Prova rapida (non nella suite): pannello desktop admin + scheda turno mobile. node tests/e2e/admin-manage.check.mjs
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';
const SH = process.env.SHOTS || '/tmp';
const env = await start();
const CUR = '2026-11-01';
const wkOf = (p, s = CUR) => p.evaluate((x) => JSON.parse(JSON.stringify(window.__app.state.weeks[x] || {})), s);
const rowOf = (p, s = CUR) => p.evaluate((x) => { const r = window.__app.calc.out.rows.find((y) => y.sunday === x); return { assigned: r.assigned, result: r.result }; }, s);
try {
  for (const w of [1280, 1440]) {
    const page = await env.page({ now: '2026-10-28T10:00:00', viewport: { width: w, height: 900 }, seed: seed({ houseExtra: { requireRules: false } }) });
    await page.goto(env.url + '/#/calendar'); await page.waitForSelector('.cal-panel .wd-mg'); await page.waitForTimeout(400);
    assert.equal(await page.locator('.cal-panel .wd-mg').count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overflow');
    const small = await page.evaluate(() => [...document.querySelectorAll('.cal-panel button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.width < 43.5 || r.height < 43.5); }).map((b) => b.className + ' ' + b.textContent));
    assert.deepEqual(small, []);
    await page.screenshot({ path: `${SH}/panel-${w}.png`, fullPage: true });
    if (w === 1280) {
      const r0 = await rowOf(page); const f0 = r0.assigned[0]; const other = ['anna', 'bruno', 'carla'].find((x) => x !== f0 && !r0.assigned.includes(x)) || ['anna', 'bruno', 'carla'].find((x) => x !== f0);
      await page.click(`.cal-panel [data-mg-chore=floor] [data-act=who-floor][data-who=${other}]`); await page.waitForTimeout(300);
      await page.screenshot({ path: `${SH}/panel-pend.png` });
      await page.click('.cal-panel [data-testid=mg-terms-floor-repay]'); await page.waitForTimeout(600);
      assert.equal((await wkOf(page)).agreed.floor, other);
      await page.click('.cal-panel [data-mg-chore=floor] [data-act=who-floor][data-who=rules]'); await page.waitForTimeout(600);
      assert.ok(!(await wkOf(page)).agreed?.floor);
      await page.click('.cal-panel [data-mg-chore=kitchen] [data-act=who-kitchen][data-who="-"]'); await page.waitForTimeout(600);
      assert.equal((await wkOf(page)).swap.kitchen, '-');
      await page.locator('.toast .toast-action').click(); await page.waitForTimeout(600);
      assert.ok(!(await wkOf(page)).swap?.kitchen, 'annulla nessuno');
      const ob = ["anna", "bruno", "carla"].find((x) => x !== r0.assigned[1]); await page.click(`.cal-panel [data-mg-chore=bathroom] [data-act=res-bathroom][data-value="by:${ob}"]`); await page.waitForTimeout(700);
      if (await page.locator('.sheet.on [data-choice=force]').count()) { await page.click('.sheet.on [data-choice=force]'); await page.waitForTimeout(600); }
      assert.equal((await rowOf(page)).result[1], "by:" + ob);
      await page.click('.cal-panel [data-mg-chore=bathroom] [data-act=res-bathroom][data-value=skipped]'); await page.waitForTimeout(700);
      assert.equal((await rowOf(page)).result[1], 'skipped');
      await page.click('.cal-panel [data-mg-chore=bathroom] [data-act=res-bathroom][data-value=reset]'); await page.waitForTimeout(700);
      assert.equal((await rowOf(page)).result[1], '');
      await page.click('.cal-panel [data-testid=wd-bal] summary'); await page.waitForTimeout(300);
      assert.equal(await page.locator('.cal-panel .bal-card').count(), 3);
      await page.screenshot({ path: `${SH}/panel-after.png`, fullPage: true });
    }
    assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load/.test(e)), []);
    await page.close();
  }
  for (const w of [320, 390]) {
    const page = await env.page({ now: '2026-10-28T10:00:00', viewport: { width: w, height: 800 }, seed: seed({ houseExtra: { requireRules: false } }) });
    await page.goto(env.url + '/#/calendar'); await page.waitForSelector('.cal .week'); await page.waitForTimeout(300);
    await page.evaluate((s) => import('/js/choresheet.js').then((m) => m.openChoreSheet(window.__app, s, 'floor')), CUR); await page.waitForTimeout(600);
    assert.equal(await page.locator('#layer .sheet [data-testid=admin-manage]').count(), 1);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#layer .sheet')].every((s) => s.scrollWidth <= s.clientWidth + 1)), 'overflow sheet');
    await page.screenshot({ path: `${SH}/sheet-${w}.png`, fullPage: true });
    await page.click('#layer .sheet [data-act=mg-bal]'); await page.waitForTimeout(500);
    assert.ok(await page.locator('#layer .sheet .bal-card').count() >= 1);
    assert.deepEqual((page.__errors || []).filter((e) => !/Failed to load/.test(e)), []);
    await page.close();
  }
  console.log('ok');
} finally { await env.close(); }
