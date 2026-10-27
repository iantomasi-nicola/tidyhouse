# Audit di usabilità · nucleo dell'app e percorsi trasversali (UX-C)

Perimetro: `js/app.js`, `js/ui.js`, `css/app.css`, `js/actions.js` e `js/extras.js` (solo aggiunte), `js/screens/onboarding.js`, `css/onboarding.css`, `js/strings/uxc.js`.
Metodo: lettura del codice, simulazione con Playwright (390×844 touch, 320/768/1440 px, IT/EN, chiaro/scuro/automatico, testo 100% e 130%, `prefers-reduced-motion`), orologio finto, due dispositivi simulati con `store.setDoc`. Ogni difetto ha un controllo in `tests/e2e/ux-c.e2e.mjs` (marcato `[DIFETTO]`) che **falliva prima** della correzione (log «prima»: 41 controlli falliti) e oggi passa; la logica pura ha test in `tests/ux-core.test.mjs`.

Gravità: A = blocca/inganna, M = fa perdere tempo, B = rifinitura.

## Difetti noti del TODO §1

| # | Gravità | Dove | Passi per riprodurre | Soluzione | Stato |
|---|---|---|---|---|---|
| 1 | M | Toast (`js/ui.js`) | 5 messaggi di fila → fino a 3 toast impilati; un «Annulla» finiva coperto da un messaggio semplice | **Un solo toast alla volta.** Un toast nuovo sostituisce quello visibile; un toast con «Annulla» sostituisce subito uno semplice; un messaggio semplice che arriva mentre c'è un «Annulla» aspetta in coda (max 2) e l'azione resta ancora al massimo 2 s (poi compare il messaggio): l'«Annulla» non è mai coperto. Il toast «nuova versione» è a bassa priorità (`opts.low`): un errore lo sostituisce. Stesso messaggio ripetuto = un solo toast | corretta |
| 2 | M | Contrasto di `.toast-action` | «Annulla» = accento mescolato al 70% con lo sfondo, su un toast semi-trasparente | Toast opaco; colore dell'azione `--toast-act` = accento schiarito (tema chiaro) o scurito (tema scuro) in misura fissa → contrasto ≥ 4,5:1 con **qualsiasi** accento (provati blu, giallo, verde, bianco, nero); pulsante alto 36 px con area di tocco 44 px | corretta |
| 3 | A | Rerender a cascata (`js/app.js`) | Aggiornamenti remoti ogni 50 ms mentre il dito è su «Segna fatto»: il nodo sotto il dito viene sostituito, `pointerup` cade su un nodo nuovo e **il click si perde** | (a) I render aspettano il rilascio del dito (`pointerdown` dentro la pagina → rimandati, ripartono 90 ms dopo `pointerup`/`pointercancel`, sicurezza a 2,5 s); (b) **la Home non viene rimontata se il DOM prodotto è identico a quello montato** (confronto di HTML + valori dei campi, solo se il nodo montato è intatto) → gli aggiornamenti invisibili (accessi, dispositivi, `views`) non toccano più la pagina | corretta |
| 4 | B | `renderApp` rimonta sempre | Pagina Spesa persistente | Già gestita nel codice (`node.parentNode === mainEl`): verificata da test (nodo non rimontato né duplicato). In più la Home identica non si rimonta (punto 3) | già ok + estesa |
| 5 | M | `ctx.badges().more` | Con la funzione «richieste» spenta il nav mostrava un numero e l'hub nessuna riga; senza settimana in corso il nav 0 e l'hub 1; le richieste su settimane chiuse contavano nel nav | Calcolo in `js/extras.js` (`requestsAwaiting`, `isRequestStale`) con la stessa regola di `awaitingMe()`/`isStale()` di `more.js`: fuori da `o.cur >= 0`, zero se la funzione è spenta, senza richieste su settimane chiuse; **somma anche i compiti condivisi «tocca a te»** (stesso conteggio di «Da fare ora»). Test: 9 casi nav = hub | corretta |
| 6 | M | Richieste su settimane vecchie non scadono | `cover`/`offer`/scambio `pending` su settimane chiuse restavano per sempre | `Actions.expireStaleRequests()` (`js/actions.js`): le `pending` su settimane chiuse da **più di 14 giorni** vengono **tolte**, in una sola scrittura (batch), solo se ce ne sono, **solo da un admin**, all'apertura e al rientro in primo piano; idempotente. Prima dei 14 giorni restano nella sezione «Scadute» di UX-B, fuori dai badge. `answerCover` risponde `Error('expired')` su settimana chiusa o richiesta scaduta | corretta (vedi nota) |
| 7 | M | Nessun selettore lingua in landing | Telefono in inglese ma si vuole l'italiano (o viceversa) prima di creare/entrare | Selettore IT/EN (44 px) in **landing, nuova casa, chi sei**: cambia subito, si ricorda (`prefs.lang`), la casa nasce nella lingua scelta; nella creazione il nome digitato resta e il nome proposto segue la lingua | corretta |
| 8 | M | `beforeinstallprompt` (Chrome Android) | L'evento arriva dopo il disegno della landing: il pulsante «Installa» non compariva (e dopo l'uso restava) | Il pulsante si aggiunge all'invito già visibile quando arriva l'evento, parte dall'evento catturato, sparisce dopo la scelta (l'evento non è riutilizzabile) e `appinstalled` toglie l'invito. Provato con eventi finti | corretta |
| 9 | M | iPhone fuori da Safari | Link d'invito aperto da Chrome/Firefox/WhatsApp/Instagram: avviso lungo e senza azione («copia questo link…» ma nessun pulsante); i browser interni (senza `Safari/` nello user agent) non erano riconosciuti | Titolo «Apri questa pagina in Safari», una frase, **pulsante «Copia il link»** (link completo col codice) con toast di conferma; riconosciuti Chrome/Firefox/Edge/Opera/DuckDuckGo/app Google e i browser interni. Stesso avviso nella schermata notifiche obbligatorie | corretta |

