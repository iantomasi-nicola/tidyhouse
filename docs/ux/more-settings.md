# Audit di usabilità · «Altro» e «Impostazioni» (UX-B)

Metodo: lettura del codice (`js/screens/more.js`, `js/screens/settings.js`, `js/doaction.js`, `js/push.js`, `js/ai-ui.js`), simulazione Playwright con 2 persone (`ctx.setMe`, seed con richieste/registro), viewport 390×844 touch, 820×1180, 1440×900 e 320×640 con testo 130%, IT/EN, chiaro/scuro; misura automatica di overflow e tap target (script di audit + scenario e2e). Ogni criticità ha uno scenario in `tests/e2e/ux-b.e2e.mjs` che prima della correzione falliva (verificato eseguendolo prima di toccare il codice).

Gravità: A = blocca/inganna, M = fa perdere tempo, B = rifinitura.

## Criticità trovate

| # | Gravità | Dove | Passi per riprodurre | Soluzione | Stato |
|---|---|---|---|---|---|
| 1 | M | Hub «Altro» | Con una richiesta in sospeso: Altro → Scambi turno → Accetta (3 tap) | Blocco «Da fare ora» nell'hub: richieste che aspettano me (max 3) e compiti condivisi che toccano a me, con Accetta/Rifiuta/«Ci penso io»/Fatto già pronti (2 tap dalla Home, 1 dall'hub). Il link alla pagina completa resta. | corretta |
| 2 | A | Hub «Altro», non admin | Da non-admin: Altro → «Esporta dati» → pagina «solo admin» | La riga «Esporta dati» si vede solo all'admin. «Invita coinquilini» si vede a tutti (il codice è già visibile a tutti da Impostazioni; la rotazione resta solo admin). | corretta |
| 3 | M | Richieste | Richiesta `cover`/`offer` pendente su una settimana chiusa: resta in «in arrivo» per sempre, conta nel badge, si può «accettare» un turno che non esiste più | Le scadute (settimana con `row.closed`, o precedente a oggi) escono dal badge dell'hub e da «in arrivo»; sezione «Scadute» con un pulsante «Rimuovi scadute» (1 tap, con Annulla). Le vede/toglie solo chi è coinvolto, l'admin tutte. | corretta in more.js; **serve app.js/actions.js** (vedi sotto) |
| 4 | M | Registro attività | Assegnazione manuale della settimana (`assign`): icona generica e frase «Admin: assegnazione manuale 26 ott – 1 nov: …» scritta nella lingua di chi l'ha fatta (non traducibile) | `assign` in `ACT_ICON` (calendario) + frase tradotta dai dati (`week`, `n`): «Admin ha assegnato a mano i turni di 26 ott – 1 nov». | corretta |
| 5 | B | Impostazioni › Funzioni | `shared` (Compiti condivisi) senza icona; nessuna riga dice cosa cambia spegnendo (gergo «TR / CDM», «Scambi turno») | `FEAT_IC.shared`, icona di riserva per ogni funzione, una riga di spiegazione per tutte le 16 funzioni (`uxb.featd.*`). Verificato che ogni interruttore ha effetto visibile subito (hub e nav). | corretta |
| 6 | M | Impostazioni, indice | 15 sezioni in lista lunga: per cambiare il tema 3 tap + scroll, per attivare le notifiche 3 tap, per trovare «penalità» bisogna indovinare «Regole dei turni» | Cima dell'indice: **ricerca** (titolo, riepilogo e parole chiave IT/EN; per i non-admin solo sezioni consentite), scheda **Rapide** (tema in 1 tap, notifiche: «Attiva» in 1 tap se non attive), **Aperte spesso** (le 3 sezioni aperte ≥ 2 volte su questo dispositivo). Le 15 sezioni restano tutte raggiungibili (le e2e di `settings` contano 15/4). | corretta |
| 7 | M | Impostazioni › Aspetto | Admin: sceglie un colore, «Imposta per tutti»: il suo telefono resta sul colore personale e non segue più la casa (cambiando ancora il colore della casa non vede nulla) | Dopo «Imposta per tutti» il colore personale dell'admin si azzera: segue la casa come gli altri. | corretta |
| 8 | M | Impostazioni › Sicurezza | «Cambia admin»: il primo candidato della lista era spesso l'admin stesso (un tap sbagliato = nessun cambio) e comparivano anche persone già uscite | Candidati = solo chi è in casa, admin attuali in fondo. | corretta |
| 9 | M | Moduli con PIN / chiave (Sicurezza, cambio admin, «usa chiave esistente») | Errore («PIN errato») cancellato dal rerender quando arrivano dati da un altro telefono (cloud) | `errLine()`: il messaggio è memorizzato in `S.err` e ricreato a ogni render. | corretta |
| 10 | B | Impostazioni › Regole turni | Titoli tecnici: «Finestra classifica», «Priorità iniziale per chi non ha storico», «Minimo di persone a casa per spendere un riposo» | «Settimane contate in classifica», «Vantaggio per chi arriva in casa», «Persone a casa per concedere un riposo» (+ TR/CDM spiegati nel testo). | corretta |
| 11 | B | Tap target | `Installa l'app` (indice impostazioni) 18 px di altezza; «Svuota registro» (Accessi) 32–36 px | min-height 44 px. Misura finale: 0 elementi < 44 px su 26 schermate × (390 IT, 320 EN 130%); 0 overflow. | corretta |
| 12 | B | Tastiera | Campi di testo senza `enterkeyhint`; nome coinquilino senza maiuscole; PIN senza `enterkeyhint`; «API key» fuori da `t()` | `enterkeyhint` (done/next), `autocapitalize: words`, placeholder tradotto «Chiave API». | corretta |
| 13 | B | Hub | La scheda col mio nome non era cliccabile: cambiare «chi sei» richiedeva Altro → Impostazioni → Profilo → nome | La scheda apre il profilo (Altro → scheda → nome = 3 tap invece di 4). | corretta |
| 14 | B | Test | `settings.e2e` (4 test) e `shared.e2e` (1 asserzione) falliti/flaky per il doppio-click ravvicinato (<350 ms) e per i default dei solleciti cambiati (2 orari, max 2) | Attese di 400 ms, valori attesi aggiornati, attesa del rerender in `shared`. (Un altro agente li ha già sistemati su main: al merge tenere la versione di main.) | corretta |

