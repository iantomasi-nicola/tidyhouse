// Schermata "Assenze e viaggi" + sheet "Nuova assenza" (openTripSheet, usata anche dalla Home).
import { h, icon, loadCss, avatar, toggle, empty, haptic, clear } from '../ui.js';
import { t, registerStrings, fmtDate, fmtWeekRange, getLang } from '../i18n.js';
import { dayNum, addDays, weekEnd, awayFromTrips } from '../engine.js';
import { it, en } from '../strings/trips.js';
import { it as itU, en as enU } from '../strings/uxa.js';
import { it as itF, en as enF } from '../strings/flow.js';   // flow.undo
registerStrings(it, en);
registerStrings(itU, enU);
registerStrings(itF, enF);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_HORIZON = 8;      // settimane mostrate per un'assenza senza rientro
const MAX_WEEKS = 400;       // sicurezza sul ciclo (rientri lontanissimi)
const LIST_CAP = 6;          // settimane mostrate nelle card / nell'anteprima

// stato effimero della pagina (sopravvive ai rerender)
let awayPid = null;
let showAllPast = false;

// ---------------------------------------------------------------- logica pura
const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(dayNum(s));
const dowOf = (s) => (dayNum(s) + 4) % 7; // 0 = domenica

/** Notti fuori in lun-dom (unione dei viaggi della persona): stessa regola di awayFromTrips. */
export function nightsInWeek(trips, personId, sunday) {
  const end = dayNum(sunday), start = end - 6; const set = new Set();
  for (const tr of trips) {
    if (tr.personId !== personId || !validDate(tr.from)) continue;
    const a = dayNum(tr.from), b = tr.to ? dayNum(tr.to) : Infinity;
    for (let d = Math.max(a, start); d <= Math.min(b - 1, end); d++) set.add(d);
  }
  return set.size;
}

/**
 * Settimane toccate da un'assenza [from, to) e se la persona risulta assente (awayFromTrips) con tutti i viaggi `trips`.
 * `to` nullo = senza rientro: si guardano le prossime OPEN_HORIZON settimane.
 */
export function tripWeeks(trips, personId, from, to, minNights, today, { futureOnly = false } = {}) {
  if (!validDate(from) || (to && (!validDate(to) || dayNum(to) <= dayNum(from)))) return null;
  const todayWeek = weekEnd(today);
  let first = weekEnd(from), last;
  if (to) last = weekEnd(addDays(to, -1));
  else { if (dayNum(first) < dayNum(todayWeek)) first = todayWeek; last = addDays(first, 7 * (OPEN_HORIZON - 1)); }
  if (futureOnly && dayNum(first) < dayNum(todayWeek)) first = todayWeek;
  const weeks = [];
  for (let s = first, i = 0; dayNum(s) <= dayNum(last) && i < MAX_WEEKS; s = addDays(s, 7), i++) {
    weeks.push({ sunday: s, nights: nightsInWeek(trips, personId, s), away: awayFromTrips(trips, personId, s, minNights) });
  }
  return { weeks, open: !to };
}

const minNightsOf = (ctx) => (ctx.house.settings && ctx.house.settings.minNights) || 3;
const allTrips = (ctx) => ctx.calc.eh.trips || [];
const isLeft = (ctx, pid) => { const p = ctx.person(pid); return !!(p && p.to && p.to < ctx.today()); };
const activePeople = (ctx) => (ctx.house.roommates || []).filter((r) => r.name && (!r.to || r.to >= ctx.today()));
const nightsLabel = (n) => (n === 1 ? t('trips.nights1') : t('trips.nights', { n }));
const fmtD = (ctx, s) => fmtDate(s, getLang(), { year: s.slice(0, 4) !== ctx.today().slice(0, 4) });

function classify(trip, today) {
  if (trip.to && trip.to <= today) return 'past';
  if (trip.from > today) return 'upcoming';
  return 'now';
}

