// Fogli (bottom sheet) legati ai turni: dettaglio turno, dettaglio settimana, WhatsApp, calendario .ics, richiesta di scambio.
// Usato da js/screens/calendar.js, home.js e more.js. Le firme esportate sono parte del contratto (ARCHITECTURE.md).
import { h, icon, avatar, toggle, seg, copyText, download, confetti, loadCss } from './ui.js';
import { registerStrings, fmtWeekRange, fmtDate, dowLong } from './i18n.js';
import { CHORES, addDays } from './engine.js';
import { weekDays, planOf, tasksForWeek, swapPatch, whatsappText, rankingText, buildStats, makeIcs } from './extras.js';
import { it, en } from './strings/cal.js';

registerStrings(it, en);
loadCss('css/calendar.css');

export const CHORE_ICON = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };
const ci = (chore) => CHORES.indexOf(chore);
const dowIdx = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

// ---------------------------------------------------------------- helpers condivisi
export const rowOf = (ctx, sunday) => ctx.calc.out.rows.find((r) => r.sunday === sunday);
const weekDoc = (ctx, sunday) => (ctx.state.weeks || {})[sunday] || {};
const houseW = (ctx) => ({ ...ctx.house, weeks: ctx.state.weeks || {} });
const present = (row) => row.nm.filter((id, s) => id && row.pr[s] === 1);
const active = (row) => row.nm.filter(Boolean);

const chip = (label, tone, ic) => h('span', { class: 'chip' + (tone ? ' ' + tone : '') }, ic ? icon(ic) : null, label);
const tile = (chore, cls = '') => h('div', { class: 'tile ' + chore + ' ' + cls }, icon(CHORE_ICON[chore] || 'dot'));
const person = (ctx, id, cls = '') => avatar(ctx.name(id), ctx.color(id), cls);

/** Etichetta e tono dello stato della settimana (dal motore). */
export function weekStatus(ctx, row) {
  const m = {
    done: ['cal.status.done', 'ok'], skipped: ['cal.status.skipped', 'bad'], tolog: ['cal.status.tolog', 'warn'], progress: ['cal.status.progress', 'acc'],
    preview: ['cal.status.preview', ''], empty: ['cal.status.empty', ''], none: ['cal.status.empty', ''],
  }[row.status] || ['cal.status.preview', ''];
  return { label: ctx.t(m[0]), tone: m[1] };
}

/** Indicatori di esito di un turno: { done|skip|late|todo, ic, tone, label }. */
export function outcomeOf(ctx, row, c) {
  if (!row.assigned[c]) return null;
  const r = row.res[c];
  if (r.kind === 'done') return { key: 'done', ic: 'check', tone: 'ok', label: ctx.t('st.done') };
  if (r.kind === 'by') return { key: 'done', ic: 'check', tone: 'ok', label: ctx.t('st.doneBy', { name: ctx.name(r.id) }) };
  if (r.kind === 'skipped') return { key: 'skip', ic: 'x', tone: 'bad', label: ctx.t('st.skipped') };
  if (r.kind === 'skippedBy') return { key: 'skip', ic: 'x', tone: 'bad', label: ctx.t('st.skippedBy', { name: ctx.name(r.id) }) };
  if (row.closed) return { key: 'late', ic: 'x', tone: 'warn', label: ctx.t('st.late') };
  if (!row.isCur && !row.isFut) return { key: 'todo', ic: 'clock', tone: 'warn', label: ctx.t('st.pending') };
  return null;
}

