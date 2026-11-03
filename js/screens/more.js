// Schermata "Altro": hub + sotto-pagine (scorte, regole, ultimo che esce, checklist, scambi, registro, guida, info).
// Esporta anche `renderRulesContent(houseOrCtx)` (usato dal gate regole) e `openLastOutSheet(ctx)`.
import { h, icon, loadCss, liRow, empty, avatar, toggle, stepper, confirmDialog, confetti, clear } from '../ui.js';
import { t, tr, getLang, fmtDate, fmtWeekRange, dowLong, registerStrings } from '../i18n.js';
import { CHORES, DEFAULT_SETTINGS, addDays } from '../engine.js';
import { LASTOUT_DEFAULT_KEYS, TASK_TEMPLATES, SHARED_TEMPLATES, sharedStatus, checklistFor, nextDueWeek, weekIndex, weekOfDate, uid, cleanNote } from '../extras.js';
import { ownedItems, canTick, tickTask, taskNote } from '../choresheet.js';
import { it, en } from '../strings/more.js';
import { it as it2, en as en2 } from '../strings/more2.js';
import { it as it3, en as en3 } from '../strings/more3.js';
import { it as itHow, en as enHow } from '../strings/howto.js';
import { it as itReason, en as enReason } from '../strings/reason.js';
import { normNeed, frequentNeeds, distinctNeeds, starterNeeds, splitPasted } from '../needs-suggest.js';
import { it as itFlow, en as enFlow } from '../strings/flow.js';   // flow.shared.* (testi condivisi con la Home)
import { it as itB, en as enB } from '../strings/uxb.js';
import { it as itBal, en as enBal } from '../strings/balance.js';

registerStrings(it, en);
registerStrings(it2, en2);
registerStrings(it3, en3);
registerStrings(itBal, enBal);
registerStrings(itHow, enHow);
registerStrings(itReason, enReason);
registerStrings(itFlow, enFlow);
registerStrings(itB, enB);

const REPO = 'https://github.com/iantomasi-nicola/tidyhouse';
const CHORE_ICON = { floor: 'broom', bathroom: 'shower', kitchen: 'pot' };

// ================================================================ utilità
const p2 = (x) => String(x).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const parseAt = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };
function whenLabel(ctx, iso) {
  const d = iso && parseAt(iso); if (!d) return '';
  const day = localDay(d), today = ctx.today();
  if (day === today) return `${t('today')}, ${hhmm(d)}`;
  if (day === addDays(today, -1)) return `${t('yesterday')}, ${hhmm(d)}`;
  return `${fmtDate(day, ctx.lang)}, ${hhmm(d)}`;
}
function dayLabel(ctx, day) {
  const today = ctx.today();
  if (day === today) return t('today');
  if (day === addDays(today, -1)) return t('yesterday');
  const l = `${dowLong(day, ctx.lang)} ${fmtDate(day, ctx.lang, { year: day.slice(0, 4) !== today.slice(0, 4) })}`;
  return l.charAt(0).toUpperCase() + l.slice(1);
}
const personName = (ctx, id) => (id === 'admin' ? t('misc.admin') : id ? ctx.name(id) : '—');
/** Esegue un'azione mostrando un toast se fallisce. */
async function attempt(ctx, fn) {
  try { return await fn(); } catch (e) { console.error(e); ctx.toast(e && e.message === 'permission' ? t('err.permission') : e && e.message === 'expired' ? t('flow.req.expired') : t('error')); return undefined; }
}
const chip = (cls, ...kids) => h('span', { class: 'chip ' + cls }, ...kids);
const card = (...kids) => h('section', { class: 'card stack' }, ...kids);
function head(title, { back = '#/more', right = null } = {}) {
  return h('div', { class: 'mx-head' }, back ? h('a', { class: 'icon-btn mx-back', href: back, 'aria-label': t('back') }, icon('back')) : null, h('h1', { class: 'title' }, title), right ? h('div', { class: 'mx-right' }, right) : null);
}
function offPage(title) {
  return h('div', { class: 'mx mx-sub' }, head(title), empty('lock', t('moreX.off'), t('moreX.offHint')));
}
/** Contenitore di pagina. L'animazione di ingresso parte solo quando si apre la pagina, non a ogni aggiornamento dei dati (niente sfarfallii). */
let lastShell = { path: '', at: 0 };
const shell = (...kids) => {
  loadCss('css/more.css');
  const path = location.hash; const now = Date.now();
  const again = lastShell.path === path && now - lastShell.at < 2500;
  lastShell = { path, at: now };
  return h('div', { class: 'mx mx-sub' + (again ? '' : ' fade-up') }, ...kids);
};
const reduceMotion = () => document.documentElement.classList.contains('no-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// ================================================================ hub
/** «Da fare ora»: richieste che aspettano me e compiti condivisi che toccano a me, con il pulsante giusto già nell'hub (1 tap invece di 3). */
function todoBlock(ctx) {
  const reqs = awaitingMe(ctx).slice(0, 3);
  let shared = [];
  try { if (ctx.feature('shared') && ctx.me) shared = sharedList(ctx).filter((x) => x.due && x.suggested === ctx.me).slice(0, 2); } catch { /* ignore */ }
  if (!reqs.length && !shared.length) return null;
  const lock = (btn, fn) => { btn.disabled = true; Promise.resolve(fn()).then((ok) => { if (ok === false) btn.disabled = false; }, () => { btn.disabled = false; }); };
  const reqRow = (r) => {
    const open = reqKind(r) === 'cover' && !r.to;
    const yes = h('button', { type: 'button', class: 'btn sm', 'data-testid': 'hub-req-accept-' + r.id, onclick: () => lock(yes, () => answerRequest(ctx, r, true)) }, icon('check'), reqKind(r) === 'cover' ? t('moreY.req.takeIt') : t('req.accept'));
    const no = open ? null : h('button', { type: 'button', class: 'btn soft sm', 'data-testid': 'hub-req-decline-' + r.id, onclick: () => lock(no, () => answerRequest(ctx, r, false)) }, icon('x'), t('req.decline'));
    return h('div', { class: 'li mx-todo-row', 'data-testid': 'hub-req-' + r.id, 'data-req': r.id },
      avatar(ctx.name(r.from), ctx.color(r.from), 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'mx-kindrow' }, kindChip(r), termsChip(r)), h('div', { class: 't' }, reqLine(ctx, r)), r.note ? h('div', { class: 'small mx-reason', 'data-testid': 'hub-req-note' }, t('reason.note', { note: cleanNote(r.note) })) : null, h('div', { class: 'btn-row mx-todo-act' }, no, yes)));
  };
  const sharedRow = (x) => {
    const id = x.task.id;
    const b = h('button', { type: 'button', class: 'btn sm', 'data-testid': 'hub-shared-done-' + id, onclick: () => lock(b, async () => {
      const ok = await attempt(ctx, async () => { await ctx.actions.completeShared(id); return true; });
      if (ok) ctx.toast(t('flow.shared.doneToast', { text: x.task.text }), 7000, { action: { label: t('flow.undo'), onClick: () => attempt(ctx, () => ctx.actions.undoShared(id)) } });
      return !!ok;
    }) }, icon('check'), t('flow.shared.done'));
    return h('div', { class: 'li mx-todo-row', 'data-testid': 'hub-shared-' + id },
      h('i', { class: 'mx-ct shared' }, icon('refresh')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, x.task.text), h('div', { class: 'd' }, t('uxb.hub.sharedMine')), h('div', { class: 'btn-row mx-todo-act' }, b)));
  };
  return h('section', { 'data-testid': 'hub-todo' }, h('div', { class: 'eyebrow' }, t('uxb.hub.todo'), chip('bad', String(reqs.length + shared.length))),
    h('div', { class: 'list' }, reqs.map(reqRow), shared.map(sharedRow)));
}

function hub(ctx) {
  const f = (k) => ctx.feature(k);
  const house = ctx.house;
  const needsOpen = Object.values(ctx.state.needs || {}).filter((n) => !n.done).length;
  const inReq = awaitingMe(ctx).length;   // calcolato qui: ctx.badges() non conta le sostituzioni aperte a tutti
  let sharedDue = 0; try { if (f('shared')) sharedDue = sharedList(ctx).filter((x) => x.due).length; } catch { /* ignore */ }
  // una sola voce «Compiti»: a turno + extra delle mansioni (stesso schermo, stesso editor)
  let extraMine = 0; try { if (f('tasks') && ctx.me) extraMine = ownedItems(ctx, weekOfDate(house, ctx.today())).filter((x) => x.owner === ctx.me && x.status !== 'done').length; } catch { /* ignore */ }
  const tasksBadge = sharedDue + extraMine;
  const tasksParts = [sharedDue ? t('tk.hub.turnDue', { n: sharedDue }) : null, extraMine ? t('tk.hub.extraMine', { n: extraMine }) : null].filter(Boolean);
  const tasksDesc = tasksParts.length ? tasksParts.join(' · ') : t('tk.hub.d');
  const badge = (n, cls = 'bad') => (n > 0 ? chip(cls, String(n)) : undefined);
  const row = (o) => liRow(o);
  const group = (title, rows) => (rows.filter(Boolean).length ? h('section', null, title ? h('div', { class: 'eyebrow' }, title) : null, h('div', { class: 'list' }, rows.filter(Boolean))) : null);

  const me = ctx.me ? ctx.meName : null;
  const profile = h('a', { class: 'card mx-me', href: '#/settings/profile', 'data-testid': 'hub-me', 'aria-label': `${t('set.profile')}: ${me || ''}` },
    avatar(me || '?', ctx.me ? ctx.color(ctx.me) : '#888', 'lg'),
    h('div', { class: 'grow' }, h('div', { class: 'mx-me-name' }, me || t('misc.person')), h('div', { class: 'muted small' }, house.name || 'Tidy House'),
      h('div', { class: 'mx-me-chips' }, ctx.isAdmin ? chip('acc', icon('shield'), t('misc.admin')) : null, chip('', icon(ctx.cloud ? 'users' : 'device'), ctx.cloud ? t('moreX.cloud') : t('misc.localOnly')))),
    icon('chevron'));

  // in ordine d'uso: spesa e scambi ogni settimana, regole e registro di rado
  const houseRows = [
    f('needs') ? row({ ic: 'cart', tone: 'o', title: t('more.needs'), desc: needsOpen ? t('moreX.needsOpen', { n: needsOpen }) : t('needs.empty'), end: badge(needsOpen, 'warn'), href: '#/needs' }) : null,
    f('requests') ? row({ ic: 'swap', tone: 'p', title: t('more.requests'), desc: inReq ? t('moreY.hub.awaiting', { n: inReq }) : t('moreY.hub.requests'), end: badge(inReq), href: '#/requests' }) : null,
    (f('shared') || f('tasks')) ? row({ ic: 'list', tone: 'g', title: t('tk.title'), desc: tasksDesc, end: badge(tasksBadge, 'warn'), href: '#/tasks' }) : null,
    f('lastout') ? row({ ic: 'plane', tone: 'g', title: t('more.lastout'), desc: t('moreX.d.lastout'), href: '#/lastout' }) : null,
    f('rules') ? row({ ic: 'book', tone: 'r', title: t('more.rules'), desc: t('moreX.d.rules'), href: '#/rules' }) : null,
    f('activity') ? row({ ic: 'history', tone: '', title: t('more.activity'), desc: t('moreX.d.activity'), href: '#/activity' }) : null,
  ];
  // il codice è visibile a tutti (la rotazione resta all'admin); per l'admin l'invito sta in «Gestione casa»
  const inviteRow = row({ ic: 'qr', tone: 'g', title: t('uxb.adm.invite'), desc: ctx.isAdmin && ctx.code() ? t('uxb.adm.inviteD', { code: ctx.code() }) : t('uxb.adm.inviteD0'), href: '#/settings/invite' });

  return shell(
    h('h1', { class: 'title' }, t('more.title')),
    profile,
    todoBlock(ctx),
    ctx.isAdmin ? adminBlock(ctx, inviteRow) : null,
    group(t('moreX.g.house'), houseRows),
    ctx.isAdmin ? null : group(t('moreX.g.manage'), [inviteRow, row({ ic: 'settings', tone: '', title: t('more.settings'), desc: t('moreX.d.settings'), href: '#/settings' })]),
    group(t('moreX.g.app'), [
      row({ ic: 'device', tone: 'p', title: t('more.guide'), desc: isStandalone() ? t('guide.installed') : t('moreX.d.guide'), href: '#/guide' }),
      row({ ic: 'info', tone: '', title: t('more.about'), desc: t('moreX.d.about'), href: '#/more/about' }),
    ]),
    h('p', { class: 'mx-ver muted small center' }, `${t('app.name')} · ${t('misc.version', { v: ctx.VERSION || '' })}`));
}

/** Apre un foglio di un altro modulo caricandolo solo quando serve. */
const lazySheet = (ctx, load) => async () => { try { await load(); } catch (e) { console.warn(e); ctx.toast(t('error')); } };
/** Settimana su cui lavorano «Cambia turni» e «Recuperi e riposi»: la corrente, altrimenti la prima non chiusa. */
const curRow = (ctx) => { const rows = ctx.calc.out.rows; return rows.find((r) => r.isCur) || rows.find((r) => !r.closed) || null; };

/**
 * «Gestione casa» (solo admin): le azioni dell'admin in un posto solo, in ordine d'uso.
 * Le quattro più frequenti sono riquadri (un tocco apre il foglio giusto), sotto le pagine di gestione.
 */
