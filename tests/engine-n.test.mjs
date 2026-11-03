// Motore generalizzato: N persone (fino a 8 slot) e M mansioni (house.chores).
// 1) Con 4 slot e le 3 mansioni predefinite il risultato è IDENTICO alla copia congelata del motore del foglio (tests/legacy/engine-v1.mjs).
// 2) Con 5-8 persone e 4-6 mansioni valgono le regole estese (ARCHITECTURE.md, «Motore: N persone, M mansioni»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, addDays, choresOf, DEFAULT_CHORES, MAX_SLOTS, CHORES, NOBODY, validateRoommates, slotsOf } from '../js/engine.js';
import { compute as legacyCompute } from './legacy/engine-v1.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const START = '2026-10-04';
const wk = (i) => addDays(START, 7 * i);
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + (i + 1), name: 'P' + (i + 1), slot: i + 1, from: null, to: null }));
const extra = (k) => Array.from({ length: k }, (_, i) => ({ id: 'c_x' + i, name: 'Extra ' + i, icon: 'dot', effort: 2 }));
const withChores = (k) => [...DEFAULT_CHORES.map((c) => ({ ...c })), ...extra(k)];
const mk = (rm, weeks = {}, more = {}) => ({ startSunday: START, roommates: rm, weeks, trips: [], settings: {}, ...more });
const run = (h, weekIdx = 0, horizon = 80) => compute(h, addDays(START, 7 * weekIdx - 3), horizon);
const allDone = (ids, n, over = {}) => { const w = {}; for (let i = 0; i < n; i++) w[wk(i)] = { result: Object.fromEntries(ids.map((c) => [c, 'done'])) }; for (const [k, v] of Object.entries(over)) w[wk(+k)] = { ...(w[wk(+k)] || {}), ...v }; return w; };

// ---------- casa casuale «del foglio» (max 4 slot, 3 mansioni), anche con dati sporchi ----------
function randomSheetHouse(seed) {
  const R = rng(seed);
  const nPeople = 1 + Math.floor(R() * 4);
  const rm = [];
  for (let i = 0; i < nPeople; i++) rm.push({ id: 'P' + i, name: 'P' + i, slot: i + 1, from: R() < 0.15 ? wk(Math.floor(R() * 20)) : null, to: R() < 0.15 ? wk(10 + Math.floor(R() * 30)) : null });
  if (R() < 0.3) rm.push({ id: 'N', name: 'N', slot: 1 + Math.floor(R() * nPeople), from: wk(25), to: null });
  const ids = rm.map((r) => r.id);
  const pickId = () => ids[Math.floor(R() * ids.length)];
  const weeks = {}; const trips = [];
  for (let w = 0; w < 50; w++) {
    const o = {};
    if (R() < 0.2) o.away = ids.filter(() => R() < 0.4);
    if (R() < 0.04) o.everyone = true;
    if (w < 40) {
      const pick = () => { const x = R(); return x < 0.6 ? 'done' : x < 0.68 ? '' : x < 0.76 ? 'skipped' : x < 0.9 ? 'by:' + pickId() : 'skipped:' + pickId(); };
      o.result = { floor: pick(), bathroom: pick(), kitchen: pick() };
    }
    if (R() < 0.05) o.swap = { [CHORES[Math.floor(R() * 3)]]: R() < 0.3 ? NOBODY : pickId() };
    if (R() < 0.05) o.adj = { [pickId()]: { [CHORES[Math.floor(R() * 3)]]: Math.floor(R() * 5) - 2, credit: Math.floor(R() * 3) - 1 } };
    weeks[wk(w)] = o;
  }
  if (R() < 0.5) trips.push({ personId: ids[0], from: wk(5), to: R() < 0.5 ? wk(9) : null });
  const settings = { grace: Math.floor(R() * 3), minRest: 2 + Math.floor(R() * 3), startPriority: Math.floor(R() * 7), window: R() < 0.3 ? 0 : 10 };
  // metà delle case dichiara esplicitamente le 3 mansioni predefinite (house.chores): deve dare lo stesso risultato
  const chores = R() < 0.5 ? DEFAULT_CHORES.map((c) => ({ ...c })) : undefined;
  return { startSunday: START, roommates: rm, weeks, trips, settings, ...(chores ? { chores } : {}) };
}

