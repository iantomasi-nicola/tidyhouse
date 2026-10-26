import test from 'node:test';
import assert from 'node:assert/strict';
import { kickNow, repoOf, hasKick, scheduleKick } from '../js/kick.js';
import { exportBackup } from '../js/actions.js';

const pages = { hostname: 'iantomasi-nicola.github.io', pathname: '/tidyhouse/' };

test('kick: repository dedotto da GitHub Pages o impostato nella casa', () => {
  assert.equal(repoOf({}, pages), 'iantomasi-nicola/tidyhouse');
  assert.equal(repoOf({ kick: { repo: 'a/b' } }, pages), 'a/b');
  assert.equal(repoOf({}, { hostname: 'localhost', pathname: '/' }), null);
  assert.equal(repoOf({ kick: { repo: 'non valido' } }, { hostname: 'localhost', pathname: '/' }), null);
});

test('kick: richiesta a GitHub con token, ref e esito', async () => {
  const calls = [];
  const house = { kick: { token: 'github_pat_x', repo: 'o/r' } };
  const ok = await kickNow(house, { fetchFn: async (u, o) => { calls.push([u, o]); return { status: 204 }; } });
  assert.deepEqual(ok, { ok: true, status: 204 });
  assert.equal(calls[0][0], 'https://api.github.com/repos/o/r/actions/workflows/notify.yml/dispatches');
  assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].headers.Authorization, 'Bearer github_pat_x'); assert.deepEqual(JSON.parse(calls[0][1].body), { ref: 'main' });
  assert.deepEqual(await kickNow(house, { fetchFn: async () => ({ status: 403 }) }), { ok: false, status: 403 });
  assert.equal((await kickNow(house, { fetchFn: async () => { throw new Error('x'); } })).reason, 'network');
  assert.equal((await kickNow({}, { fetchFn: async () => ({ status: 204 }) })).reason, 'config');
  assert.equal(hasKick(house), true); assert.equal(hasKick({ kick: { repo: 'o/r' } }), false);
});

test('kick: più azioni ravvicinate diventano un solo avvio', async () => {
  let n = 0; const house = { kick: { token: 't', repo: 'o/r' } };
  const opts = { fetchFn: async () => { n++; return { status: 204 }; } };
  scheduleKick(() => house, opts); scheduleKick(() => house, opts); scheduleKick(() => house, opts);
  await new Promise((r) => setTimeout(r, 6600));
  assert.equal(n, 1);
});

test('kick: il token non finisce nei backup', () => {
  const b = exportBackup({ house: { name: 'C', kick: { token: 'segreto' } }, weeks: {} });
  assert.ok(!JSON.stringify(b).includes('segreto'));
});
