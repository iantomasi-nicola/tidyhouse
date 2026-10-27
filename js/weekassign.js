// «Assegna la settimana» (solo admin): scelta a mano di chi fa Pavimenti/Bagno/Cucina in una settimana.
// Scrive solo `swap` (come le celle grigie del foglio) tramite ctx.actions.setWeekAssignments: il motore non cambia.
import { h, icon, avatar, loadCss } from './ui.js';
import { registerStrings, fmtWeekRange } from './i18n.js';
import { CHORES } from './engine.js';
import { presentIds, ruleAssigned, diffAssign, loadOf } from './assignlogic.js';
import { it, en } from './strings/assign.js';

registerStrings(it, en);
loadCss('css/weekassign.css');

const CHORE_ICON = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };
const lc = (s) => String(s).toLowerCase();

/** Apre il foglio «Assegna la settimana». Ritorna lo sheet (o null se non sei admin o la settimana non esiste). */
export function openAssignWeekSheet(ctx, sunday) {
  if (!ctx.isAdmin) { ctx.toast(ctx.t('err.permission')); return null; }
  const row = ctx.calc.out.rows.find((r) => r.sunday === sunday);
  if (!row) return null;
  const t = ctx.t;
  const ruled = ruleAssigned(ctx.calc.eh, ctx.calc.today, sunday) || row.assigned.slice();
  const pres = presentIds(row);
  // scelta per mansione: '' = come da regole, altrimenti id persona (override)
  const picks = {};
  CHORES.forEach((c, i) => { picks[c] = row.swapped[i] ? row.assigned[i] : ''; });
  let confirming = false, busy = false;

  const nameOr = (id) => (id ? ctx.name(id) : t('assign.nobody'));
  const effective = (c) => picks[c] || ruled[CHORES.indexOf(c)] || '';

  const s = ctx.sheet({ title: t('assign.title'), full: true, body: h('div') });

  function chipOpt(c, id, label, sub) {
    const on = (picks[c] || '') === id;
    return h('button', { type: 'button', class: 'wa-opt' + (id ? '' : ' rules'), role: 'radio', 'aria-checked': String(on), 'data-chore': c, 'data-who': id, 'data-testid': `wa-${c}-${id || 'rules'}`,
      onclick: () => { if (busy) return; picks[c] = id && id === ruled[CHORES.indexOf(c)] ? '' : id; confirming = false; draw(`${c}|${picks[c]}`); } },
    id ? avatar(ctx.name(id), ctx.color(id), 'sm') : null, h('span', { class: 'wa-lbl' }, label), sub ? h('span', { class: 'wa-sub' }, sub) : null);
  }

  function card(c, i) {
    const cur = row.assigned[i];
    // persone selezionabili: presenti (+ chi è assegnato oggi se fosse assente, così resta visibile)
    const ids = [...pres];
    for (const x of [cur, picks[c]]) if (x && !ids.includes(x)) ids.push(x);
    const rulesLabel = ruled[i] ? t('assign.rulesWho', { name: ctx.name(ruled[i]) }) : t('assign.rulesNone');
    return h('section', { class: 'wa-card', 'data-chore-card': c },
      h('div', { class: 'wa-head' }, h('div', { class: 'tile sm ' + c }, icon(CHORE_ICON[c])), h('div', { class: 'grow' }, h('div', { class: 't' }, t('chore.' + c)))),
      h('div', { class: 'wa-opts', role: 'radiogroup', 'aria-label': t('assign.group', { chore: t('chore.' + c) }) },
        chipOpt(c, '', rulesLabel),
        ids.filter((id) => id !== '').map((id) => chipOpt(c, id, ctx.name(id), pres.includes(id) ? '' : t('assign.absent')))));
  }

  function preview(after) {
    const changes = diffAssign(row.assigned, after);
    const box = h('section', { class: 'wa-prev', 'data-testid': 'wa-preview', 'aria-live': 'polite' }, h('div', { class: 'eyebrow' }, t('assign.preview')));
    if (!changes.length) { box.append(h('p', { class: 'muted small', 'data-testid': 'wa-nochange' }, t('assign.noChange'))); return { box, changes }; }
    box.append(h('div', { class: 'list' }, changes.map((x) => h('div', { class: 'li wa-change', 'data-chore': x.chore },
      h('div', { class: 'tile sm ' + x.chore }, icon(CHORE_ICON[x.chore])),
      h('div', { class: 'grow' }, h('div', { class: 't' }, t('chore.' + x.chore)),
        h('div', { class: 'd' }, t('assign.change', { from: nameOr(x.from), to: nameOr(x.to) })))))));
    // chi perde / chi prende
    const delta = {};
    for (const x of changes) {
      if (x.from) (delta[x.from] ||= { gain: [], lose: [] }).lose.push(lc(t('chore.' + x.chore)));
      if (x.to) (delta[x.to] ||= { gain: [], lose: [] }).gain.push(lc(t('chore.' + x.chore)));
    }
    const lines = Object.entries(delta).map(([id, d]) => {
      const name = ctx.name(id);
      if (d.gain.length && d.lose.length) return t('assign.p.both', { name, gain: d.gain.join(', '), lose: d.lose.join(', ') });
      return d.gain.length ? t('assign.p.gains', { name, chores: d.gain.join(', ') }) : t('assign.p.loses', { name, chores: d.lose.join(', ') });
    });
    box.append(h('ul', { class: 'wa-who small', 'data-testid': 'wa-who' }, lines.map((l) => h('li', null, l))));
    return { box, changes };
  }

  async function save(changes) {
    if (busy) return; busy = true; draw();
    const wanted = {}; for (const c of CHORES) wanted[c] = picks[c] || '';
    const logText = t('assign.log', { week: fmtWeekRange(sunday, ctx.lang), changes: changes.map((x) => t('assign.logChange', { chore: lc(t('chore.' + x.chore)), name: nameOr(x.to) })).join(', ') });
    try {
      const res = await ctx.actions.setWeekAssignments(sunday, wanted, { logText });
      ctx.haptic(ctx.prefs.haptics, 10);
      s.close();
      ctx.toast(t('assign.saved'), 7000, { action: { label: t('flow.undo'), onClick: async () => {
        try {
          await ctx.actions.setWeekAssignments(sunday, res.prev, { explicit: true, logText: t('assign.logUndo', { week: fmtWeekRange(sunday, ctx.lang) }) });
          ctx.toast(t('assign.undone'));
        } catch { ctx.toast(t('error')); }
      } } });
    } catch (e) {
      busy = false; draw();
      ctx.toast(e && e.message === 'permission' ? t('err.permission') : t('error'));
    }
  }

  function draw(focusKey) {
    const y = s.body.scrollTop;
    const after = CHORES.map((c) => effective(c));
    const { box, changes } = preview(after);
    const kids = [h('div', { class: 'wa-week', 'data-testid': 'wa-week' }, fmtWeekRange(sunday, ctx.lang)), h('p', { class: 'muted small wa-intro' }, t('assign.intro'))];
    if (!pres.length) kids.push(h('div', { class: 'note warn' }, icon('home2'), t('assign.noPeople')));
    if (row.closed) kids.push(h('div', { class: 'note warn', 'data-testid': 'wa-closed' }, icon('alert'), t('assign.closedWarn')));
    CHORES.forEach((c, i) => kids.push(card(c, i)));
    kids.push(box);
    const multi = Object.entries(loadOf(after)).filter(([, cs]) => cs.length > 1);
    for (const [id, cs] of multi) kids.push(h('div', { class: 'note', 'data-testid': 'wa-multi' }, icon('info'), t('assign.multi', { name: ctx.name(id), n: cs.length, chores: cs.map((c) => lc(t('chore.' + c))).join(', ') })));
    if (confirming) {
      kids.push(h('div', { class: 'note warn', 'data-testid': 'wa-confirm-note' }, icon('alert'), t('assign.closedAsk')),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn ghost', 'data-act': 'wa-back', onclick: () => { confirming = false; draw(); } }, t('back')),
          h('button', { type: 'button', class: 'btn', 'data-act': 'wa-confirm', disabled: busy, onclick: () => save(changes) }, icon('check'), t('assign.confirm'))));
    } else {
      kids.push(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', 'data-act': 'wa-save', disabled: busy || !changes.length, onclick: () => { if (row.closed) { confirming = true; draw(); } else save(changes); } }, icon('check'), t('save'))));
    }
    s.set(h('div', { class: 'stack wa' }, kids));
    s.body.scrollTop = y;
    if (focusKey) {
      const [c, w] = focusKey.split('|');
      const f = s.body.querySelector(`[data-chore="${c}"][data-who="${w}"]`);
      if (f) f.focus({ preventScroll: true });
    }
  }

  draw();
  return s;
}
