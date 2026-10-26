# TODO — in ordine di priorità

> Regola d'oro dell'utente: **"la UX deve far risparmiare tempo e non mettere frizione. Se trovi UX scomoda o un modo per rendere le cose molto più easy, correggilo."**
> Leggi prima [`HANDOFF.md`](HANDOFF.md). Lavora a piccoli blocchi, **test verdi + commit + push** a ogni passo.

## 1. AUDIT DI USABILITÀ COMPLETO (richiesto, NON ancora fatto) — priorità massima
Simula **tutti** gli utilizzi di **tutte** le schermate, trova criticità e **risolvile** (non limitarti a segnalarle). Per ogni schermata scrivi un test e2e Playwright (`tests/e2e/`) che riproduca il percorso e fallisca prima della correzione.

### Metodo
1. **Persone/dispositivi**: (a) coinquilino su telefono 390×844 (touch), (b) coinquilino su tablet 820×1180, (c) admin su PC 1440×900, (d) iPhone/Safari in modalità standalone (non testabile in locale: emula UA e usa `matchMedia`), (e) chi apre il link d'invito per la prima volta, (f) chi rientra dopo giorni. Lingue IT ed EN, chiaro e scuro, testo 100% e 130%.
2. **Per ogni compito reale cronometra i tap**: obiettivo ≤ 2 tap per le azioni frequenti. Conta tap/scroll/digitazioni e riduci.
3. **Percorsi da simulare end-to-end** (ognuno con 2 persone, usando `ctx.setMe` per cambiare utente, oppure due contesti browser col cloud emulato):
   - Primo avvio: landing → crea casa (con e senza import Excel) → invito → altro dispositivo entra dal link → chi sei → regole → notifiche → Home.
   - Settimana tipo: venerdì "sono via?" → sabato "cosa mi tocca" → segno fatto (con checklist completa / incompleta / annullo) → domenica → lunedì in ritardo → risultati registrati da admin.
   - Assenze: weekend a casa, viaggio con rientro non noto, Erasmus, sessione esami; assenza di più persone; tutti via; 1 persona sola.
   - Sostituzioni: chiedo sostituto (a tutti / a una persona), mi offro, "con recupero" vs "regalo", rifiuto, annullo, admin assegna, volontario, ritardo annunciato.
   - Spesa: aggiungo 5 voci di fila con la tastiera mobile, segno comprato, annullo, svuoto; arrivano aggiornamenti mentre scrivo.
   - Compiti condivisi (spazzatura): tocca a me → fatto → annulla; equità.
   - Checklist: arretrato che scala, penalità, mansione senza checklist.
   - Cambio admin, cambio codice (uscita coinquilino), uscita non nota, nuovo coinquilino che sostituisce.
   - Impostazioni: ogni sezione, ogni interruttore ha effetto visibile subito; Home personalizzata; colore di casa vs personale.
   - Offline/online, ricarica a metà azione, doppio tap, back del browser, link vecchio dopo cambio codice.
