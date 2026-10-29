# Audit admin · «Altro» e «Impostazioni» (ottobre 2026)

Problema riferito dall'utente: per l'admin l'app sembra «pile di bottoni e impostazioni buttate lì» dai vari aggiornamenti.
Metodo: lettura di `js/screens/more.js` e `js/screens/settings.js`, percorso dei compiti admin più comuni contato a mano
dalla Home (390×844), verifica con Playwright (`tests/e2e/ux-b.e2e.mjs`, scenari «admin:»). Nessuna funzione tolta: solo spostata, rinominata o raggruppata.

## Criticità

| # | Gravità | Dove | Problema | Soluzione |
|---|---|---|---|---|
| 1 | M | Altro (admin) | Le cose da admin sono sparse: «Recuperi e riposi», «Esporta dati» e «Invita» stanno nel gruppo «Gestione» **sotto** sette righe di «In casa» e il pulsante IA (serve scorrere a 390 px). «Correggi chi ha pulito», «Assegna la settimana» e «Nuova assenza» per un altro non sono in Altro: bisogna ricordarsi che stanno dentro le schede delle settimane. | Blocco **«Gestione casa»** (solo admin) in cima: 4 azioni rapide (Recuperi e riposi, Cambia turni, Correggi chi ha pulito, Nuova assenza) + Persone, Invito e codice, Dati ed export, Importa con IA, Tutte le impostazioni. |
| 2 | M | Altro | Pulsante IA largo e isolato tra due gruppi (`mx-ai`), con icona «scintille» (contro lo stile del progetto). | Diventa una riga di «Gestione casa» con icona neutra; stessa funzione e stesso testo. |
| 3 | M | Impostazioni, indice admin | 15 sezioni divise per tema tecnico («La casa», «Notifiche e persone», «Avanzate»): «Coinquilini» è in mezzo alle regole, «Cambia admin» è in «Avanzate › Sicurezza admin» sotto il cambio PIN, «Recuperi e riposi» non c'è e la ricerca non lo trova. | Gruppi per intento e frequenza: **Per te** · **Gestione casa** (Recuperi e riposi, Persone, Invito e codice, Regole dei turni, Notifiche della casa, Admin e PIN, Dati ed export) · **Casa e funzioni** · **Avanzate** (Accessi, IA). La ricerca trova anche le azioni (recuperi, riposi, turni, risultato). |
| 4 | M | Nomi | Stessa pagina con nomi diversi: «Invita coinquilini» (Altro) / «Invito» (Impostazioni); «Esporta dati» / «Dati e backup»; «Casa» (sezione) dentro il gruppo «La casa»; «Sicurezza admin» per una pagina usata soprattutto per cambiare admin. | Un nome per pagina: «Invito e codice», «Dati ed export», «Nome, lingua e obblighi», «Admin e PIN». |
| 5 | B | Admin e PIN | La pagina si apre con una scheda «Funzioni admin sbloccate» che non fa nulla (la pagina si vede solo da sbloccati) e il cambio admin sta sotto il cambio PIN. | Tolta la scheda inutile (lo stato è nel foot); prima «Cambia admin», poi «Cambia PIN», poi «Blocca». |
| 6 | B | Regole dei turni | Otto controlli tutti allo stesso livello: quelli che si toccano (tolleranza, riposo, notti di assenza, penalità) in mezzo a quelli rari (vantaggio iniziale, settimane in classifica, punti fatica, criterio classifica). | I rari in una sezione richiudibile **«Avanzate»** (chiusa; si apre da sola se un valore è diverso dal predefinito). |
| 7 | B | Invito | Per cambiare il codice bisogna scorrere oltre codice, link e QR senza sapere che la funzione è lì. | Pulsante «Cambia codice» (solo admin) nella scheda dell'invito che porta al blocco; il link `#/settings/invite/rotate` lo apre già in vista. |
| 8 | B | Icone | Le icone si ripetono con significati diversi: `refresh` per Recuperi e riposi, Compiti condivisi e «cambia codice»; `sparkles` per Aspetto e IA. | Recuperi e riposi `wallet`, Aspetto `moon`, IA `edit`. |
| 9 | B | Altro | Versione ripetuta due volte (riga «Informazioni» + piè di pagina). | Resta solo il piè di pagina; la riga dice cosa contiene. |

### Bug veri trovati
- **Ricerca impostazioni**: «recuperi», «riposo», «correggi» non davano risultati anche se la funzione esiste (solo admin) → corretta (azioni nella ricerca).
- **Indice per l'admin**: nessuno (contatori e permessi ok). **Altro**: l'ordine delle righe «In casa» non seguiva l'uso (Ultimo che esce prima di Compiti condivisi) → riordinato: Spesa, Scambi, Compiti condivisi, Checklist, Ultimo che esce, Regole, Registro.

## Tocchi prima → dopo (admin, dalla Home, 390×844)

| Compito | Prima | Dopo |
|---|---|---|
| Aprire Recuperi e riposi | 2 + scorrere (Altro, scroll, riga) | 2 senza scorrere (Altro, «Recuperi e riposi»); anche da Impostazioni (2) e dalla ricerca |
| Cambiare chi ha un turno (settimana corrente) | 3 (Settimane, settimana, «Assegna la settimana») | 2 (Altro, «Cambia turni») |
| Correggere un risultato (settimana passata) | 4–5 (Settimane, [mese], settimana, mansione, «Correggi») | 3 (Altro, «Correggi chi ha pulito», turno) |
| Aggiungere un'assenza per un altro | 1 dalla Home se il widget c'è, altrimenti 2 (Assenze, «Nuova assenza») | invariato + 2 da Altro (Nuova assenza) |
| Ruotare il codice | 2 + scorrere oltre il QR, poi «Genera» + conferma | 3 senza scorrere (Altro, Invito e codice, «Cambia codice»), poi «Genera» + conferma |
| Cambiare admin | 3 + scorrere 2 volte (ingranaggio, scroll, Sicurezza, scroll oltre il PIN) | 2 senza scorrere (ingranaggio, «Admin e PIN»: il modulo è il primo) |
| Esportare (Excel) | 3 + scorrere (Altro, scroll, Esporta dati, Excel) | 3 senza scorrere (Altro, Dati ed export, Excel) |

## Non cambiato (di proposito)
- Le 15 sezioni restano tutte (stesse rotte `#/settings/<sezione>`), «Rapide», «Aperte spesso» e la ricerca restano.
- Le funzioni dei fogli (bilancio, assegna settimana, correggi risultato, nuova assenza) sono quelle di `balance.js`, `weekassign.js`, `resultedit.js`, `trips.js`: Altro le apre e basta.

## Non verificato
Telefono vero (solo emulazione Playwright); lettori di schermo; Firestore reale con due dispositivi.