function adminBlock(ctx, inviteRow) {
  const house = ctx.house; const cur = curRow(ctx);
  const tile = ({ ic, tone = '', title, desc, act, onclick }) => h('button', { type: 'button', class: 'mx-tile', 'data-act': act, onclick },
    h('span', { class: 'ico ' + tone }, icon(ic)), h('span', { class: 'mx-tile-t' }, title), desc ? h('span', { class: 'mx-tile-d' }, desc) : null);
  const tiles = [
    tile({ ic: 'wallet', tone: 'p', title: t('bal.btn'), desc: t('uxb.adm.balD'), act: 'adm-balance', onclick: lazySheet(ctx, async () => (await import('../balance.js')).openBalanceSheet(ctx)) }),
    cur && cur.nm.some(Boolean) ? tile({ ic: 'calendar', tone: '', title: t('uxb.adm.assign'), desc: t('uxb.adm.assignD', { week: fmtWeekRange(cur.sunday, ctx.lang) }), act: 'adm-assign', onclick: lazySheet(ctx, () => openAssignCurrent(ctx)) }) : null,
    tile({ ic: 'check', tone: 'g', title: t('uxb.adm.fix'), desc: t('uxb.adm.fixD'), act: 'adm-fix', onclick: () => openFixPicker(ctx) }),
    ctx.feature('trips') ? tile({ ic: 'plane', tone: 'o', title: t('trips.add'), desc: t('uxb.adm.tripD'), act: 'adm-trip', onclick: lazySheet(ctx, async () => (await import('./trips.js')).openTripSheet(ctx)) }) : null,
  ].filter(Boolean);
  const people = (house.roommates || []).filter((r) => !(r.to && r.to < ctx.today())).map((r) => r.name).join(', ');
  const ai = house.ai && house.ai.enabled
    ? h('button', { type: 'button', class: 'li mx-ai', onclick: lazySheet(ctx, async () => { try { await (await import('../ai-ui.js')).openAiImportSheet(ctx); } catch (e) { console.warn(e); ctx.toast(t('moreX.aiMissing')); } }) },
      h('div', { class: 'ico p' }, icon('edit')), h('div', { class: 'grow' }, h('div', { class: 't' }, t('moreX.ai'))), h('div', { class: 'end' }, icon('chevron')))
    : null;
  return h('section', { 'data-testid': 'hub-admin' },
    h('div', { class: 'eyebrow' }, t('uxb.adm.group')),
    h('div', { class: 'stack tight' },
      h('div', { class: 'mx-tiles', role: 'group', 'aria-label': t('uxb.adm.quick') }, tiles),
      h('div', { class: 'list' },
        liRow({ ic: 'users', tone: 'g', title: t('set.roommates'), desc: people, href: '#/settings/roommates' }),
        inviteRow,
        liRow({ ic: 'download', tone: '', title: t('uxb.adm.data'), desc: t('moreX.d.export'), href: '#/settings/data' }),   // la pagina dati è solo admin
        ai,
        liRow({ ic: 'settings', tone: '', title: t('uxb.adm.all'), desc: t('uxb.adm.allD'), href: '#/settings' }))));
}

/** «Cambia turni» della settimana corrente (foglio di js/weekassign.js). Usata anche dalla ricerca delle impostazioni. */
export async function openAssignCurrent(ctx) {
  const cur = curRow(ctx); if (!cur) { ctx.toast(t('uxb.adm.fixNone')); return null; }
  return (await import('../weekassign.js')).openAssignWeekSheet(ctx, cur.sunday);
}
/** «Correggi chi ha pulito» senza cercare la settimana: settimana corrente e le 4 precedenti, un tocco sul turno apre la correzione. */
export async function openFixPicker(ctx) {
  let mod; let edit;
  try { [mod, edit] = await Promise.all([import('../choresheet.js'), import('../resultedit.js')]); } catch (e) { console.warn(e); ctx.toast(t('error')); return; }
  mod.liveSheet(ctx, { title: () => t('uxb.adm.fixTitle'), build: () => {
    const rows = ctx.calc.out.rows.filter((r) => !r.isFut && r.assigned.some(Boolean)).slice(-5).reverse();
    if (!rows.length) return h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('uxb.adm.fixNone')));
    return h('div', { class: 'stack', 'data-testid': 'fix-picker' }, h('p', { class: 'muted small' }, t('uxb.adm.fixHint')),
      rows.map((row) => h('section', null,
        h('div', { class: 'eyebrow' }, h('span', null, row.isCur ? `${t('uxb.adm.thisWeek')} · ${fmtWeekRange(row.sunday, ctx.lang)}` : fmtWeekRange(row.sunday, ctx.lang))),
        h('div', { class: 'list' }, CHORES.map((c, i) => {
          const who = row.assigned[i]; if (!who) return null;
          const oc = mod.outcomeOf(ctx, row, i);
          return h('button', { type: 'button', class: 'li', 'data-fix': `${row.sunday}:${c}`, onclick: () => edit.openResultEditSheet(ctx, row.sunday, c) },
            h('i', { class: 'mx-ct ' + c }, icon(CHORE_ICON[c])),
            h('div', { class: 'grow' }, h('div', { class: 't' }, `${t('chore.' + c)} · ${ctx.name(who)}`), h('div', { class: 'd' }, oc ? oc.label : t('uxb.adm.notYet'))),
            h('div', { class: 'end' }, oc ? chip(oc.tone + ' mx-oc', icon(oc.ic)) : null, icon('chevron')));
        })))));
  } });
}

// ================================================================ scorte e spesa
// La pagina è costruita UNA volta (campo di testo incluso) e riusata a ogni render dell'app: il campo non viene mai
// ricreato, quindi non perde testo, caret o focus. L'elenco si aggiorna sul posto (riconciliazione per chiave) e anche
// direttamente dagli aggiornamenti dello store, senza aspettare il rerender dell'app (che resta sospeso mentre si scrive).
const NEED_MAX = 80;
let NU = null;

/** Aggiorna `parent` in modo che contenga, nell'ordine, i nodi di `items` ({key, sig, make(isNew)}); riusa i nodi invariati. */
function reconcile(parent, cache, items, animate) {
  const seen = new Set(); let ref = parent.firstChild;
  for (const it of items) {
    seen.add(it.key);
    let c = cache.get(it.key); const isNew = !c;
    if (!c || c.sig !== it.sig) {
      const el = it.make(isNew && animate);
      if (c && c.el.parentNode === parent) { if (ref === c.el) ref = c.el.nextSibling; c.el.remove(); }
      c = { el, sig: it.sig }; cache.set(it.key, c);
    }
    if (c.el === ref) ref = ref.nextSibling; else parent.insertBefore(c.el, ref);
  }
  for (const [k, c] of [...cache]) if (!seen.has(k)) { c.el.remove(); cache.delete(k); }
}

