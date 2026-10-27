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
| Audit UX Home/Settimane/Assenze/Classifica + schede turno (`js/screens/home|calendar|trips|stats.js`, `js/choresheet.js`, `js/weekassign.js`, relativi css) — report `docs/ux/home-calendar-trips-stats.md` | **Claude (sessione 2, agente UX-A)** | in corso | commit sul branch `claude/cool-ptolemy-95wh3y` (via merge); l'utente decide la pubblicazione su `main` |
| Audit UX Altro/Impostazioni (`js/screens/more.js`, `settings.js`, `js/doaction.js`, `js/push.js`, css relativi) — `docs/ux/more-settings.md` | **Claude (sessione 2, agente UX-B)** | in corso | idem |
| Audit UX nucleo + difetti noti (`js/app.js`, `js/ui.js`, `css/app.css`, `js/actions.js`, onboarding) — `docs/ux/core.md` | **Claude (sessione 2, agente UX-C)** | in corso | idem |
| Manutenzione: `tests/e2e/settings.e2e.mjs`, `npm run e2e`, CI (`.github/workflows/ci.yml`), `README.md` | **Claude (sessione 2, agente manutenzione)** | in corso | idem |
| Verifiche sul campo (notifiche push su iPhone/iPad/Android) | utente + IA | in corso | vedi `HANDOFF.md` |

## Domande aperte / messaggi tra IA
- (scrivi qui sotto, con data e firma)
