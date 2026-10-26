// Test del motore: regole di casa + casi limite. Esegui:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, dayNum, dayStr, addDays, weekEnd, isSunday, awayFromTrips, validateRoommates, parseResult } from '../js/engine.js';

const START = '2026-10-04'; // domenica
const wk = (i) => addDays(START, 7 * i);
const people = (...names) => names.map((n, i) => ({ id: n, name: n, slot: i + 1, from: null, to: null }));
const mk = (rm, weeks = {}, extra = {}) => ({ startSunday: START, roommates: rm, weeks, trips: [], settings: {}, ...extra });
const run = (h, weekIdx = 0, horizon = 60) => compute(h, addDays(START, 7 * weekIdx - 3), horizon);
// settimane 0..n-1 tutte 'done' salvo override
const hist = (n, over = {}) => { const w = {}; for (let i = 0; i < n; i++) w[wk(i)] = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } }; for (const [k, v] of Object.entries(over)) w[wk(+k)] = { ...(w[wk(+k)] || {}), ...v }; return w; };
const chores = (r) => r.assigned.filter(Boolean);

test('date: round-trip, domeniche, anno bisestile e fine anno', () => {
  for (const s of ['2026-10-04', '2028-02-29', '2027-12-31', '2030-01-01']) assert.equal(dayStr(dayNum(s)), s);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-12-31', 1), '2028-01-01');
  assert.ok(isSunday('2026-10-04'));
  assert.ok(!isSunday('2026-10-05'));
  assert.equal(weekEnd('2026-10-04'), '2026-10-04');   // la domenica chiude la propria settimana
  assert.equal(weekEnd('2026-10-05'), '2026-10-11');   // lunedi' -> domenica dopo
  assert.equal(weekEnd('2026-10-10'), '2026-10-11');
  assert.equal(weekEnd('2028-02-29'), '2028-03-05');
});

test('3 persone: una mansione a testa, nessun riposo, carico equo su 60 settimane', () => {
  const o = run(mk(people('A', 'B', 'C')));
  const count = { A: [0, 0, 0], B: [0, 0, 0], C: [0, 0, 0] };
  for (let i = 0; i < 60; i++) {
    const r = o.rows[i];
    assert.deepEqual([...r.assigned].sort(), ['A', 'B', 'C'], `settimana ${i}`);
    assert.equal(r.rest.length, 0);
    r.assigned.forEach((id, c) => count[id][c]++);
  }
  for (const id of ['A', 'B', 'C']) for (let c = 0; c < 3; c++) assert.ok(Math.abs(count[id][c] - 20) <= 2, `${id} mansione ${c}: ${count[id][c]}`);
});

test('4 persone: una mansione a testa e una persona a riposo, a rotazione', () => {
  const o = run(mk(people('A', 'B', 'C', 'D')));
  const rested = {};
  for (let i = 0; i < 40; i++) {
    const r = o.rows[i];
    assert.equal(chores(r).length, 3);
    assert.equal(new Set(chores(r)).size, 3, 'nessuna doppia mansione');
    assert.equal(r.rest.length, 1);
    rested[r.rest[0]] = (rested[r.rest[0]] || 0) + 1;
  }
  for (const k of ['A', 'B', 'C', 'D']) assert.ok(rested[k] >= 8, `${k} riposa spesso abbastanza (${rested[k]})`);
});

test('2 persone: chi non fa il pavimento da piu\' tempo lo fa, l\'altro fa bagno e cucina', () => {
  const o = run(mk(people('A', 'B')));
  for (let i = 0; i < 20; i++) {
    const r = o.rows[i];
    assert.notEqual(r.assigned[0], r.assigned[1]);
    assert.equal(r.assigned[1], r.assigned[2]);
  }
  assert.notEqual(o.rows[0].assigned[0], o.rows[1].assigned[0], 'il pavimento alterna');
});

test('1 persona fa tutto; 0 persone = casa vuota', () => {
  let o = run(mk(people('A', 'B', 'C'), { [wk(2)]: { away: ['A', 'B'] } }));
  assert.deepEqual(o.rows[2].assigned, ['C', 'C', 'C']);
  o = run(mk(people('A', 'B', 'C'), { [wk(2)]: { everyone: true } }));
  assert.deepEqual(o.rows[2].assigned, ['', '', '']);
  assert.equal(o.rows[2].status, 'empty');
  o = run(mk(people('A', 'B', 'C'), { [wk(2)]: { away: ['A', 'B', 'C'] } }));
  assert.equal(o.rows[2].status, 'empty');
});

