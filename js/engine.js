// Motore dei turni: porting fedele della logica del foglio Excel "House Cleaning Plan".
// Modulo puro (nessun accesso a DOM/rete): usato sia dall'app che dallo script delle notifiche.
//
// Mappa colonne del foglio "Log" -> nomi qui sotto (tra parentesi):
//   away (C:E)  result (J:L)  assegnazioni (F:I)  debiti dbP/dbB/dbC (AK:AV)  crediti riposo cr (AW:AZ)
//   priorita' sc* (BJ:BU)  recupero rec* (BV:BX)  pagamento diretto (CP:ED)  esito cleaner (EZ:FB)
//
// Convenzioni: le date sono stringhe 'YYYY-MM-DD'; internamente numeri di giorno (UTC).
// Persone identificate per id (nel foglio erano i nomi). Chore: 0=floor 1=bathroom 2=kitchen.

export const CHORES = ['floor', 'bathroom', 'kitchen'];
/** Valore speciale di `swap[chore]`: l'admin ha deciso che quella mansione, quella settimana, non la fa nessuno (non crea debiti né crediti). */
export const NOBODY = '-';
export const DEFAULT_SETTINGS = {
  grace: 1,          // giorni dopo la domenica per registrare i risultati
  minRest: 3,        // minimo di persone a casa per spendere un riposo
  startPriority: 4,  // priorita' iniziale (settimane) di chi non ha storico
  window: 52,        // finestra classifica TR/CDM (0 = sempre)
  minNights: 3,      // notti a casa necessarie per essere "in turno"
};

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

/**
 * @param {object} house { startSunday, roommates:[{id,name,slot,from,to}], settings, weeks:{[sunday]:{away:[ids],everyone,result:{floor,bathroom,kitchen},swap:{...}}}, trips:[{personId,from,to}] }
 * @param {string} today 'YYYY-MM-DD'
 * @param {number} horizon settimane di anteprima dopo la corrente
 */
