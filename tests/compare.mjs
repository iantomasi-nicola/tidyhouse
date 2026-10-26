import fs from 'fs';
import { compute } from '../js/engine.js';
const [,, prefix] = process.argv;
const house = JSON.parse(fs.readFileSync(prefix + '.house.json'));
const exp = JSON.parse(fs.readFileSync(prefix + '.expected.json'));
const today = house.today;
const out = compute(house, today, 400);
const rows = out.rows;
const stMap = { empty: 'Empty house', none: '—', done: '✓ Done', preview: 'Preview', progress: 'In progress', tolog: 'To log' };
let bad = 0;
const n = exp.length;
for (let i = 0; i < n; i++) {
  const e = exp[i], r = rows[i];
  const got = { F: r.assigned[0], G: r.assigned[1], H: r.assigned[2], I: r.rest.join(', ') };
  const stat = r.status === 'skipped' ? `✗ ${r.nSk} skipped` : stMap[r.status];
  for (const k of ['F', 'G', 'H', 'I']) if ((e[k] || '') !== got[k]) { if (bad++ < 15) console.log('DIFF row', i + 4, k, 'exp', JSON.stringify(e[k]), 'got', JSON.stringify(got[k])); }
  if (e.M !== stat) { if (bad++ < 15) console.log('DIFF row', i + 4, 'M exp', e.M, 'got', stat); }
  const subs = r.subs; // EW..EY
  for (const [k, idx] of [['EW', 0], ['EX', 1], ['EY', 2]]) if ((e[k] || '') !== subs[idx]) { if (bad++ < 15) console.log('DIFF row', i + 4, k, 'exp', JSON.stringify(e[k]), 'got', JSON.stringify(subs[idx])); }
}
console.log(prefix.split('/').pop(), 'rows', n, 'diffs', bad);
process.exit(bad ? 1 : 0);
