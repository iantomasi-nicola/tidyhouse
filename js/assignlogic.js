// Logica pura (nessun DOM) dell'assegnazione manuale della settimana: usata da Actions, dal foglio «Assegna la settimana»
// e dall'anteprima IA. NON tocca il motore: scrive solo `swap` (le «celle grigie» del foglio Excel).
import { CHORES, compute } from './engine.js';

/** Persone presenti (a casa) in una riga del motore. */
export const presentIds = (row) => (row ? row.nm.filter((id, s) => id && row.pr[s] === 1) : []);
/** Persone attive (in uno slot) in quella settimana, presenti o no. */
export const activeIds = (row) => (row ? row.nm.filter(Boolean) : []);

/** Assegnazione «come da regole» di una settimana: il motore ricalcolato senza lo swap di quella settimana. */
export function ruleAssigned(eh, today, sunday) {
  const weeks = { ...(eh.weeks || {}) };
  const w = { ...(weeks[sunday] || {}) }; delete w.swap; weeks[sunday] = w;
  const row = compute({ ...eh, weeks }, today, 26).rows.find((r) => r.sunday === sunday);
  return row ? row.assigned.slice() : null;
}

/**
 * Calcola lo swap finale da scrivere. `wanted` = { chore: personId | '' | null } (solo le mansioni da toccare con `merge`,
 * tutte le mansioni senza `merge`); una mansione assegnata alla stessa persona delle regole non crea override,
 * salvo `explicit` (scelta esplicita, es. dall'IA: resta valida anche se le regole poi cambiano).
 * Ritorna { patch, swap } con patch = { floor, bathroom, kitchen } (id oppure null per cancellare) e swap = oggetto compatto.
 */
export function finalSwap({ existing = {}, ruled, wanted = {}, merge = false, explicit = false }) {
  const patch = {}, swap = {};
  for (const c of CHORES) {
    let id = null;
    if (c in wanted) id = wanted[c] && (explicit || wanted[c] !== ruled[CHORES.indexOf(c)]) ? wanted[c] : null;
    else if (merge) id = existing[c] || null;
    patch[c] = id; if (id) swap[c] = id;
  }
  return { patch, swap };
}

/** Differenze prima → dopo per mansione: [{chore, from, to}] (id, '' se nessuno). `after` = assegnati dopo l'override. */
export function diffAssign(before, after) {
  const out = [];
  CHORES.forEach((chore, i) => { if ((before[i] || '') !== (after[i] || '')) out.push({ chore, from: before[i] || '', to: after[i] || '' }); });
  return out;
}

/** Assegnati dopo aver applicato `swap` alle regole. */
export const applySwap = (ruled, swap) => CHORES.map((c, i) => (swap && swap[c]) || ruled[i] || '');

/** Mansioni per persona in un'assegnazione: { id: [chore, …] }. */
export function loadOf(assigned) {
  const m = {};
  assigned.forEach((id, i) => { if (id) (m[id] ||= []).push(CHORES[i]); });
  return m;
}
