// Schermata "Settimane": corrente e prossime in alto per esteso; le settimane passate raggruppate per MESE in sezioni
// richiudibili (chiuse di default) con riepilogo di una riga; «Mostra altre» per il futuro lontano; pulsante «Oggi».
// Su desktop (>=1180px) affianca alla lista il dettaglio della settimana selezionata.
// Deep link: #/calendar?week=YYYY-MM-DD (qualsiasi giorno della settimana) apre il mese giusto, scorre fin lì e apre la scheda.
import { h, icon, avatar, loadCss, cssReady } from '../ui.js';
import { fmtWeekRange, fmtDate, dowLong, registerStrings } from '../i18n.js';
import { CHORES } from '../engine.js';
import { planOf } from '../extras.js';
import { openWeekSheet, renderWeekDetail, weekStatus, outcomeOf, flowChips } from '../choresheet.js';
import { it as itV, en as enV } from '../strings/calview.js';
registerStrings(itV, enV);
loadCss('css/calendar-screen.css');

const WIDE = '(min-width: 1180px)';
const FUT_FULL = 4;        // prossime settimane mostrate per esteso (dopo la corrente); su desktop 0: righe compatte, ne stanno di più
const FUT_WIDE = 8;        // su desktop le prossime settimane compaiono subito come righe compatte
const FUT_STEP = 8;        // «Mostra altre N settimane»
const MONTHS_STEP = 6;     // mesi passati mostrati per volta
const MEM_KEY = 'cp:calview';

// stato del modulo (la schermata viene ricostruita a ogni cambio dati)
let openMonths = loadOpen();   // mesi aperti 'YYYY-MM' (ricordati anche in sessionStorage)
let futExtra = 0;              // quante settimane future in più (dopo le prime) sono mostrate
let monthsShown = MONTHS_STEP; // quanti mesi passati sono elencati
let selected = null;           // settimana selezionata nel pannello desktop
let needShow = null;           // settimana da portare in vista dopo un rifacimento (frecce del pannello)
let selectFn = null;           // selezione sul posto (senza rifare la pagina) dell'ultimo render
let panelY = 0, panelFor = null;   // scroll interno del pannello desktop (si ripristina se si ridisegna la stessa settimana)
let prevNode = null;           // nodo dell'ultimo render: se era montato e non lo è più siamo a una nuova visita
let prevMounted = false;       // il nodo dell'ultimo render è arrivato nel DOM (un render scartato dall'app non conta come visita)
let visit = null;              // visita in corso finché il suo nodo non è montato: {back}
let lastY = 0;                 // ultimo scroll visto sul calendario (per il ritorno con «indietro»)
let popAt = -1e9;              // quando è partito l'ultimo popstate (tasto indietro)
let mq = null, io = null;

function loadOpen() { try { const v = JSON.parse(sessionStorage.getItem(MEM_KEY) || '[]'); return new Set(Array.isArray(v) ? v.filter((k) => /^\d{4}-\d{2}$/.test(k)) : []); } catch { return new Set(); } }
function saveOpen() { try { sessionStorage.setItem(MEM_KEY, JSON.stringify([...openMonths])); } catch { /* ignore */ } }

