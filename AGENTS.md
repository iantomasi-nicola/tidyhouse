# Istruzioni per agenti/IA che lavorano su questo repo

0. **Più IA lavorano in parallelo su questo repo: leggi [`COORDINATION.md`](COORDINATION.md) PRIMA di modificare qualsiasi file** (regole di rebase/push e aree prenotate).
1. Leggi [`HANDOFF.md`](HANDOFF.md) (stato, requisiti dell'utente, come lavorare), poi [`TODO.md`](TODO.md) (cosa fare, in ordine) e [`ARCHITECTURE.md`](ARCHITECTURE.md) (contratti tra moduli).
2. Parla con l'utente in **italiano**, in modo diretto e breve; dì sempre cosa hai verificato e cosa no.
3. **Non cambiare la logica di assegnazione dei turni** (`js/engine.js`): è identica alle regole del foglio Excel ed è verificata. Estendi con `js/extras.js` / `js/actions.js`.
4. Prima di dichiarare finito: `npm test`, `node tests/e2e/smoke.e2e.mjs` e l'e2e del modulo toccato; poi **commit e push** su `main` (Pages si aggiorna da solo).
5. Stile: Material/Google sobrio, **niente gradienti/scintille/effetti "da IA"**; tutto il testo visibile passa da `t()` con IT+EN (`js/strings/*.js`).
6. Mai committare chiavi, JSON di account di servizio o dati reali di coinquilini. Non toccare Firebase/GitHub dell'utente in modo distruttivo senza chiedere.
7. L'utente ha limiti d'uso: lavora per piccoli passi, salva spesso.