// ---------------------------------------------------------------- pagina
export async function render(ctx) {
  loadCss('css/trips.css');
  const page = h('div', { class: 'trips-page' });
  page.append(h('h1', { class: 'title' }, t('trips.title')));
  if (!ctx.feature('trips')) {
    page.append(h('div', { class: 'card' }, empty('plane', t('trips.disabled'), t('trips.disabledHint'))));
    return page;
  }
  const people = activePeople(ctx);
  if (!people.length) { page.append(h('div', { class: 'card' }, empty('users', t('trips.noPeople'), t('trips.noPeopleHint')))); return page; }

  const today = ctx.today();
  const minN = minNightsOf(ctx);
  page.append(h('div', { class: 'note' }, icon('info'), h('div', null, t('trips.rule', { n: minN }), ' ', h('span', { class: 'muted' }, t('trips.deadlineFri')))));
  page.append(h('div', { class: 'trips-cta' }, h('button', { class: 'btn lg block', type: 'button', onclick: () => openTripSheet(ctx) }, icon('plus'), t('trips.add'))));

  const trips = Object.entries(ctx.state.trips || {}).map(([id, tr]) => ({ id, ...tr })).filter((tr) => validDate(tr.from));
  const groups = { now: [], upcoming: [], past: [] };
  for (const tr of trips) groups[classify(tr, today)].push(tr);
  groups.now.sort((a, b) => a.from.localeCompare(b.from));
  groups.upcoming.sort((a, b) => a.from.localeCompare(b.from));
  groups.past.sort((a, b) => b.from.localeCompare(a.from));

  const left = h('div', { class: 'trips-col' });
  if (!trips.length) left.append(h('div', { class: 'card' }, empty('plane', t('trips.empty'), t('trips.emptyHint'))));
  const section = (key, list, kind) => {
    if (!list.length) return;
    let shown = list;
    if (kind === 'past' && !showAllPast && list.length > 3) shown = list.slice(0, 3);
    const sec = h('section', { class: 'trips-sec', 'aria-labelledby': 'sec-' + kind },
      h('h2', { class: 'eyebrow', id: 'sec-' + kind }, h('span', null, t(key)), h('span', { class: 'chip' }, list.length)),
      h('div', { class: 'stack tight' }, shown.map((tr) => tripCard(ctx, tr, kind))));
    if (kind === 'past' && list.length > 3) sec.append(h('button', { class: 'btn soft sm trips-more', type: 'button', onclick: () => { showAllPast = !showAllPast; ctx.rerender(); } }, showAllPast ? t('trips.showLess') : t('trips.showAllPast', { n: list.length })));
    left.append(sec);
  };
  section('trips.now', groups.now, 'now');
  section('trips.upcoming', groups.upcoming, 'upcoming');
  section('trips.past', groups.past, 'past');

  const right = h('div', { class: 'trips-col' }, weekSection(ctx, people));
  page.append(h('div', { class: 'trips-grid' }, left, right));
  return page;
}

function weekChips(weeks, past) {
  const away = weeks.filter((w) => w.away);
  const title = past ? t('trips.absentWeeksPast') : t('trips.absentWeeks');
  if (!away.length) return h('div', { class: 'trip-weeks' }, h('div', { class: 'small muted' }, t('trips.noWeeksOut')));
  const shown = away.slice(0, LIST_CAP);
  return h('div', { class: 'trip-weeks' }, h('div', { class: 'small muted' }, title),
    h('ul', { class: 'wk-chips', 'aria-label': title }, shown.map((w) => h('li', { class: 'chip' }, fmtWeekRange(w.sunday))), away.length > shown.length ? h('li', { class: 'chip acc' }, '+' + (away.length - shown.length)) : null));
}

