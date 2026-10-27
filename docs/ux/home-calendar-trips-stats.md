# Audit di usabilità UX-A: Home, Settimane, Assenze, Classifica e fogli collegati

Perimetro: `js/screens/home.js`, `calendar.js`, `trips.js`, `stats.js`, `js/choresheet.js` (scheda mansione, scheda settimana, «Non posso», sostituzioni, richieste, volontari, ritardo), `js/weekassign.js`.
Metodo: Playwright con orologio finto (mer 2026-10-28), 2 persone (`__app.setMe`), 390×844 touch, 820×1180, 1440×900, 320×640; testo 100% e 130%; chiaro/scuro. Test: `tests/e2e/ux-a.e2e.mjs` (ogni test riproduce il difetto e prima della correzione falliva).

## Criticità

| # | Gravità | Dove | Difetto | Correzione | Stato |
|---|---|---|---|---|---|
| F1 | alta | scheda mansione / settimana (admin) | «Annulla scambio» toglieva TUTTI gli scambi della settimana. | `cancelSwapOf` / `swapGroupOf` (choresheet.js): annulla solo lo scambio scelto (+ il suo partner, es. Pavimenti↔Bagno); un pulsante per ogni scambio; toast «Annulla» che lo ripristina. Il motore non è toccato (solo `setSwap` con `null` sui campi). | corretta, test F1/F1b |
| F2 | media | «Ha pulito un altro» | Proponeva solo i presenti: chi era via (ha pulito prima di partire) non si poteva scegliere. | Elenco = tutti i coinquilini della settimana, presenti per primi, assenti con etichetta «Assenti». | corretta, test F2 |
| F3 | media | Assegna (admin) | `assignCover` non aveva scelta: sempre «con recupero». | Due schede «Con recupero» (predefinita) / «Regalo» come nelle richieste; il regalo scrive anche lo scambio concordato (come `answerCover`). «Togli assegnazione» toglie anche lo scambio del regalo. `actions.js` non toccato. | corretta, test F3 |
| F4 | media | Home, turno in ritardo | «Ha pulito qualcun altro» apriva la scheda in vista principale: 3 tocchi per un'azione già nel nome. | Apre direttamente l'elenco persone: 2 tocchi. | corretta, test F4 |
| F5 | media | Home, turno da fare | «Non posso questa settimana» 3 tocchi (riga → voce → conferma). «Scegli il giorno» duplicava i giorni già presenti nel suggerimento sotto. | Pulsante nell'hero che apre subito la conferma: 2 tocchi. Se il turno è già passato: «Annulla il passaggio» a 1 tocco. | corretta, test F5 |
| B1 | media | Home «Questa settimana sono via» | Dialogo di conferma per un'azione reversibile. | 1 tocco + toast «Annulla» (7 s). | corretta, test B1 (+ home.e2e aggiornato) |
| B2a | media | Home, giorni del suggerimento | Tocco 41×48 (33×38 a 320). | ≥ 44×48; sotto 385 px due righe 4+3. | corretta, test B2 |
| B2b | media | Assenze, elimina viaggio | Conferma modale per un'azione recuperabile. | Eliminazione a 1 tocco + «Annulla» che la ripristina (trips-stats.e2e aggiornato). | corretta, test B2 |
| B3a | media | Scheda mansione, giorni | Tocco 40×46; a 320 px/130% overflow orizzontale (giorni + intestazione). | Giorni ≥ 44 px (7 in fila, sotto 385 px 4+3), `min-width:0` sull'intestazione. | corretta, test B3 |
| B3b | media | Ritardo annunciato | 4 tocchi da Home (riga → ritardo → giorno → conferma). | Un tocco sul giorno annuncia (con «Annulla»); pulsante «Pulirò in ritardo» nell'hero in ritardo: 2 tocchi. flow.e2e aggiornato. | corretta, test B3 |
| B5 | bassa | Home / Settimane | Gergo non spiegato: «Recupero», «Riposo», TR, CDM, icone delle card. | Riga esplicativa sotto «Recuperi e riposi» e sotto la classifica, recupero spiegato nell'hero, legenda icone nelle Settimane. | corretta, test B5 |
| B4 | verifica | Home | «Segna fatto» raggiungibile senza scorrere. | Verificato a 390×844 a 100% e 130%, utente e admin, anche in ritardo (3 pulsanti). A 320×640/130% è sotto la barra di navigazione (si scorre): bassa, non corretta. | verificata |
| C1 | bassa | `settings.js` (UX-B) | `FEAT_IC` non ha l'icona per `shared`. | NON è del mio perimetro. | da segnalare a UX-B |
| C2 | bassa | `app.css` (UX-C) | Tab bar a testo 130% tronca «Settim…», «Classif…»; chip intestazione «Solo su questo dispositivo» va a capo su 3 righe. `label.switch` 51×31 (l'input ha già l'area estesa a 57×45: ok). | NON mio. | da segnalare a UX-C |
| C3 | bassa | Home | La barra di navigazione sovrappone l'ultimo contenuto durante lo scroll (padding presente, ok) ma i widget sono tanti (lista lunga): personalizzabile da Impostazioni. | non modificato | aperta |

Non emersi problemi in: Classifica/Statistiche (stato vuoto, spiegazione TR/CDM già presente, nessun overflow 320–1440, 130%); layout shift a caricamento e con aggiornamenti remoti a raffica = 0 su Home, Settimane, Assenze, Classifica.

## Metriche prima → dopo (tocchi)

| Compito | Prima | Dopo |
|---|---|---|
| Segna fatto (checklist completa) | 1 | 1 |
| Segna fatto (checklist incompleta, «spunta tutto») | 2 | 2 |
| Annulla un «fatto» | 1 (toast) | 1 |
| Non posso questa settimana | 3 | 2 |
| Annulla il passaggio | 2 | 1 |
| Ha pulito qualcun altro (in ritardo) | 3 | 2 |
| Pulirò in ritardo | 4 | 2 |
| Questa settimana sono via | 2 (con conferma) | 1 |
| Elimina assenza | 2 (con conferma) | 1 |
| Rispondi a una richiesta (Home) | 1 | 1 |
| Nuova assenza weekend | 3 | 3 |

Violazioni tap target reali (area di tocco < 44 px, escluse le aree già estese dal nucleo): Home 7 (giorni) + scheda mansione 7 → 0, a 390 e 320, testo 100%/130%.
Overflow: 320@130% nella scheda mansione (sì) → no. Layout shift (CLS): 0 prima e dopo.

## Test e comandi
`npm test` (146 verdi, 1 skip preesistente); `smoke`, `home` (26), `calendar` (20), `flow` (17), `trips-stats` (17), `week-assign` (7), `cantdo`, `needs-fast`, `foreground`, `ux-a` (13): tutti verdi. `shared.e2e` ha fallito una volta su 4 (flaky non riprodotto in 3 rilanci); `calendar.e2e` aveva un flaky sullo scroll automatico (test reso robusto).

## Non verificato
Telefono reale (tocco, tastiera, safe area, iPhone standalone); Firestore reale (solo backend locale: i `null` di `setSwap` che cancellano campi sono verificati nello store in memoria); notifiche; due dispositivi simultanei sul cloud.
