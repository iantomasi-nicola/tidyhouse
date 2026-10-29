// «Com'è andata» (solo admin): imposta o corregge il risultato di un turno, anche di settimane passate, con un solo tocco.
// Usato inline nella sezione «Gestisci (admin)» della scheda turno e nel pannello desktop delle Settimane (js/choresheet.js);
// `openResultEditSheet` resta come foglio a sé (stesso controllo). Scrive solo `result` (+ pulizia dei flag volontario/incompleto): il motore non cambia.
import { h, icon, avatar, loadCss } from './ui.js';
import { registerStrings, fmtWeekRange } from './i18n.js';
import { CHORES } from './engine.js';
import { liveSheet, rowOf, markDoneFlow, undoFlow } from './choresheet.js';
import { it, en } from './strings/resultedit.js';

registerStrings(it, en);
loadCss('css/balance.css');

const isOkV = (v) => v === 'done' || String(v).startsWith('by:');
const isSkipV = (v) => v === 'skipped' || String(v).startsWith('skipped:');
const err = (ctx, e) => ctx.toast(e && e.message === 'permission' ? ctx.t('err.permission') : ctx.t('error'));

/** Frase sulle conseguenze di un risultato (per chi guarda prima/dopo aver scelto). */
export function resultEffect(ctx, row, c, value) {
  const t = ctx.t; const a = row.assigned[c]; const an = ctx.name(a);
  if (!value) return row.closed ? t('rez.eff.todoLate') : t('rez.eff.todo');
  if (value === 'done') return t('rez.eff.done', { name: an });
  if (value.startsWith('by:')) return t('flow.terms.repay.line', { a: an, b: ctx.name(value.slice(3)) });
  if (value.startsWith('skipped:')) return `${t('cal.skipNobodyHint', { name: an })} ${t('cal.skipAlsoHint', { name: ctx.name(value.slice(8)) })}`;
  return t('cal.skipNobodyHint', { name: an });
}

/**
 * Applica un risultato scelto dall'admin. Turno ancora aperto + «fatto»/«ha pulito X» → flusso normale (checklist obbligatoria, Annulla nel messaggio).
 * Altrimenti è una correzione: scrive il risultato, toglie i flag rimasti vecchi (volontario, incompleto) e offre Annulla che ripristina tutto.
 */
export async function applyResult(ctx, sunday, chore, value) {
  const c = CHORES.indexOf(chore); const row = rowOf(ctx, sunday); if (!row || c < 0) return false;
  const cur = row.result[c] || '';
  if (value === cur) return false;
  if (!cur && isOkV(value)) return markDoneFlow(ctx, sunday, chore, { value });
  const wk = (ctx.state.weeks || {})[sunday] || {};
  const vol = (wk.volunteer || {})[chore] || null; const inc = (wk.incomplete || {})[chore] || null;
  try {
    if (!value) { if (!(await undoFlow(ctx, sunday, chore, { toast: false }))) return false; } else {
      await ctx.actions.setResult(sunday, chore, value);
      // il «volontario» vale solo se il risultato è ancora «ha pulito lui»; l'«incompleto» solo se il turno risulta fatto
      const patch = {};
      if (vol && value !== 'by:' + vol) patch.volunteer = { [chore]: null };
      if (inc && !isOkV(value)) patch.incomplete = { [chore]: null };
      if (Object.keys(patch).length) await ctx.store.setDoc('weeks', sunday, patch);
    }
  } catch (e) { err(ctx, e); return false; }
  ctx.haptic(ctx.prefs.haptics, 10);
  ctx.toast(ctx.t('rez.saved'), 7000, { action: { label: ctx.t('flow.undo'), onClick: async () => {
    try {
      await ctx.actions.setResult(sunday, chore, cur);
      if (vol || inc) await ctx.store.setDoc('weeks', sunday, { volunteer: { [chore]: vol }, incomplete: { [chore]: inc } });
      ctx.toast(ctx.t('rez.undone'));
    } catch { ctx.toast(ctx.t('error')); }
  } } });
  return true;
}