function buildNeeds(ctx, key, draft) {
  const holding = new Map();   // id -> timer: voce appena spuntata, resta ferma il tempo dell'animazione
  const pending = [];          // voci inviate non ancora confermate (ottimistiche)
  const openCache = new Map(), doneCache = new Map();
  let painted = false; let urgent = !!(draft && draft.urgent); let stopped = false; let doneOpen = !!(draft && draft.doneOpen);
  const starterTexts = [1, 2, 3, 4, 5, 6].map((i) => t('moreZ.starter.' + i));

  const inp = h('input', { class: 'input', id: 'mx-need', type: 'text', maxlength: String(NEED_MAX), autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'send', placeholder: t('needs.placeholder'), 'aria-label': t('needs.add') });
  inp.value = (draft && draft.text) || '';
  const counter = h('span', { class: 'mx-count', 'aria-hidden': 'true', hidden: true });
  const updCounter = () => { const n = inp.value.length; counter.hidden = n < NEED_MAX - 20; counter.textContent = t('moreY.need.count', { n }); counter.classList.toggle('max', n >= NEED_MAX); };
  inp.addEventListener('input', () => { updCounter(); paintSugg(); }); updCounter();
  // Invio gestito qui (non solo dall'invio implicito del form: il browser lo ignora se arriva poco dopo il precedente)
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && !e.shiftKey) { e.preventDefault(); add(); } });
  // incolla più righe (es. la lista scritta su WhatsApp): una riga = una voce
  inp.addEventListener('paste', (e) => {
    const items = splitPasted(e.clipboardData && e.clipboardData.getData('text'), NEED_MAX);
    if (!items.length) return;
    e.preventDefault();
    const isUrgent = urgent; setUrgent(false);
    const n = items.filter((x) => send(x, isUrgent)).length;
    paint();
    if (n > 1) ctx.toast(t('moreZ.pasted', { n }));
    if (n) ctx.haptic(ctx.prefs.haptics, 8);
  });
  const urgentSw = toggle(urgent, (v) => { urgent = v; }, t('needs.urgent'));
  const urgentInp = urgentSw.querySelector('input');
  const setUrgent = (v) => { urgent = v; urgentInp.checked = v; };

  const openCount = h('span', { class: 'chip' }); const doneCount = h('span', { class: 'chip' });
  const openList = h('div', { class: 'list' }); const doneList = h('div', { class: 'list mx-done' });
  const emptyCard = h('div', { class: 'card' }, empty('cart', t('needs.empty')));
  const openSec = h('div', null, h('div', { class: 'eyebrow' }, t('needs.open'), openCount), openList);
  // «Comprate»: sezione chiusa di default; «Svuota» non chiede conferma ma offre Annulla
  const doneToggle = h('button', { type: 'button', class: 'mx-donetoggle', 'aria-expanded': 'false', 'aria-label': t('moreZ.boughtToggle'), onclick: () => { doneOpen = !doneOpen; paint(); } }, h('span', null, t('moreZ.bought')), doneCount, icon('chevron'));
  const clearBtn = h('button', { type: 'button', class: 'mx-clear', 'aria-label': t('needs.clearDone'), onclick: () => clearBought() }, t('moreZ.clear'));
  const doneSec = h('div', null, h('div', { class: 'eyebrow mx-donehead' }, doneToggle, clearBtn), doneList);
  const listBox = h('div', { class: 'stack mx-needlist' });
  const triBox = h('div');
  const noteBox = h('div');   // avviso offline
  const suggRow = h('div', { class: 'mx-sugg', role: 'group', 'aria-label': t('moreZ.sugg.label'), hidden: true });
  const starterChips = h('div', { class: 'mx-starter-chips' });
  const starterCard = h('section', { class: 'card stack tight mx-starter' }, h('div', { class: 'mx-lblb' }, t('moreZ.starter.title')), h('div', { class: 'small muted' }, t('moreZ.starter.hint')), starterChips);
  let suggSig = '', starterSig = '', chipHadFocus = false;

  const findOpen = (text) => Object.entries(ctx.state.needs || {}).find(([, n]) => n && !n.done && normNeed(n.text) === normNeed(text));
  const flash = (id) => { const c = openCache.get(id); if (!c) return; c.el.classList.remove('flash'); void c.el.offsetWidth; c.el.classList.add('flash'); setTimeout(() => c.el.classList.remove('flash'), 1100); };

  /** Invia una voce (ottimismo immediato). Ritorna false se è già in lista. Non tocca il campo né il focus. */
  function send(text, isUrgent) {
    const dup = findOpen(text);
    if (dup) { flash(dup[0]); ctx.toast(t('moreY.need.dup', { text })); return false; }
    const p = { tid: uid(), text, urgent: isUrgent, start: ctx.now().toISOString() };
    const req = ctx.actions.addNeed(text, isUrgent);   // lo store si aggiorna subito (ottimistico); la riga provvisoria copre i backend lenti
    pending.push(p);
    req.catch((e) => {
      console.error(e);
      if (e && e.message === 'permission') ctx.toast(t('err.permission'));
      else ctx.toast(t('moreY.need.addFail', { text }), 7000, { action: { label: t('moreZ.retry'), onClick: () => { send(text, isUrgent); paint(); } } });
    }).finally(() => { const i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); paint(); });
    return true;
  }
  function add() {
    const text = inp.value.trim().slice(0, NEED_MAX).trim();
    inp.value = ''; updCounter();                       // svuota subito: un secondo Invio non trova nulla da inviare
    if (!text) { inp.focus(); paintSugg(); return; }
    const isUrgent = urgent; setUrgent(false);
    const ok = send(text, isUrgent);
    paint(); inp.focus();                               // il campo resta attivo: la tastiera non si chiude
    if (ok) ctx.haptic(ctx.prefs.haptics, 8);
  }
  /** Tocco su un suggerimento: aggiunge la voce. Se la tastiera era aperta resta aperta; il testo digitato (filtro) si svuota. */
  function addChip(text) {
    const had = chipHadFocus || document.activeElement === inp; chipHadFocus = false;
    const isUrgent = urgent; setUrgent(false);
    inp.value = ''; updCounter();
    const ok = send(text, isUrgent);
    paint(); if (had) inp.focus();
    if (ok) ctx.haptic(ctx.prefs.haptics, 8);
  }
  const addBtn = h('button', { type: 'submit', class: 'btn', 'aria-label': t('add'), onmousedown: (e) => e.preventDefault() }, icon('plus'), h('span', { class: 'mx-hide-s' }, t('add')));
  const form = h('form', { class: 'card stack tight mx-needform', autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); add(); } },
    h('div', { class: 'field' }, h('label', { for: 'mx-need' }, t('needs.add'), counter), h('div', { class: 'mx-addrow' }, inp, addBtn)),
    suggRow,
    h('div', { class: 'row-between' }, h('div', { class: 'row' }, icon('alert'), h('span', { class: 'mx-lblb' }, t('needs.urgent'))), urgentSw));

  const chipBtn = (text) => h('button', { type: 'button', class: 'chip mx-chip', 'data-sugg': normNeed(text), 'aria-label': t('moreZ.sugg.add', { text }),
    onmousedown: (e) => e.preventDefault(), onpointerdown: () => { chipHadFocus = document.activeElement === inp; }, onclick: () => addChip(text) }, icon('plus'), h('span', null, text));

  /** Voci frequenti sotto il campo; si filtrano mentre si digita. Il DOM cambia solo se cambia l'elenco (nessun sfarfallio). */
  function paintSugg() {
    const q = inp.value;
    const all = frequentNeeds({ needs: ctx.state.needs, log: ctx.state.log, query: '', limit: 1 });
    const list = frequentNeeds({ needs: ctx.state.needs, log: ctx.state.log, query: q, limit: 8 });
    const sig = list.map((x) => x.key).join('|');
    if (sig !== suggSig) { suggSig = sig; suggRow.replaceChildren(...list.map((x) => chipBtn(x.text))); }
    // se esiste uno storico la riga tiene il suo posto (invisibile) mentre il filtro non trova nulla: la pagina non salta
    suggRow.hidden = !all.length;
    suggRow.classList.toggle('none', !list.length);
  }

  function toggleDone(n, makeDone) {
    if (makeDone && !reduceMotion()) {
      clearTimeout(holding.get(n.id));
      holding.set(n.id, setTimeout(() => { holding.delete(n.id); paint(); }, 460));
    } else { clearTimeout(holding.get(n.id)); holding.delete(n.id); }
    ctx.haptic(ctx.prefs.haptics, makeDone ? 10 : 6);
    ctx.actions.setNeedDone(n.id, makeDone).catch((e) => { holding.delete(n.id); console.error(e); ctx.toast(t('error')); paint(); });
    if (makeDone) ctx.toast(t('moreZ.boughtToast', { text: n.text }), 5200, { action: { label: t('moreY.undo'), onClick: () => toggleDone(n, false) } });
    paint();
  }
  async function removeNeed(n) {
    const copy = { text: n.text, urgent: !!n.urgent, by: n.by, at: n.at, done: !!n.done, ...(n.done ? { doneBy: n.doneBy, doneAt: n.doneAt } : {}) };
    const ok = await attempt(ctx, async () => { await ctx.actions.removeNeed(n.id); return true; });
    if (!ok) return;
    ctx.toast(t('moreY.need.removed'), 5200, { action: { label: t('moreY.undo'), onClick: () => attempt(ctx, () => ctx.store.setDoc('needs', n.id, copy, true)) } });
  }
  async function clearBought() {
    const list = Object.entries(ctx.state.needs || {}).filter(([, n]) => n && n.done).map(([id, n]) => ({ id, ...n }));
    if (!list.length) return;
    const ok = await attempt(ctx, async () => { await ctx.actions.clearBought(); return true; });
    if (!ok) return;
    paint();
    ctx.toast(t('moreZ.cleared', { n: list.length }), 6000, { action: { label: t('moreY.undo'), onClick: () => attempt(ctx, () => ctx.actions.restoreNeeds(list)) } });
  }

  // La riga intera è un solo pulsante (≥56px) che segna comprato / rimette in lista; il cestino resta a parte.
  function needRow(n, st, isNew) {
    const done = st === 'done' || st === 'hold';
    const by = ctx.name(n.by);
    const desc = st === 'pending' ? t('moreY.need.saving') : done ? `${t('moreX.boughtBy', { name: ctx.name(n.doneBy) })} · ${whenLabel(ctx, n.doneAt)}` : `${t('needs.addedBy', { name: by })} · ${whenLabel(ctx, n.at)}`;
    return h('div', { class: 'li mx-need' + (done ? ' done' : '') + (st === 'hold' ? ' buying' : '') + (st === 'pending' ? ' pending' : '') + (n.urgent && !done ? ' urgent' : '') + (isNew ? ' mx-in' : ''), 'data-id': n.id || '' },
      h('button', { type: 'button', class: 'mx-needmain', 'aria-pressed': String(done), disabled: st === 'pending', 'aria-label': (done ? t('moreX.undoBought') : t('needs.bought')) + ': ' + n.text, onclick: () => toggleDone(n, !done) },
        h('span', { class: 'checkcircle' + (done ? ' on' : '') }, icon('check')),
        h('span', { class: 'grow' }, h('span', { class: 't' }, n.text, n.urgent && !done ? chip('bad mx-urg', icon('alert'), t('needs.urgent')) : null), h('span', { class: 'd' }, desc))),
      st === 'pending' ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${t('delete')}: ${n.text}`, onclick: () => removeNeed(n) }, icon('trash')));
  }

  function paint() {
    if (stopped) return;
    const today = ctx.today(); const me = ctx.me || 'admin';
    const entries = Object.entries(ctx.state.needs || {}).filter(([, n]) => n && typeof n.text === 'string').map(([id, n]) => ({ id, ...n }));
    const unmatched = pending.filter((p) => !entries.some((n) => !n.done && n.by === me && n.text === p.text && String(n.at || '') >= p.start));
    const open = [
      ...entries.filter((n) => !n.done || holding.has(n.id)).map((n) => ({ n, st: n.done ? 'hold' : 'open' })),
      ...unmatched.map((p) => ({ n: { id: 'p:' + p.tid, text: p.text, urgent: p.urgent, by: me, at: p.start }, st: 'pending' })),
    ].sort((a, b) => (b.n.urgent ? 1 : 0) - (a.n.urgent ? 1 : 0) || String(b.n.at || '').localeCompare(String(a.n.at || '')));
    const done = entries.filter((n) => n.done && !holding.has(n.id)).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
    const sig = (n, st) => JSON.stringify([st, n.text, !!n.urgent, n.by, n.doneBy, n.at, n.doneAt, today, ctx.name(n.by), ctx.name(n.doneBy)]);
    reconcile(openList, openCache, open.map(({ n, st }) => ({ key: n.id, sig: sig(n, st), make: (isNew) => needRow(n, st, isNew) })), painted);
    reconcile(doneList, doneCache, done.map((n) => ({ key: n.id, sig: sig(n, 'done'), make: () => needRow(n, 'done', false) })), false);
    openCount.textContent = String(open.filter((x) => x.st !== 'hold').length);
    doneCount.textContent = String(done.length);
    doneList.hidden = !doneOpen; doneToggle.setAttribute('aria-expanded', String(doneOpen)); doneToggle.classList.toggle('open', doneOpen);
    // storico quasi vuoto (casa nuova): voci di partenza da toccare, escluse quelle già in lista
    const starters = distinctNeeds({ needs: ctx.state.needs, log: ctx.state.log }) < 3 ? starterNeeds(starterTexts, ctx.state.needs) : [];
    const ssig = starters.join('|');
    if (ssig !== starterSig) { starterSig = ssig; starterChips.replaceChildren(...starters.map(chipBtn)); }
    // le sezioni vuote escono dal DOM (non solo nascoste)
    const want = [open.length ? openSec : emptyCard, starters.length ? starterCard : null, done.length ? doneSec : null].filter(Boolean);
    if (want.length !== listBox.children.length || want.some((el, i) => listBox.children[i] !== el)) listBox.replaceChildren(...want);
    const isOff = ctx.status === 'offline';
    if (isOff && !noteBox.firstChild) noteBox.append(h('div', { class: 'note warn', role: 'status' }, icon('info'), t('moreZ.offline')));
    else if (!isOff && noteBox.firstChild) clear(noteBox);
    const tri = ctx.house.links && ctx.house.links.tricount && ctx.house.links.tricount.url;
    const cur = triBox.firstChild;
    if (!tri) { if (cur) clear(triBox); } else if (!cur || cur.getAttribute('href') !== tri) { clear(triBox); triBox.append(h('a', { class: 'btn tonal block', href: tri, target: '_blank', rel: 'noopener' }, icon('tricount'), t('home.tricount'))); }
    paintSugg();
    painted = true;
  }

  const root = h('div', { class: 'mx mx-sub fade-up', 'data-testid': 'needs-page' }, head(t('needs.title')), form, noteBox, listBox, h('div', { class: 'note' }, icon('info'), t('needs.rule')), triBox);
  setTimeout(() => root.classList.remove('fade-up'), 900);
  const off = ctx.store.on(() => { if (root.isConnected) paint(); });
  return {
    key, root, input: inp, paint,
    draft: () => ({ text: inp.value, urgent, doneOpen }),
    destroy() { stopped = true; off(); for (const tm of holding.values()) clearTimeout(tm); },
  };
}

/**
 * Se l'app rimonta la pagina (clear + append) mentre il campo ha il focus, il browser lo toglie. Un MutationObserver
 * (callback in microtask, prima di qualsiasi altro evento di tastiera) rimette subito focus e caret: nessun carattere perso.
 */
function restoreFocus(inp, snap) {
  if (!snap || typeof MutationObserver === 'undefined') return;
  let mo = null; let timer = 0;
  const stop = () => { if (mo) mo.disconnect(); mo = null; clearTimeout(timer); document.removeEventListener('pointerdown', stop, true); };
  const fix = () => {
    if (inp.isConnected && document.activeElement === document.body) {
      try { inp.focus({ preventScroll: true }); inp.setSelectionRange(snap.s, snap.e, snap.d || 'none'); } catch { /* ignore */ }
      stop();
    }
  };
  mo = new MutationObserver(fix); mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', stop, true);   // un tocco altrove = l'utente ha scelto di togliere il focus
  timer = setTimeout(stop, 2500);
}

function needsPage(ctx) {
  if (!ctx.feature('needs')) return offPage(t('needs.title'));
  loadCss('css/more.css');
  const key = `${ctx.houseId}|${ctx.lang}`;
  if (!NU || NU.key !== key) { const d = NU ? NU.draft() : null; if (NU) NU.destroy(); NU = buildNeeds(ctx, key, d); }
  const inp = NU.input;
  const snap = document.activeElement === inp ? { s: inp.selectionStart, e: inp.selectionEnd, d: inp.selectionDirection } : null;
  NU.paint();
  restoreFocus(inp, snap);
  return NU.root;
}

// ================================================================ regole
const customText = (house, lang) => { const x = house && house.rules && house.rules.text && house.rules.text[lang]; return typeof x === 'string' && x.trim() ? x : null; };

/** Modello a sezioni: [{title, blocks:[{p}|{ul:[...]}]}] */
function defaultSections(house) {
  const S = { ...DEFAULT_SETTINGS, ...(house.settings || {}) };
  const sec = (title, ...blocks) => ({ title, blocks });
  const P = (k, p) => ({ p: t(k, p) });
  const UL = (...items) => ({ ul: items });
  return [
    sec(t('rules.basic'), P('rules.basicText')),
    sec(t('rules.home'), UL(t('rules.home4'), t('rules.home3'), t('rules.home2'), t('rules.home1'))),
    sec(t('rules.makeups'), P('rules.makeupsText')),
    sec(t('rules.rests'), P('rules.restsText', { n: S.minRest })),
    sec(t('rules.payback'), P('rules.paybackText')),
    sec(t('rules.absences'), P('rules.threeNights', { n: S.minNights }), P('rules.markAway', { n: S.minNights }), P('rules.noMark')),
    sec(t('rules.results'), UL(t('rules.resDone'), t('rules.resSkipped'), t('rules.resBy'), t('rules.resSkippedBy'), t('rules.resBlank'))),
    sec(t('rules.swaps'), P('rules.swapsText')),
    sec(t('rules.badges'), S.window > 0 ? P('rules.trText', { n: S.window }) : P('moreX.trAll'), P('rules.cdmText'), P('rules.badgesNote')),
    sec(t('rules.moving'), P('rules.movingText')),
    sec(t('rules.daily'), UL(t('rules.daily1'), t('rules.daily2'), t('rules.daily3'), t('rules.daily4'), t('rules.daily5'))),
    sec(t('rules.quality'), UL(t('rules.q1'), t('rules.q2'), t('rules.q3'))),
    sec(t('rules.lastoutRule'), P('rules.lastoutText')),
  ];
}
/** Markdown semplice: "# titolo", elenchi "- voce", paragrafi separati da riga vuota, **grassetto**. */
function parseMarkdown(text) {
  const secs = []; let cur = null; let para = []; let list = null;
  const ensure = () => { if (!cur) { cur = { title: '', blocks: [] }; secs.push(cur); } return cur; };
  const flushP = () => { if (para.length) { ensure().blocks.push({ p: para.join(' ') }); para = []; } };
  const flushL = () => { if (list) { ensure().blocks.push({ ul: list }); list = null; } };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const hd = line.match(/^#{1,4}\s+(.*)$/);
    if (hd) { flushP(); flushL(); cur = { title: hd[1].trim(), blocks: [] }; secs.push(cur); continue; }
    if (!line) { flushP(); flushL(); continue; }
    const li = line.match(/^[-*•]\s+(.*)$/);
    if (li) { flushP(); (list = list || []).push(li[1]); continue; }
    flushL(); para.push(line);
  }
  flushP(); flushL();
  return secs;
}
function toMarkdown(secs) {
  return secs.map((s) => [s.title ? `## ${s.title}` : '', ...s.blocks.map((b) => (b.p ? b.p : b.ul.map((x) => `- ${x}`).join('\n')))].filter(Boolean).join('\n\n')).join('\n\n');
}
function inline(text) {
  const out = []; const re = /\*\*(.+?)\*\*/g; let last = 0; let m;
  while ((m = re.exec(text))) { if (m.index > last) out.push(text.slice(last, m.index)); out.push(h('strong', null, m[1])); last = m.index + m[0].length; }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
/** Contenuto delle regole (casa o ctx). Usa il testo personalizzato della lingua corrente se presente. */
export function renderRulesContent(x) {
  loadCss('css/more.css');
  const house = (x && typeof x.t === 'function' && 'house' in x ? x.house : x) || {};
  const custom = customText(house, getLang());
  const secs = custom ? parseMarkdown(custom) : defaultSections(house);
  return h('div', { class: 'rules-body' }, secs.map((s) => h('section', { class: 'rules-sec' },
    s.title ? h('h3', null, s.title) : null,
    s.blocks.map((b) => (b.p ? h('p', null, inline(b.p)) : h('ul', null, b.ul.map((i) => h('li', null, inline(i)))))))));
}

function openRulesEditor(ctx) {
  const house = ctx.house; const lang = ctx.lang;
  const cur = customText(house, lang);
  const ta = h('textarea', { class: 'input mx-ta', rows: '14', spellcheck: 'true', 'aria-label': t('rules.edit') });
  ta.value = cur != null ? cur : toMarkdown(defaultSections(house));
  const version = (Number(house.rules && house.rules.version) || 1) + 1;
  const s = ctx.sheet({ title: t('rules.edit'), full: true, body: h('div', { class: 'stack mx-form' },
    h('p', { class: 'muted small' }, t('moreX.rulesMd')), ta,
    h('div', { class: 'note warn' }, icon('alert'), t('moreX.rulesBump')),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn soft', onclick: () => s.close() }, t('cancel')),
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        const txt = ta.value.trim(); if (!txt) { ta.focus(); return; }
        const ok = await attempt(ctx, async () => { await ctx.actions.setHouse({ rules: { version, text: { [lang]: txt } } }); return true; });
        if (ok) { ctx.toast(t('saved')); s.close(); }
      } }, icon('check'), t('save')))) });
}

