// Fogli (bottom sheet) legati ai turni: dettaglio turno, dettaglio settimana, WhatsApp, calendario .ics, richiesta di scambio.
// Qui vivono anche i flussi condivisi con Home e Calendario: "fatto" con checklist obbligatoria, annulla, sostituzioni, ritardi, volontari.
// Usato da js/screens/calendar.js, home.js e more.js. Le firme esportate sono parte del contratto (ARCHITECTURE.md).
import { h, icon, avatar, toggle, seg, copyText, download, confetti, loadCss } from './ui.js';
import { registerStrings, fmtWeekRange, fmtDate, dowLong } from './i18n.js';
import { CHORES, addDays } from './engine.js';
import { weekDays, planOf, delayOf, checklistOwners, swapPatch, whatsappText, rankingText, buildStats, makeIcs } from './extras.js';
import { it, en } from './strings/cal.js';
import { it as itFlow, en as enFlow } from './strings/flow.js';

registerStrings(it, en);
registerStrings(itFlow, enFlow);
loadCss('css/calendar.css');

export const CHORE_ICON = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };
const ci = (chore) => CHORES.indexOf(chore);
const dowIdx = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const isOk = (r) => r.kind === 'done' || r.kind === 'by';
const isSkip = (r) => r.kind === 'skipped' || r.kind === 'skippedBy';

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
 * `build(sheet, redraw)` ritorna il nodo del corpo. Il ridisegno: salta se i dati rilevanti non sono cambiati (niente sfarfallio),
 * e' rimandato durante la digitazione, mantiene scroll e focus (per chiave del controllo).
 */
function liveSheet(ctx, { title, full = false, build }) {
  const api = ctx.sheet({ title: '', full, body: h('div') });
  let off = () => {}; let pending = false; let dead = false; let last = '';
  const sig = () => { try { return JSON.stringify([ctx.me, ctx.isAdmin, ctx.lang, ctx.today(), ctx.state.weeks, ctx.state.requests, ctx.house]); } catch { return String(Math.random()); } };
  const typing = () => { const a = document.activeElement; return !!(a && api.el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox'); };
  const fkey = (el) => { const d = el.dataset || {}; return [d.act, d.task, d.day, d.who, d.toggle, d.chore, d.req, d.value].filter(Boolean).join('|'); };
  const draw = (force) => {
    if (dead) return;
    const s = sig();
    if (!force && s === last) return;
    if (!force && typing()) { pending = true; return; }
    pending = false; last = s;
    const a = document.activeElement; const key = a && a !== document.body && api.el.contains(a) ? fkey(a) : '';
    const y = api.body.scrollTop;
    try { const node = build(api, draw); api.setTitle(typeof title === 'function' ? title() : title); api.set(node); }
    catch (e) { console.error(e); api.set(h('p', { class: 'muted' }, ctx.t('error'))); }
    api.body.scrollTop = y;
    if (api.focusFirst) {
      api.focusFirst = false;
      const f = api.body.querySelector('[data-autofocus]') || api.body.querySelector('.cs-back') || api.body.querySelector('button:not([disabled]), a[href], input, select, textarea');
      if (f) f.focus({ preventScroll: true });
    } else if (key) {
      const f = [...api.body.querySelectorAll('button, a[href], input, select, textarea')].find((x) => fkey(x) === key);
      if (f && !f.disabled) f.focus({ preventScroll: true });
    }
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
/** Riga-azione (icona, titolo, descrizione) per le azioni secondarie. */
const actRow = (ic, tone, title, desc, attrs, onclick) => h('button', { type: 'button', class: 'li fl-act', ...attrs, onclick },
  h('div', { class: 'ico ' + tone }, icon(ic)), h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), icon('chevron'));

// ================================================================ FLUSSI CONDIVISI (checklist, annulla, chip)
/** Voci della checklist che erano mancanti al momento del "fatto" e che lo sono ancora (se qualcuno le recupera dopo, la segnalazione sparisce). */
export function incompleteOf(ctx, sunday, chore) {
  if (!ctx.feature('tasks')) return [];
  const row = rowOf(ctx, sunday); const c = ci(chore);
  if (!row || c < 0 || !isOk(row.res[c])) return [];
  const texts = ((weekDoc(ctx, sunday).incomplete || {})[chore]) || [];
  if (!texts.length) return [];
  const pend = new Set(ctx.actions.pendingChecklist(sunday, chore).map((x) => x.text));
  return texts.filter((x) => pend.has(x));
}

/** Chip di flusso di un turno: concordato, ritardo, volontario, incompleto → [{key, tone, ic, text}]. */
export function flowChips(ctx, sunday, chore) {
  const row = rowOf(ctx, sunday); const c = ci(chore);
  if (!row || c < 0 || !row.assigned[c]) return [];
  const wk = weekDoc(ctx, sunday); const res = row.res[c]; const t = ctx.t; const out = [];
  const open = !res.kind;
  const ag = (wk.agreed || {})[chore];
  if (ag && open && ag !== row.assigned[c]) out.push({ key: 'agreed', tone: 'acc', ic: 'users', text: t('flow.agreedWith', { name: ctx.name(ag) }) });
  const dl = delayOf(houseW(ctx), sunday, chore);
  if (dl && open) out.push({ key: 'delay', tone: 'warn', ic: 'clock', text: t('flow.delayUntil', { date: fmtDate(dl, ctx.lang) }) });
  const vol = (wk.volunteer || {})[chore];
  if (vol && isOk(res)) out.push({ key: 'volunteer', tone: 'acc', ic: 'user', text: t('flow.volunteerBy', { name: ctx.name(vol) }) });
  const miss = incompleteOf(ctx, sunday, chore);
  if (miss.length) out.push({ key: 'incomplete', tone: 'bad', ic: 'alert', text: t('flow.incomplete', { n: miss.length }) });
  return out;
}

/** Voci di checklist di una settimana con il responsabile (chi non le ha fatte scala alla settimana dopo). */
export function ownedItems(ctx, sunday) {
  if (!ctx.feature('tasks')) return [];
  try { return checklistOwners(houseW(ctx), ctx.calc.out, ctx.state.weeks || {}, sunday); } catch { return []; }
}
/** Può spuntare la voce chi ha la mansione, l'admin o il responsabile dell'arretrato (anche se questa settimana ha un'altra mansione). */
export const canTick = (ctx, sunday, x) => ctx.actions.canTask(sunday, x.chore) || (!!ctx.me && x.owner === ctx.me);
/** Spunta/togli una voce. Il responsabile di un arretrato senza la mansione scrive direttamente (le regole del nucleo ammettono solo l'assegnato). */
export async function tickTask(ctx, sunday, x, done) {
  const ws = !done && x.done && x.done.week ? x.done.week : sunday;
  try { await ctx.actions.toggleTask(ws, x.task.id, x.chore, done); }
  catch (e) {
    if (!(e && e.message === 'permission' && ctx.me && x.owner === ctx.me)) throw e;
    await ctx.store.setDoc('weeks', ws, { tasksDone: { [x.task.id]: done ? { by: ctx.me, at: ctx.now().toISOString() } : null } });
    if (done) await ctx.actions.log('task', { text: x.task.text });
  }
}
/** Riga di dettaglio di una voce: chi l'ha fatta, arretrato (di chi), a chi tocca. */
export function taskNote(ctx, x) {
  const t = ctx.t; const date = fmtDate(x.since, ctx.lang);
  if (x.status === 'done') return t('tasks.doneBy', { name: ctx.name((x.done && x.done.by) || '') || t('misc.admin') });
  if (x.reason === 'arrears') return x.owner === ctx.me ? t('flow.arrearsMine', { date }) : t('flow.arrearsOther', { date, name: ctx.name(x.owner) });
  if (x.status === 'overdue') return t('tasks.overdue', { date });
  return x.owner && x.owner !== ctx.me ? t('flow.ownerIs', { name: ctx.name(x.owner) }) : t('tasks.due');
}

/** Frase breve sulle conseguenze di una richiesta/offerta (con recupero o favore), per chi deve rispondere. a = assegnato, b = chi lo fa. */
export function termsLine(ctx, terms, aId, bId) {
  const k = terms === 'gift' ? 'gift' : 'repay';
  return ctx.t('flow.terms.' + k + '.line', { a: ctx.name(aId), b: bId ? ctx.name(bId) : ctx.t('flow.terms.whoAccepts') });
}
/** Scelta tra "con recupero" e "favore": due schede grandi con spiegazione e conseguenze per entrambe le persone. */
function termsPicker(ctx, { mode, a, b, value, onPick }) {
  const card = (k) => {
    const on = value === k;
    return h('button', { type: 'button', class: 'fl-term' + (on ? ' on' : '') + (k === 'gift' ? ' gift' : ''), 'data-terms': k, 'aria-pressed': String(on), onclick: () => onPick(k) },
      h('span', { class: 'fl-termhead' }, h('span', { class: 'fl-termradio' }, on ? icon('check') : null), h('span', { class: 'fl-termt' }, ctx.t(`flow.terms.${k}.${mode}.title`)), k === 'gift' ? chip(ctx.t('flow.terms.favor'), 'acc', 'sparkles') : null),
      h('span', { class: 'fl-termd' }, ctx.t(`flow.terms.${k}.${mode}.desc`)),
      h('span', { class: 'fl-terme', 'data-testid': 'terms-effect-' + k }, ctx.t(`flow.terms.${k}.eff`, { a: ctx.name(a), b: b ? ctx.name(b) : ctx.t('flow.terms.whoAccepts') })));
  };
  return h('div', { class: 'fl-terms', role: 'group', 'aria-label': ctx.t('flow.terms.group') }, h('div', { class: 'eyebrow' }, ctx.t('flow.terms.title')), card('repay'), card('gift'));
}

const confettiAt = (el) => { try { const r = el.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); } catch { /* ignore */ } };
const trapTab = (box) => box.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const f = [...box.querySelectorAll('button:not([disabled]), a[href], input, select, textarea')]; if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
});

