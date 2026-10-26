// Importa / esporta il foglio Excel "House Cleaning Plan". XLSX = libreria SheetJS (vendor/xlsx.js) passata dal chiamante.
import { dayNum, dayStr, isSunday, weekEnd, addDays } from './engine.js';
import { uid, historyRows } from './extras.js';

const num = (v) => (typeof v === 'number' ? v : parseInt(v, 10));
const cellDay = (c) => {
  if (!c || c.v === undefined || c.v === null || c.v === '') return null;
  if (c.v instanceof Date) return dayStr(Math.round(c.v.getTime() / 86400000));
  if (typeof c.v === 'number') return dayStr(Math.round(c.v - 25569));            // seriale Excel
  const m = String(c.v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const str = (c) => (c && c.v !== undefined && c.v !== null ? String(c.v).trim() : '');

export function parseWorkbook(XLSX, data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const log = wb.Sheets.Log, rms = wb.Sheets.Roommates;
  if (!log || !rms) throw new Error('not-house-sheet');
  const warnings = [];
  const roommates = [];
  for (let r = 6; r <= 17; r++) {
    const name = str(rms['B' + r]); if (!name) continue;
    const slot = num((rms['C' + r] || {}).v);
    roommates.push({ id: uid(), name, slot: slot >= 1 && slot <= 4 ? slot : 1, from: cellDay(rms['D' + r]), to: cellDay(rms['E' + r]) });
  }
  if (!roommates.length) throw new Error('no-roommates');
  const nv = (a) => { const x = num((rms[a] || {}).v); return Number.isFinite(x) ? x : undefined; };
  const settings = {};
  const g = nv('F25'), mr = nv('F26'), sp = nv('F27'), wi = nv('F28');
  if (g !== undefined) settings.grace = g; if (mr !== undefined) settings.minRest = mr; if (sp !== undefined) settings.startPriority = sp; if (wi !== undefined) settings.window = wi;
  const byName = Object.fromEntries(roommates.map((r) => [r.name.toLowerCase(), r.id]));
  const idOf = (n) => byName[String(n).trim().toLowerCase()];
  let startSunday = cellDay(log.B4);
  if (!startSunday) throw new Error('no-start');
  if (!isSunday(startSunday)) { warnings.push({ code: 'startNotSunday', value: startSunday }); startSunday = weekEnd(startSunday); }
  const weeks = {}; const unknown = new Set();
  const range = XLSX.utils.decode_range(log['!ref']);
  for (let r = 4; r <= range.e.r + 1; r++) {
    let sunday = cellDay(log['B' + r]);
    if (!sunday) { if (r === 4) continue; sunday = addDays(startSunday, 7 * (r - 4)); if (!log['F' + r] && !log['C' + r] && !log['J' + r]) continue; }
    const w = {};
    for (const col of ['C', 'D', 'E']) {
      const n = str(log[col + r]); if (!n) continue;
      if (n.toLowerCase() === 'everyone') { w.everyone = true; continue; }
      const id = idOf(n); if (id) { (w.awayMap = w.awayMap || {})[id] = true; } else unknown.add(n);
    }
    const res = {};
    [['floor', 'J'], ['bathroom', 'K'], ['kitchen', 'L']].forEach(([k, col]) => {
      const v = str(log[col + r]); if (!v) return;
      if (v === 'Done') res[k] = 'done';
      else if (v === 'Skipped') res[k] = 'skipped';
      else { const m = v.match(/^Skipped \((.+)\)$/); if (m) { const id = idOf(m[1]); if (id) res[k] = 'skipped:' + id; else unknown.add(m[1]); } else { const id = idOf(v); if (id) res[k] = 'by:' + id; else unknown.add(v); } }
    });
    if (Object.keys(res).length) w.result = res;
    // scambi concordati: celle F:H scritte a mano (senza formula)
    const swap = {};
    [['floor', 'F'], ['bathroom', 'G'], ['kitchen', 'H']].forEach(([k, col]) => { const c = log[col + r]; if (c && c.v && !c.f) { const id = idOf(c.v); if (id) swap[k] = id; } });
    if (Object.keys(swap).length) w.swap = swap;
    const note = str(log['N' + r]); if (note) w.note = note;
    if (Object.keys(w).length) weeks[sunday] = w;
  }
  for (const n of unknown) warnings.push({ code: 'unknownName', value: n });
  return { roommates, startSunday, settings, weeks, warnings };
}

export function buildWorkbook(XLSX, house, out, stats, lang = 'it', weeks = {}) {
  const wb = XLSX.utils.book_new();
  const hist = historyRows(house, out, lang, weeks);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hist.length ? hist : [{ week_ending: '' }]), 'Turni');
  const rank = (stats ? stats.people : []).map((p) => ({ name: p.name, cleaned: p.cleanedTotal, skipped: p.skipped, covers: p.covers, covered: p.covered, completion_pct: p.rate ?? '', effort_points: p.effort, TR: p.tr ? 1 : '', CDM: p.cdm ? 1 : '' }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rank.length ? rank : [{ name: '' }]), 'Classifica');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(house.roommates.map((r) => ({ name: r.name, slot: r.slot, from: r.from || '', to: r.to || '' }))), 'Coinquilini');
  return wb;
}