test('parità: 4 slot / 3 mansioni identico al motore del foglio (400 case casuali, con swap, NOBODY e correzioni)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const h = randomSheetHouse(seed);
    const today = addDays(START, 7 * (5 + (seed % 30)) - (seed % 7));
    const a = compute(h, today, 20), b = legacyCompute(h, today, 20);
    assert.equal(a.rows.length, b.rows.length);
    const keys = ['nm', 'pr', 'npres', 'jn', 'assigned', 'rest', 'restName', 'subs', 'isMakeup', 'rec', 'result', 'cleaner', 'da', 'daSub', 'dp', 'sk', 'sb', 'ru', 'nAss', 'nSk', 'nPend', 'status', 'away', 'swapped', 'debts', 'credits', 'closed', 'isCur', 'isFut'];
    a.rows.forEach((r, i) => { for (const k of keys) assert.deepEqual(r[k], b.rows[i][k], `seed ${seed} riga ${i} campo ${k}`); });
    assert.equal(a.cur, b.cur);
    assert.deepEqual(a.summary, b.summary, `seed ${seed} classifica`);
  }
});

test('choresOf: predefinite, house.chores, effort, doppioni', () => {
  const d = choresOf({});
  assert.deepEqual(d.map((c) => c.id), CHORES);
  assert.ok(d.every((c) => c.builtin && c.effort === 1));
  assert.deepEqual(d.map((c) => c.icon), ['broom', 'shower', 'pot']);
  assert.deepEqual(choresOf({ effort: { floor: 3, kitchen: '2' } }).map((c) => c.effort), [3, 1, 2]);
  assert.deepEqual(choresOf({ chores: [] }).map((c) => c.id), CHORES);
  const h = { effort: { floor: 4 }, chores: [{ id: 'kitchen', name: 'Cucina', icon: 'pot' }, { id: 'c_ab', name: { it: 'Giardino', en: 'Garden' }, icon: 'leaf', effort: 5 }, { id: 'c_ab', name: 'dup' }, { id: 'floor' }, null, { name: 'senza id' }] };
  const l = choresOf(h);
  assert.deepEqual(l.map((c) => c.id), ['kitchen', 'c_ab', 'floor']);
  assert.deepEqual(l.map((c) => c.builtin), [true, false, true]);
  assert.deepEqual(l.map((c) => c.effort), [1, 5, 4]);
  assert.equal(l[2].icon, 'broom');
  assert.equal(MAX_SLOTS, 8);
});

test('validateRoommates: slot 1..8 ammessi, fuori range segnalato', () => {
  assert.deepEqual(validateRoommates(people(8), wk(1)), []);
  assert.ok(validateRoommates([...people(3), { id: 'X', name: 'X', slot: 9 }], wk(1)).includes('slotRange'));
  assert.ok(validateRoommates([...people(3), { id: 'X', name: 'X', slot: 0 }], wk(1)).includes('slotRange'));
  const dup = people(6); dup[5].slot = 5;
  assert.ok(validateRoommates(dup, wk(1)).includes('slotDup'));
  assert.equal(slotsOf(people(3)), 4);
  assert.equal(slotsOf(people(6)), 6);
  assert.equal(slotsOf([{ id: 'a', name: 'a', slot: 7 }]), 7);
});