/** Dialogo a scelta multipla (sheet). Ritorna la chiave scelta o null se chiuso. Il primo bottone prende il focus; Tab resta nel dialogo. */
function choiceDialog(ctx, { title, content, choices }) {
  return new Promise((resolve) => {
    let done = false; const opener = document.activeElement;
    const finish = (v) => {
      if (done) return; done = true; resolve(v);
      if (v !== undefined) sh.closeRaw();
      setTimeout(() => { try { if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true }); } catch { /* ignore */ } }, 60);
    };
    const btns = choices.map((c) => h('button', { type: 'button', class: 'btn block ' + (c.cls || ''), 'data-choice': c.key, onclick: () => finish(c.key) }, c.icon ? icon(c.icon) : null, c.label));
    const sh = ctx.sheet({ title, body: h('div', { class: 'stack fl-dialog' }, content, h('div', { class: 'fl-choices' }, btns)) });
    sh.closeRaw = sh.close; sh.close = () => { finish(null); sh.closeRaw(); };
    trapTab(sh.el);
    requestAnimationFrame(() => { try { btns[0].focus({ preventScroll: true }); } catch { /* ignore */ } });
  });
}

function openGate(ctx, missing) {
  const content = [
    h('p', { class: 'muted' }, ctx.t('flow.gate.text', { n: missing.length })),
    h('ul', { class: 'fl-missing', 'data-testid': 'gate-missing' }, missing.map((m) => h('li', null, h('span', { class: 'grow' }, m.text), m.status === 'overdue' ? chip(ctx.t('flow.overdue'), 'warn') : null))),
    h('p', { class: 'small muted' }, ctx.t('flow.gate.hint')),
  ];
  return choiceDialog(ctx, { title: ctx.t('flow.gate.title'), content, choices: [
    { key: 'all', label: ctx.t('flow.gate.all'), icon: 'check' },
    { key: 'force', label: ctx.t('flow.gate.force'), cls: 'soft' },
    { key: 'cancel', label: ctx.t('cancel'), cls: 'ghost' },
  ] });
}

