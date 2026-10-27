// Logica applicativa pura (nessun DOM/rete): usata dall'app, dallo script notifiche e dai test.
import { CHORES, compute, dayNum, dayStr, addDays, weekEnd, parseResult, awayFromTrips } from './engine.js';
import { tr, fmtWeekRange, fmtDate, dowLong } from './i18n.js';

export const DEFAULT_FEATURES = {
  needs: true, stats: true, tasks: true, lastout: true, requests: true, planDay: true, whatsapp: true,
  activity: true, trips: true, rules: true, ranking: true, ics: true, refresh: true, shared: true,
  selfDone: true, selfAway: true, coverOthers: true,
};
export const DEFAULT_EFFORT = { floor: 1, bathroom: 1, kitchen: 1 };
export const DEFAULT_TASK_PENALTY = 0.5;   // punti (fatica) tolti a chi lascia un arretrato e poi si assenta
export const DEFAULT_NOTIF = {
  enabled: true, catchUpHours: 5,
  friAbsence: { on: true, dow: 5, time: '17:00' },
  satDuty: { on: true, dow: 6, time: '10:00' },
  sunMark: { on: true, dow: 0, time: '18:00' },
  late: { on: true, times: ['10:00', '20:00'], max: 2, days: 3 },
  monNew: { on: false, dow: 1, time: '08:30' },
  planDay: { on: true, time: '09:00' },
  adminDigest: { on: false, dow: 1, time: '09:30' },
  requests: { on: true }, needs: { on: true }, nudges: { on: true }, tasks: { on: true },
};
export const NOTIF_TYPES = ['friAbsence', 'satDuty', 'sunMark', 'late', 'monNew', 'planDay', 'adminDigest', 'requests', 'needs', 'nudges'];
export const HOME_WIDGETS = ['hero', 'alerts', 'week', 'checklist', 'shared', 'quick', 'links', 'away', 'upcoming', 'makeups', 'ranking', 'needs'];
export const DEFAULT_HOME = { order: [...HOME_WIDGETS], hidden: ['makeups', 'needs'] };
export const PALETTE = ['#1a73e8', '#00796b', '#188038', '#e37400', '#d93025', '#c2185b', '#5f6368', '#00838f']; // Material: blu Google, teal, verde, arancio, rosso, rosa, grigio ardesia, ciano

export const feature = (house, k) => ((house.features || {})[k] ?? DEFAULT_FEATURES[k]) !== false;
export const effortOf = (house) => ({ ...DEFAULT_EFFORT, ...(house.effort || {}) });
export const notifCfg = (house) => deepMerge(DEFAULT_NOTIF, house.notif || {});
export const personById = (house, id) => (house.roommates || []).find((r) => r.id === id);
export const nameOf = (house, id) => (personById(house, id) || {}).name || (id ? '?' : '');
export const colorOf = (house, id) => {
  const p = personById(house, id); if (!p) return '#888';
  if (p.color) return p.color;
  const i = (house.roommates || []).indexOf(p); return PALETTE[i % PALETTE.length];
};

export function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b === undefined ? a : b;
  const out = { ...(typeof a === 'object' && a && !Array.isArray(a) ? a : {}) };
  for (const k of Object.keys(b)) out[k] = deepMerge(out[k], b[k]);
  return out;
}