export function compute(house, today, horizon = 12) {
  const S = { ...DEFAULT_SETTINGS, ...(house.settings || {}) };
  const rms = house.roommates || [];
  const trips = house.trips || [];
  const start = dayNum(house.startSunday);
  const t = dayNum(today);
  const curIdx0 = Math.floor((t - start + 6) / 7); // 0-based, <0 prima dell'inizio
  let lastData = 0;
  for (const k of Object.keys(house.weeks || {})) lastData = Math.max(lastData, Math.floor((dayNum(k) - start) / 7));
  const n = Math.max(curIdx0 + horizon + 1, lastData + 1, 1);

  // contatori cumulativi sulle righe precedenti
  const C = {
    daP: new Map(), daB: new Map(), daC: new Map(),     // FC FD FE  (debito per "non pulito")
    sbP: new Map(), sbB: new Map(), sbC: new Map(),     // FF FG FH  (debito da "Skipped (Name)")
    dpP: new Map(), dpB: new Map(), dpC: new Map(),     // FI FJ FK  (debito pagato)
    cov: new Map(),                                     // FO+FP+FQ  (volte che ha pulito per altri)
    adjCr: new Map(),                                   // correzioni manuali dell'admin ai crediti di riposo (non è nel foglio)
    ru: new Map(),                                      // FR        (riposi usati)
  };
  const lastClean = [lastMap(), lastMap(), lastMap()];  // ultimo P in cui ha pulito (EZ/FA/FB)
  const lastCover = [lastMap(), lastMap(), lastMap()];  // ultimo P in cui ha coperto (FO/FP/FQ)
  const lastSettle = lastMap();                         // ultimo P di pagamento diretto (DJ/DK/DL)
  const assignedHist = [[], [], []];                    // F/G/H per riga
  const rows = [];
  let prev = null;

  const debt = (chore, id) => {
    const [a, b, c] = [['daP', 'sbP', 'dpP'], ['daB', 'sbB', 'dpB'], ['daC', 'sbC', 'dpC']][chore];
    return Math.max(0, cnt(C[a], id) + cnt(C[b], id) - cnt(C[c], id));   // il max(0) scatta solo con correzioni manuali (adj): nel foglio il debito non è mai negativo
  };

  for (let i = 0; i < n; i++) {
    const P = i + 1;
    const sunday = dayStr(start + 7 * i);
    const B = start + 7 * i;
    const wk = (house.weeks && house.weeks[sunday]) || {};
    const closed = t > B + S.grace ? 1 : 0;               // Q
    const isCur = t <= B && t > B - 7 ? 1 : 0;            // R
    const isFut = t <= B - 7 ? 1 : 0;                     // S

    // slot -> persona attiva (T:W / X:AA)
    const nm = [0, 1, 2, 3].map((s) => {
      const r = rms.find((x) => x.slot === s + 1 && x.name !== '' &&
        (!x.from || dayNum(x.from) <= B) && (!x.to || dayNum(x.to) >= B - 6));
      return r ? r.id : '';
    });
    const awaySet = new Set(wk.away || []);
    const pr = nm.map((id) => (id && !wk.everyone && !awaySet.has(id) &&
      !awayFromTrips(trips, id, sunday, S.minNights) ? 1 : 0)); // AB:AE
    const npres = pr[0] + pr[1] + pr[2] + pr[3];
    // correzioni manuali dell'admin (weeks/{domenica}.adj = {id:{floor,bathroom,kitchen,credit}}): + = recuperi/riposi in più, − = tolti; valgono da questa settimana in poi.
    // Senza `adj` (tutti i dati del foglio) questo blocco non fa nulla: la logica di assegnazione resta quella del foglio.
    for (const [id, a] of Object.entries(wk.adj || {})) {
      if (!a || !nm.includes(id)) continue;
      CHORES.forEach((ch, c) => {
        const v = Math.trunc(+a[ch]) || 0;
        if (v > 0) inc(C[['daP', 'daB', 'daC'][c]], id, v); else if (v < 0) inc(C[['dpP', 'dpB', 'dpC'][c]], id, -v);
      });
      inc(C.adjCr, id, Math.trunc(+a.credit) || 0);
    }
    const jn = nm.map((id, s) => (id ? (prev && prev.nm[s] === id ? prev.jn[s] : P) : 0));
    const dbP = nm.map((id) => (id ? debt(0, id) : 0));
    const dbB = nm.map((id) => (id ? debt(1, id) : 0));
    const dbC = nm.map((id) => (id ? debt(2, id) : 0));
    const cr = nm.map((id) => (id ? cnt(C.cov, id) - cnt(C.ru, id) + cnt(C.adjCr, id) : 0));

    // riposo: chi ha crediti, nessun debito, e abbastanza persone a casa
    const rsc = nm.map((id, s) => (pr[s] === 1 && cr[s] > 0 && dbP[s] + dbB[s] + dbC[s] === 0 && npres >= Math.max(2, S.minRest)
      ? cr[s] * 100 - (s + 1) / 100 : -1));
    const rslot = Math.max(...rsc) > 0 ? argmax(rsc) + 1 : 0; // BE
    const el = nm.map((id, s) => (pr[s] === 1 && rslot !== s + 1 ? 1 : 0)); // BF:BI

    const score = (chore, dbArr) => nm.map((id, s) => (el[s] === 1
      ? dbArr[s] * 100000 + P - Math.max(cnt(lastClean[chore], id), jn[s] - S.startPriority) - (s + 1) / 100
      : NEG));
    const scP = score(0, dbP), scB = score(1, dbB), scC = score(2, dbC);
    const recOf = (sc) => (Math.max(...sc) >= 99999 ? argmax(sc) + 1 : 0);
    const recP = recOf(scP), recB = recOf(scB), recC = recOf(scC);
    const bpP = recP > 0 ? 0 : (Math.max(...scP) > -500000000 ? argmax(scP) + 1 : 0);
    const bxB = scB.map((v, s) => v - 1000000 * (s + 1 === bpP ? 1 : 0));
    const bpB = recB > 0 ? 0 : (Math.max(...bxB) > -500000000 ? argmax(bxB) + 1 : 0);
    const bxC = scC.map((v, s) => v - 2000000 * (s + 1 === bpP ? 1 : 0) - 1000000 * (s + 1 === bpB ? 1 : 0));
    const bpC = recC > 0 ? 0 : (Math.max(...bxC) > -500000000 ? argmax(bxC) + 1 : 0);
    const asl = [recP > 0 ? recP : bpP, recB > 0 ? recB : bpB, recC > 0 ? recC : bpC]; // CJ:CL
    const rec = [recP, recB, recC];

    // pagamento diretto: chi ha coperto per qualcuno viene "ripagato" quando entrambi sono a casa
    const owedIdx = nm.map((id) => [0, 1, 2].map((c) => (id ? cnt(lastCover[c], id) : 0))); // CP:DA
    const owedMax = owedIdx.map((a) => Math.max(...a)); // DB:DE
    const owedDebtor = owedMax.map((mx, s) => {
      if (mx === 0) return '';
      const c = owedIdx[s][0] === mx ? 0 : owedIdx[s][1] === mx ? 1 : 2;
      return assignedHist[c][mx - 1] || '';
    }); // DF:DI
    const settled = nm.map((id) => (id ? cnt(lastSettle, id) : 0)); // DM:DP
    const owedBy = owedMax.map((mx, s) => (mx > settled[s] ? owedDebtor[s] : '')); // DQ:DT
    const finalAsl = [0, 0, 0], settleName = ['', '', ''];
    for (let c = 0; c < 3; c++) {
      const cred = rec[c] === 0 && asl[c] > 0 ? owedBy[asl[c] - 1] : ''; // DU:DW
      const dslot = cred ? nm.indexOf(cred) + 1 : 0;                       // DX:DZ
      const dpres = dslot ? pr[dslot - 1] : 0;                             // EA:EC
      const pay = cred && dslot > 0 && dpres === 1;
      finalAsl[c] = pay ? dslot : asl[c];                                   // ED:EF
      settleName[c] = pay ? nm[asl[c] - 1] : '';                            // DJ:DL
    }
    // swap manuale (celle grigie sovrascritte a mano nel foglio)
    const swap = wk.swap || {};
    const assigned = [0, 1, 2].map((c) => {
      if (swap[CHORES[c]]) return swap[CHORES[c]] === NOBODY ? '' : swap[CHORES[c]];
      return finalAsl[c] ? nm[finalAsl[c] - 1] : '';
    }); // F:H
    const restName = rslot ? nm[rslot - 1] : ''; // BE

    // sostituti equi suggeriti (EW:EY)
    const help = nm.map((id) => (id ? cnt(C.cov, id) : 0));
    const subs = [0, 1, 2].map((c) => {
      if (rslot > 0) return nm[rslot - 1];
      const cand = nm.map((id, s) => (el[s] === 1 && s + 1 !== finalAsl[c] ? -help[s] : NEG));
      return Math.max(...cand) <= -100000000 ? '' : nm[argmax(cand)];
    });

    // risultati
    const res = [0, 1, 2].map((c) => parseResult((wk.result || {})[CHORES[c]]));
    const cleaner = [0, 1, 2].map((c) => {
      const F = assigned[c], r = res[c];
      if (!F) return '';
      if (r.kind === 'done') return F;
      if (r.kind === 'skipped' || r.kind === 'skippedBy') return '';
      if (r.kind === 'by') return r.id;
      return closed ? '' : F;
    }); // EZ:FB
    const isMakeup = [0, 1, 2].map((c) => (assigned[c] && debt(c, assigned[c]) > 0 ? 1 : 0)); // CM:CO
    const da = [0, 1, 2].map((c) => (assigned[c] && !isMakeup[c] && cleaner[c] !== assigned[c] ? assigned[c] : '')); // FC:FE
    const daSub = [0, 1, 2].map((c) => (res[c].kind === 'skippedBy' ? res[c].id : '')); // FF:FH
    const dp = [0, 1, 2].map((c) => (assigned[c] && isMakeup[c] && cleaner[c] === assigned[c] ? assigned[c] : '')); // FI:FK
    const sk = [0, 1, 2].map((c) => (assigned[c] && cleaner[c] === '' ? (res[c].kind === 'skippedBy' ? res[c].id : assigned[c]) : '')); // FL:FN
    const sb = [0, 1, 2].map((c) => (assigned[c] && cleaner[c] && cleaner[c] !== assigned[c] ? cleaner[c] : '')); // FO:FQ
    const asSet = new Set(assigned.filter(Boolean));
    const ru = restName && !asSet.has(restName) ? restName : ''; // FR
    const rest = nm.filter((id, s) => pr[s] === 1 && id && !asSet.has(id)); // FS:FV -> colonna Rest

    const nAss = assigned.filter(Boolean).length;
    const nSk = sk.filter(Boolean).length;
    const nPend = [0, 1, 2].filter((c) => assigned[c] && !res[c].kind && !closed).length; // FY
    const status = npres === 0 ? 'empty' : nAss === 0 ? 'none' : nSk > 0 ? 'skipped'
      : nPend === 0 ? 'done' : isFut ? 'preview' : isCur ? 'progress' : 'tolog';

    const row = {
      P, sunday, closed, isCur, isFut, nm, pr, npres, jn, assigned, rest, restName, subs, isMakeup, rec,
      result: [0, 1, 2].map((c) => (wk.result || {})[CHORES[c]] || ''),
      res, cleaner, da, daSub, dp, sk, sb, ru, nAss, nSk, nPend, status,
      away: nm.filter((id, s) => id && pr[s] === 0),
      swapped: [0, 1, 2].map((c) => !!swap[CHORES[c]]),
      debts: nm.map((id, s) => (id ? [dbP[s], dbB[s], dbC[s]] : null)),
      credits: cr,
      adj: wk.adj || null,
    };
    rows.push(row);

    // aggiorna accumulatori (per le righe successive)
    for (let c = 0; c < 3; c++) {
      assignedHist[c].push(assigned[c]);
      if (cleaner[c]) lastClean[c].set(cleaner[c], P);
      if (sb[c]) { lastCover[c].set(sb[c], P); inc(C.cov, sb[c]); }
      if (settleName[c]) lastSettle.set(settleName[c], P);
    }
    inc(C.daP, da[0]); inc(C.daB, da[1]); inc(C.daC, da[2]);
    inc(C.sbP, daSub[0]); inc(C.sbB, daSub[1]); inc(C.sbC, daSub[2]);
    inc(C.dpP, dp[0]); inc(C.dpB, dp[1]); inc(C.dpC, dp[2]);
    inc(C.ru, ru);
    prev = row;
  }

  const cur = curIdx0 >= 0 && curIdx0 < n ? curIdx0 : -1;
  return { rows, cur, settings: S, summary: summarize(house, rows, cur, S) };
}

