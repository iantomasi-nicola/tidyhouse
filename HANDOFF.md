# HANDOFF — leggi questo per primo

Documento di passaggio per chi (altra IA o persona) continua il lavoro. Lingua con l'utente: **italiano**. L'utente è uno studente che gestisce una casa con altri coinquilini; vuole un'app **realmente usabile**, sobria, che faccia **risparmiare tempo** e non metta frizione.
La lista di cose da fare, in ordine di priorità, è in [`TODO.md`](TODO.md). Le regole del progetto e i contratti tra moduli sono in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Cos'è
**Tidy House**: PWA statica (GitHub Pages) per i turni di pulizia di una casa, nata dal foglio Excel *House Cleaning Plan* (il foglio originale è la fonte di verità delle regole). Vanilla JS ES modules, **nessuna build**. Dati condivisi su **Firebase Firestore** (piano gratuito), notifiche con **Web Push** inviate da una **GitHub Action** oraria. UI in **italiano e inglese**.

- Repo: `iantomasi-nicola/tidyhouse` (branch `main`, Pages da `main` / root). Sito: `https://iantomasi-nicola.github.io/tidyhouse/`.
- Firebase: progetto `tidyhouse-ef92b` (config web già in `config.js`; è pubblica per natura). Regole in `firestore.rules`.
- Nome app: "Tidy House". Colore predefinito `#1a73e8`. Stile: **Apple minimale + Material (Google)**, colori Material, **niente gradienti, niente scintille, niente effetto "IA"**, forme arrotondate, tipografia grande, movimento sobrio.

## Stato (cosa è fatto e verificato)
- **Motore dei turni** (`js/engine.js`): porting fedele delle formule dell'Excel (rotazione, recuperi, riposi, restituzione diretta, 3 notti, TR/CDM). Verificato: 0 differenze su 36 scenari casuali ricalcolati con LibreOffice + file reale (`tests/fixtures`, `tests/run_xl_scenarios.sh`, `tests/make_scenarios.py`). La turnazione **non va cambiata** (l'utente: "deve essere come nelle regole").
- **Dati/cloud** (`js/store.js`, `js/actions.js`): backend memoria/locale/Firestore con interfaccia unica; permessi; codice casa (12 caratteri, = id del documento) con **rotazione** (copia tutto in un nuovo id e cancella il vecchio); cambio admin con "epoca"; PIN admin (PBKDF2).
- **Verificato con l'emulatore ufficiale di Firestore** (`tests/e2e/cloud-emulator.e2e.mjs`): creazione casa, join da link, 2 dispositivi in sync, regole (elenco vietato / get consentito), rotazione codice, eliminazione.
- **Schermate** (`js/screens/*`, `js/choresheet.js`): onboarding (landing/crea/entra/chi sei/regole obbligatorie), Home a widget personalizzabile, calendario, assenze/viaggi, classifica/statistiche, Altro (spesa, regole, ultimo che esce, checklist ricorrenti, richieste, registro attività, compiti condivisi, guida installazione), Impostazioni (15 sezioni), flusso turno (gate checklist, annulla, volontari, sostituzioni con recupero/regalo, ritardo annunciato).
- **Notifiche**: logica in `js/extras.js` (`planNotifications`) + server in `scripts/notify-core.mjs` / `scripts/notify.mjs` + workflow `.github/workflows/notify.yml`. Testato con DB e sender finti.
- **Test**: `node --test tests/*.test.mjs` → **111 verdi**. E2E Playwright per modulo in `tests/e2e/*.e2e.mjs` (usano `tests/e2e/helpers.mjs`: server statico, `seed()`, orologio finto).

## Cosa NON è stato verificato (rischio reale)
1. **Notifiche push reali su telefono** (Android/iPhone). Il browser di test non può registrarsi al servizio push. Va provato su dispositivi veri.
2. **Schermata notifiche obbligatorie su mobile** (gate): testata solo per sintassi/logica, non su telefono.
3. **Aspetto su telefono vero** (solo screenshot/emulazione Playwright).
4. Il **QA di usabilità non è stato completato** (vedi `TODO.md` §1): è il prossimo lavoro principale.
5. `tests/e2e/settings.e2e.mjs` e `tests/e2e/onboarding-more.e2e.mjs`: risultato non confermato dopo le ultime modifiche (lo scenario "tasks: CRUD…" ha una race nel test: aggiungere `await page.waitForFunction(() => !document.querySelector('.sheet'))` dopo il primo "Salva"). Rilanciarli e sistemarli.

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
- Dopo ogni modifica: test verdi, **commit e push** (Pages si aggiorna in 1–2 minuti; il service worker `sw.js` va rialzato di `VERSION` se cambiano asset).
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
