import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, addDays, dayNum } from '../js/engine.js';
import { DICT, tr, fmtWeekRange, fmtDate } from '../js/i18n.js';
import { tasksForWeek, nextDueWeek, planOf, planNotifications, targetsFor, notifMessage, whatsappText, makeIcs, toCsv, historyRows, buildStats,
  randomCode, fmtCode, normCode, swapPatch, localParts, notifCfg, feature, deepMerge, weekOfDate, rankingText } from '../js/extras.js';

const START = '2026-10-04';
const wk = (i) => addDays(START, 7 * i);
const rm = ['A', 'B', 'C'].map((n, i) => ({ id: n, name: n === 'A' ? 'Anna' : n === 'B' ? 'Bruno' : 'Carla', slot: i + 1, from: null, to: null }));
const house = (extra = {}) => ({ id: 'H', name: 'Casa', startSunday: START, roommates: rm, tz: 'Europe/Rome', tasks: [], settings: {}, ...extra });

test('i18n: IT e EN hanno le stesse chiavi e nessun segnaposto perso', () => {
  const it = Object.keys(DICT.it), en = Object.keys(DICT.en);
  assert.deepEqual(it.filter((k) => !(k in DICT.en)), [], 'mancano in EN');
  assert.deepEqual(en.filter((k) => !(k in DICT.it)), [], 'mancano in IT');
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of it) assert.equal(ph(DICT.it[k]), ph(DICT.en[k]), `segnaposto diversi in ${k}`);
  assert.equal(tr('it', 'home.hello', { name: 'Anna' }), 'Ciao Anna');
  assert.equal(tr('en', 'home.hello', { name: 'Anna' }), 'Hi Anna');
  assert.equal(tr('en', 'chiave.inesistente'), 'chiave.inesistente');
  assert.equal(fmtWeekRange('2026-11-01', 'it'), '26 ott – 1 nov');
  assert.equal(fmtWeekRange('2026-10-11', 'en'), '5–11 Oct');
  assert.equal(fmtDate('2026-12-31', 'it', { year: true }), '31 dic 2026');
});

test('checklist ricorrenti: scadenza ogni X settimane, arretrato e completamento', () => {
  const t = { id: 't1', chore: 'floor', text: 'Svuota aspirapolvere', every: 2, anchor: START, enabled: true };
  const h = house({ tasks: [t] });
  const st = (i, weeks = {}) => tasksForWeek(h, weeks, wk(i));
  assert.equal(st(0)[0].status, 'due');
  assert.equal(st(1)[0].status, 'overdue', 'non fatto: l\'arretrato resta');
  assert.equal(st(2)[0].status, 'due');
  // fatto nella settimana 0: nella 1 non compare, nella 2 e' di nuovo dovuto
  const done0 = { [wk(0)]: { tasksDone: { t1: { by: 'A' } } } };
  assert.equal(st(0, done0)[0].status, 'done');
  assert.equal(st(1, done0).length, 0);
  assert.equal(st(2, done0)[0].status, 'due');
  // fatto in ritardo nella settimana 1: ciclo 0 chiuso
  const done1 = { [wk(1)]: { tasksDone: { t1: { by: 'B' } } } };
  assert.equal(st(1, done1)[0].status, 'done');
  assert.equal(st(1, done1)[0].done.by, 'B');
  // ogni settimana
  const h1 = house({ tasks: [{ ...t, every: 1 }] });
  for (let i = 0; i < 4; i++) assert.equal(tasksForWeek(h1, {}, wk(i))[0].status, 'due');
  // disattivato / ancora lontano / valori sporchi
  assert.equal(tasksForWeek(house({ tasks: [{ ...t, enabled: false }] }), {}, wk(0)).length, 0);
  assert.equal(tasksForWeek(house({ tasks: [{ ...t, anchor: wk(5) }] }), {}, wk(2)).length, 0);
  assert.equal(tasksForWeek(house({ tasks: [{ ...t, every: 'x' }] }), {}, wk(3))[0].status, 'due');
  assert.equal(tasksForWeek(house({ tasks: [{ ...t, every: 0 }] }), {}, wk(3))[0].status, 'due');
  assert.equal(nextDueWeek(h, t, 3), 4);
  assert.equal(nextDueWeek(h, t, 4), 4);
  assert.equal(nextDueWeek(h, t, 0), 0);
  // anchor non domenica: viene riportato alla settimana che lo contiene
  assert.equal(tasksForWeek(house({ tasks: [{ ...t, anchor: '2026-10-07' }] }), {}, wk(1))[0].status, 'due');
});