function tripCard(ctx, trip, kind) {
  const today = ctx.today();
  const name = ctx.name(trip.personId);
  const left = isLeft(ctx, trip.personId);
  const nights = trip.to ? dayNum(trip.to) - dayNum(trip.from) : null;
  const so = !trip.to && kind === 'now' ? Math.max(0, dayNum(today) - dayNum(trip.from)) : null;
  const imp = tripWeeks(allTrips(ctx), trip.personId, trip.from, trip.to, minNightsOf(ctx), today, { futureOnly: kind !== 'past' });
  const dates = trip.to ? t('trips.fromTo', { a: fmtD(ctx, trip.from), b: fmtD(ctx, trip.to) }) : t('trips.fromOpen', { a: fmtD(ctx, trip.from) });
  const mine = trip.personId === ctx.me;
  const del = ctx.actions.canTrip(trip.personId)
    ? h('button', { class: 'icon-btn trip-del', type: 'button', 'aria-label': t('trips.deleteAria', { name }), onclick: () => removeTrip(ctx, trip) }, icon('trash')) : null;
  return h('article', { class: 'card trip ' + kind, 'data-trip': trip.id },
    h('div', { class: 'trip-head' },
      avatar(name, ctx.color(trip.personId)),
      h('div', { class: 'grow' },
        h('div', { class: 'trip-who' }, h('span', { class: 'trip-name' }, name), mine ? h('span', { class: 'chip acc' }, t('misc.you')) : null, left ? h('span', { class: 'chip' }, t('set.roommates.status.out')) : null),
        h('div', { class: 'trip-dates' }, dates)),
      del),
    h('div', { class: 'trip-meta' },
      kind === 'now' ? h('span', { class: 'chip acc' }, icon('plane'), t('trips.now')) : null,
      !trip.to ? h('span', { class: 'chip warn' }, t('trips.ongoing')) : null,
      nights !== null ? h('span', { class: 'chip' }, icon('moon'), nightsLabel(nights)) : null,
      so !== null && so > 0 ? h('span', { class: 'chip' }, icon('moon'), so === 1 ? t('trips.nightsSoFar1') : t('trips.nightsSoFar', { n: so })) : null),
    trip.note ? h('p', { class: 'trip-note' }, trip.note) : null,
    imp ? weekChips(imp.weeks, kind === 'past') : null);
}

/** Elimina subito (un tocco) con «Annulla» nel messaggio: niente dialogo di conferma per un'azione facilmente rimediabile. */
async function removeTrip(ctx, trip) {
  const copy = { personId: trip.personId, from: trip.from, to: trip.to || null, note: trip.note || null };
  try { await ctx.actions.removeTrip(trip.id); } catch (e) { ctx.toast(t('error')); return; }
  haptic(ctx.prefs.haptics, 10);
  ctx.toast(t('trips.deleted'), 7000, { action: { label: t('flow.undo'), onClick: async () => { try { await ctx.actions.addTrip(copy); ctx.toast(t('uxa.tripRestored')); } catch (e) { ctx.toast(t('error')); } } } });
}

