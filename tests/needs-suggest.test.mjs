// Spesa: suggerimenti frequenti, partenza casa nuova, incolla di più righe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normNeed, frequentNeeds, hasNeedHistory, distinctNeeds, starterNeeds, splitPasted } from '../js/needs-suggest.js';

const N = (text, at, extra = {}) => ({ text, at, by: 'anna', done: false, ...extra });
const L = (text, at) => ({ at, by: 'anna', type: 'need', p: { text } });

test('normNeed: maiuscole e spazi', () => {
  assert.equal(normNeed('  Carta   IGIENICA '), 'carta igienica');
  assert.equal(normNeed(null), '');
});

test('frequentNeeds: conta scorte (anche comprate) e registro senza doppio conteggio', () => {
  const needs = {
    a: N('Latte', '2026-10-01T10:00:00Z', { done: true }),
    b: N('latte ', '2026-10-05T10:00:00Z', { done: true }),
    c: N('Pane', '2026-10-06T10:00:00Z', { done: true }),
  };
  const log = { l1: L('Latte', '2026-10-01T10:00:00Z'), l2: L('latte', '2026-10-05T10:00:00Z'), l3: L('Uova', '2026-10-02T10:00:00Z'), l4: L('Uova', '2026-10-03T10:00:00Z'), l5: L('Uova', '2026-10-04T10:00:00Z') };
  const r = frequentNeeds({ needs, log });
  assert.deepEqual(r.map((x) => [x.text, x.count]), [['Uova', 3], ['latte', 2], ['Pane', 1]]);   // grafia più recente; Uova solo dal registro (voci cancellate)
});

test('frequentNeeds: esclude le voci già in lista aperta (case-insensitive)', () => {
  const needs = { a: N('Sale', '2026-10-01T10:00:00Z', { done: true }), b: N('sale', '2026-10-07T10:00:00Z'), c: N('Olio', '2026-10-02T10:00:00Z', { done: true }) };
  assert.deepEqual(frequentNeeds({ needs }).map((x) => x.text), ['Olio']);
});

test('frequentNeeds: massimo 8, a parità vince la più recente', () => {
  const needs = {}; for (let i = 0; i < 12; i++) needs['n' + i] = N('Voce ' + i, `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`, { done: true });
  const r = frequentNeeds({ needs });
  assert.equal(r.length, 8);
  assert.equal(r[0].text, 'Voce 11');
});

test('frequentNeeds: filtro per prefisso prima, poi per inclusione', () => {
  const needs = {
    a: N('Detersivo piatti', '2026-10-01T10:00:00Z', { done: true }), b: N('Detersivo piatti', '2026-10-02T10:00:00Z', { done: true }),
    c: N('Sapone detersivo', '2026-10-03T10:00:00Z', { done: true }), d: N('Pane', '2026-10-04T10:00:00Z', { done: true }), e: N('Deter lavatrice', '2026-10-05T10:00:00Z', { done: true }),
  };
  assert.deepEqual(frequentNeeds({ needs, query: 'DETER' }).map((x) => x.text), ['Detersivo piatti', 'Deter lavatrice', 'Sapone detersivo']);
  assert.deepEqual(frequentNeeds({ needs, query: 'zzz' }), []);
});

test('frequentNeeds: dati sporchi non rompono nulla', () => {
  assert.deepEqual(frequentNeeds({ needs: { a: null, b: { text: 5 }, c: { text: '   ' } }, log: { x: null, y: { type: 'need' }, z: { type: 'need', p: { text: 7 } }, w: { type: 'other', p: { text: 'Ciao' } } } }), []);
  assert.deepEqual(frequentNeeds({}), []);
  assert.deepEqual(frequentNeeds(), []);
});

test('hasNeedHistory', () => {
  assert.equal(hasNeedHistory({}), false);
  assert.equal(hasNeedHistory({ needs: { a: N('x', '2026-10-01T10:00:00Z') } }), true);
  assert.equal(hasNeedHistory({ log: { a: L('x', '2026-10-01T10:00:00Z') } }), true);
  assert.equal(hasNeedHistory({ log: { a: { type: 'turn', p: {} } } }), false);
});

test('starterNeeds: salta i doppioni e le voci già aperte', () => {
  assert.deepEqual(starterNeeds(['Carta igienica', 'Spugne', 'spugne', ' '], { a: N('carta IGIENICA', '2026-10-01T10:00:00Z') }), ['Spugne']);
  assert.deepEqual(starterNeeds(['A', 'B', 'C'], {}, 2), ['A', 'B']);
});

test('splitPasted: una riga = una voce, tolti elenchi e doppioni', () => {
  assert.deepEqual(splitPasted('Latte'), [], 'senza a capo non fa nulla');
  assert.deepEqual(splitPasted('Latte\n'), [], 'a capo finale su una sola riga: lo gestisce il campo');
  assert.deepEqual(splitPasted('- Latte\n* Pane\r\n• Uova\n1) Sale\n2. Olio\n\n  \nlatte'), ['Latte', 'Pane', 'Uova', 'Sale', 'Olio']);
  assert.deepEqual(splitPasted('Carta   igienica\nSpugne'), ['Carta igienica', 'Spugne']);
  assert.equal(splitPasted('x'.repeat(100) + '\nb')[0].length, 80);
  assert.deepEqual(splitPasted(''), []);
});

test('distinctNeeds: voci diverse tra scorte e registro', () => {
  assert.equal(distinctNeeds({}), 0);
  assert.equal(distinctNeeds({ needs: { a: N('Latte', 'x'), b: N('latte', 'y') }, log: { l: L('LATTE', 'z'), m: L('Pane', 'z') } }), 2);
});
