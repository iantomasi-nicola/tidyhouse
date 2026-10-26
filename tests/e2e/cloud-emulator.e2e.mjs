// Test contro l'emulatore ufficiale di Firestore (richiede: firebase emulators:start --only firestore --project tidyhouse-ef92b, porta 8080,
// con le regole di firestore.rules). Due "dispositivi" (contesti browser) condividono la casa; verifica anche le regole.
import { start } from './helpers.mjs';
const EMU = '127.0.0.1:8080', PROJECT = 'tidyhouse-ef92b';
const rest = (p, o) => fetch(`http://${EMU}/v1/projects/${PROJECT}/databases/(default)/documents${p}`, o);
let bad = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
const env = await start();
const mk = (extra = {}) => env.page({ now: undefined, viewport: { width: 1280, height: 900 }, touch: false, ...extra });
const A = await mk(), B = await mk();
const wait = async (page, fn, arg, ms = 8000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

await A.goto(`${env.url}/?emu=${EMU}`); await A.waitForTimeout(800);
const id = await A.evaluate(() => window.__boot.createHouse({ name: 'Casa Cloud', startSunday: '2026-10-04', roommates: [{ name: 'Anna' }, { name: 'Bruno' }, { name: 'Carla' }], adminName: 'Anna', pin: '1234', mode: 'cloud' }));
ok(/^[0-9A-Z]{12}$/.test(id), 'casa creata nel cloud con codice ' + id);
ok(await wait(A, () => window.__app && window.__app.mode === 'cloud' && window.__app.isAdmin), 'A: modalità cloud e admin');

// regole: la lista delle case è vietata, il documento singolo è leggibile
const list = await rest('/houses'); ok(list.status === 403, 'regole: elenco case vietato (' + list.status + ')');
const one = await rest('/houses/' + id); ok(one.status === 200, 'regole: lettura della casa con il codice (' + one.status + ')');

// B entra con il link, sceglie Bruno
await B.goto(`${env.url}/?emu=${EMU}#/join/${id}`);
ok(await wait(B, () => window.__boot && window.__boot.stage === 'who'), 'B: dopo il link chiede "Chi sei?"');
const ids = await A.evaluate(() => window.__app.house.roommates.map((r) => [r.name, r.id]));
const bruno = ids.find((x) => x[0] === 'Bruno')[1];
await B.evaluate((b) => window.__boot.setMe(b), bruno);
await B.waitForTimeout(500);
if (await B.evaluate(() => window.__boot.stage === 'rules')) await B.evaluate(() => window.__boot.acceptRules());
ok(await wait(B, () => window.__boot.stage === 'app' && window.__app.me), 'B: dentro l\'app come Bruno');

// A -> B: assenza di Carla
const carla = ids.find((x) => x[0] === 'Carla')[1];
const sunday = await A.evaluate(() => window.__app.calc.out.rows[window.__app.calc.out.cur].sunday);
await A.evaluate(([s, c]) => window.__app.actions.setAway(s, c, true), [sunday, carla]);
ok(await wait(B, ([s, c]) => (window.__app.state.weeks[s] || {}).awayMap && window.__app.state.weeks[s].awayMap[c], [sunday, carla]), 'sync A→B: Carla assente');
// B -> A: Bruno segna fatto il suo turno
const chore = await B.evaluate(() => { const r = window.__app.calc.out.rows[window.__app.calc.out.cur]; const i = r.assigned.indexOf(window.__app.me); return i < 0 ? null : ['floor', 'bathroom', 'kitchen'][i]; });
ok(!!chore, 'B ha un turno questa settimana (' + chore + ')');
if (chore) {
  await B.evaluate(([s, c]) => window.__app.actions.setResult(s, c, 'done'), [sunday, chore]);
  ok(await wait(A, ([s, c]) => ((window.__app.state.weeks[s] || {}).result || {})[c] === 'done', [sunday, chore]), 'sync B→A: turno segnato fatto');
}
ok(await wait(A, () => Object.keys(window.__app.state.members).length >= 2), 'A vede i due dispositivi (accessi)');
// permessi lato app
ok(await B.evaluate(async () => { try { await window.__app.actions.setHouse({ name: 'x' }); return false; } catch (e) { return /permission/.test(e.message); } }), 'B non può modificare la casa');

// nuovo codice: copia tutto, vecchio link morto
const newId = await A.evaluate(() => window.__app.rotateCode({ leavingPersonIds: [] }));
const o = await rest('/houses/' + id), n = await rest('/houses/' + newId);
ok(o.status === 404 && n.status === 200, `nuovo codice: vecchio ${o.status}, nuovo ${n.status}`);
const w = await rest(`/houses/${newId}/weeks/${sunday}`); ok(w.status === 200, 'i dati delle settimane sono stati copiati');
ok(await A.evaluate(() => window.__app.houseId) === newId && await A.evaluate(() => window.__app.isAdmin), 'A resta admin con il nuovo codice');

// eliminazione
await A.evaluate(() => window.__app.deleteHouse()); await A.waitForTimeout(600);
ok((await rest('/houses/' + newId)).status === 404, 'casa eliminata dal cloud');
ok(![...(A.__errors || []), ...(B.__errors || [])].filter((e) => !/Failed to load resource|WebChannel|net::|favicon|sw\.js/i.test(e)).length, 'nessun errore in console');
await env.close(); console.log(bad ? bad + ' PROBLEMI' : 'TUTTO OK (emulatore)'); process.exit(bad ? 1 : 0);
