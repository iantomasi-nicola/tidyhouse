// «Extra di tutti» (solo admin): controlla le voci extra (sub-task delle mansioni) di tutti, per settimana, e le segna fatte o da fare.
// Usa le stesse scritture di sempre (Actions.toggleTask via tickTask): nessuna logica nuova.
import { h, icon, avatar, loadCss } from './ui.js';
import { registerStrings, fmtWeekRange } from './i18n.js';
import { liveSheet, ownedItems, tickTask, taskNote } from './choresheet.js';
import { cName, cIcon } from './choreui.js';
import { it, en } from './strings/taskcheck.js';

registerStrings(it, en);
loadCss('css/balance.css');
const WEEKS_BACK = 12;

/** Apre il foglio (solo admin). `sunday` = settimana di partenza (default: la corrente). */
export function openTaskCheckSheet(ctx, sunday = null) {
  if (!ctx.isAdmin) { ctx.toast(ctx.t('err.permission')); return null; }
  const t = ctx.t;
  const rows = ctx.calc.out.rows; const curIdx = rows.findIndex((r) => r.isCur);
  let idx = sunday ? rows.findIndex((r) => r.sunday === sunday) : curIdx; if (idx < 0) idx = Math.max(0, curIdx);
  const lo = Math.max(0, curIdx - WEEKS_BACK);
  return liveSheet(ctx, { title: () => t('tkc.title'), full: true, build: (api) => {
    const row = rows[idx];
    const items = ownedItems(ctx, row.sunday);
    const byOwner = new Map();
    for (const x of items) { const k = x.owner || ''; if (!byOwner.has(k)) byOwner.set(k, []); byOwner.get(k).push(x); }
    const go = (d) => { idx = Math.min(curIdx, Math.max(lo, idx + d)); api.draw(true); };
    const nav = h('div', { class: 'tkc-nav' },
      h('button', { type: 'button', class: 'btn ghost sm', 'data-act': 'tkc-prev', 'aria-label': t('tkc.prev'), disabled: idx <= lo, onclick: () => go(-1) }, icon('back')),
      h('div', { class: 'grow tkc-week', 'data-testid': 'tkc-week' }, fmtWeekRange(row.sunday, ctx.lang)),
      h('button', { type: 'button', class: 'btn ghost sm', 'data-act': 'tkc-next', 'aria-label': t('tkc.next'), disabled: idx >= curIdx, onclick: () => go(1) }, icon('chevron')));
    const kids = [h('p', { class: 'muted small' }, t('tkc.intro')), nav];
    if (!items.length) kids.push(h('div', { class: 'note' }, icon('info'), t('tkc.empty')));
    for (const [owner, list] of byOwner) {
      const done = list.filter((x) => x.status === 'done').length;
      kids.push(h('section', { class: 'bal-card', 'data-person': owner },
        h('div', { class: 'bal-who' }, owner ? avatar(ctx.name(owner), ctx.color(owner), 'sm') : null, h('span', { class: 'grow' }, owner ? ctx.name(owner) : t('tkc.nobody')), h('span', { class: 'chip ' + (done === list.length ? 'ok' : 'warn') }, t('tkc.count', { a: done, b: list.length }))),
        ...list.map((x) => {
          const isDone = x.status === 'done'; const who = owner ? ctx.name(owner) : '';
          return h('button', { type: 'button', class: 'li hm-task' + (isDone ? ' is-done' : ''), role: 'checkbox', 'aria-checked': String(isDone), 'data-task': x.task.id, 'data-who': owner,
            'aria-label': t(isDone ? 'tkc.markTodo' : 'tkc.markDone', { text: x.task.text, name: who }),
            onclick: async () => { try { await tickTask(ctx, row.sunday, x, !isDone); ctx.haptic(ctx.prefs.haptics, 8); } catch { ctx.toast(t('error')); } } },
          h('span', { class: 'checkcircle' + (isDone ? ' on' : '') }, icon('check')),
          h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text),
            h('div', { class: 'd' }, h('span', { class: 'chip' }, icon(cIcon(ctx, x.chore)), cName(ctx, x.chore)), ' ', taskNote(ctx, x))));
        })));
    }
    return h('div', { class: 'stack bal' }, kids);
  } });
}