/**
 * Controllo «Com'è andata»: una fila di scelte (Da fare · chi ha pulito · Nessuno) + «non ha pulito neanche…» se saltato, e la frase delle conseguenze.
 * `onDone` viene chiamato dopo una scelta riuscita (es. per chiudere il foglio).
 */
export function resultPicker(ctx, sunday, chore, { onDone } = {}) {
  const c = CHORES.indexOf(chore); const row = rowOf(ctx, sunday);
  if (!row || c < 0 || !row.assigned[c]) return null;
  const t = ctx.t; const a = row.assigned[c]; const cur = row.result[c] || '';
  const sug = row.subs[c];
  const others = row.nm.filter((id) => id && id !== a).sort((x, y) => (x === sug ? -1 : y === sug ? 1 : 0));
  let busy = false;
  const pick = async (value) => {
    if (busy) return; busy = true;
    try { if (await applyResult(ctx, sunday, chore, value) && onDone) onDone(); } finally { busy = false; }
  };
  const opt = (value, label, { who = null, sub = '', pressed = value === cur, to = value } = {}) => h('button', {
    type: 'button', class: 'wa-opt mg-opt' + (who ? '' : ' rules'), 'data-act': 'res-' + chore, 'data-value': value || 'reset', 'aria-pressed': String(pressed),
    onclick: () => pick(to),
  }, who ? avatar(ctx.name(who), ctx.color(who), 'sm') : value ? icon('x') : null, h('span', { class: 'wa-lbl' }, label), sub ? h('span', { class: 'wa-sub mg-sub' }, sub) : null);
  const skip = isSkipV(cur);
  const kids = [
    h('div', { class: 'wa-opts', role: 'group', 'aria-label': t('rez.group', { chore: t('chore.' + chore) }) },
      opt('', t('rez.c.todo')),
      opt('done', ctx.name(a), { who: a, sub: t('rez.c.assigned') }),
      others.map((id) => opt('by:' + id, ctx.name(id), { who: id, sub: row.away.includes(id) ? t('assign.absent') : '' })),
      opt('skipped', t('rez.c.nobody'), { pressed: skip })),
  ];
  if (skip && others.length) {
    kids.push(h('div', { class: 'mg-also' }, h('span', { class: 'small muted' }, t('rez.also')),
      h('div', { class: 'wa-opts', role: 'group', 'aria-label': t('rez.also') }, others.map((id) => opt('skipped:' + id, ctx.name(id), { who: id, to: cur === 'skipped:' + id ? 'skipped' : 'skipped:' + id, sub: id === sug ? t('cal.suggested') : '' })))));
  }
  kids.push(h('p', { class: 'mg-eff small', 'data-testid': 'res-effect-' + chore }, resultEffect(ctx, row, c, cur)));
  return h('div', { class: 'mg-block', 'data-mg': 'result' }, kids);
}

/** Foglio a sé con lo stesso controllo (chore = 'floor'|'bathroom'|'kitchen'). Ritorna lo sheet o null. */
export function openResultEditSheet(ctx, sunday, chore) {
  const c = CHORES.indexOf(chore);
  if (!ctx.isAdmin) { ctx.toast(ctx.t('err.permission')); return null; }
  if (c < 0 || !rowOf(ctx, sunday)) return null;
  const t = ctx.t;
  return liveSheet(ctx, { title: () => t('rez.title'), build: (api) => {
    const row = rowOf(ctx, sunday);
    if (!row) { api.close(); return h('div'); }
    return h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, t('rez.intro', { chore: t('chore.' + chore), week: fmtWeekRange(sunday, ctx.lang), name: row.assigned[c] ? ctx.name(row.assigned[c]) : t('chore.noOne') })),
      resultPicker(ctx, sunday, chore, { onDone: () => api.close() }) || h('div', { class: 'empty' }, t('chore.noOne')));
  } });
}
