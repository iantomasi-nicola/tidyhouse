import test from 'node:test';
import assert from 'node:assert/strict';
import { runNotify } from '../scripts/notify-core.mjs';
import { encryptBackup, decryptBackup } from '../js/backupcrypto.js';
import { addDays } from '../js/engine.js';

const START = '2026-10-04';
const wk = (i) => addDays(START, 7 * i);
const rm = ['A', 'B', 'C'].map((n, i) => ({ id: n, name: n, slot: i + 1, from: null, to: null }));

function fakeDb(extra = {}) {
  const houses = { H1: { house: { id: 'H1', name: 'C', startSunday: START, roommates: rm, tz: 'Europe/Rome', lang: 'it', vapidPublic: 'PUB', ...(extra.house || {}) },
    weeks: extra.weeks || {}, trips: {}, members: extra.members || {}, sent: extra.sent || {}, requests: extra.requests || {}, needs: extra.needs || {}, views: extra.views || {} } };
  const calls = [];
  return {
    houses, calls,
    async listHouses() { return Object.entries(houses).map(([id, h]) => ({ id, house: h.house })); },
    async coll(hid, c) { return houses[hid][c] || {}; },
    async setDoc(hid, c, id, data) { calls.push(['set', c, id, data]); houses[hid][c] = houses[hid][c] || {}; houses[hid][c][id] = { ...(houses[hid][c][id] || {}), ...data }; if (data.push === null) delete houses[hid][c][id].push; },
    async delDoc(hid, c, id) { calls.push(['del', c, id]); delete houses[hid][c][id]; },
    async setHouse(hid, patch) { Object.assign(houses[hid].house, patch); },
  };
}
const members = () => ({ dA: { personId: 'A', push: { endpoint: 'eA' }, lang: 'it' }, dB: { personId: 'B', push: { endpoint: 'eB' }, lang: 'en' }, dC: { personId: 'C', push: { endpoint: 'eC' } } });

test('server notifiche: sabato invia a chi ha un turno, nella lingua del dispositivo, senza duplicati', async () => {
  const db = fakeDb({ members: members() });
  const sent = [];
  const send = async (sub, payload) => { sent.push({ ep: sub.endpoint, ...payload }); };
  const now = new Date('2026-10-31T09:15:00Z');
  let r = await runNotify({ db, send, now, vapidPublic: 'PUB' });
  assert.equal(r.sent, 3); assert.equal(sent.length, 3);
  assert.match(sent.find((x) => x.ep === 'eB').title, /due tomorrow/);       // inglese
  assert.match(sent.find((x) => x.ep === 'eA').title, /Domani scade/);       // italiano
  assert.ok(db.houses.H1.house.serverRun);
  // seconda esecuzione nella stessa ora: niente duplicati
  sent.length = 0; r = await runNotify({ db, send, now: new Date('2026-10-31T09:45:00Z'), vapidPublic: 'PUB' });
  assert.equal(r.sent, 0); assert.equal(sent.length, 0);
});

test('server notifiche: sottoscrizioni scadute (410) vengono rimosse e l\'invio non viene segnato come fatto', async () => {
  const db = fakeDb({ members: { dA: { personId: 'A', push: { endpoint: 'gone' } } } });
  const send = async () => { const e = new Error('gone'); e.statusCode = 410; throw e; };
  const r = await runNotify({ db, send, now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'PUB' });
  assert.equal(r.removed >= 1, true);
  assert.equal(db.houses.H1.members.dA.push, undefined);
  assert.equal(Object.keys(db.houses.H1.sent).length, 0);
});

test('server notifiche: errore temporaneo non marca come inviato (riprova alla prossima ora)', async () => {
  const db = fakeDb({ members: members() });
  const send = async () => { const e = new Error('boom'); e.statusCode = 500; throw e; };
  const r = await runNotify({ db, send, now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'PUB' });
  assert.equal(r.sent, 0); assert.equal(Object.keys(db.houses.H1.sent).length, 0);
  const ok = []; const r2 = await runNotify({ db, send: async (s) => ok.push(s), now: new Date('2026-10-31T10:15:00Z'), vapidPublic: 'PUB' });
  assert.equal(ok.length, 3); assert.equal(r2.sent, 3);
});