/** Il link «Come funzionano turni e sostituzioni» apre la spiegazione già espansa. */
let howtoOpen = false;   // la schermata si ridisegna a ogni aggiornamento: ricordiamo se la spiegazione è aperta
function takeHowto() { try { if (sessionStorage.getItem('cp:howto') === '1') { sessionStorage.removeItem('cp:howto'); howtoOpen = true; } } catch { /* ignore */ } return howtoOpen; }
function rulesPage(ctx) {
  if (!ctx.feature('rules')) return offPage(t('rules.title'));
  const house = ctx.house; const lang = ctx.lang;
  const custom = customText(house, lang);
  const ver = String((house.rules && house.rules.version) || 1);
  const admin = ctx.isAdmin;
  const kids = [head(t('rules.title'), { right: admin ? h('button', { type: 'button', class: 'btn tonal sm', onclick: () => openRulesEditor(ctx) }, icon('edit'), t('rules.edit')) : null })];
  kids.push(h('div', { class: 'mx-chips' }, custom ? chip('acc', icon('edit'), t('rules.custom')) : null, chip('', t('misc.version', { v: ver }))));
  kids.push(h('details', { class: 'card mx-howto', open: takeHowto(), 'data-testid': 'howto', ontoggle: (e) => { howtoOpen = e.currentTarget.open; } },
    h('summary', null, h('span', { class: 'ico' }, icon('book')), h('span', { class: 'grow' }, h('b', null, t('howto.title')), h('div', { class: 'small muted' }, t('howto.hint'))), icon('chevron')),
    h('div', { class: 'stack' }, [1, 2, 3, 4, 5, 6, 7].map((n) => h('div', { class: 'stack tight' }, h('div', { class: 't', style: { fontWeight: 700 } }, t('howto.h' + n)), h('p', { class: 'muted' }, t('howto.p' + n)))))));
  kids.push(renderRulesContent(ctx));
  if (admin) {
    const today = ctx.today();
    const members = Object.values(ctx.state.members || {});
    const active = (house.roommates || []).filter((r) => !(r.to && r.to < today));
    const ack = (r) => members.some((m) => m.personId === r.id && m.rulesAck && String(m.rulesAck.version) === ver);
    const nOk = active.filter(ack).length;
    kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.rulesAck'), chip(nOk === active.length ? 'ok' : 'warn', t('lastout.progress', { a: nOk, b: active.length }))),
      h('div', { class: 'list' }, active.map((r) => h('div', { class: 'li' }, avatar(r.name, ctx.color(r.id)), h('div', { class: 'grow t' }, r.name),
        ack(r) ? chip('ok', icon('check'), t('moreX.rulesRead')) : chip('warn', icon('clock'), t('moreX.rulesPending')))))));
    if (custom) kids.push(h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
      if (!(await confirmDialog({ title: t('rules.resetDefault'), text: t('moreX.rulesBump'), ok: t('rules.resetDefault'), danger: true }))) return;
      const v = (Number(house.rules && house.rules.version) || 1) + 1;
      await attempt(ctx, () => ctx.actions.setHouse({ rules: { version: v, text: null } }));
    } }, icon('refresh'), t('rules.resetDefault')));
  }
  return shell(...kids);
}

// ================================================================ ultimo che esce
function lastoutItems(house) {
  return Array.isArray(house.lastoutItems) && house.lastoutItems.length
    ? house.lastoutItems.map((i) => ({ id: i.id, text: i.text }))
    : LASTOUT_DEFAULT_KEYS.map((k) => ({ id: k, text: t(k) }));
}
function lastoutView(ctx) {
  const box = h('div', { class: 'stack mx-lastout' });
  function paint() {
    const house = ctx.house; const items = lastoutItems(house); const lo = house.lastOut || {}; const checked = lo.checked || {};
    const n = items.filter((i) => checked[i.id]).length; const total = items.length; const all = total > 0 && n === total;
    clear(box);
    box.append(h('div', { class: 'card mx-progress' + (all ? ' all' : '') },
      all ? h('div', { class: 'mx-allok', role: 'status' }, t('lastout.allDone')) : h('div', { class: 'row-between' }, h('div', { class: 'big-num' }, t('lastout.progress', { a: n, b: total })), icon('plane')),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(n) }, h('i', { style: { width: (total ? Math.round((100 * n) / total) : 0) + '%' } })),
      all && lo.doneBy ? h('p', { class: 'muted small' }, `${t('lastout.completed', { name: personName(ctx, lo.doneBy) })} · ${whenLabel(ctx, lo.doneAt)}`) : h('p', { class: 'muted small' }, t('lastout.hint'))));
    box.append(h('div', { class: 'list' }, items.map((i) => {
      const c = checked[i.id];
      return h('button', { type: 'button', class: 'li mx-lo' + (c ? ' on' : ''), role: 'checkbox', 'aria-checked': String(!!c), onclick: () => toggleItem(i, !!c) },
        h('span', { class: 'checkcircle' + (c ? ' on' : '') }, icon('check')),
        h('div', { class: 'grow' }, h('div', { class: 't' }, i.text), c ? h('div', { class: 'd' }, `${personName(ctx, c.by)} · ${whenLabel(ctx, c.at)}`) : null));
    })));
    if (n > 0 || lo.doneBy) box.append(h('button', { type: 'button', class: 'btn soft block', onclick: async () => {
      if (!all && !(await confirmDialog({ title: t('lastout.reset'), text: t('moreX.lastoutResetConfirm'), ok: t('lastout.reset') }))) return;
      await attempt(ctx, () => ctx.actions.resetLastOut()); paint();
    } }, icon('refresh'), t('lastout.reset')));
    if (lo.doneAt && !all) box.append(h('p', { class: 'muted small center' }, t('lastout.lastBy', { name: personName(ctx, lo.doneBy), when: whenLabel(ctx, lo.doneAt) })));
    if (ctx.isAdmin) box.append(h('button', { type: 'button', class: 'btn ghost block', onclick: () => openLastoutEditor(ctx) }, icon('edit'), t('lastout.edit')));
  }
  async function toggleItem(item, wasOn) {
    const ok = await attempt(ctx, async () => { await ctx.actions.setLastOut(item.id, !wasOn); return true; });
    if (!ok) return;
    ctx.haptic(ctx.prefs.haptics, 8);
    const house = ctx.house; const items = lastoutItems(house); const lo = house.lastOut || {};
    const all = items.length > 0 && items.every((i) => (lo.checked || {})[i.id]);
    if (all && !wasOn && !lo.doneBy) { await attempt(ctx, () => ctx.actions.finishLastOut()); confetti(Math.round(innerWidth / 2), 220); }
    paint();
  }
  paint();
  return { el: box, paint };
}
function lastoutPage(ctx) {
  if (!ctx.feature('lastout')) return offPage(t('lastout.title'));
  return shell(head(t('lastout.title')), lastoutView(ctx).el);
}
export function openLastOutSheet(ctx) {
  loadCss('css/more.css');
  const view = lastoutView(ctx);
  const off = ctx.store.on(() => view.paint());
  return ctx.sheet({ title: t('lastout.title'), body: h('div', { class: 'mx' }, view.el), onClose: off });
}
function openLastoutEditor(ctx) {
  const house = ctx.house;
  const rows = lastoutItems(house).map((i) => ({ ...i }));
  const list = h('div', { class: 'stack tight' });
  // ogni riga ha il proprio nodo, creato una volta sola: spostare o eliminare altre righe non ricrea i campi (niente focus/testo persi)
  const rowEl = (r) => {
    if (r.el) return r.el;
    const input = h('input', { class: 'input', type: 'text', maxlength: '140', value: r.text, oninput: (e) => { r.text = e.target.value; } });
    r.input = input;
    r.el = h('div', { class: 'mx-edrow' }, input,
      h('button', { type: 'button', class: 'icon-btn', 'data-act': 'up', 'aria-label': t('moreX.moveUp'), onclick: () => { const i = rows.indexOf(r); if (i > 0) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(); } } }, icon('up')),
      h('button', { type: 'button', class: 'icon-btn', 'data-act': 'down', 'aria-label': t('moreX.moveDown'), onclick: () => { const i = rows.indexOf(r); if (i < rows.length - 1) { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(); } } }, icon('down')),
      h('button', { type: 'button', class: 'icon-btn', 'data-act': 'del', onclick: () => { const i = rows.indexOf(r); if (i >= 0) { rows.splice(i, 1); r.el.remove(); paint(); } } }, icon('trash')));
    return r.el;
  };
  const paint = () => {
    rows.forEach((r, i) => {
      const el = rowEl(r);
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
      r.input.setAttribute('aria-label', `${t('lastout.addItem')} ${i + 1}`);
      el.querySelector('[data-act=up]').disabled = i === 0;
      el.querySelector('[data-act=down]').disabled = i === rows.length - 1;
      el.querySelector('[data-act=del]').setAttribute('aria-label', `${t('delete')} ${i + 1}`);
    });
  };
  paint();
  const s = ctx.sheet({ title: t('lastout.edit'), full: true, body: h('div', { class: 'stack mx-form' }, list,
    h('button', { type: 'button', class: 'btn tonal block', onclick: () => { const r = { id: uid(), text: '' }; rows.push(r); paint(); r.input.focus(); } }, icon('plus'), t('lastout.addItem')),
    house.lastoutItems ? h('button', { type: 'button', class: 'btn soft block', onclick: async () => {
      await attempt(ctx, () => ctx.actions.setHouse({ lastoutItems: null })); s.close();
    } }, icon('refresh'), t('moreX.lastoutDefault')) : null,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn soft', onclick: () => s.close() }, t('cancel')),
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        const clean = rows.map((r) => ({ id: r.id, text: String(r.text || '').trim() })).filter((r) => r.text);
        if (!clean.length) { ctx.toast(t('moreX.lastoutMin')); return; }
        const ok = await attempt(ctx, async () => { await ctx.actions.setHouse({ lastoutItems: clean }); return true; });
        if (ok) { ctx.toast(t('saved')); s.close(); }
      } }, icon('check'), t('save')))) });
}

// ================================================================ compiti: «Da fare a turno» + «Extra delle mansioni» (#/tasks; #/more/shared è lo stesso schermo)
// Due tipi di dati, una sola pagina e un solo editor (in linea, nella riga):
//  - «Da fare a turno» = house.shared (+ house.sharedState): senza settimana fissa, l'app dice a chi tocca (chi ne ha fatti meno).
//  - «Extra delle mansioni» = house.tasks (+ checklistOff): voci legate a Pavimenti/Bagno/Cucina, le spunta chi ha il turno.
const everyOf = (x) => Math.max(1, parseInt(x.every, 10) || 1);
const everyLabel = (n) => (n === 1 ? t('tasks.week1') : `${t('tasks.every')} ${t('tasks.weeksN', { n })}`);   // «ogni settimana», «Ogni 2 settimane»
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const daysLabel = (n) => (n === 1 ? t('shared.every1') : n % 7 === 0 ? (n === 7 ? t('tasks.week1') : t('tk.everyWk', { n: n / 7 })) : t('shared.everyN', { n }));
const timesLabel = (n) => (n === 1 ? t('shared.times1') : t('shared.times', { n }));
/** Il suggerimento è già presente tra le voci (confronto sul testo in entrambe le lingue). */
const tplHas = (tasks, x) => { const names = [t(x.key), tr('it', x.key), tr('en', x.key)]; return tasks.some((y) => y.chore === x.chore && names.includes(y.text)); };
const sharedList = (ctx) => sharedStatus(ctx.calc.eh, ctx.calc.out, ctx.today());
const sharedHas = (list, key) => { const names = [t(key), tr('it', key), tr('en', key)]; return (list || []).some((x) => names.includes(x.text)); };
const sharedPayload = (list) => list.map((x) => ({ id: x.id, text: x.text, every: x.every, enabled: x.enabled !== false }));
const histOf = (ctx, id) => ((((ctx.house.sharedState || {})[id]) || {}).history) || [];

/** "Questa settimana per Pavimenti: 4 voci (2 settimanali + 2 ogni 2 sett.)" */
function previewText(ctx, chore, cur, weeks) {
  const items = checklistFor(ctx.house, weeks, cur, chore);
  const name = t('chore.' + chore);
  if (!items.length) return t('moreY.t.prev0', { chore: name });
  const weekly = items.filter((x) => x.every === 1).length; const byX = {};
  items.filter((x) => x.every > 1).forEach((x) => { byX[x.every] = (byX[x.every] || 0) + 1; });
  const parts = [weekly ? (weekly === 1 ? t('moreY.t.pw1') : t('moreY.t.pw', { n: weekly })) : null,
    ...Object.keys(byX).map(Number).sort((a, b) => a - b).map((x) => t('moreY.t.px', { n: byX[x], x }))].filter(Boolean).join(' + ');
  let s = t(items.length === 1 ? 'moreY.t.prev1' : 'moreY.t.prev', { chore: name, n: items.length, parts });
  const done = items.filter((x) => x.status === 'done').length;
  if (done) s += ' · ' + t('moreY.t.prevDone', { a: done, b: items.length });
  return s;
}

const TURN_PRESETS = [1, 2, 3, 7, 14];     // giorni
const EXTRA_PRESETS = [1, 2, 4, 8];        // settimane

/** Riquadro aperto (uno solo): { key: 'new' | 'turn:ID' | 'extra:ID', id, d: bozza }. Vive qui perché la pagina viene ridisegnata a ogni cambio dei dati. */
let ED = null;
let focusEd = false;
const openEd = (ctx, o) => { ED = o; focusEd = true; ctx.rerender(); };
const closeEd = (ctx) => { ED = null; ctx.rerender(); };
const newDraft = (where = 'turn') => ({ key: 'new', id: uid(), d: { where, text: '', every: where === 'turn' ? 3 : 1, anchor: '', enabled: true } });

const choiceRow = (opts, value, onpick, label, cls = '') => h('div', { class: 'tk-opts ' + cls, role: 'radiogroup', 'aria-label': label },
  opts.map(([v, text, tid]) => h('button', { type: 'button', class: 'tk-opt', role: 'radio', 'aria-checked': String(v === value), 'data-val': String(v), 'data-testid': tid, onclick: () => onpick(v) }, text)));