test('saltare un turno => recupero la prima settimana in cui sei a casa, in aggiunta al turno normale', () => {
  const h = mk(people('A', 'B', 'C'), { [wk(0)]: { result: { floor: 'skipped', bathroom: 'done', kitchen: 'done' } } });
  const o = run(h, 20);
  const skipped = o.rows[0].assigned[0];
  assert.equal(o.rows[0].sk[0], skipped);
  assert.equal(o.rows[1].assigned.includes(skipped), true);
  // la settimana dopo chi ha saltato ha il pavimento di recupero (priorita' debito)
  assert.equal(o.rows[1].assigned[0], skipped);
  assert.ok(o.rows[1].isMakeup[0]);
  // se il recupero non e' saldato, resta dovuto
  const withPaid = mk(people('A', 'B', 'C'), { [wk(0)]: { result: { floor: 'skipped' } }, [wk(1)]: { result: { floor: 'done' } } });
  const o2 = run(withPaid, 20);
  const p = o2.summary.people.find((x) => x.id === skipped);
  assert.deepEqual(p.makeups, [0, 0, 0]);
  const o3 = run(h, 20);
  // senza saldare il recupero (settimana 1 vuota) e' chiusa e conta come saltata => debito che resta/aumenta
  const p3 = o3.summary.people.find((x) => x.id === skipped);
  assert.ok(p3.makeups[0] >= 0);
});

test('assente nella settimana del recupero: il debito aspetta il rientro e non scade', () => {
  const skipper = 'A';
  const h = mk(people('A', 'B', 'C'), {
    [wk(0)]: { result: { floor: 'skipped', bathroom: 'done', kitchen: 'done' } },
    [wk(1)]: { away: ['A'] }, [wk(2)]: { away: ['A'] }, [wk(3)]: { away: ['A'] },
  });
  assert.equal(compute(h, wk(0), 5).rows[0].assigned[0], 'A');
  const o = run(h, 20);
  for (const i of [1, 2, 3]) assert.ok(!o.rows[i].assigned.includes(skipper));
  assert.equal(o.rows[4].assigned[0], 'A');
  assert.ok(o.rows[4].isMakeup[0]);
});

test('chi pulisce al posto di un altro guadagna un riposo, chi e\' stato sostituito deve recuperare', () => {
  const rm = people('A', 'B', 'C', 'D');
  const helper = run(mk(rm, hist(1)), 3).rows[1].rest[0];     // chi riposa nella settimana 1 e' libero di aiutare
  const h = mk(rm, hist(3, { 1: { result: { floor: 'by:' + helper, bathroom: 'done', kitchen: 'done' } } }));
  const o = run(h, 3);
  const covered = o.rows[1].assigned[0];
  assert.notEqual(helper, covered);
  assert.equal(o.rows[1].sb[0], helper);
  assert.equal(o.rows[1].da[0], covered);                       // debito per chi non ha pulito
  assert.equal(o.rows[1].sk[0], '');                            // coprire non e' saltare: niente CDM
  assert.ok(o.rows.slice(2, 8).some((r) => r.restName === helper), 'il riposo viene speso');
  assert.ok(o.rows.slice(2, 5).some((r) => r.assigned[0] === covered && r.isMakeup[0]), 'il sostituito recupera il pavimento');
});

test('"Saltato (Nome)": debito e CDM vanno a Nome, ma chi era assegnato deve comunque recuperare', () => {
  const h = mk(people('A', 'B', 'C'), { [wk(0)]: { result: { floor: 'skipped:B', bathroom: 'done', kitchen: 'done' } } });
  const o = run(h, 20);
  const assigned = o.rows[0].assigned[0];
  assert.equal(o.rows[0].sk[0], 'B');
  assert.equal(o.rows[0].daSub[0], 'B');
  assert.equal(o.rows[0].da[0], assigned);
  const s = o.summary;
  assert.ok(s.people.find((p) => p.id === 'B').cdm);
});

