# Prestazioni e robustezza (nucleo: `js/app.js`, `sw.js`, `index.html`)

Misure con `node tests/perf/measure.mjs` (Chromium/Playwright, telefono 390x844, casa locale con **70 settimane**, service worker attivo,
server che imita GitHub Pages: gzip + `max-age=600` + ETag). `LAT=120` aggiunge 120 ms a ogni richiesta (rete mobile); `APP_ROOT=<cartella>`
misura un'altra copia dell'app (usata per il «prima»). Le macchine di prova sono rumorose: gli stessi test a 0 ms danno differenze di +-100 ms
tra una corsa e l'altra, per questo i numeri da guardare sono quelli con latenza e quelli di conteggio (richieste, byte, render).

## Prima / dopo

| Misura | Prima | Dopo |
|---|---|---|
| Riapertura (SW attivo), pronto a schermo, rete 120 ms | 1216 ms (FCP 1240) | **241 ms** (FCP 272) |
| Riapertura, rete 0 ms (4 corse) | 318 - 384 ms | 205 - 330 ms |
| Prima apertura assoluta, rete 120 ms | 1568 ms (FCP 1636) | 1265 ms (FCP 1332) |
| Prima apertura assoluta, rete 0 ms (2 corse) | 319 - 713 ms | 283 - 329 ms |
| Prima apertura: richieste / byte sul filo | 35 / 174 KB | 36 / 181 KB (+ `modulepreload`) |
| **Offline dopo la sola prima apertura** | Home vuota; 17 rotte su 17 KO | **Home e 17 rotte su 17 funzionano** |
| Rotte: file scaricati dalla rete al primo ingresso | 13 file, 28 KB (stringhe e css per rotta) | **0** (tutto già nel precache) |
| Cache del service worker | 41 file, 854 KB (non coerente) | 77 file, 1094 KB (tutta l'app, coerente) |
| Richieste di riconferma a ogni avvio | 35 (tutti i file, `no-cache`) | 0 entro 5 min, poi una sola prova su `sw.js` e riconferma dei file |
| Ridisegni della pagina per 20 scritture di accessi/dispositivi (cloud: le fanno gli altri telefoni) | 10 costruzioni complete della Home | **0** (20 scritture ignorate, barra in alto aggiornata) |
| Ridisegni per 10 scritture di dati veri (spesa) | 10 | 10 (corretto: cambia la Home) |
| Long task all'avvio a freddo | 1 - 3 (50 - 328 ms) | 0 - 2 (116 - 139 ms) |
| CLS (28 rotte, mobile e desktop) | 0 | 0 |
| INP (tocchi sulle tab, scheda turno): peggiore | 40 - 96 ms | 48 - 96 ms (invariato, entro il rumore) |
| Memoria dopo 210 navigazioni | +0,6 MB, +724 nodi, +34 listener (poi stabile: 90 vs 180 navigazioni identiche) | uguale a regime (nessuna perdita) |
| Store 70 settimane: localStorage / `compute()` / `JSON.stringify` | 24 KB / ~2 ms / ~0,1 ms | invariato |
| `compute()` ripetuti | già memoizzato per versione dei dati; ora non si rifà nemmeno per scritture di soli accessi/dispositivi | |

Non c'era un collo di bottiglia di CPU: la CPU all'avvio è ~60 ms di JS (profilo), `compute()` con 70 settimane costa ~2 ms. Il guadagno reale
è nella rete e nella cache.

## Cosa è stato cambiato

- **`sw.js` (VERSION invariata)**
  - Precache **completo e autodescrittivo**: parte da una breve lista e legge da sé gli `import` (statici e `import()`) e i `loadCss('css/…')`
    di ogni file, quindi nuovi moduli/schermate/css di altri agenti entrano da soli. Fuori restano solo `vendor/firebase.js` e `vendor/xlsx.js`
    (grandi, si salvano al primo uso). Il test `tests/sw-precache.test.mjs` fallisce se un file di `js/` o `css/` non finisce nel precache.
  - Bug corretto: dopo la sola prima apertura l'app **non partiva offline** (mancavano file caricati pigramente, es. `weekassign.js`, `home.css`).
  - Installazione **tutto o niente** per i file indispensabili (`CORE`): se uno non si scarica l'installazione fallisce e resta la versione
    precedente, invece di attivare una cache a metà e cancellare quella buona.
  - Avvio dalla cache (index.html e `config.js` non aspettano più la rete: prima `network-first` con attese fino a 6 s e 4 s su rete lenta).
  - Aggiornamento **senza file mescolati**: prima la riconferma `stale-while-revalidate` scriveva file nuovi nella cache della versione vecchia
    mentre la nuova era in attesa. Ora la riconferma avviene solo se sul server c'è la stessa VERSION (controllo di `sw.js`) e nessun worker
    nuovo è in attesa/installazione; se cambia un file senza nuova VERSION, si riscarica l'intero insieme in un colpo solo.
  - Verificato in un browser vero da `tests/e2e/sw-update.e2e.mjs` (offline su tutte le rotte, nuova VERSION in attesa = tutto ancora vecchio
    dopo 3 riaperture, «Aggiorna» = tutto nuovo e cache vecchia cancellata, modifica senza nuova VERSION riallineata, server giù = nessuna
    installazione a metà). Con il vecchio `sw.js` lo stesso test fallisce già al primo punto (`SW_SRC=<vecchio sw.js>`).
- **`index.html`**: `config.js` con `defer` (non blocca più il primo disegno); piccolo script iniziale che applica tema scelto a mano, accento,
  dimensione testo e movimento ridotto **prima** del primo disegno (niente lampo chiaro con tema scuro forzato); `modulepreload` dei moduli sempre
  necessari e, aprendo sulla Home, di `home.js`, `choresheet.js` e `home.css` (meno attese in fila).
- **`js/app.js`**
  - Ridisegni mirati: se cambiano solo `members`/`log`/`views` e si è su Home, Settimane, Assenze o Classifica (che non li leggono) non si
    ridisegna e non si ricalcola il piano; la barra in alto (stato di sincronizzazione) si aggiorna comunque. Anche i cambi di solo stato di
    sincronizzazione non ridisegnano più la pagina.
  - Salvataggio locale che **segnala la memoria piena** (prima l'errore di quota era ignorato in silenzio e le modifiche andavano perse): libera
    i vecchi accessi, riprova, altrimenti avvisa con un toast (`perf.quota`, IT+EN in `js/strings/perf.js`).
  - In modalità locale gli accessi (`views`) non avevano limite: oltre 400 si tolgono i 150 più vecchi (nel cloud già li pota il server).
  - Cambio di giorno o di fuso con l'app aperta/in background: ridisegna (settimana, «oggi», scadenze) – prima restava la schermata di ieri fino al prossimo dato.
  - Errori di render non gestiti ora vengono catturati; la scheda di errore ha il pulsante «Ricarica» (file mancante per aggiornamento a metà o rete assente).
  - `theme-color` segue il tema scelto a mano (prima il codice puntava a un meta che non esisteva).
  - Nei tempi morti, solo se i file arrivano dalla cache del SW, prepara (`modulepreload`) le quattro schermate principali.

## Non fatto / non verificato

- `js/i18n.js` (77 KB, ~26 KB gzip, IT+EN insieme) è il file più grosso all'avvio: separare l'inglese si può fare solo cambiando anche
  `scripts/` e `registerStrings`, fuori dalla mia area. Non toccato.
- Telefoni veri (iOS/Android), rete mobile reale, installazione PWA vera, update del SW con GitHub Pages reale (verificato solo con un server
  locale che imita ETag/cache): da provare dopo la prossima release. L'effetto del precache più grande è +60 KB scaricati una volta a ogni release.
- Il percorso `quota piena` è coperto per lettura del codice e non da un test e2e; `LocalBackend` (`js/store.js`) resta com'è: il salvataggio
  protetto è agganciato da `app.js` dopo l'apertura.
- Ridisegno mirato solo per `members/log/views`; gli altri dati (e le altre schermate) ridisegnano ancora la schermata intera.
- Cloud (Firestore) e la parte push non misurati con rete reale.
