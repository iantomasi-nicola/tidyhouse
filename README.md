# Tidy House 🧹

Turni di pulizia di casa, equi e senza discussioni. Nata da un foglio Excel (*House Cleaning Plan*) e trasformata in una web app
installabile (PWA) per **GitHub Pages**: gira su telefono, tablet e PC, sincronizza i coinquilini in tempo reale e manda le notifiche.

- **Turnazione identica alle regole del foglio**: chi non pulisce una mansione da più tempo la fa; recuperi, riposi, restituzione diretta,
  regola delle 3 notti, TR/CDM. Il motore è stato confrontato riga per riga con le formule dell'Excel su centinaia di scenari.
- **Niente login**: l'admin crea la casa e genera un **codice/link**; chi entra sceglie chi è tra i coinquilini (si può cambiare quando si vuole).
- **Notifiche**: venerdì "segna se sei via", sabato "cosa ti tocca", domenica "segna fatto", da lunedì solleciti (fino a 3 al giorno) se sei in ritardo. Tutto configurabile.
- **Tutto impostabile**: funzioni attivabili/disattivabili, Home personalizzabile, lingua IT/EN, tema, link rapidi (Tricount), fatica per mansione…
- **IA opzionale, solo admin**: importa assenze e risultati da un messaggio e può proporre chi fa cosa in una settimana (sempre con anteprima prima/dopo); la tua API key resta sul tuo dispositivo.

## Funzioni principali

- **Checklist per mansione**: sotto-attività settimanali o «ogni X settimane» (si sommano), disattivabili per mansione e per voce. Chi segna «fatto» deve aver spuntato tutto, altrimenti il turno risulta *incompleto*.
  Una voce non fatta **scala alla settimana dopo** e tocca a chi non l'ha fatta (se è a casa); se poi si assenta riceve una **piccola penalità** in punti fatica (*Impostazioni → Regole dei turni*).
- **«Fatto» annullabile** (toast con *Annulla*) e **volontari**: chi pulisce un turno non suo viene segnalato.
- **Sostituzioni**: chiedi o offri di fare un turno, l'altro deve accettare. Due modi: **con recupero** (valgono le regole del foglio: chi salta recupera, chi sostituisce riposa) oppure **regalo** (un favore: il turno passa e nessuno ha debiti). L'admin può scegliere chi fa un turno scoperto.
- **«Non posso questa settimana»**: un tasto sul tuo turno. L'app sceglie **da sola il sostituto** (come se tu non ci fossi) e tu lo recuperi dopo, senza trattative.
- **Ritardo annunciato**: «pulirò il…» ferma i solleciti fino a quel giorno e ti ricorda proprio quel giorno.
- **Compiti condivisi** (es. la spazzatura): cose da fare ogni tanto, senza turno fisso; l'app suggerisce chi tocca in modo equo (chi l'ha fatto meno di recente). Si trovano in *Altro*.
- **Assegnazione manuale della settimana** (admin): dal foglio della settimana, **Assegna la settimana** sostituisce il calcolo automatico solo per quella settimana (come le celle grigie del foglio), con anteprima e *Annulla*.
  Con l'IA attiva le assegnazioni possono anche essere proposte da un testo, sempre con anteprima «prima → dopo» da confermare.
- **Spesa veloce**: pulsante in Home, aggiunta di voci una dopo l'altra, suggerimenti delle voci frequenti, incolla di più righe, tocco sulla riga = comprato (con *Annulla*), sezione *Comprate* richiudibile. Notifiche a chi serve.
- **Azioni dalle notifiche**: *Segna fatto* (quando hai un solo turno da segnare) e *Accetta/Rifiuta* una sostituzione direttamente dalla notifica, senza aprire l'app.
- Export JSON (anche cifrato), CSV ed Excel, messaggio WhatsApp della settimana, `.ics`, statistiche, registro attività.

---

## Cosa serve (tutto gratuito)

1. Un account GitHub (qui il repo) e **GitHub Pages**.
2. Un progetto **Firebase** (piano Spark, senza carta) per condividere i dati tra i dispositivi.
3. Per le notifiche: **GitHub Actions** (già incluso) che ogni ora controlla chi deve essere avvisato.

Senza Firebase l'app funziona comunque in **modalità locale** (un solo dispositivo, nessuna notifica) — utile per provarla.

## 1. Pubblica su GitHub Pages

1. Nel repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
2. Dopo circa un minuto l'app è su `https://<utente>.github.io/<repo>/`.
3. Repo privato? Pages da repo privato richiede GitHub Pro (gratis con GitHub Education). Il sito pubblicato resta raggiungibile da chi ha il link; i dati stanno su Firebase dietro al codice casa.

