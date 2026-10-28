// Dati di prova per lo storico lungo del calendario: 60 settimane passate + corrente + 12 future (orologio finto: mer 2026-10-28).
// Usato da calview.e2e.mjs e da calview.measure.mjs. Le settimane passate sono «fatte» salvo i casi indicati in `skips`.
import { seed } from './helpers.mjs';

export const NOW = '2026-10-28T10:00:00';
export const CUR = '2026-11-01';
export const START = '2025-09-07';            // 60 settimane prima della corrente: indice corrente = 60
export const addDays = (s, k) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };

/**
 * @param {object} o
 * @param {string[]} [o.skips]  domeniche in cui il pavimento è «saltato» (stato «Con salti»)
 * @param {string[]} [o.blank]  domeniche senza risultati (dopo la tolleranza = saltati; dentro la tolleranza = «da registrare»)
 * @param {number} [o.grace]    giorni di tolleranza per registrare (di norma 1)
 */
export function longSeed({ skips = [], blank = [], grace = 1, weeks = 60, extraWeeks = {}, houseExtra = {}, ...rest } = {}) {
  const start = addDays(CUR, -7 * weeks);
  const w = {};
  for (let i = 0; i < weeks; i++) {
    const sun = addDays(start, 7 * i);
    if (blank.includes(sun)) continue;
    w[sun] = { result: { floor: skips.includes(sun) ? 'skipped' : 'done', bathroom: 'done', kitchen: 'done' } };
  }
  return seed({ weeks: { ...w, ...extraWeeks }, houseExtra: { requireRules: false, startSunday: start, settings: { grace, minRest: 3, startPriority: 4, window: 52, minNights: 3 }, ...houseExtra }, ...rest });
}
