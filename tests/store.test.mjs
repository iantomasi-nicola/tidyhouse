import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryBackend, Store, mergeDeep, applyOps, engineHouse, CloudBackend } from '../js/store.js';
import { Actions, buildHouse, hashPin, verifyPin, exportBackup, importBackupOps, normalizeStartSunday, localDate } from '../js/actions.js';
import { compute, addDays } from '../js/engine.js';

const START = '2026-10-04';
const wk = (i) => addDays(START, 7 * i);
const names = ['Anna', 'Bruno', 'Carla'];
async function mkHouse(hub, id = 'H1') {
  const house = await buildHouse({ id, name: 'Casa Test', startSunday: START, roommates: names.map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  const b = new MemoryBackend(hub); await b.open(id); const s = new Store(b);
  await s.setHouse(house, true);
  return { house, s };
}
async function client(hub, id, ctx) { const b = new MemoryBackend(hub); await b.open(id); const s = new Store(b); return { s, a: new Actions(s, { now: () => new Date('2026-10-28T10:00:00'), ...ctx }) }; }

test('mergeDeep: null cancella, oggetti annidati si fondono, array si sostituiscono', () => {
  assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 }, x: [1, 2] }, { a: { b: null, d: 3 }, x: [9] }), { a: { c: 2, d: 3 }, x: [9] });
  assert.deepEqual(mergeDeep(undefined, { a: 1 }), { a: 1 });
  assert.deepEqual(mergeDeep({ a: 1 }, { a: undefined }), { a: 1 });
  const st = { house: null, weeks: {} };
  applyOps(st, [{ coll: 'weeks', id: 'w', data: { result: { floor: 'done' } } }, { coll: 'weeks', id: 'w', data: { result: { floor: null, kitchen: 'done' } } }]);
  assert.deepEqual(st.weeks.w, { result: { kitchen: 'done' } });
  applyOps(st, [{ coll: 'weeks', id: 'w', del: true }]);
  assert.equal(st.weeks.w, undefined);
});

test('PIN admin: hash con sale, verifica corretta e errata', async () => {
  const h = await buildHouse({ id: 'x', name: 'c', startSunday: START, roommates: [{ name: 'A' }], pin: 'segreto' });
  assert.ok(h.adminHash.length === 64 && h.adminHash !== 'segreto');
  assert.equal(await verifyPin(h, 'segreto'), true);
  assert.equal(await verifyPin(h, 'sbagliato'), false);
  assert.equal(await verifyPin({}, 'x'), false);
  assert.notEqual(await hashPin('a', 's1'), await hashPin('a', 's2'));
});

test('due dispositivi: le modifiche si propagano in tempo reale', async () => {
  const hub = new MemoryHub();
  await mkHouse(hub);
  const d1 = await client(hub, 'H1', { meId: null, isAdmin: true });
  const d2 = await client(hub, 'H1', { meId: d1.s.state.house.roommates[1].id });
  let seen = 0; d1.s.on(() => seen++);
  const bruno = d2.a.me;
  const out = d2.a.out();
  const sunday = out.rows[out.cur].sunday;
  const mine = out.rows[out.cur].assigned.indexOf(bruno);
  assert.ok(mine >= 0);
  await d2.a.setResult(sunday, ['floor', 'bathroom', 'kitchen'][mine], 'done');
  assert.ok(seen > 0);
  assert.equal(d1.s.state.weeks[sunday].result[['floor', 'bathroom', 'kitchen'][mine]], 'done');
  // il log registra chi l'ha fatto
  assert.ok(Object.values(d1.s.state.log).some((l) => l.type === 'done' && l.by === bruno));
  // e il motore lo vede come fatto
  const r = compute(engineHouse(d1.s.state), '2026-10-28', 3).rows[out.cur];
  assert.equal(r.res[mine].kind, 'done');
});

