// Schermata "Classifica e statistiche": podio, classifica, KPI della casa, grafici SVG, dettaglio persona.
import { h, icon, loadCss, avatar, empty, copyText } from '../ui.js';
import { t, registerStrings, fmtWeekRange } from '../i18n.js';
import { buildStats, rankingText } from '../extras.js';
import { CHORES } from '../engine.js';
import { it, en } from '../strings/stats.js';
registerStrings(it, en);

const SVGNS = 'http://www.w3.org/2000/svg';
const CHORE_ICON = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };
const SPARK_WEEKS = 12;

// stato effimero (sopravvive ai rerender)
let modeOverride = null; // 'turns' | 'effort' | null = default della casa

// ---------------------------------------------------------------- SVG helpers
function S(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
const num = (n) => Math.round(n * 100) / 100;
/** Rettangolo con raggi per angolo [tl, tr, br, bl]. */
function rr(x, y, w, hh, [tl, tr, br, bl]) {
  return `M${num(x + tl)} ${num(y)}H${num(x + w - tr)}${tr ? `A${tr} ${tr} 0 0 1 ${num(x + w)} ${num(y + tr)}` : ''}V${num(y + hh - br)}${br ? `A${br} ${br} 0 0 1 ${num(x + w - br)} ${num(y + hh)}` : ''}H${num(x + bl)}${bl ? `A${bl} ${bl} 0 0 1 ${num(x)} ${num(y + hh - bl)}` : ''}V${num(y + tl)}${tl ? `A${tl} ${tl} 0 0 1 ${num(x + tl)} ${num(y)}` : ''}Z`;
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** Scala "pulita": passo 1/2/5/10… con al massimo 4 intervalli. */
function niceScale(max) {
  if (max <= 0) return { top: 4, step: 1 };
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (max / step <= 4) return { top: Math.ceil(max / step) * step, step };
  return { top: Math.ceil(max / 1000) * 1000, step: 250 };
}
const choreName = (c) => t('chore.' + c);
const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${t('monl.' + (mo - 1))} ${y}`; };

// ---------------------------------------------------------------- dati derivati
function scoreView(ctx, st, mode, showRank) {
  const people = st.people.map((p) => ({ ...p, score: mode === 'effort' ? p.effort : p.cleanedTotal }));
  const max = Math.max(0, ...people.map((p) => p.score));
  for (const p of people) { p.tr = showRank && p.score > 0 && p.score === max; p.cdm = showRank && p.cdm; }
  people.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let pos = 0;
  people.forEach((p, i) => { if (i === 0 || p.score !== people[i - 1].score) pos = i + 1; p.pos = pos; });
  return { people, max };
}

/** Pulizie per settimana per persona (ultime SPARK_WEEKS settimane chiuse nella finestra). */
function weeklySeries(out, st, ids) {
  const rows = out.rows.filter((r) => r.closed && r.P >= st.from).slice(-SPARK_WEEKS);
  const series = {};
  for (const id of ids) {
    series[id] = rows.map((r) => {
      const slot = r.nm.indexOf(id);
      const v = CHORES.reduce((a, _c, c) => a + (r.cleaner[c] === id ? 1 : 0), 0);
      const skip = r.sk.some((x) => x === id);
      const away = slot < 0 || (r.pr[slot] === 0 && v === 0 && !skip);
      return { v: away ? null : v, skip, sunday: r.sunday, away };
    });
  }
  return { rows, series };
}

// ---------------------------------------------------------------- schermata
export async function render(ctx) {
  loadCss('css/stats.css');
  const showStats = ctx.feature('stats');
  const showRank = ctx.feature('ranking');
  const house = ctx.house;
  const { eh, out } = ctx.calc;
  const st = buildStats(eh, out);
  const defMode = (house.settings || {}).rankBy === 'effort' ? 'effort' : 'turns';
  const effNon1 = ['floor', 'bathroom', 'kitchen'].some((k) => st.effort[k] !== 1);
  const canSwitch = effNon1 || defMode === 'effort';
  const mode = canSwitch ? (modeOverride || defMode) : 'turns';

  const page = h('div', { class: 'stats-page' });
  const win = (house.settings || {}).window === 0 ? t('stats.allTime') : t('stats.window', { n: (house.settings || {}).window ?? 52 });
  page.append(h('h1', { class: 'title' }, t('stats.title')), h('p', { class: 'subtitle', id: 'stats-window' }, win));

  if (!st.closedWeeks || !st.people.length) {
    page.append(h('div', { class: 'card' }, empty('trophy', t('stats.noData'), t('stats.noDataHint'))));
    return page;
  }
  const view = scoreView(ctx, st, mode, showRank);

  const rankCol = h('div', { class: 'stats-col' }, rankingCard(ctx, st, view, mode, canSwitch, showStats, showRank));
  const grid = h('div', { class: 'stats-grid' + (showStats ? '' : ' simple') }, rankCol);
  if (showStats) {
    const side = h('div', { class: 'stats-col' }, kpiSection(ctx, st), chartsSection(ctx, st, view, out));
    grid.append(side);
  }
  page.append(grid);
  return page;
}

// ---------------------------------------------------------------- classifica
function rankingCard(ctx, st, view, mode, canSwitch, showStats, showRank) {
  const { people, max } = view;
  const unit = mode === 'effort' ? t('stats.pts') : t('stats.cleanedUnit');
  const head = h('div', { class: 'rank-head' },
    h('h2', { class: 'sec-title' }, t('stats.ranking')),
    h('div', { class: 'rank-tools' },
      canSwitch ? h('div', { class: 'seg rank-seg', role: 'group', 'aria-label': t('stats.rankBy') },
        ['turns', 'effort'].map((m) => h('button', { type: 'button', 'data-mode': m, 'aria-pressed': String(mode === m), onclick: () => { modeOverride = m; ctx.rerender(); } }, t(m === 'turns' ? 'stats.byTurns' : 'stats.byEffort')))) : null,
      h('button', { class: 'btn soft sm', type: 'button', id: 'stats-share', onclick: () => openShare(ctx, st, view, showRank) }, icon('share'), t('stats.share'))));
  const card = h('div', { class: 'card rank-card' }, head);
  if (mode === 'effort') card.append(h('p', { class: 'small muted' }, t('stats.effortHint', { f: st.effort.floor, b: st.effort.bathroom, k: st.effort.kitchen })));
  if (people.length >= 3 && max > 0) card.append(podium(ctx, people.slice(0, 3), unit));
  const list = h('ol', { class: 'rank-list' });
  for (const p of people) {
    const pct = max > 0 ? Math.max(p.score > 0 ? 4 : 0, Math.round((100 * p.score) / max)) : 0;
    const dots = CHORES.map((c, i) => h('span', { class: 'rk-chore' }, h('i', { class: 'dot ' + c }), h('span', { class: 'sr' }, choreName(c) + ' '), p.cleaned[i]));
    const main = h('div', { class: 'rk-main' },
      h('div', { class: 'rk-top' }, avatar(p.name, ctx.color(p.id), 'sm'), h('span', { class: 'rk-name' }, p.name), p.id === ctx.me ? h('span', { class: 'chip acc' }, t('misc.you')) : null,
        p.tr ? h('span', { class: 'chip warn', title: t('stats.tr'), 'aria-label': t('stats.aria.rowTr') }, icon('crown'), 'TR') : null,
        p.cdm ? h('span', { class: 'chip bad', title: t('stats.cdm'), 'aria-label': t('stats.aria.rowCdm') }, icon('poo'), 'CDM') : null),
      h('div', { class: 'bar rk-bar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%', background: ctx.color(p.id) } })),
      h('div', { class: 'rk-sub small muted' }, dots));
    const rowAttrs = { class: 'rank rank-row', 'data-person': p.id, 'aria-label': t('stats.aria.row', { pos: p.pos, name: p.name, score: p.score, unit }) };
    const inner = [h('div', { class: 'pos' }, p.pos), main, h('div', { class: 'rk-score' }, h('span', { class: 'big-num rk-num' }, p.score), h('span', { class: 'small muted' }, unit))];
    const li = h('li', null, showStats
      ? h('button', { ...rowAttrs, type: 'button', onclick: () => openPerson(ctx, st, p, view) }, inner)
      : h('div', rowAttrs, inner));
    list.append(li);
  }
  card.append(list);
  const foot = h('div', { class: 'rank-foot small muted' });
  if (showRank) foot.append(h('div', { class: 'legend-line' }, h('span', { class: 'chip warn' }, icon('crown'), 'TR'), h('span', { class: 'chip bad' }, icon('poo'), 'CDM'), h('span', null, t('stats.trHint'))));
  if (showStats) foot.append(h('div', null, t('stats.tapHint')));
  if (foot.childNodes.length) card.append(foot);
  return card;
}

function podium(ctx, top, unit) {
  const order = [top[1], top[0], top[2]];
  const cls = ['p2', 'p1', 'p3'];
  return h('div', { class: 'podium', role: 'group', 'aria-label': t('stats.podium') },
    order.map((p, i) => h('div', { class: 'pod ' + cls[i] },
      h('div', { class: 'pod-who' }, p.pos === 1 ? h('span', { class: 'pod-crown' }, icon('crown')) : null, avatar(p.name, ctx.color(p.id), 'lg'), h('div', { class: 'pod-name' }, p.name), h('div', { class: 'pod-score' }, h('b', null, p.score), ' ', unit)),
      h('div', { class: 'pod-step', 'aria-label': t('stats.position', { n: p.pos }) }, p.pos))));
}

async function openShare(ctx, st, view, showRank) {
  const stats = { ...st, people: view.people.map((p) => ({ ...p, tr: showRank && p.tr, cdm: showRank && p.cdm })) };
  const text = rankingText(ctx.house, ctx.calc.out, stats, ctx.lang);
  const sh = ctx.sheet({ title: t('stats.share'), body: h('div', { class: 'stack' },
    h('div', { class: 'lbl' }, t('stats.shareText')), h('pre', { class: 'share-pre', id: 'share-text' }, text),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn soft', type: 'button', id: 'share-copy', onclick: async () => { const ok = await copyText(text); ctx.toast(ok ? t('stats.shareCopied') : t('error')); } }, icon('copy'), t('wa.copy')),
      ctx.feature('whatsapp') ? h('a', { class: 'btn', id: 'share-wa', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(text) }, icon('whatsapp'), t('wa.send')) : null)) });
  return sh;
}

// ---------------------------------------------------------------- KPI
function kpiSection(ctx, st) {
  const mk = st.people.reduce((a, p) => a + p.makeups.reduce((x, n) => x + Math.max(0, n), 0), 0);
  const rests = st.people.reduce((a, p) => a + Math.max(0, p.rests), 0);
  const bal = st.balance;
  const tone = bal >= 80 ? 'ok' : bal >= 60 ? 'warn' : 'bad';
  const kpi = (id, label, value, extra) => h('div', { class: 'kpi', 'data-kpi': id }, h('div', { class: 'v' }, value), h('div', { class: 'k' }, label), extra);
  return h('section', { class: 'stats-sec', 'aria-labelledby': 'kpi-h' },
    h('h2', { class: 'eyebrow', id: 'kpi-h' }, t('stats.kpis')),
    h('div', { class: 'kpis' },
      kpi('completion', t('stats.completion'), st.completion === null ? '–' : st.completion + '%'),
      kpi('weeks', t('stats.closedWeeks'), st.closedWeeks),
      kpi('makeups', t('stats.makeups'), mk),
      kpi('rests', t('stats.openRests'), rests),
      h('div', { class: 'kpi wide', 'data-kpi': 'balance' },
        h('div', { class: 'kpi-row' }, h('div', { class: 'v' }, bal, h('span', { class: 'v-unit' }, '/100')), h('span', { class: 'chip ' + tone }, t('stats.balance'))),
        h('div', { class: 'meter ' + tone, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(bal), 'aria-label': t('stats.balance') + ': ' + t('stats.balanceOf', { n: bal }) }, h('i', { style: { width: bal + '%' } })),
        h('div', { class: 'k' }, t('stats.balanceHint')))));
}

// ---------------------------------------------------------------- grafici
function dataTable(headers, rows) {
  return h('details', { class: 'chart-data' }, h('summary', null, t('stats.table')),
    h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null, c))))))));
}
const legendItem = (cls, label) => h('span', { class: 'lgd' }, h('i', { class: 'sw ' + cls }), label);

function chartsSection(ctx, st, view, out) {
  return h('section', { class: 'stats-sec', 'aria-labelledby': 'charts-h' },
    h('h2', { class: 'eyebrow', id: 'charts-h' }, t('stats.charts')),
    h('div', { class: 'stack' }, choreChart(ctx, view), monthlyChart(st), sparkChart(ctx, st, view, out)));
}

function choreChart(ctx, view) {
  const people = view.people;
  const W = 360, rowH = 34, labelW = 78, valW = 34, thick = 16, gap = 2;
  const barW = W - labelW - valW;
  const maxT = Math.max(1, ...people.map((p) => p.cleanedTotal));
  const scale = barW / maxT;
  const H = people.length * rowH + 4;
  const desc = people.map((p) => `${p.name}: ${CHORES.map((c, i) => `${choreName(c)} ${p.cleaned[i]}`).join(', ')}`).join('. ');
  const svg = S('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('stats.aria.byChore', { list: desc }), 'data-chart': 'chore' });
  people.forEach((p, r) => {
    const y = r * rowH + (rowH - thick) / 2 + 2;
    svg.append(S('text', { x: 0, y: y + thick / 2, dy: '.35em', class: 'ax-name' }, clip(p.name, 11)));
    const segs = CHORES.map((c, i) => ({ c, v: p.cleaned[i] })).filter((s) => s.v > 0);
    let x = labelW;
    segs.forEach((s, k) => {
      const full = s.v * scale; const last = k === segs.length - 1;
      const w = last ? full : Math.max(1, full - gap);
      const rad = last ? Math.min(4, w / 2) : 0;
      svg.append(S('path', { d: rr(x, y, w, thick, [0, rad, rad, 0]), class: 'seg-' + s.c }, S('title', null, t('stats.chartChore', { name: p.name, chore: choreName(s.c), n: s.v }))));
      if (w >= 20) svg.append(S('text', { x: x + w / 2, y: y + thick / 2, dy: '.35em', class: 'seg-txt', 'text-anchor': 'middle' }, s.v));
      x += full;
    });
    svg.append(S('text', { x: Math.max(x, labelW) + 6, y: y + thick / 2, dy: '.35em', class: 'val-txt' }, p.cleanedTotal));
  });
  const table = dataTable([t('stats.person'), ...CHORES.map(choreName), t('stats.col.total')], people.map((p) => [p.name, ...p.cleaned, p.cleanedTotal]));
  return h('div', { class: 'card chart-card', 'data-card': 'chore' }, h('h3', { class: 'chart-title' }, t('stats.byChore')),
    h('div', { class: 'legend' }, CHORES.map((c) => legendItem('seg-' + c, choreName(c)))), svg, table);
}

function monthlyChart(st) {
  const months = st.monthly;
  const W = 360, H = 180, L = 30, R = 6, T = 18, B = 24;
  const pw = W - L - R, ph = H - T - B;
  const totals = months.map((m) => m.done + m.skipped);
  const { top, step } = niceScale(Math.max(0, ...totals));
  const y = (v) => T + ph - (v / top) * ph;
  const slot = pw / Math.max(1, months.length);
  const bw = Math.min(24, slot * 0.62);
  const desc = months.map((m) => t('stats.chartMonth', { month: monthLabel(m.month), done: m.done, skipped: m.skipped })).join('. ');
  const svg = S('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('stats.aria.monthly', { list: desc }), 'data-chart': 'monthly' });
  for (let v = 0; v <= top + 0.001; v += step) {
    svg.append(S('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }), S('text', { x: L - 6, y: y(v), dy: '.35em', 'text-anchor': 'end', class: 'ax-tick' }, Math.round(v)));
  }
  const maxIdx = totals.indexOf(Math.max(...totals));
  months.forEach((m, i) => {
    const cx = L + slot * i + slot / 2; const x = cx - bw / 2;
    const doneH = (m.done / top) * ph, skH = (m.skipped / top) * ph;
    const g = S('g', { 'data-month': m.month }, S('title', null, t('stats.chartMonth', { month: monthLabel(m.month), done: m.done, skipped: m.skipped })));
    const yDone = T + ph - doneH;
    if (m.done > 0) g.append(S('path', { d: rr(x, yDone, bw, doneH, m.skipped ? [0, 0, 0, 0] : [4, 4, 0, 0]), class: 'seg-done' }));
    if (m.skipped > 0) { const hh = Math.max(3, skH - (m.done ? 2 : 0)); g.append(S('path', { d: rr(x, yDone - (m.done ? 2 : 0) - hh, bw, hh, [4, 4, 0, 0]), class: 'seg-skip' })); }
    if (n(i, months.length, maxIdx) && totals[i] > 0) g.append(S('text', { x: cx, y: y(totals[i]) - 5, 'text-anchor': 'middle', class: 'val-txt sm' }, totals[i]));
    g.append(S('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'ax-tick' }, t('mon.' + (Number(m.month.slice(5)) - 1))));
    svg.append(g);
  });
  const table = dataTable([t('stats.col.month'), t('stats.legend.done'), t('stats.skipped')], months.map((m) => [monthLabel(m.month), m.done, m.skipped]));
  return h('div', { class: 'card chart-card', 'data-card': 'monthly' }, h('h3', { class: 'chart-title' }, t('stats.monthly')),
    h('div', { class: 'legend' }, legendItem('seg-done', t('stats.legend.done')), legendItem('seg-skip', t('stats.skipped'))), svg, table);
}
/** Etichetta il totale solo sull'ultimo mese e sul massimo (o su tutti se sono pochi). */
function n(i, len, maxIdx) { return len <= 6 || i === len - 1 || i === maxIdx; }

function sparkChart(ctx, st, view, out) {
  const ids = view.people.map((p) => p.id);
  const { rows, series } = weeklySeries(out, st, ids);
  const W = 200, H = 40, padX = 8, base = 34, top = 6;
  const maxV = Math.max(2, ...ids.flatMap((id) => series[id].map((s) => s.v || 0)));
  const x = (i) => (rows.length <= 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (rows.length - 1));
  const y = (v) => base - (v / maxV) * (base - top);
  const list = h('ul', { class: 'spark-list' });
  for (const p of view.people) {
    const s = series[p.id];
    const col = ctx.color(p.id);
    const total = s.reduce((a, q) => a + (q.v || 0), 0);
    const summary = total === 1 ? t('stats.sparkSummary1') : t('stats.sparkSummary', { n: total });
    const desc = s.map((q) => (q.away ? t('stats.away') : q.v) + (q.skip ? ' (' + t('stats.skipDot') + ')' : '')).join(', ');
    const svg = S('svg', { class: 'chart spark', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('stats.aria.spark', { name: p.name, list: desc }), 'data-spark': p.id });
    svg.append(S('line', { x1: padX, x2: W - padX, y1: base, y2: base, class: 'grid' }));
    let d = ''; let pen = false;
    s.forEach((q, i) => { if (q.v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${num(x(i))} ${num(y(q.v))}`; pen = true; });
    if (d) svg.append(S('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    s.forEach((q, i) => { if (q.skip && q.v !== null) svg.append(S('circle', { cx: x(i), cy: y(q.v), r: 4, class: 'dot-skip' }, S('title', null, `${fmtWeek(q.sunday)} · ${t('stats.skipDot')}`))); });
    const lastI = s.map((q) => q.v !== null).lastIndexOf(true);
    if (lastI >= 0) svg.append(S('circle', { cx: x(lastI), cy: y(s[lastI].v), r: 4, fill: col, class: 'dot-end' }, S('title', null, `${fmtWeek(s[lastI].sunday)} · ${s[lastI].v}`)));
    list.append(h('li', { class: 'spark-row' }, avatar(p.name, col, 'sm'), h('span', { class: 'sp-name' }, p.name), svg, h('span', { class: 'sp-sum small muted' }, rows.length ? summary : t('stats.sparkNone'))));
  }
  return h('div', { class: 'card chart-card', 'data-card': 'spark' }, h('h3', { class: 'chart-title' }, t('stats.timeline')),
    h('div', { class: 'legend' }, h('span', { class: 'lgd' }, h('i', { class: 'sw dot-skip-sw' }), t('stats.skipDot'))), list,
    h('p', { class: 'small muted' }, t('stats.sparkHint', { n: rows.length })));
}
const fmtWeek = (s) => fmtWeekRange(s);

