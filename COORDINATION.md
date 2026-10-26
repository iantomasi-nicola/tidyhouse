# Coordinamento tra più IA/persone sullo stesso repo

> **Più IA lavorano su questo repo contemporaneamente.** Leggi questo file prima di toccare qualsiasi cosa e **aggiornalo** (una riga) quando inizi o finisci un lavoro. L'utente ha limiti d'uso: la prima IA (Claude) sta per esaurirli e passa il resto all'altra.

## Regole per non pestarsi i piedi
1. **Prima di iniziare e prima di ogni push**: `git fetch origin +main:refs/remotes/origin/main && git pull --rebase origin main`. Mai `git push --force`.
2. **Commit piccoli e frequenti**, un argomento per commit; push subito dopo i test (`npm test` + `node tests/e2e/smoke.e2e.mjs`).
3. **Prenota le aree** nella tabella qui sotto (una riga, push subito). Se un file è prenotato da un altro, non modificarlo: chiedi/aspetta o lavora su un altro.
4. **Non riformattare o riordinare** file che non stai modificando; niente rinomine massive; non toccare `js/engine.js`.
5. **`VERSION`** (in `sw.js` e `js/app.js`) va alzata **solo da chi pubblica una release**, in un commit dedicato `Release x.y.z` (evita conflitti): chi fa il push finale della giornata la alza una volta.
6. Stringhe: ogni modulo ha il suo `js/strings/<modulo>.js`; nuove chiavi con il prefisso del modulo (`tests/strings.test.mjs` controlla duplicati).
7. Se due modifiche confliggono: **vince l'ultima pubblicata, l'altro rifà il rebase** senza scartare il lavoro altrui; in dubbio, scrivi la domanda qui sotto.

## Aree e chi le sta toccando
| Area / file | Chi | Stato | Note |
|---|---|---|---|
| Home: tasto Aggiorna/«nuova versione» (`js/screens/home.js` header, `css/home.css`, `js/strings/home.js`), `js/app.js` (updateReady/applyUpdate, notifiche già attive), `js/push.js` (stato locale), `sw.js` | **Claude (sessione 1)** | in pubblicazione ora, poi **libera** | dopo questo push Claude non tocca più il repo (limite d'uso) |
| Audit di usabilità di tutte le schermate (`TODO.md` §1) | **libero → prenotalo** | da fare | consiglio: dividere per schermata e prenotare una riga per volta |
| Verifiche sul campo (notifiche push su iPhone/iPad/Android) | utente + IA | in corso | vedi `HANDOFF.md` |

## Domande aperte / messaggi tra IA
- (scrivi qui sotto, con data e firma)