// ============ ID e codici ============
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: niente I L O U
export function randomCode(len = 12, rnd) {
  const bytes = new Uint8Array(len);
  (rnd || ((b) => globalThis.crypto.getRandomValues(b)))(bytes);
  let s = ''; for (const b of bytes) s += B32[b % 32];
  return s;
}
export const fmtCode = (c) => (c || '').replace(/(.{4})(?=.)/g, '$1-');
export function normCode(c) {
  return (c || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
export const uid = () => randomCode(10);

// ============ Settimane: helpers ============
export function weekIndex(house, sunday) { return Math.round((dayNum(sunday) - dayNum(house.startSunday)) / 7); }
export function weekDays(sunday) { return Array.from({ length: 7 }, (_, i) => addDays(sunday, i - 6)); }
/** La persona è assente oggi? (viaggio in corso, o segnata assente nella settimana corrente). `house` = vista del motore (con weeks e trips). */
export function awayToday(house, personId, today) {
  if (!personId) return false;
  if ((house.trips || []).some((t) => t.personId === personId && t.from <= today && (!t.to || today < t.to))) return true;
  const w = (house.weeks || {})[weekOfDate(house, today)];
  return !!(w && !w.everyone && (w.away || []).includes(personId));
}
export function weekOfDate(house, date) { return dayStr(dayNum(house.startSunday) + 7 * Math.floor((dayNum(date) - dayNum(house.startSunday) + 6) / 7)); }

/**
 * Sostituto automatico per la mansione `c` di una riga del motore: quello suggerito dalle regole (chi ha aiutato meno, o chi ha il riposo),
 * che sia a casa e non sia l'assegnato; altrimenti il primo presente. Ritorna '' se non c'è nessuno.
 */
export function autoSub(row, c) {
  const assigned = row.assigned[c];
  const ok = (id) => id && id !== assigned && row.nm.some((x, s) => x === id && row.pr[s] === 1);
  if (ok(row.subs[c])) return row.subs[c];
  return row.nm.find((id, s) => ok(id)) || '';
}

/** Unisce le settimane salvate con le assenze inserite come viaggi per vedere chi risulta assente. */
export function isAway(house, row, personId) { return row.away.includes(personId); }

// ============ Giorno scelto per il turno ============
export function planOf(house, sunday, chore) {
  const d = (((house.weeks || {})[sunday] || {}).plan || {})[chore];
  if (!d) return '';
  const e = dayNum(sunday);
  const n = dayNum(d);
  return n >= e - 6 && n <= e ? d : ''; // deve ricadere nella settimana
}

// ============ Checklist ricorrenti ============
/** Compiti di una settimana. `weeks` = documenti settimana (con tasksDone). */
export function tasksForWeek(house, weeks, sunday) {
  const idx = weekIndex(house, sunday);
  const out = [];
  for (const t of house.tasks || []) {
    if (t.enabled === false || (house.checklistOff || {})[t.chore]) continue;
    const every = Math.max(1, parseInt(t.every, 10) || 1);
    const anchor = t.anchor ? weekIndex(house, weekEnd(t.anchor)) : 0;
    if (idx < anchor) continue;
    const lastDue = anchor + Math.floor((idx - anchor) / every) * every;
    // fatto in una settimana qualsiasi del ciclo corrente?
    let doneRec = null;
    for (let k = lastDue; k <= idx; k++) {
      const wk = weeks[dayStr(dayNum(house.startSunday) + 7 * k)];
      const d = wk && wk.tasksDone && wk.tasksDone[t.id];
      if (d) { doneRec = { ...(typeof d === 'object' ? d : { by: d }), week: dayStr(dayNum(house.startSunday) + 7 * k) }; break; }
    }
    const dueThisWeek = lastDue === idx;
    if (!dueThisWeek && doneRec && doneRec.week !== sunday) continue; // ciclo gia' chiuso in una settimana precedente
    out.push({
      task: t, chore: t.chore, every,
      status: doneRec ? 'done' : dueThisWeek ? 'due' : 'overdue',
      since: dayStr(dayNum(house.startSunday) + 7 * lastDue),
      done: doneRec,
    });
  }
  return out;
}
/**
 * Voci di checklist di una settimana con il RESPONSABILE di ciascuna.
 * Una voce non fatta scala alla settimana dopo ("arretrato") e tocca a chi aveva la mansione quando scadeva,
 * se quella persona è a casa; altrimenti a chi ha la mansione adesso.
 * @param {object} out risultato di compute() (serve rows[].assigned, nm, pr)
 */
export function checklistOwners(house, out, weeks, sunday) {
  const eh = { ...house, weeks };
  const idx = weekIndex(house, sunday); const row = out.rows[idx];
  if (!row) return [];
  return tasksForWeek(eh, weeks, sunday).map((it) => {
    const c = CHORES.indexOf(it.chore); const cur = row.assigned[c];
    let owner = cur, reason = 'assignee', handedFrom = '';
    if (it.status === 'overdue') {
      const prevRow = out.rows[weekIndex(house, it.since)]; const prev = prevRow && prevRow.assigned[c];
      if (prev && prev !== cur) { const slot = row.nm.indexOf(prev); if (slot >= 0 && row.pr[slot] === 1) { owner = prev; reason = 'arrears'; } else if (slot >= 0) handedFrom = prev; /* assente: passa ad altri */ }
    }
    return { ...it, owner, reason, handedFrom };
  });
}

/** Voci della checklist di UNA mansione in una settimana (settimanali = every 1, più quelle "ogni X settimane" che scadono). */
export function checklistFor(house, weeks, sunday, chore) {
  return tasksForWeek(house, weeks, sunday).filter((x) => x.chore === chore);
}
/** Ritardo annunciato: giorno (dopo la domenica, max +14) in cui chi è in ritardo farà il turno. */
export function delayOf(house, sunday, chore) {
  const d = (((house.weeks || {})[sunday] || {}).delay || {})[chore];
  if (!d) return '';
  const e = dayNum(sunday), n = dayNum(d);
  return n > e && n <= e + 14 ? d : '';
}
// ============ Compiti condivisi (es. buttare la spazzatura) ============
export const SHARED_TEMPLATES = [
  { key: 'shared.t.trash', every: 3 }, { key: 'shared.t.recycle', every: 7 }, { key: 'shared.t.dishwasher', every: 2 },
];
/**
 * Stato dei compiti condivisi: chi li ha fatti l'ultima volta, se sono da fare e a CHI TOCCA (suggerimento equo:
 * fra chi è a casa questa settimana, chi li ha fatti meno volte di recente; a parità, chi li ha fatti meno di recente).
 */
export function sharedStatus(house, out, today) {
  const row = out && out.cur >= 0 ? out.rows[out.cur] : null;
  const present = row ? row.nm.filter((id, s) => id && row.pr[s] === 1) : (house.roommates || []).map((r) => r.id);
  const state = house.sharedState || {};
  return (house.shared || []).filter((t) => t.enabled !== false).map((task) => {
    const st = state[task.id] || {}; const history = Array.isArray(st.history) ? st.history : [];
    const last = history.length ? history[history.length - 1] : null;
    const every = Math.max(1, parseInt(task.every, 10) || 1);
    const lastDay = last ? last.at.slice(0, 10) : null;
    const dueIn = lastDay ? dayNum(lastDay) + every - dayNum(today) : 0;
    const counts = {}; for (const h of history.slice(-10)) counts[h.by] = (counts[h.by] || 0) + 1;
    const lastAt = {}; for (const h of history) lastAt[h.by] = h.at;
    const suggested = [...present].sort((a, b) => ((counts[a] || 0) - (counts[b] || 0)) || ((lastAt[a] || '') < (lastAt[b] || '') ? -1 : (lastAt[a] || '') > (lastAt[b] || '') ? 1 : 0))[0] || '';
    return { task, last, dueIn, due: dueIn <= 0, counts, suggested, every };
  });
}

/** Prossima settimana (indice) in cui un compito scade, a partire da `idx`. */
export function nextDueWeek(house, task, idx) {
  const every = Math.max(1, parseInt(task.every, 10) || 1);
  const anchor = task.anchor ? weekIndex(house, weekEnd(task.anchor)) : 0;
  if (idx <= anchor) return anchor;
  return anchor + Math.ceil((idx - anchor) / every) * every;
}
export const TASK_TEMPLATES = [
  // ogni settimana (every 1)
  { chore: 'floor', key: 'tasks.t.w.floor1', every: 1 }, { chore: 'floor', key: 'tasks.t.w.floor2', every: 1 },
  { chore: 'bathroom', key: 'tasks.t.w.bath1', every: 1 }, { chore: 'bathroom', key: 'tasks.t.w.bath2', every: 1 }, { chore: 'bathroom', key: 'tasks.t.w.bath3', every: 1 },
  { chore: 'kitchen', key: 'tasks.t.w.kit1', every: 1 }, { chore: 'kitchen', key: 'tasks.t.w.kit2', every: 1 }, { chore: 'kitchen', key: 'tasks.t.w.kit3', every: 1 },
  // ogni X settimane
  { chore: 'floor', key: 'tasks.t.floor1', every: 2 }, { chore: 'floor', key: 'tasks.t.floor2', every: 8 }, { chore: 'floor', key: 'tasks.t.floor3', every: 8 },
  { chore: 'bathroom', key: 'tasks.t.bath1', every: 2 }, { chore: 'bathroom', key: 'tasks.t.bath2', every: 4 }, { chore: 'bathroom', key: 'tasks.t.bath3', every: 8 },
  { chore: 'kitchen', key: 'tasks.t.kit1', every: 4 }, { chore: 'kitchen', key: 'tasks.t.kit2', every: 8 }, { chore: 'kitchen', key: 'tasks.t.kit3', every: 8 },
];

// ============ Checklist "ultimo che esce" ============
export const LASTOUT_DEFAULT_KEYS = ['lastout.i1', 'lastout.i2', 'lastout.i3', 'lastout.i4', 'lastout.i5', 'lastout.i6', 'lastout.i7'];

// ============ Statistiche ============
/**
 * @returns {{house, people:[...]}} statistiche su settimane chiuse nella finestra.
 */
export function buildStats(house, out) {
  const { rows, cur, summary, settings } = out;
  const eff = effortOf(house);
  const fromP = summary.from || 1;
  const J = cur < 0 ? 0 : cur + 1;
  const ids = (cur >= 0 ? rows[cur].nm : []).filter(Boolean);
  const people = ids.map((id) => ({
    id, name: nameOf(house, id), assigned: [0, 0, 0], cleaned: [0, 0, 0], ownDone: 0, ownAssigned: 0, skipped: 0, covers: 0, covered: 0,
    weeksActive: 0, weeksHome: 0, effort: 0, streak: 0, bestStreak: 0, onTime: 0, onTimeBase: 0, restsUsed: 0,
  }));
  const by = Object.fromEntries(people.map((p) => [p.id, p]));
  const monthly = new Map();
  let closedWeeks = 0;
  const run = Object.fromEntries(people.map((p) => [p.id, 0]));
  // piccola penalità: arretrato di checklist lasciato a un altro perché chi non l'ha fatto era assente (una volta per voce)
  const penaltyPts = (house.settings && house.settings.taskPenalty !== undefined) ? Number(house.settings.taskPenalty) : DEFAULT_TASK_PENALTY;
  const handed = new Set();
  try {
    const weeksDocs = house.weeks || {};
    for (const r of rows) {
      if (r.P > J || r.P < fromP) continue;
      for (const it of checklistOwners(house, out, weeksDocs, r.sunday)) if (it.handedFrom && by[it.handedFrom]) { const k = `${it.task.id}|${it.since}|${it.handedFrom}`; if (!handed.has(k)) { handed.add(k); by[it.handedFrom].penalties = (by[it.handedFrom].penalties || 0) + 1; } }
    }
  } catch { /* checklist non configurata */ }
  for (const r of rows) {
    if (!r.closed || r.P < fromP || r.P > J) continue;
    closedWeeks++;
    const m = r.sunday.slice(0, 7);
    if (!monthly.has(m)) monthly.set(m, { month: m, done: 0, skipped: 0 });
    for (const id of r.nm) if (id && by[id]) { by[id].weeksActive++; if (r.pr[r.nm.indexOf(id)]) by[id].weeksHome++; }
    if (r.restName && by[r.restName] && r.ru) by[r.restName].restsUsed++;
    const wkDoc = (house.weeks || {})[r.sunday] || {};
    const failed = new Set();
    for (let c = 0; c < 3; c++) {
      const a = r.assigned[c];
      if (!a) continue;
      const cl = r.cleaner[c];
      if (by[a]) { by[a].assigned[c]++; by[a].ownAssigned++; if (cl === a) by[a].ownDone++; }
      if (cl && by[cl]) { by[cl].cleaned[c]++; by[cl].effort += eff[CHORES[c]]; }
      if (cl && cl !== a) { if (by[cl]) by[cl].covers++; if (by[a]) by[a].covered++; }
      if (r.sk[c] && by[r.sk[c]]) { by[r.sk[c]].skipped++; failed.add(r.sk[c]); }
      monthly.get(m)[cl ? 'done' : 'skipped']++;
      const at = (wkDoc.resultAt || {})[CHORES[c]];
      if (cl === a && at && by[a]) { by[a].onTimeBase++; if (at.slice(0, 10) <= addDays(r.sunday, 0)) by[a].onTime++; }
    }
    for (const p of people) {
      const had = r.assigned.includes(p.id);
      if (!had) continue;
      if (failed.has(p.id)) run[p.id] = 0; else run[p.id]++;
      p.bestStreak = Math.max(p.bestStreak, run[p.id]);
    }
  }
  for (const p of people) p.streak = run[p.id];
  const tot = people.map((p) => p.effort);
  const mean = tot.reduce((a, b) => a + b, 0) / (tot.length || 1);
  const sd = Math.sqrt(tot.reduce((a, b) => a + (b - mean) ** 2, 0) / (tot.length || 1));
  // il carico va normalizzato per le settimane in cui la persona era a casa
  const rate = people.map((p) => (p.weeksHome ? p.effort / p.weeksHome : 0));
  const rm = rate.reduce((a, b) => a + b, 0) / (rate.length || 1);
  const rsd = Math.sqrt(rate.reduce((a, b) => a + (b - rm) ** 2, 0) / (rate.length || 1));
  const balance = rm > 0 ? Math.max(0, Math.round(100 - (rsd / rm) * 100)) : 100;
  const doneAll = people.reduce((a, p) => a + p.ownDone, 0), assAll = people.reduce((a, p) => a + p.ownAssigned, 0);
  const sumP = Object.fromEntries(summary.people.map((p) => [p.id, p]));
  const byEffort = (house.settings || {}).rankBy === 'effort';
  for (const p of people) {
    p.cleanedTotal = p.cleaned[0] + p.cleaned[1] + p.cleaned[2];
    p.rate = p.ownAssigned ? Math.round((100 * p.ownDone) / p.ownAssigned) : null;
    p.tr = !!(sumP[p.id] && sumP[p.id].tr); p.cdm = !!(sumP[p.id] && sumP[p.id].cdm);
    p.makeups = sumP[p.id] ? sumP[p.id].makeups : [0, 0, 0];
    p.rests = sumP[p.id] ? sumP[p.id].rests : 0;
    p.presence = p.weeksActive ? Math.round((100 * p.weeksHome) / p.weeksActive) : null;
    p.onTimeRate = p.onTimeBase ? Math.round((100 * p.onTime) / p.onTimeBase) : null;
    p.penalties = p.penalties || 0; p.penaltyPoints = Math.round(p.penalties * penaltyPts * 10) / 10;
    p.shared = Object.values(((house.sharedState || {})))
      .reduce((a, st) => a + ((st && st.history) || []).filter((x) => x.by === p.id).length, 0);
    p.score = byEffort ? Math.max(0, Math.round((p.effort - p.penaltyPoints) * 10) / 10) : p.cleanedTotal;
  }
  const maxScore = Math.max(0, ...people.map((p) => p.score));
  for (const p of people) p.tr = p.score > 0 && p.score === maxScore;
  return {
    people, closedWeeks, balance, completion: assAll ? Math.round((100 * doneAll) / assAll) : null,
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12), effort: eff, from: fromP, sd, mean,
  };
}

// ============ WhatsApp ============
export function whatsappText(house, out, sunday, opts = {}, lang = 'it', weeks = {}) {
  const r = out.rows.find((x) => x.sunday === sunday); if (!r) return '';
  const T = (k, p) => tr(lang, k, p);
  const lines = [T('wa.header', { range: fmtWeekRange(sunday, lang) })];
  const who = (id) => (id ? nameOf(house, id) : T('wa.nobody'));
  const mk = (c) => (r.isMakeup[c] ? ` (${T('st.makeup').toLowerCase()})` : '');
  CHORES.forEach((c, i) => lines.push(T('wa.' + c, { who: who(r.assigned[i]) + mk(i) })));
  if (r.rest.length) lines.push(T('wa.rest', { who: r.rest.map((id) => nameOf(house, id)).join(', ') }));
  if (opts.away !== false && r.away.length) lines.push(T('wa.away', { who: r.away.map((id) => nameOf(house, id)).join(', ') }));
  if (opts.plan !== false && feature(house, 'planDay')) {
    CHORES.forEach((c, i) => { const d = planOf({ ...house, weeks }, sunday, c); if (d && r.assigned[i]) lines.push(T('wa.plan', { who: who(r.assigned[i]), day: `${dowLong(d, lang)} ${fmtDate(d, lang)}` })); });
  }
  if (opts.tasks !== false && feature(house, 'tasks')) {
    const due = tasksForWeek(house, weeks, sunday).filter((x) => x.status !== 'done');
    if (due.length) lines.push(T('wa.tasks', { what: due.map((x) => `${x.task.text} (${nameOf(house, r.assigned[CHORES.indexOf(x.chore)])})`).join('; ') }));
  }
  if (opts.deadline !== false) lines.push(T('wa.deadline'));
  if (opts.link && opts.url) lines.push('', T('wa.link', { url: opts.url }));
  return lines.join('\n');
}
export function rankingText(house, out, stats, lang = 'it') {
  const T = (k, p) => tr(lang, k, p);
  const sorted = [...stats.people].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉', '▫️'];
  const lines = [T('wa.ranking', { window: house.settings && house.settings.window === 0 ? T('stats.allTime') : T('stats.window', { n: (house.settings || {}).window ?? 52 }) })];
  sorted.forEach((p, i) => lines.push(T('wa.rankingLine', { medal: medals[Math.min(i, 3)], name: p.name, n: p.score })));
  const tr_ = sorted.filter((p) => p.tr).map((p) => p.name), cdm = sorted.filter((p) => p.cdm).map((p) => p.name);
  if (tr_.length) lines.push(T('wa.trLine', { who: tr_.join(', ') }));
  if (cdm.length) lines.push(T('wa.cdmLine', { who: cdm.join(', ') }));
  return lines.join('\n');
}

// ============ Calendario (.ics) ============
const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (s) => s.replace(/-/g, '');
export function makeIcs(house, out, personId, lang = 'it', weeks = {}, fromSunday, count = 8) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tidy House//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const rows = out.rows.filter((r) => r.sunday >= fromSunday).slice(0, count);
  for (const r of rows) {
    CHORES.forEach((c, i) => {
      if (r.assigned[i] !== personId) return;
      const day = planOf({ ...house, weeks }, r.sunday, c) || r.sunday;
      const next = addDays(day, 1);
      L.push('BEGIN:VEVENT', `UID:${r.sunday}-${c}-${personId}@tidyhouse`, `DTSTAMP:${icsDate(r.sunday)}T000000Z`,
        `DTSTART;VALUE=DATE:${icsDate(day)}`, `DTEND;VALUE=DATE:${icsDate(next)}`,
        `SUMMARY:${icsEsc('🧹 ' + tr(lang, 'chore.' + c) + (r.isMakeup[i] ? ' (' + tr(lang, 'st.makeup') + ')' : ''))}`,
        `DESCRIPTION:${icsEsc(house.name || '')}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(tr(lang, 'chore.' + c))}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
    });
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

// ============ Export ============
export function historyRows(house, out, lang = 'it', weeks = {}) {
  const N = (id) => nameOf(house, id);
  const res = (r, c) => {
    const p = parseResult(r.result[c]);
    return p.kind === 'done' ? 'Done' : p.kind === 'skipped' ? 'Skipped' : p.kind === 'by' ? N(p.id) : p.kind === 'skippedBy' ? `Skipped (${N(p.id)})` : '';
  };
  return out.rows.filter((r) => r.nAss > 0 || r.away.length || r.result.some(Boolean)).map((r) => ({
    week_ending: r.sunday, floor: N(r.assigned[0]), bathroom: N(r.assigned[1]), kitchen: N(r.assigned[2]), rest: r.rest.map(N).join(', '),
    away: r.away.map(N).join(', '), result_floor: res(r, 0), result_bathroom: res(r, 1), result_kitchen: res(r, 2),
    makeup_floor: r.isMakeup[0] ? 1 : '', makeup_bathroom: r.isMakeup[1] ? 1 : '', makeup_kitchen: r.isMakeup[2] ? 1 : '',
    status: r.status, note: ((weeks[r.sunday] || {}).note) || '',
  }));
}
export function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\ufeff' + [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\r\n');
}

// ============ Notifiche ============
export function localParts(date, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }); }
  catch { f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }); }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour) * 60 + (+p.minute), dow };
}
const hm = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * Calcola le notifiche da inviare adesso. Pura: lo stato arriva dal chiamante.
 * @param {{house, weeks, members:Object, now:Date, sent:Set<string>}} ctx
 * @returns {Array<{key,type,personId,week,chores,n?,extra?,lateClosed?,day?,names?}>}
 */
export function planNotifications({ house, weeks, now, sent = new Set() }) {
  const cfg = notifCfg(house);
  if (!cfg.enabled) return [];
  const lp = localParts(now, house.tz || 'Europe/Rome');
  const today = lp.date;
  const h2 = { ...house, weeks };
  const out = compute(h2, today, 2);
  const res = [];
  const catchUp = (cfg.catchUpHours || 5) * 60;
  const due = (dow, time) => (dow === undefined || lp.dow === dow) && lp.minutes >= hm(time) && lp.minutes - hm(time) <= catchUp;
  const push = (o) => { const key = `${o.type}|${o.week}|${o.personId}|${today}|${o.slot ?? 0}`; if (!sent.has(key)) res.push({ ...o, key }); };
  const cur = out.cur;
  if (cur < 0) return res;
  const row = out.rows[cur];
  const sunday = row.sunday;
  const pend = (r, c) => r.assigned[c] && !r.res[c].kind && !r.closed;      // ancora da segnare
  const pendRow = (r) => [0, 1, 2].filter((c) => r.assigned[c] && !r.res[c].kind && !(delayOf(h2, r.sunday, CHORES[c]) >= today));
  const pairs = (r, list) => { const m = new Map(); for (const c of list) { const id = r.assigned[c]; if (!m.has(id)) m.set(id, []); m.get(id).push(c); } return m; };
  const owned = feature(house, 'tasks') ? checklistOwners(h2, out, weeks, sunday).filter((x) => x.status !== 'done') : [];
  const tasksOf = (id) => owned.filter((x) => x.owner === id).length;

  if (cfg.friAbsence.on && feature(house, 'trips') && due(cfg.friAbsence.dow, cfg.friAbsence.time)) {
    row.nm.forEach((id, s) => { if (id && row.pr[s] === 1) push({ type: 'friAbsence', personId: id, week: sunday }); });
  }
  if (cfg.satDuty.on && due(cfg.satDuty.dow, cfg.satDuty.time)) {
    for (const [id, cs] of pairs(row, [0, 1, 2].filter((c) => pend(row, c)))) push({ type: 'satDuty', personId: id, week: sunday, chores: cs.map((c) => CHORES[c]), extra: tasksOf(id) });
  }
  if (cfg.satDuty.on && cfg.tasks.on !== false && due(cfg.satDuty.dow, cfg.satDuty.time)) {   // chi ha solo arretrati di checklist (senza turno da fare)
    const withChore = new Set([0, 1, 2].filter((c) => pend(row, c)).map((c) => row.assigned[c]));
    for (const id of new Set(owned.filter((x) => x.status === 'overdue').map((x) => x.owner).filter(Boolean))) if (!withChore.has(id)) push({ type: 'tasks', personId: id, week: sunday, n: owned.filter((x) => x.owner === id && x.status === 'overdue').length });
  }
  if (cfg.sunMark.on && due(cfg.sunMark.dow, cfg.sunMark.time)) {
    for (const [id, cs] of pairs(row, [0, 1, 2].filter((c) => pend(row, c)))) push({ type: 'sunMark', personId: id, week: sunday, chores: cs.map((c) => CHORES[c]) });
  }
  if (cfg.monNew.on && due(cfg.monNew.dow, cfg.monNew.time)) {
    for (const [id, cs] of pairs(row, [0, 1, 2].filter((c) => row.assigned[c]))) push({ type: 'monNew', personId: id, week: sunday, chores: cs.map((c) => CHORES[c]) });
    for (const id of row.rest) push({ type: 'monNew', personId: id, week: sunday, chores: [], rest: true });
  }
  // giorno scelto
  if (cfg.planDay.on && feature(house, 'planDay') && lp.minutes >= hm(cfg.planDay.time) && lp.minutes - hm(cfg.planDay.time) <= catchUp) {
    const todays = [], lates = new Map();
    for (let c = 0; c < 3; c++) {
      const d = planOf(h2, sunday, CHORES[c]);
      if (!d || !pend(row, c)) continue;
      if (d === today) todays.push(c);
      else if (d < today) { const k = row.assigned[c] + '|' + d; if (!lates.has(k)) lates.set(k, { id: row.assigned[c], d, cs: [] }); lates.get(k).cs.push(c); }
    }
    for (const [id, cs] of pairs(row, todays)) push({ type: 'planDay', personId: id, week: sunday, chores: cs.map((c) => CHORES[c]) });
    for (const l of lates.values()) push({ type: 'planDayLate', personId: l.id, week: sunday, chores: l.cs.map((c) => CHORES[c]), day: l.d, slot: l.d });
  }
  // compiti condivisi (es. spazzatura): promemoria quotidiano a chi tocca, se è da fare
  if (cfg.planDay.on && feature(house, 'shared') && lp.minutes >= hm(cfg.planDay.time) && lp.minutes - hm(cfg.planDay.time) <= catchUp) {
    for (const x of sharedStatus(h2, out, today)) if (x.due && x.suggested) push({ type: 'shared', personId: x.suggested, week: sunday, text: x.task.text, slot: x.task.id });
  }
  // ritardo annunciato che scade oggi: promemoria "oggi è il giorno"
  if (cfg.planDay.on && lp.minutes >= hm(cfg.planDay.time) && lp.minutes - hm(cfg.planDay.time) <= catchUp) {
    for (let i = Math.max(0, cur - 2); i < cur; i++) {
      const r = out.rows[i];
      for (const [id, cs] of pairs(r, [0, 1, 2].filter((c) => r.assigned[c] && !r.res[c].kind && delayOf(h2, r.sunday, CHORES[c]) === today))) push({ type: 'planDay', personId: id, week: r.sunday, chores: cs.map((c) => CHORES[c]) });
    }
  }
  // ritardi: settimane concluse con turni ancora senza risultato (da lunedi', fino a N giorni)
  if (cfg.late.on) {
    const times = (cfg.late.times || []).slice(0, cfg.late.max || 3);
    // se piu' orari risultano scaduti nella stessa esecuzione (ritardo del server) si invia solo l'ultimo
    const dueSlots = times.map((time, slot) => (lp.minutes >= hm(time) && lp.minutes - hm(time) <= catchUp ? slot : -1)).filter((x) => x >= 0);
    dueSlots.slice(-1).forEach((slot) => {
      for (let i = 0; i < cur; i++) {
        const r = out.rows[i];
        const daysAfter = dayNum(today) - dayNum(r.sunday);
        if (daysAfter < 1 || daysAfter > (cfg.late.days || 4)) continue;
        const pc = pendRow(r);
        for (const [id, cs] of pairs(r, pc)) push({ type: 'late', personId: id, week: r.sunday, chores: cs.map((c) => CHORES[c]), lateClosed: !!r.closed, slot });
      }
    });
  }
  // riepilogo admin (id persone admin = house.adminIds)
  if (cfg.adminDigest.on && due(cfg.adminDigest.dow, cfg.adminDigest.time) && cur > 0) {
    const r = out.rows[cur - 1];
    const pc = pendRow(r);
    const names = [...new Set(pc.map((c) => nameOf(house, r.assigned[c])))];
    for (const id of house.adminIds || []) push({ type: 'adminDigest', personId: id, week: r.sunday, n: pc.length, names });
  }
  return res;
}

/** Sceglie i dispositivi destinatari di una notifica. */
export function targetsFor(n, members, house) {
  const cfg = notifCfg(house);
  const typeKey = n.type === 'planDayLate' ? 'planDay' : n.type === 'shared' ? 'tasks' : n.type;
  return Object.entries(members || {}).filter(([, m]) => m && m.push && m.push.endpoint && m.personId === n.personId
    && (!m.prefs || m.prefs[typeKey] !== false)
    && !(cfg[typeKey] && cfg[typeKey].on === false)).map(([id, m]) => ({ id, ...m }));
}

/** Testo localizzato per una notifica pianificata. */
export function notifMessage(n, house, lang = 'it', weeks = {}) {
  const m = baseMessage(n, house, lang, weeks);
  // un solo turno da segnare: la notifica offre «Segna fatto» (l'app lo esegue rispettando la checklist)
  if (['satDuty', 'sunMark', 'late', 'planDay'].includes(n.type) && (n.chores || []).length === 1 && n.week) m.actions = [{ action: 'done', title: tr(lang, 'n.act.done'), url: `#/do/done/${n.week}/${n.chores[0]}` }];
  return m;
}
function baseMessage(n, house, lang = 'it', weeks = {}) {
  const T = (k, p) => tr(lang, k, p);
  const chores = (n.chores || []).map((c) => T('chore.' + c)).join(' + ');
  const minN = (house.settings && house.settings.minNights) || 3;
  switch (n.type) {
    case 'friAbsence': return { title: T('n.fri.title'), body: T('n.fri.body', { n: minN }), url: '#/trips' };
    case 'satDuty': return { title: T('n.sat.title'), body: T('n.sat.body', { chores, extra: n.extra ? T('n.sat.extra', { n: n.extra }) : '' }), url: '#/' };
    case 'sunMark': return { title: T('n.sun.title'), body: T('n.sun.body', { chores }), url: '#/' };
    case 'late': return { title: T('n.late.title'), body: T('n.late.body', { chores, closed: n.lateClosed ? T('n.late.closed') : T('n.late.open') }), url: '#/' };
    case 'monNew': return n.rest ? { title: T('n.mon.title'), body: T('n.mon.rest'), url: '#/' } : { title: T('n.mon.title'), body: T('n.mon.body', { chores }), url: '#/' };
    case 'planDay': return { title: T('n.plan.title'), body: T('n.plan.body', { chores }), url: '#/' };
    case 'planDayLate': return { title: T('n.plan.late.title'), body: T('n.plan.late.body', { chores, day: dowLong(n.day, lang) }), url: '#/' };
    case 'adminDigest': return n.n ? { title: T('n.digest.title'), body: T('n.digest.body', { n: n.n, names: (n.names || []).join(', ') }), url: '#/calendar' } : { title: T('n.digest.title'), body: T('n.digest.ok'), url: '#/' };
    case 'shared': return { title: T('n.shared.title'), body: T('n.shared.body', { text: n.text }), url: '#/' };
    case 'tasks': return { title: T('n.tasks.title'), body: T('n.tasks.body', { n: n.n }), url: '#/' };
    case 'test': return { title: T('n.test.title'), body: T('n.test.body'), url: '#/' };
    default: return { title: n.title || T('app.name'), body: n.body || '', url: n.url || '#/' };
  }
}

// ============ Scambi turno ============
/** Applica uno scambio accettato: scambia i due turni nella settimana come "swap" manuale. */
export function swapPatch(row, a, b) {
  // a = {chore, personId}, b = {chore, personId}: chi aveva a.chore prende b.chore e viceversa
  const swap = {};
  CHORES.forEach((c, i) => { swap[c] = row.assigned[i]; });
  swap[a.chore] = b.personId; swap[b.chore] = a.personId;
  const out = {};
  for (const c of CHORES) if (swap[c] !== row.assigned[CHORES.indexOf(c)]) out[c] = swap[c];
  return out;
}

// ============ Dati: validazione/import ============
export function validateHouse(h) {
  const issues = [];
  if (!h || typeof h !== 'object') return ['invalid'];
  if (!h.startSunday || ((dayNum(h.startSunday) + 4) % 7 !== 0)) issues.push('startSunday');
  if (!Array.isArray(h.roommates) || !h.roommates.length) issues.push('roommates');
  return issues;
}
export { CHORES, compute, awayFromTrips };

// ---------- richieste: «in attesa di me» e scadenza (nucleo: badge del nav, pulizia all'apertura) ----------
/** Tipo di richiesta: 'swap' (scambio, senza kind), 'cover', 'offer', 'notice', 'nudge'. */
const reqKindOf = (r) => (['cover', 'offer', 'notice', 'nudge'].includes(r.kind) ? r.kind : 'swap');
/**
 * Richieste ancora in attesa di una MIA risposta. Stessa regola di `awaitingMe()` in js/screens/more.js: sostituzioni (cover) a me o aperte a tutti
 * (tranne chi le ha chieste), offerte e scambi solo se indirizzati a me; avvisi e solleciti non contano. Il badge del nav usa questa funzione.
 */
export function requestsAwaiting(state, me) {
  if (!me) return [];
  return Object.entries((state && state.requests) || {}).map(([id, r]) => ({ id, ...r })).filter((r) => {
    if (r.status !== 'pending') return false;
    const k = reqKindOf(r);
    if (k === 'cover') return r.from !== me && (!r.to || r.to === me);
    if (k === 'offer' || k === 'swap') return r.to === me;
    return false;
  });
}
/** Id delle richieste (cover/offer/scambio) ancora «pending» su una settimana chiusa da più di `days` giorni: non servono più. */
export function staleRequestIds(requests, today, days = 7) {
  return Object.entries(requests || {}).filter(([, r]) => r && r.status === 'pending' && !['notice', 'nudge'].includes(r.kind) && /^\d{4}-\d{2}-\d{2}$/.test(r.week || '') && dayNum(today) - dayNum(r.week) > days).map(([id]) => id);
}