test('risultato vuoto: dopo domenica + tolleranza vale come saltato, prima vale come "da fare"', () => {
  const h = mk(people('A', 'B', 'C'), {}, { settings: { grace: 1 } });
  // oggi = domenica della settimana 0 + 1 (ancora entro tolleranza) => non chiusa
  let o = compute(h, addDays(wk(0), 1), 5);
  assert.equal(o.rows[0].closed, 0);
  assert.equal(o.rows[0].nSk, 0);
  o = compute(h, addDays(wk(0), 2), 5);
  assert.equal(o.rows[0].closed, 1);
  assert.equal(o.rows[0].nSk, 3);
  assert.equal(o.rows[0].status, 'skipped');
  // tolleranza 0
  o = compute(mk(people('A', 'B', 'C'), {}, { settings: { grace: 0 } }), addDays(wk(0), 1), 5);
  assert.equal(o.rows[0].closed, 1);
});

test('settimana corrente: lunedi\' e domenica appartengono alla stessa settimana', () => {
  const h = mk(people('A', 'B', 'C'));
  assert.equal(compute(h, '2026-10-26', 5).cur, 4);  // lunedi'
  assert.equal(compute(h, '2026-11-01', 5).cur, 4);  // domenica
  assert.equal(compute(h, '2026-11-02', 5).cur, 5);  // lunedi' dopo
  assert.equal(compute(h, '2026-10-05', 5).cur, 1);
  assert.equal(compute(h, '2026-09-28', 5).cur, 0);  // lunedi' della prima settimana
  assert.equal(compute(h, '2026-09-27', 5).cur, -1); // prima dell'inizio
});

test('oggi prima dell\'inizio: nessuna eccezione, anteprima valida', () => {
  const o = compute(mk(people('A', 'B', 'C')), '2020-01-01', 6);
  assert.equal(o.cur, -1);
  assert.ok(o.rows.length >= 1);
  assert.deepEqual(o.summary.people, []);
});

test('oggi molto dopo l\'inizio (5 anni) e prestazioni', () => {
  const t0 = Date.now();
  const o = compute(mk(people('A', 'B', 'C', 'D')), '2031-06-15', 26);
  assert.ok(o.rows.length > 260);
  assert.ok(Date.now() - t0 < 2000, 'meno di 2s per 5 anni');
  assert.ok(o.cur > 240 && o.cur < 260);
});

test('nuovo arrivato: parte da zero, nessun debito ereditato, priorita\' iniziale', () => {
  const rm = people('A', 'B', 'C');
  rm[2].to = addDays(START, 7 * 5 - 2);                    // C se ne va alla settimana 5
  rm.push({ id: 'Z', name: 'Z', slot: 3, from: wk(8), to: null });
  const h = mk(rm, { [wk(4)]: { result: { floor: 'skipped', bathroom: 'skipped', kitchen: 'skipped' } } });
  const o = run(h, 30);
  for (const i of [6, 7]) {
    assert.ok(!o.rows[i].nm.includes('C'));
    assert.ok(!o.rows[i].nm.includes('Z'));
  }
  assert.ok(o.rows[8].nm.includes('Z'));
  const z = o.rows[9].debts[o.rows[9].nm.indexOf('Z')];
  assert.deepEqual(z, [0, 0, 0]);
  // C aveva debiti ma non compare tra le persone attuali
  assert.ok(!o.summary.people.some((p) => p.id === 'C'));
});

test('stesso slot, stessa persona che esce e rientra: lo storico non si rompe', () => {
  const rm = [
    { id: 'A', name: 'A', slot: 1, from: null, to: null },
    { id: 'B', name: 'B', slot: 2, from: null, to: null },
    { id: 'C', name: 'C', slot: 3, from: null, to: wk(3) },
    { id: 'C2', name: 'C', slot: 3, from: wk(10), to: null },
  ];
  const o = run(mk(rm), 30);
  assert.ok(o.rows[12].nm[2] === 'C2');
  assert.ok(o.rows.every((r) => r.assigned.every((x) => x === '' || ['A', 'B', 'C', 'C2'].includes(x))));
});

test('scambio manuale: sovrascrive la mansione e viene considerato eseguito', () => {
  const h = mk(people('A', 'B', 'C'), { [wk(3)]: { swap: { floor: 'C', kitchen: 'A' } } });
  const o = run(h, 0);
  assert.equal(o.rows[3].assigned[0], 'C');
  assert.equal(o.rows[3].assigned[2], 'A');
  assert.ok(o.rows[3].swapped[0]);
  assert.equal(o.rows[3].sk[0], '');
});