/** Annulla un "fatto": torna "da fare". Ritorna true se riuscito. */
export function undoFlow(ctx, sunday, chore, { toast = true } = {}) {
  return run(ctx, () => ctx.actions.undoResult(sunday, chore), toast ? ctx.t('cal.t.reset') : null);
}

/**
 * Segna "fatto" (value 'done' | 'by:ID') con checklist obbligatoria: se mancano voci apre il dialogo (spunta tutto / comunque / annulla).
 * `volunteer`: lo fa chi non è assegnato di sua iniziativa (viene segnalato all'assegnato). Dopo il successo: toast con "Annulla".
 * Ritorna true se il turno è stato segnato.
 */
export async function markDoneFlow(ctx, sunday, chore, { value = 'done', volunteer = false, el = null, msg = null } = {}) {
  const A = ctx.actions; const row = rowOf(ctx, sunday); const c = ci(chore);
  const assigned = row ? row.assigned[c] : null;
  const exec = (o) => (volunteer ? A.volunteer(sunday, chore, o) : A.completeChore(sunday, chore, { value, ...o }));
  let r;
  try {
    r = await exec({});
    if (!r.ok) {
      const choice = await openGate(ctx, r.missing);
      if (!choice || choice === 'cancel') return false;
      r = await exec(choice === 'all' ? { checkAll: true } : { force: true });
    }
  } catch (e) { ctx.toast(e && e.message === 'permission' ? ctx.t('err.permission') : ctx.t('error')); return false; }
  ctx.haptic(ctx.prefs.haptics, 14);
  if (el && value === 'done') confettiAt(el);
  const n = (r.missing || []).length;
  const text = volunteer ? ctx.t('flow.volDone', { name: ctx.name(assigned) })
    : n ? ctx.t('flow.doneIncomplete', { n })
      : msg || (value.startsWith('by:') ? ctx.t('cal.t.by', { name: ctx.name(value.slice(3)) }) : ctx.t('cal.t.done'));
  ctx.toast(text, 7000, { action: { label: ctx.t('flow.undo'), onClick: () => { undoFlow(ctx, sunday, chore); } } });
  return true;
}

/**
 * Cerchio di check come interruttore (≥44px): fatto ⇄ da fare. Attivo solo se i permessi lo consentono.
 * Fatto → da fare con undoResult; da fare → fatto con il controllo della checklist.
 */
export function resultToggle(ctx, sunday, chore, { pop = false } = {}) {
  const row = rowOf(ctx, sunday); const c = ci(chore);
  const res = row.res[c]; const on = isOk(res); const sk = isSkip(res); const A = ctx.actions;
  const can = !!row.assigned[c] && !sk && (on ? A.canResult(sunday, chore, '') : A.canResult(sunday, chore, 'done'));
  const label = ctx.t('flow.toggle', { chore: ctx.t('chore.' + chore) });
  const btn = h('button', {
    type: 'button', class: 'ctoggle' + (can ? '' : ' locked'), 'data-toggle': chore, 'aria-pressed': String(on), 'aria-label': label, title: can ? null : ctx.t('flow.toggleLocked'),
    disabled: can ? null : true,
    onclick: async () => {
      btn.disabled = true;
      try { if (on) await undoFlow(ctx, sunday, chore); else await markDoneFlow(ctx, sunday, chore, { el: btn }); } finally { btn.disabled = false; }
    },
  }, h('span', { class: 'checkcircle' + (on ? ' on' : '') + (sk ? ' skip' : '') + (pop ? ' pop' : '') }, icon(sk ? 'x' : 'check')));
  return btn;
}

/** Richieste di sostituzione/offerta in sospeso per un turno. */
function coverRequests(ctx, sunday, chore) {
  return Object.entries(ctx.state.requests || {}).filter(([, q]) => q && (q.kind === 'cover' || q.kind === 'offer') && q.status === 'pending' && q.week === sunday && q.chore === chore);
}

/** Scelta (admin) di chi deve fare un turno non svolto: evidenzia il sostituto equo. Usato dalla scheda turno e dal dettaglio settimana. */
export function openAssignSheet(ctx, sunday, chore) {
  const c = ci(chore);
  if (c < 0 || !rowOf(ctx, sunday) || !ctx.isAdmin) return null;
  return liveSheet(ctx, { title: () => ctx.t('flow.assignTitle'), build: (api) => {
    const row = rowOf(ctx, sunday);
    if (!row) { api.close(); return h('div'); }
    const cur = (weekDoc(ctx, sunday).agreed || {})[chore]; const sug = row.subs[c];
    const ids = active(row).slice().sort((a, b) => (a === sug ? -1 : b === sug ? 1 : 0));
    const pick = async (id) => { if (await run(ctx, () => ctx.actions.assignCover(sunday, chore, id), ctx.t('flow.assignDone', { name: ctx.name(id), chore: ctx.t('chore.' + chore).toLowerCase() }))) api.close(); };
    return h('div', { class: 'stack' },
      h('div', { class: 'row' }, tile(chore, 'sm'), h('div', { class: 'grow' }, h('b', null, ctx.t('chore.' + chore)), h('span', { class: 'muted' }, ' · ' + fmtWeekRange(sunday, ctx.lang)))),
      h('p', { class: 'muted small' }, ctx.t('flow.assignHint')),
      row.assigned[c] ? h('p', { class: 'muted small' }, ctx.t('flow.assignNote', { name: ctx.name(row.assigned[c]) })) : null,
      sug && ids.includes(sug) ? h('div', { class: 'note ok' }, icon('sparkles'), ctx.t('chore.suggestedSub', { name: ctx.name(sug) })) : null,
      h('div', { class: 'list' }, ids.map((id) => h('button', { type: 'button', class: 'li cs-pick' + (id === sug ? ' sug' : ''), 'data-who': id, 'aria-pressed': String(id === cur), onclick: () => pick(id) },
        person(ctx, id), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.name(id)),
          row.rest.includes(id) || row.away.includes(id) ? h('div', { class: 'd' }, row.away.includes(id) ? ctx.t('cal.away') : ctx.t('chore.rest')) : null),
        id === sug ? chip(ctx.t('cal.suggested'), 'acc', 'sparkles') : null, id === cur ? icon('check') : icon('chevron')))),
      cur ? h('button', { type: 'button', class: 'btn danger block', 'data-act': 'assign-clear', onclick: async () => { if (await run(ctx, () => ctx.actions.assignCover(sunday, chore, null), ctx.t('flow.assignCleared'))) api.close(); } }, icon('x'), ctx.t('flow.assignClear')) : null);
  } });
}