window.addEventListener('popstate', () => { popAt = performance.now(); });
window.addEventListener('scroll', () => { if (prevNode && prevNode.isConnected && /^#\/calendar/.test(location.hash)) lastY = window.scrollY; }, { passive: true });

const dowIdx = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
function addDaysIso(s, k) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); }
/** Mese di una settimana (lun–dom che termina a `sunday`): quello del giovedì, cioè dove cadono più giorni. */
const monthOf = (sunday) => addDaysIso(sunday, -3).slice(0, 7);
function monthLabel(key, lang) {
  let s; try { s = new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'it', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(key + '-15T00:00:00Z')); } catch { s = key; }
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** Giorno scelto dal link `#/calendar?week=...`; se è un giorno qualsiasi, la settimana che lo contiene. */
function deepLinkWeek(rows) {
  const m = /[?&]week=(\d{4}-\d{2}-\d{2})/.exec(location.hash); if (!m) return null;
  const d = m[1];
  const r = rows.find((x) => x.sunday >= d && addDaysIso(x.sunday, -6) <= d);
  return r ? r.sunday : null;
}
const clearDeepLink = () => { try { if (/[?&]week=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search + '#/calendar'); } catch { /* ignore */ } };

/** Riepilogo di un mese (solo settimane passate): turni saltati, turni ancora da registrare, oppure tutto fatto. */
export function summarize(rows) {
  let skipped = 0, tolog = 0, played = 0;
  for (const r of rows) {
    if (r.status === 'empty' || r.status === 'none') continue;
    played++; skipped += r.nSk || 0; tolog += r.nPend || 0;
  }
  return { skipped, tolog, played, ok: played > 0 && !skipped && !tolog };
}

const openOrSelect = (ctx, sunday) => {
  ctx.haptic(ctx.prefs.haptics, 6);
  if (window.matchMedia(WIDE).matches) { if (selectFn) selectFn(sunday); else { selected = sunday; ctx.rerender(); } } else openWeekSheet(ctx, sunday);
};

/** Scheda completa (corrente e prossime). */
function weekCard(ctx, row, { wide, selectedSunday }) {
  const stat = weekStatus(ctx, row);
  const wkDoc = (ctx.state.weeks || {})[row.sunday] || {};
  const range = fmtWeekRange(row.sunday, ctx.lang);
  const isSel = wide && selected === row.sunday;
  const house = { ...ctx.house, weeks: ctx.state.weeks || {} };
  const empty = row.status === 'empty' || row.status === 'none';

  const flows = [];
  const chores = CHORES.map((chore, c) => {
    const id = row.assigned[c];
    const oc = outcomeOf(ctx, row, c);
    const plan = planOf(house, row.sunday, chore);
    const inds = [];
    if (oc) inds.push(h('span', { class: 'ind ' + oc.tone, title: oc.label }, icon(oc.ic)));
    if (id && row.isMakeup[c]) inds.push(h('span', { class: 'ind acc', title: ctx.t('st.makeup') }, icon('refresh')));
    if (id && row.swapped[c]) inds.push(h('span', { class: 'ind acc', title: ctx.t('st.swapped') }, icon('swap')));
    if (id && plan) inds.push(h('span', { class: 'ind plan', title: ctx.t('cal.chosenDay', { day: `${dowLong(plan, ctx.lang)} ${fmtDate(plan, ctx.lang)}` }) }, ctx.t('dow.' + dowIdx(plan))));
    const fl = id ? flowChips(ctx, row.sunday, chore) : [];
    for (const f of fl) inds.push(h('span', { class: 'ind ' + f.tone, title: f.text, 'aria-label': f.text, 'data-flow': f.key }, icon(f.ic)));
    flows.push(...fl.filter((f) => f.key === 'incomplete').map((f) => ctx.t('chore.' + chore)));
    return h('span', { class: 'wk-chore', 'data-chore': chore },
      h('span', { class: 'l' }, h('i', { class: 'dot ' + chore }), ctx.t('chore.' + chore + '.short')),
      h('span', { class: 'm' }, id ? avatar(ctx.name(id), ctx.color(id), 'sm') : h('span', { class: 'av sm cs-none' }, '–'), h('span', { class: 'inds' }, inds)),
      h('span', { class: 'n' + (id ? '' : ' none') }, id ? ctx.name(id) : (empty ? '' : ctx.t('chore.noOne'))));
  });

  const foot = [];
  if (row.rest.length) foot.push(h('span', { class: 'wk-meta' }, icon('moon'), ctx.t('cal.restNames', { names: row.rest.map((id) => ctx.name(id)).join(', ') })));
  if (row.away.length && !empty) foot.push(h('span', { class: 'wk-meta' }, icon('plane'), ctx.t('cal.awayNames', { names: row.away.map((id) => ctx.name(id)).join(', ') })));
  if (flows.length) foot.push(h('span', { class: 'wk-meta fl-incmeta', 'data-flow': 'incomplete' }, icon('alert'), ctx.t('flow.incompleteIn', { chores: flows.join(', ') })));
  if (empty) foot.push(h('span', { class: 'wk-meta' }, icon('home2'), ctx.t('cal.emptyHouse')));

  return h('button', {
    type: 'button', class: 'week' + (row.isCur ? ' cur' : '') + (row.closed ? ' past' : '') + (row.isFut ? ' fut' : '') + (isSel ? ' sel' : '') + (empty ? ' empty' : ''),
    'data-sunday': row.sunday, 'aria-label': `${range}, ${stat.label}`, 'aria-current': row.isCur ? 'date' : null, 'aria-pressed': wide ? String(isSel) : null,
    onclick: () => openOrSelect(ctx, row.sunday),
  },
  h('span', { class: 'wk-head' },
    h('span', { class: 'grow' }, h('span', { class: 'wk-title' }, range), h('span', { class: 'wk-sub' }, row.isCur ? ctx.t('cal.current') + ' · ' : '', ctx.t('cal.week', { n: row.P }))),
    wkDoc.note ? h('span', { class: 'ind note', title: ctx.t('cal.hasNote') }, icon('edit')) : null,
    h('span', { class: 'chip ' + stat.tone }, stat.label)),
  h('span', { class: 'wk-chores' }, chores),
  foot.length ? h('span', { class: 'wk-foot' }, foot) : null);
}

/** Riga compatta (settimane passate nei gruppi per mese, futuro lontano): intervallo, stato e i tre turni su una riga. */
function weekRow(ctx, row, { wide, selectedSunday }) {
  const stat = weekStatus(ctx, row);
  const wkDoc = (ctx.state.weeks || {})[row.sunday] || {};
  const range = fmtWeekRange(row.sunday, ctx.lang);
  const empty = row.status === 'empty' || row.status === 'none';
  const incomplete = [];
  const cells = CHORES.map((chore, c) => {
    const id = row.assigned[c];
    const oc = outcomeOf(ctx, row, c);
    const fl = id ? flowChips(ctx, row.sunday, chore) : [];
    if (fl.some((f) => f.key === 'incomplete')) incomplete.push(ctx.t('chore.' + chore));
    return h('span', { class: 'wk-mc', 'data-chore': chore },
      h('i', { class: 'dot ' + chore }),
      h('span', { class: 'n' + (id ? '' : ' none') }, id ? ctx.name(id) : (empty ? '' : ctx.t('chore.noOne'))),
      oc ? h('span', { class: 'ind ' + oc.tone, title: oc.label }, icon(oc.ic)) : (id && row.isMakeup[c] ? h('span', { class: 'ind acc', title: ctx.t('st.makeup') }, icon('refresh')) : null),
      id && row.swapped[c] ? h('span', { class: 'ind acc', title: ctx.t('st.swapped') }, icon('swap')) : null,
      fl.filter((f) => f.key !== 'incomplete').map((f) => h('span', { class: 'ind ' + f.tone, title: f.text, 'aria-label': f.text, 'data-flow': f.key }, icon(f.ic))));
  });
  const extra = [];
  if (wkDoc.note) extra.push(h('span', { class: 'ind note', title: ctx.t('cal.hasNote') }, icon('edit')));
  if (row.away.length && !empty) extra.push(h('span', { class: 'ind', title: ctx.t('cal.awayNames', { names: row.away.map((id) => ctx.name(id)).join(', ') }) }, icon('plane')));
  if (incomplete.length) extra.push(h('span', { class: 'ind bad', 'data-flow': 'incomplete', title: ctx.t('flow.incompleteIn', { chores: incomplete.join(', ') }) }, icon('alert')));
  return h('button', {
    type: 'button', class: 'week compact' + (row.isFut ? ' fut' : '') + (wide && selected === row.sunday ? ' sel' : '') + (empty ? ' empty' : ''),
    'data-sunday': row.sunday, 'aria-label': `${range}, ${stat.label}`, title: ctx.t('cal.week', { n: row.P }), 'aria-pressed': wide ? String(selected === row.sunday) : null,
    onclick: () => openOrSelect(ctx, row.sunday),
  },
  h('span', { class: 'wk-head' }, h('span', { class: 'grow' }, h('span', { class: 'wk-title' }, range)), extra, h('span', { class: 'chip ' + stat.tone }, stat.label)),
  h('span', { class: 'wk-minis' }, cells));
}

/** Gruppo di un mese passato: intestazione richiudibile (aria-expanded) + corpo creato solo quando è aperto. */
function monthGroup(ctx, key, rowsAsc, ropts) {
  const sum = summarize(rowsAsc);
  const n = rowsAsc.length;
  const parts = [];
  if (sum.skipped) parts.push(h('span', { class: 'cal-sum bad' }, icon('x'), sum.skipped === 1 ? ctx.t('calview.sumSkip1') : ctx.t('calview.sumSkip', { n: sum.skipped })));
  if (sum.tolog) parts.push(h('span', { class: 'cal-sum warn' }, icon('clock'), sum.tolog === 1 ? ctx.t('calview.sumLog1') : ctx.t('calview.sumLog', { n: sum.tolog })));
  if (!parts.length) parts.push(sum.played ? h('span', { class: 'cal-sum ok' }, icon('check'), ctx.t('calview.sumOk')) : h('span', { class: 'cal-sum' }, ctx.t('calview.sumNone')));
  const bodyId = 'cal-mb-' + key;
  const body = h('div', { class: 'cal-mbody', id: bodyId, hidden: true });
  const fill = () => { body.replaceChildren(...[...rowsAsc].reverse().map((r) => weekRow(ctx, r, ropts))); body.hidden = false; };
  const isOpen = openMonths.has(key);
  const btn = h('button', { type: 'button', class: 'cal-mh', id: 'cal-mh-' + key, 'data-act': 'month', 'data-month': key, 'aria-expanded': String(isOpen), 'aria-controls': bodyId,
    onclick: () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      if (open) { openMonths.add(key); fill(); } else { openMonths.delete(key); body.hidden = true; body.replaceChildren(); }
      btn.setAttribute('aria-expanded', String(open)); grp.classList.toggle('open', open);
      saveOpen(); ctx.haptic(ctx.prefs.haptics, 6);
    } },
  icon('chevron', 'cal-chev'),
  h('span', { class: 'grow' }, h('span', { class: 'cal-mt' }, monthLabel(key, ctx.lang)),
    h('span', { class: 'cal-ms' }, n === 1 ? ctx.t('calview.weeks1') : ctx.t('calview.weeks', { n }), parts.map((p) => [h('span', { class: 'cal-sep', 'aria-hidden': 'true' }, '·'), p]))));
  const grp = h('section', { class: 'cal-month list' + (isOpen ? ' open' : ''), 'data-month': key }, h('h3', { class: 'cal-mhw' }, btn), body);
  if (isOpen) fill();
  return grp;
}

