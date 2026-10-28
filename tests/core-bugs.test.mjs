// Caccia ai bug del nucleo (ottobre 2026): ogni test riproduce un difetto trovato nelle interazioni tra le funzioni recenti
// (giorno scelto fino a martedì dopo, «con recupero», recupero programmato, correzioni del risultato, backup su cloud).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, addDays } from '../js/engine.js';
import { planNotifications, notifMessage } from '../js/extras.js';

const START = '2026-10-04';
const wk = (i) => addDays(START, 7 * i);
const rm = ['A', 'B', 'C'].map((n, i) => ({ id: n, name: n === 'A' ? 'Anna' : n === 'B' ? 'Bruno' : 'Carla', slot: i + 1, from: null, to: null }));
const house = (extra = {}) => ({ id: 'H', name: 'Casa', startSunday: START, roommates: rm, tz: 'Europe/Rome', tasks: [], settings: {}, ...extra });

// ---------- notifiche: giorno scelto dopo la domenica ----------
test('notifiche: turno con giorno scelto lunedì/martedì dopo → niente solleciti «in ritardo» prima di quel giorno', () => {
  const h = house();
  const W = wk(4);                                                      // domenica 1/11
  const weeks = { [W]: { result: { bathroom: 'done', kitchen: 'done' }, plan: { floor: addDays(W, 2) } } };   // pavimenti: martedì 3/11
  const late = planNotifications({ house: h, weeks, now: new Date('2026-11-02T09:10:00Z') }).filter((x) => x.type === 'late');   // lunedì 10:10
  assert.equal(late.filter((x) => x.chores.includes('floor')).length, 0, 'lunedì non è in ritardo: ha scelto martedì');
  // mercoledì, se ancora non fatto, il sollecito riparte
  const wed = planNotifications({ house: h, weeks, now: new Date('2026-11-04T09:10:00Z') }).filter((x) => x.type === 'late');
  assert.ok(wed.some((x) => x.chores.includes('floor')));
});

test('notifiche: giorno scelto martedì della settimana dopo → promemoria «oggi è il giorno» quel martedì', () => {
  const h = house();
  const W = wk(4);
  const weeks = { [W]: { plan: { floor: addDays(W, 2) } } };
  const owner = compute({ ...h, weeks }, '2026-11-03', 2).rows[4].assigned[0];
  const n = planNotifications({ house: h, weeks, now: new Date('2026-11-03T08:20:00Z') }).filter((x) => x.type === 'planDay');   // martedì 9:20
  assert.ok(n.some((x) => x.personId === owner && x.week === W && x.chores.includes('floor')), 'promemoria il martedì scelto');
  // fatto: niente promemoria
  const done = { [W]: { ...weeks[W], result: { floor: 'done' } } };
  assert.equal(planNotifications({ house: h, weeks: done, now: new Date('2026-11-03T08:20:00Z') }).filter((x) => x.type === 'planDay' && x.week === W).length, 0);
});

test('notifiche: domenica «segna fatto» non a chi ha scelto un giorno dopo la domenica', () => {
  const h = house();
  const W = wk(4);
  const weeks = { [W]: { plan: { floor: addDays(W, 1) } } };            // pavimenti: lunedì dopo
  const owner = compute({ ...h, weeks }, W, 2).rows[4].assigned[0];
  const n = planNotifications({ house: h, weeks, now: new Date('2026-11-01T17:20:00Z') }).filter((x) => x.type === 'sunMark');
  assert.equal(n.filter((x) => x.chores.includes('floor')).length, 0);
  assert.ok(n.length >= 1, 'le altre mansioni sì');
  assert.ok(owner);
});

// ---------- notifiche: turno «con recupero» (concordato con un altro) ----------
test('notifiche: turno passato a un altro (agreed) → i promemoria vanno a chi lo fa, senza «Segna fatto»', () => {
  const h = house();
  const W = wk(4);
  const row = compute({ ...h, weeks: {} }, '2026-10-31', 2).rows[4];
  const X = row.assigned[0]; const Y = ['A', 'B', 'C'].find((id) => id !== X);
  const weeks = { [W]: { agreed: { floor: Y } } };
  const sat = planNotifications({ house: h, weeks, now: new Date('2026-10-31T09:15:00Z') }).filter((x) => x.type === 'satDuty');
  assert.ok(sat.some((x) => x.personId === Y && x.chores.includes('floor')), 'chi lo fa riceve il promemoria');
  assert.ok(!sat.some((x) => x.personId === X && x.chores.includes('floor')), 'chi non può non riceve «tocca a te»');
  const nY = sat.find((x) => x.personId === Y && x.chores.includes('floor'));
  if (nY.chores.length === 1) assert.equal(notifMessage(nY, h, 'it').actions, undefined, '«Segna fatto» dalla notifica non vale per chi copre (segna «ha pulito»)');
  // lunedì: il sollecito va a chi ha preso il turno
  const late = planNotifications({ house: h, weeks, now: new Date('2026-11-02T09:10:00Z') }).filter((x) => x.type === 'late');
  assert.ok(late.some((x) => x.personId === Y && x.chores.includes('floor')));
  assert.ok(!late.some((x) => x.personId === X && x.chores.includes('floor')));
});