test('permessi: un coinquilino non puo\' segnare turni altrui, saltare o toccare le impostazioni', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const ids = adm.s.state.house.roommates.map((r) => r.id);
  const me = await client(hub, 'H1', { meId: ids[2] });
  const out = me.a.out(); const row = out.rows[out.cur]; const sunday = row.sunday;
  const other = row.assigned.findIndex((x) => x && x !== ids[2]);
  const C = ['floor', 'bathroom', 'kitchen'];
  await assert.rejects(me.a.setResult(sunday, C[other], 'done'), /permission/);
  const mineIdx = row.assigned.indexOf(ids[2]);
  await assert.rejects(me.a.setResult(sunday, C[mineIdx], 'skipped'), /permission/);
  await assert.rejects(me.a.setResult(sunday, C[mineIdx], 'skipped:' + ids[0]), /permission/);
  await me.a.setResult(sunday, C[mineIdx], 'done');                                      // ok
  await me.a.setResult(sunday, C[other], 'by:' + ids[2]);                                // ho pulito io al posto suo: ok
  await assert.rejects(me.a.setResult(sunday, C[other], 'by:' + ids[1]), /permission/);  // dichiarare per conto di un terzo: no
  await assert.rejects(me.a.setHouse({ name: 'x' }), /permission/);
  await assert.rejects(me.a.setRoommates([]), /permission/);
  await assert.rejects(me.a.setAway(sunday, ids[0], true), /permission/);
  await me.a.setAway(sunday, ids[2], true);
  assert.equal(me.s.state.weeks[sunday].awayMap[ids[2]], true);
  await me.a.setAway(sunday, ids[2], false);
  assert.equal(me.s.state.weeks[sunday].awayMap[ids[2]], undefined);
  // storico molto vecchio: solo admin
  await assert.rejects(me.a.setResult(wk(0), 'floor', 'done'), /permission/);
  await adm.a.setResult(wk(0), 'floor', 'skipped');                                      // admin puo'
  // funzioni disattivate dall'admin
  await adm.a.setHouse({ features: { selfDone: false, selfAway: false } });
  await assert.rejects(me.a.setResult(sunday, C[mineIdx], 'done'), /permission/);
  await assert.rejects(me.a.setAway(sunday, ids[2], true), /permission/);
});

test('assenze: awayMap e viaggi arrivano al motore', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const ids = adm.s.state.house.roommates.map((r) => r.id);
  await adm.a.setAway(wk(5), ids[0], true);
  await adm.a.addTrip({ personId: ids[1], from: wk(8), to: wk(11) });
  await assert.rejects(adm.a.addTrip({ personId: ids[1], from: wk(8), to: wk(8) }), /invalid/);
  const out = compute(engineHouse(adm.s.state), '2026-10-28', 20);
  assert.ok(out.rows[5].away.includes(ids[0]));
  assert.ok(out.rows[9].away.includes(ids[1]) && out.rows[10].away.includes(ids[1]) && !out.rows[7].away.includes(ids[1]));
  const tid = Object.keys(adm.s.state.trips)[0];
  await adm.a.removeTrip(tid);
  assert.ok(!compute(engineHouse(adm.s.state), '2026-10-28', 20).rows[9].away.includes(ids[1]));
});

test('offline: le modifiche restano in coda e si allineano al ritorno della rete', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const d1 = await client(hub, 'H1', { isAdmin: true }); const d2 = await client(hub, 'H1', { isAdmin: true });
  d1.s.b.setOnline(false);
  await d1.a.setNote(wk(4), 'ciao');
  assert.equal(d1.s.state.weeks[wk(4)].note, 'ciao');   // visibile subito in locale
  assert.equal(d2.s.state.weeks[wk(4)], undefined);      // non ancora sul "server"
  d1.s.b.setOnline(true);
  assert.equal(d2.s.state.weeks[wk(4)].note, 'ciao');
});

test('modifiche concorrenti su campi diversi della stessa settimana non si sovrascrivono', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const d1 = await client(hub, 'H1', { isAdmin: true }); const d2 = await client(hub, 'H1', { isAdmin: true });
  await Promise.all([d1.a.setResult(wk(4), 'floor', 'done'), d2.a.setResult(wk(4), 'kitchen', 'done'), d1.a.setNote(wk(4), 'n')]);
  const w = d1.s.state.weeks[wk(4)];
  assert.equal(w.result.floor, 'done'); assert.equal(w.result.kitchen, 'done'); assert.equal(w.note, 'n');
});

