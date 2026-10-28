# Audit v2: Home, Classifica, Settimane, Assenze

Metodo come `home-calendar-trips-stats.md` (Playwright, orologio finto mer 2026-10-28, 390/320/1440). Test: `tests/e2e/home-stats-weeks-v2.e2e.mjs`.

## Settimane su desktop (priorità, feedback utente)
Problemi: schede da ~800 px con tre celle quasi vuote (3 settimane per schermo); pannello stretto (360–440 px) rispetto alla lista; settimana corrente e selezionata con lo stesso contorno (ambigue); selezione con rifacimento completo (scroll interno del pannello perso); nessuna tastiera.
Correzioni (`js/screens/calendar.js`, nuovo `css/calendar-screen.css`; il contenuto del pannello `renderWeekDetail` in `choresheet.js` non è toccato):
- Su ≥1180 px solo la corrente è una scheda; le prossime 8 sono righe compatte (da 3 a 7+ settimane in vista). «Mostra altre» come prima.
- Colonne 5fr/6fr: il pannello è più largo della lista (≥460 px); la pagina può arrivare a 1480 px.
- Pannello con intestazione fissa e frecce «settimana precedente/successiva» (44 px) che arrivano anche alle settimane passate (aprono il mese); il dettaglio scorre per conto suo e **mantiene lo scroll** quando i dati cambiano.
- Settimana selezionata sempre evidente (contorno 3 px + sfondo; barra laterale nelle righe); la corrente si riconosce dall'etichetta. `aria-pressed` sulle righe.
- Tastiera: frecce su/giù, Home/Fine tra le settimane; la selezione segue il fuoco; suggerimento sotto il titolo. La selezione avviene sul posto, senza rifare la pagina (fuoco e scroll della lista restano).
- Righe compatte: aggiunta l'icona di scambio.

## Home
- «Sono via / ci sono» c'era due volte (Hero e riquadro Assenti): il riquadro mostra l'interruttore solo se l'Hero non ha il controllo (turno in ritardo, Hero nascosto). Il riquadro sparisce se nessuno è via.
- L'avviso «Ti restano N recuperi» non compare se il riquadro Recuperi e riposi è visibile (stessa informazione).
- Azioni rapide in orizzontale (icona + testo, 60 px invece di 92): −100 px circa.
- L'invito «compiti condivisi» (admin) ha «Ignora» (resta in Altro).
- Accetta/Rifiuta nelle richieste: 40 → 44 px. «Sono via / Ci sono» dell'Hero si disattiva dopo il tocco (doppio tocco).
- Bug: «ieri/oggi» dei compiti condivisi usava la data UTC dell'istante e la confrontava con la data locale (sbagliato vicino alla mezzanotte); ora data locale. Intestazione: con `startSunday` mancante lanciava un'eccezione (RangeError); protetto.
Lunghezza pagina Home (utente con turno, admin, 390 px): 5534 → 4996 px.

## Classifica
- Il podio non compare se i primi tre sono a pari merito (ripeteva la lista con tre «1»).
- «Vedi i dati» dei grafici: 32 → 44 px.

## Assenze
- Prima il pulsante «Nuova assenza», poi la regola delle 3 notti.

## Tocchi (invariati, già al minimo dall'audit precedente)
Segna fatto 1; Non posso 2; Sono via 1 (prima c'erano due controlli); Selezionare una settimana su desktop 1 (prima 1 + rifacimento); raggiungere una settimana lontana su desktop: frecce ↑/↓ o ‹ › del pannello 1 per settimana.

## Non fatto / da segnalare
- Mobile: la lista Settimane mostra ancora 4 schede per esteso (`calendar.e2e`/`calview.e2e` lo verificano: tests di altri).
- A pari merito tutti ricevono TR (regola in `extras.js`/`buildStats`, non toccata): a tre pari merito è poco significativo.
- Non verificato: telefono reale; desktop con tastiera vera/lettore di schermo; scuro con testo 130% sul nuovo layout desktop.
