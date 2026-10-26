// Home a widget: turno personale, settimana, avvisi, extra ricorrenti, scorciatoie, link, assenze, anteprima, recuperi, classifica, spesa.
// L'ordine e la visibilita' vengono da ctx.homeLayout(). choresheet.js e trips.js si importano solo al click.
import { h, icon, avatar, loadCss, confetti, haptic, promptDialog, confirmDialog } from '../ui.js';
import { fmtWeekRange, fmtDate, dowLong, registerStrings } from '../i18n.js';
import { CHORES, validateRoommates } from '../engine.js';
import { planOf, tasksForWeek, buildStats, weekDays } from '../extras.js';
import { it, en } from '../strings/home.js';
registerStrings(it, en);

const IC = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };
const WEIGHT = { hero: 3.2, alerts: 1.2, week: 3.4, checklist: 2, quick: 1.4, links: 0.7, away: 1, upcoming: 2.4, makeups: 1.6, ranking: 2.2, needs: 1.6 };
const popKeys = new Set();      // turni appena segnati da questo dispositivo: animazione del check
let lastRender = 0;

const dowOf = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
const chip = (cls, text, ic) => h('span', { class: 'chip' + (cls ? ' ' + cls : '') }, ic ? icon(ic) : null, h('span', { class: 'hm-ell' }, text));
const safeUrl = (u) => { try { const x = new URL(String(u || '').trim()); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

/** Importa un modulo scritto da altri solo al click: se manca, la Home resta in piedi. */
async function lazy(ctx, loader, fn) {
  try { const m = await loader(); await fn(m); } catch (e) { console.warn('home: modulo non disponibile', e); ctx.toast(ctx.t('error')); }
}
const openChore = (ctx, sunday, chore) => lazy(ctx, () => import('../choresheet.js'), (m) => m.openChoreSheet(ctx, sunday, chore));
const openWeek = (ctx, sunday) => lazy(ctx, () => import('../choresheet.js'), (m) => m.openWeekSheet(ctx, sunday));

// ---------------- modello dei dati della settimana ----------------
function model(ctx) {
  const { out, eh } = ctx.calc;
  const cur = out.cur, me = ctx.me;
  const row = cur >= 0 ? out.rows[cur] : null;
  const prev = cur >= 1 ? out.rows[cur - 1] : null;
  const idx = [0, 1, 2];
  const mine = row && me ? idx.filter((c) => row.assigned[c] === me) : [];
  const late = prev && me ? idx.filter((c) => prev.assigned[c] === me && !prev.res[c].kind) : [];
  return { out, eh, cur, row, prev, me, mine, late, today: ctx.today() };
}
const extrasLeft = (ctx, M, sunday, c) => (ctx.feature('tasks') ? tasksForWeek(M.eh, ctx.weeks, sunday).filter((x) => x.chore === CHORES[c] && x.status !== 'done').length : 0);

/** Chip di stato di un turno. */
function turnChips(ctx, M, row, c, isLate) {
  const t = ctx.t, r = row.res[c], out = [];
  if (r.kind === 'done') out.push(['ok', t('st.done'), 'check']);
  else if (r.kind === 'by') out.push(['ok', t('st.doneBy', { name: ctx.name(r.id) }), 'check']);
  else if (r.kind === 'skipped') out.push(['bad', t('st.skipped'), 'x']);
  else if (r.kind === 'skippedBy') out.push(['bad', t('st.skippedBy', { name: ctx.name(r.id) }), 'x']);
  else if (isLate) out.push(['bad', t('st.late'), 'clock']);
  else out.push(['', t('st.todo')]);
  if (row.isMakeup[c]) out.push(['warn', t('st.makeup'), 'history']);
  if (!r.kind) { const d = planOf(M.eh, row.sunday, CHORES[c]); if (d) out.push(['acc', t('st.planned', { day: dowLong(d) }), 'calendar']); }
  if (row.swapped[c]) out.push(['', t('st.swapped'), 'swap']);
  return out;
}

async function markDone(ctx, sunday, c, ev) {
  const b = ev.currentTarget; const r = b.getBoundingClientRect(); b.disabled = true;
  popKeys.add(sunday + '|' + c);
  try {
    await ctx.actions.setResult(sunday, CHORES[c], 'done');
    haptic(ctx.prefs.haptics, 14); confetti(r.left + r.width / 2, r.top + r.height / 2); ctx.toast(ctx.t('home.doneToast'));
  } catch (e) { popKeys.delete(sunday + '|' + c); b.disabled = false; ctx.toast(ctx.t('error')); }
}

async function setSelfAway(ctx, sunday, on, revert) {
  const t = ctx.t;
  if (on) {
    const ok = await confirmDialog({ title: t('home.awayConfirmTitle'), text: t('home.awayConfirm'), ok: t('home.imAway') });
    if (!ok) { revert && revert(); return; }
  }
  try { await ctx.actions.setAway(sunday, ctx.me, on); ctx.toast(on ? t('home.awayDone') : t('home.backDone')); } catch { revert && revert(); ctx.toast(t('error')); }
}
const canSelfAway = (ctx) => !!ctx.me && ctx.feature('selfAway') && ctx.actions.canAway(ctx.me);
/** L'assenza e' stata segnata a mano (e quindi annullabile) o deriva da viaggi / "tutti via"? */
const manualAway = (M) => ((M.eh.weeks[M.row.sunday] || {}).away || []).includes(M.me);

// ---------------- HERO ----------------
function heroCard({ variant = '', kicker, ic, big, sub, chips = [], actions = [], list = null, foot = null, testid }) {
  return h('section', { class: 'hero hm-hero' + (variant ? ' ' + variant : ''), 'data-widget': 'hero', 'data-testid': testid || null },
    kicker ? h('div', { class: 'k' }, kicker) : null,
    h('div', { class: 'hm-herohead' }, ic ? h('div', { class: 'tile hm-herotile' }, icon(ic)) : null, h('div', { class: 'big' }, big)),
    sub ? h('p', { class: 'hm-herosub' }, sub) : null,
    chips.length ? h('div', { class: 'meta' }, chips.map(([cls, text, ic2]) => chip(cls, text, ic2))) : null,
    actions.filter(Boolean).length ? h('div', { class: 'hm-heroactions' }, actions) : null,
    list, foot);
}

function widgetHero(ctx, M) {
  const t = ctx.t, { row, me } = M;
  const wrap = h('div', { class: 'hm-herowrap' });
  const mini = (items) => items.length ? h('div', { class: 'hm-minis' }, h('div', { class: 'hm-minik' }, t('home.alsoThisWeek')), items.map((it2) => miniRow(ctx, M, it2))) : null;

  if (!row) {
    const start = fmtDate(M.eh.startSunday ? shiftDays(M.eh.startSunday, -6) : '', ctx.lang, { dow: true });
    wrap.append(heroCard({ kicker: t('home.thisWeek'), ic: 'calendar', big: t('home.beforeStart', { date: start }), sub: t('home.beforeStartHint'), testid: 'hero-before' }));
    return wrap;
  }
  const curItems = M.mine.map((c) => ({ sunday: row.sunday, row, c, late: false }));
  const lateItems = M.late.map((c) => ({ sunday: M.prev.sunday, row: M.prev, c, late: true }));
  const pendCur = curItems.filter((x) => !row.res[x.c].kind);
  const unresolvedCur = pendCur.length;
  const iAmAway = row.away.includes(me);
  const awayBtn = (!iAmAway && row.nm.includes(me) && canSelfAway(ctx) && !M.late.length) ? h('button', { class: 'hm-heroaway', type: 'button', onclick: () => setSelfAway(ctx, row.sunday, true) }, icon('plane'), t('home.imAway')) : null;

  // --- in ritardo ---
  if (lateItems.length) {
    const f = lateItems[0], rest = [...lateItems.slice(1), ...curItems];
    const canDone = ctx.actions.canResult(f.sunday, CHORES[f.c], 'done');
    wrap.append(heroCard({
      variant: 'late', testid: 'hero-late', kicker: `${t('st.late')} · ${t('home.weekOf', { range: fmtWeekRange(f.sunday) })}`, ic: IC[CHORES[f.c]], big: t('chore.' + CHORES[f.c]), sub: t('home.lateHint'),
      chips: [['', t('st.late'), 'clock'], ...(M.prev.isMakeup[f.c] ? [['', t('st.makeup'), 'history']] : [])],
      actions: [canDone ? h('button', { class: 'btn lg', type: 'button', 'data-act': 'done', onclick: (e) => markDone(ctx, f.sunday, f.c, e) }, icon('check'), t('home.markDone')) : null,
        h('button', { class: 'btn glass lg', type: 'button', onclick: () => openChore(ctx, f.sunday, CHORES[f.c]) }, t('home.didSomeoneElse'))],
      list: mini(rest),
    }));
    return wrap;
  }
  // --- ho turni ---
  if (curItems.length) {
    if (unresolvedCur) {
      const f = pendCur[0], c = f.c, ch = CHORES[c];
      const chips = [['', t('home.dueSunday'), 'clock']];
      if (row.isMakeup[c]) chips.push(['', t('st.makeup'), 'history']);
      const d = planOf(M.eh, row.sunday, ch); if (d) chips.push(['', t('st.planned', { day: dowLong(d) }), 'calendar']);
      if (row.swapped[c]) chips.push(['', t('st.swapped'), 'swap']);
      const ex = extrasLeft(ctx, M, row.sunday, c); if (ex) chips.push(['', `${ex} ${t('tasks.extra')}`, 'list']);
      const canDone = ctx.actions.canResult(row.sunday, ch, 'done');
      const canPlan = ctx.feature('planDay') && ctx.actions.canPlan(row.sunday, ch);
      wrap.append(heroCard({
        testid: 'hero-todo', kicker: curItems.length > 1 ? `${t('home.yourTurn')} · ${t('home.nTurns', { n: curItems.length })}` : t('home.yourTurn'), ic: IC[ch], big: t('chore.' + ch), chips,
        actions: [canDone ? h('button', { class: 'btn lg', type: 'button', 'data-act': 'done', onclick: (e) => markDone(ctx, row.sunday, c, e) }, icon('check'), t('home.markDone')) : null,
          canPlan ? h('button', { class: 'btn glass lg', type: 'button', onclick: () => openChore(ctx, row.sunday, ch) }, icon('calendar'), t('home.chooseDay')) : null],
        list: mini(curItems.filter((x) => x.c !== c)), foot: awayBtn,
      }));
      const tip = planTip(ctx, M, f); if (tip) wrap.append(tip);
      return wrap;
    }
    const skipped = curItems.some((x) => row.res[x.c].kind === 'skipped' || row.res[x.c].kind === 'skippedBy');
    wrap.append(heroCard({
      variant: skipped ? '' : 'calm', testid: 'hero-done', kicker: t('home.thisWeek'), ic: 'check', big: skipped ? t('home.allWeeksDone') : t('home.allDone'),
      chips: [['', t('home.doneOf', { done: curItems.length, total: curItems.length }), 'check']], list: curItems.length > 1 ? mini(curItems) : null, foot: awayBtn,
    }));
    return wrap;
  }
  // --- riposo / assente / fuori elenco / nessun turno ---
  if (row.rest.includes(me)) {
    wrap.append(heroCard({ variant: 'rest', testid: 'hero-rest', kicker: t('home.thisWeek'), ic: 'moon', big: t('home.restWeek'), sub: t('home.restHint'), foot: awayBtn }));
  } else if (iAmAway) {
    const manual = manualAway(M), can = canSelfAway(ctx);
    wrap.append(heroCard({
      variant: 'away', testid: 'hero-away', kicker: t('home.thisWeek'), ic: 'plane', big: t('home.awayWeek'), sub: manual ? t('home.awayHint') : t('home.awayTrip'),
      actions: manual && can ? [h('button', { class: 'btn lg', type: 'button', onclick: () => setSelfAway(ctx, row.sunday, false) }, icon('check'), t('home.imBack'))] : [],
    }));
  } else if (!row.nm.includes(me)) {
    wrap.append(heroCard({ variant: 'away', testid: 'hero-noroster', kicker: t('home.thisWeek'), ic: 'info', big: t('home.noRoster'), sub: t('home.noRosterHint') }));
  } else {
    wrap.append(heroCard({ testid: 'hero-none', kicker: t('home.thisWeek'), ic: 'sparkles', big: t('home.noTurn'), sub: t('home.noTurnHint'), foot: awayBtn }));
  }
  return wrap;
}
const shiftDays = (s, k) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

function miniRow(ctx, M, it2) {
  const t = ctx.t, r = it2.row.res[it2.c], ch = CHORES[it2.c];
  const resolved = !!r.kind, ok = r.kind === 'done' || r.kind === 'by';
  return h('button', { class: 'hm-mini' + (resolved ? ' is-done' : ''), type: 'button', 'aria-label': t('home.rowAria', { chore: t('chore.' + ch), who: resolved ? turnChips(ctx, M, it2.row, it2.c, it2.late)[0][1] : t('st.todo') }), onclick: () => openChore(ctx, it2.sunday, ch) },
    h('span', { class: 'hm-minitile' }, icon(IC[ch])),
    h('span', { class: 'grow hm-ellblock' }, h('b', null, t('chore.' + ch)), it2.late ? h('small', null, ' · ' + t('home.weekOf', { range: fmtWeekRange(it2.sunday) })) : (it2.row.isMakeup[it2.c] ? h('small', null, ' · ' + t('st.makeup')) : null)),
    ok ? h('span', { class: 'hm-minicheck' }, icon('check')) : resolved ? h('span', { class: 'hm-minicheck skip' }, icon('x')) : h('span', { class: 'hm-minigo' }, icon('chevron')));
}

/** Suggerimento "giorno scelto" con selettore rapido (solo se non ancora scelto). */
function planTip(ctx, M, f) {
  const row = M.row, ch = CHORES[f.c], t = ctx.t;
  if (!ctx.feature('planDay') || !ctx.actions.canPlan(row.sunday, ch) || planOf(M.eh, row.sunday, ch)) return null;
  const days = weekDays(row.sunday);
  const pills = days.map((d) => {
    const past = d < M.today;
    return h('button', { type: 'button', class: past ? 'past' : '', disabled: past || null, 'aria-pressed': 'false', 'aria-label': `${dowLong(d)} ${fmtDate(d)}`, 'data-day': d,
      onclick: async () => { try { await ctx.actions.setPlanDay(row.sunday, ch, d); haptic(ctx.prefs.haptics, 8); ctx.toast(t('st.planned', { day: dowLong(d) })); } catch { ctx.toast(t('error')); } } },
    h('small', null, t('dow.' + dowOf(d))), h('span', null, d.slice(8).replace(/^0/, '')));
  });
  return h('div', { class: 'hm-tip', 'data-testid': 'plan-tip' }, h('div', { class: 'hm-tiphead' }, icon('calendar'), h('span', null, t('home.tipPlanDay'))), h('div', { class: 'daychips' }, pills));
}

// ---------------- WEEK ----------------
function widgetWeek(ctx, M) {
  const { row, me } = M, t = ctx.t;
  if (!row) return null;
  const items = [0, 1, 2].map((c) => {
    const a = row.assigned[c], r = row.res[c], ch = CHORES[c];
    const on = r.kind === 'done' || r.kind === 'by', sk = r.kind === 'skipped' || r.kind === 'skippedBy';
    const key = row.sunday + '|' + c, pop = popKeys.has(key);
    const who = a ? ctx.name(a) : t('chore.noOne');
    return h('button', { class: 'chore hm-chore' + (a && a === me ? ' mine' : '') + (on ? ' done' : ''), type: 'button', 'data-chore': ch, 'aria-label': t('home.rowAria', { chore: t('chore.' + ch), who }), onclick: () => openChore(ctx, row.sunday, ch) },
      h('div', { class: 'tile ' + ch }, icon(IC[ch])),
      h('div', { class: 'grow' },
        h('div', { class: 't hm-ell' }, t('chore.' + ch)),
        h('div', { class: 's' }, a ? avatar(who, ctx.color(a), 'sm') : null, h('span', { class: 'hm-who hm-ell' }, who), turnChips(ctx, M, row, c, false).map(([cls, text, ic]) => chip(cls, text, ic)))),
      h('span', { class: 'checkcircle' + (on ? ' on' : '') + (sk ? ' skip' : '') + (pop ? ' pop' : '') }, icon(sk ? 'x' : 'check')));
  });
  const restRow = row.rest.length ? h('div', { class: 'chore hm-chore hm-restrow', 'data-chore': 'rest' }, h('div', { class: 'tile rest' }, icon('moon')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, t('chore.rest')), h('div', { class: 's' }, row.rest.map((id) => h('span', { class: 'hm-person' }, avatar(ctx.name(id), ctx.color(id), 'sm'), h('span', { class: 'hm-ell' }, ctx.name(id))))))) : null;
  const n = row.npres;
  const away = row.away.map((id) => ctx.name(id));
  const foot = h('div', { class: 'hm-foot' }, icon('users'), h('span', null, n === 1 ? t('home.person1') : t('home.people', { n })), away.length ? h('span', { class: 'hm-footaway' }, ' · ' + t('home.awayLine', { names: away.join(', ') })) : null);
  const empty = row.status === 'empty';
  return h('section', { class: 'hm-w', 'data-widget': 'week' }, h('div', { class: 'eyebrow' }, h('span', null, t('widget.week')), h('a', { href: '#/calendar' }, t('nav.calendar'))),
    empty ? h('div', { class: 'card hm-emptycard' }, icon('home2'), h('div', null, t('home.emptyWeek')), foot)
      : h('div', { class: 'list hm-chores' }, items, restRow, foot));
}

// ---------------- ALERTS ----------------
function alertRow({ tone, ic, title, desc, onclick, href, actions, testid }) {
  const body = [h('div', { class: 'ico ' + tone }, icon(ic)), h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null, actions ? h('div', { class: 'hm-alertactions' }, actions) : null)];
  if (onclick) return h('button', { class: 'li hm-alert', type: 'button', 'data-testid': testid || null, onclick }, body, h('div', { class: 'end' }, icon('chevron')));
  if (href) return h('a', { class: 'li hm-alert', href, 'data-testid': testid || null }, body, h('div', { class: 'end' }, icon('chevron')));
  return h('div', { class: 'li hm-alert', 'data-testid': testid || null }, body);
}
function widgetAlerts(ctx, M) {
  const t = ctx.t, rows = [];
  const { row, prev, me } = M;
  if (prev) {
    const pend = [0, 1, 2].filter((c) => prev.assigned[c] && !prev.res[c].kind);
    if (pend.length && (ctx.isAdmin || pend.some((c) => prev.assigned[c] !== me))) {
      rows.push(alertRow({ tone: 'o', ic: 'clock', title: pend.length === 1 ? t('home.lastWeekPending1') : t('home.lastWeekPending', { n: pend.length }), desc: t('home.lastWeekHint'), onclick: () => openWeek(ctx, prev.sunday), testid: 'alert-lastweek' }));
    }
  }
  if (row && me) {
    const p = M.out.summary.people.find((x) => x.id === me);
    if (p) {
      const open = p.makeups.reduce((a, v) => a + Math.max(0, v), 0);
      const thisWeek = [0, 1, 2].filter((c) => row.assigned[c] === me && row.isMakeup[c]).length;
      const n = open - thisWeek;
      if (n > 0) rows.push(alertRow({ tone: 'p', ic: 'history', title: n === 1 ? t('home.myMakeups1') : t('home.myMakeups', { n }), desc: t('home.myMakeupsHint'), href: '#/calendar', testid: 'alert-makeups' }));
    }
  }
  if (ctx.isAdmin) {
    for (const r of ctx.actions.leftSinceRotation()) {
      rows.push(alertRow({ tone: 'r', ic: 'shield', title: t('home.leftOut', { name: r.name }), desc: t('home.leftOutHint'), testid: 'alert-left',
        actions: [h('a', { class: 'btn sm', href: '#/settings/invite' }, t('home.newCode')),
          h('button', { class: 'btn sm soft', type: 'button', onclick: async () => { try { await ctx.actions.setHouse({ ignoreLeft: { [r.id]: true } }); } catch { ctx.toast(t('error')); } } }, t('home.ignore'))] }));
    }
    for (const k of new Set(validateRoommates(ctx.house.roommates || [], M.today))) {
      rows.push(alertRow({ tone: 'o', ic: 'alert', title: t('set.roommates.' + k), href: '#/settings/roommates', testid: 'alert-' + k }));
    }
  }
  if (!rows.length) return null;
  return h('section', { class: 'hm-w', 'data-widget': 'alerts' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.alerts'))), h('div', { class: 'list' }, rows));
}

// ---------------- CHECKLIST ----------------
function widgetChecklist(ctx, M) {
  const t = ctx.t;
  if (!ctx.feature('tasks') || !M.row) return null;
  const { row, me } = M;
  const list = tasksForWeek(M.eh, ctx.weeks, row.sunday).filter((x) => {
    const a = row.assigned[CHORES.indexOf(x.chore)];
    return a && (a === me || ctx.isAdmin);
  });
  if (!list.length) return null;
  const done = list.filter((x) => x.status === 'done').length;
  const rows = list.map((x) => {
    const idx = CHORES.indexOf(x.chore), a = row.assigned[idx], isDone = x.status === 'done';
    const can = ctx.actions.canTask(row.sunday, x.chore);
    const toggleSunday = isDone && x.done && x.done.week ? x.done.week : row.sunday;
    return h('button', { class: 'li hm-task' + (isDone ? ' is-done' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(isDone), disabled: can ? null : true, 'data-task': x.task.id,
      onclick: async () => { try { await ctx.actions.toggleTask(toggleSunday, x.task.id, x.chore, !isDone); haptic(ctx.prefs.haptics, 8); } catch { ctx.toast(t('error')); } } },
    h('span', { class: 'checkcircle' + (isDone ? ' on' : '') }, icon('check')),
    h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text),
      h('div', { class: 'd hm-taskmeta' }, chip('', t('chore.' + x.chore), IC[x.chore]),
        a && a !== me ? h('span', { class: 'hm-person' }, avatar(ctx.name(a), ctx.color(a), 'sm'), h('span', { class: 'hm-ell' }, ctx.name(a))) : null,
        x.status === 'overdue' ? chip('warn', t('tasks.overdue', { date: fmtDate(x.since) }), 'clock') : null,
        isDone && x.done && x.done.by ? h('span', null, t('tasks.doneBy', { name: x.done.by === 'admin' ? t('misc.admin') : ctx.name(x.done.by) })) : null)));
  });
  return h('section', { class: 'hm-w', 'data-widget': 'checklist' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.checklist')), h('span', { class: 'hm-prog', 'data-testid': 'checklist-progress' }, `${done}/${list.length}`)), h('div', { class: 'list' }, rows));
}

// ---------------- QUICK ----------------
function widgetQuick(ctx, M) {
  const t = ctx.t, btns = [];
  const q = (ic, label, fn, id) => h('button', { class: 'hm-q', type: 'button', 'data-q': id, onclick: fn }, h('span', { class: 'hm-qi' }, icon(ic)), h('span', { class: 'hm-ql' }, label));
  if (ctx.feature('trips') && ctx.me && ctx.actions.canTrip(ctx.me)) btns.push(q('plane', t('trips.add'), () => lazy(ctx, () => import('../screens/trips.js'), (m) => m.openTripSheet(ctx, ctx.me)), 'trip'));
  if (ctx.feature('needs')) btns.push(q('cart', t('home.addNeed'), async () => {
    const text = await promptDialog({ title: t('home.addNeed'), label: t('needs.add'), placeholder: t('needs.placeholder'), ok: t('add') });
    if (text === null || !String(text).trim()) return;
    try { await ctx.actions.addNeed(text); ctx.toast(t('home.needAdded')); } catch { ctx.toast(t('error')); }
  }, 'need'));
  if (ctx.feature('whatsapp') && M.row) btns.push(q('whatsapp', t('cal.whatsapp'), () => lazy(ctx, () => import('../choresheet.js'), (m) => m.openWhatsAppSheet(ctx, M.row.sunday)), 'wa'));
  if (ctx.feature('requests') && M.row && ctx.me) btns.push(q('swap', t('home.swapTurn'), () => {
    const c = M.mine.find((x) => !M.row.res[x].kind) ?? M.mine[0];
    if (c === undefined) return ctx.nav('requests');
    return lazy(ctx, () => import('../choresheet.js'), (m) => m.openSwapRequestSheet(ctx, M.row.sunday, CHORES[c]));
  }, 'swap'));
  if (!btns.length) return null;
  return h('section', { class: 'hm-w', 'data-widget': 'quick' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.quick'))), h('div', { class: 'hm-quick' }, btns));
}

// ---------------- LINKS ----------------
function widgetLinks(ctx) {
  const t = ctx.t, L = ctx.house.links || {}, items = [];
  const add = (ic, label, url, id) => { const u = safeUrl(url); if (u) items.push(h('a', { class: 'hm-link', href: u, target: '_blank', rel: 'noopener noreferrer', 'data-link': id }, h('span', { class: 'hm-linkic' }, icon(ic)), h('span', { class: 'hm-ell grow' }, label), icon('chevron'))); };
  if (L.tricount && L.tricount.show !== false) add('tricount', t('home.tricount'), L.tricount.url, 'tricount');
  if (L.whatsapp && L.whatsapp.show !== false) add('whatsapp', t('home.waGroup'), L.whatsapp.url, 'whatsapp');
  for (const c of L.custom || []) if (c && c.show !== false) { let label = c.label; if (!label) { try { label = new URL(c.url).hostname; } catch { label = ''; } } add('link', label || t('set.customLink'), c.url, c.id || 'custom'); }
  if (!items.length) return null;
  return h('section', { class: 'hm-w', 'data-widget': 'links' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.links'))), h('div', { class: 'hm-links' }, items));
}

// ---------------- AWAY ----------------
function widgetAway(ctx, M) {
  const t = ctx.t, { row, me } = M;
  if (!row) return null;
  const can = canSelfAway(ctx) && row.nm.includes(me);
  if (!row.away.length && !can) return null;
  const people = row.away.length ? h('div', { class: 'hm-awaypeople' }, row.away.map((id) => h('span', { class: 'hm-person pill' }, avatar(ctx.name(id), ctx.color(id), 'sm'), h('span', { class: 'hm-ell' }, ctx.name(id))))) : h('div', { class: 'muted small' }, t('home.nobodyAway'));
  let toggleRow = null;
  if (can) {
    const isAway = row.away.includes(me), manual = isAway ? manualAway(M) : true;
    const inp = h('input', { type: 'checkbox', role: 'switch', 'aria-label': t('home.imAway'), disabled: manual ? null : true, onchange: (e) => { const on = e.target.checked; setSelfAway(ctx, row.sunday, on, () => { inp.checked = !on; }); } });
    inp.checked = isAway;
    toggleRow = h('div', { class: 'row-between hm-awayrow' }, h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 600 } }, t('home.imAway')), !manual ? h('div', { class: 'small muted' }, t('home.awayTrip')) : null), h('label', { class: 'switch' }, inp, h('i')));
  }
  return h('section', { class: 'hm-w', 'data-widget': 'away' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.awayThisWeek'))), h('div', { class: 'card hm-awaycard' }, people, toggleRow));
}

// ---------------- UPCOMING ----------------
function widgetUpcoming(ctx, M) {
  const t = ctx.t, { out, cur } = M;
  const rows = out.rows.slice(cur + 1, cur + 4);
  if (!rows.length) return null;
  const items = rows.map((r) => h('button', { class: 'li hm-up', type: 'button', 'data-week': r.sunday, onclick: () => openWeek(ctx, r.sunday) },
    h('div', { class: 'grow' }, h('div', { class: 'hm-uphead' }, h('b', null, fmtWeekRange(r.sunday)), chip('', t('st.preview'))),
      r.status === 'empty' ? h('div', { class: 'd' }, t('st.empty')) : h('div', { class: 'hm-upturns' }, [0, 1, 2].map((c) => h('span', { class: 'hm-upturn' }, h('span', { class: 'hm-minitile ' + CHORES[c] }, icon(IC[CHORES[c]])), h('span', { class: 'hm-ell' + (r.assigned[c] ? '' : ' muted') }, r.assigned[c] ? ctx.name(r.assigned[c]) : '–'))))),
    h('div', { class: 'end' }, icon('chevron'))));
  return h('section', { class: 'hm-w', 'data-widget': 'upcoming' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.upcoming')), h('a', { href: '#/calendar' }, t('home.seeAll'))), h('div', { class: 'list' }, items));
}

// ---------------- MAKEUPS ----------------
function widgetMakeups(ctx, M) {
  const t = ctx.t;
  const ppl = M.out.summary.people.map((p) => ({ p, mk: p.makeups.map((v) => Math.max(0, v)), rests: Math.max(0, p.rests) })).filter((x) => x.mk.some(Boolean) || x.rests);
  if (!ppl.length) return null;
  const num = (v) => h('td', null, v ? h('span', { class: 'hm-num on' }, v) : h('span', { class: 'hm-num' }, '·'));
  const head = h('tr', null, h('th', { class: 'l' }, t('misc.person')), [0, 1, 2].map((c) => h('th', { 'aria-label': t('chore.' + CHORES[c]), title: t('chore.' + CHORES[c]) }, h('span', { class: 'hm-minitile ' + CHORES[c] }, icon(IC[CHORES[c]])))), h('th', { 'aria-label': t('stats.openRests'), title: t('stats.openRests') }, h('span', { class: 'hm-minitile rest' }, icon('moon'))));
  const body = ppl.map(({ p, mk, rests }) => h('tr', null, h('td', { class: 'l' }, h('span', { class: 'hm-person' }, avatar(p.name, ctx.color(p.id), 'sm'), h('span', { class: 'hm-ell' }, p.name))), mk.map(num), num(rests)));
  return h('section', { class: 'hm-w', 'data-widget': 'makeups' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.makeups'))), h('div', { class: 'card hm-tablecard' }, h('table', { class: 'hm-table' }, h('thead', null, head), h('tbody', null, body))));
}

// ---------------- RANKING ----------------
function widgetRanking(ctx, M) {
  const t = ctx.t;
  if (!ctx.feature('ranking') || !M.row) return null;
  const st = buildStats(M.eh, M.out);
  if (!st.people.length || !st.closedWeeks) return null;
  const sorted = [...st.people].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5);
  const rows = sorted.map((p, i) => h('div', { class: 'rank hm-rank' + (p.id === M.me ? ' me' : ''), 'data-person': p.id },
    h('div', { class: 'pos' }, i + 1),
    h('div', { class: 'hm-rankwho' }, avatar(p.name, ctx.color(p.id), 'sm'), h('span', { class: 'hm-ell' }, p.name), p.tr ? h('span', { class: 'chip acc', title: t('stats.tr') }, 'TR') : null, p.cdm ? h('span', { class: 'chip bad', title: t('stats.cdm') }, 'CDM') : null),
    h('div', { class: 'hm-rankscore', title: t('stats.cleaned') }, h('b', null, p.score))));
  return h('section', { class: 'hm-w', 'data-widget': 'ranking' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.ranking')), h('a', { href: '#/stats' }, t('home.seeAll'))), h('div', { class: 'list' }, rows));
}

// ---------------- NEEDS ----------------
function widgetNeeds(ctx) {
  const t = ctx.t;
  if (!ctx.feature('needs')) return null;
  const all = Object.entries(ctx.state.needs || {}).filter(([, n]) => n && !n.done).map(([id, n]) => ({ id, ...n }))
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || String(a.at || '').localeCompare(String(b.at || '')));
  if (!all.length) return null;
  const rows = all.slice(0, 4).map((n) => h('div', { class: 'li hm-need', 'data-need': n.id },
    h('button', { class: 'hm-needbtn', type: 'button', 'aria-label': `${t('needs.bought')}: ${n.text}`, onclick: async () => { try { await ctx.actions.setNeedDone(n.id, true); haptic(ctx.prefs.haptics, 8); } catch { ctx.toast(t('error')); } } }, h('span', { class: 'checkcircle' }, icon('check'))),
    h('div', { class: 'grow' }, h('div', { class: 't hm-ell' }, n.text), n.by ? h('div', { class: 'd hm-ell' }, t('needs.addedBy', { name: ctx.name(n.by) === '?' ? t('misc.admin') : ctx.name(n.by) })) : null),
    n.urgent ? chip('bad', t('needs.urgent')) : null));
  if (all.length > 4) rows.push(h('a', { class: 'li hm-more', href: '#/needs' }, h('div', { class: 'grow muted' }, t('home.moreN', { n: all.length - 4 })), h('div', { class: 'end' }, icon('chevron'))));
  return h('section', { class: 'hm-w', 'data-widget': 'needs' }, h('div', { class: 'eyebrow' }, h('span', null, t('home.needs')), h('a', { href: '#/needs' }, t('home.seeAll'))), h('div', { class: 'list' }, rows));
}

const WIDGETS = { hero: widgetHero, alerts: widgetAlerts, week: widgetWeek, checklist: widgetChecklist, quick: widgetQuick, links: widgetLinks, away: widgetAway, upcoming: widgetUpcoming, makeups: widgetMakeups, ranking: widgetRanking, needs: widgetNeeds };

// ---------------- intestazione ----------------
function openWho(ctx) {
  const today = ctx.today();
  const people = (ctx.house.roommates || []).filter((r) => r.name && (!r.to || r.to >= today));
  ctx.sheet({ title: ctx.t('join.who'), body: (api) => h('div', { class: 'who-grid', 'data-testid': 'who-sheet' }, people.map((r) => h('button', { class: 'who', type: 'button', 'aria-pressed': String(r.id === ctx.me), 'data-person': r.id, onclick: () => { api.close(); if (r.id !== ctx.me) ctx.setMe(r.id); } }, avatar(r.name, ctx.color(r.id)), h('span', { class: 'grow hm-ell' }, r.name)))) });
}
function header(ctx, M) {
  const t = ctx.t;
  const sub = M.row ? t('home.weekOf', { range: fmtWeekRange(M.row.sunday) }) : t('home.beforeStart', { date: fmtDate(shiftDays(M.eh.startSunday, -6), ctx.lang, { dow: true }) });
  return h('header', { class: 'hm-head' },
    h('h1', { class: 'title hm-title' }, t('home.hello', { name: ctx.meName })),
    h('p', { class: 'hm-sub', 'data-testid': 'week-range' }, sub),
    h('button', { class: 'hm-switch', type: 'button', onclick: () => openWho(ctx) }, h('span', null, t('home.who', { name: ctx.meName })), h('b', null, t('home.changeWho'))));
}

// ---------------- render ----------------
export async function render(ctx) {
  loadCss('css/home.css');
  const M = model(ctx);
  const layout = ctx.homeLayout();
  const nodes = [];
  for (const id of layout.order) {
    if (layout.hidden.includes(id) || !WIDGETS[id]) continue;
    let n = null;
    try { n = WIDGETS[id](ctx, M); } catch (e) { console.error('home widget ' + id, e); }
    if (n) nodes.push([id, n]);
  }
  // due colonne (>=1180px): hero e settimana nella principale, gli altri sul lato meno carico. Sotto resta l'ordine scelto (CSS: display: contents + order).
  const cols = [[], []], load = [0, 0];
  nodes.forEach(([id, n], i) => {
    n.classList.add('hm-w'); n.style.order = String(i); n.style.setProperty('--i', String(Math.min(i, 8)));
    const k = id === 'hero' || id === 'week' ? 0 : load[0] <= load[1] ? 0 : 1;
    cols[k].push(n); load[k] += WEIGHT[id] || 1.5;
  });
  const now = Date.now(); const enter = now - lastRender > 2500; lastRender = now;
  const grid = h('div', { class: 'home-grid hm-grid' + (cols[1].length ? '' : ' single') }, h('div', { class: 'col' }, cols[0]), cols[1].length ? h('div', { class: 'col' }, cols[1]) : null);
  const root = h('div', { class: 'hm' + (enter ? ' hm-enter' : ''), 'data-screen': 'home' },
    header(ctx, M), grid,
    h('div', { class: 'hm-customize' }, h('button', { class: 'btn soft', type: 'button', 'data-act': 'customize', onclick: () => ctx.nav('settings/home') }, icon('settings'), ctx.t('home.customize'))));
  setTimeout(() => popKeys.clear(), 1500);
  return root;
}