export async function render(ctx) {
  await cssReady();   // il foglio di stile del layout desktop deve essere pronto prima del primo disegno (niente spostamenti di layout)
  const { out } = ctx.calc;
  const rows = out.rows;
  const cur = out.cur;
  const wide = window.matchMedia(WIDE).matches;
  if (!mq) { mq = window.matchMedia(WIDE); mq.addEventListener('change', () => { if (document.querySelector('.cal')) ctx.rerender(); }); }

  // nuova visita = prima volta, oppure il nodo precedente era montato e ora non c'è più. Un render scartato dall'app (mai montato) non la azzera.
  if (!prevNode || (prevMounted && !prevNode.isConnected)) {
    visit = { back: performance.now() - popAt < 800 };   // ritorno con «indietro» (o dal menu: anche lì scatta popstate): si mantengono mesi aperti, tranche e scroll
    if (!visit.back) { futExtra = 0; monthsShown = MONTHS_STEP; }
    selected = null;
  }
  const nFull = wide ? 0 : FUT_FULL;
  if (wide && futExtra < FUT_WIDE) futExtra = FUT_WIDE;
  const back = !!(visit && visit.back);
  if (!selected || !rows.some((r) => r.sunday === selected)) selected = cur >= 0 ? rows[cur].sunday : (rows[0] || {}).sunday;

  const fut = cur >= 0 ? rows.slice(cur + 1) : rows.slice();
  const past = cur >= 0 ? rows.slice(0, cur) : [];
  const prevRow = past.length ? past[past.length - 1] : null;   // settimana scorsa: sempre in vista, è quella che si registra
  const older = past.slice(0, -1);
  const byMonth = new Map();
  for (const r of older) { const k = monthOf(r.sunday); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(r); }
  const monthKeys = [...byMonth.keys()].sort().reverse();   // dal più recente

  // apre quello che serve per rendere visibile una settimana (deep link, frecce del pannello)
  const reveal = (d) => {
    const fi = fut.findIndex((r) => r.sunday === d);
    if (fi >= nFull) futExtra = Math.max(futExtra, fi + 1 - nFull);
    const mk = monthOf(d);
    if (byMonth.has(mk) && older.some((r) => r.sunday === d)) {
      openMonths.add(mk); saveOpen();
      monthsShown = Math.max(monthsShown, Math.ceil((monthKeys.indexOf(mk) + 1) / MONTHS_STEP) * MONTHS_STEP);
    }
  };
  const dl = deepLinkWeek(rows);
  if (dl) { selected = dl; reveal(dl); }

  const ropts = { wide, selectedSunday: selected };
  const list = h('div', { class: 'cal-list' });
  const eyebrow = (k) => h('div', { class: 'eyebrow cal-group' }, ctx.t(k));
  const grouped = cur >= 0;

  if (grouped) list.append(eyebrow('cal.current'), weekCard(ctx, rows[cur], ropts));
  const nextFull = fut.slice(0, nFull);
  if (nextFull.length) { if (grouped) list.append(eyebrow('cal.nextWeeks')); list.append(...nextFull.map((r) => weekCard(ctx, r, ropts))); }

  // futuro lontano: righe compatte + «Mostra altre N settimane»
  const extraList = h('div', { class: 'list cal-compact', hidden: true });
  let futBtn = null;
  const futRemaining = () => fut.length - nFull - futExtra;
  const syncFut = () => {
    const rem = futRemaining();
    if (futBtn) { futBtn.remove(); futBtn = null; }
    if (rem > 0) {
      const k = rem <= FUT_STEP + 4 ? rem : FUT_STEP;   // niente coda di 1–4 settimane in un altro tocco
      futBtn = h('button', { type: 'button', class: 'btn tonal block cal-more', 'data-act': 'show-next', onclick: () => {
        const from = nFull + futExtra; futExtra += k;
        extraList.append(...fut.slice(from, from + k).map((r) => weekRow(ctx, r, ropts)));
        extraList.hidden = false;
        syncFut();
      } }, icon('chevron', 'cal-down'), k === 1 ? ctx.t('calview.moreWeeks1') : ctx.t('calview.moreWeeks', { n: k }));
      extraList.after(futBtn);
    }
  };
  if (fut.length > nFull) {
    extraList.append(...fut.slice(nFull, nFull + futExtra).map((r) => weekRow(ctx, r, ropts)));
    extraList.hidden = false;
    if (!nextFull.length && grouped) list.append(eyebrow('cal.nextWeeks'));
    list.append(extraList);
  }

  // passato: settimana scorsa + mesi
  if (prevRow || monthKeys.length) {
    list.append(eyebrow('cal.past'));
    if (prevRow) list.append(h('div', { class: 'list cal-compact cal-prev' }, weekRow(ctx, prevRow, ropts)));
    const wrap = h('div', { class: 'cal-months' });
    let moreBtn = null;
    const addMonths = (from, to) => { for (const k of monthKeys.slice(from, to)) wrap.append(monthGroup(ctx, k, byMonth.get(k), ropts)); };
    const syncMonths = () => {
      if (moreBtn) { moreBtn.remove(); moreBtn = null; }
      if (monthKeys.length > monthsShown) {
        moreBtn = h('button', { type: 'button', class: 'btn tonal block cal-more', 'data-act': 'show-months', onclick: () => {
          const from = monthsShown; monthsShown += MONTHS_STEP; addMonths(from, monthsShown); syncMonths();
        } }, icon('history'), ctx.t('calview.moreMonths'));
        wrap.after(moreBtn);
      }
    };
    addMonths(0, monthsShown);
    list.append(wrap);
    syncMonths();
  }

  const head = h('div', { class: 'cal-head' }, h('h1', { class: 'title' }, ctx.t('cal.title')));

  // legenda delle icone delle card (sui telefoni i title non si vedono)
  const legend = h('div', { class: 'cal-legend', 'aria-hidden': 'true', 'data-testid': 'cal-legend' }, [['check', 'ok', 'st.done'], ['refresh', 'acc', 'st.makeup'], ['swap', 'acc', 'st.swapped'], ['x', 'bad', 'st.skipped']].map(([ic, tone, k]) => h('span', { class: 'lg' }, h('span', { class: 'ind ' + tone }, icon(ic)), ctx.t(k))));
  const notStarted = cur < 0 && ctx.house.startSunday ? h('div', { class: 'note' }, icon('info'), ctx.t('cal.planStarts', { date: fmtDate(addDaysIso(ctx.house.startSunday, -6), ctx.lang, { year: true }) })) : null;

  // «Oggi»: compare solo quando la settimana corrente non è in vista, ancorato in basso sopra la barra di navigazione
  const todayBtn = cur >= 0 ? h('button', { type: 'button', class: 'btn tonal cal-today', 'data-act': 'today', hidden: true, 'aria-label': ctx.t('cal.goToday'), onclick: () => goToday(ctx) }, icon('calendar'), ctx.t('today')) : null;

  // pannello desktop: intestazione fissa (settimana precedente/successiva) + dettaglio (renderWeekDetail, di choresheet.js) che scorre per conto suo
  const panel = wide && selected ? h('aside', { class: 'cal-panel card', 'aria-label': ctx.t('cal.title') }) : null;
  const panelHead = () => {
    const i = rows.findIndex((r) => r.sunday === selected);
    const step = (k) => h('button', { type: 'button', class: 'icon-btn cal-step', 'data-act': k < 0 ? 'wk-prev' : 'wk-next', disabled: !rows[i + k] || null, 'aria-label': ctx.t(k < 0 ? 'calview.prevWeek' : 'calview.nextWeek'), title: ctx.t(k < 0 ? 'calview.prevWeek' : 'calview.nextWeek'),
      onclick: () => rows[i + k] && selectWeek(rows[i + k].sunday, { scroll: true }) }, icon('chevron', k < 0 ? 'cal-flip' : ''));
    return h('div', { class: 'cal-panelhead' }, step(-1), h('h2', { class: 'wd-title' }, fmtWeekRange(selected, ctx.lang)), step(1));
  };
  const fillPanel = () => { if (panel) panel.replaceChildren(panelHead(), h('div', { class: 'cal-panelbody' }, renderWeekDetail(ctx, selected, { heading: false }))); };
  if (panel) {
    fillPanel();
    panel.addEventListener('scroll', () => { panelY = panel.scrollTop; panelFor = selected; }, { passive: true });
  }
  /** Selezione sul posto (desktop): niente rifacimento della pagina, quindi scroll della lista e fuoco restano dove sono. */
  const selectWeek = (sun, { focus = false, scroll = false } = {}) => {
    if (!node.isConnected || !panel || !rows.some((r) => r.sunday === sun)) { selected = sun; ctx.rerender(); return; }
    selected = sun; reveal(sun);
    const el = node.querySelector(`.week[data-sunday="${sun}"]`);
    if (!el) { needShow = sun; ctx.rerender(); return; }   // settimana in un gruppo chiuso o oltre quelle mostrate: la pagina si rifà con il gruppo aperto
    node.querySelectorAll('.week.sel').forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); });
    el.classList.add('sel'); el.setAttribute('aria-pressed', 'true');
    panelY = 0; panelFor = sun; fillPanel(); panel.scrollTop = 0;
    if (focus) { try { el.focus({ preventScroll: true }); } catch { /* ignore */ } }
    if (focus || scroll) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  };
  selectFn = (sun) => selectWeek(sun);
  // tastiera (desktop): frecce su/giù, Home/Fine tra le settimane visibili; la selezione segue il fuoco
  list.addEventListener('keydown', (e) => {
    if (!wide || e.altKey || e.ctrlKey || e.metaKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const cur2 = e.target && e.target.closest ? e.target.closest('.week[data-sunday]') : null; if (!cur2) return;
    const all = [...list.querySelectorAll('.week[data-sunday]')]; const i = all.indexOf(cur2);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : i + (e.key === 'ArrowDown' ? 1 : -1);
    if (!all[to]) return;
    e.preventDefault(); selectWeek(all[to].dataset.sunday, { focus: true });
  });
  const keyHint = wide ? h('p', { class: 'cal-keyhint small muted' }, ctx.t('calview.keyHint')) : null;
  const node = h('div', { class: 'cal' }, head, legend, keyHint, notStarted, h('div', { class: 'cal-layout' }, list, panel), todayBtn ? h('div', { class: 'cal-today-wrap' }, todayBtn) : null);
  prevNode = node; prevMounted = false;
  syncFut();   // «Mostra altre N settimane» va subito dopo la lista compatta del futuro

  // dopo l'inserimento nel DOM: ritorno con «indietro» (scroll), deep link, pulsante «Oggi»
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!node.isConnected) return;
    if (prevNode === node) { prevMounted = true; visit = null; }   // solo se è ancora l'ultimo nodo creato
    if (panel && panelFor === selected && panelY) panel.scrollTop = panelY;
    if (dl) {
      clearDeepLink();
      const el = node.querySelector(`.week[data-sunday="${dl}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 2200);
        if (!wide && !document.querySelector('#layer .sheet')) openWeekSheet(ctx, dl);
      }
    } else if (needShow) {
      const el = node.querySelector(`.week[data-sunday="${needShow}"]`); needShow = null;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    } else if (back) window.scrollTo(0, lastY);
    if (io) { io.disconnect(); io = null; }
    const curEl = node.querySelector('.week.cur');
    if (todayBtn && curEl && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => { for (const e of es) todayBtn.hidden = e.isIntersecting; }, { threshold: 0 });
      io.observe(curEl);
    }
  }));
  return node;
}

function goToday(ctx) {
  const cur = ctx.calc.out.cur; if (cur < 0) return;
  const sun = ctx.calc.out.rows[cur].sunday;
  const smooth = !ctx.prefs.reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  if (window.matchMedia(WIDE).matches && selectFn) selectFn(sun); else { selected = sun; if (window.matchMedia(WIDE).matches) ctx.rerender(); }
}