4. **Checklist di qualità per ogni schermata**: stato vuoto utile, caricamento, errore recuperabile, conferma solo per azioni distruttive (altrimenti **Annulla** invece di "Sei sicuro?"), default sensati, nessun campo inutile, focus iniziale corretto, tastiera giusta (`inputmode`, `enterkeyhint`, `autocomplete`), tap target ≥ 44 px, nessun overflow orizzontale 320–1440 px, contrasto AA, testi brevi, terminologia coerente, niente gergo (spiega "recupero", "riposo", "CDM", "TR" dove compaiono), nessun elemento che salta o sfarfalla.
5. **Idee di semplificazione da valutare** (l'utente le gradirebbe se riducono i tap):
   - Azione primaria sempre sulla Home: "Segna fatto" in 1 tap con Annulla (già c'è) — verificare che non serva scorrere.
   - Scorciatoie dalla notifica (apri direttamente la mansione/la lista spesa/le assenze).
   - Onboarding più corto: pre-compilare data inizio, nome casa dal link, "chi sei" con un tap; saltare passi superflui.
   - Rendere le impostazioni meno profonde: ricerca/ordinamento per frequenza d'uso, "Impostazioni rapide" in cima.
   - Assenze: preset "weekend a casa", "questa settimana", "fino a nuovo avviso" (c'è) → verificare i tempi.
   - Richieste/sostituzioni: una sola schermata con tutto ciò che aspetta una mia risposta (badge unico, anche in nav).
   - Spesa: aggiunta continua, voci frequenti suggerite, "comprato" a swipe/tap lungo.
   - Linguaggio: sostituire termini tecnici con frasi naturali.
6. **Output atteso**: elenco criticità trovate (file: `UX_AUDIT.md` con gravità, passi per riprodurre, soluzione), correzioni implementate, test e2e aggiunti, metriche prima/dopo (tap, layout shift, render per azione, violazioni tap target).

### Difetti già noti da correggere (dai report degli agenti)
- **Toast**: si impilano; il pulsante "Annulla" ha poco contrasto (`.toast-action` in `css/app.css`).
- **Rerender a cascata** della Home: se arrivano aggiornamenti mentre il dito è sul pulsante, il click può andare perso → ridurre/coalescere i render (`js/app.js`, `scheduleRender`) e non rimontare nodi invariati.
- `renderApp` rimonta sempre il nodo della pagina: saltare `clear+append` se il nodo è già montato (pagina Spesa persistente).
- `ctx.badges().more` non conta le richieste `cover` con `to: null` né le `offer` verso di me: il badge del nav può differire da quello dell'hub in `more.js`.
- `assignCover` (admin) non ha `terms`: oggi è sempre "con recupero".
- `FEAT_IC` in `settings.js` non ha l'icona per `shared`.
- "Ha pulito un altro" propone solo i presenti; "Annulla scambio" rimuove tutti gli scambi della settimana.
- `beforeinstallprompt` catturato in `app.js` (`window.__bip`): verificare il pulsante "Installa" su Chrome Android.
- Le richieste `cover`/`offer` in attesa su settimane vecchie non scadono (aggiungere pulizia/scadenza).
- Nessun selettore di lingua nella landing (usa `detectLang()`).
- Il messaggio d'invito e la landing devono funzionare anche per chi apre da un browser non-Safari su iPhone (c'è un avviso: verificarne la chiarezza).

## 2. Verifiche sul campo (richiedono dispositivi reali — guidare l'utente)
- Generare le chiavi push (Impostazioni → Notifiche → Programma notifiche della casa → Genera chiavi), creare il secret `VAPID_PRIVATE_KEY`, lanciare "Notifiche e backup" (Actions → Run workflow).
- Provare le notifiche su Android (Chrome) e iPhone (Safari, app installata, iOS ≥ 16.4): venerdì/sabato/domenica/ritardo, spesa, richieste.
- Verificare l'obbligo di notifiche su mobile (schermata di blocco) e la schermata "installa" su iPhone.
- Controllare il comportamento con 3–4 persone reali per una settimana (turni, assenze, risultati).

## 3. Qualità e manutenzione
- Rilanciare e sistemare `tests/e2e/settings.e2e.mjs` e `tests/e2e/onboarding-more.e2e.mjs` (race nei test, vedi HANDOFF §5). Aggiungere un comando unico (`npm run e2e`) che lancia tutte le e2e.
- Aggiungere al CI (GitHub Actions) l'esecuzione di `npm test` e dello smoke test su ogni push.
- SheetJS 0.18.5 (ultima su npm) ha vulnerabilità note: limitato a file `.xlsx` caricati dall'admin; valutare un parser minimale o l'aggiornamento se disponibile.
- `sw.js`: alzare `VERSION` a ogni release; testare l'aggiornamento (banner "Aggiorna").
- Documentare nel README gli aggiornamenti (compiti condivisi, sostituzioni, penalità, checklist).
- Se l'utente passa a repo privato (GitHub Pro): verificare Pages e che i workflow restino attivi.

## 4. Idee future (solo se richieste dall'utente)
- Spese condivise/saldi (oggi usano Tricount: c'è un pulsante rapido configurabile).
- Foto/prova di pulizia, punteggi extra, badge — NON richiesti: non aggiungere senza chiedere.
- Altre funzioni IA: l'utente vuole **solo ciò che è davvero necessario** e solo per l'admin.
