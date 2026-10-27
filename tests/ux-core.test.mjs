// Nucleo (UX-C): richieste «in attesa di me» (badge del nav) e scadenza delle richieste su settimane vecchie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryBackend, Store } from '../js/store.js';
import { Actions, buildHouse } from '../js/actions.js';
import { requestsAwaiting, staleRequestIds } from '../js/extras.js';
import { inkOn } from '../js/ui.js';

const REQ = (o) => ({ status: 'pending', at: '2026-10-01T10:00:00.000Z', ...o });

test('requestsAwaiting: stessa regola dell\'hub (cover a me o a tutti, offerte e scambi verso di me)', () => {
  const requests = {
    c1: REQ({ kind: 'cover', from: 'anna', to: null, week: '2026-11-01' }),       // aperta a tutti
    c2: REQ({ kind: 'cover', from: 'bruno', to: null, week: '2026-11-01' }),      // mia
    c3: REQ({ kind: 'cover', from: 'anna', to: 'carla', week: '2026-11-01' }),    // per un\'altra
    c4: REQ({ kind: 'cover', from: 'anna', to: 'bruno', week: '2026-11-01' }),    // per me
    o1: REQ({ kind: 'offer', from: 'carla', to: 'bruno', week: '2026-11-01' }),
    o2: REQ({ kind: 'offer', from: 'bruno', to: 'carla', week: '2026-11-01' }),
    s1: REQ({ from: 'anna', to: 'bruno', week: '2026-11-01' }),                   // scambio senza kind
    n1: { kind: 'notice', to: 'bruno', status: 'info' },
    n2: REQ({ kind: 'nudge', to: 'bruno' }),
    a1: REQ({ kind: 'cover', from: 'anna', to: null, status: 'accepted' }),
    x1: REQ({ kind: 'cover', from: 'anna', to: null, status: 'expired' }),
  };
  const ids = requestsAwaiting({ requests }, 'bruno').map((r) => r.id).sort();
  assert.deepEqual(ids, ['c1', 'c4', 'o1', 's1']);
  assert.deepEqual(requestsAwaiting({ requests }, null), []);
  assert.deepEqual(requestsAwaiting({}, 'bruno'), []);
});

test('staleRequestIds: solo pending cover/offer/scambio su settimane chiuse da più di 7 giorni', () => {
  const requests = {
    a: REQ({ kind: 'cover', week: '2026-10-04' }), b: REQ({ kind: 'offer', week: '2026-10-18' }), c: REQ({ week: '2026-10-11', to: 'bruno' }),
    edge: REQ({ kind: 'cover', week: '2026-10-21' }),      // esattamente 7 giorni: resta
    near: REQ({ kind: 'cover', week: '2026-10-25' }), cur: REQ({ kind: 'cover', week: '2026-11-01' }),
    acc: REQ({ kind: 'cover', week: '2026-10-04', status: 'accepted' }), note: { kind: 'notice', week: '2026-10-04', status: 'info' }, nudge: REQ({ kind: 'nudge', week: '2026-10-04' }),
    noweek: REQ({ kind: 'cover' }), bad: REQ({ kind: 'cover', week: 'oggi' }),
  };
  assert.deepEqual(staleRequestIds(requests, '2026-10-28').sort(), ['a', 'b', 'c']);
  assert.deepEqual(staleRequestIds(requests, '2026-10-28', 20), ['a']);
  assert.deepEqual(staleRequestIds({}, '2026-10-28'), []);
});

test('Actions.expireStaleRequests: segna expired in una sola scrittura, è idempotente e non tocca il resto', async () => {
  const hub = new MemoryHub();
  const house = await buildHouse({ id: 'H1', name: 'Casa', startSunday: '2026-10-04', roommates: ['Anna', 'Bruno', 'Carla'].map((n) => ({ name: n })), adminPersonId: 'Anna', pin: '1234' });
  const b = new MemoryBackend(hub); await b.open('H1'); const s = new Store(b);
  await s.setHouse(house, true);
  await s.setDoc('requests', 'old', REQ({ kind: 'cover', week: '2026-10-04', from: 'anna', to: null }));
  await s.setDoc('requests', 'new', REQ({ kind: 'cover', week: '2026-11-01', from: 'anna', to: null }));
  await s.setDoc('requests', 'acc', REQ({ kind: 'cover', week: '2026-10-04', from: 'anna', to: null, status: 'accepted' }));
  const a = new Actions(s, { now: () => new Date('2026-10-28T10:00:00'), meId: 'bruno', isAdmin: false });
  let writes = 0; const w = b.write.bind(b); b.write = (ops) => { writes++; return w(ops); };
  assert.deepEqual(await a.expireStaleRequests(), ['old']);
  assert.equal(writes, 1);
  assert.equal(s.state.requests.old.status, 'expired');
  assert.ok(s.state.requests.old.expiredAt.startsWith('2026-10-28'));
  assert.equal(s.state.requests.new.status, 'pending'); assert.equal(s.state.requests.acc.status, 'accepted');
  assert.deepEqual(await a.expireStaleRequests(), []);
  assert.equal(writes, 1, 'nessuna seconda scrittura');
  // una richiesta scaduta non si può più accettare
  await assert.rejects(() => a.answerCover('old', true));
});

test('inkOn: testo bianco o scuro col contrasto migliore', () => {
  assert.equal(inkOn('#1a73e8'), '#fff');
  assert.equal(inkOn('#000000'), '#fff');
  assert.equal(inkOn('#ffffff'), '#1c1c1e');
  assert.equal(inkOn('#fbbc04'), '#1c1c1e');
  assert.equal(inkOn('rosso'), '#fff');
});