Nota sul punto 6: l'incarico iniziale prevedeva lo stato `expired` dopo 7 giorni; su indicazione del coordinatore (UX-B ha già una sezione «Scadute» con pulizia manuale e il suo `statusChip` non conosce `expired`, che comparirebbe come «In attesa» nello storico) si è scelta la **pulizia a 14 giorni con cancellazione**, e dal giorno 1 le richieste su settimane chiuse sono comunque fuori dai badge e non accettabili. La soglia è il parametro `days` di `expireStaleRequests`.

## Audit trasversale

| # | Gravità | Percorso | Cosa ho verificato | Esito |
|---|---|---|---|---|
| A | A | Click perso sotto aggiornamenti remoti | Vedi punto 3: 9 render durante una pressione di 600 ms, click perso → 1 (aggiornamenti invisibili) / 4 (visibili, tutti dopo il rilascio), click sempre ricevuto | corretto |
| B | M | Caricamento della Home | La Home si disegnava due volte in ~100 ms (la classe d'ingresso `hm-enter` spariva al secondo disegno): rimontaggio e animazione interrotta; faceva anche fallire a caso `refresh.e2e` (≈1 volta su 6, il pulsante spariva tra attesa e misura) | corretto: un solo montaggio, `refresh.e2e` 8/8 |
| C | M | Avatar | Testo bianco su colori chiari (es. arancio): 4,1–4,3:1 | `inkOn()`: testo bianco o quasi nero col contrasto migliore | corretto |
| D | — | Primo avvio da link su telefono | Link con codice non valido, codice troppo corto, servizio non raggiungibile (rete assente): messaggio comprensibile, si può riprovare o correggere il codice, nessun overflow | ok |
| E | — | Casa cloud salvata ma irraggiungibile | Schermata «offline» con nome della casa e «Riprova» | ok |
| F | — | Rientro dopo giorni | Spostando l'orologio di 18 giorni e tornando in primo piano: pulizia delle richieste vecchie (admin), nessun errore | ok |
| G | — | Back del browser con sheet aperti | Due sheet: il 1° «indietro» chiude solo quello sopra, il 2° l'altro, il 3° torna alla pagina precedente; ricarica con uno sheet aperto: stessa pagina, nessuno sheet | ok |
| H | — | Scroll in «indietro» | Pagina lunga (Impostazioni › Funzioni): 400 → 400 px | ok. Il **calendario** no (420 → 935 px: ricentra sulla settimana corrente) — `js/screens/calendar.js`, non mio |
| I | — | Tema chiaro/scuro/auto × testo 100%/130% × 320/390/768/1440 px | Landing: 0 overflow, 0 controlli < 40 px; app (Home, Calendario, Altro, Impostazioni): 0 overflow, nav dentro lo schermo | ok |
| J | — | `prefers-reduced-motion` | Toast e sheet senza animazione reale (< 10 ms); con movimento normale 400/380 ms | ok |
| K | — | Layout shift e long task per rotta | 28 rotte × (390, 1440 px): CLS totale 0,0000, 0 long task; nessun errore in console | ok (anche **prima**: 0 — nessun miglioramento da fare) |
| L | — | Doppio tocco, banner «aggiorna», gate notifiche | `refresh`, `push-gate`, `do-actions`, `foreground` verdi; il gate e il routing `#/do` non sono stati modificati | ok |

### Segnalazioni fuori dal mio perimetro (`usability.e2e`, WARN che restano)
- **Contrasto AA** (file di UX-A/UX-B): `Ha pulito qualcun altro` (4,14:1), `Anche questa settimana` (4,3), `· Recupero` (3,48) in Home; lista widget disattivati in Impostazioni › Home (2,25–4,49); «Cancella tutti i dati» (3,56 scuro). Il contrasto degli avatar (`div.av` in Regole) è stato corretto qui.
- **Tap target < 44 px**: «Vedi i dati» (`summary` in Statistiche, 32 px), indirizzo nell'invito desktop (43 px). «Installa l'app» in Impostazioni l'ha già sistemato UX-B.
- **Calendario**: la posizione di scroll non viene ripristinata con «indietro» (vedi H). Inoltre `calendar.js` tiene `prevNode` (il nodo dell'ultimo render) per capire se è una «nuova visita»: per questo il salto del rimontaggio vale **solo per la Home** (con altre schermate il calendario azzerava lo storico mostrato).

## Metriche prima → dopo

| Misura | Prima | Dopo |
|---|---|---|
| Toast visibili insieme (5 messaggi di fila) | 3 (poi 1 per timer) | 1 |
| «Annulla» coperto da un messaggio semplice | sì | mai |
| Contrasto «Annulla», tema chiaro, accento predefinito | 3,10:1 | 10,5:1 |
| Contrasto «Annulla», tema scuro, accento predefinito | 4,34:1 | 12,3:1 |
| Contrasto «Annulla», caso peggiore (accento bianco/nero/giallo, 4 combinazioni di tema) | 1,18:1 | ≥ 7,9:1 |
| Altezza del pulsante «Annulla» | 28 px | 36 px (area di tocco 44 px) |
| Render montati in 600 ms di pressione con aggiornamenti remoti ogni 50 ms | 9 | 1 (invisibili) / 4 (visibili, dopo il rilascio) |
| Click su «Segna fatto» sotto aggiornamenti ogni 50 ms | perso | ricevuto (2 su 2 scenari) |
| Montaggi della Home al caricamento | 2 | 1 |
| Render per l'azione «Segna fatto» | 1 | 1 |
| Badge nav ≠ hub (casi provati su 9) | 2 | 0 |
| Layout shift totale su 28 rotte (390 e 1440 px) | 0 | 0 |
| Long task su 28 rotte | 0 | 0 |
| Selettore lingua in landing | assente | presente (landing, nuova casa, chi sei) |
| Pulsante «Installa» con evento tardivo / avviso Safari con azione | no / no | sì / sì |

## Test

- `tests/e2e/ux-c.e2e.mjs` (sezioni `toast render badges expiry lang install ios paths metrics`; `ONLY=...` per lanciarne alcune).
- `tests/ux-core.test.mjs`: `requestsAwaiting`, `isRequestStale`, `staleRequestIds`, `expireStaleRequests` (admin/non admin, idempotenza), `answerCover` su settimana chiusa, `inkOn`.
- Adeguato `tests/e2e/flow.e2e.mjs` (una riga): il messaggio «Rimesso da fare» ora attende (max 2 s) che l'«Annulla» precedente lasci il posto.

## Cosa NON è verificato
- Browser reali su telefono: iPhone (Safari e Chrome), Chrome Android con il vero `beforeinstallprompt`, installazione e notifiche push; tutto con eventi/UA finti.
- Il cloud vero (Firestore): la pulizia delle richieste e il badge sono provati con il backend locale/memoria; con più dispositivi simultanei la scrittura è idempotente ma non è stata vista su Firestore reale.
- Lo screen reader (annunci dei toast in coda).
- `onboarding-more.e2e` è intermittente sotto carico (timeout di 6 s dopo «Accetta regole», passa da solo e rilanciato).
