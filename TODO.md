# TODO — in ordine di priorità

> Regola d'oro dell'utente: **"la UX deve far risparmiare tempo e non mettere frizione. Se trovi UX scomoda o un modo per rendere le cose molto più easy, correggilo."**
> Leggi prima [`HANDOFF.md`](HANDOFF.md). Lavora a piccoli blocchi, **test verdi + commit + push** a ogni passo.

## 1. Audit di usabilità — FATTO (sessione di ottobre 2026)
Report: `UX_AUDIT.md` (sintesi) e `docs/ux/home-calendar-trips-stats.md`, `docs/ux/more-settings.md`, `docs/ux/core.md` (criticità, passi, correzioni, metriche prima/dopo). Test: `tests/e2e/ux-a|ux-b|ux-c.e2e.mjs`. Restano solo le voci «rimaste» nei report (bassa gravità) e quanto richiede un telefono vero (§2). Rifare l'audit quando si aggiungono schermate importanti: stesso metodo (percorsi con 2 persone, conteggio tap, tap target ≥ 44 px, overflow 320–1440, contrasto, testo 130%).

## 2. Verifiche sul campo (richiedono dispositivi reali — guidare l'utente)
- Generare le chiavi push (Impostazioni → Notifiche → Programma notifiche della casa → Genera chiavi), creare il secret `VAPID_PRIVATE_KEY`, lanciare "Notifiche e backup" (Actions → Run workflow).
- Provare le notifiche su Android (Chrome) e iPhone (Safari, app installata, iOS ≥ 16.4): venerdì/sabato/domenica/ritardo, spesa, richieste.
- Verificare l'obbligo di notifiche su mobile (schermata di blocco) e la schermata "installa" su iPhone.
- Controllare il comportamento con 3–4 persone reali per una settimana (turni, assenze, risultati).

## 3. Qualità e manutenzione
- FATTO: `npm run e2e` / `npm run check`, CI (`ci.yml`: test + smoke su push/PR), `settings` e `onboarding-more` sistemati, README aggiornato. Da verificare: la prima esecuzione della CI su GitHub (download di Chromium).
- SheetJS 0.18.5 (ultima su npm) ha vulnerabilità note: limitato a file `.xlsx` caricati dall'admin; valutare un parser minimale o l'aggiornamento se disponibile.
- Testare il banner «Aggiorna» con un service worker vero (il test copre solo il comportamento del tasto).
- Se l'utente passa a repo privato (GitHub Pro): verificare Pages, che i workflow restino attivi e le ore di Actions (il server notifiche gira ogni ora; un token per l'avvio immediato aumenta le esecuzioni).
- Notifiche più rapide senza token: servirebbe un servizio sempre acceso (es. Cloud Function, piano Blaze con carta).

## 4. Idee future (solo se richieste dall'utente)
- Spese condivise/saldi (oggi usano Tricount: c'è un pulsante rapido configurabile).
- Foto/prova di pulizia, punteggi extra, badge — NON richiesti: non aggiungere senza chiedere.
- Altre funzioni IA: l'utente vuole **solo ciò che è davvero necessario** e solo per l'admin.
