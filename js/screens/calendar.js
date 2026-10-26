// Schermata "Settimane": elenco verticale delle settimane (storico, corrente, anteprime) con dettaglio.
// Su desktop (>=1180px) affianca alla lista il dettaglio della settimana selezionata.
import { h, icon, avatar } from '../ui.js';
import { fmtWeekRange, fmtDate, dowLong } from '../i18n.js';
import { CHORES } from '../engine.js';
import { planOf } from '../extras.js';
import { CHORE_ICON, openWeekSheet, renderWeekDetail, weekStatus, outcomeOf } from '../choresheet.js';

const WIDE = '(min-width: 1180px)';
const BACK = 6, AHEAD = 12, STEP = 8;

// stato effimero del modulo (la schermata viene ricostruita a ogni cambio dati)
let more = 0;            // quante tranche di storico in più sono mostrate
let selected = null;     // settimana selezionata nel pannello desktop
let prevNode = null;     // nodo dell'ultimo render: se non è più nel DOM siamo a una nuova visita
let anchor = null;       // {sunday, top} per mantenere la posizione quando si caricano settimane precedenti
let mq = null;

const dowIdx = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

function weekCard(ctx, row, { wide, selectedSunday }) {
  const stat = weekStatus(ctx, row);
  const wkDoc = (ctx.state.weeks || {})[row.sunday] || {};
  const range = fmtWeekRange(row.sunday, ctx.lang);
  const isSel = wide && selectedSunday === row.sunday;
  const house = { ...ctx.house, weeks: ctx.state.weeks || {} };
  const empty = row.status === 'empty' || row.status === 'none';

  const chores = CHORES.map((chore, c) => {
    const id = row.assigned[c];
    const oc = outcomeOf(ctx, row, c);
    const plan = planOf(house, row.sunday, chore);
    const inds = [];
    if (oc) inds.push(h('span', { class: 'ind ' + oc.tone, title: oc.label }, icon(oc.ic)));
    if (id && row.isMakeup[c]) inds.push(h('span', { class: 'ind acc', title: ctx.t('st.makeup') }, icon('refresh')));
    if (id && row.swapped[c]) inds.push(h('span', { class: 'ind acc', title: ctx.t('st.swapped') }, icon('swap')));
    if (id && plan) inds.push(h('span', { class: 'ind plan', title: ctx.t('cal.chosenDay', { day: `${dowLong(plan, ctx.lang)} ${fmtDate(plan, ctx.lang)}` }) }, ctx.t('dow.' + dowIdx(plan))));
    return h('span', { class: 'wk-chore', 'data-chore': chore },
      h('span', { class: 'l' }, h('i', { class: 'dot ' + chore }), ctx.t('chore.' + chore + '.short')),
      h('span', { class: 'm' }, id ? avatar(ctx.name(id), ctx.color(id), 'sm') : h('span', { class: 'av sm cs-none' }, '–'), h('span', { class: 'inds' }, inds)),
      h('span', { class: 'n' + (id ? '' : ' none') }, id ? ctx.name(id) : (empty ? '' : ctx.t('chore.noOne'))));
  });

  const foot = [];
  if (row.rest.length) foot.push(h('span', { class: 'wk-meta' }, icon('moon'), ctx.t('cal.restNames', { names: row.rest.map((id) => ctx.name(id)).join(', ') })));
  if (row.away.length && !empty) foot.push(h('span', { class: 'wk-meta' }, icon('plane'), ctx.t('cal.awayNames', { names: row.away.map((id) => ctx.name(id)).join(', ') })));
  if (empty) foot.push(h('span', { class: 'wk-meta' }, icon('home2'), ctx.t('cal.emptyHouse')));

  const card = h('button', {
    type: 'button', class: 'week' + (row.isCur ? ' cur' : '') + (row.closed ? ' past' : '') + (row.isFut ? ' fut' : '') + (isSel ? ' sel' : '') + (empty ? ' empty' : ''),
    'data-sunday': row.sunday, 'aria-label': `${range}, ${stat.label}`, 'aria-current': row.isCur ? 'date' : null,
    onclick: () => {
      ctx.haptic(ctx.prefs.haptics, 6);
      if (window.matchMedia(WIDE).matches) { selected = row.sunday; ctx.rerender(); } else openWeekSheet(ctx, row.sunday);
    },
  },
  h('span', { class: 'wk-head' },
    h('span', { class: 'grow' }, h('span', { class: 'wk-title' }, range), h('span', { class: 'wk-sub' }, row.isCur ? ctx.t('cal.current') + ' · ' : '', ctx.t('cal.week', { n: row.P }))),
    wkDoc.note ? h('span', { class: 'ind note', title: ctx.t('cal.hasNote') }, icon('edit')) : null,
    h('span', { class: 'chip ' + stat.tone }, stat.label)),
  h('span', { class: 'wk-chores' }, chores),
  foot.length ? h('span', { class: 'wk-foot' }, foot) : null);
  return card;
}

