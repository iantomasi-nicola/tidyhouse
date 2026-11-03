// Nucleo con mansioni extra (house.chores) e più di 4 persone: extras (nomi, statistiche, WhatsApp, .ics, export, notifiche) e Actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryBackend, Store, engineHouse } from '../js/store.js';
import { Actions, buildHouse } from '../js/actions.js';
import { compute, choresOf, DEFAULT_CHORES, CHORES, NOBODY } from '../js/engine.js';
import { choreName, choreIcon, choreIds, choreIndex, effortOf, buildStats, whatsappText, makeIcs, historyRows, planNotifications, notifMessage, swapPatch, checklistOwners, newChoreId } from '../js/extras.js';
import { finalSwap, applySwap, diffAssign, loadOf } from '../js/assignlogic.js';

const START = '2026-10-04', NOW = '2026-11-03', CUR = '2026-11-08';
const GARDEN = { id: 'c_garden', name: { it: 'Giardino', en: 'Garden' }, icon: 'leaf', effort: 3 };
const TRASH = { id: 'c_trash', name: 'Spazzatura', icon: 'trash', effort: 1 };
const CH5 = [...DEFAULT_CHORES.map((c) => ({ ...c })), GARDEN, TRASH];
const NAMES = ['Anna', 'Bruno', 'Carla', 'Dario', 'Elena', 'Fabio', 'Gaia'];