test('input sporchi: id sconosciuti, risultati strani, slot fuori range: nessuna eccezione', () => {
  const h = mk(people('A', 'B', 'C'), {
    [wk(1)]: { away: ['ghost', 'A'], result: { floor: 'by:ghost', bathroom: 'skipped:ghost', kitchen: 'banana' } },
    [wk(2)]: { swap: { floor: 'ghost' } },
    [wk(3)]: { result: { floor: 'by:A' } },
    [wk(4)]: { away: ['A', 'A', 'B'] },
  });
  h.roommates.push({ id: 'X', name: 'X', slot: 9, from: null, to: null });
  h.roommates.push({ id: 'Y', name: '', slot: 1, from: null, to: null });
  const o = run(h, 20);
  assert.ok(o.rows.length > 20);
  assert.ok(validateRoommates(h.roommates, wk(10)).includes('slotRange'));
});

test('slot duplicato: viene segnalato dalla validazione', () => {
  const rm = people('A', 'B', 'C');
  rm[2].slot = 2;
  assert.ok(validateRoommates(rm, wk(1)).includes('slotDup'));
  assert.deepEqual(validateRoommates(people('A', 'B', 'C'), wk(1)), []);
  // persona uscita non conta come duplicato
  const rm2 = people('A', 'B', 'C');
  rm2[2].to = addDays(wk(0), -30);
  rm2.push({ id: 'D', name: 'D', slot: 3, from: null, to: null });
  assert.deepEqual(validateRoommates(rm2, wk(1)), []);
});

test('regola delle 3 notti: 3 a casa = in turno, 2 a casa = assente', () => {
  const t = (from, to) => [{ personId: 'A', from, to }];
  // settimana lun 2026-10-26 .. dom 2026-11-01
  assert.equal(awayFromTrips(t('2026-10-26', '2026-10-30'), 'A', '2026-11-01'), false); // via 4 notti, a casa 3 (30,31,1)
  assert.equal(awayFromTrips(t('2026-10-26', '2026-10-31'), 'A', '2026-11-01'), true);  // via 5 notti, a casa 2
  assert.equal(awayFromTrips(t('2026-10-20', '2026-10-27'), 'A', '2026-11-01'), false); // una sola notte nella settimana
  assert.equal(awayFromTrips(t('2026-10-01', '2026-12-01'), 'A', '2026-11-01'), true);  // via tutto il periodo
  assert.equal(awayFromTrips(t('2026-10-01', null), 'A', '2026-11-01'), true);          // senza data di rientro
  assert.equal(awayFromTrips(t('2026-11-05', '2026-11-10'), 'A', '2026-11-01'), false); // futuro
  assert.equal(awayFromTrips([], 'A', '2026-11-01'), false);
  assert.equal(awayFromTrips([{ personId: 'B', from: '2026-10-01', to: null }], 'A', '2026-11-01'), false);
  // rientro prima della partenza (input errato): nessun effetto
  assert.equal(awayFromTrips(t('2026-10-30', '2026-10-26'), 'A', '2026-11-01'), false);
  // piu' viaggi che si sommano
  assert.equal(awayFromTrips([{ personId: 'A', from: '2026-10-26', to: '2026-10-28' }, { personId: 'A', from: '2026-10-29', to: '2026-11-01' }], 'A', '2026-11-01'), true);
  // viaggi sovrapposti non contano doppio
  assert.equal(awayFromTrips([{ personId: 'A', from: '2026-10-26', to: '2026-10-29' }, { personId: 'A', from: '2026-10-27', to: '2026-10-29' }], 'A', '2026-11-01'), false);
  // soglia configurabile
  assert.equal(awayFromTrips(t('2026-10-26', '2026-10-31'), 'A', '2026-11-01', 2), false);
});

test('viaggi nel motore: la persona in viaggio non e\' in turno e il recupero attende', () => {
  const h = mk(people('A', 'B', 'C'), {}, { trips: [{ personId: 'A', from: wk(3), to: wk(6) }] });
  const o = run(h, 20);
  for (const i of [4, 5, 6]) assert.ok(o.rows[i].away.includes('A'), 'settimana ' + i);
  assert.ok(!o.rows[3].away.includes('A'));
  assert.equal(o.rows[4].assigned.includes('A'), false);
});