export async function render(ctx) {
  const { out } = ctx.calc;
  const rows = out.rows;
  const cur = out.cur;
  const wide = window.matchMedia(WIDE).matches;
  if (!mq) { mq = window.matchMedia(WIDE); mq.addEventListener('change', () => { if (document.querySelector('.cal')) ctx.rerender(); }); }

  const newVisit = !prevNode || !prevNode.isConnected;
  if (newVisit) { more = 0; selected = null; }
  if (!selected || !rows.some((r) => r.sunday === selected)) selected = cur >= 0 ? rows[cur].sunday : (rows[0] || {}).sunday;

  const first = cur >= 0 ? Math.max(0, cur - BACK - STEP * more) : 0;
  const last = cur >= 0 ? Math.min(rows.length - 1, cur + AHEAD) : Math.min(rows.length - 1, AHEAD);
  const shown = rows.slice(first, last + 1);

  const list = h('div', { class: 'cal-list' });
  if (first > 0) {
    list.append(h('button', { type: 'button', class: 'btn soft block cal-more', 'data-act': 'show-prev', onclick: () => {
      const a = document.querySelector('.cal-list .week'); anchor = a ? { sunday: a.dataset.sunday, top: a.getBoundingClientRect().top } : null;
      more++; ctx.rerender();
    } }, icon('history'), ctx.t('cal.showPrev')));
  }
  let group = '';
  for (const row of shown) {
    const g = row.isCur ? 'cur' : row.closed || (!row.isFut && !row.isCur) ? 'past' : 'next';
    if (g !== group && cur >= 0) {
      group = g;
      list.append(h('div', { class: 'eyebrow cal-group' }, ctx.t(g === 'past' ? 'cal.past' : g === 'cur' ? 'cal.current' : 'cal.nextWeeks')));
    }
    list.append(weekCard(ctx, row, { wide, selectedSunday: selected }));
  }

  const head = h('div', { class: 'cal-head' },
    h('h1', { class: 'title' }, ctx.t('cal.title')),
    cur >= 0 ? h('button', { type: 'button', class: 'btn tonal sm', 'data-act': 'today', onclick: () => goToday(ctx) }, icon('calendar'), ctx.t('cal.goToday')) : null);

  const notStarted = cur < 0 && ctx.house.startSunday ? h('div', { class: 'note' }, icon('info'), ctx.t('cal.planStarts', { date: fmtDate(addDaysIso(ctx.house.startSunday, -6), ctx.lang, { year: true }) })) : null;

  const panel = wide && selected ? h('aside', { class: 'cal-panel card', 'aria-label': ctx.t('cal.title') }, renderWeekDetail(ctx, selected, { heading: true })) : null;
  const node = h('div', { class: 'cal' }, head, notStarted, h('div', { class: 'cal-layout' }, list, panel));
  prevNode = node;

  // dopo l'inserimento nel DOM: scroll automatico alla settimana corrente (prima visita) o mantenimento della posizione
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!node.isConnected) return;
    if (anchor) {
      const el = node.querySelector(`.week[data-sunday="${anchor.sunday}"]`);
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - anchor.top);
      anchor = null;
    } else if (newVisit) {
      const el = node.querySelector('.week.cur');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }));
  return node;
}

function addDaysIso(s, k) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); }

function goToday(ctx) {
  const cur = ctx.calc.out.cur; if (cur < 0) return;
  const sunday = ctx.calc.out.rows[cur].sunday;
  selected = sunday;
  const el = document.querySelector(`.week[data-sunday="${sunday}"]`);
  const smooth = !ctx.prefs.reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (el) el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  if (window.matchMedia(WIDE).matches) ctx.rerender();
}
