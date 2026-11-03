// Mansioni nell'interfaccia (js/choreui.js) e un controllo sullo storico quando l'admin toglie una mansione (Actions.saveChores).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryBackend, Store } from '../js/store.js';
import { Actions, buildHouse } from '../js/actions.js';
import { DEFAULT_CHORES } from '../js/engine.js';
import { setLang } from '../js/i18n.js';
import { cIds, cName, cShort, cIcon, cCls, cSeg, cOn, cIdx, cActive, CHORE_ICONS } from '../js/choreui.js';

const NOW = '2026-11-03';
async function setup(chores, names = ['Anna', 'Bruno', 'Carla', 'Dario', 'Elena']) {
  const hub = new MemoryHub();
  const house = await buildHouse({ id: 'H1', name: 'Casa', startSunday: '2026-09-06', roommates: names.map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  if (chores) house.chores = chores;
  const b = new MemoryBackend(hub); await b.open('H1'); const s = new Store(b); await s.setHouse(house, true);
  const weeks = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'];
  for (const [i, w] of weeks.entries()) await s.setDoc('weeks', w, { result: { floor: i % 3 ? 'done' : 'skipped', bathroom: 'done', kitchen: i % 4 ? 'done' : 'skipped' } });
  return { s, admin: new Actions(s, { now: () => new Date(NOW + 'T10:00:00'), isAdmin: true }), weeks };
}
const byChore = (row) => Object.fromEntries(row.chores.map((c, k) => [c, row.assigned[k]]));

test('togliere la PRIMA mansione non riscrive le settimane passate (resta al suo posto nell\'ordine)', async () => {
  const { s, admin, weeks } = await setup(null);
  const before = Object.fromEntries(admin.out().rows.filter((r) => weeks.includes(r.sunday)).map((r) => [r.sunday, byChore(r)]));
  const list = await admin.saveChores([{ id: 'bathroom' }, { id: 'kitchen' }]);
  assert.deepEqual(list.map((c) => c.id), ['floor', 'bathroom', 'kitchen']);
  assert.equal(list[0].to, '2026-11-01');
  const after = admin.out().rows.filter((r) => weeks.includes(r.sunday));
  for (const r of after) assert.deepEqual(byChore(r), before[r.sunday], r.sunday);
  // la settimana corrente non ha più i pavimenti
  const cur = admin.out().rows.find((r) => r.sunday === '2026-11-08');
  assert.equal(cur.active[0], false); assert.equal(cur.assigned[0], '');
  assert.deepEqual(cActive(s.state.house, NOW), ['bathroom', 'kitchen']);
  // una nuova mansione messa per prima non cambia lo storico
  await admin.saveChores([{ name: 'Spazzatura', icon: 'trash' }, { id: 'bathroom' }, { id: 'kitchen' }]);
  for (const r of admin.out().rows.filter((x) => weeks.includes(x.sunday))) {
    const m = byChore(r); const nw = r.chores.find((c) => c.startsWith('c_'));
    assert.equal(m[nw], ''); delete m[nw]; assert.deepEqual(m, before[r.sunday], r.sunday);
  }
});

test('choreui: nomi, icone, classi colore e mansioni in turno', () => {
  setLang('it');
  const house = { chores: [...DEFAULT_CHORES.map((c) => ({ ...c })), { id: 'c_aaaa', name: { it: 'Giardino', en: 'Garden' }, icon: 'leaf', effort: 2 }, { id: 'c_bbbb', name: 'Spazzatura', icon: 'trash', effort: 1, to: '2026-10-01' }] };
  assert.deepEqual(cIds(house), ['floor', 'bathroom', 'kitchen', 'c_aaaa', 'c_bbbb']);
  assert.equal(cName(house, 'floor'), 'Pavimenti'); assert.equal(cShort(house, 'floor'), 'Pavimenti');
  assert.equal(cName(house, 'c_aaaa'), 'Giardino'); assert.equal(cIcon(house, 'c_aaaa'), 'leaf');
  assert.equal(cCls(house, 'kitchen'), 'kitchen'); assert.equal(cCls(house, 'c_aaaa'), 'cx cx0'); assert.equal(cCls(house, 'c_bbbb'), 'cx cx1');
  assert.equal(cSeg(house, 'floor'), 'seg-floor'); assert.equal(cSeg(house, 'c_bbbb'), 'seg-cx cx1');
  assert.deepEqual(cActive(house, '2026-11-03'), ['floor', 'bathroom', 'kitchen', 'c_aaaa']);
  setLang('en'); assert.equal(cName(house, 'c_aaaa'), 'Garden'); assert.equal(cName(house, 'bathroom'), 'Bathroom'); setLang('it');
  // ctx al posto della casa
  const ctx = { t: () => '', house };
  assert.equal(cName(ctx, 'c_bbbb'), 'Spazzatura');
  const row = { chores: ['floor', 'c_x'], assigned: ['a', ''], active: [true, false] };
  assert.deepEqual(cIds(ctx, row), ['floor', 'c_x']); assert.equal(cOn(row, 1), false); assert.deepEqual(cIdx(row), [0]);
  assert.ok(CHORE_ICONS.includes('broom') && CHORE_ICONS.length >= 10);
});