test('server notifiche: preferenze del dispositivo e persone senza push', async () => {
  const m = members(); m.dA.prefs = { satDuty: false }; delete m.dC.push;
  const db = fakeDb({ members: m });
  const got = []; await runNotify({ db, send: async (s) => got.push(s.endpoint), now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'PUB' });
  assert.deepEqual(got, ['eB']);
});

test('server notifiche: chiave VAPID diversa => casa saltata; casa rotta non blocca le altre', async () => {
  const db = fakeDb({ members: members() });
  const r = await runNotify({ db, send: async () => {}, now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'ALTRA' });
  assert.equal(r.sent, 0); assert.match(r.skipped[0], /vapid/);
  db.houses.H2 = { house: { id: 'H2' } };
  const r2 = await runNotify({ db, send: async () => {}, now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'PUB' });
  assert.ok(r2.skipped.some((s) => s.startsWith('H2')));
  assert.equal(r2.sent, 3);
});

test('server notifiche: scambi, solleciti, scorte', async () => {
  const db = fakeDb({
    members: members(), house: { notif: { needs: { on: true } } },
    requests: { r1: { to: 'A', from: 'B', status: 'pending', week: wk(4) }, n1: { kind: 'nudge', to: 'C', from: 'admin', text: 'segna!', status: 'pending' }, r2: { to: 'A', from: 'B', status: 'accepted', notified: true } },
    needs: { x1: { text: 'Sapone', by: 'A', at: '2026-10-31T08:00:00Z', done: false } },
  });
  const got = []; await runNotify({ db, send: async (s, p) => got.push([s.endpoint, p.title, p.body]), now: new Date('2026-10-30T10:00:00Z'), vapidPublic: 'PUB' });
  const byEp = (e) => got.filter((g) => g[0] === e).map((g) => g[1] + '|' + g[2]);
  assert.ok(byEp('eA').some((s) => /Richiesta di scambio/.test(s)), 'A riceve la richiesta di B');
  assert.ok(byEp('eC').some((s) => /segna!/.test(s)));
  assert.ok(byEp('eB').some((s) => /Sapone/.test(s)) && byEp('eC').some((s) => /Sapone/.test(s)) && !byEp('eA').some((s) => /Sapone/.test(s)), 'scorte: a chi non le ha aggiunte');
  assert.equal(db.houses.H1.requests.r1.notified, true); assert.equal(db.houses.H1.requests.n1.notified, true);
  // non rimanda
  got.length = 0; await runNotify({ db, send: async (s) => got.push(s), now: new Date('2026-10-30T11:00:00Z'), vapidPublic: 'PUB' });
  assert.equal(got.length, 0);
});

test('server notifiche: pulizia delle voci vecchie', async () => {
  const db = fakeDb({ members: {}, sent: { old: { at: '2026-01-01T00:00:00Z' }, fresh: { at: '2026-10-30T00:00:00Z' } }, views: { v1: { at: '2026-01-01T00:00:00Z' }, v2: { at: '2026-10-29T00:00:00Z' } } });
  await runNotify({ db, send: async () => {}, now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'PUB' });
  assert.equal(db.houses.H1.sent.old, undefined); assert.ok(db.houses.H1.sent.fresh);
  assert.equal(db.houses.H1.views.v1, undefined); assert.ok(db.houses.H1.views.v2);
});

test('backup cifrato: round-trip, passphrase errata, dati illeggibili', async () => {
  const env = await encryptBackup({ a: 1, nome: 'Casa è bella' }, 'frase segreta');
  assert.ok(!JSON.stringify(env).includes('bella'));
  assert.deepEqual(await decryptBackup(env, 'frase segreta'), { a: 1, nome: 'Casa è bella' });
  await assert.rejects(decryptBackup(env, 'sbagliata'), /wrong-passphrase/);
  await assert.rejects(decryptBackup({ foo: 1 }, 'x'), /invalid/);
  assert.notEqual((await encryptBackup({ a: 1 }, 'x')).ct, (await encryptBackup({ a: 1 }, 'x')).ct, 'IV/sale casuali');
});