/** Aggiunge in un colpo (e permette di annullare). `recs` = [{ turn: bool, rec }]. */
async function addRecords(ctx, recs, toastText) {
  const turn = recs.filter((r) => r.turn).map((r) => r.rec); const extra = recs.filter((r) => !r.turn).map((r) => r.rec);
  const ok = await attempt(ctx, async () => {
    if (turn.length) await ctx.actions.saveShared([...sharedPayload(ctx.house.shared || []), ...turn]);
    if (extra.length) await ctx.actions.setHouse({ tasks: [...(ctx.house.tasks || []), ...extra] });
    return true;
  });
  if (!ok) return false;
  const ids = new Set(recs.map((r) => r.rec.id));
  ctx.toast(toastText, 7000, { action: { label: t('flow.undo'), onClick: () => attempt(ctx, async () => {
    if (turn.length) { await ctx.actions.saveShared(sharedPayload((ctx.house.shared || []).filter((x) => !ids.has(x.id)))); await ctx.actions.setHouse({ sharedState: Object.fromEntries(turn.map((r) => [r.id, null])) }); }
    if (extra.length) await ctx.actions.setHouse({ tasks: (ctx.house.tasks || []).filter((x) => !ids.has(x.id)) });
    ctx.toast(t('shared.undone'));
  }) } });
  return true;
}

/** Elimina con «Annulla» (ripristina anche lo storico di un compito a turno): niente dialogo di conferma. */
async function removeRecord(ctx, kind, id) {
  const turn = kind === 'turn';
  const list = turn ? ctx.house.shared || [] : ctx.house.tasks || [];
  const idx = list.findIndex((x) => x.id === id); if (idx < 0) return false;
  const rec = list[idx]; const snap = turn ? (ctx.house.sharedState || {})[id] : null;
  const ok = await attempt(ctx, async () => {
    if (turn) { await ctx.actions.saveShared(sharedPayload(list.filter((x) => x.id !== id))); await ctx.actions.setHouse({ sharedState: { [id]: null } }); }
    else await ctx.actions.setHouse({ tasks: list.filter((x) => x.id !== id) });
    return true;
  });
  if (!ok) return false;
  ctx.toast(t('tk.deleted', { text: rec.text }), 7000, { action: { label: t('flow.undo'), onClick: () => attempt(ctx, async () => {
    if (turn) {
      const cur = sharedPayload(ctx.house.shared || []); cur.splice(Math.min(idx, cur.length), 0, { id: rec.id, text: rec.text, every: rec.every, enabled: rec.enabled !== false });
      await ctx.actions.saveShared(cur); if (snap) await ctx.actions.setHouse({ sharedState: { [id]: snap } });
    } else { const cur = [...(ctx.house.tasks || [])]; cur.splice(Math.min(idx, cur.length), 0, rec); await ctx.actions.setHouse({ tasks: cur }); }
    ctx.toast(t('shared.undone'));
  }) } });
  return true;
}

/** Modelli rapidi di «A turno» o di una mansione, non ancora presenti. */
const missingTemplates = (ctx, where) => (where === 'turn'
  ? SHARED_TEMPLATES.filter((x) => !sharedHas(ctx.house.shared, x.key)).map((x) => ({ key: x.key, every: x.every, turn: true }))
  : TASK_TEMPLATES.filter((x) => x.chore === where && !tplHas(ctx.house.tasks || [], x)).map((x) => ({ key: x.key, every: x.every, turn: false, chore: x.chore })));
/** Record da un modello. Le voci «ogni X settimane» di «aggiungi tutti» sono sfalsate per non cadere tutte nella stessa settimana. */
function recFromTemplate(ctx, m, stagger = 0) {
  if (m.turn) return { turn: true, rec: { id: uid(), text: t(m.key), every: m.every, enabled: true } };
  const cur = weekOfDate(ctx.house, ctx.today());
  return { turn: false, rec: { id: uid(), chore: m.chore, text: t(m.key), every: m.every, anchor: addDays(cur, 7 * (m.every > 1 ? stagger % m.every : 0)), enabled: true } };
}
const addTemplates = (ctx, list) => {
  let k = 0; const recs = list.map((m) => recFromTemplate(ctx, m, m.every > 1 ? k++ : 0));
  return addRecords(ctx, recs, recs.length === 1 ? t('tk.added', { text: recs[0].rec.text }) : t('tk.addedN', { n: recs.length }));
};