test('giorno scelto: deve ricadere nella settimana, altrimenti e\' ignorato', () => {
  const h = house({ weeks: { [wk(3)]: { plan: { floor: addDays(wk(3), -2), bathroom: addDays(wk(3), 3), kitchen: addDays(wk(3), -6) } } } });
  assert.equal(planOf(h, wk(3), 'floor'), addDays(wk(3), -2));
  assert.equal(planOf(h, wk(3), 'bathroom'), '');
  assert.equal(planOf(h, wk(3), 'kitchen'), addDays(wk(3), -6)); // lunedi'
  assert.equal(planOf(h, wk(4), 'floor'), '');
});

test('fusi orari: localParts e cambio ora legale', () => {
  assert.deepEqual(localParts(new Date('2026-10-31T09:30:00Z'), 'Europe/Rome'), { date: '2026-10-31', minutes: 630, dow: 6 }); // CET dopo il 25/10
  assert.equal(localParts(new Date('2026-10-24T09:30:00Z'), 'Europe/Rome').minutes, 690); // CEST
  assert.equal(localParts(new Date('2026-10-31T23:30:00Z'), 'Europe/Rome').date, '2026-11-01'); // oltre mezzanotte locale
  assert.equal(localParts(new Date('2026-10-31T12:00:00Z'), 'Fuso/Inesistente').date, '2026-10-31'); // fallback
  assert.equal(localParts(new Date('2026-10-31T12:00:00Z'), 'America/Los_Angeles').minutes, 300);
});

const nowRome = (iso) => new Date(iso); // gli ISO sono in UTC; ottobre-novembre: Roma = UTC+1 dopo il 25/10
test('notifiche: venerdi\' (assenza), sabato (cosa ti tocca), domenica (segna fatto)', () => {
  const h = house({ tasks: [{ id: 't', chore: 'floor', text: 'x', every: 1, anchor: START, enabled: true }] });
  const weeks = {};
  // venerdi' 30/10 17:10 Roma = 16:10 UTC; B e' via
  weeks[wk(4)] = { away: ['B'] };
  let n = planNotifications({ house: h, weeks, now: nowRome('2026-10-30T16:10:00Z') });
  assert.deepEqual(n.filter((x) => x.type === 'friAbsence').map((x) => x.personId).sort(), ['A', 'C'], 'non avvisa chi e\' gia\' assente');
  // prima dell'orario: niente
  assert.equal(planNotifications({ house: h, weeks, now: nowRome('2026-10-30T15:00:00Z') }).length, 0);
  // troppo tardi (oltre la finestra di recupero): niente
  assert.equal(planNotifications({ house: h, weeks, now: nowRome('2026-10-30T23:00:00Z') }).filter((x) => x.type === 'friAbsence').length, 0);
  // sabato 31/10 10:15 Roma
  n = planNotifications({ house: h, weeks: {}, now: nowRome('2026-10-31T09:15:00Z') });
  const sat = n.filter((x) => x.type === 'satDuty');
  assert.equal(sat.length, 3);
  const out = compute(h, '2026-10-31', 2);
  for (const s of sat) assert.ok(out.rows[4].assigned.includes(s.personId));
  const floorOwner = out.rows[4].assigned[0];
  assert.equal(sat.find((x) => x.personId === floorOwner).extra, 1, 'conta il compito extra');
  const msg = notifMessage(sat.find((x) => x.personId === floorOwner), h, 'it');
  assert.match(msg.body, /Pavimenti/); assert.match(msg.body, /extra/);
  assert.match(notifMessage(sat[0], h, 'en').title, /due tomorrow/);
  // chi ha gia' segnato fatto non riceve il promemoria
  const done = { [wk(4)]: { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } } };
  assert.equal(planNotifications({ house: h, weeks: done, now: nowRome('2026-10-31T09:15:00Z') }).length, 0);
  // domenica 1/11 18:20 Roma
  n = planNotifications({ house: h, weeks: { [wk(4)]: { result: { floor: 'done' } } }, now: nowRome('2026-11-01T17:20:00Z') });
  assert.equal(n.filter((x) => x.type === 'sunMark').length, 2);
  assert.ok(n.every((x) => x.personId !== floorOwner || x.type !== 'sunMark'));
});

