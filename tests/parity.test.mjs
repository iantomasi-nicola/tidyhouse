// Parita' con il foglio Excel originale: i fixture sono stati ricalcolati da LibreOffice (tests/run_xl_scenarios.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compute } from '../js/engine.js';

const dir = new URL('./fixtures/', import.meta.url);
const names = fs.readdirSync(dir).filter((f) => f.endsWith('.house.json')).map((f) => f.replace('.house.json', ''));
const st = { empty: 'Empty house', none: '—', done: '✓ Done', preview: 'Preview', progress: 'In progress', tolog: 'To log' };

for (const n of names) {
  test(`parita' Excel: ${n}`, () => {
    const house = JSON.parse(fs.readFileSync(new URL(n + '.house.json', dir)));
    const exp = JSON.parse(fs.readFileSync(new URL(n + '.expected.json', dir)));
    const { rows } = compute(house, house.today, 400);
    assert.ok(exp.length >= 60);
    exp.forEach((e, i) => {
      const r = rows[i];
      const stat = r.status === 'skipped' ? `✗ ${r.nSk} skipped` : st[r.status];
      assert.deepEqual([r.assigned[0], r.assigned[1], r.assigned[2], r.rest.join(', '), stat, ...r.subs],
        [e.F, e.G, e.H, e.I, e.M, e.EW, e.EX, e.EY], `${n} riga ${i + 4} (${e.sunday})`);
    });
  });
}