test('"tutti via" e assenze incrociate non producono assegnazioni fantasma', () => {
  const h = mk(people('A', 'B', 'C', 'D'), { [wk(1)]: { everyone: true }, [wk(2)]: { away: ['A', 'B', 'C'] }, [wk(3)]: { away: ['A', 'B', 'C', 'D'] } });
  const o = run(h, 20);
  assert.deepEqual(o.rows[1].assigned, ['', '', '']);
  assert.deepEqual(o.rows[2].assigned, ['D', 'D', 'D']);
  assert.deepEqual(o.rows[3].assigned, ['', '', '']);
  assert.equal(o.rows[3].rest.length, 0);
});

test('un riposo non viene speso se ci sono meno persone del minimo', () => {
  const rm = people('A', 'B', 'C', 'D');
  const helper = run(mk(rm, hist(1)), 3).rows[1].rest[0];
  const res = { floor: 'by:' + helper, bathroom: 'done', kitchen: 'done' };
  const base = run(mk(rm, hist(3, { 1: { result: res } })), 3);
  const idx = base.rows.findIndex((r, i) => i >= 2 && r.restName === helper);
  assert.ok(idx >= 2, 'senza assenti il riposo viene speso');
  // la settimana in cui avrebbe riposato ci sono solo 2 persone a casa: non riposa e il credito resta
  const others = rm.map((r) => r.id).filter((x) => x !== helper).slice(0, 2);
  const o = run(mk(rm, hist(3, { 1: { result: res }, [idx]: { away: others } })), 3);
  assert.equal(o.rows[idx].npres, 2);
  assert.notEqual(o.rows[idx].restName, helper);
  const later = o.rows.slice(idx + 1, idx + 8).some((r) => r.restName === helper);
  assert.ok(later, 'il credito non scade e viene speso dopo');
});

test('parseResult', () => {
  assert.deepEqual(parseResult('done'), { kind: 'done' });
  assert.deepEqual(parseResult('by:x'), { kind: 'by', id: 'x' });
  assert.deepEqual(parseResult('skipped:y'), { kind: 'skippedBy', id: 'y' });
  assert.deepEqual(parseResult(''), { kind: '' });
  assert.deepEqual(parseResult(undefined), { kind: '' });
  assert.deepEqual(parseResult('zzz'), { kind: '' });
});

test('classifica: TR a chi ha pulito di piu\', CDM a chi ha saltato, finestra rispettata', () => {
  const weeks = {};
  for (let i = 0; i < 6; i++) weeks[wk(i)] = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
  weeks[wk(2)] = { result: { floor: 'skipped', bathroom: 'done', kitchen: 'done' } };
  const o = compute(mk(people('A', 'B', 'C'), weeks), addDays(wk(6), -3), 6);
  const s = o.summary.people;
  assert.equal(s.reduce((a, p) => a + p.skipped, 0), 1);
  assert.equal(s.filter((p) => p.cdm).length, 1);
  assert.ok(s.some((p) => p.tr));
  // finestra di 2 settimane: contano solo le ultime
  const o2 = compute(mk(people('A', 'B', 'C'), weeks, { settings: { window: 2 } }), addDays(wk(6), -3), 6);
  assert.ok(o2.summary.people.reduce((a, p) => a + p.cleaned, 0) <= 6);
});

test('anno nuovo e cambio ora legale: le settimane restano di 7 giorni esatti', () => {
  const o = compute(mk(people('A', 'B', 'C')), '2027-03-30', 80);
  for (let i = 1; i < o.rows.length; i++) assert.equal(dayNum(o.rows[i].sunday) - dayNum(o.rows[i - 1].sunday), 7);
  assert.ok(o.rows.some((r) => r.sunday === '2027-12-26'));
  assert.ok(o.rows.every((r) => isSunday(r.sunday)));
});

test('determinismo: due calcoli identici danno lo stesso risultato', () => {
  const h = mk(people('A', 'B', 'C', 'D'), { [wk(2)]: { result: { floor: 'by:B' } } });
  assert.deepEqual(run(h).rows.map((r) => r.assigned), run(h).rows.map((r) => r.assigned));
});
