# Audit di usabilità — sintesi (ottobre 2026)

Tre audit paralleli, ciascuno con report, correzioni e test e2e che **prima falliva**:

| Area | Report | Test |
|---|---|---|
| Home, Settimane, Assenze, Classifica, schede turno | [`docs/ux/home-calendar-trips-stats.md`](docs/ux/home-calendar-trips-stats.md) | `tests/e2e/ux-a.e2e.mjs` |
| Altro e Impostazioni | [`docs/ux/more-settings.md`](docs/ux/more-settings.md) | `tests/e2e/ux-b.e2e.mjs` |
| Nucleo dell'app e percorsi trasversali | [`docs/ux/core.md`](docs/ux/core.md) | `tests/e2e/ux-c.e2e.mjs`, `tests/ux-core.test.mjs` |

Metodo: Playwright con orologio finto e 2 persone (`__app.setMe`), 390×844 touch, 320/820/1440 px, IT/EN, chiaro/scuro, testo 100% e 130%, `prefers-reduced-motion`. Gravità: alta = blocca o inganna, media = fa perdere tempo, bassa = rifinitura.

## Criticità corrette (le più importanti)
- **Alta** — «Annulla scambio» toglieva *tutti* gli scambi della settimana → ora solo quello scelto, con Annulla.
- **Alta** — Aggiornamenti remoti mentre il dito è su «Segna fatto» facevano perdere il click → i render aspettano il rilascio; la Home identica non si rimonta.
- **Media** — Toast impilati e «Annulla» coperto o a basso contrasto → uno alla volta con coda; contrasto «Annulla» da 3,1:1 a 10,5:1.
- **Media** — Badge del menu diverso da quello dell'hub; richieste vecchie che non scadevano → un'unica regola, richieste scadute fuori dai badge e pulite.
- **Media** — «Ha pulito un altro» escludeva gli assenti; assegnazione admin sempre «con recupero» → elenco completo e scelta «con recupero»/«regalo».
- **Media** — Impostazioni profonde (15 sezioni) → ricerca, «Rapide», «Aperte spesso».
- **Media** — Nessun selettore lingua nella landing; «Installa» non compariva con evento tardivo; avviso iPhone fuori da Safari senza azione → risolti («Copia il link»).
- Altre: il non-admin vedeva «Esporta dati» (pagina «solo admin»); colore della casa non seguito dall'admin; frase del log `assign`; tap target < 44 px (18 elementi → 0); gergo spiegato (recupero, riposo, TR, CDM).

## Tocchi prima → dopo
| Azione | Prima | Dopo |
|---|---|---|
| Non posso questa settimana | 3 | 2 |
| Annulla il passaggio | 2 | 1 |
| Ha pulito qualcun altro (in ritardo) | 3 | 2 |
| Ritardo annunciato | 4 | 2 |
| Sono via (questa settimana) | 2 | 1 |
| Elimina assenza | 2 | 1 |
| Rispondere a una richiesta (da Altro) | 3 | 2 |
| Tema scuro / attivare notifiche | 3 | 2 |
| Cambio «chi sei» da Altro | 4 | 3 |
| Trovare un'impostazione | scorrere e indovinare | 3–4 lettere + 1 tocco |

Altre metriche: violazioni tap target 18 → 0; overflow 320–1440 px 0 → 0; layout shift totale e long task su 28 rotte 0 → 0 (già ottimi); toast visibili insieme 3 → 1; click perso sotto aggiornamenti: sì → no.

## Rimasto (bassa gravità, non corretto)
- Contrasto AA di qualche testo secondario (es. «Ha pulito qualcun altro» 4,14:1, «· Recupero» 3,48:1, widget disattivati in Impostazioni › Home, «Cancella tutti i dati» in scuro).
- Tap target < 44 px: «Vedi i dati» in Statistiche (32 px), indirizzo nell'invito desktop (43 px).
- Tab bar con testo al 130%: «Settimane»/«Classifica» troncate; chip «Solo su questo dispositivo» su 3 righe.
- Calendario: con «indietro» la posizione di scroll non viene ripristinata.
- Impostazioni: l'indice è più alto (ricerca + rapide); la ricerca non evidenzia la voce corrispondente.
- A 320×640 con testo 130% «Segna fatto» sta sotto la tab bar (si scorre).

## Non verificato (serve un telefono vero)
iPhone e Android reali (touch, tastiera, safe area, standalone, notifiche push e bottoni sulle notifiche), Chrome Android con il vero `beforeinstallprompt`, Firestore reale con due dispositivi insieme, lettori di schermo, modo scuro col testo al 130% (solo a 100%), tablet e desktop per i fogli in dettaglio, IA con una chiave vera.
