// Motore dei turni: porting fedele della logica del foglio Excel "House Cleaning Plan", generalizzato a N persone (fino a 8 slot)
// e M mansioni (house.chores). Con 4 slot e le 3 mansioni predefinite il risultato e' IDENTICO al foglio (tests/parity, tests/engine-n
// confronta anche con la copia congelata tests/legacy/engine-v1.mjs). Regole estese: vedi ARCHITECTURE.md, «Motore: N persone, M mansioni».
// Modulo puro (nessun accesso a DOM/rete): usato sia dall'app che dallo script delle notifiche.
//
// Mappa colonne del foglio "Log" -> nomi qui sotto (tra parentesi):
//   away (C:E)  result (J:L)  assegnazioni (F:I)  debiti db[c] (AK:AV)  crediti riposo cr (AW:AZ)
//   priorita' sc[c] (BJ:BU)  recupero rec[c] (BV:BX)  pagamento diretto (CP:ED)  esito cleaner (EZ:FB)
//
// Convenzioni: le date sono stringhe 'YYYY-MM-DD'; internamente numeri di giorno (UTC).
// Persone identificate per id (nel foglio erano i nomi). Mansione c = indice in choresOf(house) (predefinite: 0=floor 1=bathroom 2=kitchen).

/** Id delle 3 mansioni predefinite (compatibilita': per una casa con altre mansioni usa choresOf(house)). */
export const CHORES = ['floor', 'bathroom', 'kitchen'];
/** Numero massimo di slot (persone in turno contemporaneamente). */
export const MAX_SLOTS = 8;
/** Numero massimo di mansioni considerate (le altre vengono ignorate). */
export const MAX_CHORES = 12;
/** Mansioni predefinite (usate quando house.chores manca o e' vuoto). L'effort vero arriva da house.effort. */
export const DEFAULT_CHORES = Object.freeze([
  Object.freeze({ id: 'floor', name: Object.freeze({ it: 'Pavimenti', en: 'Floor' }), icon: 'broom', effort: 1 }),
  Object.freeze({ id: 'bathroom', name: Object.freeze({ it: 'Bagno', en: 'Bathroom' }), icon: 'shower', effort: 1 }),
  Object.freeze({ id: 'kitchen', name: Object.freeze({ it: 'Cucina', en: 'Kitchen' }), icon: 'pot', effort: 1 }),
]);
/** Valore speciale di `swap[chore]`: l'admin ha deciso che quella mansione, quella settimana, non la fa nessuno (non crea debiti né crediti). */
export const NOBODY = '-';
export const DEFAULT_SETTINGS = {
  grace: 2,          // giorni dopo la domenica per registrare i risultati (fino a martedì: è anche l'ultimo giorno scelto)
  minRest: 3,        // minimo di persone a casa per spendere un riposo
  startPriority: 4,  // priorita' iniziale (settimane) di chi non ha storico
  window: 52,        // finestra classifica TR/CDM (0 = sempre)
  minNights: 3,      // notti a casa necessarie per essere "in turno"
};

/**
 * Mansioni della casa, nell'ordine in cui il motore le assegna: [{id, name, icon, effort, builtin, from?, to?}].
 * `house.chores` (opzionale) = [{id, name: string|{it,en}, icon, effort 1-5, from?, to?}]; se manca o e' vuoto valgono le 3 predefinite
 * (effort da house.effort). `from`/`to` (opzionali, 'YYYY-MM-DD'): la mansione e' in turno solo nelle settimane (lun-dom) che toccano
 * [from, to]; servono per aggiungere una mansione senza creare debiti nelle settimane passate e per toglierla senza perdere lo storico.
 */
export function choresOf(house) {
  const eff = (house && house.effort) || {};
  const list = Array.isArray(house && house.chores) ? house.chores.filter((c) => c && typeof c.id === 'string' && c.id && c.id !== NOBODY) : [];
  const src = list.length ? list : DEFAULT_CHORES;
  const out = []; const seen = new Set();
  for (const c of src) {
    if (seen.has(c.id) || out.length >= MAX_CHORES) continue;
    seen.add(c.id);
    const def = DEFAULT_CHORES.find((d) => d.id === c.id);
    const num = (v) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const effort = (src === DEFAULT_CHORES ? num(eff[c.id]) : num(c.effort) ?? num(eff[c.id])) ?? (def ? def.effort : 1);
    out.push({
      id: c.id, name: c.name || (def ? def.name : c.id), icon: c.icon || (def ? def.icon : 'dot'), effort, builtin: !!def,
      ...(c.from ? { from: c.from } : {}), ...(c.to ? { to: c.to } : {}),
    });
  }
  return out;
}

