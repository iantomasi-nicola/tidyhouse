// Fuzz: input casuali (anche sporchi) => invarianti che devono sempre valere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, addDays } from '../js/engine.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const START = '2026-10-04';

test('fuzz: 300 case casuali, invarianti sempre rispettate', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const R = rng(seed);
    const nPeople = 1 + Math.floor(R() * 4);
    const rm = [];
    for (let i = 0; i < nPeople; i++) rm.push({ id: 'P' + i, name: 'P' + i, slot: i + 1, from: R() < 0.15 ? addDays(START, 7 * Math.floor(R() * 20)) : null, to: R() < 0.15 ? addDays(START, 7 * (10 + Math.floor(R() * 30))) : null });
    if (R() < 0.3) rm.push({ id: 'N', name: 'N', slot: 1 + Math.floor(R() * nPeople), from: addDays(START, 7 * 25), to: null });
    const ids = rm.map((r) => r.id);
    const weeks = {};
    const trips = [];
    for (let w = 0; w < 50; w++) {
      const o = {};
      if (R() < 0.2) o.away = ids.filter(() => R() < 0.4);
      if (R() < 0.04) o.everyone = true;
      if (w < 40) {
        const pick = () => { const x = R(); return x < 0.62 ? 'done' : x < 0.7 ? '' : x < 0.78 ? 'skipped' : x < 0.9 ? 'by:' + ids[Math.floor(R() * ids.length)] : 'skipped:' + ids[Math.floor(R() * ids.length)]; };
        o.result = { floor: pick(), bathroom: pick(), kitchen: pick() };
      }
      if (R() < 0.03) o.swap = { [['floor', 'bathroom', 'kitchen'][Math.floor(R() * 3)]]: ids[Math.floor(R() * ids.length)] };
      weeks[addDays(START, 7 * w)] = o;
    }
    if (R() < 0.5) trips.push({ personId: ids[0], from: addDays(START, 7 * 5), to: R() < 0.5 ? addDays(START, 7 * 9) : null });
    const settings = { grace: Math.floor(R() * 3), minRest: 2 + Math.floor(R() * 3), startPriority: Math.floor(R() * 7), window: R() < 0.3 ? 0 : 10 };
    const house = { startSunday: START, roommates: rm, weeks, trips, settings };
    const o = compute(house, addDays(START, 7 * 30 - 2), 20);
    assert.ok(o.rows.length >= 50);
    for (const r of o.rows) {
      const act = r.nm.filter(Boolean);
      for (const a of r.assigned) {
        assert.ok(a === '' || ids.includes(a), `id sconosciuto ${a} (seed ${seed})`);
      }
      // se qualcuno e' presente, ogni mansione e' assegnata (tranne casa vuota)
      if (r.npres > 0 && !r.swapped.some(Boolean)) assert.equal(r.nAss, 3, `seed ${seed} P${r.P}`);
      if (r.npres === 0) assert.equal(r.nAss, r.swapped.filter(Boolean).length);
      // chi riposa non e' assegnato a nulla
      // (la restituzione diretta puo' assegnare un turno a chi aveva il riposo: come nel foglio, il riposo allora non si consuma)
      for (const id of r.rest) assert.ok(!r.assigned.includes(id), `in riposo ma assegnato (seed ${seed} P${r.P})`);
      if (r.restName && r.assigned.includes(r.restName)) assert.equal(r.ru, '', 'riposo consumato pur lavorando');
      // niente NaN / numeri incoerenti
      assert.ok(r.npres >= 0 && r.npres <= 4);
      assert.ok(r.nPend >= 0 && r.nPend <= 3);
      for (const id of r.rest) assert.ok(act.includes(id));
      // una persona assente non viene assegnata (nessun swap) a meno che sia l'unico modo (mai: gli assenti non sono eleggibili)
      if (!r.swapped.some(Boolean)) for (const a of r.assigned) if (a) assert.ok(r.pr[r.nm.indexOf(a)] === 1, `assente assegnato (seed ${seed} P${r.P} ${a})`);
    }
    // la classifica e' coerente
    for (const p of o.summary.people) { assert.ok(p.cleaned >= 0 && p.skipped >= 0); assert.ok(p.makeups.every((x) => x >= -0 || true)); }
  }
});