// ---------- 5-8 persone, 3-6 mansioni: equità su molte settimane ----------
for (const [N, K] of [[5, 0], [6, 0], [8, 0], [5, 1], [6, 2], [8, 3], [4, 2], [3, 3], [2, 1]]) {
  const M = 3 + K;
  test(`${N} persone, ${M} mansioni: una a testa finché ci sono persone, carico equo, rotazione regolare`, () => {
    const h = mk(people(N), {}, { chores: withChores(K) });
    const W = 120;
    const ids = choresOf(h).map((c) => c.id);
    const o = run(mk(people(N), allDone(ids, W), { chores: withChores(K) }), W, 5);
    const load = {}, per = {}, last = {}, gaps = {};
    for (let i = 0; i < W; i++) {
      const r = o.rows[i];
      assert.equal(r.nAss, M, `settimana ${i}: tutte le mansioni assegnate`);
      const cnt = {}; for (const id of r.assigned) cnt[id] = (cnt[id] || 0) + 1;
      const maxEach = Math.ceil(M / N);
      for (const [id, k] of Object.entries(cnt)) assert.ok(k <= maxEach, `settimana ${i}: ${id} ha ${k} mansioni (max ${maxEach})`);
      if (M <= N) assert.equal(Object.keys(cnt).length, M, `settimana ${i}: una mansione a testa`);
      for (const [c, id] of r.assigned.entries()) { load[id] = (load[id] || 0) + 1; (per[id] ||= Array(M).fill(0))[c]++; }
      for (const id of Object.keys(cnt)) { if (last[id] !== undefined) (gaps[id] ||= []).push(i - last[id]); last[id] = i; }
    }
    const tot = Object.values(load);
    assert.equal(tot.length, N, 'tutti lavorano');
    const avg = (W * M) / N;
    for (const v of tot) assert.ok(Math.abs(v - avg) <= Math.max(2, avg * 0.06), `carico ${v} vs media ${avg.toFixed(1)} (${JSON.stringify(load)})`);
    // ognuno fa ogni mansione, più o meno lo stesso numero di volte
    for (const [id, a] of Object.entries(per)) for (let c = 0; c < M; c++) assert.ok(Math.abs(a[c] - W / N) <= Math.max(3, (W / N) * 0.35), `${id} mansione ${c}: ${a[c]} (attese ~${(W / N).toFixed(1)})`);
    // in una casa larga (≥ 2 persone libere) i turni sono distribuiti con regolarità: tra un turno e l'altro passano floor(N/M)..ceil(N/M) settimane
    if (N >= M + 2) for (const [id, g] of Object.entries(gaps)) assert.ok(g.filter((x) => x < Math.floor(N / M) || x > Math.ceil(N / M)).length <= g.length * 0.1, `${id} lavora a raffica: ${g.join(',')}`);
  });
}

test('riposi: con N>M+1 il credito si spende solo quando serve; con N=M+1 come nel foglio', () => {
  // 6 persone, 3 mansioni: P6 copre P1 in settimana 0 → ha un credito
  const ids = CHORES;
  const w = allDone(ids, 30);
  const o0 = run(mk(people(6), w), 30, 2);
  const f0 = o0.rows[0].assigned[0];
  const helper = people(6).map((p) => p.id).find((id) => !o0.rows[0].assigned.includes(id));
  w[wk(0)].result.floor = 'by:' + helper;
  const o = run(mk(people(6), w), 30, 2);
  assert.equal(o.rows[0].sb[0], helper);
  assert.equal(o.rows[1].assigned[0] === f0 || o.rows[1].isMakeup.some(Boolean), true, 'chi è stato coperto recupera');
  // il riposo arriva in una settimana in cui l'aiutante avrebbe avuto un turno, e solo una volta
  const rests = o.rows.slice(0, 30).filter((r) => r.ru === helper);
  assert.equal(rests.length, 1, 'un solo riposo speso');
  const k = o.rows.indexOf(rests[0]);
  assert.ok(!o.rows[k].assigned.includes(helper));
  // nelle settimane prima del riposo non è stato speso «a vuoto»
  for (let i = 1; i < k; i++) assert.equal(o.rows[i].ru, '', `settimana ${i}`);
  // credito tornato a 0
  assert.equal(o.rows[k + 1].credits[o.rows[k + 1].nm.indexOf(helper)], 0);
});

test('recuperi per mansione extra: chi salta una mansione extra la rifà la settimana dopo', () => {
  const h = mk(people(6), {}, { chores: withChores(2) });
  const ids = choresOf(h).map((c) => c.id);
  const w = allDone(ids, 20);
  const o0 = run({ ...h, weeks: w }, 20, 2);
  const who = o0.rows[2].assigned[4];
  w[wk(2)].result[ids[4]] = 'skipped';
  const o = run({ ...h, weeks: w }, 20, 2);
  assert.equal(o.rows[2].sk[4], who);
  assert.equal(o.rows[3].debts[o.rows[3].nm.indexOf(who)][4], 1);
  assert.equal(o.rows[3].assigned[4], who, 'recupero sulla stessa mansione');
  assert.equal(o.rows[3].isMakeup[4], 1);
  assert.equal(o.rows[3].how[4], 'makeup');
  assert.equal(o.rows[4].debts[o.rows[4].nm.indexOf(who)][4], 0, 'recupero saldato');
  const p = o.summary.people.find((x) => x.id === who);
  assert.equal(p.makeups.length, 5);
});

