// Correzioni manuali dell'admin a recuperi e riposi (weeks/{domenica}.adj): Actions.adjustBalance / restoreAdjust e motore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryBackend, Store, engineHouse } from '../js/store.js';
import { Actions, buildHouse } from '../js/actions.js';
import { compute } from '../js/engine.js';

const START = '2026-10-04', NOW = '2026-11-03', LAST = '2026-11-01', CUR = '2026-11-08';
async function setup() {
  const hub = new MemoryHub();
  const house = await buildHouse({ id: 'H1', name: 'Casa', startSunday: START, roommates: ['Anna', 'Bruno', 'Carla', 'Dario'].map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  const b = new MemoryBackend(hub); await b.open('H1'); const s = new Store(b); await s.setHouse(house, true);
  const mk = (ctx) => new Actions(s, { now: () => new Date(NOW + 'T10:00:00'), ...ctx });
  const ids = house.roommates.map((r) => r.id);
  for (const w of ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01']) await s.setDoc('weeks', w, { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } });   // storico pulito
  return { s, ids, admin: mk({ isAdmin: true }), user: mk({ meId: ids[1] }) };
}
const curRow = (a) => a.out().rows.find((r) => r.sunday === CUR);
// debiti/crediti all'inizio della settimana corrente (la classifica «summary» conta già il turno in corso come fatto)
const debtOf = (a, id, c) => { const r = curRow(a); return r.debts[r.nm.indexOf(id)][c]; };
const creditOf = (a, id) => { const r = curRow(a); return r.credits[r.nm.indexOf(id)]; };

test('nessuna correzione: il motore resta quello del foglio (stesso risultato con adj vuoto)', async () => {
  const { s, admin } = await setup();
  const base = compute(engineHouse(s.state), NOW, 12);
  await s.setDoc('weeks', CUR, { adj: {} });
  const again = compute(engineHouse(s.state), NOW, 12);
  assert.deepEqual(again.rows.map((r) => r.assigned), base.rows.map((r) => r.assigned));
  assert.deepEqual(again.summary.people.map((p) => [p.makeups, p.rests]), base.summary.people.map((p) => [p.makeups, p.rests]));
  assert.ok(admin);
});

test('assegnare un recupero: la persona lo deve (e la classifica lo mostra); togliere lo azzera; annulla ripristina', async () => {
  const { ids, admin } = await setup();
  const [A] = ids;
  const r1 = await admin.adjustBalance(A, { floor: 1 });
  assert.deepEqual(r1.applied, { floor: 1 });
  assert.equal(debtOf(admin, A, 0), 1);
  assert.equal(curRow(admin).assigned[0], A, 'con un recupero aperto, A è assegnato a Pavimenti');
  assert.equal(curRow(admin).isMakeup[0], 1);
  const r2 = await admin.adjustBalance(A, { floor: -1 });
  assert.equal(debtOf(admin, A, 0), 0);
  await admin.restoreAdjust(r2.week, A, r2.prev);                // annulla la rimozione
  assert.equal(debtOf(admin, A, 0), 1);
});

test('non si scende sotto zero e non si toglie quel che non c\'è', async () => {
  const { ids, admin } = await setup();
  const r = await admin.adjustBalance(ids[1], { bathroom: -3, credit: -2 });
  assert.deepEqual(r.applied, {});
  assert.equal(debtOf(admin, ids[1], 1), 0);
});

test('recuperi reali (turno saltato) si possono togliere', async () => {
  const { s, ids, admin } = await setup();
  const [A] = ids;
  const r0 = compute(engineHouse(s.state), NOW, 12).rows.find((r) => r.sunday === LAST);
  const c = r0.assigned.indexOf(A) >= 0 ? r0.assigned.indexOf(A) : 0;
  const who = r0.assigned[c];
  await s.setDoc('weeks', LAST, { result: { [['floor', 'bathroom', 'kitchen'][c]]: 'skipped' } });
  assert.equal(debtOf(admin, who, c), 1);
  await admin.adjustBalance(who, { [['floor', 'bathroom', 'kitchen'][c]]: -1 });
  assert.equal(debtOf(admin, who, c), 0);
});

test('assegnare un riposo: il credito porta la persona a riposo; toglierlo no', async () => {
  const { ids, admin } = await setup();
  const [A] = ids;
  await admin.adjustBalance(A, { credit: 1 });
  assert.equal(creditOf(admin, A), 1);
  assert.equal(curRow(admin).restName, A);
  assert.ok(curRow(admin).rest.includes(A));
  await admin.adjustBalance(A, { credit: -1 });
  assert.equal(creditOf(admin, A), 0);
  assert.notEqual(curRow(admin).restName, A);
});

test('solo admin; persona sconosciuta rifiutata; settimana con risultati sposta la correzione alla successiva', async () => {
  const { s, ids, admin, user } = await setup();
  await assert.rejects(() => user.adjustBalance(ids[0], { floor: 1 }), /permission/);
  await assert.rejects(() => admin.adjustBalance('nessuno', { floor: 1 }), /invalid/);
  await s.setDoc('weeks', CUR, { result: { floor: 'done' } });
  const r = await admin.adjustBalance(ids[2], { kitchen: 1 });
  assert.equal(r.week, '2026-11-15');
});

test('«Nessuno questa settimana»: solo admin, la mansione resta vuota, nessun debito e Annulla', async () => {
  const { s, ids, admin, user } = await setup();
  const FUTW = '2026-11-15';
  const before = compute(engineHouse(s.state), NOW, 12).rows.find((r) => r.sunday === FUTW);
  await assert.rejects(() => user.setWeekAssignments(FUTW, { floor: '-' }), /permission/);
  const res = await admin.setWeekAssignments(FUTW, { floor: '-' });
  const row = admin.out().rows.find((r) => r.sunday === FUTW);
  assert.equal(row.assigned[0], '');
  assert.equal(row.swapped[0], true);
  assert.equal(row.assigned[1], before.assigned[1]);
  await admin.setWeekAssignments(FUTW, res.prev, { explicit: true });
  assert.equal(admin.out().rows.find((r) => r.sunday === FUTW).assigned[0], before.assigned[0]);
  assert.ok(ids.length);
});

test('«Nessuno» in una settimana chiusa non crea recuperi per nessuno', async () => {
  const { s, ids, admin } = await setup();
  const before = compute(engineHouse(s.state), NOW, 12).rows.find((r) => r.sunday === '2026-11-01');
  await s.setDoc('weeks', '2026-11-01', { result: { floor: null }, swap: { floor: '-' } });
  const row = admin.out().rows.find((r) => r.sunday === '2026-11-01');
  assert.equal(row.assigned[0], '');
  for (const d of curRow(admin).debts) assert.equal(d[0], 0);
  assert.ok(before && ids);
});

test('assegnare una mansione a una persona assente: accettato, il motore la assegna a lei', async () => {
  const { s, ids, admin } = await setup();
  const FUTW = '2026-11-15';
  const before = admin.out().rows.find((r) => r.sunday === FUTW);
  const away = ids.find((id) => id !== before.assigned[0]);
  await s.setDoc('weeks', FUTW, { awayMap: { [away]: true } });
  await admin.setWeekAssignments(FUTW, { floor: away });
  const row = admin.out().rows.find((r) => r.sunday === FUTW);
  assert.equal(row.away.includes(away), true);
  assert.equal(row.assigned[0], away);
});

test('correggere il risultato di una settimana passata: nessuno ha pulito / ha pulito X / skipped:X cambiano debiti e Annulla', async () => {
  const { s, ids, admin } = await setup();
  const LASTW = '2026-11-01';
  const r0 = admin.out().rows.find((r) => r.sunday === LASTW);
  const who = r0.assigned[0]; const other = ids.find((id) => id !== who);
  await admin.setResult(LASTW, 'floor', 'skipped');
  assert.equal(debtOf(admin, who, 0), 1);
  await admin.setResult(LASTW, 'floor', `by:${other}`);
  assert.equal(debtOf(admin, who, 0), 1);
  assert.ok(creditOf(admin, other) >= 1, 'chi ha pulito al posto di un altro guadagna un riposo');
  await admin.setResult(LASTW, 'floor', 'done');
  assert.equal(debtOf(admin, who, 0), 0);
  await admin.setResult(LASTW, 'floor', `skipped:${other}`);
  assert.equal(debtOf(admin, other, 0), 1);
  assert.equal(s.state.weeks[LASTW].result.floor, `skipped:${other}`);
});