/** Editor unico (nuovo o modifica), in linea. Testo + a turno/mansione + frequenza; il resto è sotto «Altre opzioni». */
function editorCard(ctx) {
  const isNew = ED.key === 'new'; const d = ED.d; const cur = weekOfDate(ctx.house, ctx.today());
  const kindTurn = ED.key.startsWith('turn:') || (isNew && d.where === 'turn');
  if (!d.anchor) d.anchor = cur; d.anchor = weekOfDate(ctx.house, d.anchor);
  let saving = false;
  const root = h('form', { class: 'tk-ed stack tight', 'data-testid': 'tk-editor', onsubmit: (e) => { e.preventDefault(); save(); } });
  const textI = h('input', { class: 'input', id: 'tk-text', type: 'text', autocomplete: 'off', enterkeyhint: 'done', oninput: (e) => { d.text = e.target.value; } });
  textI.value = d.text;
  const isTurn = () => d.where === 'turn';
  const first = ctx.house.startSunday > cur ? ctx.house.startSunday : cur;

  async function save() {
    if (saving) return;
    const text = d.text.trim().slice(0, isTurn() ? 60 : 120); if (!text) { textI.focus(); return; }
    saving = true;
    if (isNew) {
      const rec = isTurn() ? { id: ED.id, text, every: d.every, enabled: true } : { id: ED.id, chore: d.where, text, every: d.every, anchor: d.anchor, enabled: true };
      const ok = await addRecords(ctx, [{ turn: isTurn(), rec }], t('tk.added', { text }));
      saving = false; if (ok) closeEd(ctx);
      return;
    }
    const ok = await attempt(ctx, async () => {
      if (isTurn()) {
        const list = sharedPayload(ctx.house.shared || []); const i = list.findIndex((x) => x.id === ED.id);
        const rec = { id: ED.id, text, every: d.every, enabled: d.enabled }; if (i >= 0) list[i] = rec; else list.push(rec);
        await ctx.actions.saveShared(list);
      } else {
        const list = [...(ctx.house.tasks || [])]; const i = list.findIndex((x) => x.id === ED.id);
        const rec = { id: ED.id, chore: d.where, text, every: d.every, anchor: d.anchor, enabled: d.enabled };
        if (i >= 0) list[i] = { ...list[i], ...rec }; else list.push(rec);
        await ctx.actions.setHouse({ tasks: list });
      }
      return true;
    });
    saving = false; if (ok) { ctx.toast(t('saved')); closeEd(ctx); }
  }

  const syncChips = () => root.querySelectorAll('.tk-freq .tk-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.val === String(d.every))));
  const paint = () => {
    clear(root);
    textI.maxLength = isTurn() ? 60 : 120;
    textI.placeholder = isTurn() ? t('shared.namePh') : t('tk.f.textPhExtra');
    const kids = [];
    kids.push(h('div', { class: 'field' }, h('label', { for: 'tk-text' }, t('tk.f.text')), textI));
    // a turno oppure la mansione: un solo campo decide dove finisce (e quindi chi lo fa)
    if (isNew || !kindTurn) {
      const opts = [...(isNew ? [['turn', t('tk.who.turn'), 'tk-who-turn']] : []), ...CHORES.map((c) => [c, t('chore.' + c), 'tk-who-' + c])];
      kids.push(h('div', { class: 'field' }, h('div', { class: 'lbl' }, t('tk.f.who')),
        choiceRow(opts, d.where, (v) => { const wasTurn = isTurn(); d.where = v; if (wasTurn !== isTurn()) d.every = isTurn() ? 3 : 1; paint(); }, t('tk.f.who')),
        h('p', { class: 'small muted tk-hint', 'data-testid': 'tk-who-hint' }, isTurn() ? t('tk.who.turnD') : t('tk.who.choreD', { chore: t('chore.' + d.where) }))));
    }
    // frequenza: tasti rapidi + contatore per i valori strani
    const turn = isTurn(); const presets = turn ? TURN_PRESETS : EXTRA_PRESETS;
    kids.push(h('div', { class: 'field' }, h('div', { class: 'lbl' }, t('tk.f.every')),
      choiceRow(presets.map((n) => [n, cap(turn ? daysLabel(n) : everyLabel(n)), 'tk-freq-' + n]), d.every, (v) => { d.every = v; paint(); }, t('tk.f.every'), 'tk-freq'),
      h('div', { class: 'row-between tk-fine' }, h('span', { class: 'small muted' }, t('tk.f.other')),
        stepper(d.every, { min: 1, max: turn ? 60 : 26, fmt: (v) => (turn ? (v === 1 ? t('tk.day1') : t('tk.daysN', { n: v })) : (v === 1 ? t('tk.week1') : t('tasks.weeksN', { n: v }))), onchange: (v) => { d.every = v; syncChips(); } }))));
    if (!turn) {
      const opts = new Set([d.anchor]); for (let k = 0; k < 13; k++) opts.add(addDays(first, 7 * k));
      kids.push(h('details', { class: 'tk-more' }, h('summary', null, t('tk.f.more')),
        h('div', { class: 'field' }, h('label', { for: 'tk-anchor' }, t('tasks.firstDue')),
          h('select', { class: 'input', id: 'tk-anchor', onchange: (e) => { d.anchor = e.target.value; } },
            [...opts].sort().map((a) => h('option', { value: a, selected: a === d.anchor }, `${fmtWeekRange(a)}${a === cur ? ' · ' + t('moreX.thisWeek') : ''}`)))),
        h('p', { class: 'small muted' }, t('moreY.t.everyHint'))));
    }
    if (!isNew) kids.push(h('div', { class: 'row-between' }, h('div', { class: 'lbl tk-lbl' }, t('tasks.enabled')), toggle(d.enabled, (v) => {
      d.enabled = v;   // l'interruttore agisce subito (un tocco), come quello della riga; il resto della bozza si salva con «Salva»
      attempt(ctx, () => (isTurn()
        ? ctx.actions.saveShared(sharedPayload((ctx.house.shared || []).map((y) => (y.id === ED.id ? { ...y, enabled: v } : y))))
        : ctx.actions.setHouse({ tasks: (ctx.house.tasks || []).map((y) => (y.id === ED.id ? { ...y, enabled: v } : y)) })));
    }, t('tasks.enabled'))));
    kids.push(h('div', { class: 'btn-row tk-actions' },
      !isNew ? h('button', { type: 'button', class: 'btn danger', 'data-testid': 'tk-del', onclick: async () => { if (await removeRecord(ctx, kindTurn ? 'turn' : 'extra', ED.id)) closeEd(ctx); } }, icon('trash'), t('delete')) : null,
      h('button', { type: 'button', class: 'btn soft', 'data-testid': 'tk-cancel', onclick: () => closeEd(ctx) }, t('cancel')),
      h('button', { type: 'submit', class: 'btn', 'data-testid': 'tk-save' }, icon(isNew ? 'plus' : 'check'), isNew ? t('add') : t('save'))));
    // modelli rapidi: un tocco li aggiunge (con «Annulla»)
    if (isNew) {
      const miss = missingTemplates(ctx, d.where);
      if (miss.length) kids.push(h('div', { class: 'tk-tplbox stack tight', 'data-testid': 'tk-tpls' }, h('div', { class: 'lbl' }, t('tk.tpl')),
        h('div', { class: 'tk-tpls' }, miss.map((m) => h('button', { type: 'button', class: 'tk-tpl', 'data-testid': 'tk-tpl-' + m.key, 'aria-label': t('tk.tpl.add', { text: t(m.key) }), onclick: () => addTemplates(ctx, [m]) },
          icon('plus'), h('span', { class: 'grow' }, t(m.key)), h('span', { class: 'tk-tplf' }, m.turn ? daysLabel(m.every) : everyLabel(m.every))))),
        miss.length > 1 ? h('button', { type: 'button', class: 'btn tonal block', 'data-testid': 'tk-tplall', onclick: () => addTemplates(ctx, miss) }, icon('plus'), t('tk.tpl.all', { n: miss.length })) : null));
    }
    root.append(...kids.filter(Boolean));
  };
  paint();
  if (focusEd) {
    focusEd = false; let tries = 0;
    let touched = false; root.addEventListener('pointerdown', () => { touched = true; });   // se l'utente ha già toccato altro, non rubo il focus
    const go = () => { try { if (touched) return; if (document.contains(textI)) { textI.focus(); root.scrollIntoView({ block: 'nearest' }); } else if (++tries < 6) setTimeout(go, 120); } catch { /* ignore */ } };
    setTimeout(go, 120);
  }
  return root;
}

function tasksPage(ctx, sub = 'tasks') {
  const fT = ctx.feature('shared'); const fX = ctx.feature('tasks');
  if (!fT && !fX) return offPage(t('tk.title'));
  const admin = ctx.isAdmin; const me = ctx.me; const today = ctx.today(); const house = ctx.house;
  const busy = new Set();
  if (ED && ((ED.key === 'new' && !admin) || (ED.key.startsWith('extra:') && (!admin || !fX)) || (ED.key.startsWith('turn:') && !fT))) ED = null;

  // ---------- A turno
  const turnSection = () => {
    const all = house.shared || []; const st = sharedList(ctx); const byId = Object.fromEntries(st.map((x) => [x.task.id, x]));
    // per scadenza: prima i più in ritardo, poi quelli che scadono presto; i disattivati in fondo
    const items = all.map((task) => byId[task.id] || { task, off: true, dueIn: 1e9 }).sort((a, b) => (a.off ? 1 : 0) - (b.off ? 1 : 0) || a.dueIn - b.dueIn || String(a.task.text).localeCompare(String(b.task.text)));
    const complete = async (x, btn) => {
      const id = x.task.id; if (busy.has(id)) return; busy.add(id); btn.disabled = true;
      const ok = await attempt(ctx, async () => { await ctx.actions.completeShared(id); return true; });
      if (!ok) { btn.disabled = false; busy.delete(id); return; }
      ctx.haptic(ctx.prefs.haptics, 14);
      ctx.toast(t('flow.shared.doneToast', { text: x.task.text }), 7000, { action: { label: t('flow.undo'), onClick: async () => { if (await attempt(ctx, async () => { await ctx.actions.undoShared(id); return true; })) ctx.toast(t('shared.undone')); } } });
      setTimeout(() => busy.delete(id), 800);
    };
    const undoLast = (x) => attempt(ctx, async () => { await ctx.actions.undoShared(x.task.id); ctx.toast(t('shared.undone')); });
    const row = (x) => {
      const id = x.task.id; const open = !!ED && ED.key === 'turn:' + id; const hist = histOf(ctx, id); const recent = hist.slice(-5).reverse(); const mine = !!me && x.suggested === me;
      const toggleOpen = () => (open ? closeEd(ctx) : openEd(ctx, admin
        ? { key: 'turn:' + id, id, d: { where: 'turn', text: x.task.text, every: everyOf(x.task), anchor: '', enabled: x.task.enabled !== false } }
        : { key: 'turn:' + id, id, d: {} }));
      let status;
      if (x.off) status = chip('', t('shared.off'));
      else if (x.dueIn < 0) status = chip('bad', icon('alert'), -x.dueIn === 1 ? t('flow.tk.late1') : t('flow.tk.lateN', { n: -x.dueIn }));
      else if (x.dueIn === 0) status = chip('warn', icon('clock'), x.last ? t('flow.tk.today') : t('flow.shared.due'));
      else status = chip('', icon('clock'), x.dueIn === 1 ? t('flow.shared.tomorrow') : t('flow.shared.in', { n: x.dueIn }));
      const lastBy = hist.length ? hist[hist.length - 1] : null;
      const main = h('div', { class: 'grow' },
        h('div', { class: 't' }, x.task.text),
        h('div', { class: 'mx-st' }, status, h('span', { class: 'chip' }, daysLabel(everyOf(x.task)))),
        !x.off && x.suggested ? h('div', { class: 'row mx-turn tk-turn' + (mine ? ' mine' : ''), 'data-testid': 'shared-turn-' + id }, avatar(ctx.name(x.suggested), ctx.color(x.suggested), 'sm'),
          mine ? chip('acc', icon('user'), t('flow.shared.turnMe')) : h('span', { class: 'mx-lblb' }, t('flow.shared.turn', { name: ctx.name(x.suggested) }))) : null,
        h('div', { class: 'd', 'data-testid': 'shared-last-' + id }, lastBy ? t('flow.shared.last', { name: personName(ctx, lastBy.by), when: whenLabel(ctx, lastBy.at) }) : t('flow.shared.never')));
      const lead = h('i', { class: 'mx-ct lg shared' }, icon('refresh'));
      const trailing = x.off
        ? (admin ? toggle(false, (v) => attempt(ctx, () => ctx.actions.saveShared(sharedPayload((ctx.house.shared || []).map((y) => (y.id === id ? { ...y, enabled: v } : y))))), `${t('tasks.enabled')}: ${x.task.text}`) : null)
        : h('button', { type: 'button', class: 'btn sm tk-done' + (x.due ? '' : ' tonal'), 'data-testid': 'shared-done-' + id, 'aria-label': `${t('flow.shared.done')}: ${x.task.text}`, onclick: (e) => complete(x, e.currentTarget) }, icon('check'), t('flow.shared.done'));
      const panel = open ? h('div', { class: 'tk-panel stack tight', 'data-testid': 'tk-panel-' + id },
        admin ? editorCard(ctx) : null,
        recent.length ? h('div', { class: 'mx-recent' }, h('div', { class: 'lbl' }, t('shared.history')),
          h('ul', { class: 'mx-hist' }, recent.map((e, i) => h('li', { class: 'mx-histrow' },
            avatar(personName(ctx, e.by), e.by === 'admin' ? '#888' : ctx.color(e.by), 'sm'),
            h('span', { class: 'grow' }, t('shared.whoLast', { name: personName(ctx, e.by), when: whenLabel(ctx, e.at) })),
            i === 0 && (admin || e.by === me) ? h('button', { type: 'button', class: 'btn sm soft', 'data-testid': 'shared-undo-' + id, onclick: () => undoLast(x) }, icon('refresh'), t('shared.undoLast')) : null)))) : null) : null;
      return h('div', { class: 'tk-item' + (open ? ' open' : '') + (x.due && !x.off ? ' due' : ''), 'data-shared': id, 'data-testid': 'shared-' + id },
        h('div', { class: 'li mx-task tk-row' + (x.off ? ' off' : '') },
          h('button', { type: 'button', class: 'mx-taskmain', 'aria-expanded': String(open), 'aria-label': `${admin ? t('edit') : t('tk.details')}: ${x.task.text}`, 'data-testid': 'shared-open-' + id, onclick: toggleOpen }, lead, main),
          trailing),
        panel);
    };
    // equità: quante volte ciascuno ha fatto questi compiti (ultime 10 volte di ognuno)
    const fair = () => {
      const people = (house.roommates || []).filter((r) => !(r.to && r.to < today));
      const tot = Object.fromEntries(people.map((r) => [r.id, 0]));
      for (const x of st) for (const [pid, n] of Object.entries(x.counts || {})) if (pid in tot) tot[pid] += n;
      const max = Math.max(1, ...Object.values(tot));
      if (!Object.values(tot).some(Boolean)) return null;
      return h('section', { class: 'card stack tight mx-fair', 'data-testid': 'shared-fair' }, h('div', { class: 'mx-ch-name' }, t('shared.fair')), h('p', { class: 'small muted' }, t('shared.fairHint')),
        people.sort((a, b) => tot[b.id] - tot[a.id] || a.name.localeCompare(b.name)).map((r) => h('div', { class: 'mx-fairrow', 'data-person': r.id },
          avatar(r.name, ctx.color(r.id), 'sm'), h('span', { class: 'mx-fairname' }, r.name),
          h('div', { class: 'bar' }, h('i', { style: { width: Math.round((100 * tot[r.id]) / max) + '%', background: ctx.color(r.id) } })),
          h('span', { class: 'small muted mx-fairn' }, timesLabel(tot[r.id])))));
    };
    const due = st.filter((x) => x.due).length;
    const head2 = h('div', { class: 'tk-sechead' },
      h('div', { class: 'grow' }, h('h2', { class: 'tk-h2' }, h('i', { class: 'mx-ct shared' }, icon('refresh')), t('tk.turn.title')), h('p', { class: 'small muted' }, t('tk.turn.hint'))),
      due ? chip('warn', t('shared.dueN', { n: due })) : null);
    const kids = [head2];
    if (items.length) kids.push(h('div', { class: 'list', 'data-testid': 'turn-list' }, items.map(row)));
    else {
      const miss = admin ? missingTemplates(ctx, 'turn') : [];
      kids.push(h('div', { class: 'card stack tight', 'data-testid': 'turn-empty' }, empty('refresh', t('shared.empty'), admin ? t('shared.emptyHint') : t('tk.empty.ask')),
        admin && miss.length ? h('div', { class: 'tk-tpls' }, miss.map((m) => h('button', { type: 'button', class: 'tk-tpl', 'data-testid': 'tk-tpl-' + m.key, 'aria-label': t('tk.tpl.add', { text: t(m.key) }), onclick: () => addTemplates(ctx, [m]) }, icon('plus'), h('span', { class: 'grow' }, t(m.key)), h('span', { class: 'tk-tplf' }, daysLabel(m.every))))) : null,
        admin && miss.length > 1 ? h('button', { type: 'button', class: 'btn tonal block', 'data-testid': 'shared-addall', onclick: () => addTemplates(ctx, miss) }, icon('plus'), t('tk.tpl.all', { n: miss.length })) : null));
    }
    const f = fair(); if (f) kids.push(f);
    if (admin && items.length) kids.push(h('button', { type: 'button', class: 'btn tonal block tk-addhere', 'data-testid': 'tk-add-turn', onclick: () => openEd(ctx, newDraft('turn')) }, icon('plus'), t('tk.add.turn')));
    return h('section', { class: 'stack tk-sec', 'data-testid': 'tk-sec-turn' }, ...kids);
  };

  // ---------- Extra delle mansioni
  const extraSection = () => {
    const tasks = house.tasks || []; const weeks = ctx.state.weeks || {}; const off = house.checklistOff || {};
    const cur = weekOfDate(house, today); const idx = weekIndex(house, cur);
    const owned = ownedItems(ctx, cur); const byId = Object.fromEntries(owned.map((x) => [x.task.id, x]));
    const setTasks = (fn) => attempt(ctx, () => ctx.actions.setHouse({ tasks: fn(ctx.house.tasks || []) }));
    const rank = (task, choreOn) => {
      if (task.enabled === false || !choreOn) return [5, 0];
      const x = byId[task.id];
      if (!x) return [4, nextDueWeek(house, task, idx)];
      return [x.status === 'done' ? 3 : x.reason === 'arrears' || x.status === 'overdue' ? 0 : 1, 0];
    };
    const rowFor = (task, choreOn) => {
      const dis = task.enabled === false; const x = byId[task.id]; const every = everyOf(task); const open = !!ED && ED.key === 'extra:' + task.id;
      let status = null; let desc = everyLabel(every);
      if (dis) status = chip('', t('off'));
      else if (choreOn) {
        if (x) {
          const cls = x.status === 'done' ? 'ok' : x.reason === 'arrears' || x.status === 'overdue' ? 'bad' : 'warn';
          status = chip(cls, icon(x.status === 'done' ? 'check' : x.status === 'due' && x.reason !== 'arrears' ? 'clock' : 'alert'), taskNote(ctx, x));
        } else {
          const k = nextDueWeek(house, task, idx); const sunday = addDays(house.startSunday, 7 * k);
          desc += ` · ${t('tasks.nextDue', { date: fmtWeekRange(sunday) })}`;
          status = chip('', t('tasks.dueIn', { n: Math.max(1, k - idx) }));
        }
      }
      const canT = !!x && !dis && canTick(ctx, cur, x); const isDone = !!x && x.status === 'done';
      const circle = canT
        ? h('button', { type: 'button', class: 'tk-tick', role: 'checkbox', 'aria-checked': String(isDone), 'aria-label': `${task.text}`, 'data-testid': 'task-tick-' + task.id, onclick: async () => { try { await tickTask(ctx, cur, x, !isDone); ctx.haptic(ctx.prefs.haptics, 8); } catch { ctx.toast(t('error')); } } }, h('span', { class: 'checkcircle' + (isDone ? ' on' : '') }, icon('check')))
        : h('span', { class: 'tk-tick', 'aria-hidden': 'true' }, h('span', { class: 'checkcircle' + (isDone ? ' on' : ' idle') }, icon('check')));
      const main = h('div', { class: 'grow' }, h('div', { class: 't' }, task.text), h('div', { class: 'd' }, desc), status ? h('div', { class: 'mx-st' }, status) : null);
      const cls = 'li mx-task tk-row' + (dis || !choreOn ? ' off' : '');
      if (!admin) return h('div', { class: 'tk-item', 'data-task': task.id }, h('div', { class: cls }, circle, main));
      const open2 = () => (open ? closeEd(ctx) : openEd(ctx, { key: 'extra:' + task.id, id: task.id, d: { where: task.chore, text: task.text, every, anchor: task.anchor || cur, enabled: !dis } }));
      return h('div', { class: 'tk-item' + (open ? ' open' : ''), 'data-task': task.id },
        h('div', { class: cls }, circle,
          h('button', { type: 'button', class: 'mx-taskmain', 'aria-expanded': String(open), 'aria-label': `${t('edit')}: ${task.text}`, 'data-testid': 'task-open-' + task.id, onclick: open2 }, main),
          toggle(!dis, (v) => setTasks((list) => list.map((y) => (y.id === task.id ? { ...y, enabled: v } : y))), `${t('tasks.enabled')}: ${task.text}`)),
        open ? h('div', { class: 'tk-panel', 'data-testid': 'tk-panel-' + task.id }, editorCard(ctx)) : null);
    };
    const choreBlock = (c) => {
      const list = tasks.filter((x) => x.chore === c); const choreOn = !off[c];
      const ci = CHORES.indexOf(c); const rowNow = ctx.calc.out.cur >= 0 ? ctx.calc.out.rows[ctx.calc.out.cur] : null; const holder = rowNow ? rowNow.assigned[ci] : '';
      const head3 = h('div', { class: 'card mx-chcard' + (choreOn ? '' : ' off'), 'data-testid': 'chore-' + c },
        h('div', { class: 'row' },
          h('i', { class: 'mx-ct lg ' + c }, icon(CHORE_ICON[c])),
          h('div', { class: 'grow' }, h('div', { class: 'mx-ch-name' }, t('chore.' + c)),
            h('div', { class: 'small muted' }, holder ? t('tk.extra.holder', { name: holder === me ? t('tk.you') : ctx.name(holder) }) : (list.length ? '' : t('tasks.empty')))),
          admin ? h('button', { type: 'button', class: 'icon-btn tk-plus', 'data-testid': 'tk-add-' + c, 'aria-label': t('tk.add.extra', { chore: t('chore.' + c) }), onclick: () => openEd(ctx, newDraft(c)) }, icon('plus')) : null,
          admin
            ? h('label', { class: 'mx-chsw' }, h('span', { class: 'mx-lblb' }, t('moreY.t.active')), toggle(choreOn, (v) => attempt(ctx, () => ctx.actions.setHouse({ checklistOff: { [c]: v ? null : true } })), `${t('moreY.t.active')}: ${t('chore.' + c)}`))
            : chip(choreOn ? 'ok' : '', choreOn ? t('moreY.t.active') : t('moreY.t.choreOff'))),
        choreOn
          ? (list.length ? h('p', { class: 'mx-prev', 'data-testid': 'prev-' + c }, icon('list'), previewText(ctx, c, cur, weeks)) : null)
          : h('p', { class: 'mx-prev off', 'data-testid': 'prev-' + c }, icon('lock'), t('moreY.t.offNote')));
      const sorted = [...list].sort((a, b) => { const ra = rank(a, choreOn); const rb = rank(b, choreOn); return ra[0] - rb[0] || ra[1] - rb[1] || String(a.text).localeCompare(String(b.text)); });
      return h('div', { class: 'stack mx-chsec' }, head3, sorted.length ? h('div', { class: 'list' }, sorted.map((x) => rowFor(x, choreOn))) : null);
    };
    const mine = owned.filter((x) => x.status !== 'done' && x.owner === me).length;
    const left = owned.filter((x) => x.status !== 'done').length;
    const head2 = h('div', { class: 'tk-sechead' },
      h('div', { class: 'grow' }, h('h2', { class: 'tk-h2' }, h('i', { class: 'mx-ct extra' }, icon('list')), t('tk.extra.title')), h('p', { class: 'small muted' }, t('tk.extra.hint'))),
      left ? chip('warn', t('shared.dueN', { n: left })) : null);
    const kids = [head2];
    if (!tasks.length) {
      const miss = admin ? TASK_TEMPLATES.filter((x) => !tplHas(tasks, x)) : [];
      kids.push(h('div', { class: 'card stack tight', 'data-testid': 'extra-empty' }, empty('list', t('tk.extra.empty'), admin ? t('tk.extra.emptyHint') : t('tk.empty.ask')),
        admin && miss.length ? CHORES.map((c) => { const m = miss.filter((x) => x.chore === c); return m.length ? h('button', { type: 'button', class: 'btn tonal block', 'data-testid': 'addall-' + c, onclick: () => addTemplates(ctx, missingTemplates(ctx, c)) }, icon('plus'), t('moreY.t.addAll', { chore: t('chore.' + c), n: m.length })) : null; }) : null));
    }
    for (const c of CHORES) kids.push(choreBlock(c));
    const known = new Set(CHORES); const other = tasks.filter((x) => !known.has(x.chore));
    if (other.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreY.t.otherChore')), h('div', { class: 'list' }, other.map((x) => rowFor(x, true)))));
    return { el: h('section', { class: 'stack tk-sec', 'data-testid': 'tk-sec-extra' }, ...kids), left, mine };
  };

  const secT = fT ? turnSection() : null; const secX = fX ? extraSection() : null;
  const dueT = fT ? sharedList(ctx).filter((x) => x.due).length : 0;
  const go = (el) => () => { if (el) el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); };
  const jump = fT && fX ? h('div', { class: 'tk-jump', 'data-testid': 'tk-jump' },
    h('button', { type: 'button', class: 'btn sm tonal', 'data-testid': 'tk-jump-turn', onclick: go(secT) }, t('tk.jump.turn'), dueT ? chip('warn', String(dueT)) : null),
    h('button', { type: 'button', class: 'btn sm tonal', 'data-testid': 'tk-jump-extra', onclick: go(secX.el) }, t('tk.jump.extra'), secX.left ? chip('warn', String(secX.left)) : null)) : null;
  const kids = [head(t('tk.title'), { right: admin ? h('button', { type: 'button', class: 'btn sm', 'data-testid': 'tk-add', onclick: () => (ED && ED.key === 'new' ? closeEd(ctx) : openEd(ctx, newDraft(fT ? 'turn' : 'floor'))) }, icon('plus'), t('add')) : null })];
  if (ED && ED.key === 'new') kids.push(h('section', { class: 'card tk-newcard', 'data-testid': 'tk-new' }, h('div', { class: 'mx-ch-name' }, t('tk.new')), editorCard(ctx)));
  if (jump) kids.push(jump);
  if (secT) kids.push(secT);
  if (secX) kids.push(secX.el);
  if (!admin) kids.push(h('div', { class: 'note' }, icon('lock'), t('tk.readOnly')));
  return shell(...kids);
}

// ================================================================ scambi, sostituzioni, offerte e avvisi
async function askSwap(ctx) {
  const out = ctx.calc.out; const row = out.cur >= 0 ? out.rows[out.cur] : null;
  const mine = row && ctx.me ? CHORES.filter((c, i) => row.assigned[i] === ctx.me) : [];
  if (!mine.length) { ctx.toast(t('req.noChores')); return; }
  const open = async (chore) => {
    try { const m = await import('../choresheet.js'); m.openSwapRequestSheet(ctx, row.sunday, chore); } catch (e) { console.warn(e); ctx.toast(t('error')); }
  };
  if (mine.length === 1) return open(mine[0]);
  const s = ctx.sheet({ title: t('req.mine'), body: h('div', { class: 'list' }, mine.map((c) => liRow({ ic: CHORE_ICON[c], title: t('chore.' + c), desc: fmtWeekRange(row.sunday), onclick: () => { s.close(); open(c); } }))) });
}
/** Tipo di richiesta: 'swap' (scambio, senza kind), 'cover' (cerco sostituto), 'offer' (mi offro), 'notice' (avviso), 'nudge' (sollecito). */
const reqKind = (r) => (['cover', 'offer', 'notice', 'nudge'].includes(r.kind) ? r.kind : 'swap');
const allRequests = (ctx) => Object.entries(ctx.state.requests || {}).map(([id, r]) => ({ id, ...r })).filter((r) => ['swap', 'cover', 'offer'].includes(reqKind(r)));
/** Chi può rispondere (admin incluso se `adminToo`). Le sostituzioni a "chiunque" le può accettare chiunque non sia il richiedente. */
function canAnswer(ctx, r, adminToo) {
  const me = ctx.me; const k = reqKind(r);
  if (k === 'cover') return !!me && r.from !== me && (!r.to || r.to === me);
  return (!!me && r.to === me) || (!!adminToo && ctx.isAdmin);
}
/** Richiesta in attesa su una settimana ormai chiusa (o passata): non ha più senso accettarla. */
function isStale(ctx, r) {
  if (r.status !== 'pending' || !r.week) return false;
  try { const row = ctx.calc.out.rows.find((x) => x.sunday === r.week); if (row) return !!row.closed; } catch { /* ignore */ }
  return r.week < ctx.today();
}
/** Richieste in attesa di una mia risposta, escluse le scadute. Stessa regola di ctx.badges() in app.js (che però conta anche le scadute: vedi docs/ux/more-settings.md). */
const awaitingMe = (ctx) => (ctx.me ? allRequests(ctx).filter((r) => r.status === 'pending' && !isStale(ctx, r) && canAnswer(ctx, r, false)) : []);
/** Accetta o rifiuta una richiesta (usata dall'hub e dalla pagina Richieste). Ritorna true se riuscita. */
async function answerRequest(ctx, r, ok) {
  const k = reqKind(r); const me = ctx.me;
  return (await attempt(ctx, async () => {
    if (k === 'swap') { await ctx.actions.answerSwap(r.id, ok); ctx.toast(ok ? t('req.accepted') : t('req.declined')); }
    else { await ctx.actions.answerCover(r.id, ok); ctx.toast(ok ? t('moreY.req.agreedToast', { name: ctx.name(k === 'cover' ? me : r.from), chore: choreLow(r.chore) }) : t('req.declined')); }
    return true;
  })) === true;
}
const wkLabel = (r) => (r.week ? fmtWeekRange(r.week) : '');
const choreLow = (c) => (c ? t('chore.' + c).toLowerCase() : '');

function reqLine(ctx, r) {
  const me = ctx.me; const k = reqKind(r); const week = wkLabel(r); const chore = choreLow(r.chore);
  if (k === 'cover') {
    if (r.from === me) return r.to ? t('moreY.req.coverMineTo', { to: ctx.name(r.to), chore, week }) : t('moreY.req.coverMine', { chore, week });
    if (r.to === me) return t('moreY.req.coverForMe', { name: ctx.name(r.from), chore, week });
    return r.to ? t('moreY.req.coverTo', { name: ctx.name(r.from), to: ctx.name(r.to), chore, week }) : t('moreY.req.cover', { name: ctx.name(r.from), chore, week });
  }
  if (k === 'offer') {
    if (r.from === me) return t('moreY.req.offerMine', { to: ctx.name(r.to), chore, week });
    if (r.to === me) return t('moreY.req.offerForMe', { name: ctx.name(r.from), chore, week });
    return t('moreY.req.offer', { name: ctx.name(r.from), to: ctx.name(r.to), chore, week });
  }
  const a = choreLow(r.fromChore), b = choreLow(r.toChore);
  if (r.to === me) return t('req.incoming', { name: ctx.name(r.from), theirs: b, mine: a, week });
  if (r.from === me) return t('moreX.outgoing', { to: ctx.name(r.to), mine: a, theirs: b, week });
  return t('moreX.reqLine', { from: ctx.name(r.from), to: ctx.name(r.to), a: t('chore.' + r.fromChore), b: t('chore.' + r.toChore), week });
}
/** Testo neutro (stessa frase per tutti): usato nelle etichette di accessibilità. */
const reqPlain = (ctx, r) => (reqKind(r) === 'swap'
  ? t('moreX.reqLine', { from: ctx.name(r.from), to: ctx.name(r.to), a: t('chore.' + r.fromChore), b: t('chore.' + r.toChore), week: wkLabel(r) })
  : reqLine(ctx, r));
const statusChip = (r) => (r.status === 'accepted' ? chip('ok', icon('check'), t('moreY.st.agreed')) : r.status === 'declined' ? chip('bad', icon('x'), t('moreY.st.declined')) : chip('warn', icon('clock'), t('req.pending')));
const termsOf = (r) => (reqKind(r) === 'swap' ? null : 'repay');   // il «regalo» non esiste più: anche le vecchie richieste valgono «con recupero»
const termsChip = (r) => { const k = termsOf(r); return k ? chip('warn mx-terms', icon('refresh'), t('moreY.terms.repay')) : null; };
/** Una riga di spiegazione + (prima di rispondere) le conseguenze per chi fa il turno e per chi lo chiede. */
function termsBlock(ctx, r, { consequences = false } = {}) {
  const k = termsOf(r); if (!k) return null;
  const doer = ctx.name(reqKind(r) === 'cover' ? (r.status === 'accepted' && r.by ? r.by : ctx.me) : r.from);
  const requester = ctx.name(reqKind(r) === 'cover' ? r.from : r.to);
  return h('div', { class: 'mx-termsbox', 'data-testid': 'terms-' + r.id },
    h('p', { class: 'small muted mx-termsline' }, t('moreY.terms.' + k + '.line')),
    consequences ? h('div', { class: 'note mx-conseq' }, icon('info'), h('div', { class: 'grow' }, h('div', { class: 'lbl mx-lblb' }, t('moreY.terms.ifYes')),
      h('ul', { class: 'mx-conseqlist' }, h('li', null, t('moreY.terms.' + k + '.doer', { doer })), h('li', null, t('moreY.terms.' + k + '.requester', { requester }))))) : null);
}
const kindChip = (r) => chip('mx-kind ' + reqKind(r), t('moreY.req.kind.' + reqKind(r)));
function noticeText(ctx, r) {
  const o = { name: personName(ctx, r.from), chore: choreLow(r.chore), week: wkLabel(r) };
  if (r.code === 'volunteer') return t('moreY.req.noticeVolunteer', o);
  if (r.code === 'assigned') return t('moreY.req.noticeAssigned', o);
  return t('moreY.req.noticeGeneric', o);
}

function requestsPage(ctx) {
  if (!ctx.feature('requests')) return offPage(t('req.title'));
  const me = ctx.me; const admin = ctx.isAdmin;
  const all = allRequests(ctx);
  const pendingAll = all.filter((r) => r.status === 'pending');
  const pending = pendingAll.filter((r) => !isStale(ctx, r));
  // scadute: le vede e le toglie chi le ha create o è coinvolto (l'admin tutte)
  const stale = pendingAll.filter((r) => isStale(ctx, r) && (admin || r.from === me || r.to === me));
  const incoming = pending.filter((r) => canAnswer(ctx, r, false));
  const sent = pending.filter((r) => r.from === me);
  const others = admin ? pending.filter((r) => r.from !== me && !incoming.includes(r)) : [];
  const history = all.filter((r) => r.status !== 'pending' && (admin || r.from === me || r.to === me || r.by === me))
    .sort((a, b) => String(b.answeredAt || b.at || '').localeCompare(String(a.answeredAt || a.at || ''))).slice(0, 20);
  const notices = Object.entries(ctx.state.requests || {}).map(([id, r]) => ({ id, ...r })).filter((r) => r.kind === 'notice' && me && r.to === me)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 10);

  const lock = (btn, fn) => { btn.disabled = true; Promise.resolve(fn()).then((ok) => { if (ok === false) btn.disabled = false; }, () => { btn.disabled = false; }); };
  const answer = (r, ok) => answerRequest(ctx, r, ok);
  const cancel = async (r) => attempt(ctx, async () => {
    if (reqKind(r) === 'swap') await ctx.actions.cancelSwap(r.id);
    else { if (!(admin || r.from === me)) throw new Error('permission'); await ctx.store.delDoc('requests', r.id); }
    ctx.toast(t('moreY.req.cancelled')); return true;
  }).then((v) => v === true);
  const btnAccept = (r, label) => { const b = h('button', { type: 'button', class: 'btn', 'data-testid': 'req-accept-' + r.id, onclick: () => lock(b, () => answer(r, true)) }, icon('check'), label || t('req.accept')); return b; };
  const btnDecline = (r) => { const b = h('button', { type: 'button', class: 'btn soft', 'data-testid': 'req-decline-' + r.id, onclick: () => lock(b, () => answer(r, false)) }, icon('x'), t('req.decline')); return b; };
  const btnCancel = (r) => { const b = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${t('req.cancel')}: ${reqPlain(ctx, r)}`, title: t('req.cancel'), 'data-testid': 'req-cancel-' + r.id, onclick: () => lock(b, () => cancel(r)) }, icon('x')); return b; };

  const incomingCard = (r) => {
    const k = reqKind(r); const open = k === 'cover' && !r.to;
    return h('div', { class: 'card stack tight mx-req mx-reqcard', 'data-testid': 'req-' + r.id },
      h('div', { class: 'row' }, avatar(ctx.name(r.from), ctx.color(r.from)), h('div', { class: 'grow' },
        h('div', { class: 'mx-kindrow' }, kindChip(r), termsChip(r), open ? chip('', icon('users'), t('moreY.req.openForAll')) : null),
        h('p', { class: 'mx-rt' }, reqLine(ctx, r)), r.note ? h('div', { class: 'small mx-reason', 'data-testid': 'req-note' }, t('reason.note', { note: cleanNote(r.note) })) : null, h('div', { class: 'small muted' }, whenLabel(ctx, r.at)))),
      termsBlock(ctx, r, { consequences: true }),
      h('div', { class: 'btn-row' }, open ? null : btnDecline(r), btnAccept(r, k === 'cover' ? t('moreY.req.takeIt') : null)));
  };
  const listRow = (r, { cancelable, answerable, hist }) => h('div', { class: 'li mx-req' + (answerable ? ' adm' : ''), 'data-testid': 'req-' + r.id },
    avatar(ctx.name(r.from), ctx.color(r.from), 'sm'),
    h('div', { class: 'grow' }, h('div', { class: 'mx-kindrow' }, kindChip(r), termsChip(r), statusChip(r)), h('div', { class: 't' }, hist || answerable ? reqPlain(ctx, r) : reqLine(ctx, r)), r.note ? h('div', { class: 'small mx-reason', 'data-testid': 'req-note' }, t('reason.note', { note: cleanNote(r.note) })) : null, termsBlock(ctx, r, { consequences: answerable }),
      h('div', { class: 'd' }, hist ? [whenLabel(ctx, r.answeredAt || r.at), r.status === 'accepted' && r.by ? ` · ${t('moreY.req.will', { name: ctx.name(r.by) })}` : ''] : whenLabel(ctx, r.at))),
    cancelable ? btnCancel(r) : null,
    answerable ? h('div', { class: 'btn-row mx-req-actions' }, btnDecline(r), btnAccept(r)) : null);

  /** Toglie le scadute con un tap; Annulla le rimette. */
  async function clearStale(btn) {
    btn.disabled = true;
    const copies = stale.map((r) => { const { id, ...rest } = r; return { id, rest }; });
    const ok = await attempt(ctx, async () => { for (const r of stale) { if (reqKind(r) === 'swap') await ctx.actions.cancelSwap(r.id); else await ctx.store.delDoc('requests', r.id); } return true; });
    if (!ok) { btn.disabled = false; return; }
    ctx.toast(t('uxb.req.stale.cleared', { n: copies.length }), 6000, { action: { label: t('moreY.undo'), onClick: () => attempt(ctx, async () => { for (const c of copies) await ctx.store.setDoc('requests', c.id, c.rest, true); }) } });
  }
  const kids = [head(t('req.title'), { right: me ? h('button', { type: 'button', class: 'btn sm', onclick: () => askSwap(ctx) }, icon('plus'), t('req.new')) : null })];
  if (incoming.length) kids.push(h('section', { class: 'stack tight', 'data-testid': 'req-incoming' }, h('div', { class: 'eyebrow' }, t('moreX.reqForMe'), chip('bad', String(incoming.length))), incoming.map(incomingCard)));
  if (sent.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.reqSent')), h('div', { class: 'list' }, sent.map((r) => listRow(r, { cancelable: true })))));
  if (others.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.reqAll')),
    h('div', { class: 'list' }, others.map((r) => listRow(r, { cancelable: true, answerable: reqKind(r) !== 'cover' && canAnswer(ctx, r, true) })))));
  if (notices.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreY.req.notices')),
    h('div', { class: 'list', 'data-testid': 'notices' }, notices.map((r) => h('div', { class: 'li mx-req mx-notice' }, h('div', { class: 'ico o' }, icon('bell')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, noticeText(ctx, r)), h('div', { class: 'd' }, `${whenLabel(ctx, r.at)} · ${t('moreY.req.noticeInfo')}`)))))));
  if (stale.length) kids.push(h('section', { 'data-testid': 'req-stale' }, h('div', { class: 'eyebrow' }, t('uxb.req.stale.title'), chip('', String(stale.length))),
    h('p', { class: 'small muted mx-stalehint' }, t('uxb.req.stale.hint')),
    h('div', { class: 'list' }, stale.map((r) => h('div', { class: 'li mx-req mx-stale', 'data-testid': 'req-' + r.id }, avatar(ctx.name(r.from), ctx.color(r.from), 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'mx-kindrow' }, kindChip(r), chip('', icon('clock'), t('uxb.req.stale.chip'))), h('div', { class: 't' }, reqPlain(ctx, r)))))),
    h('button', { type: 'button', class: 'btn soft block mx-stalebtn', 'data-testid': 'req-stale-clear', onclick: (e) => clearStale(e.currentTarget) }, icon('trash'), t('uxb.req.stale.clear'))));
  if (!incoming.length && !sent.length && !others.length && !notices.length && !stale.length) kids.push(h('div', { class: 'card' }, empty('swap', t('req.empty'), t('moreY.req.emptyHint'))));
  if (history.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.reqHistory')),
    h('div', { class: 'list', 'data-testid': 'req-history' }, history.map((r) => listRow(r, { hist: true })))));
  return shell(...kids);
}

// ================================================================ registro attività
let actLimit = 60;
// tipo di log -> [icona, tono]. Le frasi sono `act.<tipo>` (nucleo) oppure `moreY.act.<tipo>` per i tipi aggiunti dopo.
const ACT_ICON = { done: ['check', 'g'], cover: ['swap', 'p'], skipped: ['x', 'r'], reset: ['refresh', ''], away: ['plane', 'o'], back: ['home', 'g'], trip: ['plane', 'o'], plan: ['calendar', ''], swap: ['swap', 'p'], need: ['cart', 'o'], task: ['list', 'g'], settings: ['settings', ''], roommates: ['users', ''], import: ['upload', ''],
  incomplete: ['alert', 'o'], volunteer: ['sparkles', 'g'], delay: ['clock', 'o'], agreed: ['check', 'p'], shared: ['refresh', 'g'], assign: ['calendar', 'p'], makeup: ['refresh', 'p'], adjust: ['refresh', 'p'] };
const ACT_NEW = new Set(['incomplete', 'volunteer', 'delay', 'agreed', 'shared']);
const agreedKey = (p) => 'moreY.act.agreed' + (p.terms ? 'Repay' : '');
function actText(ctx, e) {
  const p = e.p || {};
  if (!ACT_ICON[e.type]) return t('act.generic', { name: personName(ctx, e.by), text: p.text || e.type || '' });
  if (e.type === 'makeup') return t('uxb.act.makeup', { chore: p.chore ? t('chore.' + p.chore).toLowerCase() : '', who: p.who ? ctx.name(p.who) : '', day: p.day ? dowLong(p.day, ctx.lang) : '' });
  if (e.type === 'adjust') {
    const text = Object.entries(p.d || {}).map(([k, v]) => `${k === 'credit' ? t('bal.rest') : t('chore.' + k)} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join(', ');
    return t('bal.act', { name: p.who ? ctx.name(p.who) : '', text });
  }
  if (e.type === 'assign') return t(Number(p.n) > 0 ? 'uxb.act.assign' : 'uxb.act.assign0', { name: personName(ctx, e.by), week: p.week ? fmtWeekRange(p.week, ctx.lang) : '' });
  const key = e.type === 'agreed' ? agreedKey(p) : ACT_NEW.has(e.type) ? 'moreY.act.' + e.type + (e.type === 'incomplete' && Number(p.n) === 1 ? '1' : '') : 'act.' + e.type;
  return t(key, {
    name: personName(ctx, e.by), chore: p.chore ? t('chore.' + p.chore).toLowerCase() : '', who: p.who ? ctx.name(p.who) : '',
    day: p.day ? `${dowLong(p.day, ctx.lang)} ${fmtDate(p.day, ctx.lang)}` : '', text: p.text || '', n: p.n ?? '',
  });
}
function activityPage(ctx) {
  if (!ctx.feature('activity')) return offPage(t('act.title'));
  const log = Object.entries(ctx.state.log || {}).map(([id, e]) => ({ id, ...e })).filter((e) => parseAt(e.at)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const shown = log.slice(0, actLimit);
  const kids = [head(t('act.title'))];
  if (!log.length) kids.push(h('div', { class: 'card' }, empty('history', t('act.empty'))));
  const groups = [];
  for (const e of shown) { const day = localDay(parseAt(e.at)); const g = groups[groups.length - 1]; if (g && g.day === day) g.items.push(e); else groups.push({ day, items: [e] }); }
  for (const g of groups) {
    kids.push(h('section', null, h('div', { class: 'eyebrow' }, dayLabel(ctx, g.day)),
      h('div', { class: 'list' }, g.items.map((e) => { const [ic, tone] = ACT_ICON[e.type] || ['dot', '']; return liRow({ ic, tone, title: actText(ctx, e), end: h('span', { class: 'mx-time' }, hhmm(parseAt(e.at))) }); }))));
  }
  if (log.length > actLimit) kids.push(h('button', { type: 'button', class: 'btn soft block', onclick: () => { actLimit += 60; ctx.rerender(); } }, t('moreX.showMore')));
  return shell(...kids);
}

// ================================================================ registro ingressi (usato da Impostazioni > Accessi)
const DEV_IC = { device: 'device', tablet: 'tablet', desktop: 'desktop' };
/** Ultimi 100 ingressi: persona, dispositivo, orario e schermata, raggruppati per giorno. */
export function renderViewsLog(ctx) {
  loadCss('css/more.css');
  const members = ctx.state.members || {};
  const views = Object.entries(ctx.state.views || {}).map(([id, v]) => ({ id, ...v })).filter((v) => parseAt(v.at))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100);
  const box = h('div', { class: 'mxa-log stack tight', 'data-testid': 'views' });
  if (!views.length) { box.append(h('div', { class: 'list' }, h('div', { class: 'li muted', 'data-testid': 'views-empty' }, t('acc.noViews')))); return box; }
  const groups = [];
  for (const v of views) { const day = localDay(parseAt(v.at)); const g = groups[groups.length - 1]; if (g && g.day === day) g.items.push(v); else groups.push({ day, items: [v] }); }
  const screenLabel = (s) => { const k = 'acc.screen.' + s; const x = t(k); return x === k ? String(s || '') : x; };
  const row = (v) => {
    const m = members[v.device]; const d = (m && m.device) || {};
    const label = m ? (m.name || d.label || '') : '';
    const dev = label ? (d.label && d.label !== label ? `${label} · ${d.label}` : label) : t('moreY.acc.devUnknown');
    const name = v.personId ? ctx.name(v.personId) : t('misc.person');
    return h('div', { class: 'li mxa-row', 'data-testid': 'view-' + v.id },
      avatar(name, v.personId ? ctx.color(v.personId) : '#888', 'sm'),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, name),
        h('div', { class: 'mxa-meta' }, chip('mxa-scr', screenLabel(v.screen)), h('span', { class: 'mxa-dev' }, icon(DEV_IC[d.kind] || 'device'), h('span', null, dev)))),
      h('span', { class: 'mx-time mxa-time' }, hhmm(parseAt(v.at))));
  };
  for (const g of groups) box.append(h('section', { class: 'mxa-day' },
    h('div', { class: 'eyebrow' }, h('span', null, dayLabel(ctx, g.day)), chip('', g.items.length === 1 ? t('moreY.acc.entries1') : t('moreY.acc.entries', { n: g.items.length }))),
    h('div', { class: 'list' }, g.items.map(row))));
  return box;
}