/** "ieri 18:40" a partire da un ISO. */
function whenLabel(ctx, iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const today = ctx.today();
  const lbl = day === today ? ctx.t('today').toLowerCase() : day === addDays(today, -1) ? ctx.t('yesterday').toLowerCase() : fmtDate(day, ctx.lang);
  return `${lbl} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Esegue un'azione con gestione errori, toast e vibrazione. Ritorna true se è andata a buon fine. */
async function run(ctx, fn, okMsg) {
  try { await fn(); if (okMsg) ctx.toast(okMsg); ctx.haptic(ctx.prefs.haptics, 10); return true; }
  catch (e) { ctx.toast(e && e.message === 'permission' ? ctx.t('err.permission') : ctx.t('error')); return false; }
}

/**
 * Sheet che si ridisegna da solo quando i dati cambiano (lo sheet vive fuori dal rerender dell'app).
 * `build(sheet, redraw)` ritorna il nodo del corpo; durante la digitazione il ridisegno è rimandato.
 */
function liveSheet(ctx, { title, full = false, build }) {
  const api = ctx.sheet({ title: '', full, body: h('div') });
  let off = () => {}; let pending = false; let dead = false;
  const typing = () => { const a = document.activeElement; return !!(a && api.el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox'); };
  const draw = (force) => {
    if (dead) return;
    if (!force && typing()) { pending = true; return; }
    pending = false;
    const y = api.body.scrollTop;
    try { const node = build(api, draw); api.setTitle(typeof title === 'function' ? title() : title); api.set(node); }
    catch (e) { console.error(e); api.set(h('p', { class: 'muted' }, ctx.t('error'))); }
    api.body.scrollTop = y;
  };
  const close = api.close;
  api.close = () => { dead = true; off(); close(); };
  api.draw = draw;
  off = ctx.store.on(() => draw(false));
  api.el.addEventListener('focusout', () => setTimeout(() => { if (pending && !typing()) draw(true); }, 90));
  draw(true);
  return api;
}

const back = (ctx, onclick) => h('button', { type: 'button', class: 'btn ghost sm cs-back', onclick }, icon('back'), ctx.t('back'));
const section = (title, ...kids) => h('section', { class: 'cs-sec' }, title ? h('div', { class: 'eyebrow' }, title) : null, ...kids);

// ================================================================ DETTAGLIO TURNO
export function openChoreSheet(ctx, sunday, chore) {
  const c = ci(chore);
  if (c < 0 || !rowOf(ctx, sunday)) return null;
  let view = 'main';

  const build = (sh) => {
    const go = (v) => { view = v; sh.draw(true); };
    const row = rowOf(ctx, sunday);
    if (!row) { sh.close(); return h('div'); }
    const A = ctx.actions;
    const assigned = row.assigned[c];
    const res = row.res[c];
    const aName = assigned ? ctx.name(assigned) : ctx.t('chore.noOne');
    const wk = weekDoc(ctx, sunday);
    const finish = async (value, msg, ev) => {
      const ok = await run(ctx, () => A.setResult(sunday, chore, value), msg);
      if (ok) {
        if (value === 'done' && ev && ev.target && ev.target.getBoundingClientRect) { const r = ev.target.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); }
        sh.close();
      }
    };

    // ------ sotto-viste ------
    if (view === 'cover') {
      const ids = present(row).filter((id) => id !== assigned && A.canResult(sunday, chore, 'by:' + id));
      const sug = row.subs[c];
      ids.sort((a, b) => (a === sug ? -1 : b === sug ? 1 : 0));
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, ctx.t('chore.whoCleaned')),
        sug && ids.includes(sug) ? h('div', { class: 'note ok' }, icon('sparkles'), ctx.t('chore.suggestedSub', { name: ctx.name(sug) })) : null,
        h('div', { class: 'list' }, ids.map((id) => h('button', { type: 'button', class: 'li cs-pick' + (id === sug ? ' sug' : ''), 'data-who': id, onclick: (ev) => finish('by:' + id, ctx.t('cal.t.by', { name: ctx.name(id) }), ev) },
          person(ctx, id), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.name(id))), id === sug ? chip(ctx.t('cal.suggested'), 'acc', 'sparkles') : null, icon('chevron')))));
    }
    if (view === 'skip') {
      const sub = row.subs[c];
      const opts = [];
      if (res.kind !== 'skipped') opts.push(h('button', { type: 'button', class: 'li cs-pick', 'data-value': 'skipped', onclick: (ev) => finish('skipped', ctx.t('cal.t.skipped'), ev) },
        h('div', { class: 'ico r' }, icon('x')), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.t('chore.nobody')), h('div', { class: 'd' }, ctx.t('cal.skipNobodyHint', { name: aName }))), icon('chevron')));
      if (sub && sub !== assigned && !(res.kind === 'skippedBy' && res.id === sub)) opts.push(h('button', { type: 'button', class: 'li cs-pick', 'data-value': 'skipped:' + sub, onclick: (ev) => finish('skipped:' + sub, ctx.t('cal.t.skipped'), ev) },
        person(ctx, sub), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.t('cal.alsoNot', { name: ctx.name(sub) })), h('div', { class: 'd' }, ctx.t('cal.skipAlsoHint', { name: ctx.name(sub) }))), icon('chevron')));
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, ctx.t('home.notDone')),
        h('div', { class: 'note warn' }, icon('alert'), ctx.t('chore.undoSkipped')),
        h('div', { class: 'list' }, opts));
    }
    if (view === 'swap') {
      const entries = [];
      CHORES.forEach((c2, i) => { const id = row.assigned[i]; if (i !== c && id && id !== assigned) entries.push({ id, chore2: c2 }); });
      for (const id of present(row)) if (id !== assigned && !row.assigned.includes(id)) entries.push({ id, chore2: null });
      const doSwap = async (e) => {
        const patch = swapPatch(row, { chore, personId: assigned }, { chore: e.chore2 || 'rest', personId: e.id });
        if (await run(ctx, () => A.setSwap(sunday, patch), ctx.t('cal.swapDone'))) go('main');
      };
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, ctx.t('chore.swapWith')),
        h('p', { class: 'muted small' }, ctx.t('cal.swapHint')),
        entries.length ? h('div', { class: 'list' }, entries.map((e) => h('button', { type: 'button', class: 'li cs-pick', 'data-who': e.id, 'data-chore': e.chore2 || 'rest', onclick: () => doSwap(e) },
          person(ctx, e.id),
          h('div', { class: 'grow' }, h('div', { class: 't' }, e.chore2 ? `${ctx.name(e.id)} · ${ctx.t('chore.' + e.chore2)}` : ctx.name(e.id)),
            h('div', { class: 'd' }, e.chore2 ? ctx.t('cal.swapSwap', { a: ctx.name(e.id), c1: ctx.t('chore.' + chore), b: aName, c2: ctx.t('chore.' + e.chore2) })
              : ctx.t('cal.swapCover', { a: aName, c1: ctx.t('chore.' + chore), b: ctx.name(e.id) }))),
          icon('chevron')))) : h('div', { class: 'empty' }, ctx.t('req.noChores')));
    }

    // ------ vista principale ------
    const plan = planOf(houseW(ctx), sunday, chore);
    const st = (() => {
      if (res.kind === 'done') return chip(ctx.t('st.done'), 'ok', 'check');
      if (res.kind === 'by') return chip(ctx.t('st.doneBy', { name: ctx.name(res.id) }), 'ok', 'check');
      if (res.kind === 'skipped') return chip(ctx.t('st.skipped'), 'bad', 'x');
      if (res.kind === 'skippedBy') return chip(ctx.t('st.skippedBy', { name: ctx.name(res.id) }), 'bad', 'x');
      if (!assigned) return chip(ctx.t('chore.noOne'), '');
      if (row.closed) return chip(ctx.t('st.late'), 'warn', 'clock');
      if (row.isFut) return chip(ctx.t('st.preview'), '');
      if (!row.isCur) return chip(ctx.t('st.pending'), 'warn', 'clock');
      return chip(ctx.t('st.todo'), 'acc');
    })();
    const by = (wk.resultBy || {})[chore], at = (wk.resultAt || {})[chore];
    const hero = h('div', { class: 'cs-hero' },
      h('div', { class: 'cs-top' }, tile(chore), h('div', { class: 'grow' }, h('div', { class: 'cs-name' }, ctx.t('chore.' + chore)), h('div', { class: 'muted small' }, `${fmtWeekRange(sunday, ctx.lang)} · ${ctx.t('cal.week', { n: row.P })}`)), st),
      h('div', { class: 'cs-who' }, assigned ? person(ctx, assigned, 'lg') : h('div', { class: 'av lg cs-none' }, '–'),
        h('div', { class: 'grow' }, h('div', { class: 'lbl' }, ctx.t('chore.assignedTo')), h('div', { class: 'cs-pname', 'data-testid': 'assignee' }, aName))),
      (row.isMakeup[c] || row.swapped[c] || plan) ? h('div', { class: 'cs-chips' },
        row.isMakeup[c] ? chip(ctx.t('chore.makeupBadge'), 'acc', 'refresh') : null,
        row.swapped[c] ? chip(ctx.t('st.swapped'), 'acc', 'swap') : null,
        plan ? chip(ctx.t('st.planned', { day: dowLong(plan, ctx.lang).toLowerCase() }), 'acc', 'calendar') : null) : null,
      row.isMakeup[c] ? h('p', { class: 'cs-hint' }, ctx.t('chore.makeupHint')) : null,
      res.kind && at ? h('div', { class: 'cs-marked' }, icon('clock'), ctx.t('cal.markedWhen', { name: by === 'admin' || !by ? ctx.t('misc.admin') : ctx.name(by), when: whenLabel(ctx, at) })) : null);

    const out = [hero];

    // azioni sul risultato
    const canDone = !!assigned && res.kind !== 'done' && A.canResult(sunday, chore, 'done');
    const coverIds = assigned ? present(row).filter((id) => id !== assigned && !(res.kind === 'by' && res.id === id) && A.canResult(sunday, chore, 'by:' + id)) : [];
    const canSkip = !!assigned && A.canResult(sunday, chore, 'skipped') && !(res.kind === 'skipped' && !(row.subs[c] && row.subs[c] !== assigned));
    const canReset = !!assigned && !!res.kind && A.canResult(sunday, chore, '');
    const canNudge = ctx.isAdmin && !!assigned && assigned !== ctx.me && !res.kind && !row.isFut;
    const acts = [];
    if (canDone) acts.push(h('button', { type: 'button', class: 'btn lg block', 'data-act': 'done', onclick: (ev) => finish('done', ctx.t('cal.t.done'), ev) }, icon('check'), ctx.t('home.markDone')));
    if (coverIds.length) {
      const single = coverIds.length === 1 && coverIds[0] === ctx.me;
      acts.push(h('button', { type: 'button', class: 'btn soft block', 'data-act': 'cover', onclick: (ev) => (single ? finish('by:' + ctx.me, ctx.t('cal.t.by', { name: ctx.meName }), ev) : go('cover')) },
        icon('users'), single ? ctx.t('cal.iCleaned', { name: aName }) : ctx.t('home.didSomeoneElse')));
    }
    if (canSkip) acts.push(h('button', { type: 'button', class: 'btn danger block', 'data-act': 'skip', onclick: () => go('skip') }, icon('x'), ctx.t('home.notDone')));
    if (canReset) acts.push(h('button', { type: 'button', class: 'btn ghost block', 'data-act': 'reset', onclick: (ev) => finish('', ctx.t('cal.t.reset'), ev) }, icon('refresh'), ctx.t('chore.reset')));
    if (canNudge) acts.push(h('button', { type: 'button', class: 'btn tonal block', 'data-act': 'nudge', onclick: async () => { await run(ctx, () => A.nudge(assigned), ctx.t('acc.nudgeSent')); } }, icon('bell'), ctx.t('cal.nudgeName', { name: aName })));
    if (acts.length) out.push(h('div', { class: 'cs-actions' }, acts));
    else if (assigned && !ctx.isAdmin && !row.isFut) out.push(h('div', { class: 'note' }, icon('lock'), ctx.t('chore.adminOnly')));

    // giorno scelto
    if (assigned && !row.closed && A.canPlan(sunday, chore)) {
      const today = ctx.today();
      out.push(section(ctx.t('chore.planDay'),
        h('div', { class: 'card stack tight' },
          h('div', { class: 'daychips', role: 'group', 'aria-label': ctx.t('chore.planDay') }, weekDays(sunday).map((d) => h('button', {
            type: 'button', class: d < today ? 'past' : '', 'aria-pressed': String(plan === d), 'data-day': d, 'aria-label': `${dowLong(d, ctx.lang)} ${fmtDate(d, ctx.lang)}`,
            onclick: () => run(ctx, () => A.setPlanDay(sunday, chore, plan === d ? null : d)),
          }, h('small', null, ctx.t('dow.' + dowIdx(d))), String(+d.slice(8))))),
          h('p', { class: 'muted small' }, ctx.t('chore.planHint')),
          plan ? h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'plan-clear', onclick: () => run(ctx, () => A.setPlanDay(sunday, chore, null)) }, icon('x'), ctx.t('chore.planClear')) : null)));
    }

    // extra ricorrenti di questo turno
    if (ctx.feature('tasks')) {
      const list = tasksForWeek(ctx.house, ctx.state.weeks || {}, sunday).filter((x) => x.chore === chore);
      if (list.length) {
        const can = A.canTask(sunday, chore);
        out.push(section(ctx.t('home.checklist'), h('div', { class: 'list' }, list.map((x) => {
          const done = x.status === 'done';
          const inner = [h('span', { class: 'checkcircle' + (done ? ' on' : '') }, icon('check')),
            h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text),
              h('div', { class: 'd' }, done ? ctx.t('tasks.doneBy', { name: ctx.name((x.done && x.done.by) || '') || ctx.t('misc.admin') }) : x.status === 'overdue' ? ctx.t('tasks.overdue', { date: fmtDate(x.since, ctx.lang) }) : ctx.t('tasks.due')))];
          return can ? h('button', { type: 'button', class: 'li cs-task', 'data-task': x.task.id, 'aria-pressed': String(done), onclick: () => run(ctx, () => A.toggleTask(sunday, x.task.id, chore, !done)) }, inner)
            : h('div', { class: 'li cs-task' }, inner);
        }))));
      }
    }

    // scambio turno (richiesta)
    if (ctx.feature('requests') && ctx.me && assigned === ctx.me && !row.closed) {
      const mine = Object.entries(ctx.state.requests || {}).filter(([, q]) => q.kind !== 'nudge' && q.week === sunday && q.from === ctx.me && q.fromChore === chore && q.status === 'pending');
      out.push(section(ctx.t('req.title'), h('div', { class: 'stack tight' },
        mine.map(([id, q]) => h('div', { class: 'li cs-req' }, h('div', { class: 'ico' }, icon('swap')),
          h('div', { class: 'grow' }, h('div', { class: 't' }, `${ctx.name(q.to)} · ${ctx.t('chore.' + q.toChore)}`), h('div', { class: 'd' }, ctx.t('req.pending'))),
          h('button', { type: 'button', class: 'btn soft sm', onclick: () => run(ctx, () => A.cancelSwap(id)) }, ctx.t('req.cancel')))),
        h('button', { type: 'button', class: 'btn soft block', 'data-act': 'request', onclick: () => openSwapRequestSheet(ctx, sunday, chore) }, icon('swap'), ctx.t('req.new')))));
    }

    // admin: scambio concordato manuale
    if (ctx.isAdmin && assigned) {
      out.push(section(ctx.t('chore.swap'), h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn soft', 'data-act': 'swap', onclick: () => go('swap') }, icon('swap'), ctx.t('chore.swapWith')),
        row.swapped.some(Boolean) ? h('button', { type: 'button', class: 'btn danger', 'data-act': 'swap-cancel', onclick: () => run(ctx, () => A.clearSwap(sunday), ctx.t('cal.swapCleared')) }, icon('x'), ctx.t('cal.swapCancel')) : null)));
    }
    return h('div', { class: 'stack' }, out);
  };

  return liveSheet(ctx, { title: () => ctx.t('chore.' + chore), build });
}

// ================================================================ DETTAGLIO SETTIMANA
/** Contenuto del dettaglio settimana (usato dallo sheet e dal pannello desktop del calendario). */
export function renderWeekDetail(ctx, sunday, { heading = false } = {}) {
  const row = rowOf(ctx, sunday);
  if (!row) return h('div');
  const A = ctx.actions; const wk = weekDoc(ctx, sunday);
  const stat = weekStatus(ctx, row);
  const out = [];

  out.push(h('div', { class: 'wd-head' },
    heading ? h('h2', { class: 'wd-title' }, fmtWeekRange(sunday, ctx.lang)) : null,
    h('div', { class: 'row wrap' }, chip(stat.label, stat.tone), row.isCur ? chip(ctx.t('cal.current'), 'acc') : null, h('span', { class: 'muted small' }, ctx.t('cal.week', { n: row.P })))));
  if (row.isFut) out.push(h('div', { class: 'note' }, icon('info'), ctx.t('cal.provisional')));
  if (row.status === 'empty' || row.status === 'none') out.push(h('div', { class: 'note warn' }, icon('home2'), ctx.t('cal.emptyHouse')));

  // turni
  out.push(h('div', { class: 'list wd-chores' }, CHORES.map((chore, c) => {
    const id = row.assigned[c]; const oc = outcomeOf(ctx, row, c); const plan = planOf(houseW(ctx), sunday, chore);
    return h('button', { type: 'button', class: 'chore wd-chore', 'data-chore': chore, onclick: () => openChoreSheet(ctx, sunday, chore) },
      tile(chore),
      h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.t('chore.' + chore)),
        h('div', { class: 's' }, id ? [person(ctx, id, 'sm'), h('span', { class: 'wd-pn' }, ctx.name(id))] : h('span', null, ctx.t('chore.noOne')),
          row.isMakeup[c] ? chip(ctx.t('chore.makeupBadge'), 'acc', 'refresh') : null,
          row.swapped[c] ? chip(ctx.t('st.swapped'), 'acc', 'swap') : null,
          plan ? chip(`${ctx.t('dow.' + dowIdx(plan))} ${+plan.slice(8)}`, '', 'calendar') : null)),
      oc ? h('span', { class: 'ind ' + oc.tone, title: oc.label, 'aria-label': oc.label }, icon(oc.ic)) : null,
      icon('chevron'));
  })));

  // riposo
  if (row.rest.length) out.push(h('div', { class: 'wd-rest' }, h('div', { class: 'tile rest' }, icon('moon')), h('div', { class: 'grow' }, h('div', { class: 'lbl' }, ctx.t('cal.rest')), h('div', { class: 'wd-names' }, row.rest.map((id) => h('span', { class: 'wd-name' }, person(ctx, id, 'sm'), ctx.name(id)))))));

  // assenti
  const people = active(row);
  if (people.length) {
    const everyone = !!wk.everyone;
    const rows = people.map((id) => {
      const manual = !!(wk.awayMap || {})[id];
      const away = row.away.includes(id);
      const byTrip = away && !manual && !everyone;
      const can = A.canAway(id) && !everyone && !byTrip;
      let end = null;
      if (can) { end = toggle(away, async (on) => { if (!(await run(ctx, () => A.setAway(sunday, id, on)))) sh_revert(end, !on); }, ctx.t('cal.awayAria', { name: ctx.name(id) })); end.querySelector('input').dataset.person = id; }
      else if (away) end = chip(ctx.t('cal.away'), 'warn', 'plane');
      return h('div', { class: 'li wd-away', 'data-person': id }, person(ctx, id), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.name(id)), byTrip ? h('div', { class: 'd' }, ctx.t('cal.awayTrip')) : null), end);
    });
    const evSw = ctx.isAdmin ? (() => { const sw = toggle(everyone, async (on) => { if (!(await run(ctx, () => A.setEveryoneAway(sunday, on)))) sh_revert(sw, !on); }, ctx.t('cal.everyoneAway')); sw.querySelector('input').dataset.everyone = '1'; return h('div', { class: 'li wd-away wd-all' }, h('div', { class: 'ico o' }, icon('plane')), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.t('cal.everyoneAway')), h('div', { class: 'd' }, ctx.t('cal.everyoneHint'))), sw); })() : null;
    out.push(section(ctx.t('cal.away'), h('div', { class: 'list' }, rows, evSw), h('p', { class: 'muted small cs-cap' }, ctx.t('cal.awayHint'))));
  }

  // nota
  const canNote = ctx.isAdmin || !!ctx.me;
  if (canNote || wk.note) {
    const ta = h('textarea', { class: 'input wd-note', rows: 3, placeholder: ctx.t('cal.notePh'), 'aria-label': ctx.t('cal.note'), value: wk.note || '', maxlength: 400 });
    out.push(section(ctx.t('cal.note'), canNote
      ? h('div', { class: 'card stack tight' }, ta, h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn tonal sm', 'data-act': 'note-save', onclick: () => run(ctx, () => A.setNote(sunday, ta.value.trim()), ctx.t('misc.noteSaved')) }, icon('check'), ctx.t('save'))))
      : h('div', { class: 'card' }, wk.note)));
  }

  // extra ricorrenti
  if (ctx.feature('tasks')) {
    const list = tasksForWeek(ctx.house, ctx.state.weeks || {}, sunday);
    if (list.length) out.push(section(ctx.t('home.checklist'), h('div', { class: 'list' }, list.map((x) => {
      const done = x.status === 'done'; const c = ci(x.chore); const who = row.assigned[c];
      const can = A.canTask(sunday, x.chore);
      const inner = [h('span', { class: 'checkcircle' + (done ? ' on' : '') }, icon('check')), h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text), h('div', { class: 'd' }, `${ctx.t('chore.' + x.chore)}${who ? ' · ' + ctx.name(who) : ''}`))];
      return can ? h('button', { type: 'button', class: 'li cs-task', 'data-task': x.task.id, 'aria-pressed': String(done), onclick: () => run(ctx, () => A.toggleTask(sunday, x.task.id, x.chore, !done)) }, inner) : h('div', { class: 'li cs-task' }, inner);
    }))));
  }

  // scambi concordati (admin)
  if (row.swapped.some(Boolean)) {
    out.push(section(ctx.t('cal.swapsInWeek'), h('div', { class: 'card stack tight' },
      CHORES.map((chore, c) => (row.swapped[c] ? h('div', { class: 'row' }, tile(chore, 'sm'), h('div', { class: 'grow' }, h('b', null, ctx.t('chore.' + chore)), ' · ', ctx.name(row.assigned[c]))) : null)),
      ctx.isAdmin ? h('button', { type: 'button', class: 'btn danger sm', 'data-act': 'swap-cancel-week', onclick: () => run(ctx, () => A.clearSwap(sunday), ctx.t('cal.swapCleared')) }, icon('x'), ctx.t('cal.swapCancel')) : null)));
  }

  // condivisione
  const share = [];
  if (ctx.feature('whatsapp')) share.push(h('button', { type: 'button', class: 'btn soft', 'data-act': 'whatsapp', onclick: () => openWhatsAppSheet(ctx, sunday) }, icon('whatsapp'), ctx.t('cal.whatsapp')));
  if (ctx.feature('ics')) share.push(h('button', { type: 'button', class: 'btn soft', 'data-act': 'ics', onclick: () => openIcsSheet(ctx, sunday) }, icon('calendar'), ctx.t('cal.ics')));
  if (share.length) out.push(h('div', { class: 'btn-row' }, share));
  return h('div', { class: 'stack wd' }, out);
}
function sh_revert(sw, val) { try { sw.querySelector('input').checked = val; } catch { /* ignore */ } }

export function openWeekSheet(ctx, sunday) {
  const row0 = rowOf(ctx, sunday);
  if (!row0) return null;
  return liveSheet(ctx, { title: () => fmtWeekRange(sunday, ctx.lang), full: true, build: () => renderWeekDetail(ctx, sunday) });
}

// ================================================================ WHATSAPP
export function openWhatsAppSheet(ctx, sunday) {
  const out0 = ctx.calc.out;
  const st = { week: sunday, link: ctx.cloud, tasks: true, plan: true, away: true, deadline: true };
  const gen = () => whatsappText(ctx.house, ctx.calc.out, st.week, { link: st.link, url: ctx.joinLink(), tasks: st.tasks, plan: st.plan, away: st.away, deadline: st.deadline }, ctx.lang, ctx.state.weeks || {});

  // settimane selezionabili: scorsa / questa / prossima (+ quella da cui si arriva, se diversa)
  const opts = [];
  const rows = out0.rows;
  const add = (s, label) => { if (s && !opts.some((o) => o[0] === s)) opts.push([s, label]); };
  if (out0.cur >= 0) { add((rows[out0.cur - 1] || {}).sunday, ctx.t('wa.lastWeek')); add(rows[out0.cur].sunday, ctx.t('wa.thisWeek')); add((rows[out0.cur + 1] || {}).sunday, ctx.t('wa.nextWeek')); }
  if (!opts.some((o) => o[0] === sunday)) opts.unshift([sunday, fmtWeekRange(sunday, ctx.lang)]);

  const ta = h('textarea', { class: 'input cs-wa', rows: 10, 'aria-label': ctx.t('wa.preview') });
  const waUrl = (txt) => 'https://wa.me/?text=' + encodeURIComponent(txt);
  const send = h('a', { class: 'btn', target: '_blank', rel: 'noopener', 'data-act': 'wa-send' }, icon('whatsapp'), ctx.t('wa.send'));
  const refresh = () => { ta.value = gen(); send.href = waUrl(ta.value); };
  ta.addEventListener('input', () => { send.href = waUrl(ta.value); });

  const sw = (label, key, show = true) => (show ? h('div', { class: 'li' }, h('div', { class: 'grow' }, label), toggle(st[key], (v) => { st[key] = v; refresh(); }, label)) : null);
  const body = h('div', { class: 'stack' },
    opts.length > 1 ? h('div', { class: 'field' }, h('label', null, ctx.t('wa.scope')), seg(opts, st.week, (v) => { st.week = v; refresh(); })) : null,
    h('div', { class: 'field' }, h('label', null, ctx.t('wa.preview')), ta),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn soft', 'data-act': 'wa-copy', onclick: async () => { ctx.toast((await copyText(ta.value)) ? ctx.t('copied') : ctx.t('error')); ctx.haptic(ctx.prefs.haptics, 8); } }, icon('copy'), ctx.t('wa.copy')),
      send),
    h('div', { class: 'eyebrow' }, ctx.t('wa.options')),
    h('div', { class: 'list' },
      sw(ctx.t('wa.opt.link'), 'link'), sw(ctx.t('wa.opt.tasks'), 'tasks', ctx.feature('tasks')), sw(ctx.t('wa.opt.plan'), 'plan', ctx.feature('planDay')),
      sw(ctx.t('wa.opt.away'), 'away'), sw(ctx.t('wa.opt.deadline'), 'deadline')),
    ctx.feature('ranking') ? rankingBlock(ctx) : null);
  const sheetApi = ctx.sheet({ title: ctx.t('wa.title'), full: true, body });
  refresh();
  return sheetApi;
}

function rankingBlock(ctx) {
  const out = ctx.calc.out;
  let text = '';
  try { const stats = buildStats(houseW(ctx), out); if (!stats.people.length) return null; text = rankingText(ctx.house, out, stats, ctx.lang); } catch { return null; }
  return h('div', { class: 'stack tight cs-rank' },
    h('div', { class: 'eyebrow' }, ctx.t('stats.ranking')),
    h('pre', { class: 'cs-pre', 'data-testid': 'ranking-text' }, text),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn soft', 'data-act': 'rank-copy', onclick: async () => { ctx.toast((await copyText(text)) ? ctx.t('copied') : ctx.t('error')); } }, icon('copy'), ctx.t('wa.copy')),
      h('a', { class: 'btn tonal', target: '_blank', rel: 'noopener', 'data-act': 'rank-send', href: 'https://wa.me/?text=' + encodeURIComponent(text) }, icon('trophy'), ctx.t('stats.share'))));
}

// ================================================================ CALENDARIO .ics
export function openIcsSheet(ctx, sunday) {
  const COUNT = 8;
  const out = ctx.calc.out;
  const from = (out.rows[out.cur >= 0 ? out.cur : 0] || { sunday }).sunday;
  const span = out.rows.filter((r) => r.sunday >= from).slice(0, COUNT);
  const ids = [];
  for (const r of span) for (const id of r.assigned) if (id && !ids.includes(id)) ids.push(id);
  const st = { who: ctx.me && ids.includes(ctx.me) ? ctx.me : (ctx.isAdmin && ids[0]) || ctx.me };

  const sh = ctx.sheet({ title: ctx.t('cal.icsTitle'), body: h('div') });
  const draw = () => {
    const mine = span.map((r) => ({ r, cs: CHORES.filter((_, i) => r.assigned[i] === st.who) })).filter((x) => x.cs.length);
    const text = st.who ? makeIcs(ctx.house, out, st.who, ctx.lang, ctx.state.weeks || {}, from, COUNT) : '';
    const n = mine.reduce((a, x) => a + x.cs.length, 0);
    sh.set(h('div', { class: 'stack' },
      h('p', { class: 'muted' }, ctx.t('cal.icsHint', { n: COUNT })),
      ctx.isAdmin && ids.length ? h('div', { class: 'field' }, h('label', null, ctx.t('cal.icsWho')),
        (() => { const s = h('select', { class: 'input', 'aria-label': ctx.t('cal.icsWho'), onchange: (e) => { st.who = e.target.value; draw(); } }, ids.map((id) => h('option', { value: id, selected: id === st.who }, ctx.name(id)))); s.value = st.who; return s; })()) : null,
      n ? h('div', { class: 'list' }, mine.map(({ r, cs }) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, fmtWeekRange(r.sunday, ctx.lang)), h('div', { class: 'd' }, cs.map((c) => ctx.t('chore.' + c)).join(', '))))))
        : h('div', { class: 'empty' }, icon('calendar'), ctx.t('cal.icsEmpty')),
      n ? h('p', { class: 'muted small' }, ctx.t('cal.icsCount', { n })) : null,
      h('button', { type: 'button', class: 'btn lg block', 'data-act': 'ics-download', disabled: !n, onclick: () => {
        const slug = String(ctx.name(st.who) || 'turni').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'turni';
        download(`tidyhouse-${slug}.ics`, text, 'text/calendar;charset=utf-8'); ctx.toast(ctx.t('cal.icsDone')); ctx.haptic(ctx.prefs.haptics, 8);
      } }, icon('download'), ctx.t('cal.icsDownload'))));
  };
  draw();
  return sh;
}

// ================================================================ RICHIESTA DI SCAMBIO
export function openSwapRequestSheet(ctx, sunday, chore) {
  const row = rowOf(ctx, sunday);
  if (!row || !ctx.me) return null;
  const mineChores = CHORES.filter((_, i) => row.assigned[i] === ctx.me);
  const st = { my: mineChores.includes(chore) ? chore : mineChores[0], pick: null };
  const sh = ctx.sheet({ title: ctx.t('req.new'), body: h('div') });
  const draw = () => {
    if (!mineChores.length) { sh.set(h('div', { class: 'empty' }, icon('swap'), ctx.t('req.noChores'))); return; }
    const others = [];
    CHORES.forEach((c2, i) => { const id = row.assigned[i]; if (id && id !== ctx.me) others.push({ id, chore: c2 }); });
    if (!others.length) { sh.set(h('div', { class: 'empty' }, icon('swap'), ctx.t('req.noChores'))); return; }
    sh.set(h('div', { class: 'stack' },
      h('p', { class: 'muted' }, ctx.t('cal.reqHint')),
      mineChores.length > 1 ? h('div', { class: 'field' }, h('label', null, ctx.t('req.mine')), seg(mineChores.map((c) => [c, ctx.t('chore.' + c)]), st.my, (v) => { st.my = v; draw(); }))
        : h('div', { class: 'li cs-mine' }, tile(st.my, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'lbl' }, ctx.t('req.mine')), h('div', { class: 't' }, ctx.t('chore.' + st.my)))),
      h('div', { class: 'eyebrow' }, ctx.t('cal.reqPick')),
      h('div', { class: 'list' }, others.map((o) => h('button', { type: 'button', class: 'li cs-pick' + (st.pick && st.pick.id === o.id && st.pick.chore === o.chore ? ' sug' : ''), 'data-who': o.id, 'data-chore': o.chore, 'aria-pressed': String(!!(st.pick && st.pick.id === o.id && st.pick.chore === o.chore)), onclick: () => { st.pick = o; draw(); } },
        person(ctx, o.id), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.name(o.id)), h('div', { class: 'd' }, `${ctx.t('req.theirs')}: ${ctx.t('chore.' + o.chore)}`)),
        st.pick && st.pick.id === o.id && st.pick.chore === o.chore ? icon('check') : null))),
      h('button', { type: 'button', class: 'btn lg block', 'data-act': 'req-send', disabled: !st.pick, onclick: async () => {
        if (await run(ctx, () => ctx.actions.requestSwap({ week: sunday, myChore: st.my, otherId: st.pick.id, otherChore: st.pick.chore }), ctx.t('req.sent'))) sh.close();
      } }, icon('swap'), ctx.t('cal.reqSend'))));
  };
  draw();
  return sh;
}
