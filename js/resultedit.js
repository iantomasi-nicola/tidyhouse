// «Correggi chi ha pulito» (solo admin): imposta a mano il risultato di un turno, anche di settimane passate.
// Scrive solo `result` tramite ctx.actions.setResult (nessun controllo checklist: è una correzione): il motore non cambia.
import { h, icon, avatar, loadCss } from './ui.js';
import { registerStrings, fmtWeekRange } from './i18n.js';
import { CHORES } from './engine.js';
import { liveSheet, rowOf } from './choresheet.js';
import { it, en } from './strings/resultedit.js';

registerStrings(it, en);
loadCss('css/balance.css');

/** Apre il foglio per un turno (chore = 'floor'|'bathroom'|'kitchen'). Ritorna lo sheet o null. */
export function openResultEditSheet(ctx, sunday, chore) {
  const c = CHORES.indexOf(chore);
  if (!ctx.isAdmin) { ctx.toast(ctx.t('err.permission')); return null; }
  if (c < 0 || !rowOf(ctx, sunday)) return null;
  const t = ctx.t;
  return liveSheet(ctx, { title: () => t('rez.title'), build: (api) => {
    const row = rowOf(ctx, sunday);
    if (!row) { api.close(); return h('div'); }
    const assigned = row.assigned[c]; const cur = row.result[c] || '';
    const people = row.nm.filter(Boolean);
    const apply = async (value) => {
      if (value === cur) { api.close(); return; }
      try {
        await ctx.actions.setResult(sunday, chore, value);
        ctx.haptic(ctx.prefs.haptics, 10);
        api.close();
        ctx.toast(t('rez.saved'), 6000, { action: { label: t('flow.undo'), onClick: async () => {
          try { await ctx.actions.setResult(sunday, chore, cur); ctx.toast(t('rez.undone')); } catch { ctx.toast(t('error')); }
        } } });
      } catch (e) { ctx.toast(e && e.message === 'permission' ? t('err.permission') : t('error')); }
    };
    const opt = (value, label, who) => h('button', { type: 'button', class: 'li cs-pick', 'data-value': value || 'reset', 'aria-pressed': String(value === cur), onclick: () => apply(value) },
      who ? avatar(ctx.name(who), ctx.color(who), 'sm') : null, h('div', { class: 'grow' }, h('div', { class: 't' }, label)), value === cur ? h('span', { class: 'chip acc' }, t('rez.now')) : icon('chevron'));
    const group = (title, items) => h('section', null, h('div', { class: 'eyebrow' }, title), h('div', { class: 'list' }, items));
    const others = people.filter((id) => id !== assigned);
    return h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, t('rez.intro', { chore: t('chore.' + chore), week: fmtWeekRange(sunday, ctx.lang), name: assigned ? ctx.name(assigned) : t('chore.noOne') })),
      group(t('rez.g.done'), [opt('done', t('rez.done', { name: ctx.name(assigned) }), assigned)]),
      others.length ? group(t('rez.g.by'), others.map((id) => opt('by:' + id, t('rez.by', { name: ctx.name(id) }), id))) : null,
      group(t('rez.g.skip'), [opt('skipped', t('rez.skip', { name: ctx.name(assigned) }), assigned), ...others.map((id) => opt('skipped:' + id, t('rez.skipAlso', { name: ctx.name(id) }), id))]),
      h('div', { class: 'list' }, opt('', t('rez.reset'))),
      h('p', { class: 'muted small' }, t('rez.hint')));
  } });
}