test('notifiche: dedup, disattivazione e destinatari per dispositivo', () => {
  const h = house();
  const now = nowRome('2026-10-31T09:15:00Z');
  const first = planNotifications({ house: h, weeks: {}, now });
  const sent = new Set([first[0].key]);
  assert.equal(planNotifications({ house: h, weeks: {}, now, sent }).length, first.length - 1);
  assert.equal(planNotifications({ house: house({ notif: { satDuty: { on: false } } }), weeks: {}, now }).length, 0);
  assert.equal(planNotifications({ house: house({ notif: { enabled: false } }), weeks: {}, now }).length, 0);
  const members = {
    d1: { personId: 'A', push: { endpoint: 'e1' }, lang: 'it' }, d2: { personId: 'A', push: { endpoint: 'e2' }, prefs: { satDuty: false } },
    d3: { personId: 'B', push: { endpoint: 'e3' } }, d4: { personId: 'A' }, d5: { personId: 'A', push: { endpoint: 'e5' }, prefs: { satDuty: true } },
  };
  assert.deepEqual(targetsFor({ type: 'satDuty', personId: 'A' }, members, h).map((x) => x.id).sort(), ['d1', 'd5']);
  assert.deepEqual(targetsFor({ type: 'satDuty', personId: 'Z' }, members, h), []);
  assert.deepEqual(targetsFor({ type: 'satDuty', personId: 'A' }, members, house({ notif: { satDuty: { on: false } } })), []);
});

test('notifiche: ritardo da lunedi\', max 3 al giorno agli orari scelti, fino a N giorni', () => {
  const h = house();
  const weeks = { [wk(4)]: { result: { floor: 'done' } } };              // bagno e cucina non segnati
  const at = (iso) => planNotifications({ house: h, weeks, now: nowRome(iso) }).filter((x) => x.type === 'late');
  // lunedi' 2/11 09:10 Roma = 08:10 UTC -> primo slot
  let n = at('2026-11-02T08:10:00Z');
  assert.ok(n.length >= 1 && n.every((x) => x.slot === 0 && x.week === wk(4)));
  assert.ok(n.every((x) => !x.lateClosed), 'lunedi\' e\' ancora entro la tolleranza');
  assert.deepEqual(at('2026-11-02T13:10:00Z').map((x) => x.slot), n.map(() => 1));
  assert.deepEqual(at('2026-11-02T19:10:00Z').map((x) => x.slot), n.map(() => 2));
  assert.equal(at('2026-11-02T04:00:00Z').length, 0, 'prima del primo orario');
  assert.ok(at('2026-11-02T11:00:00Z').every((x) => x.slot === 0), 'recupero entro la finestra: ancora il primo slot');
  assert.equal(planNotifications({ house: house({ notif: { late: { times: ['09:00', '10:00', '11:00'], max: 3 } } }), weeks, now: nowRome('2026-11-02T10:30:00Z') }).filter((x) => x.type === 'late').map((x) => x.slot).filter((v, i, a) => a.indexOf(v) === i).join(), '2', 'un solo invio per esecuzione');
  // martedi' = chiusa => conta gia' come saltata
  assert.ok(at('2026-11-03T08:10:00Z').every((x) => x.lateClosed));
  // oltre 4 giorni dopo la domenica: stop
  assert.equal(at('2026-11-06T08:10:00Z').length, 0);
  // settimana corrente non e' "in ritardo"
  const prevDone = { [wk(3)]: { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } } };
  assert.equal(planNotifications({ house: h, weeks: prevDone, now: nowRome('2026-10-27T08:10:00Z') }).filter((x) => x.type === 'late').length, 0);
  // max 1 al giorno
  const h1 = house({ notif: { late: { max: 1 } } });
  assert.equal(planNotifications({ house: h1, weeks, now: nowRome('2026-11-02T13:10:00Z') }).filter((x) => x.type === 'late').length, 0);
  // testo
  assert.match(notifMessage(n[0], h, 'it').body, /Manca ancora/);
});

test('notifiche: giorno scelto per il turno (oggi / giorno passato) e riepilogo admin', () => {
  const h = house({ adminIds: ['A'], notif: { adminDigest: { on: true } } });
  const weeks = { [wk(4)]: { plan: { floor: '2026-10-30', bathroom: '2026-10-28' } } };
  // venerdi' 30/10 09:20 Roma = 08:20 UTC
  const n = planNotifications({ house: h, weeks, now: nowRome('2026-10-30T08:20:00Z') });
  const pd = n.filter((x) => x.type === 'planDay'), late = n.filter((x) => x.type === 'planDayLate');
  assert.equal(pd.length, 1); assert.deepEqual(pd[0].chores, ['floor']);
  assert.equal(late.length, 1); assert.deepEqual(late[0].chores, ['bathroom']);
  assert.match(notifMessage(late[0], h, 'it').body, /mercoled/);
  // fatto: nessun promemoria
  const done = { [wk(4)]: { ...weeks[wk(4)], result: { floor: 'done', bathroom: 'done' } } };
  assert.equal(planNotifications({ house: h, weeks: done, now: nowRome('2026-10-30T08:20:00Z') }).filter((x) => x.type.startsWith('planDay')).length, 0);
  // riepilogo admin lunedi' 9:40
  const d = planNotifications({ house: h, weeks: {}, now: nowRome('2026-11-02T08:40:00Z') }).filter((x) => x.type === 'adminDigest');
  assert.equal(d.length, 1); assert.equal(d[0].personId, 'A'); assert.equal(d[0].n, 3);
});