## Difetti noti dall'incarico

- **`ctx.badges().more` (js/app.js, file di UX-C): NON modificato qui.** Stato attuale del codice: la regola sulle destinatarie è già quella di `awaitingMe()` (cover a me o a tutti tranne il richiedente, offerte/scambi a me), ma (a) è dentro `if (me && o.cur >= 0)`, quindi senza settimana corrente il badge del nav è 0 mentre l'hub mostra il numero; (b) conta anche con `features.requests` spento (l'hub nasconde la riga); (c) conta le richieste scadute, che l'hub ora esclude. Correzione necessaria in app.js: portare il calcolo di `out.more` fuori dall'`if (o.cur >= 0)`, ignorare tutto se `!this.feature('requests')`, e saltare le richieste con `week` precedente alla settimana corrente chiusa (stessa regola di `isStale()` in `more.js`: `rows.find(r => r.sunday === q.week)?.closed`, altrimenti `q.week < today`). Finché non è applicata, con richieste scadute il badge del nav può essere maggiore di quello dell'hub (visto: nav 3, hub 2).
- **Badge unico anche in nav**: il nav conta solo le richieste; si può sommare i compiti condivisi «tocca a te» (stesso conteggio del blocco «Da fare ora») cambiando `badges()` come sopra.
- **`FEAT_IC.shared`**: corretta. **`assign` nel registro**: corretta.
- **Richieste `cover`/`offer` su settimane vecchie**: la pulizia manuale c'è (punto 3). Proposta per `js/actions.js` (file di UX-C): (1) in `answerCover` rifiutare con `Error('expired')` se la riga della settimana è `closed`; (2) cancellare automaticamente le richieste `pending` con settimana chiusa da più di 14 giorni (nello stesso punto in cui l'admin fa già pulizia, ad esempio all'apertura da admin o nell'azione oraria del server `scripts/notify-core.mjs`).

## Metriche prima → dopo

| Compito (dalla Home, contando i tap) | Prima | Dopo |
|---|---|---|
| Rispondere a una richiesta | 3 (Altro, Scambi, Accetta) | 2 (Altro, Accetta) |
| Segnare fatto un compito condiviso che tocca a me | 3 | 2 |
| Tema scuro | 3 (ingranaggio, Aspetto, Scuro) | 2 (ingranaggio, Scuro) |
| Attivare le notifiche del telefono | 3 | 2 |
| Trovare «penalità» / «codice» / «PIN» | scorrere 15 righe e indovinare | scrivere 3–4 lettere, 1 tap |
| Cambiare «chi sei» da Altro | 4 | 3 |
| Aprire le 3 sezioni più usate | 2 tap + scroll | 1 tap in cima (chip «Aperte spesso») |

- Tap target < 44 px: 4 elementi in 4 schermate/viewport (link «Installa l'app», «Svuota registro» a 390/820/1440 e 320) → **0** (26 rotte × 390 IT e 320 EN testo 130%).
- Overflow orizzontale: 0 prima, 0 dopo (320–1440).
- Profondità impostazioni: sezioni raggiungibili in ≤ 1 tap da ricerca/rapide/aperte spesso; altezza dell'indice a 390 px: 1709 → 1977 px (rapide + ricerca sopra), ma la parte utile sta nel primo schermo.
- Render per azione: invariato (nessuna modifica ad app.js).

## Verificato e senza difetti

Spesa (aggiunta continua, Annulla, svuota), checklist ricorrenti, compiti condivisi, ultimo che esce, guida installazione, informazioni; ogni interruttore di «Funzioni» (hub, nav); colore personale/di casa; Home personalizzata; cambio admin e PIN (e2e di `settings`); rotazione codice e uscita coinquilino (e2e di `settings`, nessuna modifica necessaria).

## Non verificato

Notifiche push reali (il pulsante «Attiva» delle Rapide usa lo stesso `push.enable` di Notifiche, ma in Chromium headless lo stato è `unsupported/nocloud`); aspetto su telefono vero (solo emulazione); iPhone/Safari standalone; contrasto AA misurato solo a vista sui token esistenti (nessun colore nuovo); Excel reale nell'import (file mancante nell'ambiente); cloud con 2 dispositivi (solo modalità locale con `setMe`).