// ================================================================ guida installazione
let deferredPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; window.__bip = e; });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; window.__bip = null; });
}
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
function platform() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}
function guidePage(ctx) {
  const here = platform(); const installed = isStandalone();
  const prompt = deferredPrompt || window.__bip || null;
  const section = (key, ic, steps, extra) => {
    const open = key === here;
    return h('details', { class: 'card mx-guide', open }, h('summary', null, h('span', { class: 'ico' }, icon(ic)), h('span', { class: 'grow' }, t('guide.' + key)), key === here ? chip('acc', t('moreX.thisDevice')) : null, icon('chevdown')),
      h('ol', { class: 'mx-steps' }, steps.map((s) => h('li', null, t(s)))), extra || null);
  };
  const kids = [head(t('guide.title'))];
  if (installed) kids.push(h('div', { class: 'note ok' }, icon('check'), t('guide.installed')));
  else if (prompt) kids.push(h('div', { class: 'card tonal stack tight' }, h('div', { class: 'row' }, icon('download'), h('div', { class: 'grow' }, t('moreX.installNow'))),
    h('button', { type: 'button', class: 'btn block', onclick: async () => {
      try { prompt.prompt(); await prompt.userChoice; } catch (e) { console.warn(e); }
      deferredPrompt = null; window.__bip = null; ctx.rerender();
    } }, icon('download'), t('guide.install'))));
  const order = [here, ...['ios', 'android', 'desktop'].filter((k) => k !== here)];
  const defs = {
    ios: () => section('ios', 'device', ['guide.ios1', 'guide.ios2', 'guide.ios3', 'guide.ios4'], h('div', { class: 'note warn' }, icon('bell'), t('moreX.iosNotif'))),
    android: () => section('android', 'device', ['guide.android1', 'guide.android2', 'guide.android3']),
    desktop: () => section('desktop', 'desktop', ['guide.desktop1', 'guide.desktop2']),
  };
  order.forEach((k) => kids.push(defs[k]()));
  kids.push(h('p', { class: 'muted small center' }, t('moreX.guideNotif')));
  return shell(...kids);
}

