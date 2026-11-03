# Audit UX: compiti condivisi + checklist ricorrenti → pagina «Compiti»

Data: novembre 2026. Ambito: `js/screens/more.js` (sezione compiti), widget Home «condivisi» e «checklist», etichette in Impostazioni → Funzioni, stringhe `more*.js`/`flow.js`. Nessuna modifica a `engine.js`, `extras.js`, `actions.js`, `store.js`: stessi dati (`house.shared`, `house.sharedState`, `house.tasks`, `house.checklistOff`, `weeks[].tasksDone`) e stesse azioni.

## Problemi trovati (prima)
| # | Problema | Gravità |
|---|---|---|
| 1 | Due voci vicine nell'hub, «Compiti condivisi» e «Checklist ricorrenti», con nomi che si somigliano e due icone quasi uguali: l'utente non capisce quale usare. | alta |
| 2 | Due editor diversi (due sheet) con lo stesso titolo del pulsante, «Nuovo compito», per cose diverse; due liste, due stati vuoti, due suggerimenti con comportamenti diversi (uno aggiunge subito, l'altro apre un editor). | alta |
| 3 | La modifica dei compiti condivisi sta in una lista «Gestione compiti» in fondo alla pagina, sotto le schede e l'equità: per cambiare il nome bisogna scorrere. | media |
| 4 | Nessun ordine per scadenza: le schede stanno nell'ordine di inserimento, i compiti scaduti non vengono per primi. | media |
| 5 | Stato poco chiaro: «Da fare» uguale per scaduto da 1 giorno e da 10; in una scheda tutti i dettagli, ma niente colpo d'occhio; «Fatto» mostrato anche per compiti non in scadenza senza dire che è un'azione facoltativa. | media |
| 6 | Checklist: la pagina elenca le voci ma non si può spuntare nulla (solo da Home o dalla scheda turno): per vedere «fatto da chi» e agire servono altri giri. | media |
| 7 | Aggiungere un extra «Bagno, ogni 4 settimane» costa 8 tap (stepper a un tocco per volta). | media |
| 8 | Eliminare: dialogo di conferma (2 passaggi) senza Annulla; per i compiti condivisi si perde anche lo storico. | media |
| 9 | Terminologia mista: «compito», «voce», «checklist», «extra», «condiviso», «ricorrente». In Home l'elenco si chiama già «Extra della settimana». | media |
| 10 | Stati vuoti diversi: i modelli stanno in fondo alla pagina, dopo l'elenco vuoto. | bassa |
| 11 | Tutta la pagina checklist era visibile solo come «sola lettura» ai non admin senza spiegare cosa possono fare. | bassa |

## Cosa è cambiato
- **Una sola voce «Compiti»** nell'hub (`#/tasks`; `#/more/shared` resta come alias). La voce compare se è accesa almeno una delle due funzioni; il badge somma i compiti a turno scaduti e i miei extra da fare. Le due funzioni restano separate in Impostazioni → Funzioni («Da fare a turno», «Extra delle mansioni»).
- **Due sezioni ben distinte**, con titolo, frase di spiegazione e conteggio «da fare», e due scorciatoie in alto per saltare dall'una all'altra:
  - **Da fare a turno** (`house.shared`): senza settimana fissa, tocca a chi l'ha fatto meno di recente tra chi è a casa.
  - **Extra delle mansioni** (`house.tasks`): voci legate a Pavimenti/Bagno/Cucina, le spunta chi ha il turno, nella checklist del turno.
- **Glossario**: *compito* = elemento di «A turno»; *extra* = elemento di una mansione; *checklist del turno* = l'elenco degli extra da spuntare nella scheda del turno (invariata). Sostituito «condiviso»/«ricorrente»/«checklist» con «a turno»/«extra» in pagina, Impostazioni, penalità (Classifica) e widget Home.
- **Un solo editor in linea** (niente sheet), usato per aggiungere e modificare: testo, *Chi lo fa* (A turno / Pavimenti / Bagno / Cucina: un solo campo decide dove finisce), *Ripeti* (tasti rapidi + contatore per valori strani), «Altre opzioni» (prima volta, solo extra), Attivo, Elimina/Annulla/Salva. Invio nel campo aggiunge con i valori predefiniti.
- **Modelli rapidi** nell'editor di aggiunta (relativi alla scelta) e negli stati vuoti: un tocco aggiunge, con toast «Annulla»; «Aggiungi tutti» per gruppo (voci «ogni X settimane» sfalsate come prima).
- **Modifica in linea**: tocco sulla riga → pannello sotto la riga con editor (admin) e storico recente con «Annulla l'ultimo» (tutti, se l'hai segnato tu o sei admin).
- **Ordine per scadenza**: a turno = più in ritardo prima, disattivati in fondo; extra = arretrati, da fare, fatti, non in scadenza (per prossima settimana), disattivati.
- **Stato chiaro**: «Scaduto da N giorni» (rosso) / «Da fare oggi» (ambra) / «tra N giorni»; a chi tocca con avatar; «Ultimo: nome, quando»; per gli extra «Fatto da X», «Arretrato dalla settimana del …: tocca a …», «Tra N settimane, prossima: …». Chip della frequenza su ogni riga.
- **Annulla** dove prima non c'era: aggiunta (singola, da modello o «tutti»), eliminazione (ripristina anche lo storico e la posizione); sparisce il dialogo di conferma. «Fatto» e «Annulla l'ultimo» come prima.
- **Spunta dalla pagina**: chi può (chi ha il turno, il responsabile di un arretrato, l'admin) spunta/toglie un extra con un tocco sul cerchio; stessa logica di Home (`tickTask`/`canTick`).
- **Home**: widget «Da fare a turno» ordinato per scadenza, con «Scaduto da N giorni»/«Da fare oggi» e link «Tutti i compiti»; il widget «Extra della settimana» ha lo stesso link. L'invito per l'admin punta alla pagina unica.
- **Stati vuoti utili**: admin = modelli già a un tocco; non admin = «Chiedi all'admin di aggiungerne». Non admin: nota con ciò che può fare («Tu puoi segnare Fatto»).

## Tap prima / dopo (partendo dalla Home, admin)
| Azione | Prima | Dopo |
|---|---|---|
| Segnare «fatto» un compito a turno (widget Home) | 1 | 1 (invariato) |
| Segnare «fatto» dalla pagina | 3 (Altro, riga, Fatto) | 3 (invariato) |
| Aggiungere un compito a turno personalizzato (ogni 3 giorni) | 4 (Altro, riga, Nuovo, Salva) | 4 (Altro, Compiti, Aggiungi, Invio); dall'invito in Home: 3 |
| … ogni settimana | 4 + 4 sul contatore = 8 | 5 (+ un tasto rapido) |
| Aggiungere da modello (pagina ancora vuota) | 3 | 3 |
| Aggiungere da modello (pagina già con compiti) | 3 | 4 (ma si possono aggiungere più modelli di seguito, con Annulla) |
| Aggiungere un extra «Bagno, ogni 4 settimane» | 8 | 5 (Altro, Compiti, + del Bagno, tasto «Ogni 4 settimane», Aggiungi; più il testo) |
| Cambiare il nome di un compito/extra | 4 + scorrere in fondo | 4, nessuno scorrimento, niente sheet |
| Disattivare un compito a turno | 3 + scorrere | 4 (riga, interruttore «Attivo»), nessuno scorrimento |
| Disattivare un extra | 3 | 3 (invariato, interruttore sulla riga) |
| Eliminare | 5 (con conferma) | 4, con «Annulla» |
| Spuntare un extra dalla pagina | non possibile | 3 |

## Bug / difetti sistemati lungo la strada
- «Da fare» identico per scaduto da molti giorni e per «oggi»: ora distinti (rosso/ambra).
- Tap target ≥ 44 px su tutti i controlli nuovi (spunta, tasti rapidi, interruttori, pulsanti), nessun overflow orizzontale a 320–1440 (testato nell'e2e e in `ux-b`).
- Con un campo di testo in uso nella pagina gli aggiornamenti remoti aspettano (regola dell'app): la bozza dell'editor vive nello stato del modulo e non si perde ai ridisegni.

## Test
`tests/e2e/shared.e2e.mjs` (a turno: stato, ordine, Fatto/Annulla, due persone, equità, aggiunta in un gesto, modelli con Annulla, modifica in linea, elimina con Annulla, funzioni spente, penalità extra), `tests/e2e/more2.e2e.mjs` (extra: ordine, anteprima somma, interruttori, modelli, aggiunta in un gesto, modifica con digitazione lenta, spunta, stati vuoti, sola lettura), più gli aggiornamenti minimi a `ux-b`, `flow`, `onboarding-more` per le nuove etichette e la riga unica nell'hub.

## Rimasto / suggerimenti
- «Chi» per i compiti a turno è sempre automatico (equità): un campo opzionale «fisso a …» richiederebbe `saveShared` (`actions.js`) che oggi ripulisce i campi a `id, text, every, enabled`.
- La scheda turno (`js/choresheet.js`) chiama ancora «Checklist del turno» l'elenco degli extra: coerente col glossario, ma se si vuole un solo termine va cambiato `flow.checklist*` (non toccato).
- Un interruttore per disattivare direttamente le righe dei compiti a turno attivi (oggi nel pannello) toglierebbe un tap.
- Non verificato su telefono vero (solo emulazione Playwright 320–1440, IT/EN, chiaro/scuro).