/** Classifica TR/CDM + make-up e riposi aperti (foglio Home). */
export function summarize(house, rows, cur, S) {
  if (cur < 0) return { people: [], from: 1 };
  const J2 = cur + 1;
  const from = S.window === 0 ? 1 : Math.max(1, J2 - S.window + 1); // J5
  const row = rows[cur];
  const people = row.nm.filter(Boolean).map((id) => {
    let cleaned = 0, skipped = 0, mk = [0, 0, 0], rests = 0;
    for (const r of rows) {
      if (r.P <= J2) {
        const a = r.adj && r.adj[id];
        if (a) { for (let c = 0; c < 3; c++) mk[c] += Math.trunc(+a[CHORES[c]]) || 0; rests += Math.trunc(+a.credit) || 0; }
        for (let c = 0; c < 3; c++) {
          if (r.da[c] === id) mk[c]++;
          if (r.daSub[c] === id) mk[c]++;
          if (r.dp[c] === id) mk[c]--;
          if (r.sb[c] === id) rests++;
        }
        if (r.ru === id) rests--;
      }
      if (r.closed && r.P >= from) {
        for (let c = 0; c < 3; c++) {
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

/** Verifica gli slot dei coinquilini (foglio Roommates, cella B18). */
export function validateRoommates(roommates, today) {
  const t = dayNum(today);
  const active = roommates.filter((r) => r.name && (!r.from || dayNum(r.from) <= t) && (!r.to || dayNum(r.to) >= t));
  const issues = [];
  if (roommates.some((r) => r.name && (r.slot < 1 || r.slot > 4))) issues.push('slotRange');
  for (let s = 1; s <= 4; s++) if (active.filter((r) => r.slot === s).length > 1) issues.push('slotDup');
  return issues;
}
