// Regressione: tornare in primo piano (visibilitychange/focus) non deve produrre errori e deve ri-registrare il dispositivo.
import assert from 'node:assert/strict';
import { start, seed } from './helpers.mjs';
const env = await start();
const page = await env.page({ now: '2026-10-28T10:00:00', seed: seed({ houseExtra: { requireRules: false } }) });
await page.goto(env.url + '/#/'); await page.waitForSelector('[data-screen=home]');
await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
await page.waitForTimeout(600);
const views = await page.evaluate(() => Object.values(window.__app.state.views || {}).filter((v) => v.screen === 'open').length);
assert.deepEqual((page.__errors || []).filter((e) => !/Service Worker|SW |Failed to load resource/.test(e)), [], 'nessun errore in console al ritorno in primo piano');
assert.ok(views >= 1, 'l\'apertura viene registrata');
await env.close();
console.log('OK foreground');
