// Caccia ai bug del nucleo (ottobre 2026): ogni test riproduce un difetto trovato nelle interazioni tra le funzioni recenti
// (giorno scelto fino a martedì dopo, «con recupero», recupero programmato, correzioni del risultato, backup su cloud).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, addDays } from '../js/engine.js';
import { planNotifications, notifMessage } from '../js/extras.js';
import { MemoryHub, MemoryBackend, Store, CloudBackend } from '../js/store.js';
import { Actions, buildHouse, exportBackup, importBackupOps } from '../js/actions.js';

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

test('notifiche: «Nessuno questa settimana» non genera promemoria né solleciti; l\'assegnato assente li riceve', () => {
  const h = house({ adminIds: ['A'], notif: { adminDigest: { on: true } } });
  const W = wk(4);
  const base = compute({ ...h, weeks: {} }, '2026-10-31', 2).rows[4];
  const weeks = { [W]: { swap: { floor: '-' } } };
  const all = [...planNotifications({ house: h, weeks, now: new Date('2026-10-31T09:15:00Z') }), ...planNotifications({ house: h, weeks, now: new Date('2026-11-02T09:10:00Z') })];
  assert.ok(all.length > 0);
  assert.ok(all.every((x) => !(x.chores || []).includes('floor')), 'nessuna notifica per la mansione senza nessuno');
  assert.ok(all.every((x) => x.personId), 'nessuna notifica senza destinatario');
  const dig = planNotifications({ house: h, weeks, now: new Date('2026-11-02T08:40:00Z') }).find((x) => x.type === 'adminDigest');
  assert.equal(dig.n, 2, 'il riepilogo non conta la mansione senza nessuno');
  // assegnata a mano a chi è via: il promemoria arriva comunque a lei (è il suo turno)
  const away = ['A', 'B', 'C'].find((id) => id !== base.assigned[1]);
  const w2 = { [W]: { away: [away], swap: { bathroom: away } } };
  assert.ok(planNotifications({ house: h, weeks: w2, now: new Date('2026-10-31T09:15:00Z') }).some((x) => x.type === 'satDuty' && x.personId === away && x.chores.includes('bathroom')));
});

