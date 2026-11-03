// Mansioni nell'interfaccia (N mansioni, house.chores): nomi, icone e classi di colore, uguali in tutte le schermate.
// Le schermate non devono più assumere le 3 mansioni predefinite: usano questi helper (ctx oppure house come primo argomento).
//   cIds(x, row?)  id delle mansioni nell'ordine del motore (row.chores se c'è la riga)
//   cName(x, id)   nome visibile nella lingua corrente (predefinite non rinominate → stringhe tradotte)
//   cShort(x, id)  nome breve (predefinite: `chore.<id>.short`)
//   cIcon(x, id)   nome dell'icona (js/ui.js)
//   cCls(x, id)    classe colore: l'id per le predefinite (.tile.floor …), `cx cx<k>` per le nuove (palette di ripiego in css/app.css)
//   cOn(row, c)    la mansione di indice c è in turno in quella settimana (row.active)
//   cIdx(row)      indici delle mansioni in turno in quella riga
import { choresOf, DEFAULT_CHORES } from './engine.js';
import { choreName, choreIcon, choreRenamed } from './extras.js';
import { getLang, tr } from './i18n.js';

/** Numero di colori di ripiego per le mansioni nuove (classi .cx0 … .cx7). */
export const CX_COLORS = 8;
/** Icone che l'admin può scegliere per una mansione (tutte presenti in js/ui.js). */
export const CHORE_ICONS = ['broom', 'shower', 'pot', 'trash', 'cart', 'shirt', 'leaf', 'window', 'home', 'list', 'star', 'fire', 'refresh', 'dot'];

const houseOf = (x) => (x && typeof x.t === 'function' ? x.house : x) || {};
const isDefault = (id) => DEFAULT_CHORES.some((d) => d.id === id);

/** Id delle mansioni (ordine del motore). Con una riga del calendario usa `row.chores` (stesso ordine di row.assigned). */
export const cIds = (x, row) => (row && Array.isArray(row.chores) ? row.chores : choresOf(houseOf(x)).map((c) => c.id));
export const cName = (x, id) => choreName(houseOf(x), id, getLang());
export function cShort(x, id) {
  const hs = houseOf(x);
  if (isDefault(id) && !choreRenamed(hs, id)) return tr(getLang(), 'chore.' + id + '.short');
  return cName(hs, id);
}
export const cIcon = (x, id) => choreIcon(houseOf(x), id);
/** Classe colore della mansione (per .tile/.dot/.hm-minitile/.mx-ct e per i grafici `seg-<cls>`). */
export function cCls(x, id) {
  if (isDefault(id)) return id;
  const extra = choresOf(houseOf(x)).filter((c) => !isDefault(c.id)).map((c) => c.id);
  const k = Math.max(0, extra.indexOf(id));
  return 'cx cx' + (k % CX_COLORS);
}
/** Classe per i segmenti dei grafici (stats): `seg-floor` oppure `seg-cx cx3`. */
export const cSeg = (x, id) => (isDefault(id) ? 'seg-' + id : 'seg-cx ' + cCls(x, id).split(' ')[1]);
export const cOn = (row, c) => !(row && Array.isArray(row.active) && row.active[c] === false);
export const cIdx = (row) => (row && Array.isArray(row.assigned) ? row.assigned.map((_, c) => c).filter((c) => cOn(row, c)) : []);
/** Mansioni attive oggi (senza `to` passato): quelle che si vedono nelle liste generali (checklist, legende…). */
export function cActive(x, today) {
  return choresOf(houseOf(x)).filter((c) => !c.to || !today || c.to >= today).map((c) => c.id);
}
