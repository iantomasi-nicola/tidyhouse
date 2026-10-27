// Assegnazione manuale della settimana: Actions.setWeekAssignments (swap, normalizzazione, permessi, annulla) e logica pura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryBackend, Store, engineHouse } from '../js/store.js';
import { Actions, buildHouse } from '../js/actions.js';
import { compute } from '../js/engine.js';
import { ruleAssigned, finalSwap, diffAssign, applySwap, loadOf, presentIds } from '../js/assignlogic.js';

const START = '2026-10-04', NOW = '2026-10-28', CUR = '2026-11-01', FUT = '2026-11-15', PAST = '2026-10-18';
async function setup() {
  const hub = new MemoryHub();
  const house = await buildHouse({ id: 'H1', name: 'Casa', startSunday: START, roommates: ['Anna', 'Bruno', 'Carla'].map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  const b = new MemoryBackend(hub); await b.open('H1'); const s = new Store(b); await s.setHouse(house, true);
  const mk = (ctx) => new Actions(s, { now: () => new Date(NOW + 'T10:00:00'), ...ctx });
  const ids = house.roommates.map((r) => r.id);
  return { s, ids, admin: mk({ isAdmin: true }), user: mk({ meId: ids[1] }), row: (a, sun) => a.out().rows.find((r) => r.sunday === sun) };
}

test('assignlogic: finalSwap non crea override uguali alle regole e unisce con merge', () => {
  const ruled = ['a', 'b', 'c'];
  assert.deepEqual(finalSwap({ ruled, wanted: { floor: 'b', bathroom: 'b', kitchen: '' } }), { patch: { floor: 'b', bathroom: null, kitchen: null }, swap: { floor: 'b' } });
  // merge: tocca solo le mansioni indicate, le altre restano
  assert.deepEqual(finalSwap({ existing: { kitchen: 'a', floor: 'c' }, ruled, wanted: { floor: 'a' }, merge: true }), { patch: { floor: null, bathroom: null, kitchen: 'a' }, swap: { kitchen: 'a' } });
  // senza merge le mansioni non indicate tornano alle regole
  assert.deepEqual(finalSwap({ existing: { kitchen: 'a' }, ruled, wanted: { floor: 'c' } }).swap, { floor: 'c' });
  assert.deepEqual(diffAssign(['a', 'b', 'c'], ['b', 'b', '']), [{ chore: 'floor', from: 'a', to: 'b' }, { chore: 'kitchen', from: 'c', to: '' }]);
  assert.deepEqual(applySwap(ruled, { bathroom: 'c' }), ['a', 'c', 'c']);
  assert.deepEqual(loadOf(['a', 'a', 'c']), { a: ['floor', 'bathroom'], c: ['kitchen'] });
});

test('setWeekAssignments: scrive lo swap, il motore lo usa, il log lo registra', async () => {
  const { s, ids, admin, row } = await setup();
  const [A, B, C] = ids;
  const before = row(admin, FUT).assigned.slice();
  const target = [C, A, B];   // un'assegnazione diversa dalla corrente
  const wanted = { floor: target[0], bathroom: target[1], kitchen: target[2] };
  const res = await admin.setWeekAssignments(FUT, wanted, { logText: 'prova' });
  const after = row(admin, FUT).assigned;
  assert.deepEqual(after, target);
  assert.deepEqual(res.prev, {});
  assert.equal(res.changes.length, before.filter((x, i) => x !== target[i]).length);
  assert.ok(Object.keys(s.state.weeks[FUT].swap).every((c) => s.state.weeks[FUT].swap[c] === wanted[c]));
  const log = Object.values(s.state.log).find((l) => l.type === 'assign');
  assert.equal(log.p.week, FUT); assert.equal(log.p.text, 'prova');
  // annulla = rimette lo swap precedente (nessuno): tutto come da regole
  await admin.setWeekAssignments(FUT, res.prev);
  assert.deepEqual(row(admin, FUT).assigned, before);
  assert.equal(s.state.weeks[FUT].swap, undefined);
});

test('setWeekAssignments: "come da regole" azzera, persona uguale alle regole non crea override, merge tocca solo le indicate', async () => {
  const { s, ids, admin, row } = await setup();
  const ruled = ruleAssigned(engineHouse(s.state), NOW, FUT);
  const other = ids.find((x) => x !== ruled[0]);
  await admin.setWeekAssignments(FUT, { floor: other, bathroom: ruled[1] });          // bagno = regole: nessun override
  assert.deepEqual(s.state.weeks[FUT].swap, { floor: other });
  assert.equal(row(admin, FUT).swapped[0], true); assert.equal(row(admin, FUT).swapped[1], false);
  const other2 = ids.find((x) => x !== ruled[2]);
  await admin.setWeekAssignments(FUT, { kitchen: other2 }, { merge: true });           // merge: il pavimento resta
  assert.equal(s.state.weeks[FUT].swap.floor, other);
  await admin.setWeekAssignments(FUT, { floor: '' }, { merge: true });                // "come da regole" sul solo pavimento
  assert.equal(s.state.weeks[FUT].swap.floor, undefined); assert.equal(s.state.weeks[FUT].swap.kitchen, other2);
  assert.equal(row(admin, FUT).assigned[0], ruled[0]);
  await admin.setWeekAssignments(FUT, {});                                             // senza merge: tutto come da regole
  assert.equal(s.state.weeks[FUT].swap, undefined);
});

test('setWeekAssignments: una persona puo\' avere piu\' mansioni; id non validi, settimane inesistenti e non admin sono rifiutati', async () => {
  const { s, ids, admin, user } = await setup();
  const res = await admin.setWeekAssignments(CUR, { floor: ids[0], bathroom: ids[0], kitchen: ids[0] });
  assert.deepEqual(admin.out().rows.find((r) => r.sunday === CUR).assigned, [ids[0], ids[0], ids[0]]);
  assert.ok(res.changes.length >= 1);
  await assert.rejects(admin.setWeekAssignments(CUR, { floor: 'nessuno' }), /invalid/);
  await assert.rejects(admin.setWeekAssignments(CUR, { floor: 42 }), /invalid/);
  await assert.rejects(admin.setWeekAssignments('2020-01-05', { floor: ids[0] }), /invalid/);
  await assert.rejects(user.setWeekAssignments(CUR, { floor: ids[1] }), /permission/);
  assert.ok(s.state.weeks[CUR].swap, 'i rifiuti non hanno toccato lo swap');
});

test('setWeekAssignments: persona assente quella settimana e settimana conclusa (cambia i debiti)', async () => {
  const { s, ids, admin, row } = await setup();
  await admin.setAway(FUT, ids[2], true);
  const r = row(admin, FUT);
  assert.deepEqual(presentIds(r), [ids[0], ids[1]]);
  // le assenti restano persone attive: l'azione le accetta (è la UI a offrire solo i presenti)
  await admin.setWeekAssignments(FUT, { floor: ids[1], bathroom: ids[0], kitchen: ids[1] });
  assert.deepEqual(row(admin, FUT).assigned, [ids[1], ids[0], ids[1]]);
  // settimana conclusa: lo swap cambia chi risulta aver fatto/saltato
  const closed = row(admin, PAST); assert.equal(closed.closed, 1);
  const baseline = compute(engineHouse(s.state), NOW, 14).summary.people.map((p) => p.skipped + '/' + p.cleaned).join();
  await admin.setWeekAssignments(PAST, { floor: ids.find((x) => x !== closed.assigned[0]) });
  const changed = compute(engineHouse(s.state), NOW, 14).summary.people.map((p) => p.skipped + '/' + p.cleaned).join();
  assert.notEqual(baseline, changed);
});