test('assenti, swap, NOBODY e correzioni (adj) su mansioni extra', () => {
  const h = mk(people(7), {}, { chores: withChores(2) });
  const ids = choresOf(h).map((c) => c.id);
  const w = allDone(ids, 12, {
    1: { away: ['P1', 'P2', 'P3'] },
    2: { swap: { c_x1: 'P7', c_x0: NOBODY } },
    3: { adj: { P2: { c_x0: 2, credit: 1 } } },
  });
  delete w[wk(2)].result.c_x0;
  const o = run({ ...h, weeks: w }, 12, 2);
  for (const a of o.rows[1].assigned) assert.ok(!['P1', 'P2', 'P3'].includes(a), 'gli assenti non hanno turni');
  assert.equal(o.rows[2].assigned[4], 'P7');
  assert.equal(o.rows[2].assigned[3], '');
  assert.deepEqual([o.rows[2].how[3], o.rows[2].how[4]], ['manual', 'manual']);
  assert.ok(!o.rows[2].sk[3] && !o.rows[2].da[3], 'NOBODY non crea debiti');
  assert.equal(o.rows[3].debts.reduce((a, d) => a + (d ? d[3] : 0), 0), 2, 'solo la correzione');
  // correzione: 2 recuperi di c_x0 a P2 da settimana 3
  const s3 = o.rows[3].nm.indexOf('P2');
  assert.equal(o.rows[3].debts[s3][3], 2);
  assert.equal(o.rows[3].assigned[3], 'P2');
  const p = o.summary.people.find((x) => x.id === 'P2');
  assert.ok(p.makeups[3] >= 0 && p.rests >= 0);
});

test('mansione aggiunta in corso (from) e tolta (to): niente debiti nelle settimane fuori periodo', () => {
  const chores = [...DEFAULT_CHORES.map((c) => ({ ...c })), { id: 'c_new', name: 'Nuova', icon: 'dot', effort: 1, from: wk(5) }, { id: 'c_old', name: 'Vecchia', icon: 'dot', effort: 1, to: wk(3) }];
  const h = mk(people(6), allDone(CHORES, 10), { chores });
  const o = run(h, 10, 2);
  for (let i = 0; i < 5; i++) { assert.equal(o.rows[i].assigned[3], ''); assert.equal(o.rows[i].active[3], false); assert.equal(o.rows[i].how[3], 'off'); }
  assert.ok(o.rows[5].assigned[3], 'da settimana 5 la nuova mansione è in turno');
  for (let i = 0; i <= 3; i++) assert.ok(o.rows[i].assigned[4]);
  for (let i = 4; i < 10; i++) assert.equal(o.rows[i].assigned[4], '');
  // settimane 0-4 della mansione nuova: nessun debito (non c'era); la vecchia ha i risultati vuoti → debiti solo fino a settimana 3
  for (const d of o.rows[5].debts) if (d) assert.equal(d[3], 0);
  assert.equal(o.rows[5].nAss, 4);
});

test('N=8: slot 5-8 entrano nel motore, nm ha 8 slot, debiti per persona e mansione', () => {
  const o = run(mk(people(8)), 0, 4);
  assert.equal(o.rows[0].nm.length, 8);
  assert.equal(o.rows[0].debts[7].length, 3);
  assert.deepEqual(o.rows[0].assigned, ['P1', 'P2', 'P3']);
  assert.deepEqual(o.rows[1].assigned, ['P4', 'P5', 'P6']);
  assert.equal(o.rows[0].rest.length, 5);
});