// ---------------------------------------------------------------- dettaglio persona
function openPerson(ctx, st, p) {
  const tile = (id, label, value, sub) => h('div', { class: 'kpi', 'data-d': id }, h('div', { class: 'v' }, value), h('div', { class: 'k' }, label), sub ? h('div', { class: 'small muted' }, sub) : null);
  const pct = (v) => (v === null || v === undefined ? '–' : v + '%');
  const head = h('div', { class: 'pd-head' }, avatar(p.name, ctx.color(p.id), 'lg'),
    h('div', { class: 'grow' }, h('div', { class: 'pd-name' }, p.name), h('div', { class: 'pd-chips' },
      p.tr ? h('span', { class: 'chip warn' }, icon('crown'), 'TR') : null, p.cdm ? h('span', { class: 'chip bad' }, icon('poo'), 'CDM') : null,
      h('span', { class: 'chip' }, t('stats.position', { n: p.pos })))));
  const grid = h('div', { class: 'kpis pd-kpis' },
    tile('rate', t('stats.rate'), pct(p.rate), p.ownAssigned ? t('stats.ownOf', { a: p.ownDone, b: p.ownAssigned }) : null),
    tile('ontime', t('stats.onTime'), pct(p.onTimeRate)),
    tile('presence', t('stats.presence'), pct(p.presence), p.weeksActive ? t('stats.weeksHome', { a: p.weeksHome, b: p.weeksActive }) : null),
    tile('covers', t('stats.covers'), p.covers), tile('covered', t('stats.covered'), p.covered), tile('rests', t('stats.openRests'), Math.max(0, p.rests)),
    tile('streak', t('stats.streak'), p.streak), tile('best', t('stats.bestStreak'), p.bestStreak), tile('skipped', t('stats.skipped'), p.skipped));
  const mkList = h('ul', { class: 'pd-chores' }, CHORES.map((c, i) => {
    const open = Math.max(0, p.makeups[i] || 0);
    return h('li', { class: 'pd-chore', 'data-chore': c },
      h('span', { class: 'tile ' + c }, icon(CHORE_ICON[c])),
      h('div', { class: 'grow' }, h('div', { class: 'pd-cn' }, choreName(c)), h('div', { class: 'small muted' }, t('stats.cleanedBy') + ': ' + p.cleaned[i])),
      h('span', { class: 'chip ' + (open ? 'warn' : 'ok') }, open ? t('stats.makeupN', { n: open }) : t('stats.noMakeups')));
  }));
  return ctx.sheet({ title: p.name, body: h('div', { class: 'stack pd' }, head, grid, h('div', { class: 'lbl' }, t('stats.openMakeupsBy')), mkList) });
}
