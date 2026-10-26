// Ogni modulo mette le proprie stringhe in js/strings/<modulo>.js (export const it, en).
// Verifica: stesse chiavi in IT/EN, stessi segnaposto, nessuna chiave del nucleo sovrascritta.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CORE_KEYS } from '../js/i18n.js';

const dir = new URL('../js/strings/', import.meta.url);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')) : [];
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
for (const f of files) {
  test(`stringhe ${f}: IT/EN allineate`, async () => {
    const m = await import(new URL(f, dir));
    const it = Object.keys(m.it), en = Object.keys(m.en);
    assert.deepEqual(it.filter((k) => !(k in m.en)), [], 'mancano in EN');
    assert.deepEqual(en.filter((k) => !(k in m.it)), [], 'mancano in IT');
    for (const k of it) { assert.equal(ph(m.it[k]), ph(m.en[k]), 'segnaposto diversi: ' + k); assert.ok(!(k in CORE_KEYS.it), 'sovrascrive una chiave del nucleo: ' + k); }
  });
}
test('nessuna chiave duplicata tra moduli', async () => {
  const seen = new Map();
  for (const f of files) { const m = await import(new URL(f, dir)); for (const k of Object.keys(m.it)) { assert.ok(!seen.has(k), `${k} definita in ${seen.get(k)} e ${f}`); seen.set(k, f); } }
});