// ---------------------------------------------------------------- assenza per singola settimana
function weekSection(ctx, people) {
  const sec = h('section', { class: 'trips-sec', 'aria-labelledby': 'sec-weeks' }, h('h2', { class: 'eyebrow', id: 'sec-weeks' }, t('trips.manual')));
  const admin = ctx.isAdmin;
  if (!awayPid || !people.some((p) => p.id === awayPid)) awayPid = null;
  const pid = admin ? (awayPid || (people.some((p) => p.id === ctx.me) ? ctx.me : people[0].id)) : ctx.me;
  const card = h('div', { class: 'card pad0' });
  if (!pid || !people.some((p) => p.id === pid)) { card.append(empty('user', t('trips.noPermission'))); sec.append(card); return sec; }
  const head = h('div', { class: 'wk-head' }, h('p', { class: 'small muted' }, t('trips.manualHint')));
  if (admin && people.length > 1) {
    const sel = h('select', { class: 'input', 'aria-label': t('trips.person'), onchange: (e) => { awayPid = e.target.value; ctx.rerender(); } },
      people.map((p) => h('option', { value: p.id, selected: p.id === pid ? true : null }, p.name + (p.id === ctx.me ? ' · ' + t('misc.you') : ''))));
    sel.value = pid;
    head.append(h('div', { class: 'field' }, h('label', null, t('trips.person')), sel));
  }
  card.append(head);
  const { out } = ctx.calc; const trips = allTrips(ctx); const minN = minNightsOf(ctx);
  const canAway = ctx.actions.canAway(pid);
  const list = h('ul', { class: 'wk-list' });
  const start = Math.max(out.cur, 0);
  for (let i = start; i < Math.min(out.rows.length, start + 8); i++) {
    const row = out.rows[i];
    const idx = row.nm.indexOf(pid);
    const inHouse = idx >= 0;
    const byTrip = inHouse && awayFromTrips(trips, pid, row.sunday, minN);
    const manual = ((ctx.weeks[row.sunday] || {}).away || []).includes(pid);
    const range = fmtWeekRange(row.sunday);
    const li = h('li', { class: 'wk-row' + (row.isCur ? ' cur' : ''), 'data-week': row.sunday },
      h('div', { class: 'grow' },
        h('div', { class: 'wk-range' }, range),
        h('div', { class: 'wk-sub' }, row.isCur ? h('span', { class: 'chip acc' }, t('trips.thisWeek')) : null, byTrip ? h('span', { class: 'chip warn' }, icon('plane'), t('trips.byTrip')) : null, !inHouse ? h('span', { class: 'chip' }, t('trips.notInHouse')) : null)));
    if (inHouse) {
      const label = (pid === ctx.me ? t('trips.imAway') : t('trips.isAway')) + ' · ' + range;
      const sw = toggle(manual || byTrip, async (on) => {
        haptic(ctx.prefs.haptics, 8);
        try { await ctx.actions.setAway(row.sunday, pid, on); }
        catch (e) { ctx.toast(t('error')); ctx.rerender(); }
      }, label);
      const inp = sw.querySelector('input');
      if (byTrip || !canAway) inp.disabled = true;
      li.append(h('div', { class: 'wk-sw' }, h('span', { class: 'wk-lbl' }, pid === ctx.me ? t('trips.imAway') : t('trips.isAway')), sw));
    }
    list.append(li);
  }
  card.append(list);
  if (!canAway) card.append(h('p', { class: 'small muted wk-foot' }, t('trips.selfAwayOff')));
  sec.append(card);
  return sec;
}