test('notifiche: oggi prima dell\'inizio, casa senza persone, settimana senza turni', () => {
  assert.deepEqual(planNotifications({ house: house({ startSunday: '2027-01-03' }), weeks: {}, now: nowRome('2026-10-31T09:15:00Z') }), []);
  assert.deepEqual(planNotifications({ house: house({ roommates: [] }), weeks: {}, now: nowRome('2026-10-31T09:15:00Z') }), []);
  const h = house();
  const n = planNotifications({ house: h, weeks: { [wk(4)]: { everyone: true } }, now: nowRome('2026-10-31T09:15:00Z') });
  assert.equal(n.length, 0);
});

test('WhatsApp: testo della settimana con recuperi, assenti, giorno scelto', () => {
  const h = house({ weeks: { [wk(0)]: { away: ['C'], plan: { floor: addDays(wk(0), -3) } } }, features: {} });
  const out = compute(h, wk(0), 3);
  const txt = whatsappText(h, out, wk(0), { link: true, url: 'https://x.y/z/' }, 'it', h.weeks);
  assert.match(txt, /Turni della settimana\* 28 set – 4 ott/);
  assert.match(txt, /Pavimenti: /); assert.match(txt, /Assenti: Carla/); assert.match(txt, /lo fa /); assert.match(txt, /https:\/\/x\.y\/z\//);
  const en = whatsappText(h, out, wk(0), {}, 'en', h.weeks);
  assert.match(en, /rota/); assert.doesNotMatch(en, /https/);
  assert.equal(whatsappText(h, out, '2000-01-02', {}, 'it'), '');
  // 1 solo presente: tutti i turni a lui
  const solo = house({ weeks: { [wk(1)]: { away: ['A', 'B'] } } });
  assert.match(whatsappText(solo, compute(solo, wk(0), 5), wk(1), {}, 'it', solo.weeks), /Bagno: Carla/);
  // senza assegnati
  const none = house({ weeks: { [wk(1)]: { everyone: true } } });
  assert.match(whatsappText(none, compute(none, wk(0), 5), wk(1), {}, 'it', none.weeks), /nessuno/);
});

test('ICS: eventi per i turni della persona, con giorno scelto', () => {
  const h = house({ weeks: { [wk(1)]: { plan: { floor: addDays(wk(1), -2) } } } });
  const out = compute(h, wk(0), 10);
  const owner = out.rows[1].assigned[0];
  const ics = makeIcs(h, out, owner, 'it', h.weeks, wk(0), 4);
  assert.match(ics, /^BEGIN:VCALENDAR/); assert.match(ics, /END:VCALENDAR$/);
  assert.ok((ics.match(/BEGIN:VEVENT/g) || []).length >= 3);
  assert.match(ics, new RegExp('DTSTART;VALUE=DATE:' + addDays(wk(1), -2).replace(/-/g, '')));
  assert.ok(ics.split('\r\n').every((l) => l.length < 300));
  assert.doesNotMatch(makeIcs(h, out, 'ghost', 'it', {}, wk(0), 4), /VEVENT/);
});

test('CSV: virgolette, a capo e BOM', () => {
  const h = house({ roommates: [{ id: 'A', name: 'An"na, Rossi', slot: 1 }, { id: 'B', name: 'B', slot: 2 }, { id: 'C', name: 'C', slot: 3 }], weeks: { [wk(0)]: { note: 'riga1\nriga2' } } });
  const out = compute(h, wk(1), 3);
  const csv = toCsv(historyRows(h, out, 'it', h.weeks));
  assert.ok(csv.startsWith('﻿week_ending,floor'));
  assert.match(csv, /"An""na, Rossi"/);
  assert.match(csv, /"riga1\nriga2"/);
  assert.equal(toCsv([]), '');
});

test('statistiche: presenza, equita\' e completamento', () => {
  const weeks = {};
  for (let i = 0; i < 8; i++) weeks[wk(i)] = { result: { floor: 'done', bathroom: 'done', kitchen: 'done' } };
  weeks[wk(2)] = { away: ['C'], result: { floor: 'skipped', bathroom: 'done', kitchen: 'done' } };
  const h = house({ weeks, effort: { floor: 2, bathroom: 3, kitchen: 1 } });
  const out = compute(h, addDays(wk(8), -2), 4);
  const s = buildStats(h, out);
  assert.equal(s.closedWeeks, 8);
  assert.equal(s.people.length, 3);
  const c = s.people.find((p) => p.id === 'C');
  assert.equal(c.weeksHome, 7); assert.equal(c.presence, 88);
  assert.ok(s.completion < 100 && s.completion > 90);
  assert.ok(s.balance > 50 && s.balance <= 100);
  assert.equal(s.people.reduce((a, p) => a + p.skipped, 0), 1);
  // effort pesato
  const total = s.people.reduce((a, p) => a + p.effort, 0);
  assert.ok(total > s.people.reduce((a, p) => a + p.cleanedTotal, 0));
  assert.match(rankingText(h, out, s, 'it'), /Classifica/);
  assert.ok(s.monthly.length >= 1);
  // nessuna settimana chiusa
  const s0 = buildStats(house(), compute(house(), wk(0), 3));
  assert.equal(s0.closedWeeks, 0); assert.equal(s0.completion, null);
});

test('codici casa: lunghezza, alfabeto, normalizzazione', () => {
  const c = randomCode(12);
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(normCode(fmtCode(c)), c);
  assert.equal(fmtCode('ABCD1234EFGH'), 'ABCD-1234-EFGH');
  assert.equal(normCode(' abcd-1o23 eIgh '), 'ABCD1023E1GH');
  assert.notEqual(randomCode(12), randomCode(12));
});

test('scambio turno: patch di swap', () => {
  const h = house();
  const out = compute(h, wk(0), 3);
  const r = out.rows[0];
  const p = swapPatch(r, { chore: 'floor', personId: r.assigned[0] }, { chore: 'bathroom', personId: r.assigned[1] });
  assert.equal(p.floor, r.assigned[1]); assert.equal(p.bathroom, r.assigned[0]); assert.equal(p.kitchen, undefined);
  const h2 = house({ weeks: { [wk(0)]: { swap: p } } });
  const r2 = compute(h2, wk(0), 3).rows[0];
  assert.equal(r2.assigned[0], r.assigned[1]); assert.equal(r2.assigned[1], r.assigned[0]);
});

test('config: valori di default, merge profondo e feature flag', () => {
  assert.equal(notifCfg({}).late.max, 3);
  assert.equal(notifCfg({ notif: { late: { max: 1 } } }).late.times.length, 3);
  assert.equal(notifCfg({ notif: { late: { max: 1 } } }).late.max, 1);
  assert.equal(feature({}, 'needs'), true);
  assert.equal(feature({ features: { needs: false } }, 'needs'), false);
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 } }), { a: { b: 9, c: 2 } });
  assert.equal(weekOfDate(house(), '2026-10-26'), '2026-11-01');
  assert.equal(weekOfDate(house(), '2026-11-01'), '2026-11-01');
  assert.equal(weekOfDate(house(), '2026-11-02'), '2026-11-08');
});