// ================================================================ informazioni
function extLink(ic, title, desc, href) {
  return h('a', { class: 'li', href, target: '_blank', rel: 'noopener' }, h('div', { class: 'ico' }, icon(ic)),
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)), h('div', { class: 'end' }, icon('chevron')));
}
function aboutPage(ctx) {
  const house = ctx.house;
  return shell(head(t('more.about')),
    h('section', { class: 'card mx-about center stack' }, h('div', { class: 'logo mx-logo' }, icon('broom')), h('h2', null, t('app.name')), h('p', { class: 'muted' }, t('moreX.aboutText')),
      chip('', t('misc.version', { v: ctx.VERSION || '' }))),
    h('div', { class: 'list' },
      liRow({ ic: 'home2', title: house.name || t('app.name'), desc: ctx.cloudStatusLabel ? ctx.cloudStatusLabel() : '' }),
      extLink('link', t('moreX.repo'), REPO.replace('https://', ''), REPO),
      extLink('book', t('moreX.readme'), t('moreX.readmeDesc'), REPO + '#readme')),
    h('p', { class: 'muted small center' }, t('moreX.credits')));
}

// ================================================================ entry point
export async function render(ctx, params = {}) {
  loadCss('css/more.css');
  const sub = (params && params.sub) || '';
  if (sub !== 'tasks' && sub !== 'shared') ED = null;   // il riquadro aperto in «Compiti» non resta aperto altrove
  switch (sub) {
    case 'needs': return needsPage(ctx);
    case 'rules': return rulesPage(ctx);
    case 'lastout': return lastoutPage(ctx);
    case 'tasks': case 'shared': return tasksPage(ctx, sub);
    case 'requests': return requestsPage(ctx);
    case 'activity': return activityPage(ctx);
    case 'guide': return guidePage(ctx);
    case 'about': return aboutPage(ctx);
    default: return hub(ctx);
  }
}
