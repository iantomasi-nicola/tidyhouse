# Tidy House 🧹

Turni di pulizia di casa, equi e senza discussioni. Nata da un foglio Excel (*House Cleaning Plan*) e trasformata in una web app
installabile (PWA) per **GitHub Pages**: gira su telefono, tablet e PC, sincronizza i coinquilini in tempo reale e manda le notifiche.

- **Turnazione identica alle regole del foglio**: chi non pulisce una mansione da più tempo la fa; recuperi, riposi, restituzione diretta,
  regola delle 3 notti, TR/CDM. Il motore è stato confrontato riga per riga con le formule dell'Excel su centinaia di scenari.
- **Niente login**: l'admin crea la casa e genera un **codice/link**; chi entra sceglie chi è tra i coinquilini (si può cambiare quando si vuole).
- **Notifiche**: venerdì "segna se sei via", sabato "cosa ti tocca", domenica "segna fatto", da lunedì solleciti (fino a 3 al giorno) se sei in ritardo. Tutto configurabile.
- **Tutto impostabile**: funzioni attivabili/disattivabili, Home personalizzabile, lingua IT/EN, tema, link rapidi (Tricount), fatica per mansione…
- **IA opzionale, solo admin**: una sola funzione ("importa assenze e risultati da un messaggio"), con la tua API key che resta sul tuo dispositivo.

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

## 3. Notifiche push

Funzionano con Web Push standard (Android, desktop e iPhone con iOS ≥ 16.4 **dopo aver aggiunto l'app alla schermata Home**).

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
5. Ogni coinquilino: **Impostazioni → Notifiche → Attiva**.

Il controllo gira ogni ora (GitHub può ritardare di qualche minuto): le notifiche partono alla prima esecuzione dopo l'orario scelto e non vengono mai duplicate.
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
npm test                       # motore, dati, notifiche, import/export, IA, traduzioni
node tests/e2e/home.e2e.mjs    # test end-to-end con Playwright (Chromium), uno per modulo
python3 -m http.server 8080    # prova in locale: http://localhost:8080
```

- `js/engine.js` — motore dei turni (porting delle formule del foglio). `tests/fixtures/` contiene scenari ricalcolati con l'Excel originale (via LibreOffice).
- `js/extras.js` — checklist ricorrenti, statistiche, WhatsApp, `.ics`, programmazione notifiche.
- `js/store.js`, `js/actions.js` — dati (locale/cloud), permessi, rotazione del codice.
- `js/screens/*` — schermate; `scripts/` — server notifiche (GitHub Actions); `sw.js` — service worker.
- Architettura e contratti tra moduli: [`ARCHITECTURE.md`](ARCHITECTURE.md).

Le librerie esterne sono incluse in `vendor/` (Firebase Web SDK, SheetJS 0.18.5 solo per leggere/scrivere `.xlsx` caricati dall'admin, generatore QR).
