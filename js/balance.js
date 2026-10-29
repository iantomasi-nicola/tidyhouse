// «Recuperi e riposi» (solo admin): aggiungere o togliere recuperi per mansione e riposi a ogni persona.
// Scrive solo le correzioni `adj` tramite ctx.actions.adjustBalance: la logica di assegnazione del motore non cambia.
import { h, icon, avatar, loadCss } from './ui.js';
import { registerStrings } from './i18n.js';
import { CHORES } from './engine.js';
import { liveSheet } from './choresheet.js';
import { it, en } from './strings/balance.js';

registerStrings(it, en);
loadCss('css/balance.css');

const CHORE_ICON = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };

/** Applica una correzione con avviso e Annulla. Ritorna true se qualcosa è cambiato. */
async function apply(ctx, id, delta, what) {
  try {
    const res = await ctx.actions.adjustBalance(id, delta);
    if (!Object.keys(res.applied).length) { ctx.toast(ctx.t('bal.nothing')); return false; }
    ctx.haptic(ctx.prefs.haptics, 10);
    ctx.toast(ctx.t('bal.done', { what }), 6000, { action: { label: ctx.t('flow.undo'), onClick: async () => {
      try { await ctx.actions.restoreAdjust(res.week, id, res.prev); ctx.toast(ctx.t('bal.undone')); } catch { ctx.toast(ctx.t('error')); }
    } } });
    return true;
  } catch (e) { ctx.toast(e && e.message === 'permission' ? ctx.t('err.permission') : ctx.t('error')); return false; }
}

/** Riga del motore da cui partono le correzioni (settimana corrente, o la prima non chiusa). */
export const balanceRow = (ctx) => ctx.calc.out.rows.find((r) => r.isCur) || ctx.calc.out.rows.find((r) => !r.closed) || null;

/** Riepilogo breve di una persona: «1 recupero · 2 riposi» / «Nessun recupero né riposo». */
export function balanceSummary(ctx, id) {
  const t = ctx.t; const row = balanceRow(ctx); const s = row ? row.nm.indexOf(id) : -1;
  if (s < 0) return '';
  const mk = row.debts[s].reduce((a, v) => a + v, 0); const rest = Math.max(0, row.credits[s]);
  if (!mk && !rest) return t('bal.sum.none');
  return [mk ? (mk === 1 ? t('bal.sum.mk1') : t('bal.sum.mk', { n: mk })) : null, rest ? (rest === 1 ? t('bal.sum.rest1') : t('bal.sum.rest', { n: rest })) : null].filter(Boolean).join(' · ');
}

/** Scheda di una persona con +/− per mansione e riposo (Annulla nel messaggio). Null se la persona non è attiva. */
export function balanceCard(ctx, id) {
  const t = ctx.t; const row = balanceRow(ctx); const s = row ? row.nm.indexOf(id) : -1;
  if (s < 0) return null;
  const name = ctx.name(id);
  const debts = row.debts[s]; const credit = Math.max(0, row.credits[s]);
  const stepper = (n, key, lblAdd, lblSub, what) => h('div', { class: 'bal-step' },
    h('button', { type: 'button', 'data-act': `bal-sub-${key}`, 'data-who': id, 'aria-label': lblSub, disabled: n <= 0, onclick: () => apply(ctx, id, { [key]: -1 }, what) }, icon('minus')),
    h('span', { class: 'bal-n', 'data-testid': `bal-n-${key}-${id}`, 'aria-live': 'polite' }, String(n)),
    h('button', { type: 'button', 'data-act': `bal-add-${key}`, 'data-who': id, 'aria-label': lblAdd, onclick: () => apply(ctx, id, { [key]: 1 }, what) }, icon('plus')));
  const mkWhat = t('bal.what.mk', { name }); const restWhat = t('bal.what.rest', { name });
  const total = debts.reduce((a, v) => a + v, 0);
  return h('section', { class: 'bal-card', 'data-person': id },
    h('div', { class: 'bal-who' }, avatar(name, ctx.color(id), 'sm'), h('span', null, name)),
    ...CHORES.map((c, k) => h('div', { class: 'bal-row', 'data-chore': c },
      h('div', { class: 'tile sm ' + c }, icon(CHORE_ICON[c])),
      h('div', { class: 'grow' }, t('chore.' + c)),
      stepper(debts[k], c, t('bal.add', { chore: t('chore.' + c).toLowerCase(), name }), t('bal.sub', { chore: t('chore.' + c).toLowerCase(), name }), mkWhat))),
    h('div', { class: 'bal-row', 'data-chore': 'rest' },
      h('div', { class: 'tile sm rest' }, icon('moon')),
      h('div', { class: 'grow' }, t('bal.rest')),
      stepper(credit, 'credit', t('bal.addRest', { name }), t('bal.subRest', { name }), restWhat)),
    total || credit ? h('div', { class: 'bal-clear' },
      total ? h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'bal-clear-mk', 'data-who': id, onclick: () => apply(ctx, id, Object.fromEntries(CHORES.map((c, k) => [c, -debts[k]])), mkWhat) }, icon('x'), t('bal.clearMk')) : null,
      credit ? h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'bal-clear-rest', 'data-who': id, onclick: () => apply(ctx, id, { credit: -credit }, restWhat) }, icon('x'), t('bal.clearRest')) : null) : null);
}

/** Schede di più persone (tutte quelle attive se `ids` manca), con lo stato vuoto. */
export function balanceCards(ctx, ids) {
  const row = balanceRow(ctx);
  const list = (ids || (row ? row.nm.filter(Boolean) : [])).map((id) => balanceCard(ctx, id)).filter(Boolean);
  return list.length ? list : [h('div', { class: 'note warn' }, icon('home2'), ctx.t('bal.noPeople'))];
}

/** Apre il pannello (solo admin). */
export function openBalanceSheet(ctx) {
  if (!ctx.isAdmin) { ctx.toast(ctx.t('err.permission')); return null; }
  const t = ctx.t;
  return liveSheet(ctx, { title: () => t('bal.title'), full: true, build: () => h('div', { class: 'stack bal' },
    h('p', { class: 'muted small bal-intro' }, t('bal.intro')), ...balanceCards(ctx), h('p', { class: 'muted small' }, t('bal.hint'))) });
}