## 2. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → **Aggiungi progetto** (Analytics non serve).
2. **Build → Firestore Database → Crea database**: edizione Standard, posizione europea, modalità produzione.
3. Scheda **Regole**: incolla il contenuto di [`firestore.rules`](firestore.rules) e **Pubblica**.
4. **Panoramica → Aggiungi app → Web (`</>`)**, nickname a piacere, *senza* Firebase Hosting. Copia `firebaseConfig`.
5. Incolla quei valori in [`config.js`](config.js) (sono pubblici per le app web) e fai commit.
6. *(Consigliato)* In [Google Cloud → API e servizi → Credenziali](https://console.cloud.google.com/apis/credentials) apri la **Browser key** e in "Restrizioni delle applicazioni" scegli **Siti web** → aggiungi `https://<utente>.github.io/*`.

> **Sicurezza, in chiaro**: non c'è un vero login. L'accesso a una casa è protetto dal **codice casa** (12 caratteri, ~60 bit, non elencabile) e il PIN admin protegge i controlli admin *dentro l'app*, non il database.
> Condividi il codice solo con chi abita con te. Quando un coinquilino se ne va, usa **Impostazioni → Invito → Genera nuovo codice**: copia tutto in una nuova casa e il vecchio link smette di funzionare.

### Repository pubblico: cosa non committare mai

Il repository (e quindi il suo storico, le Actions e i log) è **pubblico**: chiunque può leggerlo.
- **Mai committare** codici casa, link d'invito, chiavi (`VAPID_PRIVATE_KEY`, API key dell'IA), il JSON dell'account di servizio, token GitHub, dati reali dei coinquilini. Usa solo i **secret** di GitHub.
- I **log** delle Actions mostrano soltanto conteggi («casa N»), mai codici casa.
- I **backup cifrati** in `backups/` hanno come nome un'**impronta** del codice (SHA-256 troncato), non il codice, e il contenuto è illeggibile senza `BACKUP_PASSPHRASE`: conservala altrove, senza non si ripristinano.
- Il token per l'avvio immediato ha il solo permesso *Actions: Read and write* su questo repository e si revoca da GitHub in qualsiasi momento.
- Se un codice è finito per sbaglio in un posto pubblico, usa subito **Genera nuovo codice**.

## 3. Notifiche push