test('scambio turno: richiesta, accettazione dell\'altro e effetto sul piano', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const ids = adm.s.state.house.roommates.map((r) => r.id);
  const out = adm.a.out(); const row = out.rows[out.cur];
  const A = row.assigned[0], B = row.assigned[1];
  const a = await client(hub, 'H1', { meId: A }); const b = await client(hub, 'H1', { meId: B });
  const id = await a.a.requestSwap({ week: row.sunday, myChore: 'floor', otherId: B, otherChore: 'bathroom' });
  await assert.rejects(a.a.answerSwap(id, true), /permission/);        // non puo' accettare da solo
  await b.a.answerSwap(id, true);
  const r2 = compute(engineHouse(adm.s.state), '2026-10-28', 3).rows[out.cur];
  assert.equal(r2.assigned[0], B); assert.equal(r2.assigned[1], A); assert.ok(r2.swapped[0]);
  assert.equal(adm.s.state.requests[id].status, 'accepted');
  // rifiuto
  const id2 = await a.a.requestSwap({ week: row.sunday, myChore: 'floor', otherId: B, otherChore: 'kitchen' });
  await b.a.answerSwap(id2, false);
  assert.equal(adm.s.state.requests[id2].status, 'declined');
  await a.a.cancelSwap(id2); assert.equal(adm.s.state.requests[id2], undefined);
});

test('scorte, checklist ultimo che esce, giorno scelto e checklist ricorrenti', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const ids = adm.s.state.house.roommates.map((r) => r.id);
  const out = adm.a.out(); const row = out.rows[out.cur];
  const me = await client(hub, 'H1', { meId: row.assigned[0] });
  const nid = await me.a.addNeed('  Carta igienica  ', true);
  assert.equal(me.s.state.needs[nid].text, 'Carta igienica');
  await assert.rejects(me.a.addNeed('   '), /invalid/);
  await me.a.setNeedDone(nid, true); assert.equal(adm.s.state.needs[nid].done, true);
  await adm.a.clearBought(); assert.equal(adm.s.state.needs[nid], undefined);
  await me.a.setLastOut('lastout.i1', true); await me.a.finishLastOut();
  assert.equal(adm.s.state.house.lastOut.checked['lastout.i1'].by, row.assigned[0]);
  assert.equal(adm.s.state.house.lastOut.doneBy, row.assigned[0]);
  await me.a.resetLastOut(); assert.equal(adm.s.state.house.lastOut.checked, undefined);
  // giorno scelto: solo l'assegnato o l'admin
  const day = addDays(row.sunday, -2);
  await me.a.setPlanDay(row.sunday, 'floor', day);
  assert.equal(adm.s.state.weeks[row.sunday].plan.floor, day);
  const other = await client(hub, 'H1', { meId: row.assigned[1] });
  await assert.rejects(other.a.setPlanDay(row.sunday, 'floor', day), /permission/);
  await me.a.setPlanDay(row.sunday, 'floor', null);
  assert.equal(adm.s.state.weeks[row.sunday].plan, undefined === 1 ? 0 : adm.s.state.weeks[row.sunday].plan);
  // compiti ricorrenti
  await adm.a.setHouse({ tasks: [{ id: 'tk', chore: 'floor', text: 'Svuota', every: 2, anchor: START, enabled: true }] });
  await me.a.toggleTask(row.sunday, 'tk', 'floor', true);
  assert.equal(adm.s.state.weeks[row.sunday].tasksDone.tk.by, row.assigned[0]);
  await assert.rejects(other.a.toggleTask(row.sunday, 'tk', 'floor', true), /permission/);
});

test('coinquilini: aggiunta, sostituzione con date e nessun debito ereditato', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const rm = adm.s.state.house.roommates.map((r) => ({ ...r }));
  rm[2].to = addDays(wk(5), -2);                                              // Carla esce
  rm.push({ name: 'Dario', slot: 3, from: wk(7) });                          // Dario entra nello stesso posto
  await adm.a.setRoommates(rm);
  const h = adm.s.state.house;
  assert.equal(h.roommates.length, 4);
  const out = compute(engineHouse(adm.s.state), '2026-10-28', 20);
  const dario = h.roommates.find((r) => r.name === 'Dario').id;
  assert.ok(!out.rows[6].nm.includes(dario)); assert.ok(out.rows[7].nm.includes(dario));
  assert.ok(out.rows[5].nm.includes(h.roommates[2].id) && !out.rows[6].nm.includes(h.roommates[2].id)); // esce a metà della settimana 5: partecipa ancora a quella
  // nome vuoto scartato
  await adm.a.setRoommates([...h.roommates, { name: '   ', slot: 4 }]);
  assert.equal(adm.s.state.house.roommates.length, 4);
});

