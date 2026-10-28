# HANDOFF — leggi questo per primo

Documento di passaggio per chi (altra IA o persona) continua il lavoro. Lingua con l'utente: **italiano**. L'utente è uno studente che gestisce una casa con altri coinquilini; vuole un'app **realmente usabile**, sobria, che faccia **risparmiare tempo** e non metta frizione.
La lista di cose da fare, in ordine di priorità, è in [`TODO.md`](TODO.md). Le regole del progetto e i contratti tra moduli sono in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Cos'è
**Tidy House**: PWA statica (GitHub Pages) per i turni di pulizia di una casa, nata dal foglio Excel *House Cleaning Plan* (il foglio originale è la fonte di verità delle regole). Vanilla JS ES modules, **nessuna build**. Dati condivisi su **Firebase Firestore** (piano gratuito), notifiche con **Web Push** inviate da una **GitHub Action** oraria. UI in **italiano e inglese**.

- Repo: `iantomasi-nicola/tidyhouse` (branch `main`, Pages da `main` / root). Sito: `https://iantomasi-nicola.github.io/tidyhouse/`.
- Firebase: progetto `tidyhouse-ef92b` (config web già in `config.js`; è pubblica per natura). Regole in `firestore.rules`.
- Nome app: "Tidy House". Colore predefinito `#1a73e8`. Stile: **Apple minimale + Material (Google)**, colori Material, **niente gradienti, niente scintille, niente effetto "IA"**, forme arrotondate, tipografia grande, movimento sobrio.