Funzionano con Web Push standard (Android, desktop e iPhone con iOS ≥ 16.4 **dopo aver aggiunto l'app alla schermata Home**, aperta da Safari).

### Come attivarle

1. In **Firebase → Impostazioni progetto → Account di servizio → Genera nuova chiave privata** (scarica un JSON; **non** metterlo nel repo).
2. Apri l'app come admin: **Impostazioni → Notifiche → Programma notifiche della casa → Genera chiavi** e copia la chiave privata mostrata (si vede una volta sola).
3. Nel repo: **Settings → Secrets and variables → Actions → New repository secret**:

   | Secret | Valore |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | l'intero contenuto del JSON |
   | `VAPID_PRIVATE_KEY` | la chiave privata generata nell'app |
   | `VAPID_SUBJECT` | `mailto:un-indirizzo@esempio.it` |
   | `BACKUP_PASSPHRASE` *(facoltativo)* | una frase lunga: attiva il backup settimanale **cifrato** in `backups/` |

4. Scheda **Actions** → abilita i workflow → **Notifiche e backup → Run workflow** per provare.
5. Ogni coinquilino: **Impostazioni → Notifiche → Attiva** (su telefono è richiesto quando l'admin ha configurato le chiavi).

**Più case con lo stesso server**: il server controlla tutte le case del progetto Firebase con la stessa chiave privata. Se hai già una chiave, in *Programma notifiche della casa* incolla la **chiave pubblica esistente** invece di generarne un'altra: così più case condividono lo stesso server e gli stessi secret (la chiave pubblica non è segreta).
Una casa con una chiave pubblica diversa da quella del server viene saltata (nel log: «chiave VAPID diversa»). Generare nuove chiavi per una casa che ne ha già una invalida le registrazioni esistenti: l'app chiede conferma.

### Perché a volte arrivano in ritardo

Il server **non è sempre acceso**: è una GitHub Action che gira **una volta all'ora** (al minuto 7) e GitHub può ritardarla di alcuni minuti. Le notifiche programmate partono quindi alla prima esecuzione dopo l'orario scelto e non vengono mai duplicate.
Per avvisi che devono essere subito (nuova voce nella spesa, richiesta di sostituzione) puoi attivare l'**avvio immediato**:

1. Su GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access*: solo questo repository. *Permissions → Repository permissions → Actions: Read and write*. Nessun altro permesso.
3. Nell'app (admin): **Impostazioni → Notifiche → Notifiche immediate**, incolla il token (inizia con `github_pat_`) e premi *Prova ora*.

Da quel momento chi aggiunge una voce alla spesa o chiede una sostituzione fa partire il server subito (circa 30 secondi). Il token può solo avviare il workflow delle notifiche di questo repository, ma è salvato nella casa e lo possono leggere i coinquilini: se lo revochi su GitHub, le notifiche tornano orarie.

### Come verificare che funzionino

- **Nell'app**: *Impostazioni → Notifiche → Diagnostica e prove* dice se questo dispositivo è registrato sul server, da quanto il server non gira e permette di **Riparare la registrazione**; l'admin può inviare una **notifica di prova a tutti** (parte dal server, quindi non è istantanea).
- **Su GitHub**: scheda **Actions → Notifiche e backup** → apri l'ultima esecuzione. Se i secret mancano, il job lo scrive come avviso senza fallire.
- **Nei log** compaiono **solo conteggi** (`[casa 1] …`, `[casa 2] …`): mai il codice della casa né i nomi, perché il repository è pubblico e i log li legge chiunque.

Usa circa 1 minuto di Actions all'ora (~720/mese): ampiamente dentro i limiti gratuiti anche per un repo privato con GitHub Pro.

## 4. Primo avvio

1. Apri l'app → **Crea una nuova casa**: nome, prima settimana, coinquilini, PIN admin.
   Puoi **importare il tuo foglio Excel** (coinquilini, assenze e risultati).
2. **Impostazioni → Invito**: copia il link o mostra il QR e mandalo ai coinquilini.
3. Chi entra sceglie il proprio nome, legge le regole (obbligatorio la prima volta) e può attivare le notifiche.

## Come funziona la turnazione (in breve)

Ogni settimana (lun–dom) vengono assegnati Pavimenti, Bagno, Cucina. Si pulisce ciò che non si pulisce da più tempo o ciò che si deve recuperare.
4 persone: una riposa · 3: una mansione a testa · 2: chi non fa i pavimenti da più tempo li fa, l'altro Bagno+Cucina · 1: tutto.
Se dormi a casa meno di 3 notti (lun–dom) sei assente. Salti un turno → recupero (+ CDM); qualcuno pulisce per te → recupero per te, riposo per lui;
la restituzione è diretta la prima settimana in cui siete entrambi a casa. Tutte le regole sono nell'app (*Altro → Regole della casa*) e modificabili dall'admin.

La **fatica** per mansione (1–5) si imposta in *Impostazioni → Regole dei turni* e serve a statistiche e "punti fatica": **non cambia chi viene assegnato**.

## Per chi continua lo sviluppo

Leggi [`HANDOFF.md`](HANDOFF.md) (stato e requisiti), [`TODO.md`](TODO.md) (cosa fare, a partire dall'audit di usabilità) e [`AGENTS.md`](AGENTS.md).

## Sviluppo e test

```bash
npm test                              # motore, dati, notifiche, import/export, IA, traduzioni
node tests/e2e/smoke.e2e.mjs          # ogni rotta si apre senza errori (mobile+desktop, IT/EN, chiaro/scuro)
npm run check                         # = npm test + smoke test: da lanciare prima di ogni commit
npm run e2e                           # TUTTI i test end-to-end, uno alla volta, con riepilogo finale
npm run e2e -- --only smoke,foreground   # solo alcuni (nome del file senza .e2e.mjs)
npm run e2e -- --skip settings,home      # tutti tranne alcuni
node tests/e2e/home.e2e.mjs           # un solo modulo
python3 -m http.server 8080           # prova in locale: http://localhost:8080
```

- I test e2e usano Playwright (Chromium). **Non lanciarli in parallelo** (orologio finto e risorse del browser danno falsi errori): `npm run e2e` li esegue in sequenza, con un tempo massimo di 400 s per file (`--timeout <secondi>`) e codice di uscita 1 se qualcosa fallisce.
- `cloud-emulator` richiede l'emulatore di Firestore (vedi `HANDOFF.md`): `npm run e2e` lo salta; per provarlo `npm run e2e -- --only cloud-emulator`.
- Alcune parti usano il foglio Excel originale se indicato con `XLSX_FILE=<percorso>`; senza, vengono saltate con un messaggio.
- Nei test, l'app ignora un secondo tocco sullo stesso pulsante entro 350 ms (anti doppio tocco): tra due click vicini aspetta 400 ms.
- **CI**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) esegue `npm test` e lo smoke test su ogni push e pull request verso `main` (Playwright è una devDependency con versione fissata; il runner installa Chromium con `npx playwright install --with-deps chromium`). Il workflow delle notifiche (`notify.yml`) installa solo le dipendenze di produzione.

- `js/engine.js` — motore dei turni (porting delle formule del foglio). `tests/fixtures/` contiene scenari ricalcolati con l'Excel originale (via LibreOffice).
- `js/extras.js` — checklist ricorrenti, statistiche, WhatsApp, `.ics`, programmazione notifiche.
- `js/store.js`, `js/actions.js` — dati (locale/cloud), permessi, rotazione del codice.
- `js/screens/*` — schermate; `scripts/` — server notifiche (GitHub Actions); `sw.js` — service worker.
- Architettura e contratti tra moduli: [`ARCHITECTURE.md`](ARCHITECTURE.md).

Le librerie esterne sono incluse in `vendor/` (Firebase Web SDK, SheetJS 0.18.5 solo per leggere/scrivere `.xlsx` caricati dall'admin, generatore QR).