async function setup({ chores = CH5, names = NAMES } = {}) {
  const hub = new MemoryHub();
  const house = await buildHouse({ id: 'H1', name: 'Casa', startSunday: START, roommates: names.map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  if (chores) house.chores = chores;
  const b = new MemoryBackend(hub); await b.open('H1'); const s = new Store(b); await s.setHouse(house, true);
  const mk = (ctx) => new Actions(s, { now: () => new Date(NOW + 'T10:00:00'), ...ctx });
  const ids = house.roommates.map((r) => r.id);
  const all = Object.fromEntries(choresOf(house).map((c) => [c.id, 'done']));
  for (const w of ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01']) await s.setDoc('weeks', w, { result: all });
  return { s, ids, house, admin: mk({ isAdmin: true }), as: (id) => mk({ meId: id }) };
}
const rowAt = (a, w) => a.out().rows.find((r) => r.sunday === w);

test('nomi e icone: predefinite tradotte, nuove con {it,en} o stringa, rinomina di una predefinita', () => {
  const h = { chores: CH5 };
  assert.equal(choreName({}, 'floor', 'it'), 'Pavimenti');
  assert.equal(choreName({}, 'kitchen', 'en'), 'Kitchen');
  assert.equal(choreName(h, 'c_garden', 'en'), 'Garden');
  assert.equal(choreName(h, 'c_garden', 'it'), 'Giardino');
  assert.equal(choreName(h, 'c_trash', 'en'), 'Spazzatura');
  assert.equal(choreName({ chores: [{ id: 'floor', name: 'Pavimenti e scale' }] }, 'floor', 'en'), 'Pavimenti e scale');
  assert.equal(choreName({}, 'c_gone', 'it'), 'Mansione tolta');
  assert.equal(choreIcon({}, 'bathroom'), 'shower');
  assert.equal(choreIcon(h, 'c_garden'), 'leaf');
  assert.equal(choreIcon(h, 'c_nope'), 'dot');
  assert.deepEqual(choreIds(h), [...CHORES, 'c_garden', 'c_trash']);
  assert.equal(choreIndex(h, 'c_trash'), 4);
  assert.deepEqual(effortOf({ effort: { floor: 2 } }), { floor: 2, bathroom: 1, kitchen: 1 });
  assert.equal(effortOf(h).c_garden, 3);
  assert.match(newChoreId(), /^c_[0-9a-z]{8}$/);
});

test('7 persone, 5 mansioni: statistiche, WhatsApp, .ics, export e assegnazioni per mansione', async () => {
  const { s, admin, house } = await setup();
  const eh = engineHouse(s.state);
  const out = compute(eh, NOW, 4);
  const row = out.rows.find((r) => r.sunday === CUR);
  assert.equal(row.assigned.length, 5);
  assert.equal(row.nm.length, 7);
  assert.equal(new Set(row.assigned).size, 5, 'una mansione a testa');
  const st = buildStats(eh, out);
  assert.equal(st.people.length, 7);
  for (const p of st.people) { assert.equal(p.cleaned.length, 5); assert.equal(p.makeups.length, 5); }
  assert.equal(st.people.reduce((a, p) => a + p.cleanedTotal, 0), 20, '4 settimane chiuse × 5 mansioni');
  assert.equal(st.people.reduce((a, p) => a + p.effort, 0), 4 * (1 + 1 + 1 + 3 + 1));
  const wa = whatsappText(eh, out, CUR, {}, 'it', s.state.weeks);
  assert.match(wa, /Giardino: /);
  assert.match(wa, /Spazzatura: /);
  assert.match(wa, /🧽 Pavimenti: /);
  const who = row.assigned[3];
  const ics = makeIcs(eh, out, who, 'en', s.state.weeks, CUR, 1);
  assert.match(ics, /SUMMARY:🧹 Garden/);
  const hist = historyRows(eh, out, 'it', s.state.weeks);
  assert.ok('Giardino' in hist[0] && 'result_Spazzatura' in hist[0] && 'makeup_floor' in hist[0]);
  assert.ok(admin && house);
});

test('Actions con mansioni extra: segna fatto, recupero, non posso, scambio, assegna settimana, correzioni', async () => {
  const { s, ids, admin, as } = await setup();
  let row = rowAt(admin, '2026-11-01');
  // la settimana scorsa: chi aveva il giardino lo ha saltato → recupero sul giardino questa settimana
  const g = row.assigned[3];
  await admin.setResult('2026-11-01', 'c_garden', 'skipped');
  row = rowAt(admin, CUR);
  assert.equal(row.assigned[3], g);
  assert.equal(row.isMakeup[3], 1);
  // l'assegnato del giardino segna fatto
  const me = as(g);
  const r = await me.completeChore(CUR, 'c_garden');
  assert.ok(r.ok);
  assert.equal(s.state.weeks[CUR].result.c_garden, 'done');
  await assert.rejects(() => admin.setResult(CUR, 'c_nope', 'done'), /invalid/);
  // «non posso» sulla spazzatura: sostituto automatico
  const t = row.assigned[4];
  const sub = await as(t).autoCover(CUR, 'c_trash');
  assert.ok(sub && sub !== t);
  assert.equal(s.state.weeks[CUR].agreed.c_trash, sub);
  // scambio tra la spazzatura e il pavimento
  const f = row.assigned[0];
  const rq = await as(t).requestSwap({ week: CUR, myChore: 'c_trash', otherId: f, otherChore: 'floor' });
  await as(f).answerSwap(rq, true);
  row = rowAt(admin, CUR);
  assert.equal(row.assigned[0], t); assert.equal(row.assigned[4], f);
  // assegnazione manuale (admin) di una mansione extra e NOBODY
  const free = ids.find((id) => !row.assigned.includes(id) && row.pr[row.nm.indexOf(id)] === 1);
  const res = await admin.setWeekAssignments('2026-11-15', { c_trash: free, c_garden: NOBODY }, { merge: true });
  assert.ok(res.changes.some((x) => x.chore === 'c_trash' && x.to === free));
  const r15 = rowAt(admin, '2026-11-15');
  assert.equal(r15.assigned[4], free); assert.equal(r15.assigned[3], '');
  await assert.rejects(() => admin.setWeekAssignments('2026-11-15', { c_nope: free }, { merge: true }), /invalid/);
  // correzione: +2 recuperi di spazzatura a Elena
  const E = ids[4];
  const adj = await admin.adjustBalance(E, { c_trash: 2 });
  assert.deepEqual(adj.applied, { c_trash: 2 });
  const br = admin.balanceRow();
  assert.equal(br.debts[br.nm.indexOf(E)][4], 2);
  await admin.restoreAdjust(adj.week, E, adj.prev);
  const br2 = admin.balanceRow();
  assert.equal(br2.debts[br2.nm.indexOf(E)][4], 0);
});

test('saveChores: nuova mansione dalla settimana prossima, tolta = finisce la settimana scorsa (storico intatto)', async () => {
  const { s, admin } = await setup({ chores: null, names: NAMES.slice(0, 5) });
  const before = rowAt(admin, '2026-11-01').assigned.slice();
  await assert.rejects(() => new Actions(s, { meId: 'x' }).saveChores([{ name: 'X' }]), /permission/);
  const list = await admin.saveChores([{ id: 'floor' }, { id: 'bathroom' }, { name: { it: 'Giardino', en: 'Garden' }, icon: 'leaf', effort: 9 }]);
  assert.equal(list.length, 4);
  const nw = list[2];
  assert.match(nw.id, /^c_/); assert.equal(nw.effort, 5); assert.equal(nw.from, '2026-11-09');
  const kit = list.find((c) => c.id === 'kitchen'); assert.equal(kit.to, '2026-11-01');
  assert.deepEqual(s.state.house.chores.map((c) => c.id), ['floor', 'bathroom', nw.id, 'kitchen']);
  // storico: le settimane passate non cambiano; la corrente non ha la cucina né il giardino; dalla prossima c'è il giardino
  const last = rowAt(admin, '2026-11-01');
  assert.deepEqual([last.assigned[0], last.assigned[1], last.assigned[3]], before);
  assert.equal(last.assigned[2], '');
  const cur = rowAt(admin, CUR);
  assert.equal(cur.assigned[2], ''); assert.equal(cur.assigned[3], '');
  assert.ok(rowAt(admin, '2026-11-15').assigned[2]);
  assert.ok(cur.debts.every((d) => !d || d.every((x) => x === 0)), 'nessun debito creato');
  await assert.rejects(() => admin.saveChores([]), /invalid/, 'almeno una mansione in turno');
});

test('notifiche: sabato «cosa ti tocca» anche per le mansioni extra, con il loro nome', async () => {
  const { s } = await setup();
  const eh = engineHouse(s.state);
  const ns = planNotifications({ house: eh, weeks: eh.weeks, now: new Date('2026-11-07T09:30:00Z') });
  const sat = ns.filter((n) => n.type === 'satDuty');
  assert.equal(sat.reduce((a, n) => a + n.chores.length, 0), 5);
  const g = sat.find((n) => n.chores.includes('c_garden'));
  assert.match(notifMessage(g, eh, 'en').body, /Garden/);
  assert.equal(notifMessage(g, eh, 'en').actions[0].url, `#/do/done/${CUR}/c_garden`);
});

test('assignlogic e swapPatch con mansioni extra', () => {
  const ids = [...CHORES, 'c_garden'];
  const ruled = ['A', 'B', 'C', 'D'];
  const { swap } = finalSwap({ ruled, wanted: { c_garden: 'E', floor: 'A' }, merge: true, ids });
  assert.deepEqual(swap, { c_garden: 'E' });
  assert.deepEqual(applySwap(ruled, swap, ids), ['A', 'B', 'C', 'E']);
  assert.deepEqual(diffAssign(ruled, ['A', 'B', 'C', 'E'], ids), [{ chore: 'c_garden', from: 'D', to: 'E' }]);
  assert.deepEqual(loadOf(['A', 'A', 'C', 'D'], ids), { A: ['floor', 'bathroom'], C: ['kitchen'], D: ['c_garden'] });
  assert.deepEqual(swapPatch({ assigned: ruled, chores: ids }, { chore: 'floor', personId: 'A' }, { chore: 'c_garden', personId: 'D' }), { floor: 'D', c_garden: 'A' });
  assert.equal(typeof checklistOwners, 'function');
});
