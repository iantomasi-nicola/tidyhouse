# Architettura (contratto tra i moduli)

App statica (GitHub Pages), moduli ES senza build. Nessun framework: `h()` crea elementi (js/ui.js).

## File e proprietà
- Nucleo (NON modificare nei moduli): `js/app.js`, `js/engine.js`, `js/extras.js`, `js/store.js`, `js/actions.js`, `js/ui.js` (solo aggiunte concordate), `js/i18n.js`, `css/app.css`.
- Ogni modulo scrive SOLO i propri file (elencati nel proprio incarico). Niente modifiche ai file degli altri.
- Stringhe nuove: `js/strings/<modulo>.js` con `export const it = {...}; export const en = {...};` e nel modulo `import { it, en } from '../strings/<modulo>.js'; registerStrings(it, en);` (da `../i18n.js`).
  Chiavi nuove con prefisso del modulo (es. `home.…`, `cal.…`) e MAI uguali a chiavi già esistenti in `js/i18n.js` (riusa quelle: `grep -n "'chiave'" js/i18n.js`). Lo verifica `tests/strings.test.mjs`.
- CSS specifico: `css/<modulo>.css` caricato con `loadCss('css/<modulo>.css')` (da `../ui.js`). Usa le variabili e le classi di `css/app.css` (card, list, li, btn, chip, seg, switch, sheet, hero, …).

## Contratto schermata
`js/screens/<nome>.js` esporta `export async function render(ctx, params) -> Node`. L'app la richiama a ogni cambio dati (rerender completo, scroll mantenuto, niente rerender mentre si scrive in un input). Gli stati effimeri (tab selezionato, form aperti) tienili in variabili di modulo o dentro sheet/dialog (che stanno fuori dal rerender).
Rotte: `#/` home, `#/calendar`, `#/trips`, `#/stats`, `#/more`, `#/needs|rules|lastout|tasks|requests|activity|guide` (→ `more.js` con `params.sub`), `#/settings[/sezione]` (→ `settings.js`, `params.sub` = sezione), onboarding gestito da `js/screens/onboarding.js`.

## ctx (oggetto passato alle schermate; sempre aggiornato)
`ctx.t(key, params)`, `ctx.h`, `ctx.icon(name)`, `ctx.toast(msg)`, `ctx.sheet({title, body, full})`, `ctx.haptic()`,
`ctx.store` (Store), `ctx.state` (stato cloud: house, weeks, trips, needs, members, log, requests, views), `ctx.house`, `ctx.actions` (Actions: tutte le scritture, con permessi),
`ctx.me` (id persona), `ctx.meName`, `ctx.isAdmin`, `ctx.lang`, `ctx.prefs` + `ctx.savePrefs(patch)`, `ctx.today()` ('YYYY-MM-DD'), `ctx.now()`,
`ctx.calc` → `{ eh, out, today }`: `out = compute(engineHouse(state), today)` = `{rows, cur, settings, summary}` (vedi js/engine.js; `rows[i]` ha `sunday, assigned[3], rest[], restName, away[], res[3], isMakeup[3], status, closed, isCur, isFut, nm[], pr[], subs[3] …`), `ctx.weeks` (settimane con `away` unito),
`ctx.name(id)`, `ctx.color(id)`, `ctx.person(id)`, `ctx.feature(key)` (funzione attiva?), `ctx.homeLayout()`, `ctx.badges()`,
`ctx.nav('calendar')`, `ctx.rerender()`, `ctx.cloud`, `ctx.cloudAvailable`, `ctx.mode` ('local'|'cloud'), `ctx.status`, `ctx.houseId`, `ctx.code()` (codice formattato), `ctx.joinLink()`, `ctx.baseUrl()`, `ctx.deviceId`, `ctx.config`,
operazioni: `ctx.unlockAdmin(pin)`, `ctx.lockAdmin()`, `ctx.setMe(id)`, `await ctx.rotateCode({leavingPersonIds})` → nuovo id, `await ctx.migrateToCloud()`, `await ctx.importBackup(backupJson)`, `ctx.leaveHouse()`, `await ctx.deleteHouse()`, `ctx.switchHouse(id)`, `ctx.houses()`.
Le scritture passano da `ctx.actions` (Actions in js/actions.js) o, per impostazioni admin, `ctx.actions.setHouse(patch)` / `ctx.store.setDoc(coll, id, data)`. I valori `null` in un patch CANCELLANO il campo.