// ---------- date ----------
export const dayNum = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (s, k) => dayStr(dayNum(s) + k);
export const todayStr = (d = new Date()) => {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
/** Domenica che chiude la settimana (lun-dom) che contiene `s`. */
export const weekEnd = (s) => {
  const n = dayNum(s);
  const dow = (n + 4) % 7; // 0=dom ... 6=sab (1970-01-01 era giovedi')
  return dayStr(n + ((7 - dow) % 7));
};
export const isSunday = (s) => (dayNum(s) + 4) % 7 === 0;

// ---------- risultati ----------
// Codifica di result[chore]:  ''  'done'  'skipped'  'by:<id>' (ha pulito <id>)  'skipped:<id>' (anche <id> ha saltato)
export const parseResult = (r) => {
  if (!r) return { kind: '' };
  if (r === 'done') return { kind: 'done' };
  if (r === 'skipped') return { kind: 'skipped' };
  if (r.startsWith('by:')) return { kind: 'by', id: r.slice(3) };
  if (r.startsWith('skipped:')) return { kind: 'skippedBy', id: r.slice(8) };
  return { kind: '' };
};

/** Assenza derivata dai viaggi: notti fuori in lun-dom; sotto `minNights` a casa => assente. */
export function awayFromTrips(trips, personId, sunday, minNights = 3) {
  const end = dayNum(sunday), start = end - 6;
  const nights = new Set(); // unione delle notti: viaggi sovrapposti non contano due volte
  for (const t of trips) {
    if (t.personId !== personId) continue;
    const a = dayNum(t.from);
    const b = t.to ? dayNum(t.to) : Infinity; // "to" = giorno di rientro (quella notte dorme a casa)
    const lo = Math.max(a, start), hi = Math.min(b - 1, end);
    for (let d = lo; d <= hi; d++) nights.add(d);
  }
  return 7 - nights.size < minNights;
}

const NEG = -1000000000;
const argmax = (arr) => { let bi = 0; for (let i = 1; i < arr.length; i++) if (arr[i] > arr[bi]) bi = i; return bi; };
const lastMap = () => new Map();        // id -> ultimo indice P
const cnt = (m, k) => m.get(k) || 0;
const inc = (m, k, d = 1) => { if (k) m.set(k, cnt(m, k) + d); };
const IDLE_DEPTH = 4;                   // quante settimane di lavoro recenti confronta la scelta «chi è fermo da più tempo»
const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

/** Numero di slot usati dalla casa: almeno 4 (come il foglio), al massimo MAX_SLOTS. */
export function slotsOf(roommates) {
  let n = 4;
  for (const r of roommates || []) if (r && r.name !== '' && Number.isInteger(r.slot) && r.slot > n && r.slot <= MAX_SLOTS) n = r.slot;
  return n;
}

/**
 * @param {object} house { startSunday, roommates:[{id,name,slot,from,to}], chores?, effort?, settings, weeks:{[sunday]:{away:[ids],everyone,result:{[choreId]},swap:{...},adj}}, trips:[{personId,from,to}] }
 * @param {string} today 'YYYY-MM-DD'
 * @param {number} horizon settimane di anteprima dopo la corrente
 * @returns {{rows, cur, settings, summary, chores}} `chores` = choresOf(house); ogni array «per mansione» delle righe segue quell'ordine.
 */
export function compute(house, today, horizon = 12) {
  const S = { ...DEFAULT_SETTINGS, ...(house.settings || {}) };
  const rms = house.roommates || [];
  const trips = house.trips || [];
  const CH = choresOf(house);
  const ids = CH.map((c) => c.id);
  const M = CH.length;
  const CI = Array.from({ length: M }, (_, c) => c);
  const NS = slotsOf(rms);
  const SL = Array.from({ length: NS }, (_, s) => s);
  const chFrom = CH.map((c) => (c.from ? dayNum(c.from) : -Infinity));
  const chTo = CH.map((c) => (c.to ? dayNum(c.to) : Infinity));
  const start = dayNum(house.startSunday);
  const t = dayNum(today);
  const curIdx0 = Math.floor((t - start + 6) / 7); // 0-based, <0 prima dell'inizio
  let lastData = 0;
  for (const k of Object.keys(house.weeks || {})) lastData = Math.max(lastData, Math.floor((dayNum(k) - start) / 7));
  const n = Math.max(curIdx0 + horizon + 1, lastData + 1, 1);

  // contatori cumulativi sulle righe precedenti (uno per mansione: nel foglio FC:FE, FF:FH, FI:FK)
  const C = {
    da: CH.map(() => new Map()),     // debito per "non pulito"
    sb: CH.map(() => new Map()),     // debito da "Skipped (Name)"
    dp: CH.map(() => new Map()),     // debito pagato
    cov: new Map(),                  // FO+FP+FQ  (volte che ha pulito per altri)
    adjCr: new Map(),                // correzioni manuali dell'admin ai crediti di riposo (non è nel foglio)
    ru: new Map(),                   // FR        (riposi usati)
  };
  const lastClean = CH.map(() => lastMap());   // ultimo P in cui ha pulito (EZ/FA/FB)
  const lastCover = CH.map(() => lastMap());   // ultimo P in cui ha coperto (FO/FP/FQ)
  const lastSettle = lastMap();                // ultimo P di pagamento diretto (DJ/DK/DL)
  const assignedHist = CH.map(() => []);       // F/G/H per riga
  const work = new Map();                      // (regole estese) id -> settimane P in cui ha pulito qualcosa, dalla più recente (max IDLE_DEPTH)
  const rows = [];
  let prev = null;

  const debt = (c, id) => Math.max(0, cnt(C.da[c], id) + cnt(C.sb[c], id) - cnt(C.dp[c], id));   // il max(0) scatta solo con correzioni manuali (adj): nel foglio il debito non è mai negativo

  for (let i = 0; i < n; i++) {
    const P = i + 1;
    const sunday = dayStr(start + 7 * i);
    const B = start + 7 * i;
    const wk = (house.weeks && house.weeks[sunday]) || {};
    const closed = t > B + S.grace ? 1 : 0;               // Q
    const isCur = t <= B && t > B - 7 ? 1 : 0;            // R
    const isFut = t <= B - 7 ? 1 : 0;                     // S
    const act = CH.map((_, c) => chFrom[c] <= B && chTo[c] >= B - 6);   // mansione in turno questa settimana
    const Mact = act.filter(Boolean).length;

    // slot -> persona attiva (T:W / X:AA)
    const nm = SL.map((s) => {
      const r = rms.find((x) => x.slot === s + 1 && x.name !== '' &&
        (!x.from || dayNum(x.from) <= B) && (!x.to || dayNum(x.to) >= B - 6));
      return r ? r.id : '';
    });
    const awaySet = new Set(wk.away || []);
    const pr = nm.map((id) => (id && !wk.everyone && !awaySet.has(id) &&
      !awayFromTrips(trips, id, sunday, S.minNights) ? 1 : 0)); // AB:AE
    const npres = pr.reduce((a, b) => a + b, 0);
    // correzioni manuali dell'admin (weeks/{domenica}.adj = {id:{<choreId>…,credit}}): + = recuperi/riposi in più, − = tolti; valgono da questa settimana in poi.
    // Senza `adj` (tutti i dati del foglio) questo blocco non fa nulla: la logica di assegnazione resta quella del foglio.
    for (const [id, a] of Object.entries(wk.adj || {})) {
      if (!a || !nm.includes(id)) continue;
      CH.forEach((ch, c) => {
        const v = Math.trunc(+a[ch.id]) || 0;
        if (v > 0) inc(C.da[c], id, v); else if (v < 0) inc(C.dp[c], id, -v);
      });
      inc(C.adjCr, id, Math.trunc(+a.credit) || 0);
    }
    const jn = nm.map((id, s) => (id ? (prev && prev.nm[s] === id ? prev.jn[s] : P) : 0));
    const db = CH.map((_, c) => nm.map((id) => (id ? debt(c, id) : 0)));   // db[c][s]
    const dbSum = nm.map((_, s) => db.reduce((a, d) => a + d[s], 0));
    const cr = nm.map((id) => (id ? cnt(C.cov, id) - cnt(C.ru, id) + cnt(C.adjCr, id) : 0));
    // «casa larga»: almeno 2 persone a casa in più delle mansioni (mai con 4 slot e 3 mansioni: li' valgono alla lettera le regole del foglio)
    const wide = npres >= Mact + 2;

    // pagamento diretto: chi ha coperto per qualcuno viene "ripagato" quando entrambi sono a casa
    const owedIdx = nm.map((id) => CI.map((c) => (id ? cnt(lastCover[c], id) : 0))); // CP:DA
    const owedMax = owedIdx.map((a) => Math.max(0, ...a)); // DB:DE
    const owedDebtor = owedMax.map((mx, s) => (mx === 0 ? '' : assignedHist[owedIdx[s].indexOf(mx)][mx - 1] || '')); // DF:DI
    const settled = nm.map((id) => (id ? cnt(lastSettle, id) : 0)); // DM:DP
    const owedBy = owedMax.map((mx, s) => (mx > settled[s] ? owedDebtor[s] : '')); // DQ:DT

    /** Assegnazione secondo le regole con `rslot` (1-based, 0 = nessuno) a riposo. */
    const plan = (rslot) => {
      const el = nm.map((id, s) => (pr[s] === 1 && rslot !== s + 1 ? 1 : 0)); // BF:BI
      const sc = CI.map((c) => nm.map((id, s) => (el[s] === 1
        ? db[c][s] * 100000 + P - Math.max(cnt(lastClean[c], id), jn[s] - S.startPriority) - (s + 1) / 100
        : NEG)));
      // recupero: chi ha debito in quella mansione la rifà (anche se ne ha già un'altra)
      const rec = CI.map((c) => (act[c] && Math.max(...sc[c]) >= 99999 ? argmax(sc[c]) + 1 : 0));
      const chain = CI.filter((c) => act[c] && !rec[c]);
      // chi può prendere le mansioni «a turno»: tutti gli eleggibili; in una casa larga solo i K fermi da più tempo (K = mansioni da dare)
      let pool = el;
      if (wide) {
        // chi è fermo da più tempo: settimane in cui ha pulito (le ultime IDLE_DEPTH, dalla più recente), completate con «entrato − startPriority»
        const idle = nm.map((id, s) => { const w = (work.get(id) || []).filter((x) => x > jn[s] - S.startPriority); while (w.length < IDLE_DEPTH) w.push(jn[s] - S.startPriority); return w; });
        const order = SL.filter((s) => el[s] === 1).sort((a, b) => (lexLess(idle[a], idle[b]) ? -1 : lexLess(idle[b], idle[a]) ? 1 : a - b));
        pool = nm.map(() => 0); for (const s of order.slice(0, chain.length)) pool[s] = 1;
      }
      // catena: per ogni mansione, nell'ordine, chi ha meno mansioni già prese dalla catena; a parità chi le ha prese più avanti
      // nella catena (nel foglio: penalità 1e6/2e6, chi ha il pavimento è l'ultimo a prendere altro); poi la priorità sc; poi lo slot.
      const bp = CI.map(() => 0); const held = nm.map(() => []);
      for (const c of chain) {
        let best = -1, bk = null;
        for (const s of SL) {
          if (pool[s] !== 1) continue;
          const k = [held[s].length, held[s].reduce((a, j) => a + (c - j), 0), -sc[c][s]];
          if (best < 0 || lexLess(k, bk)) { best = s; bk = k; }
        }
        if (best >= 0) { bp[c] = best + 1; held[best].push(c); }
      }
      const asl = CI.map((c) => (rec[c] > 0 ? rec[c] : bp[c])); // CJ:CL
      const finalAsl = CI.map(() => 0), settleName = CI.map(() => '');
      for (const c of CI) {
        const cred = rec[c] === 0 && asl[c] > 0 ? owedBy[asl[c] - 1] : ''; // DU:DW
        const dslot = cred ? nm.indexOf(cred) + 1 : 0;                       // DX:DZ
        const dpres = dslot ? pr[dslot - 1] : 0;                             // EA:EC
        const pay = cred && dslot > 0 && dpres === 1;
        finalAsl[c] = pay ? dslot : asl[c];                                   // ED:EF
        settleName[c] = pay ? nm[asl[c] - 1] : '';                            // DJ:DL
      }
      return { el, rec, finalAsl, settleName };
    };

    // riposo: chi ha crediti, nessun debito, e abbastanza persone a casa
    const rsc = nm.map((id, s) => (pr[s] === 1 && cr[s] > 0 && dbSum[s] === 0 && npres >= Math.max(2, S.minRest)
      ? cr[s] * 100 - (s + 1) / 100 : -1));
    let rslot = Math.max(...rsc) > 0 ? argmax(rsc) + 1 : 0; // BE
    let A;
    if (wide && rslot) {
      // casa larga: il riposo si spende solo se serve (a chi, senza riposo, avrebbe una mansione); altrimenti il credito resta
      const A0 = plan(0);
      const cand = rsc.map((v, s) => (A0.finalAsl.includes(s + 1) ? v : -1));
      rslot = Math.max(...cand) > 0 ? argmax(cand) + 1 : 0;
      A = rslot ? plan(rslot) : A0;
    } else A = plan(rslot);
    const { el, rec, finalAsl, settleName } = A;

    // swap manuale (celle grigie sovrascritte a mano nel foglio)
    const swap = wk.swap || {};
    const assigned = CI.map((c) => {
      if (!act[c]) return '';
      if (swap[ids[c]]) return swap[ids[c]] === NOBODY ? '' : swap[ids[c]];
      return finalAsl[c] ? nm[finalAsl[c] - 1] : '';
    }); // F:H
    const restName = rslot ? nm[rslot - 1] : ''; // BE

    // sostituti equi suggeriti (EW:EY)
    const help = nm.map((id) => (id ? cnt(C.cov, id) : 0));
    const subs = CI.map((c) => {
      if (!act[c]) return '';
      if (rslot > 0) return nm[rslot - 1];
      const cand = nm.map((id, s) => (el[s] === 1 && s + 1 !== finalAsl[c] ? -help[s] : NEG));
      return Math.max(...cand) <= -100000000 ? '' : nm[argmax(cand)];
    });

    // risultati
    const res = CI.map((c) => parseResult((wk.result || {})[ids[c]]));
    const cleaner = CI.map((c) => {
      const F = assigned[c], r = res[c];
      if (!F) return '';
      if (r.kind === 'done') return F;
      if (r.kind === 'skipped' || r.kind === 'skippedBy') return '';
      if (r.kind === 'by') return r.id;
      return closed ? '' : F;
    }); // EZ:FB
    const isMakeup = CI.map((c) => (assigned[c] && debt(c, assigned[c]) > 0 ? 1 : 0)); // CM:CO
    const da = CI.map((c) => (assigned[c] && !isMakeup[c] && cleaner[c] !== assigned[c] ? assigned[c] : '')); // FC:FE
    const daSub = CI.map((c) => (act[c] && res[c].kind === 'skippedBy' ? res[c].id : '')); // FF:FH
    const dp = CI.map((c) => (assigned[c] && isMakeup[c] && cleaner[c] === assigned[c] ? assigned[c] : '')); // FI:FK
    const sk = CI.map((c) => (assigned[c] && cleaner[c] === '' ? (res[c].kind === 'skippedBy' ? res[c].id : assigned[c]) : '')); // FL:FN
    const sb = CI.map((c) => (assigned[c] && cleaner[c] && cleaner[c] !== assigned[c] ? cleaner[c] : '')); // FO:FQ
    const asSet = new Set(assigned.filter(Boolean));
    const ru = restName && !asSet.has(restName) ? restName : ''; // FR
    const rest = nm.filter((id, s) => pr[s] === 1 && id && !asSet.has(id)); // FS:FV -> colonna Rest

    const nAss = assigned.filter(Boolean).length;
    const nSk = sk.filter(Boolean).length;
    const nPend = CI.filter((c) => assigned[c] && !res[c].kind && !closed).length; // FY
    const status = npres === 0 ? 'empty' : nAss === 0 ? 'none' : nSk > 0 ? 'skipped'
      : nPend === 0 ? 'done' : isFut ? 'preview' : isCur ? 'progress' : 'tolog';

    const row = {
      P, sunday, closed, isCur, isFut, nm, pr, npres, jn, assigned, rest, restName, subs, isMakeup, rec,
      result: CI.map((c) => (wk.result || {})[ids[c]] || ''),
      res, cleaner, da, daSub, dp, sk, sb, ru, nAss, nSk, nPend, status,
      away: nm.filter((id, s) => id && pr[s] === 0),
      swapped: CI.map((c) => act[c] && !!swap[ids[c]]),
      debts: nm.map((id, s) => (id ? CI.map((c) => db[c][s]) : null)),
      credits: cr,
      adj: wk.adj || null,
      chores: ids,     // id delle mansioni (stesso ordine di tutti gli array per mansione)
      active: act,     // mansione in turno questa settimana (from/to)
      // perché la mansione è di chi ce l'ha: 'off' fuori periodo, 'manual' swap, 'makeup' recupero, 'repay' pagamento diretto, 'turn' a turno, '' nessuno
      how: CI.map((c) => (!act[c] ? 'off' : swap[ids[c]] ? 'manual' : !finalAsl[c] ? '' : rec[c] ? 'makeup' : settleName[c] ? 'repay' : 'turn')),
    };
    rows.push(row);

    // aggiorna accumulatori (per le righe successive)
    for (const c of CI) {
      assignedHist[c].push(assigned[c]);
      if (cleaner[c]) lastClean[c].set(cleaner[c], P);
      if (sb[c]) { lastCover[c].set(sb[c], P); inc(C.cov, sb[c]); }
      if (settleName[c]) lastSettle.set(settleName[c], P);
      inc(C.da[c], da[c]); inc(C.sb[c], daSub[c]); inc(C.dp[c], dp[c]);
    }
    inc(C.ru, ru);
    for (const id of new Set(cleaner.filter(Boolean))) work.set(id, [P, ...(work.get(id) || [])].slice(0, IDLE_DEPTH));
    prev = row;
  }

  const cur = curIdx0 >= 0 && curIdx0 < n ? curIdx0 : -1;
  return { rows, cur, settings: S, summary: summarize(house, rows, cur, S), chores: CH };
}

/** Classifica TR/CDM + make-up e riposi aperti (foglio Home). `makeups[c]` segue choresOf(house). */
export function summarize(house, rows, cur, S) {
  if (cur < 0) return { people: [], from: 1 };
  const ids = choresOf(house).map((c) => c.id);
  const M = ids.length;
  const J2 = cur + 1;
  const from = S.window === 0 ? 1 : Math.max(1, J2 - S.window + 1); // J5
  const row = rows[cur];
  const people = row.nm.filter(Boolean).map((id) => {
    let cleaned = 0, skipped = 0, rests = 0;
    const mk = ids.map(() => 0);
    for (const r of rows) {
      if (r.P <= J2) {
        const a = r.adj && r.adj[id];
        if (a) { for (let c = 0; c < M; c++) mk[c] += Math.trunc(+a[ids[c]]) || 0; rests += Math.trunc(+a.credit) || 0; }
        for (let c = 0; c < M; c++) {
          if (r.da[c] === id) mk[c]++;
          if (r.daSub[c] === id) mk[c]++;
          if (r.dp[c] === id) mk[c]--;
          if (r.sb[c] === id) rests++;
        }
        if (r.ru === id) rests--;
      }
      if (r.closed && r.P >= from) {
        for (let c = 0; c < M; c++) {
          if (r.cleaner[c] === id) cleaned++;
          if (r.sk[c] === id) skipped++;
        }
      }
    }
    const rm = house.roommates.find((x) => x.id === id);
    return { id, name: rm ? rm.name : id, cleaned, skipped, makeups: mk, rests };
  });
  const maxC = Math.max(0, ...people.map((p) => p.cleaned));
  for (const p of people) { p.tr = p.cleaned > 0 && p.cleaned === maxC; p.cdm = p.skipped > 0; }
  return { people, from };
}

/** Verifica gli slot dei coinquilini (foglio Roommates, cella B18): slot intero 1..MAX_SLOTS, un solo attivo per slot. */
export function validateRoommates(roommates, today) {
  const t = dayNum(today);
  const active = roommates.filter((r) => r.name && (!r.from || dayNum(r.from) <= t) && (!r.to || dayNum(r.to) >= t));
  const issues = [];
  if (roommates.some((r) => r.name && !(Number.isInteger(r.slot) && r.slot >= 1 && r.slot <= MAX_SLOTS))) issues.push('slotRange');
  for (let s = 1; s <= MAX_SLOTS; s++) if (active.filter((r) => r.slot === s).length > 1) issues.push('slotDup');
  return issues;
}