test('fuzz N/M variabili: ogni mansione a una sola persona, nessuno sovraccarico se ci sono persone libere, niente eccezioni', () => {
  for (let seed = 1; seed <= 250; seed++) {
    const R = rng(seed * 7919);
    const N = 1 + Math.floor(R() * 8), K = Math.floor(R() * 4);
    const rm = people(N).map((p) => ({ ...p, from: R() < 0.1 ? wk(Math.floor(R() * 15)) : null, to: R() < 0.1 ? wk(10 + Math.floor(R() * 25)) : null }));
    if (R() < 0.3) rm.push({ id: 'Z', name: 'Z', slot: 1 + Math.floor(R() * Math.min(8, N + 1)), from: wk(20), to: null });
    const pids = rm.map((r) => r.id);
    const chores = withChores(K); if (R() < 0.2) chores[3 + Math.floor(R() * Math.max(1, K))] && (chores[3 + Math.floor(R() * Math.max(1, K))].from = wk(8));
    const ids = chores.map((c) => c.id);
    const pick = () => pids[Math.floor(R() * pids.length)];
    const weeks = {};
    for (let w = 0; w < 40; w++) {
      const o = {};
      if (R() < 0.25) o.away = pids.filter(() => R() < 0.35);
      if (R() < 0.03) o.everyone = true;
      if (w < 32) o.result = Object.fromEntries(ids.map((c) => { const x = R(); return [c, x < 0.65 ? 'done' : x < 0.72 ? '' : x < 0.8 ? 'skipped' : x < 0.92 ? 'by:' + pick() : 'skipped:' + pick()]; }));
      if (R() < 0.04) o.swap = { [ids[Math.floor(R() * ids.length)]]: R() < 0.3 ? NOBODY : pick() };
      if (R() < 0.04) o.adj = { [pick()]: { [ids[Math.floor(R() * ids.length)]]: Math.floor(R() * 4) - 1, credit: Math.floor(R() * 3) - 1 } };
      weeks[wk(w)] = o;
    }
    const settings = { grace: Math.floor(R() * 3), minRest: 2 + Math.floor(R() * 3), startPriority: Math.floor(R() * 7), window: R() < 0.3 ? 0 : 10 };
    const house = { startSunday: START, roommates: rm, weeks, trips: R() < 0.4 ? [{ personId: pids[0], from: wk(3), to: R() < 0.5 ? wk(7) : null }] : [], settings, chores };
    const o = compute(house, addDays(START, 7 * 25 - 2), 15);
    const M = ids.length;
    for (const r of o.rows) {
      assert.equal(r.assigned.length, M); assert.equal(r.debts.length, r.nm.length); assert.ok(r.nm.length >= 4 && r.nm.length <= 8);
      for (const a of r.assigned) assert.ok(a === '' || pids.includes(a), `id sconosciuto ${a}`);
      const Mact = r.active.filter(Boolean).length;
      if (r.npres > 0 && !r.swapped.some(Boolean)) assert.equal(r.nAss, Mact, `seed ${seed} P${r.P}: tutte le mansioni in turno assegnate`);
      for (const id of r.rest) assert.ok(!r.assigned.includes(id));
      if (!r.swapped.some(Boolean)) for (const a of r.assigned) if (a) assert.equal(r.pr[r.nm.indexOf(a)], 1, `assente assegnato seed ${seed}`);
      // mansioni «a turno» (non recupero, non restituzione, non manuali): nessuno ne ha 2 se c'è un eleggibile libero
      const turn = {}; r.how.forEach((h, c) => { if (h === 'turn') turn[r.assigned[c]] = (turn[r.assigned[c]] || 0) + 1; });
      const free = r.nm.filter((id, s) => id && r.pr[s] === 1 && id !== r.restName && !r.assigned.includes(id));
      // (la restituzione diretta, come nel foglio, sposta TUTTE le mansioni del creditore al debitore: lì il controllo non vale)
      if (free.length && !r.how.includes('repay') && !r.swapped.some(Boolean)) for (const [id, k] of Object.entries(turn)) assert.ok(k <= 1, `seed ${seed} P${r.P}: ${id} ha ${k} mansioni a turno con ${free.join(',')} liberi ${JSON.stringify({ how: r.how, as: r.assigned, nm: r.nm, pr: r.pr, rest: r.restName, rec: r.rec, act: r.active, sw: r.swapped })}`);
      for (const d of r.debts) if (d) for (const x of d) assert.ok(Number.isFinite(x) && x >= 0);
      assert.ok(r.credits.every(Number.isFinite));
      assert.ok(r.nPend >= 0 && r.nPend <= M);
    }
    for (const p of o.summary.people) { assert.equal(p.makeups.length, M); assert.ok(p.cleaned >= 0 && p.skipped >= 0); }
  }
});