## Funzioni condivise tra moduli (firma fissa)
- `js/choresheet.js`: `openChoreSheet(ctx, sunday, chore)` (chore = 'floor'|'bathroom'|'kitchen'), `openWeekSheet(ctx, sunday)`, `openWhatsAppSheet(ctx, sunday)`, `openIcsSheet(ctx, sunday)`, `openSwapRequestSheet(ctx, sunday, chore)`.
- `js/screens/trips.js`: oltre a `render`, esporta `openTripSheet(ctx, personId?)`.
- `js/screens/more.js`: `renderRulesContent(houseOrCtx)` (usato anche dal gate regole), `openLastOutSheet(ctx)`.
- `js/ai-ui.js`: `openAiImportSheet(ctx)` (solo admin).
- `js/push.js`: `status(ctx)` → `{state:'on'|'off'|'denied'|'unsupported'|'ios-install'|'nocloud'|'nopush', ...}`, `enable(ctx)`, `disable(ctx)`, `localTest(ctx)`, `resync(ctx)`, `generateVapid()` → `{publicKey, privateKey}`.
- `js/screens/onboarding.js`: `renderGate(stage, boot, params) -> Node|Promise<Node>`; stage ∈ `landing|create|join|notfound|offline|who|rules`. `boot`: vedi in js/app.js (`boot.createHouse`, `boot.join`, `boot.setMe`, `boot.acceptRules`, `boot.unlockAdmin`, `boot.go(stage, params)`, `boot.importExcel(file)`, `boot.houses`, `boot.house`, `boot.cloudAvailable`, `boot.t/h/icon/toast`).

## Schema dei dati
**house** (doc `houses/{id}`): `name, startSunday, lang, tz, roommates[{id,name,slot,from,to,color}], settings{grace,minRest,startPriority,window,minNights,rankBy:'turns'|'effort'}, features{needs,stats,tasks,lastout,requests,planDay,whatsapp,activity,trips,rules,ranking,ics,refresh,selfDone,selfAway,coverOthers: bool}, effort{floor,bathroom,kitchen:1-5}, notif{vedi DEFAULT_NOTIF in js/extras.js}, tasks[{id,chore,text,every,anchor,enabled}], links{tricount{url,show}, whatsapp{url,show}, custom[{id,label,url,show}]}, home{order[],hidden[]}, rules{version,text{it,en}|null}, requireRules, refreshMin, lastoutItems[{id,text}]|null, lastOut{checked{itemId:{by,at}},doneBy,doneAt}, adminHash, adminSalt, adminIds[], createdAt, prevIds[], rotatedAt, ignoreLeft{personId:true}, vapidPublic, serverRun, ai{enabled}`.
**weeks/{sundayISO}**: `awayMap{personId:true}, everyone, result{floor|bathroom|kitchen: 'done'|'skipped'|'by:ID'|'skipped:ID'}, resultAt{}, resultBy{}, swap{chore:personId}, plan{chore:'YYYY-MM-DD'}, note, tasksDone{taskId:{by,at}}`.
**trips/{id}**: `personId, from, to|null (giorno di rientro), note, by, at`. **needs/{id}**: `text, urgent, by, at, done, doneBy, doneAt`.
**requests/{id}**: scambio `{week, from, to, fromChore, toChore, status:'pending'|'accepted'|'declined', at}`; sollecito `{kind:'nudge', to, from, text}`.
**members/{deviceId}**: `personId, isAdmin, ua, device{os,browser,kind,label}, name, lang, lastSeen, firstSeen, push{endpoint,keys}|null, prefs{notifType:bool}, rulesAck{version,at}, version, standalone`. **log/{id}**: `at, by, type, p{}`. **views/{id}**: `at, device, personId, screen`.

## Qualità richiesta
- Mobile first (390px), tablet (768px) e desktop (≥1180px); tocco ≥ 44px; testo leggibile; dark mode; nessun overflow orizzontale; accessibilità (aria-label, focus visibile, contrasto).
- Tutto il testo visibile passa da `t()` (IT + EN). Niente stringhe hardcoded.
- Ogni funzione attivabile/disattivabile (`ctx.feature(k)`) deve sparire se spenta. Le azioni riservate all'admin si mostrano solo se `ctx.isAdmin`; i permessi veri sono in `ctx.actions` (lancia `Error('permission')`).
- Errori delle azioni: `try/catch` con `ctx.toast(ctx.t('error'))`.
- Test: scrivi test e2e Playwright in `tests/e2e/<modulo>.e2e.mjs` con `tests/e2e/helpers.mjs` (server statico + `seed()` + orologio finto) e verifica visivamente con screenshot (cartella scratchpad) su mobile e desktop. Esegui `node --test tests/*.test.mjs` prima di consegnare: deve restare tutto verde.
