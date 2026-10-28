# Settimane con storico lungo

Richiesta: «la tab Settimane potrebbe diventare lunghissima, inventati qualcosa». Con 52+ settimane la pagina superava i 4000 px a 390 px (14 600 px se si apriva tutto lo storico) e tornando indietro lo scroll andava perso.

## Soluzione scelta

Dall'alto in basso:

1. **Corrente + 4 prossime** per esteso (schede di prima, invariate).
2. **«Mostra altre N settimane»**: le future oltre le prime 4, in righe compatte. Con le 14 future di default il pulsante dice «Mostra altre 10 settimane» (se restano al massimo 12 si mostrano tutte, per non lasciare una coda di 1–4 settimane in un altro tocco).
3. **Passate**: prima la **settimana scorsa** in riga compatta (è quella che si registra, non va nascosta dietro un tocco), poi i **mesi** dal più recente, ognuno una sezione richiudibile **chiusa di default** con riepilogo di una riga, es. «Ottobre 2026 · 3 settimane · tutto fatto», «Settembre 2026 · 4 settimane · 1 turno saltato» (con icona ✕ rossa), «Ottobre 2026 · 3 settimane · 3 turni da registrare» (con icona orologio gialla). Si mostrano 6 mesi, poi «Mostra mesi precedenti» (+6).
4. **«Oggi»**: pulsante ancorato in basso sopra la barra di navigazione, compare solo quando la settimana corrente non è in vista (in cima non serve) e riporta in cima.

Dettagli:
- Mese di una settimana = quello del giovedì (dove cadono più giorni); le settimane «23–29 nov» stanno quindi in novembre. Il conteggio di un mese esclude la settimana scorsa, mostrata a parte.
- Riepilogo: turni saltati (`nSk` del motore) in rosso con icona ✕, turni ancora da registrare (`nPend`, dentro la tolleranza) in giallo con icona orologio, altrimenti «tutto fatto» in verde con ✓; testo e icona, mai solo colore. Settimane «casa vuota» non contano.
- Riga compatta: intervallo, stato, i tre turni su una riga (pallino della mansione, nome, esito), icone di nota, assenza, «incompleto», volontario/concordato/ritardo. Tocco ≥ 44 px (alta ~64 px contro ~190 della scheda). Il resto sta nella scheda settimana, come prima.
- Il corpo di un mese esiste nel DOM solo quando è aperto (meno nodi).
- A11y: intestazione = `<h3><button aria-expanded aria-controls>`, anello di focus visibile, Invio/Spazio, nome accessibile su ogni pulsante.
- Stato ricordato: mesi aperti in `sessionStorage` (try/catch) e in variabile di modulo; scroll e tranche («Mostra altre») ritrovati con «indietro» e anche toccando la voce di menu (l'app già ripristina lo scroll in quel caso). Dopo un ricarico si riparte dall'alto con i mesi aperti ricordati. Un render scartato dall'app non conta come nuova visita (prima era una fragilità: il calendario azzerava lo storico mostrato).
- **Deep link** `#/calendar?week=YYYY-MM-DD` (basta un giorno qualsiasi della settimana): apre il mese giusto (o le future necessarie), scorre fin lì, evidenzia la riga qualche secondo e apre la scheda settimana (su desktop la seleziona nel pannello); il parametro viene tolto dall'indirizzo, quindi «indietro» e i rerender non lo ripetono. Funziona anche cambiando hash mentre si è già nel calendario. `app.js` non è toccato: `parseHash` scarta già la query, la rotta resta `calendar`. Nessuna schermata esistente lo usa ancora (Home apre la scheda direttamente con `openWeekSheet`); è pronto per notifiche e link.
- Desktop ≥ 1180 px: stesso elenco compatto a sinistra, pannello dettaglio a fianco come prima (la riga cliccata si seleziona, niente scheda).

### Perché questa e non altre
- *Paginazione «Mostra precedenti» (prima)*: ogni tocco aggiungeva 8 schede da ~190 px; per arrivare a un anno fa servivano 7 tocchi e 14 600 px.
- *Filtro/selettore di mese a parte*: un tocco in più per ogni settimana e una nuova interfaccia da imparare. I gruppi chiusi con riepilogo danno anche informazione (dove sono i buchi) senza aprire nulla.
- *Gruppi per anno*: tre livelli = 3 tocchi per una settimana vecchia, contro il requisito ≤ 2; con i mesi dell'anno nell'etichetta bastano 6 mesi per volta.
- *Cercare per data*: più lento di un tocco sul mese e richiede la tastiera.

## Misure (seed: 60 settimane di storico + corrente + 14 future, 390×844, lunedì finto 28/10/2026; `node tests/e2e/calview.measure.mjs`)

| Misura | Prima | Dopo |
|---|---|---|
| Altezza pagina all'apertura | 4193 px | **2005 px** (-52%) |
| Nodi DOM nel calendario | 624 | **280** (-55%) |
| Schede/righe settimana nel DOM | 19 | 6 |
| Tutto lo storico aperto: altezza | 14 665 px (7 tocchi) | 6418 px (12 mesi aperti = 12 tocchi, ma non serve) |
| Tutto lo storico aperto: nodi | 2626 | 1797 |
| Tempo di `render()` (mediana di 15) | 2–5 ms | 2–4 ms (invariato nel rumore: il costo non era nella costruzione) |
| Tocchi per la settimana di 3 mesi fa | 2 («Mostra precedenti» + settimana) con 1403 px di scroll | **2** (mese + settimana) con 145 px di scroll |
| Tocchi per una settimana di 8 mesi fa (calcolo: 4 «Mostra precedenti» + 1 / «Mostra mesi precedenti» + mese + settimana; non misurato in browser) | 5 | 3 |
| Layout shift (CLS) | 0 | 0 |

Note oneste: il tempo di `render()` non cambia in modo misurabile (è già pochi ms); il vantaggio è nell'altezza, nei nodi (paint/scroll su telefoni lenti) e soprattutto nello scorrimento. Con la sola storia di default dell'app (poche settimane) il cambiamento è piccolo.

## Test
`tests/e2e/calview.e2e.mjs` (12 scenari): gruppi per mese chiusi con riepilogo, riepilogo di tutti i mesi confrontato col motore (le tre situazioni), apertura/chiusura con tastiera e ordine, 2 tocchi per 3 mesi fa, «Mostra altre» (futuro e mesi), «Oggi», ritorno con «indietro»/menu/ricarico, aggiornamento dati senza perdere lo stato, deep link (passato, giorno qualsiasi, futuro lontano, non valido, hash cambiato in pagina, desktop), tocco ≥ 44 px, 320/390/820/1440 × chiaro/scuro × testo 100/130% senza overflow né testo tagliato, inglese.
Aggiornati per la lista a mesi: `calendar.e2e.mjs` (elenco 6 schede, «Mostra altre», pulsante Oggi in inglese) e, solo per aprire il mese giusto prima di cliccare una settimana vecchia, `week-assign.e2e.mjs` (non era tra i miei file: modifica minima all'helper `openWeek`).

## Non verificato
Telefono reale (tocco, scroll inerziale, safe area, comportamento del tasto indietro nella PWA installata), iPhone standalone, Firestore reale con molti dati, case con più di ~3 anni di storico (non provati oltre le 60 settimane), lettori di schermo veri (verificati solo ruoli/attributi). La chiave `cal.showPrev` in `js/strings/cal.js` non è più usata (file non mio, lasciata).