## Stato (cosa è fatto e verificato)
- **Motore dei turni** (`js/engine.js`): porting fedele dell'Excel, 0 differenze su 36 scenari. **Non va cambiato.**
- **Dati/cloud** (`js/store.js`, `js/actions.js`): backend memoria/locale/Firestore, permessi, codice casa con rotazione, cambio admin, PIN admin. Verificato con l'emulatore Firestore (`tests/e2e/cloud-emulator.e2e.mjs`).
- **Turni**: segna fatto con checklist obbligatoria e Annulla, volontari, sostituzioni sempre «con recupero» (il «regalo» è stato rimosso) con **motivo** visibile a tutti (nota), **«Non posso questa settimana»** (sostituto automatico = `autoSub` in `js/extras.js`, `Actions.autoCover`; chi non può resta l'assegnato e recupera dopo), ritardo annunciato, scambi, assegnazione manuale della settimana (admin, `js/weekassign.js`, `Actions.setWeekAssignments`) anche da IA (`js/ai.js`).
- **Recupero programmato** (`Actions.planMakeup`/`clearMakeup`): se X annuncia «recupero lunedì» entro la tolleranza dopo la fine di una settimana, X prende il turno di quella settimana (swap + `autoMakeup`) e chi lo aveva è liberato con avviso `makeupFree`; annullando il ritardo si ripristina.
- **Settimane lunghe** (`js/screens/calendar.js`, `docs/ux/calendar-long.md`): corrente + 4 prossime, «Mostra altre», passate a mesi richiudibili con riepilogo, pulsante «Oggi», deep link `#/calendar?week=`.
- **Notifiche**: server `scripts/notify-core.mjs` (un solo avviso per dispositivo se ci sono più novità; spesa solo a chi è a casa e non l'ha aggiunta; «comprato» solo a chi aveva aggiunto la voce; assenti esclusi; azioni «Segna fatto»/«Accetta»/«Rifiuta» via `js/doaction.js` e `sw.js`), avvio immediato opzionale con token GitHub (`js/kick.js`), gate di attivazione in `js/app.js`, diagnosi in Impostazioni → Notifiche. Più case: stesso progetto Firebase e **stessa chiave VAPID**.
- **Spesa veloce** (`js/needs-suggest.js`, pagina Spesa), **onboarding in due passi**, **spiegazione in app** (Altro → Regole → «Come funziona nella pratica»).
- **Audit di usabilità** fatto: `UX_AUDIT.md` + `docs/ux/*.md` (criticità, correzioni, metriche prima/dopo).
- **Test**: `npm test` (unitari, ~155) e `npm run e2e` (tutti i `tests/e2e/*.e2e.mjs` UNO ALLA VOLTA; in parallelo danno falsi errori). `npm run check` = test + smoke. CI GitHub: `.github/workflows/ci.yml`.

## Cosa NON è stato verificato (rischio reale)
1. **Notifiche push reali su telefono** (Android/iPhone), compresi i bottoni sulle notifiche (su iPhone non esistono: il tocco sul corpo apre l'app) e l'arrivo su iPad.
2. **Token GitHub per l'avvio immediato** con GitHub vero (provato solo con GitHub simulato) e **due case reali** sullo stesso server.
3. **IA con una chiave vera** (assegnazioni e correzioni da testo): provata solo con risposte simulate.
4. **Aspetto/tastiera su telefono vero** (solo emulazione Playwright), Firestore reale con due dispositivi insieme.
5. **Import del foglio Excel reale** nei test: il file non è nell'ambiente (`XLSX_FILE`).

## Stato di configurazione lato utente (da non rifare)
- Firebase: progetto creato, Firestore creato con le regole di `firestore.rules`, chiave API ristretta ai referrer del sito (fatto dall'utente).
- GitHub: Pages attivo da `main`. Secret creati: `FIREBASE_SERVICE_ACCOUNT` e (probabilmente) `VAPID_SUBJECT`. **Manca `VAPID_PRIVATE_KEY`**: si crea dopo aver generato le chiavi nell'app (Impostazioni → Notifiche → Programma notifiche della casa → Genera chiavi), poi lanciare una volta il workflow "Notifiche e backup".
- Repo ora **pubblico** in attesa dell'approvazione GitHub Pro/Education (poi si potrà rendere privato: Pages continua a funzionare).
- L'obbligo di notifiche su mobile scatta solo se `house.vapidPublic` esiste.

## Requisiti espressi dall'utente (riassunto, da rispettare)
- Accesso senza login: l'admin crea la casa e genera **codice/link**; chi entra sceglie "chi sei" (modificabile). **Codice cambiabile** quando un coinquilino esce, senza perdere dati; uscita spesso "non nota" (campo `to` vuoto + `expectedTo` indicativo).
- **Admin** con più funzioni; **cambio admin** possibile; l'admin è visibile a tutti. **Regole obbligatorie da leggere al primo accesso** (non richiederle a ogni rientro).
- **Notifiche**: venerdì "segna se sei via", sabato "cosa ti tocca", domenica "segna fatto", **da lunedì solleciti fino a 3 al giorno** se in ritardo; promemoria giorno scelto; spesa aggiunta/comprata; richieste/sostituzioni. Su **mobile obbligatorie**; controllo dello stato a ogni apertura. Tutto configurabile.
- **Tutto impostabile** da Impostazioni (funzioni on/off, Home personalizzabile per dispositivo e predefinita per tutti, colore accento personale/di casa, lingua IT/EN, link rapidi tipo Tricount, fatica per mansione, penalità, ecc.).
- **IA opzionale solo admin**, API key salvata solo sul dispositivo, provider selezionabile; **una sola funzione** utile (importa assenze/risultati da testo). Non aggiungerne altre senza reale necessità.
- **Checklist**: sub-task per mansione, settimanali + "ogni X settimane" (si sommano), disattivabili per mansione e per voce. **Chi segna "fatto" deve aver spuntato tutto**, altrimenti viene segnalato "incompleto". Una voce non fatta **scala alla settimana dopo e tocca a chi non l'ha fatta se è a casa**; se poi si assenta → **piccola penalità** (`settings.taskPenalty`).
- **"Fatto" annullabile** (ricliccare / toast Annulla). **Volontari** (fare un turno non proprio) segnalati. **Sostituzioni**: chiesta/offerta con consenso, **"con recupero"** (regole del foglio) oppure **"regalo"** (nessun debito, scambio concordato); l'admin può scegliere chi fa un turno scoperto; **ritardo annunciato** ("pulirò il…").
- **Compiti condivisi** (es. spazzatura) con suggerimento equo di chi tocca. **Lista della spesa** con pulsante rapido in Home e notifiche.
- Export dati (JSON/CSV/Excel), messaggio WhatsApp della settimana, `.ics`, statistiche, registro accessi/visualizzazioni (chi apre l'app e quando), dispositivi e notifiche attive per persona, avviso "aggiorna la pagina" dopo 5 minuti.
- Installazione: l'invito chiede di installare l'app; su iPhone **solo Safari**.
- Utente sensibile ai **limiti d'uso**: lavora per blocchi piccoli, commit e push frequenti.

## Come lavorare
```bash
npm test                                   # test unitari/integrazione (111)
node tests/e2e/smoke.e2e.mjs               # ogni rotta si apre senza errori (mobile+desktop, IT/EN, chiaro/scuro)
node tests/e2e/<modulo>.e2e.mjs            # e2e per modulo (home, calendar, flow, more2, shared, settings, trips-stats, onboarding-more, admin-install)
python3 -m http.server 8080                # prova in locale
```
- **Playwright/Chromium sono preinstallati** nell'ambiente cloud (`require('playwright')`); non reinstallare.
- **Emulatore Firestore**: `npm i firebase-tools@13` in una cartella a parte, `firebase.json` con `{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"host":"127.0.0.1","port":8080},"ui":{"enabled":false},"singleProjectMode":true}}`, avvio `firebase emulators:start --only firestore --project tidyhouse-ef92b`; poi `node tests/e2e/cloud-emulator.e2e.mjs`. L'app accetta `?emu=127.0.0.1:8080` (solo host locali).
- **Parità con Excel**: `tests/make_scenarios.py` + `tests/run_xl_scenarios.sh` (LibreOffice; nota: `MAXIFS` va scritto `_xlfn.MAXIFS`; LibreOffice ha un'anomalia nella *prima riga* con "Everyone": non è un bug del motore).
- Stringhe: ogni modulo ha `js/strings/<modulo>.js` (IT+EN) registrato con `registerStrings`; `tests/strings.test.mjs` verifica allineamento e assenza di duplicati. Tutto il testo visibile passa da `t()`.
- Dopo ogni modifica: `npm test`, smoke e gli e2e dei moduli toccati, **commit e push**. `VERSION` (in `sw.js` e `js/app.js`) si alza solo in un commit `Release x.y.z`. **Dopo aver rimosso o rinominato codice cerca i riferimenti rimasti (grep): `node --check` non basta** (una chiamata a una funzione rimossa è già arrivata in produzione).
- Nei test e2e aspetta ~400 ms tra due click vicini sullo stesso punto: l'app ignora il secondo (anti doppio tocco).
- Il repository è **pubblico**: mai codici casa, chiavi o JSON di account di servizio nei commit o nei log (i log del server usano «casa N»).
- Non fare operazioni distruttive su Firebase/GitHub dell'utente senza chiedere. Non committare mai il JSON dell'account di servizio.

## Mappa del codice
| Percorso | Ruolo |
|---|---|
| `js/engine.js` | Motore turni (puro). **Non cambiare la logica di assegnazione.** |
| `js/extras.js` | Checklist (+responsabili/arretrati), statistiche, WhatsApp, `.ics`, notifiche (`planNotifications`), compiti condivisi |
| `js/store.js`, `js/actions.js` | Backend, permessi, operazioni (completeChore, undoResult, volunteer, requestCover/offerCover/answerCover, setDelay, shared…, rotateCode, changeAdmin) |
| `js/app.js` | Avvio, router, shell, gate (chi sei, regole, notifiche), registro dispositivi/ingressi, refresh prompt |
| `js/ui.js`, `css/app.css` | Componenti (sheet, toast con azione, icone), stile base |
| `js/screens/*.js`, `js/choresheet.js` | Schermate |
| `js/push.js`, `sw.js` | Web Push client e service worker |
| `js/ai.js`, `js/ai-ui.js` | IA opzionale (OpenAI/Anthropic/Gemini) |
| `scripts/*`, `.github/workflows/notify.yml` | Server notifiche e backup cifrato |
| `vendor/` | Firebase SDK, SheetJS 0.18.5 (solo lettura/scrittura xlsx dell'admin), generatore QR |