// ---------- azioni: recupero programmato, correzione dei risultati ----------
async function setupHouse(now) {
  const hub = new MemoryHub();
  const h = await buildHouse({ id: 'H1', name: 'Casa', startSunday: START, roommates: ['Anna', 'Bruno', 'Carla'].map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  const b = new MemoryBackend(hub); await b.open('H1'); const s = new Store(b); await s.setHouse(h, true);
  const ids = h.roommates.map((r) => r.id);
  const mk = (ctx) => new Actions(s, { now: () => new Date(now + 'T10:00:00'), ...ctx });
  return { s, ids, admin: mk({ isAdmin: true }), as: (id) => mk({ meId: id }), rowAt: (a, sun) => a.out().rows.find((r) => r.sunday === sun) };
}
/** X annuncia «recupero il lunedì dopo la settimana successiva»: il turno di quella settimana passa a X (autoMakeup). */
async function makeupScenario() {
  const W = wk(3), W2 = wk(4);                                           // 25/10 e 1/11
  const env = await setupHouse(addDays(W, 1));                           // lunedì 26/10 (tolleranza)
  const X = env.rowAt(env.admin, W).assigned[0]; const Y = env.rowAt(env.admin, W2).assigned[0];
  assert.notEqual(X, Y, 'scenario: pavimenti a due persone diverse');
  await env.as(X).setDelay(W, 'floor', addDays(W2, 1));                  // lunedì 2/11
  assert.equal(env.rowAt(env.admin, W2).assigned[0], X, 'premessa: recupero programmato');
  return { ...env, W, W2, X, Y };
}

test('recupero programmato: se l\'admin poi assegna a mano quella mansione, togliere il ritardo non cancella la sua scelta', async () => {
  const { s, ids, admin, as, rowAt, W, W2, X, Y } = await makeupScenario();
  const Z = ids.find((id) => id !== X && id !== Y);
  const r2 = rowAt(admin, W2);
  await admin.setWeekAssignments(W2, { floor: Z, bathroom: r2.assigned[1], kitchen: r2.assigned[2] });
  assert.equal(rowAt(admin, W2).assigned[0], Z);
  await as(X).setDelay(W, 'floor', null);
  assert.equal(rowAt(admin, W2).assigned[0], Z, 'la scelta dell\'admin resta');
  assert.equal(((s.state.weeks[W2].autoMakeup || {}).floor), undefined, 'il segno del recupero programmato se ne va');
});

test('recupero programmato già svolto: cambiare/togliere il ritardo non riscrive la storia', async () => {
  const { s, admin, as, rowAt, W, W2, X } = await makeupScenario();
  await s.setDoc('weeks', W2, { result: { floor: 'done' } });            // X ha fatto il recupero
  assert.equal(rowAt(admin, W2).cleaner[0], X);
  await as(X).setDelay(W, 'floor', null);
  const after = rowAt(admin, W2);
  assert.equal(after.assigned[0], X, 'resta di X: l\'ha fatto lui');
  assert.equal(after.cleaner[0], X);
});

test('setResult: valori non validi rifiutati (chi non esiste, «saltato anche» dall\'assegnato, mansione senza nessuno)', async () => {
  const { ids, admin, as, rowAt } = await setupHouse('2026-10-28');
  const W = wk(3);
  const a = rowAt(admin, W).assigned[0]; const other = ids.find((id) => id !== a);
  const base = rowAt(admin, wk(4)).debts.map((d) => d && d[0]);
  await assert.rejects(() => admin.setResult(W, 'floor', 'by:sconosciuto'), /invalid/);
  await assert.rejects(() => admin.setResult(W, 'floor', 'boh'), /invalid/);
  await assert.rejects(() => admin.setResult(W, 'floor', `skipped:${a}`), /invalid/, 'conterebbe due volte il debito dell\'assegnato');
  await assert.rejects(() => admin.setResult(W, 'pavimento', 'done'), /invalid|permission/);
  await admin.setResult(W, 'floor', `skipped:${other}`);                   // valido
  // «Nessuno questa settimana»: nessun risultato da registrare (un «saltato anche X» darebbe un debito a X)
  const r = rowAt(admin, W);
  await admin.setWeekAssignments(W, { floor: '-', bathroom: r.assigned[1], kitchen: r.assigned[2] });
  await assert.rejects(() => admin.setResult(W, 'floor', `skipped:${other}`), /invalid/);
  await assert.rejects(() => as(other).setResult(W, 'floor', `by:${other}`), /invalid|permission/);
  await admin.setResult(W, 'floor', '');                                    // togliere resta sempre possibile
  assert.deepEqual(rowAt(admin, wk(4)).debts.map((d) => d && d[0]), base, 'nessun debito di pavimenti in più');
});

test('correggere chi ha pulito: il segno «volontario» non resta su un risultato diverso', async () => {
  const { s, ids, admin, as, rowAt } = await setupHouse('2026-10-28');
  const W = wk(4);
  const a = rowAt(admin, W).assigned[0]; const v = ids.find((id) => id !== a);
  const r = await as(v).volunteer(W, 'floor', { force: true });
  assert.equal(r.ok, true); assert.equal(s.state.weeks[W].volunteer.floor, v);
  await admin.setResult(W, 'floor', 'done');                               // in realtà l'ha fatto l'assegnato
  assert.equal((s.state.weeks[W].volunteer || {}).floor, undefined);
  await admin.setResult(W, 'floor', `by:${v}`);
  assert.equal((s.state.weeks[W].volunteer || {}).floor, undefined, 'non si reinventa');
});

test('recuperi e riposi: con risultati nella settimana corrente la correzione vale dalla prossima e balanceRow() lo dice', async () => {
  const { s, ids, admin, rowAt } = await setupHouse('2026-10-28');
  const CUR = wk(4), NEXT = wk(5);
  await s.setDoc('weeks', CUR, { result: { kitchen: 'done' } });
  const A = ids[1];
  const shownBefore = admin.balanceRow(); assert.equal(shownBefore.sunday, NEXT);
  const before = shownBefore.debts[shownBefore.nm.indexOf(A)][0];
  const r = await admin.adjustBalance(A, { floor: 1 });
  assert.equal(r.week, NEXT);
  const cur = rowAt(admin, CUR); const shown = admin.balanceRow();
  assert.equal(cur.debts[cur.nm.indexOf(A)][0], rowAt(admin, CUR).debts[cur.nm.indexOf(A)][0], 'la settimana corrente non cambia');
  assert.equal(shown.debts[shown.nm.indexOf(A)][0], before + 1, 'la riga da mostrare sì');
});

test('permessi: tutte le azioni riservate all\'admin rifiutano chi non è admin, senza scrivere nulla', async () => {
  const { s, ids, as } = await setupHouse('2026-10-28');
  const u = as(ids[1]); const W = wk(4);
  const before = JSON.stringify(s.state);
  const calls = [
    () => u.setWeekAssignments(W, { floor: '-' }), () => u.adjustBalance(ids[0], { floor: 1 }), () => u.restoreAdjust(W, ids[0], {}),
    () => u.setBadgeOff(ids[0], 'tr', true), () => u.setResult(W, 'floor', 'skipped'), () => u.setResult(wk(3), 'floor', `skipped:${ids[2]}`),
    () => u.assignCover(W, 'floor', ids[2]), () => u.setSwap(W, { floor: ids[2] }), () => u.clearSwap(W), () => u.setEveryoneAway(W, true),
    () => u.setHouse({ name: 'x' }), () => u.setRoommates([]), () => u.changeAdmin({ personId: ids[1], pin: '9999' }), () => u.testAll(),
    () => u.expireStaleRequests(), () => u.saveShared([]), () => u.rotateCode(),
  ];
  for (const f of calls) await assert.rejects(f, /permission/);
  assert.equal(JSON.stringify(s.state), before);
});

test('scambio di turno: non si accetta due volte, né se è già stato rifiutato, né se nel frattempo i turni sono cambiati', async () => {
  const { s, ids, admin, as, rowAt } = await setupHouse('2026-10-28');
  const W = wk(5);
  const r = rowAt(admin, W); const A = r.assigned[0], B = r.assigned[1];
  const id = await as(A).requestSwap({ week: W, myChore: 'floor', otherId: B, otherChore: 'bathroom' });
  await as(B).answerSwap(id, false);
  await assert.rejects(() => as(B).answerSwap(id, true), /permission|expired/, 'rifiutato: non si può più accettare (es. vecchia notifica)');
  assert.equal(rowAt(admin, W).assigned[0], A);
  const id2 = await as(A).requestSwap({ week: W, myChore: 'floor', otherId: B, otherChore: 'bathroom' });
  const C = ids.find((x) => x !== A && x !== B);
  await admin.setWeekAssignments(W, { floor: C, bathroom: B, kitchen: rowAt(admin, W).assigned[2] });   // l'admin ha dato pavimenti a C
  await assert.rejects(() => as(B).answerSwap(id2, true), /expired/, 'A non ha più pavimenti: lo scambio non vale più');
  assert.equal(rowAt(admin, W).assigned[0], C, 'C non perde il turno per uno scambio vecchio');
  assert.ok(s.state.requests[id2]);
});

// ---------- cloud: scritture grandi (import di un backup) ----------
/** Finto Firestore: come quello vero, un batch accetta al massimo 500 scritture e deleteField() solo con merge. */
function fakeFs() {
  const DEL = { del: true }; const commits = [];
  const hasDel = (v) => v === DEL || (!!v && typeof v === 'object' && Object.values(v).some(hasDel));
  return {
    commits,
    deleteField: () => DEL,
    doc: (db, ...p) => p.join('/'),
    writeBatch: () => {
      const ops = [];
      return {
        set(ref, data, opt) { if (!(opt && opt.merge) && hasDel(data)) throw new Error('deleteField in set senza merge'); ops.push(['set', ref]); },
        delete(ref) { ops.push(['del', ref]); },
        async commit() { if (ops.length > 500) throw new Error('batch > 500'); commits.push(ops.length); },
      };
    },
  };
}
const cloudWith = (fs) => { const b = new CloudBackend({}); b.fs = fs; b.db = {}; b.id = 'H'; return b; };

test('cloud: importare un backup grande (più di 500 scritture) non fallisce', async () => {
  const fs = fakeFs(); const b = cloudWith(fs);
  const weeks = {}; const log = {};
  for (let i = 0; i < 120; i++) weeks[addDays(START, 7 * i)] = { result: { floor: 'done' } };
  for (let i = 0; i < 450; i++) log['L' + i] = { at: '2026-10-01T00:00:00Z', type: 'done', p: {} };
  const bk = exportBackup({ house: house(), weeks, trips: {}, needs: {}, log, requests: {}, members: {}, views: {} });
  const ops = importBackupOps(bk, 'H');
  assert.ok(ops.length > 500);
  await b.write(ops);
  assert.equal(fs.commits.reduce((x, n) => x + n, 0), ops.length);
  assert.ok(fs.commits.every((n) => n <= 500));
});

test('cloud: una scrittura «set» con valori null non usa deleteField (Firestore lo rifiuta)', async () => {
  const fs = fakeFs(); const b = cloudWith(fs);
  await b.write([{ coll: 'house', data: { ...house(), rules: null, ai: { enabled: null } }, set: true }]);
  assert.equal(fs.commits.length, 1);
});