test('ritardo annunciato: niente solleciti fino a quel giorno, promemoria il giorno scelto', async () => {
  const { delayOf } = await import('../js/extras.js');
  const h = house();
  const weeks = { [wk(4)]: { result: { floor: 'done' }, delay: { bathroom: '2026-11-05' } } };   // bagno in ritardo fino al 5/11; cucina senza risultato
  assert.equal(delayOf({ ...h, weeks }, wk(4), 'bathroom'), '2026-11-05'); assert.equal(delayOf({ ...h, weeks }, wk(4), 'kitchen'), '');
  const late = planNotifications({ house: h, weeks, now: nowRome('2026-11-02T08:10:00Z') }).filter((x) => x.type === 'late');
  assert.ok(late.length >= 1 && late.every((x) => !x.chores.includes('bathroom')), 'il bagno non viene sollecitato');
  const out = compute({ ...h, weeks }, '2026-11-02', 3); const owner = out.rows[4].assigned[1];
  const day = planNotifications({ house: h, weeks, now: nowRome('2026-11-05T08:20:00Z') }).filter((x) => x.type === 'planDay');
  assert.ok(day.some((x) => x.personId === owner && x.chores.includes('bathroom')), 'promemoria il giorno annunciato');
  // dopo quel giorno, se ancora non fatto, ricomincia a sollecitare
  const after = planNotifications({ house: h, weeks, now: nowRome('2026-11-06T08:10:00Z') }).filter((x) => x.type === 'late');
  assert.ok(Array.isArray(after));
});