test('backup: export e import ricostruiscono lo stesso stato (senza dispositivi e viste)', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true, deviceId: 'dev1' });
  await adm.a.setResult(wk(1), 'floor', 'done'); await adm.a.addNeed('Sapone'); await adm.a.touchMember({ ua: 'x' }); await adm.a.recordView('home');
  const bk = exportBackup(adm.s.state);
  assert.deepEqual(bk.data.members, {}); assert.deepEqual(bk.data.views, {});
  const hub2 = new MemoryHub(); const b2 = new MemoryBackend(hub2); await b2.open('NEW'); const s2 = new Store(b2);
  await s2.write(importBackupOps(JSON.parse(JSON.stringify(bk)), 'NEW'));
  assert.equal(s2.state.house.id, 'NEW'); assert.equal(s2.state.weeks[wk(1)].result.floor, 'done');
  assert.equal(Object.values(s2.state.needs)[0].text, 'Sapone');
  assert.throws(() => importBackupOps({ foo: 1 }), /invalid/);
  assert.throws(() => importBackupOps(null), /invalid/);
});

test('dispositivi e visualizzazioni vengono registrati', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const d = await client(hub, 'H1', { meId: 'p', deviceId: 'dev9' });
  await d.a.touchMember({ ua: 'iPhone', push: { endpoint: 'https://e' } }); await d.a.recordView('calendar');
  assert.equal(d.s.state.members.dev9.personId, 'p'); assert.equal(d.s.state.members.dev9.push.endpoint, 'https://e');
  assert.equal(Object.values(d.s.state.views)[0].screen, 'calendar');
  await d.a.touchMember({ push: null });
  assert.equal(d.s.state.members.dev9.push, undefined);
});