test('server notifiche: sostituzioni, offerte, avvisi, spesa aggiunta e spesa comprata', async () => {
  const db = fakeDb({ members: members(),
    requests: { c1: { kind: 'cover', week: wk(4), chore: 'floor', from: 'A', to: null, status: 'pending' }, o1: { kind: 'offer', week: wk(4), chore: 'bathroom', from: 'B', to: 'C', status: 'pending' },
      n1: { kind: 'notice', code: 'volunteer', to: 'A', from: 'B', week: wk(4), chore: 'kitchen', status: 'info' }, c2: { kind: 'cover', week: wk(4), chore: 'floor', from: 'A', to: null, status: 'accepted', by: 'B', notified: true, notifiedAnswer: false } },
    needs: { x1: { text: 'Sapone', by: 'A', at: '2026-10-30T08:00:00Z', done: false }, x2: { text: 'Pasta', by: 'A', at: '2026-10-30T07:00:00Z', done: true, doneBy: 'B', doneAt: '2026-10-30T09:00:00Z' } } });
  const got = []; await runNotify({ db, send: async (s, p) => got.push([s.endpoint, p.title, p.body]), now: new Date('2026-10-30T10:00:00Z'), vapidPublic: 'PUB' });
  const to = (e) => got.filter((g) => g[0] === e).map((g) => g[1] + '|' + g[2]).join(' ;; ');
  assert.match(to('eB'), /Looking for a substitute/); assert.match(to('eC'), /Cerca sostituto/); assert.doesNotMatch(to('eA'), /Cerca sostituto/, 'chi chiede non riceve');
  assert.match(to('eC'), /Si offrono di aiutarti/);    // offerta B -> C (assegnato)
  assert.match(to('eA'), /ha pulito Cucina al posto tuo/); assert.match(to('eA'), /farà Pavimenti/, 'A sa che B accetta');
  // spesa: voce nuova a chi non l'ha aggiunta; «comprato» solo a chi aveva aggiunto la voce
  assert.match(to('eB'), /Sapone/); assert.match(to('eC'), /Sapone/); assert.doesNotMatch(to('eA'), /Sapone/, 'chi aggiunge non riceve');
  assert.match(to('eA'), /B ha comprato: Pasta/); assert.doesNotMatch(to('eB'), /Pasta/, 'chi ha comprato non riceve'); assert.doesNotMatch(to('eC'), /Pasta/, 'gli altri non servono');
  // più notifiche nella stessa esecuzione = UN solo avviso per dispositivo
  assert.equal(got.filter((g) => g[0] === 'eC').length, 1); assert.match(got.find((g) => g[0] === 'eC')[1], /3 novità in casa/);
  assert.ok(db.houses.H1.sent['bought:x2']); assert.ok(db.houses.H1.sent['need:x1:B'] && db.houses.H1.sent['need:x1:C'] && !db.houses.H1.sent['need:x1:A']); assert.equal(db.houses.H1.requests.n1.notified, true);
  const n = got.length; await runNotify({ db, send: async (s, p) => got.push(p), now: new Date('2026-10-30T11:00:00Z'), vapidPublic: 'PUB' });
  assert.equal(got.length, n, 'nessun duplicato');
});

test('server notifiche: prova dal server arriva solo al dispositivo che l\'ha chiesta, una volta', async () => {
  const m = members(); m.dA2 = { personId: 'A', push: { endpoint: 'eA2' }, lang: 'it' };
  const db = fakeDb({ members: m, requests: { t1: { kind: 'test', to: 'A', device: 'dA2', status: 'info' } } });
  const got = []; await runNotify({ db, send: async (s, p) => got.push([s.endpoint, p.title]), now: new Date('2026-10-30T10:00:00Z'), vapidPublic: 'PUB' });
  assert.deepEqual(got.filter((g) => /prova/i.test(g[1])), [['eA2', 'Notifica di prova']]);
  assert.equal(db.houses.H1.requests.t1.notified, true);
  const n = got.length; await runNotify({ db, send: async (s, p) => got.push([s.endpoint, p.title]), now: new Date('2026-10-30T11:00:00Z'), vapidPublic: 'PUB' });
  assert.equal(got.filter((g) => /prova/i.test(g[1])).length, 1, 'nessun duplicato');
});