// ---------------------------------------------------------------- sheet "Nuova assenza"
export function openTripSheet(ctx, personId) {
  if (!ctx.feature('trips')) { ctx.sheet({ title: t('trips.add'), body: empty('plane', t('trips.disabled'), t('trips.disabledHint')) }); return null; }
  loadCss('css/trips.css');
  const today = ctx.today();
  const people = activePeople(ctx);
  const admin = ctx.isAdmin;
  let pid = personId && people.some((p) => p.id === personId) ? personId : (people.some((p) => p.id === ctx.me) ? ctx.me : (people[0] || {}).id);
  if (!admin) pid = ctx.me;
  if (!pid || !ctx.actions.canTrip(pid)) { ctx.sheet({ title: t('trips.add'), body: empty('user', t('trips.noPermission')) }); return null; }
  const st = { pid, from: today, to: '', open: false, note: '' };
  const minN = minNightsOf(ctx);

  // ---- campi
  const fromInp = h('input', { class: 'input', type: 'date', id: 'trip-from', value: st.from, 'aria-label': t('trips.leave') });
  const toInp = h('input', { class: 'input', type: 'date', id: 'trip-to', value: st.to, 'aria-label': t('trips.return') });
  const noteInp = h('input', { class: 'input', type: 'text', id: 'trip-note', maxlength: '80', placeholder: t('trips.note'), autocomplete: 'off', enterkeyhint: 'done', 'aria-label': t('trips.note') });
  const toField = h('div', { class: 'field' }, h('label', { for: 'trip-to' }, t('trips.return')), toInp);
  const openSw = toggle(false, (on) => { st.open = on; toField.hidden = on; refresh(); }, t('trips.openEnded'));
  const openInp = openSw.querySelector('input');
  const who = admin && people.length > 1
    ? h('div', { class: 'field' }, h('label', { for: 'trip-who' }, t('trips.person')),
      h('select', { class: 'input', id: 'trip-who', onchange: (e) => { st.pid = e.target.value; refresh(); } }, people.map((p) => h('option', { value: p.id }, p.name + (p.id === ctx.me ? ' · ' + t('misc.you') : '')))))
    : h('div', { class: 'trip-who-static' }, avatar(ctx.name(pid), ctx.color(pid)), h('div', { class: 'trip-name' }, ctx.name(pid)));
  if (admin && people.length > 1) who.querySelector('select').value = pid;

  const setFrom = (v) => { st.from = v; fromInp.value = v; };
  const setTo = (v) => { st.to = v; toInp.value = v; };
  const setOpen = (v) => { st.open = v; openInp.checked = v; toField.hidden = v; };
  const setNote = (v) => { if (!noteInp.value) { noteInp.value = v; st.note = v; } };
  const nextFriday = () => addDays(today, (5 - dowOf(today) + 7) % 7);
  const quick = (key, fn) => h('button', { class: 'q-chip', type: 'button', 'data-q': key, onclick: () => { fn(); refresh(); } }, t('trips.q.' + key));
  const chips = h('div', { class: 'q-chips', role: 'group', 'aria-label': t('trips.quick') },
    quick('weekend', () => { const f = nextFriday(); setFrom(f); setTo(addDays(f, 3)); setOpen(false); setNote(t('trips.q.weekend')); }),
    quick('week', () => { const f = validDate(st.from) ? st.from : today; setFrom(f); setTo(addDays(f, 7)); setOpen(false); }),
    quick('open', () => { if (!validDate(st.from)) setFrom(today); setOpen(true); }));

  const preview = h('div', { class: 'trip-preview', 'aria-live': 'polite' });
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: () => save() }, icon('check'), t('save'));

  fromInp.addEventListener('input', () => { st.from = fromInp.value; refresh(); });
  fromInp.addEventListener('change', () => { st.from = fromInp.value; refresh(); });
  toInp.addEventListener('input', () => { st.to = toInp.value; refresh(); });
  toInp.addEventListener('change', () => { st.to = toInp.value; refresh(); });
  noteInp.addEventListener('input', () => { st.note = noteInp.value; });

  function state() {
    const fromOk = validDate(st.from);
    const toOk = st.open || validDate(st.to);
    const order = !fromOk || st.open || !validDate(st.to) || dayNum(st.to) > dayNum(st.from);
    return { fromOk, toOk, order, valid: fromOk && toOk && order && !!st.pid };
  }

  function refresh() {
    const s = state();
    clear(preview);
    const to = st.open ? null : st.to;
    if (!s.fromOk || !s.toOk) {
      preview.append(h('p', { class: 'small muted' }, t('trips.pickDates')));
    } else if (!s.order) {
      preview.append(h('div', { class: 'note bad', role: 'alert', id: 'trip-invalid' }, icon('alert'), t('trips.invalid')));
    } else {
      const nights = to ? dayNum(to) - dayNum(st.from) : null;
      const hypo = [...allTrips(ctx), { personId: st.pid, from: st.from, to }];
      const imp = tripWeeks(hypo, st.pid, st.from, to, minN, today);
      const away = imp.weeks.filter((w) => w.away);
      preview.append(h('div', { class: 'pv-head' },
        nights !== null ? h('div', { class: 'pv-nights' }, h('span', { class: 'big-num', id: 'pv-nights' }, nights), h('span', { class: 'muted' }, nights === 1 ? t('trips.nightsUnit1') : t('trips.nightsUnit'))) : h('div', { class: 'chip warn' }, t('trips.ongoing')),
        h('div', { class: 'pv-count', id: 'pv-count' }, away.length === 1 ? t('trips.weeksOut1') : t('trips.weeksOut', { n: away.length }))));
      const list = h('ul', { class: 'pv-weeks', id: 'pv-weeks' });
      for (const w of imp.weeks.slice(0, LIST_CAP + 2)) {
        list.append(h('li', { class: 'pv-week ' + (w.away ? 'away' : 'on'), 'data-away': w.away ? '1' : '0', 'data-week': w.sunday },
          h('span', { class: 'pv-range' }, fmtWeekRange(w.sunday)),
          h('span', { class: 'pv-n' }, t('trips.nightsOf', { n: w.nights })),
          h('span', { class: 'chip ' + (w.away ? 'warn' : 'ok') }, w.away ? t('trips.weekAway') : t('trips.weekOn'))));
      }
      preview.append(list);
      if (imp.weeks.length > LIST_CAP + 2) preview.append(h('p', { class: 'small muted' }, t('trips.moreWeeks', { n: imp.weeks.length - (LIST_CAP + 2) })));
      if (!away.length) preview.append(h('div', { class: 'note ok' }, icon('check'), t('trips.noEffect', { n: minN })));
      if (imp.open) preview.append(h('p', { class: 'small muted' }, t('trips.openPreview', { n: OPEN_HORIZON })));
      if (st.from < today) preview.append(h('div', { class: 'note warn', id: 'trip-pastwarn' }, icon('alert'), t('trips.pastWarn')));
      if (to && dayNum(to) - dayNum(today) > 365) preview.append(h('div', { class: 'note warn', id: 'trip-longwarn' }, icon('alert'), t('trips.longWarn')));
    }
    saveBtn.disabled = !s.valid;
    toInp.setAttribute('aria-invalid', s.order ? 'false' : 'true');
    if (!s.order) toInp.setAttribute('aria-describedby', 'trip-invalid'); else toInp.removeAttribute('aria-describedby');
  }

  let busy = false;
  async function save() {
    const s = state(); if (!s.valid || busy) return;
    busy = true;
    try {
      await ctx.actions.addTrip({ personId: st.pid, from: st.from, to: st.open ? null : st.to, note: st.note.trim() || null });
      ctx.toast(t('saved')); haptic(ctx.prefs.haptics, 10);
      sh.close();
    } catch (e) { busy = false; ctx.toast(t('error')); }
  }

  const body = h('form', { class: 'stack trip-form', onsubmit: (e) => { e.preventDefault(); save(); } },
    who,
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, t('trips.quick')), chips, h('p', { class: 'small muted' }, t('trips.q.hint'))),
    h('div', { class: 'trip-dates-grid' }, h('div', { class: 'field' }, h('label', { for: 'trip-from' }, t('trips.leave')), fromInp), toField),
    h('div', { class: 'row-between trip-open' }, h('label', { class: 'trip-open-lbl' }, t('trips.openEnded')), openSw),
    h('div', { class: 'field' }, h('label', { for: 'trip-note' }, t('trips.noteLabel') + ' · ' + t('optional')), noteInp),
    h('div', { class: 'card flat trip-pv-card' }, h('div', { class: 'eyebrow' }, t('trips.preview')), preview),
    h('p', { class: 'small muted' }, t('trips.rule', { n: minN })),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn soft', type: 'button', onclick: () => sh.close() }, t('cancel')), saveBtn));
  const sh = ctx.sheet({ title: t('trips.add'), body });
  refresh();
  return sh;
}