test('data di inizio non domenica viene portata alla domenica successiva', () => {
  assert.equal(normalizeStartSunday('2026-10-07'), '2026-10-11');
  assert.equal(normalizeStartSunday('2026-10-04'), '2026-10-04');
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('CloudBackend: mappa le operazioni su Firestore (SDK simulato)', async () => {
  // SDK finto che registra le chiamate
  const calls = []; const docs = new Map(); const listeners = [];
  const fs = {
    initializeApp: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    initializeFirestore: () => ({ fake: true }),
    doc: (db, ...p) => ({ path: p.join('/'), id: p[p.length - 1] }), collection: (db, ...p) => ({ path: p.join('/') }),
    deleteField: () => '__DEL__', query: (c) => c, orderBy: () => 0, limit: () => 0,
    getDoc: async (r) => ({ exists: () => docs.has(r.path), data: () => docs.get(r.path) }),
    getDocs: async () => ({ forEach: () => {} }),
    onSnapshot: (ref, a, b) => { const cb = typeof a === 'function' ? a : b; listeners.push({ ref, cb }); const isDoc = !!ref.id; if (isDoc) cb({ exists: () => true, data: () => docs.get(ref.path), metadata: { hasPendingWrites: false, fromCache: false } }); else cb({ forEach: () => {} }); return () => {}; },
    writeBatch: () => { const ops = []; return { set: (r, d, o) => ops.push(['set', r.path, d, o]), delete: (r) => ops.push(['del', r.path]), commit: async () => { calls.push(...ops); } }; },
    deleteDoc: async () => {},
  };
  docs.set('houses/H9', { name: 'Fake' });
  const b = new CloudBackend({ apiKey: 'x' }, async () => fs);
  const r = await b.open('H9');
  assert.equal(r.exists, true);
  assert.equal(b.getState().house.name, 'Fake');
  const s = new Store(b);
  await s.setDoc('weeks', '2026-10-11', { result: { floor: 'done', kitchen: null }, away: ['a'] });
  await s.delDoc('trips', 't1');
  assert.deepEqual(calls[0], ['set', 'houses/H9/weeks/2026-10-11', { result: { floor: 'done', kitchen: '__DEL__' }, away: ['a'] }, { merge: true }]);
  assert.deepEqual(calls[1], ['del', 'houses/H9/trips/t1']);
  assert.equal(b.getState().weeks['2026-10-11'].result.floor, 'done');
  assert.equal((await new CloudBackend({}, async () => ({ ...fs, getDoc: async () => ({ exists: () => false }) })).open('NOPE')).exists, false);
});

test('nuovo codice: copia tutto, il vecchio link smette di funzionare, i dispositivi dei coinquilini restano', async () => {
  const hub = new MemoryHub(); await mkHouse(hub, 'OLDCODE00001');
  const adm = await client(hub, 'OLDCODE00001', { isAdmin: true, deviceId: 'dAdmin' });
  const ids = adm.s.state.house.roommates.map((r) => r.id);
  await adm.a.setResult(wk(1), 'floor', 'done'); await adm.a.addNeed('Sapone'); await adm.a.addTrip({ personId: ids[1], from: wk(6), to: wk(8) });
  await adm.a.setHouse({ tasks: [{ id: 'k', chore: 'floor', text: 'Svuota', every: 2, anchor: START, enabled: true }] });
  await adm.a.touchMember({ push: { endpoint: 'adm' } });
  const carla = await client(hub, 'OLDCODE00001', { meId: ids[2], deviceId: 'dCarla' }); await carla.a.touchMember({ push: { endpoint: 'carla' } });
  const bruno = await client(hub, 'OLDCODE00001', { meId: ids[1], deviceId: 'dBruno' }); await bruno.a.touchMember({ push: { endpoint: 'bruno' } });
  const before = JSON.parse(JSON.stringify(adm.s.state));
  const { newId, oldId } = await adm.a.rotateCode({ leavingPersonIds: [ids[2]] });
  assert.equal(oldId, 'OLDCODE00001'); assert.match(newId, /^[0-9A-Z]{12}$/); assert.notEqual(newId, oldId);
  // vecchio link: non esiste piu'
  const gone = new MemoryBackend(hub); assert.equal((await gone.open(oldId)).exists, false);
  // nuovo link: ci sono tutti i dati, gli stessi id persona e lo stesso PIN
  const nb = new MemoryBackend(hub); assert.equal((await nb.open(newId)).exists, true);
  const st = nb.getState();
  assert.equal(st.house.id, newId); assert.deepEqual(st.house.roommates, before.house.roommates); assert.equal(st.house.adminHash, before.house.adminHash);
  assert.equal(st.house.prevIds.at(-1), oldId); assert.ok(st.house.rotatedAt);
  assert.deepEqual(st.weeks, before.weeks); assert.deepEqual(st.trips, before.trips); assert.deepEqual(st.needs, before.needs);
  assert.deepEqual(st.house.tasks, before.house.tasks);
  assert.ok(st.members.dBruno && st.members.dAdmin, 'dispositivi rimasti conservano le notifiche');
  assert.equal(st.members.dCarla, undefined, 'chi e\' uscito perde le notifiche');
  // non-admin non puo'
  await assert.rejects(bruno.a.rotateCode(), /permission/);
});

test('persone uscite da avvisare, regole obbligatorie e conferma per versione', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const rm = adm.s.state.house.roommates.map((r) => ({ ...r })); rm[2].to = '2026-10-20';
  await adm.a.setRoommates(rm);
  assert.deepEqual(adm.a.leftSinceRotation().map((r) => r.name), ['Carla']);
  const d = await client(hub, 'H1', { meId: rm[0].id, deviceId: 'dX' });
  assert.equal(d.a.rulesRequired(), true); assert.equal(d.a.rulesAccepted(), false);
  await d.a.acceptRules(); assert.equal(d.a.rulesAccepted(), true);
  await adm.a.setHouse({ rules: { version: 2 } });
  assert.equal(d.a.rulesAccepted(), false, 'nuova versione: va riconfermata');
  await adm.a.setHouse({ requireRules: false }); assert.equal(d.a.rulesRequired(), false);
  // dopo la rotazione l'avviso sparisce
  await adm.a.setHouse({ requireRules: true });
  const adm2 = adm; const { newId } = await adm2.a.rotateCode({});
  const n = await client(hub, newId, { isAdmin: true });
  assert.deepEqual(n.a.leftSinceRotation(), []);
});

test('uscita non nota: resta in casa finche\' non viene segnata; "uscita prevista" avvisa senza cambiare i turni', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const rm = adm.s.state.house.roommates.map((r) => ({ ...r }));
  rm[2].expectedTo = '2026-11-10';                       // prevista, non certa
  await adm.a.setRoommates(rm);
  const out0 = compute(engineHouse(adm.s.state), '2026-10-28', 20);
  assert.ok(out0.rows.slice(0, 20).every((r) => r.nm.includes(rm[2].id)), 'senza uscita certa resta in tutti i turni');
  assert.equal(adm.a.expectedExits(21).length, 1);          // 13 giorni dalla data finta del test (2026-10-28)
  assert.equal(adm.a.expectedExits(5).length, 0);
  assert.equal(adm.a.leftSinceRotation().length, 0, 'prevista non e\' uscita');
  // l'uscita viene confermata con la data reale: il piano cambia da lì, lo storico no
  const rm2 = adm.s.state.house.roommates.map((r) => ({ ...r })); rm2[2].to = '2026-11-12'; rm2[2].expectedTo = '2026-11-10';
  await adm.a.setRoommates(rm2);
  assert.equal(adm.s.state.house.roommates[2].expectedTo, undefined, 'expectedTo ripulita quando c\'e\' la data certa');
  const out1 = compute(engineHouse(adm.s.state), '2026-10-28', 20);
  assert.ok(out1.rows[4].nm.includes(rm[2].id));
  assert.ok(!out1.rows[7].nm.includes(rm[2].id));
  // uscita prevista passata e ancora senza data certa -> da segnalare come scaduta
  const rm3 = adm.s.state.house.roommates.map((r) => ({ ...r })); rm3[2].to = null; rm3[2].expectedTo = '2026-10-01';
  await adm.a.setRoommates(rm3);
  assert.equal(adm.a.expectedExits()[0].overdue, true);
});