test('server notifiche: prova a tutti (una richiesta per persona), chiusa dopo il tentativo, prove vecchie ignorate', async () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const at = (h) => new Date(now - h * 3600000).toISOString();
  const db = fakeDb({
    members: { ...members(), dA2: { personId: 'A', push: { endpoint: 'eA2' } }, dX: { personId: 'B' } },
    requests: { t1: { kind: 'test', to: 'A', status: 'info', at: at(1) }, t2: { kind: 'test', to: 'B', status: 'info', at: at(1) }, t3: { kind: 'test', to: 'C', status: 'info', at: at(30) }, t4: { kind: 'test', to: 'ZZ', status: 'info', at: at(1) } },
  });
  const got = []; const send = async (s, p) => got.push([s.endpoint, p.title + ' ' + p.body]);
  const r = await runNotify({ db, send, now, vapidPublic: 'PUB' });
  const eps = got.filter((g) => /Funziona|Works|prova|test/i.test(g[1])).map((g) => g[0]).sort();
  assert.deepEqual(eps, ['eA', 'eA2', 'eB'], 'A su entrambi i dispositivi, B su quello con push; C (prova vecchia) e ZZ (nessun dispositivo) no');
  for (const id of ['t1', 't2', 't3', 't4']) assert.equal(db.houses.H1.requests[id].notified, true, id + ' chiusa');
  const again = []; await runNotify({ db, send: async (s, p) => again.push(p.title), now: new Date(now.getTime() + 3600000), vapidPublic: 'PUB' });
  assert.ok(!again.some((x) => /prova|test/i.test(x)), 'nessuna ripetizione');
});

test('server notifiche: spesa raggruppata in un solo avviso e niente a chi è assente', async () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const db = fakeDb({
    members: members(),
    trips: {},
    needs: { a: { text: 'Latte', by: 'A', at: '2026-10-28T08:00:00Z', done: false }, b: { text: 'Pane', by: 'A', at: '2026-10-28T08:05:00Z', done: false }, c: { text: 'Uova', by: 'A', at: '2026-10-28T08:10:00Z', done: false } },
  });
  db.houses.H1.trips = { t1: { personId: 'C', from: '2026-10-26', to: '2026-10-31' } };   // C è via
  const got = []; await runNotify({ db, send: async (s, p) => got.push([s.endpoint, p.title, p.body]), now, vapidPublic: 'PUB' });
  const spesa = got.filter((g) => /Latte/.test(g[2]));
  assert.deepEqual(spesa.map((g) => g[0]), ['eB'], 'solo B: A ha aggiunto, C è assente');
  assert.match(spesa[0][2], /3 voci|3 items/); assert.match(spesa[0][2], /Latte.*Pane.*Uova/);
  const again = []; await runNotify({ db, send: async (s, p) => again.push(p), now: new Date(now.getTime() + 3600000), vapidPublic: 'PUB' });
  assert.ok(!again.some((p) => /Latte/.test(p.body)), 'nessuna ripetizione');
});

test('server notifiche: un solo turno da segnare => azione «Segna fatto» con il link giusto', async () => {
  const db = fakeDb({ members: { dB: { personId: 'B', push: { endpoint: 'eB' }, lang: 'it' } }, weeks: { [wk(4)]: { result: { floor: 'done' } } } });
  const got = []; await runNotify({ db, send: async (s, p) => got.push(p), now: new Date('2026-10-31T09:15:00Z'), vapidPublic: 'PUB' });   // sabato
  const p = got.find((x) => x.actions && x.actions.length);
  assert.ok(p, 'almeno una notifica con azione'); assert.equal(p.actions[0].action, 'done'); assert.match(p.actions[0].url, /^#\/do\/done\/\d{4}-\d\d-\d\d\/(floor|bathroom|kitchen)$/); assert.match(p.actions[0].title, /Segna fatto/);
});
