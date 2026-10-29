# Azioni admin su turni e settimane — audit breve e riordino (ottobre 2026)

## Prima: criticità
- **Bottoni sparsi e duplicati**: scheda turno con Segna fatto · Ha pulito qualcun altro · Non fatto · Rimetti da fare · Sollecita, poi sezione «Admin» (Scegli chi lo fa · Togli l'assegnazione · Correggi chi ha pulito) e sezione «Scambio» (Scambia con… · Annulla scambio). «Correggi chi ha pulito» rifaceva le stesse cose di «Ha pulito/Non fatto/Rimetti». Nel dettaglio settimana un «Scegli chi lo fa» sotto **ogni** mansione + «Assegna la settimana». «Recuperi e riposi» solo da Altro.
- **Tre modi diversi di dire «chi lo fa»** (Scegli chi lo fa = con recupero; Scambia con… = senza recupero; Assegna la settimana = entrambi + «nessuno»), con etichette e fogli diversi.
- **Desktop**: il pannello a destra apriva fogli a catena per ogni azione.

## Bug veri trovati (corretti)
1. «Scegli chi lo fa» elencava anche l'assegnato stesso (accordo con sé stesso, messaggio «Anna farà pavimenti»).
2. «Correggi chi ha pulito» lasciava i flag vecchi: chip «Volontario: X» dopo aver cambiato il risultato, «incompleto» su un turno poi saltato.
3. «Annulla scambio» di un recupero programmato lasciava il chip «Recupero programmato» (ora il marcatore si toglie e Annulla lo rimette).
4. Con «Nessuno questa settimana» la scheda turno perdeva ogni azione admin (vicolo cieco): ora «Chi lo fa» c'è sempre.
5. «Non fatto» offriva «anche X non ha pulito» solo per il sostituto suggerito, «Correggi» per tutti: ora un solo elenco.
6. Richiesta scaduta (`expired`): messaggio dedicato invece di «Errore».

## Dopo: una sola sezione «Gestisci (admin)», ordinata per intento
- **Chi lo fa**: «Come da regole (X)» · persone (anche assenti; sottotitolo ha bagno / assente / a riposo / consigliato) · «Nessuno questa settimana». Regole e Nessuno: un tocco. Una persona: compaiono le conseguenze — *Con recupero* / *Scambio* (se ha un'altra mansione) / *Senza recupero* (+ avviso «avrà 2 mansioni») — e il tocco sull'opzione applica. «Come da regole» toglie lo scambio intero (es. Pavimenti↔Bagno). Sempre con Annulla.
- **Com'è andata**: Da fare · assegnato · chi ha pulito al suo posto · Nessuno (+ «non ha pulito neanche…»), con la frase delle conseguenze. Turno aperto → flusso normale con checklist; altrimenti correzione con Annulla.
- **Recuperi e riposi** della persona (scheda) / di tutti (pannello desktop, apribile), **Sollecita**, **Assegna la settimana** (modifica in blocco con anteprima).
- L'admin in alto ha solo «Segna fatto»; il non admin resta com'era.
- **Pannello desktop** (≥1180 px): ogni mansione mostra Chi lo fa + Com'è andata, tutto insieme, senza fogli.

## Tocchi (admin, da Settimane; telefono → desktop)
| Caso | Prima | Dopo (telefono) | Dopo (desktop) |
|---|---|---|---|
| Ha pulito un altro | 4 | 3 | 2 |
| Nessuno ha pulito | 4 | 3 | 2 |
| Correggere un risultato passato | 4 | 3 | 2 |
| Lo fa X con recupero | 3 | 4 | 3 |
| Scambio / senza recupero | 4 | 4 | 3 |
| Nessuno questa settimana | 4 | 3 | 2 |
| Torna come da regole | 2–3 | 3 | 2 |
| Recuperi di chi ha il turno | 3 (da Altro) | 4 (dal turno) / 3 da Altro | 2 |

Unico peggioramento: «con recupero» dal telefono +1 tocco, in cambio dell'anteprima delle conseguenze prima di applicare.

## Non verificato
Telefono vero, lettori di schermo, Firestore con due dispositivi insieme.