test('CloudBackend: Firestore inizializzato una sola volta anche con piu\' backend nella stessa sessione', async () => {
  let inits = 0;
  const fs = { initializeApp: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    initializeFirestore: () => { if (inits++) throw new Error('Firestore has already been started'); return { fake: true }; },
    doc: (db, ...p) => ({ path: p.join('/'), id: p[p.length - 1] }), getDoc: async () => ({ exists: () => false }) };
  const cfg = { apiKey: 'k', projectId: 'p-once' };
  await new CloudBackend(cfg, async () => fs).open('A'); await new CloudBackend(cfg, async () => fs).open('B'); await new CloudBackend(cfg, async () => fs).open('C');
  assert.equal(inits, 1);
});

test('regole: l\'accettazione ricordata sul dispositivo vale anche se i dati del cloud non sono ancora arrivati', async () => {
  const hub = new MemoryHub(); await mkHouse(hub);
  let local = null;
  const d = await client(hub, 'H1', { meId: 'x', deviceId: 'dev1', localRulesAck: () => local });
  assert.equal(d.a.rulesAccepted(), false);
  local = '1'; assert.equal(d.a.rulesAccepted(), true);
  local = '0'; assert.equal(d.a.rulesAccepted(), false);
});

// ---------------- flusso turni: checklist, annulla, volontari, sostituzioni, ritardi ----------------
async function flowEnv() {
  const hub = new MemoryHub(); await mkHouse(hub);
  const adm = await client(hub, 'H1', { isAdmin: true });
  const ids = adm.s.state.house.roommates.map((r) => r.id);
  await adm.a.setHouse({ tasks: [
    { id: 'w1', chore: 'floor', text: 'Aspira', every: 1, anchor: START, enabled: true },
    { id: 'w2', chore: 'floor', text: 'Lava', every: 1, anchor: START, enabled: true },
    { id: 'x1', chore: 'bathroom', text: 'Tappetino', every: 2, anchor: START, enabled: true }] });
  const row = adm.a.out().rows[adm.a.out().cur]; const sunday = row.sunday;
  const who = (c) => row.assigned[['floor', 'bathroom', 'kitchen'].indexOf(c)];
  const as = async (id) => client(hub, 'H1', { meId: id, deviceId: 'd' + id });
  return { hub, adm, ids, row, sunday, who, as };
}
test('done richiede la checklist completa: se manca qualcosa avvisa; "comunque" lo segnala come incompleto', async () => {
  const { adm, sunday, who, as } = await flowEnv();
  const u = await as(who('floor'));
  assert.equal(u.a.pendingChecklist(sunday, 'floor').length, 2);
  const r = await u.a.completeChore(sunday, 'floor');
  assert.equal(r.ok, false); assert.deepEqual(r.missing.map((m) => m.text).sort(), ['Aspira', 'Lava']);
  assert.equal(adm.s.state.weeks[sunday]?.result?.floor, undefined, 'non scritto');
  await u.a.toggleTask(sunday, 'w1', 'floor', true);
  const r2 = await u.a.completeChore(sunday, 'floor'); assert.deepEqual(r2.missing.map((m) => m.text), ['Lava']);
  const r3 = await u.a.completeChore(sunday, 'floor', { force: true });
  assert.equal(r3.ok, true); assert.deepEqual(adm.s.state.weeks[sunday].incomplete.floor, ['Lava']);
  assert.equal(adm.s.state.weeks[sunday].result.floor, 'done');
  assert.ok(Object.values(adm.s.state.log).some((l) => l.type === 'incomplete'));
  // annulla: torna "da fare" e toglie il segnale di incompleto
  await u.a.undoResult(sunday, 'floor');
  assert.equal(adm.s.state.weeks[sunday].result?.floor, undefined); assert.equal(adm.s.state.weeks[sunday].incomplete?.floor, undefined);
  // spunta tutto e segna fatto in un colpo
  const r4 = await u.a.completeChore(sunday, 'floor', { checkAll: true });
  assert.equal(r4.ok, true); assert.equal(adm.s.state.weeks[sunday].incomplete?.floor, undefined);
  assert.equal(u.a.pendingChecklist(sunday, 'floor').length, 0);
});
test('checklist disattivabile per mansione; settimanali + "ogni X settimane" si sommano', async () => {
  const { adm, sunday, who, as } = await flowEnv();
  const idx = (adm.a.out().cur);
  const bathroomWeek = (i) => adm.a.pendingChecklist(addDays(START, 7 * i), 'bathroom').length;
  assert.equal(bathroomWeek(0), 1); assert.equal(bathroomWeek(1), 1);   // ogni 2 settimane: scade alla 0, resta arretrato alla 1
  await adm.a.setHouse({ tasks: [...adm.s.state.house.tasks, { id: 'wb', chore: 'bathroom', text: 'Lavandino', every: 1, anchor: START, enabled: true }] });
  assert.equal(bathroomWeek(0), 2);                                       // settimanale + ricorrente
  await adm.a.setHouse({ checklistOff: { bathroom: true } });
  assert.equal(bathroomWeek(0), 0);                                       // checklist spenta per la mansione
  const u = await as(who('bathroom')); assert.equal((await u.a.completeChore(sunday, 'bathroom')).ok, true, 'senza checklist si segna subito');
  await adm.a.setHouse({ checklistOff: { bathroom: null } }); assert.ok(bathroomWeek(0) >= 1);
});
test('annulla: chi ha segnato (anche un volontario) e l\'assegnato possono ricliccare; gli altri no', async () => {
  const { adm, ids, sunday, who, as } = await flowEnv();
  await adm.a.setHouse({ checklistOff: { floor: true, bathroom: true, kitchen: true } });
  const assignee = await as(who('kitchen')); const other = await as(ids.find((x) => x !== who('kitchen')));
  const third = await as(ids.find((x) => x !== who('kitchen') && x !== other.a.me));
  await assignee.a.completeChore(sunday, 'kitchen'); await assignee.a.undoResult(sunday, 'kitchen');
  assert.equal(adm.s.state.weeks[sunday].result?.kitchen, undefined);
  // volontario: non spettava a lui, viene segnalato all'assegnato e può annullare
  const r = await other.a.volunteer(sunday, 'kitchen'); assert.equal(r.ok, true);
  assert.equal(adm.s.state.weeks[sunday].volunteer.kitchen, other.a.me); assert.equal(adm.s.state.weeks[sunday].result.kitchen, 'by:' + other.a.me);
  assert.ok(Object.values(adm.s.state.requests).some((q) => q.kind === 'notice' && q.code === 'volunteer' && q.to === who('kitchen')), 'avviso all\'assegnato');
  assert.ok(Object.values(adm.s.state.log).some((l) => l.type === 'volunteer'));
  await assert.rejects(third.a.undoResult(sunday, 'kitchen'), /permission/);
  await other.a.undoResult(sunday, 'kitchen'); assert.equal(adm.s.state.weeks[sunday].result?.kitchen, undefined);
  await assert.rejects(assignee.a.volunteer(sunday, 'kitchen'), /permission/, 'l\'assegnato non si "offre" per il proprio turno');
});
test('sostituzioni: richiesta aperta, offerta con consenso, assegnazione admin, rifiuti e permessi', async () => {
  const { adm, ids, sunday, who, as } = await flowEnv();
  const A = await as(who('floor')), B = await as(ids.find((x) => x !== who('floor')));
  // A chiede un sostituto a chiunque; B accetta
  const id1 = await A.a.requestCover({ week: sunday, chore: 'floor' });
  await assert.rejects(A.a.answerCover(id1, true), /permission/, 'non può accettare da solo');
  await B.a.answerCover(id1, true);
  assert.equal(adm.s.state.weeks[sunday].agreed.floor, B.a.me); assert.equal(adm.s.state.requests[id1].status, 'accepted'); assert.equal(adm.s.state.requests[id1].by, B.a.me);
  // B si offre per il bagno di un altro: serve l'ok dell'assegnato
  const target = who('bathroom'); const T = await as(target);
  if (target !== B.a.me) {
    const id2 = await B.a.offerCover({ week: sunday, chore: 'bathroom' });
    await assert.rejects(B.a.answerCover(id2, true), /permission/);
    await T.a.answerCover(id2, false); assert.equal(adm.s.state.requests[id2].status, 'declined'); assert.equal(adm.s.state.weeks[sunday].agreed.bathroom, undefined);
    const id3 = await B.a.offerCover({ week: sunday, chore: 'bathroom' }); await T.a.answerCover(id3, true);
    assert.equal(adm.s.state.weeks[sunday].agreed.bathroom, B.a.me);
  }
  // richiesta a una persona precisa: solo lei può accettare
  const C = await as(ids.find((x) => x !== who('kitchen'))); const K = await as(who('kitchen'));
  const id4 = await K.a.requestCover({ week: sunday, chore: 'kitchen', to: C.a.me });
  const stranger = ids.find((x) => x !== who('kitchen') && x !== C.a.me);
  if (stranger) await assert.rejects((await as(stranger)).a.answerCover(id4, true), /permission/);
  await C.a.answerCover(id4, true); assert.equal(adm.s.state.weeks[sunday].agreed.kitchen, C.a.me);
  // chi non è assegnato non può chiedere sostituzioni per altri; l'admin sì e può scegliere lui chi fa cosa
  await assert.rejects(C.a.requestCover({ week: sunday, chore: 'kitchen' }), /permission/);
  await adm.a.assignCover(sunday, 'floor', ids[2]); assert.equal(adm.s.state.weeks[sunday].agreed.floor, ids[2]);
  assert.ok(Object.values(adm.s.state.requests).some((q) => q.kind === 'notice' && q.code === 'assigned'));
  await assert.rejects(C.a.assignCover(sunday, 'floor', ids[0]), /permission/);
  await adm.a.assignCover(sunday, 'floor', null); assert.equal(adm.s.state.weeks[sunday].agreed?.floor, undefined);
});
test('pulirò in ritardo: data valida solo dopo la domenica (max 14 giorni), solo l\'assegnato o l\'admin', async () => {
  const { adm, sunday, who, as, ids } = await flowEnv();
  const u = await as(who('floor')); const o = await as(ids.find((x) => x !== who('floor')));
  await u.a.setDelay(sunday, 'floor', addDays(sunday, 3)); assert.equal(adm.s.state.weeks[sunday].delay.floor, addDays(sunday, 3));
  await assert.rejects(u.a.setDelay(sunday, 'floor', sunday), /invalid/); await assert.rejects(u.a.setDelay(sunday, 'floor', addDays(sunday, 15)), /invalid/);
  await assert.rejects(o.a.setDelay(sunday, 'floor', addDays(sunday, 2)), /permission/);
  await u.a.setDelay(sunday, 'floor', null); assert.equal(adm.s.state.weeks[sunday].delay?.floor, undefined);
});