// ================================================================ DETTAGLIO TURNO
export function openChoreSheet(ctx, sunday, chore, opts = {}) {
  const c = ci(chore);
  if (c < 0 || !rowOf(ctx, sunday)) return null;
  const st = { view: opts.view || 'main', delay: null, coverTo: '*', terms: 'repay' };   // stato che non deve perdersi nei ridisegni

  const build = (sh) => {
    const go = (v) => { st.view = v; sh.focusFirst = true; sh.draw(true); };
    const row = rowOf(ctx, sunday);
    if (!row) { sh.close(); return h('div'); }
    const A = ctx.actions; const t = ctx.t;
    const assigned = row.assigned[c];
    const res = row.res[c];
    const me = ctx.me;
    const aName = assigned ? ctx.name(assigned) : t('chore.noOne');
    const wk = weekDoc(ctx, sunday);
    const agreed = (wk.agreed || {})[chore];
    const finish = async (value, msg, ev) => {
      const el = ev && ev.currentTarget;
      let ok;
      if (value === 'done' || value.startsWith('by:')) ok = await markDoneFlow(ctx, sunday, chore, { value, el });
      else if (value === '') ok = await undoFlow(ctx, sunday, chore);
      else ok = await run(ctx, () => A.setResult(sunday, chore, value), msg);
      if (ok) sh.close();
    };

    // ------ sotto-viste ------
    if (st.view === 'cover') {
      const ids = present(row).filter((id) => id !== assigned && A.canResult(sunday, chore, 'by:' + id));
      const sug = row.subs[c];
      ids.sort((a, b) => (a === agreed ? -1 : b === agreed ? 1 : a === sug ? -1 : b === sug ? 1 : 0));
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, t('chore.whoCleaned')),
        sug && ids.includes(sug) ? h('div', { class: 'note ok' }, icon('sparkles'), t('chore.suggestedSub', { name: ctx.name(sug) })) : null,
        h('div', { class: 'list' }, ids.map((id) => h('button', { type: 'button', class: 'li cs-pick' + (id === sug ? ' sug' : ''), 'data-who': id, onclick: (ev) => finish('by:' + id, t('cal.t.by', { name: ctx.name(id) }), ev) },
          person(ctx, id), h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.name(id))), id === agreed ? chip(t('flow.agreed'), 'acc', 'users') : null, id === sug ? chip(t('cal.suggested'), 'acc', 'sparkles') : null, icon('chevron')))));
    }
    if (st.view === 'skip') {
      const sub = row.subs[c];
      const opts2 = [];
      if (res.kind !== 'skipped') opts2.push(h('button', { type: 'button', class: 'li cs-pick', 'data-value': 'skipped', onclick: (ev) => finish('skipped', t('cal.t.skipped'), ev) },
        h('div', { class: 'ico r' }, icon('x')), h('div', { class: 'grow' }, h('div', { class: 't' }, t('chore.nobody')), h('div', { class: 'd' }, t('cal.skipNobodyHint', { name: aName }))), icon('chevron')));
      if (sub && sub !== assigned && !(res.kind === 'skippedBy' && res.id === sub)) opts2.push(h('button', { type: 'button', class: 'li cs-pick', 'data-value': 'skipped:' + sub, onclick: (ev) => finish('skipped:' + sub, t('cal.t.skipped'), ev) },
        person(ctx, sub), h('div', { class: 'grow' }, h('div', { class: 't' }, t('cal.alsoNot', { name: ctx.name(sub) })), h('div', { class: 'd' }, t('cal.skipAlsoHint', { name: ctx.name(sub) }))), icon('chevron')));
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, t('home.notDone')),
        h('div', { class: 'note warn' }, icon('alert'), t('chore.undoSkipped')),
        h('div', { class: 'list' }, opts2));
    }
    if (st.view === 'swap') {
      const entries = [];
      CHORES.forEach((c2, i) => { const id = row.assigned[i]; if (i !== c && id && id !== assigned) entries.push({ id, chore2: c2 }); });
      for (const id of present(row)) if (id !== assigned && !row.assigned.includes(id)) entries.push({ id, chore2: null });
      const doSwap = async (e) => {
        const patch = swapPatch(row, { chore, personId: assigned }, { chore: e.chore2 || 'rest', personId: e.id });
        if (await run(ctx, () => A.setSwap(sunday, patch), t('cal.swapDone'))) go('main');
      };
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, t('chore.swapWith')),
        h('p', { class: 'muted small' }, t('cal.swapHint')),
        entries.length ? h('div', { class: 'list' }, entries.map((e) => h('button', { type: 'button', class: 'li cs-pick', 'data-who': e.id, 'data-chore': e.chore2 || 'rest', onclick: () => doSwap(e) },
          person(ctx, e.id),
          h('div', { class: 'grow' }, h('div', { class: 't' }, e.chore2 ? `${ctx.name(e.id)} · ${t('chore.' + e.chore2)}` : ctx.name(e.id)),
            h('div', { class: 'd' }, e.chore2 ? t('cal.swapSwap', { a: ctx.name(e.id), c1: t('chore.' + chore), b: aName, c2: t('chore.' + e.chore2) })
              : t('cal.swapCover', { a: aName, c1: t('chore.' + chore), b: ctx.name(e.id) }))),
          icon('chevron')))) : h('div', { class: 'empty' }, t('req.noChores')));
    }
    if (st.view === 'ask') {
      const ids = present(row).filter((id) => id !== assigned);
      const sug = row.subs[c];
      ids.sort((a, b) => (a === sug ? -1 : b === sug ? 1 : 0));
      const opt = (key, ic, title, desc, extra) => h('button', { type: 'button', class: 'li cs-pick' + (st.coverTo === key ? ' sug' : ''), 'data-who': key, 'aria-pressed': String(st.coverTo === key), onclick: () => { st.coverTo = key; sh.draw(true); } },
        ic, h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), extra, st.coverTo === key ? icon('check') : null);
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, t('flow.askTitle')),
        h('p', { class: 'muted small' }, t('flow.askHint')),
        h('div', { class: 'list', role: 'group', 'aria-label': t('flow.askTitle') },
          opt('*', h('div', { class: 'ico' }, icon('users')), t('flow.askAnyone'), t('flow.askAnyoneHint')),
          ids.map((id) => opt(id, person(ctx, id), ctx.name(id), null, id === sug ? chip(t('cal.suggested'), 'acc', 'sparkles') : null))),
        termsPicker(ctx, { mode: 'ask', a: assigned, b: st.coverTo === '*' ? null : st.coverTo, value: st.terms, onPick: (k) => { st.terms = k; sh.draw(true); } }),
        h('button', { type: 'button', class: 'btn lg block', 'data-act': 'ask-send', onclick: async () => {
          if (await run(ctx, () => A.requestCover({ week: sunday, chore, to: st.coverTo === '*' ? null : st.coverTo, terms: st.terms }), t('flow.askSent'))) { st.terms = 'repay'; go('main'); }
        } }, icon('swap'), t('flow.askSend')));
    }
    if (st.view === 'offer') {
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, t('flow.offerTitle')),
        h('p', { class: 'muted small' }, t('flow.offerHint', { name: aName })),
        termsPicker(ctx, { mode: 'offer', a: assigned, b: me, value: st.terms, onPick: (k) => { st.terms = k; sh.draw(true); } }),
        h('button', { type: 'button', class: 'btn lg block', 'data-act': 'offer-send', onclick: async () => {
          if (await run(ctx, () => A.offerCover({ week: sunday, chore, terms: st.terms }), t('flow.offerSent', { name: aName }))) { st.terms = 'repay'; go('main'); }
        } }, icon('user'), t('flow.offerSend')));
    }
    if (st.view === 'delay') {
      const today = ctx.today();
      const days = Array.from({ length: 14 }, (_, i) => addDays(sunday, i + 1));
      const cur = delayOf(houseW(ctx), sunday, chore);
      if (st.delay === null) st.delay = cur || '';
      const free = days.filter((d) => d >= today);
      const pickLabel = (d) => `${dowLong(d, ctx.lang)} ${fmtDate(d, ctx.lang)}`;
      return h('div', { class: 'stack' },
        back(ctx, () => go('main')),
        h('div', { class: 'cs-title' }, t('flow.delayTitle')),
        h('p', { class: 'muted small' }, t('flow.delayHint')),
        free.length ? h('div', { class: 'fl-days daychips', role: 'group', 'aria-label': t('flow.delayPick') }, days.map((d) => h('button', {
          type: 'button', class: d < today ? 'past' : '', disabled: d < today ? true : null, 'data-day': d, 'aria-pressed': String(st.delay === d), 'aria-label': pickLabel(d),
          onclick: () => { st.delay = d; sh.draw(true); },
        }, h('small', null, t('dow.' + dowIdx(d))), String(+d.slice(8)))))
          : h('div', { class: 'note warn' }, icon('alert'), t('flow.delayNoDays')),
        h('button', { type: 'button', class: 'btn lg block', 'data-act': 'delay-save', disabled: st.delay && st.delay >= today ? null : true, onclick: async () => {
          if (await run(ctx, () => A.setDelay(sunday, chore, st.delay), t('flow.delaySaved', { date: fmtDate(st.delay, ctx.lang) }))) { st.delay = null; go('main'); }
        } }, icon('clock'), st.delay ? t('flow.delayConfirm', { day: pickLabel(st.delay) }) : t('flow.delayPick')),
        cur ? h('button', { type: 'button', class: 'btn soft block', 'data-act': 'delay-clear', onclick: async () => { if (await run(ctx, () => A.setDelay(sunday, chore, null), t('flow.delayCleared'))) { st.delay = null; go('main'); } } }, icon('x'), t('flow.delayClear')) : null);
    }

    // ------ vista principale ------
    const done = isOk(res); const skipped = isSkip(res);
    const plan = planOf(houseW(ctx), sunday, chore);
    const stChip = (() => {
      if (res.kind === 'done') return chip(t('st.done'), 'ok', 'check');
      if (res.kind === 'by') return chip(t('st.doneBy', { name: ctx.name(res.id) }), 'ok', 'check');
      if (res.kind === 'skipped') return chip(t('st.skipped'), 'bad', 'x');
      if (res.kind === 'skippedBy') return chip(t('st.skippedBy', { name: ctx.name(res.id) }), 'bad', 'x');
      if (!assigned) return chip(t('chore.noOne'), '');
      if (row.closed) return chip(t('st.late'), 'warn', 'clock');
      if (row.isFut) return chip(t('st.preview'), '');
      if (!row.isCur) return chip(t('st.pending'), 'warn', 'clock');
      return chip(t('st.todo'), 'acc');
    })();
    const by = (wk.resultBy || {})[chore], at = (wk.resultAt || {})[chore];
    const fchips = flowChips(ctx, sunday, chore);
    const chipsRow = (row.isMakeup[c] || row.swapped[c] || plan || fchips.length) ? h('div', { class: 'cs-chips', 'data-testid': 'chore-chips' },
      row.isMakeup[c] ? chip(t('chore.makeupBadge'), 'acc', 'refresh') : null,
      row.swapped[c] ? chip(t('st.swapped'), 'acc', 'swap') : null,
      plan ? chip(t('st.planned', { day: dowLong(plan, ctx.lang).toLowerCase() }), 'acc', 'calendar') : null,
      fchips.map((f) => h('span', { 'data-flow': f.key, style: { display: 'contents' } }, chip(f.text, f.tone, f.ic)))) : null;
    const hero = h('div', { class: 'cs-hero' },
      h('div', { class: 'cs-top' }, tile(chore), h('div', { class: 'grow' }, h('div', { class: 'cs-name' }, t('chore.' + chore)), h('div', { class: 'muted small' }, `${fmtWeekRange(sunday, ctx.lang)} · ${t('cal.week', { n: row.P })}`)), stChip),
      h('div', { class: 'cs-who' }, assigned ? person(ctx, assigned, 'lg') : h('div', { class: 'av lg cs-none' }, '–'),
        h('div', { class: 'grow' }, h('div', { class: 'lbl' }, t('chore.assignedTo')), h('div', { class: 'cs-pname', 'data-testid': 'assignee' }, aName))),
      chipsRow,
      row.isMakeup[c] ? h('p', { class: 'cs-hint' }, t('chore.makeupHint')) : null,
      res.kind && at ? h('div', { class: 'cs-marked' }, icon('clock'), t('cal.markedWhen', { name: by === 'admin' || !by ? t('misc.admin') : ctx.name(by), when: whenLabel(ctx, at) })) : null);

    const out = [hero];

    // turno segnato fatto ma incompleto: visibile a tutti, in evidenza
    const miss = incompleteOf(ctx, sunday, chore);
    if (miss.length) {
      out.push(h('div', { class: 'note bad fl-inc', 'data-testid': 'incomplete-note', role: 'status' }, icon('alert'),
        h('div', { class: 'grow stack tight' }, h('b', null, t('flow.incTitle')), h('span', null, t('flow.incText')),
          h('ul', { class: 'fl-missing' }, miss.map((x) => h('li', null, x))),
          ctx.isAdmin ? h('span', { class: 'small' }, t('flow.incAdmin')) : null)));
    }

    // azioni sul risultato
    const canDone = !!assigned && res.kind !== 'done' && A.canResult(sunday, chore, 'done');
    const coverIds = assigned ? present(row).filter((id) => id !== assigned && !(res.kind === 'by' && res.id === id) && A.canResult(sunday, chore, 'by:' + id)) : [];
    const showCover = coverIds.length && (ctx.isAdmin || assigned === me || agreed === me);
    const canSkip = !!assigned && A.canResult(sunday, chore, 'skipped') && !(res.kind === 'skipped' && !(row.subs[c] && row.subs[c] !== assigned));
    const canReset = !!assigned && !!res.kind && A.canResult(sunday, chore, '');
    const canNudge = ctx.isAdmin && !!assigned && assigned !== me && !res.kind && !row.isFut;
    const reqs = coverRequests(ctx, sunday, chore);
    const myOffer = reqs.find(([, q]) => q.kind === 'offer' && q.from === me);
    const canVol = !!assigned && !!me && assigned !== me && !res.kind && agreed !== me && A.canResult(sunday, chore, 'by:' + me);
    const acts = [];
    if (canDone) acts.push(h('button', { type: 'button', class: 'btn lg block', 'data-act': 'done', onclick: (ev) => finish('done', t('cal.t.done'), ev) }, icon('check'), t('home.markDone')));
    if (showCover) {
      const single = coverIds.length === 1 && coverIds[0] === me;
      acts.push(h('button', { type: 'button', class: 'btn soft block', 'data-act': 'cover', onclick: (ev) => (single ? finish('by:' + me, t('cal.t.by', { name: ctx.meName }), ev) : go('cover')) },
        icon('users'), single ? t('cal.iCleaned', { name: aName }) : t('home.didSomeoneElse')));
    }
    if (canSkip) acts.push(h('button', { type: 'button', class: 'btn danger block', 'data-act': 'skip', onclick: () => go('skip') }, icon('x'), t('home.notDone')));
    if (canReset) acts.push(h('button', { type: 'button', class: 'btn ' + (done ? 'tonal' : 'ghost') + ' block', 'data-act': 'reset', onclick: (ev) => finish('', t('cal.t.reset'), ev) }, icon('refresh'), t('chore.reset')));
    if (canNudge) acts.push(h('button', { type: 'button', class: 'btn tonal block', 'data-act': 'nudge', onclick: async () => { await run(ctx, () => A.nudge(assigned), t('acc.nudgeSent')); } }, icon('bell'), t('cal.nudgeName', { name: aName })));
    if (acts.length) out.push(h('div', { class: 'cs-actions' }, acts));
    else if (assigned && !ctx.isAdmin && !row.isFut && !canVol) out.push(h('div', { class: 'note' }, icon('lock'), t('chore.adminOnly')));

    // checklist del turno (obbligatoria prima di "fatto")
    if (ctx.feature('tasks') && assigned) {
      const list = ownedItems(ctx, sunday).filter((x) => x.chore === chore);
      if (list.length) {
        const nDone = list.filter((x) => x.status === 'done').length;
        const canAny = list.some((x) => canTick(ctx, sunday, x));
        out.push(h('section', { class: 'cs-sec' },
          h('div', { class: 'eyebrow' }, h('span', null, t('flow.checklist')), h('span', { class: 'fl-progn', 'data-testid': 'chore-progress' }, `${nDone}/${list.length}`)),
          h('div', { class: 'bar fl-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(list.length), 'aria-valuenow': String(nDone), 'aria-label': t('flow.checklist') }, h('i', { style: { width: Math.round(100 * nDone / list.length) + '%' } })),
          h('div', { class: 'list' }, list.map((x) => {
            const isDone = x.status === 'done';
            const inner = [h('span', { class: 'checkcircle' + (isDone ? ' on' : '') }, icon('check')),
              h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text), h('div', { class: 'd', 'data-reason': x.reason }, taskNote(ctx, x)))];
            return canTick(ctx, sunday, x) ? h('button', { type: 'button', class: 'li cs-task', 'data-task': x.task.id, 'aria-pressed': String(isDone), onclick: () => run(ctx, () => tickTask(ctx, sunday, x, !isDone)) }, inner)
              : h('div', { class: 'li cs-task' }, inner);
          })),
          h('p', { class: 'muted small cs-cap' }, canAny ? (nDone === list.length ? t('flow.checklistDone') : t('flow.checklistHint')) : t('flow.checklistOnly'))));
      }
    }

    // richieste di sostituzione in sospeso
    if (reqs.length && !res.kind) {
      const rows = reqs.map(([id, q]) => {
        const mineReq = q.from === me;
        let title, desc = null, buttons = null, ic = 'swap';
        const tl = q.kind === 'cover' ? termsLine(ctx, q.terms, q.from, q.to || (q.from === me ? null : me)) : termsLine(ctx, q.terms, q.to, q.from);
        desc = tl;
        if (q.kind === 'cover') {
          if (mineReq) { title = q.to ? t('flow.req.mineTo', { name: ctx.name(q.to) }) : t('flow.req.mineAny'); buttons = [h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'req-cancel', 'data-req': id, onclick: () => run(ctx, () => A.cancelSwap(id), t('flow.req.cancelled')) }, t('req.cancel'))]; }
          else if (me && (!q.to || q.to === me)) {
            title = q.to ? t('flow.req.coverTo', { name: ctx.name(q.from) }) : t('flow.req.cover', { name: ctx.name(q.from) });
            buttons = [h('button', { type: 'button', class: 'btn sm', 'data-act': 'req-yes', 'data-req': id, onclick: () => run(ctx, () => A.answerCover(id, true), t('flow.req.agreedMe')) }, icon('check'), t('flow.req.canDo')),
              h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'req-no', 'data-req': id, onclick: () => run(ctx, () => A.answerCover(id, false), t('flow.req.declined')) }, t('flow.req.cant'))];
          } else title = t('flow.req.coverInfo', { name: ctx.name(q.from), to: ctx.name(q.to) });
        } else {
          ic = 'user';
          if (mineReq) { title = t('flow.req.offerMine', { name: ctx.name(q.to) }); buttons = [h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'req-cancel', 'data-req': id, onclick: () => run(ctx, () => A.cancelSwap(id), t('flow.req.cancelled')) }, t('req.cancel'))]; }
          else if (q.to === me || ctx.isAdmin) {
            title = t('flow.req.offer', { name: ctx.name(q.from) });
            buttons = [h('button', { type: 'button', class: 'btn sm', 'data-act': 'req-yes', 'data-req': id, onclick: () => run(ctx, () => A.answerCover(id, true), t('flow.req.agreedHim', { name: ctx.name(q.from) })) }, icon('check'), t('req.accept')),
              h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'req-no', 'data-req': id, onclick: () => run(ctx, () => A.answerCover(id, false), t('flow.req.declined')) }, t('req.decline'))];
          } else title = t('flow.req.offerInfo', { name: ctx.name(q.from), to: ctx.name(q.to) });
        }
        return h('div', { class: 'li fl-req', 'data-testid': 'cover-req', 'data-kind': q.kind }, h('div', { class: 'ico' }, icon(ic)),
          h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null, buttons ? h('div', { class: 'fl-btns' }, buttons) : null));
      });
      out.push(section(t('flow.sec.requests'), h('div', { class: 'list' }, rows)));
    }

    // assegnato: sostituto o ritardo
    const delayNow = delayOf(houseW(ctx), sunday, chore);
    if (assigned && assigned === me && !res.kind) {
      const rows = [];
      if (ctx.feature('requests')) rows.push(actRow('users', '', t('flow.askBtn'), t('flow.askHint'), { 'data-act': 'ask' }, () => go('ask')));
      rows.push(actRow('clock', 'o', delayNow ? t('flow.delayUntil', { date: fmtDate(delayNow, ctx.lang) }) : t('flow.delayBtn'), delayNow ? t('flow.delayBtn') : t('flow.delayHint'), { 'data-act': 'delay' }, () => { st.delay = null; go('delay'); }));
      if (delayNow) rows.push(actRow('x', 'r', t('flow.delayClear'), null, { 'data-act': 'delay-clear-quick' }, async () => { await run(ctx, () => A.setDelay(sunday, chore, null), t('flow.delayCleared')); }));
      out.push(section(t('flow.sec.mine'), h('div', { class: 'list' }, rows)));
    }

    // altri: offerta o volontariato
    if (assigned && me && assigned !== me && !res.kind && (canVol || (ctx.feature('requests') && agreed !== me))) {
      const rows = [];
      if (ctx.feature('requests') && agreed !== me) {
        if (myOffer) rows.push(h('div', { class: 'li fl-act muted', 'data-act': 'offer-pending' }, h('div', { class: 'ico' }, icon('clock')), h('div', { class: 'grow' }, t('flow.req.offerMine', { name: aName }))));
        else rows.push(actRow('user', '', t('flow.offerBtn'), t('flow.offerHint', { name: aName }), { 'data-act': 'offer' }, () => { st.terms = 'repay'; go('offer'); }));
      }
      if (canVol) rows.push(actRow('sparkles', 'o', t('flow.volBtn'), null, { 'data-act': 'volunteer' }, async (ev) => {
        const el = ev.currentTarget;
        const choice = await choiceDialog(ctx, { title: t('flow.volTitle'), content: [h('p', { class: 'muted' }, t('flow.volText', { name: aName })), h('p', { class: 'small fl-terme' }, t('flow.terms.repay.eff', { a: aName, b: ctx.meName }))], choices: [
          { key: 'ok', label: t('flow.volConfirm'), icon: 'check' }, { key: 'gift', label: t('flow.volGift'), icon: 'sparkles', cls: 'soft' }, { key: 'cancel', label: t('cancel'), cls: 'ghost' }] });
        if (choice === 'ok' && (await markDoneFlow(ctx, sunday, chore, { volunteer: true, el }))) sh.close();
        else if (choice === 'gift' && (await run(ctx, () => A.offerCover({ week: sunday, chore, terms: 'gift' }), t('flow.offerSent', { name: aName })))) sh.draw(true);
      }));
      out.push(section(t('flow.sec.others'), h('div', { class: 'list' }, rows)));
    }

    // giorno scelto
    if (assigned && !row.closed && A.canPlan(sunday, chore)) {
      const today = ctx.today();
      out.push(section(t('chore.planDay'),
        h('div', { class: 'card stack tight' },
          h('div', { class: 'daychips', role: 'group', 'aria-label': t('chore.planDay') }, weekDays(sunday).map((d) => h('button', {
            type: 'button', class: d < today ? 'past' : '', 'aria-pressed': String(plan === d), 'data-day': d, 'aria-label': `${dowLong(d, ctx.lang)} ${fmtDate(d, ctx.lang)}`,
            onclick: () => run(ctx, () => A.setPlanDay(sunday, chore, plan === d ? null : d)),
          }, h('small', null, t('dow.' + dowIdx(d))), String(+d.slice(8))))),
          h('p', { class: 'muted small' }, t('chore.planHint')),
          plan ? h('button', { type: 'button', class: 'btn soft sm', 'data-act': 'plan-clear', onclick: () => run(ctx, () => A.setPlanDay(sunday, chore, null)) }, icon('x'), t('chore.planClear')) : null)));
    }

    // scambio turno (richiesta)
    if (ctx.feature('requests') && me && assigned === me && !row.closed) {
      const mine = Object.entries(ctx.state.requests || {}).filter(([, q]) => q.kind !== 'nudge' && q.kind !== 'cover' && q.kind !== 'offer' && q.kind !== 'notice' && q.week === sunday && q.from === me && q.fromChore === chore && q.status === 'pending');
      out.push(section(t('req.title'), h('div', { class: 'stack tight' },
        mine.map(([id, q]) => h('div', { class: 'li cs-req' }, h('div', { class: 'ico' }, icon('swap')),
          h('div', { class: 'grow' }, h('div', { class: 't' }, `${ctx.name(q.to)} · ${t('chore.' + q.toChore)}`), h('div', { class: 'd' }, t('req.pending'))),
          h('button', { type: 'button', class: 'btn soft sm', onclick: () => run(ctx, () => A.cancelSwap(id), null) }, t('req.cancel')))),
        h('button', { type: 'button', class: 'btn soft block', 'data-act': 'request', onclick: () => openSwapRequestSheet(ctx, sunday, chore) }, icon('swap'), t('req.new')))));
    }

    // admin: scegliere chi lo fa + scambio concordato manuale
    if (ctx.isAdmin && assigned) {
      const arows = [];
      if (!done && !row.isFut) {
        arows.push(actRow('users', '', t('flow.assignBtn'), agreed ? t('flow.agreedWith', { name: ctx.name(agreed) }) : t('flow.assignHint'), { 'data-act': 'assign' }, () => openAssignSheet(ctx, sunday, chore)));
        if (agreed) arows.push(actRow('x', 'r', t('flow.assignClear'), null, { 'data-act': 'assign-clear-quick' }, () => run(ctx, () => A.assignCover(sunday, chore, null), t('flow.assignCleared'))));
      }
      if (arows.length) out.push(section(t('flow.sec.admin'), h('div', { class: 'list' }, arows)));
      out.push(section(t('chore.swap'), h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn soft', 'data-act': 'swap', onclick: () => go('swap') }, icon('swap'), t('chore.swapWith')),
        row.swapped.some(Boolean) ? h('button', { type: 'button', class: 'btn danger', 'data-act': 'swap-cancel', onclick: () => run(ctx, () => A.clearSwap(sunday), t('cal.swapCleared')) }, icon('x'), t('cal.swapCancel')) : null)));
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
    const res = row.res[c];
    const showOc = oc && (oc.key !== 'done' || res.kind === 'by');
    const fl = id ? flowChips(ctx, sunday, chore) : [];
    const rowEl = h('div', { class: 'chore wd-chore', 'data-chore': chore },
      h('button', { type: 'button', class: 'wd-main', 'data-open': chore, onclick: () => openChoreSheet(ctx, sunday, chore) },
        tile(chore),
        h('div', { class: 'grow' }, h('div', { class: 't' }, ctx.t('chore.' + chore)),
          h('div', { class: 's' }, id ? [person(ctx, id, 'sm'), h('span', { class: 'wd-pn' }, ctx.name(id))] : h('span', null, ctx.t('chore.noOne')),
            row.isMakeup[c] ? chip(ctx.t('chore.makeupBadge'), 'acc', 'refresh') : null,
            row.swapped[c] ? chip(ctx.t('st.swapped'), 'acc', 'swap') : null,
            plan ? chip(`${ctx.t('dow.' + dowIdx(plan))} ${+plan.slice(8)}`, '', 'calendar') : null,
            showOc ? chip(oc.label, oc.tone, oc.ic) : null,
            fl.map((f) => chip(f.text, f.tone, f.ic))))),
      id ? resultToggle(ctx, sunday, chore) : null);
    const canAssign = ctx.isAdmin && !!id && !isOk(res) && !row.isFut;
    return h('div', { class: 'wd-item' }, rowEl,
      canAssign ? h('div', { class: 'wd-assign' }, h('button', { type: 'button', class: 'btn tonal sm', 'data-assign': chore, onclick: () => openAssignSheet(ctx, sunday, chore) }, icon('users'), ctx.t('flow.assignBtn'))) : null);
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
    const list = ownedItems(ctx, sunday);
    if (list.length) out.push(section(ctx.t('home.checklist'), h('div', { class: 'list' }, list.map((x) => {
      const done = x.status === 'done';
      const can = canTick(ctx, sunday, x);
      const inner = [h('span', { class: 'checkcircle' + (done ? ' on' : '') }, icon('check')), h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text),
        h('div', { class: 'd' }, `${ctx.t('chore.' + x.chore)}${x.owner ? ' · ' + ctx.name(x.owner) : ''}${x.reason === 'arrears' && !done ? ' · ' + taskNote(ctx, x) : ''}`))];
      return can ? h('button', { type: 'button', class: 'li cs-task', 'data-task': x.task.id, 'aria-pressed': String(done), onclick: () => run(ctx, () => tickTask(ctx, sunday, x, !done)) }, inner) : h('div', { class: 'li cs-task' }, inner);
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
