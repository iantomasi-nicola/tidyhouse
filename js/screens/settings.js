// Impostazioni: indice a liste raggruppate + sottopagine (#/settings/<sezione>).
// Personali (tutti): profile, appearance, home, notifications. Amministrazione (solo admin): house, rules, roommates,
// features, links, notif-house, invite*, access, data, ai, security. (*invite: codice/link visibili a tutti, rotazione solo admin)
import { h, icon, loadCss, avatar, stepper, seg, liRow, copyText, download, confirmDialog, deviceInfo } from '../ui.js';
import { registerStrings as __reg } from '../i18n.js';
import { it as __flowIt, en as __flowEn } from '../strings/flow.js';
__reg(__flowIt, __flowEn);   // widget.shared & co. servono anche aprendo direttamente le impostazioni
import { t, registerStrings, fmtDate, fmtWeekRange, LANGS } from '../i18n.js';
import { hasKick, kickNow, repoOf } from '../kick.js';
import { DEFAULT_TASK_PENALTY, DEFAULT_FEATURES, NOTIF_TYPES, HOME_WIDGETS, DEFAULT_HOME, PALETTE, planNotifications, notifCfg, effortOf, localParts, uid, buildStats, historyRows, toCsv, validateHouse } from '../extras.js';
import { validateRoommates, addDays, DEFAULT_SETTINGS, CHORES } from '../engine.js';
import { exportBackup, verifyPin, hashPin, newSalt } from '../actions.js';
import { encryptBackup, decryptBackup } from '../backupcrypto.js';
import * as push from '../push.js';
import { openAiImportSheet, readAiConfig, writeAiConfig } from '../ai-ui.js';
import { PROVIDERS, callAi } from '../ai.js';
import { it, en } from '../strings/set.js';
import { it as itB, en as enB } from '../strings/uxb.js';
import { renderViewsLog } from './more.js';   // registro ingressi (raggruppato per giorno)
registerStrings(it, en);
registerStrings(itB, enB);
loadCss('css/settings.css');

const README = 'https://github.com/iantomasi-nicola/tidyhouse#readme';

// ============================================================================
// Stato effimero (sopravvive ai rerender; si azzera cambiando sezione)
// ============================================================================
let curSub = null;
const S = { rm: null, rmBase: '', rmColor: null, fresh: null, rot: null, homeBusy: false, open: {}, err: {} };
function resetDrafts() { S.rm = null; S.rmBase = ''; S.rmColor = null; S.fresh = null; S.rot = null; S.open = {}; S.err = {}; }
let searchQ = '';   // testo cercato nell'indice: sopravvive ai rerender
/** Messaggio d'errore di un modulo: ricordato in S.err, così un rerender (dati in arrivo da un altro telefono) non lo cancella. */
function errLine(key, attrs = {}) {
  const el = h('div', { class: 'small', style: { color: 'var(--bad)' }, 'aria-live': 'polite', ...attrs });
  el.textContent = S.err[key] || '';
  return [el, (m) => { S.err[key] = m || ''; el.textContent = m || ''; }];
}
// sezioni aperte spesso (solo su questo dispositivo)
const FREQ_KEY = 'cp:setfreq';
const freqRead = () => { try { const v = JSON.parse(localStorage.getItem(FREQ_KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
function freqBump(sub) { try { const f = freqRead(); f[sub] = (f[sub] || 0) + 1; localStorage.setItem(FREQ_KEY, JSON.stringify(f)); } catch { /* ignore */ } }
const fold_ = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ============================================================================
// Helper UI
// ============================================================================
let lastSaved = 0;
const saved = (ctx, msg) => { const n = Date.now(); if (n - lastSaved > 900) { lastSaved = n; ctx.toast(msg || t('saved')); } };
function fail(ctx, e) {
  console.warn(e);
  ctx.toast(e && e.message === 'permission' ? t('err.permission') : t('error'));
}
/** Esegue una scrittura con toast di conferma ed errore gestito. */
async function save(ctx, fn, msg) {
  try { await fn(); saved(ctx, msg); return true; } catch (e) { fail(ctx, e); return false; }
}
const setHouse = (ctx, patch, msg) => save(ctx, () => ctx.actions.setHouse(patch), msg);

const group = (label, rows, foot, cls = '') => h('section', { class: 'st-group ' + cls },
  label ? h('div', { class: 'eyebrow' }, label) : null,
  h('div', { class: 'list' }, rows),
  foot ? h('p', { class: 'st-foot' }, foot) : null);
const card = (...kids) => h('section', { class: 'card st-card stack tight' }, ...kids);
const foot = (text) => h('p', { class: 'st-foot' }, text);
const note = (kind, ic, ...kids) => h('div', { class: 'note ' + kind }, icon(ic), h('div', { class: 'grow' }, ...kids));

function switchRow({ ic, tone, title, desc, checked, onchange, disabled, id }) {
  const inp = h('input', { type: 'checkbox', role: 'switch', 'aria-label': title, 'data-testid': id, disabled: !!disabled });
  inp.checked = !!checked;
  inp.addEventListener('change', () => onchange(inp.checked));
  return h('label', { class: 'li st-sw' + (disabled ? ' is-off' : ''), 'data-testid': id ? id + '-row' : null },
    ic ? h('div', { class: 'ico ' + (tone || '') }, icon(ic)) : null,
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null),
    h('span', { class: 'switch' }, inp, h('i')));
}
function stepRow({ title, desc, value, min, max, step = 1, fmt, onchange, id }) {
  return h('div', { class: 'li st-step', 'data-testid': id },
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null),
    stepper(value, { min, max, step, fmt, onchange }));
}
function textRow({ title, desc, value, placeholder, onchange, type = 'text', id, inputmode, autocomplete = 'off', maxlength }) {
  const inp = h('input', { class: 'input', type, value: value ?? '', placeholder, 'data-testid': id, inputmode, autocomplete, autocapitalize: type === 'text' ? 'sentences' : 'off', spellcheck: 'false', enterkeyhint: 'done', maxlength, 'aria-label': title });
  inp.addEventListener('change', () => onchange(inp.value, inp));
  return h('label', { class: 'li st-text' }, h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), inp);
}
function selectRow({ title, desc, value, options, onchange, id }) {
  const sel = h('select', { class: 'input', 'data-testid': id, 'aria-label': title }, options.map(([v, l]) => { const o = h('option', { value: String(v) }, l); if (String(v) === String(value)) o.selected = true; return o; }));
  sel.addEventListener('change', () => onchange(sel.value));
  return h('label', { class: 'li st-text' }, h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), sel);
}
function segRow({ title, desc, value, options, onchange, id }) {
  const s = seg(options, value, onchange); if (id) s.setAttribute('data-testid', id); s.setAttribute('aria-label', title);
  return h('div', { class: 'li st-text' }, h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), s);
}
const btn = (label, onclick, { cls = 'soft', ic, id, disabled, type = 'button' } = {}) =>
  h('button', { class: 'btn ' + cls, type, onclick, 'data-testid': id, disabled: !!disabled }, ic ? icon(ic) : null, label);
const chip = (label, kind = '', ic) => h('span', { class: 'chip ' + kind }, ic ? icon(ic) : null, label);
const mono = (text, id) => h('div', { class: 'st-mono', 'data-testid': id, tabindex: 0 }, text);
const sectionTitle = (text) => h('div', { class: 'eyebrow' }, text);
/**
 * Sezione richiudibile (<details>). `open` è lo stato iniziale; se l'utente la apre/chiude lo ricordiamo
 * tra un rerender e l'altro (S.open), finché non cambia sezione.
 */
function fold(key, title, kids, { open = false, id, sub } = {}) {
  const d = h('details', { class: 'st-fold', 'data-testid': id || 'fold-' + key, open: key in S.open ? S.open[key] : open },
    h('summary', null, h('div', { class: 'grow' }, h('div', { class: 't' }, title), sub ? h('div', { class: 'st-fold-sub' }, sub) : null), icon('chevron')),
    h('div', { class: 'st-fold-body' }, kids));
  d.querySelector('summary').addEventListener('click', () => setTimeout(() => { S.open[key] = d.open; }));
  return d;
}

/** Tempo relativo localizzato ("2 ore fa"). */
function rel(ctx, iso) {
  if (!iso) return t('acc.notYet');
  const diff = (new Date(iso).getTime() - ctx.now().getTime()) / 1000;
  const f = new Intl.RelativeTimeFormat(ctx.lang, { numeric: 'auto' });
  const a = Math.abs(diff);
  if (a < 45) return f.format(0, 'second');
  if (a < 3600) return f.format(Math.round(diff / 60), 'minute');
  if (a < 86400) return f.format(Math.round(diff / 3600), 'hour');
  if (a < 86400 * 45) return f.format(Math.round(diff / 86400), 'day');
  return f.format(Math.round(diff / (86400 * 30)), 'month');
}
const fileSlug = (s) => String(s || 'casa').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'casa';
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
/** Normalizza un link: vuoto = ''; senza schema aggiunge https://; solo https valido, altrimenti null. */
function normUrl(v) {
  let s = String(v || '').trim(); if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  return isHttps(s) ? s : null;
}

// ============================================================================
// Pagine
// ============================================================================
const SECTIONS = {
  profile: { ic: 'user', tone: '', title: 'set.profile', build: profile, sum: (c) => `${c.meName || '—'} · ${deviceInfo().label}` },
  appearance: { ic: 'sparkles', tone: 'p', title: 'set.appearance', build: appearance, sum: (c) => t('set.theme.' + (c.prefs.theme || 'auto')) },
  home: { ic: 'home2', tone: 'g', title: 'set.homeLayout', build: homeEditor, sum: (c) => t('setX.sum.widgets', { n: c.homeLayout().order.length - c.homeLayout().hidden.length, m: HOME_WIDGETS.length }) },
  notifications: { ic: 'bell', tone: 'r', title: 'set.notifications', build: notifications, sum: (c) => { const s = push.status(c).state; return s === 'on' ? t('set.notif.status.on') : s === 'off' ? t('set.notif.status.off') : t('setX.notif.short.' + s); } },
  house: { admin: true, ic: 'home', tone: '', title: 'set.house', build: houseSection, sum: (c) => c.house.name || '' },
  rules: { admin: true, ic: 'book', tone: 'o', title: 'set.turnRules', build: rulesSection, sum: (c) => t('setX.sum.rules', { a: (c.house.settings || {}).grace ?? DEFAULT_SETTINGS.grace, b: (c.house.settings || {}).minNights ?? DEFAULT_SETTINGS.minNights }) },
  roommates: { admin: true, ic: 'users', tone: 'g', title: 'set.roommates', build: roommatesSection, sum: (c) => (c.house.roommates || []).filter((r) => !r.to || r.to >= c.today()).map((r) => r.name).join(', ') },
  features: { admin: true, ic: 'list', tone: 'p', title: 'set.features', build: featuresSection, sum: (c) => { const k = Object.keys(DEFAULT_FEATURES); return t('setX.sum.features', { n: k.filter((x) => c.feature(x)).length, m: k.length }); } },
  links: { admin: true, ic: 'link', tone: '', title: 'set.links', build: linksSection, sum: (c) => { const l = c.house.links || {}; const n = [l.tricount && l.tricount.url, l.whatsapp && l.whatsapp.url].filter(Boolean).length + ((l.custom || []).length); return t('setX.sum.links', { n }); } },
  'notif-house': { admin: true, ic: 'clock', tone: 'r', title: 'set.houseNotif', build: notifHouse, sum: (c) => (notifCfg(c.house).enabled ? t('on') : t('off')) },
  invite: { admin: true, open: true, ic: 'qr', tone: '', title: 'set.invite', build: inviteSection, sum: (c) => c.code() },
  access: { admin: true, ic: 'eye', tone: 'o', title: 'set.access', build: accessSection, sum: (c) => t('setX.sum.devices', { n: Object.keys(c.state.members || {}).length }) },
  data: { admin: true, ic: 'download', tone: 'g', title: 'set.data', build: dataSection, sum: (c) => (c.cloud ? t('misc.synced') : t('misc.localOnly')) },
  ai: { admin: true, ic: 'sparkles', tone: 'p', title: 'set.ai', build: aiSection, sum: (c) => ((c.house.ai || {}).enabled ? t('on') : t('off')) },
  security: { admin: true, ic: 'shield', tone: 'r', title: 'set.security', build: securitySection, sum: (c) => (c.isAdmin ? t('sec.unlocked') : t('sec.locked')) },
};
const INDEX = [
  ['setX.group.me', ['profile', 'appearance', 'home', 'notifications']],
  ['setX.group.house', ['house', 'rules', 'roommates', 'features', 'links'], true],
  ['setX.group.comms', ['notif-house', 'invite', 'access'], true],
  ['set.advanced', ['data', 'ai', 'security'], true],
];

export async function render(ctx, params = {}) {
  const sub = String(params.sub || '').trim();
  const def = SECTIONS[sub];
  if (sub !== curSub) { resetDrafts(); curSub = sub; if (def) freqBump(sub); }
  if (!sub || !def) return indexPage(ctx);
  if (def.admin && !def.open && !ctx.isAdmin) return page(ctx, t(def.title), h('div', { class: 'empty', 'data-testid': 'admin-only' }, icon('lock'), h('div', { style: { fontWeight: 650, color: 'var(--text)' } }, t('ai.adminOnly')), h('div', { class: 'small' }, t('setX.adminOnly.hint'))), sub);
  let body;
  try { body = await def.build(ctx); } catch (e) { console.error(e); body = note('bad', 'alert', t('error'), ' ', h('span', { class: 'small muted' }, String(e && e.message || e))); }
  return page(ctx, t(def.title), body, sub);
}

function page(ctx, title, body, sub) {
  return h('div', { class: 'st-page stack', 'data-testid': 'settings-page', 'data-sub': sub || '' },
    h('div', { class: 'st-head' },
      h('a', { class: 'icon-btn st-back', href: '#/settings', 'aria-label': t('back'), 'data-testid': 'st-back' }, icon('back')),
      h('h1', { class: 'st-title' }, title)),
    body);
}

/** Sezioni visibili a chi guarda (le admin solo all'admin). */
const visibleSections = (ctx) => Object.entries(SECTIONS).filter(([, d]) => !d.admin || d.open || ctx.isAdmin).map(([k]) => k);
const sectionSum = (ctx, k) => { try { return SECTIONS[k].sum(ctx); } catch { return ''; } };
const sectionRow = (ctx, k) => { const d = SECTIONS[k]; return liRow({ ic: d.ic, tone: d.tone, title: t(d.title), desc: sectionSum(ctx, k), href: '#/settings/' + k }); };

/** Impostazioni rapide: tema e notifiche, senza aprire nessuna sezione. */
function quickCard(ctx) {
  const theme = seg([['auto', t('set.theme.auto')], ['light', t('set.theme.light')], ['dark', t('set.theme.dark')]], ctx.prefs.theme || 'auto', (v) => { ctx.savePrefs({ theme: v }); saved(ctx); });
  theme.setAttribute('data-testid', 'quick-theme'); theme.setAttribute('aria-label', t('set.theme'));
  const s = push.status(ctx).state;
  let nrow;
  if (s === 'off') {
    nrow = h('div', { class: 'row-between st-quick-row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, t('uxb.set.quickNotif')), h('div', { class: 'small muted' }, t('set.notif.status.off'))),
      btn(t('uxb.set.quickEnable'), async () => {
        try { const r = await push.enable(ctx); if (r && r.ok) saved(ctx, t('push.enabled')); else ctx.toast(r && r.reason === 'denied' ? t('set.notif.status.denied') : r && r.reason === 'dismissed' ? t('push.dismissed') : t('push.err')); ctx.rerender(); } catch (e) { fail(ctx, e); }
      }, { cls: '', ic: 'bell', id: 'quick-notif-enable' }));
  } else {
    nrow = h('a', { class: 'row-between st-quick-row st-quick-link', href: '#/settings/notifications', 'data-testid': 'quick-notif' }, h('div', { class: 'grow' }, h('div', { class: 't' }, t('uxb.set.quickNotif')), h('div', { class: 'small muted' }, sectionSum(ctx, 'notifications'))), icon('chevron'));
  }
  return h('section', { class: 'card st-card stack tight st-quick', 'data-testid': 'st-quick' }, h('div', { class: 'eyebrow' }, t('uxb.set.quick')), theme, nrow);
}

/** Cerca nelle sezioni (titolo, riepilogo e parole chiave) senza aprire nulla. */
function searchResults(ctx, q) {
  const toks = fold_(q).split(/\s+/).filter(Boolean);
  const hits = toks.length ? visibleSections(ctx).filter((k) => {
    const hay = fold_([t(SECTIONS[k].title), sectionSum(ctx, k), t('uxb.kw.' + k)].join(' '));
    return toks.every((x) => hay.includes(x));
  }) : [];
  return hits;
}

function indexPage(ctx) {
  const hs = ctx.house; const me = ctx.me;
  const meCard = h('a', { class: 'st-me', href: '#/settings/profile', 'data-testid': 'st-me' },
    avatar(ctx.meName || '?', me ? ctx.color(me) : '#888', 'lg'),
    h('div', { class: 'grow' }, h('div', { class: 'st-me-name' }, ctx.meName || t('setX.noWho')), h('div', { class: 'small muted' }, `${hs.name || ''} · ${ctx.cloud ? t('misc.synced') : t('misc.localOnly')}${(hs.adminIds || []).length ? ' · ' + t('misc.admin') + ': ' + (hs.adminIds || []).map((i) => ctx.name(i)).join(', ') : ''}`)),
    ctx.isAdmin ? chip(t('misc.admin'), 'acc', 'shield') : null, icon('chevron'));
  const groups = h('div', { class: 'stack', 'data-testid': 'settings-groups' }, INDEX.filter(([, , adm]) => !adm || ctx.isAdmin).map(([label, keys]) => group(t(label), keys.map((k) => sectionRow(ctx, k)))));
  // le più usate su questo dispositivo (almeno 2 aperture)
  const f = freqRead();
  const freq = visibleSections(ctx).filter((k) => (f[k] || 0) >= 2).sort((a, b) => f[b] - f[a]).slice(0, 3);
  const freqBox = freq.length ? h('section', { class: 'st-freq', 'data-testid': 'st-freq' }, h('div', { class: 'eyebrow' }, t('uxb.set.freq')),
    h('div', { class: 'st-freq-chips' }, freq.map((k) => h('a', { class: 'chip st-freq-chip', href: '#/settings/' + k }, icon(SECTIONS[k].ic), t(SECTIONS[k].title))))) : null;
  // ricerca: i risultati si aggiornano sul posto; il testo cercato resta in searchQ
  const results = h('div', { class: 'stack tight', 'data-testid': 'st-results' });
  const inp = h('input', { class: 'input st-search', type: 'search', 'data-testid': 'st-search', placeholder: t('uxb.set.search'), 'aria-label': t('uxb.set.search'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', inputmode: 'search' });
  inp.value = searchQ;
  const body = h('div', { class: 'stack' }, quickCard(ctx), freqBox, groups);
  const paint = () => {
    const q = inp.value.trim(); searchQ = inp.value;
    body.hidden = !!q; results.hidden = !q; results.replaceChildren();
    if (!q) return;
    const hits = searchResults(ctx, q);
    if (!hits.length) { results.append(h('p', { class: 'muted center', role: 'status' }, t('uxb.set.noResult', { q }))); return; }
    results.append(h('div', { class: 'list' }, hits.map((k) => sectionRow(ctx, k))));
  };
  inp.addEventListener('input', paint); paint();
  return h('div', { class: 'st-page stack', 'data-testid': 'settings-index' },
    h('h1', { class: 'title' }, t('set.title')),
    meCard, inp, results, body,
    h('div', { class: 'st-about' }, h('div', null, `${t('app.name')} · ${t('misc.version', { v: ctx.VERSION || '' })}`), h('a', { href: '#/guide' }, t('guide.title'))));
}

// ============================================================================
// PROFILE
// ============================================================================
function profile(ctx) {
  const people = ctx.house.roommates || []; const today = ctx.today(); const dev = deviceInfo();
  const who = people.map((p) => {
    const left = p.to && p.to < today;
    return h('button', { class: 'li st-who', type: 'button', 'aria-pressed': String(p.id === ctx.me), 'data-testid': 'who-' + p.id, onclick: () => { if (p.id === ctx.me) return; ctx.setMe(p.id); saved(ctx); } },
      avatar(p.name, ctx.color(p.id)),
      h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), left ? h('div', { class: 'd' }, t('set.roommates.status.out')) : null),
      p.id === ctx.me ? h('span', { class: 'st-check' }, icon('check')) : null);
  });
  const lang = seg(Object.entries(LANGS), ctx.lang, (v) => { ctx.savePrefs({ lang: v }); ctx.actions.touchMember({ lang: v }).catch(() => {}); saved(ctx); });
  lang.setAttribute('data-testid', 'seg-lang'); lang.setAttribute('aria-label', t('set.language'));

  let adminBlock;
  if (ctx.isAdmin) {
    adminBlock = group(t('misc.admin'), [
      liRow({ ic: 'unlock', tone: 'g', title: t('sec.unlocked'), desc: t('sec.note') }),
      h('button', { class: 'li', type: 'button', 'data-testid': 'lock-admin', onclick: () => { ctx.lockAdmin(); saved(ctx, t('sec.locked')); } }, h('div', { class: 'ico r' }, icon('lock')), h('div', { class: 'grow t' }, t('sec.lock'))),
    ]);
  } else {
    const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': t('join.adminPin'), placeholder: t('join.adminPin'), 'data-testid': 'admin-pin' });
    const form = h('form', { class: 'st-pin', onsubmit: async (e) => { e.preventDefault(); if (!pin.value) return; const ok = await ctx.unlockAdmin(pin.value); if (ok) saved(ctx, t('sec.unlocked')); else { ctx.toast(t('join.wrongPin')); pin.select(); } } },
      pin, btn(t('join.unlock'), null, { cls: '', type: 'submit', id: 'admin-unlock' }));
    adminBlock = card(h('div', { class: 'row' }, h('div', { class: 'ico' }, icon('lock')), h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 650 } }, t('sec.locked')), h('div', { class: 'small muted' }, t('join.alreadyAdmin')))), form);
  }
  return h('div', { class: 'stack' },
    group(t('set.whoAmI'), who.length ? who : [h('div', { class: 'li muted' }, t('acc.noPeople'))]),
    group(t('set.deviceName'), [
      textRow({ title: t('set.deviceName'), value: ctx.prefs.deviceName || '', placeholder: dev.label, id: 'device-name', maxlength: 40,
        onchange: (v) => save(ctx, async () => { const name = v.trim().slice(0, 40); ctx.savePrefs({ deviceName: name }); await ctx.actions.touchMember({ name: name || dev.label }); }) }),
    ], `${dev.label} · ${t('misc.version', { v: ctx.VERSION || '' })}`),
    group(t('set.language'), [h('div', { class: 'li' }, lang)]),
    adminBlock);
}

// ============================================================================
// APPEARANCE
// ============================================================================
function appearance(ctx) {
  const p = ctx.prefs; const accent = (p.accent || ctx.house.accent || '#1a73e8').toLowerCase();
  const isPal = PALETTE.some((c) => c.toLowerCase() === accent);
  const theme = seg([['auto', t('set.theme.auto')], ['light', t('set.theme.light')], ['dark', t('set.theme.dark')]], p.theme || 'auto', (v) => { ctx.savePrefs({ theme: v }); saved(ctx); });
  theme.setAttribute('data-testid', 'seg-theme'); theme.setAttribute('aria-label', t('set.theme'));
  const sw = h('div', { class: 'swatches', role: 'group', 'aria-label': t('set.accent') },
    PALETTE.map((c) => h('button', { type: 'button', style: { background: c }, 'aria-label': c, 'aria-pressed': String(c.toLowerCase() === accent), 'data-testid': 'accent-' + c.slice(1), onclick: () => { ctx.savePrefs({ accent: c }); saved(ctx); } })),
    h('label', { class: 'st-colorpick' + (isPal ? '' : ' on'), title: t('setX.appearance.custom') },
      h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#0a84ff', 'aria-label': t('setX.appearance.custom'), 'data-testid': 'accent-custom', onchange: (e) => { ctx.savePrefs({ accent: e.target.value }); saved(ctx); } }),
      isPal ? icon('plus') : icon('check')));
  const sizeVal = h('span', { class: 'st-sizeval' }, Math.round((p.textSize || 1) * 100) + '%');
  const range = h('input', { type: 'range', min: '0.9', max: '1.2', step: '0.05', value: String(p.textSize || 1), 'aria-label': t('set.textSize'), 'data-testid': 'text-size' });
  range.addEventListener('input', () => { sizeVal.textContent = Math.round(range.value * 100) + '%'; });
  range.addEventListener('change', () => { ctx.savePrefs({ textSize: Number(range.value) }); saved(ctx); });
  return h('div', { class: 'stack' },
    group(t('set.theme'), [h('div', { class: 'li' }, theme)]),
    card(h('div', { class: 'lbl' }, t('set.accent')), sw,
      h('div', { class: 'btn-row', style: { marginTop: '12px' } },
        ctx.isAdmin ? h('button', { type: 'button', class: 'btn tonal sm', 'data-testid': 'accent-house', onclick: async () => { try { await ctx.actions.setHouse({ accent }); ctx.savePrefs({ accent: null }); ctx.toast(t('saved')); } catch { ctx.toast(t('error')); } } }   /* poi l'admin segue il colore della casa, come gli altri */, t('setX.accent.all')) : null,
        p.accent ? h('button', { type: 'button', class: 'btn soft sm', onclick: () => { ctx.savePrefs({ accent: null }); saved(ctx); } }, t('setX.accent.house')) : null)),
    card(h('div', { class: 'row-between' }, h('div', { class: 'lbl' }, t('set.textSize')), sizeVal),
      h('div', { class: 'st-range' }, h('span', { class: 'small', 'aria-hidden': 'true' }, 'A'), range, h('span', { style: { fontSize: '1.25rem' }, 'aria-hidden': 'true' }, 'A')),
      h('p', { class: 'muted', style: { fontSize: '1rem' } }, t('setX.appearance.sample'))),
    group(null, [
      switchRow({ ic: 'refresh', title: t('set.reduceMotion'), checked: p.reduceMotion, id: 'sw-motion', onchange: (v) => { ctx.savePrefs({ reduceMotion: v }); saved(ctx); } }),
      switchRow({ ic: 'device', title: t('set.haptics'), checked: p.haptics !== false, id: 'sw-haptics', onchange: (v) => { ctx.savePrefs({ haptics: v }); if (v) ctx.haptic(true, 12); saved(ctx); } }),
      switchRow({ ic: 'list', title: t('set.compact'), checked: p.compact, id: 'sw-compact', onchange: (v) => { ctx.savePrefs({ compact: v }); saved(ctx); } }),
    ]));
}

// ============================================================================
// HOME LAYOUT
// ============================================================================
function homeEditor(ctx) {
  const p = ctx.prefs; const useHouse = p.useHouseHome !== false;
  const eff = ctx.homeLayout();
  const write = (order, hidden) => { ctx.savePrefs({ home: { order, hidden }, useHouseHome: false }); saved(ctx); };
  const rows = eff.order.map((w, i) => {
    const visible = !eff.hidden.includes(w);
    const move = (d) => { const o = [...eff.order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; write(o, eff.hidden); };
    const inp = h('input', { type: 'checkbox', role: 'switch', 'aria-label': t('widget.' + w), 'data-testid': 'w-' + w, disabled: useHouse });
    inp.checked = visible;
    inp.addEventListener('change', () => write(eff.order, inp.checked ? eff.hidden.filter((x) => x !== w) : [...eff.hidden, w]));
    return h('div', { class: 'li st-widget' + (visible ? '' : ' is-hidden') + (useHouse ? ' is-off' : ''), 'data-testid': 'wrow-' + w },
      h('div', { class: 'grow t' }, t('widget.' + w)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('setX.home.up'), 'data-testid': 'w-up-' + w, disabled: useHouse || i === 0, onclick: () => move(-1) }, icon('up')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('setX.home.down'), 'data-testid': 'w-down-' + w, disabled: useHouse || i === eff.order.length - 1, onclick: () => move(1) }, icon('down')),
      h('span', { class: 'switch' }, inp, h('i')));
  });
  const canReset = !!p.home || !useHouse;
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('set.homeLayout.hint')),
    group(null, [switchRow({ ic: 'shield', title: t('set.homeLayout.useHouse'), desc: useHouse ? t('set.homeLayout.houseDefault') : null, checked: useHouse, id: 'sw-use-house',
      onchange: (v) => { if (v) ctx.savePrefs({ useHouseHome: true }); else ctx.savePrefs({ useHouseHome: false, home: p.home || { order: [...eff.order], hidden: [...eff.hidden] } }); saved(ctx); } })]),
    group(t('set.homeLayout'), rows),
    h('div', { class: 'btn-row' },
      btn(t('set.homeLayout.reset'), () => { ctx.savePrefs({ home: null, useHouseHome: true }); saved(ctx); }, { ic: 'refresh', id: 'home-reset', disabled: !canReset }),
      ctx.isAdmin ? btn(t('set.homeLayout.setHouse'), () => setHouse(ctx, { home: { order: [...eff.order], hidden: [...eff.hidden] } }), { cls: 'tonal', ic: 'shield', id: 'home-set-house' }) : null),
    ctx.isAdmin ? foot(t('setX.home.adminHint')) : null);
}

// ============================================================================
// NOTIFICATIONS (personali)
// ============================================================================
const NT_FEATURE = { friAbsence: 'trips', planDay: 'planDay', requests: 'requests', needs: 'needs' };
/** Le dieci notifiche personali raggruppate in cinque righe (le chiavi sono quelle di NOTIF_TYPES). */
const NT_GROUPS = [
  { k: 'shifts', keys: ['satDuty', 'sunMark', 'late', 'planDay', 'monNew'] },
  { k: 'absence', keys: ['friAbsence'] },
  { k: 'requests', keys: ['requests', 'nudges'] },
  { k: 'needs', keys: ['needs'] },
  { k: 'admin', keys: ['adminDigest'], admin: true },
];
/** Admin: prova dal server a tutti i coinquilini con notifiche attive. */
function testAllBlock(ctx) {
  const n = new Set(Object.values(ctx.state.members || {}).filter((m) => m && m.personId && m.push && m.push.endpoint).map((m) => m.personId)).size;
  return h('div', { class: 'stack tight', 'data-testid': 'test-all' },
    btn(t('setX.notif.testAll'), async () => {
      try { const k = await ctx.actions.testAll(); ctx.toast(k ? t('setX.notif.testAllSent', { n: k }) : t('setX.notif.testAllNone'), 6000); } catch (e) { fail(ctx, e); }
    }, { cls: 'tonal', ic: 'bell', id: 'push-test-all' }),
    foot(n ? t('setX.notif.testAllHint', { n }) : t('setX.notif.testAllNone')));
}
function notifications(ctx) {
  const st = push.status(ctx); const s = st.state;
  const sbox = h('div', { class: 'stack tight' });
  const statusText = s === 'ios-install' ? t('set.notif.status.ios') : t('set.notif.status.' + (s === 'on' || s === 'off' || s === 'denied' || s === 'unsupported' || s === 'nocloud' || s === 'nopush' ? s : 'off'));
  const run = async (fn, okMsg) => {
    try {
      const r = await fn(ctx);
      if (r && r.ok) { saved(ctx, okMsg); ctx.rerender(); return; }
      const reason = r && r.reason;
      ctx.toast(reason === 'denied' ? t('set.notif.status.denied') : reason === 'dismissed' ? t('push.dismissed') : reason === 'permission' ? t('push.needPermission') : t('push.err'));
      ctx.rerender();
    } catch (e) { fail(ctx, e); }
  };
  const buttons = [];
  if (s === 'off') buttons.push(btn(t('set.notif.enable'), () => run(push.enable, t('push.enabled')), { cls: '', ic: 'bell', id: 'push-enable' }));
  const active = s === 'on';
  // stato di registrazione sul server: se il dispositivo risulta «attivo» ma non registrato, la diagnostica si apre da sola
  const mine = (ctx.state.members || {})[ctx.deviceId] || {};
  const reg = !!(mine.push && mine.push.endpoint);
  sbox.append(
    h('div', { class: 'row' }, h('div', { class: 'ico ' + (s === 'on' ? 'g' : s === 'denied' ? 'r' : '') }, icon(s === 'on' ? 'bell' : 'bellOff')),
      h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 650 }, 'data-testid': 'push-state', 'data-state': s }, statusText))),
    ...(buttons.length ? [h('div', { class: 'btn-row' }, buttons)] : []));
  // diagnostica e prove (richiudibile): le prove restano disponibili finché le notifiche sono attive su questo dispositivo
  const diagKids = [];
  if (active) {
    // diagnosi «attive ma non arrivano»: il server invia solo ai dispositivi con la sottoscrizione salvata nel cloud
    let host = ''; try { host = reg ? new URL(mine.push.endpoint).host : ''; } catch { /* ignore */ }
    const srun = ctx.house.serverRun; const stale = !srun || ctx.now().getTime() - new Date(srun).getTime() > 3 * 3600000;
    const pending = Object.values(ctx.state.requests || {}).filter((q) => q.kind === 'test' && q.device === ctx.deviceId && !q.notified).length;
    const dg = (ok, title, desc, id) => h('div', { class: 'row', 'data-testid': id, 'data-ok': ok ? '1' : '0' }, h('div', { class: 'ico ' + (ok ? 'g' : 'o') }, icon(ok ? 'check' : 'alert')), h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 600 } }, title), desc ? h('div', { class: 'small muted' }, desc) : null));
    diagKids.push(h('div', { class: 'stack tight', 'data-testid': 'push-diag' },
      dg(reg, reg ? t('setX.notif.diag.saved') : t('setX.notif.diag.notSaved'), reg ? host : t('setX.notif.diag.notSavedHint'), 'diag-saved'),
      dg(!stale, srun ? t('sched.lastRun', { when: rel(ctx, srun) }) : t('sched.noRun'), stale ? t('setX.notif.diag.serverHint') : null, 'diag-server'),
      pending ? dg(true, t('setX.notif.diag.pending'), t('setX.notif.diag.pendingHint'), 'diag-pending') : null,
      btn(t('setX.notif.diag.repair'), () => run(push.enable, t('push.enabled')), { cls: 'soft sm', ic: 'refresh', id: 'push-repair' })));
    diagKids.push(h('div', { class: 'btn-row' },
      btn(t('set.notif.test'), () => run(push.localTest, t('set.notif.testSent')), { cls: 'tonal', ic: 'bell', id: 'push-test' }),
      btn(t('setX.notif.testServer'), async () => { try { await ctx.store.setDoc('requests', 'test' + Date.now().toString(36), { kind: 'test', to: ctx.me, device: ctx.deviceId, status: 'info', at: new Date().toISOString() }); ctx.toast(t('setX.notif.testServerSent'), 6000); } catch { ctx.toast(t('error')); } }, { cls: 'soft', ic: 'refresh', id: 'push-test-server' }),
      btn(t('set.notif.disable'), () => run(push.disable, t('push.disabled')), { cls: 'soft', ic: 'bellOff', id: 'push-disable' })));
  }
  if (ctx.isAdmin) diagKids.push(testAllBlock(ctx));
  if (s === 'ios-install') sbox.append(h('ol', { class: 'st-steps' }, ['guide.ios1', 'guide.ios2', 'guide.ios3', 'guide.ios4'].map((k) => h('li', null, t(k)))));
  if (s === 'denied') sbox.append(h('ol', { class: 'st-steps', 'data-testid': 'push-denied-steps' }, push.deniedSteps().map((k) => h('li', null, t(k)))),
    btn(t('push.gate.recheck'), () => ctx.rerender(), { cls: 'soft sm', ic: 'refresh', id: 'push-recheck' }));

  const m = (ctx.state.members || {})[ctx.deviceId] || {}; const mp = m.prefs || {}; const pp = ctx.prefs.notif || {};
  const cfg = notifCfg(ctx.house);
  const val = (k) => (k in mp ? mp[k] : k in pp ? pp[k] : true) !== false;
  const offBy = (k) => cfg.enabled === false || (cfg[k] && cfg[k].on === false) || (NT_FEATURE[k] && !ctx.feature(NT_FEATURE[k]));
  // poche righe invece di dieci: l'interruttore di un gruppo scrive le preferenze di tutte le sue chiavi
  const rows = NT_GROUPS.filter((g) => !g.admin || ctx.isAdmin).map((g) => {
    const desc = t('setX.ntg.' + g.k + '.desc');
    return switchRow({ title: t('setX.ntg.' + g.k), desc: g.keys.every(offBy) ? h('span', null, desc, ' ', chip(t('setX.notif.offByAdmin'), 'warn')) : desc,
      checked: g.keys.every(val), id: 'nt-group-' + g.k,   // acceso se nessuna chiave del gruppo è spenta
      onchange: (v) => save(ctx, async () => {
        const p = Object.fromEntries(g.keys.map((k) => [k, v]));
        ctx.savePrefs({ notif: { ...(ctx.prefs.notif || {}), ...p } }); await ctx.actions.touchMember({ prefs: p });
      }) });
  });
  return h('div', { class: 'stack' },
    card(sbox),
    cfg.enabled === false ? note('warn', 'alert', t('setX.notif.masterOff')) : null,
    group(t('set.notif.mine'), rows, t('setX.notif.foot')),
    diagKids.length ? fold('diag', t('setX.notif.diagTitle'), diagKids, { open: active && !reg, id: 'nt-diag', sub: active && !reg ? t('setX.notif.diag.notSaved') : null }) : null,
    ctx.isAdmin ? group(null, [liRow({ ic: 'clock', tone: 'r', title: t('sched.title'), desc: t('sched.hint').split('.')[0] + '.', href: '#/settings/notif-house' })]) : null);
}

// ============================================================================
// HOUSE
// ============================================================================
const TZ_COMMON = ['Europe/Rome', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris', 'Europe/Brussels', 'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Vienna',
  'Europe/Prague', 'Europe/Warsaw', 'Europe/Budapest', 'Europe/Stockholm', 'Europe/Athens', 'Europe/Bucharest', 'Europe/Istanbul', 'Europe/Moscow', 'Atlantic/Reykjavik', 'Africa/Cairo', 'Africa/Johannesburg',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];
const detectTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const validTz = (z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };

function houseSection(ctx) {
  const hs = ctx.house; const cur = hs.tz || 'Europe/Rome'; const det = detectTz();
  const zones = [...new Set([cur, det, ...TZ_COMMON].filter((z) => z && validTz(z)))];
  zones.sort((a, b) => (a === cur ? -1 : b === cur ? 1 : 0) || a.localeCompare(b));
  const label = (z) => z.replace(/_/g, ' ') + (z === det ? ` · ${t('setX.house.detected')}` : '');
  const startTxt = hs.startSunday ? fmtDate(hs.startSunday, ctx.lang, { year: true, dow: true }) : '—';
  return h('div', { class: 'stack' },
    group(t('set.house'), [
      textRow({ title: t('set.houseName'), value: hs.name || '', id: 'house-name', maxlength: 60, onchange: (v, inp) => { const n = v.trim().slice(0, 60); if (!n) { inp.value = hs.name || ''; return; } if (n !== hs.name) setHouse(ctx, { name: n }); } }),
      selectRow({ title: t('set.tz'), value: cur, id: 'house-tz', options: zones.map((z) => [z, label(z)]), onchange: (v) => setHouse(ctx, { tz: v }) }),
      det && det !== cur && validTz(det) ? h('button', { class: 'li', type: 'button', 'data-testid': 'tz-detected', onclick: () => setHouse(ctx, { tz: det }) }, h('div', { class: 'ico' }, icon('globe')), h('div', { class: 'grow' }, h('div', { class: 't' }, t('setX.house.useDetected', { tz: det })))) : null,
      segRow({ title: t('setX.house.lang'), value: hs.lang || 'it', id: 'house-lang', options: Object.entries(LANGS), onchange: (v) => setHouse(ctx, { lang: v }) }),
    ], t('setX.house.tzHint')),
    group(t('setX.house.plan'), [
      h('div', { class: 'li', 'data-testid': 'start-sunday' }, h('div', { class: 'ico' }, icon('calendar')), h('div', { class: 'grow' }, h('div', { class: 't' }, t('set.firstSunday')), h('div', { class: 'd' }, startTxt)), chip(t('setX.house.readonly'), '', 'lock')),
    ], t('setX.house.startWarn')),
    group(t('setX.house.behaviour'), [
      switchRow({ ic: 'book', title: t('setX.house.requireRules'), desc: t('setX.house.requireRulesHint'), checked: hs.requireRules !== false, id: 'sw-requireRules', onchange: (v) => setHouse(ctx, { requireRules: v }) }),
      switchRow({ ic: 'bell', title: t('setX.house.requirePush'), desc: t('setX.house.requirePushHint'), checked: hs.requirePush !== false, id: 'sw-requirePush', onchange: (v) => setHouse(ctx, { requirePush: v }) }),
    ]));
}

// ============================================================================
// RULES (regole dei turni + sforzo)
// ============================================================================
function rulesSection(ctx) {
  const S_ = { ...DEFAULT_SETTINGS, ...(ctx.house.settings || {}) }; const eff = effortOf(ctx.house);
  const st = (k, title, desc, min, max, step = 1, fmt) => stepRow({ title, desc, value: Number(S_[k]), min, max, step, fmt, id: 'step-' + k, onchange: (v) => setHouse(ctx, { settings: { [k]: v } }) });
  const effort = CHORES.map((c) => h('div', { class: 'st-effort', 'data-testid': 'effort-' + c },
    h('div', { class: 'row' }, h('div', { class: 'tile ' + c, style: { width: '36px', height: '36px', borderRadius: '11px' } }, icon(c === 'floor' ? 'broom' : c === 'bathroom' ? 'shower' : 'pot')), h('div', { class: 'grow t', style: { fontWeight: 600 } }, t('chore.' + c)), h('span', { class: 'chip' }, t('setX.rules.points', { n: eff[c] }))),
    seg([1, 2, 3, 4, 5].map((n) => [n, String(n)]), Number(eff[c]), (v) => setHouse(ctx, { effort: { [c]: v } }))));
  const rank = seg([['turns', t('setX.rules.rankTurns')], ['effort', t('setX.rules.rankEffort')]], S_.rankBy === 'effort' ? 'effort' : 'turns', (v) => setHouse(ctx, { settings: { rankBy: v } }));
  rank.setAttribute('data-testid', 'seg-rankBy'); rank.setAttribute('aria-label', t('setX.rules.rankBy'));
  return h('div', { class: 'stack' },
    note('', 'info', t('setX.rules.recalc')),
    group(t('set.turnRules'), [
      st('grace', t('set.grace'), t('set.graceHint'), 0, 7),
      st('minRest', t('uxb.rules.minRest'), t('setX.rules.minRestHint'), 1, 4),
      st('startPriority', t('uxb.rules.startPriority'), t('setX.rules.startPriorityHint'), 0, 12),
      st('window', t('uxb.rules.window'), t('uxb.rules.windowHint'), 0, 260, 4, (v) => (v === 0 ? t('setX.rules.always') : String(v))),
      st('minNights', t('set.minNights'), t('setX.rules.minNightsHint'), 1, 7),
    ]),
    group(t('moreY.pen.group'), [stepRow({ title: t('moreY.pen.setting'), desc: t('moreY.pen.settingHint'), value: Number(S_.taskPenalty !== undefined ? S_.taskPenalty : DEFAULT_TASK_PENALTY), min: 0, max: 3, step: 0.5, id: 'step-taskPenalty', fmt: (v) => Number(v).toLocaleString(ctx.lang, { maximumFractionDigits: 1 }), onchange: (v) => setHouse(ctx, { settings: { taskPenalty: v } }) })], t('moreY.pen.settingFoot')),
    h('section', { class: 'card st-card stack' },
      h('div', null, h('div', { class: 't', style: { fontWeight: 700 } }, t('setX.rules.effort')), h('p', { class: 'small muted' }, t('setX.rules.effortHint'))),
      effort),
    h('section', { class: 'card st-card stack tight' }, h('div', { class: 'lbl' }, t('setX.rules.rankBy')), rank, h('p', { class: 'small muted' }, t('setX.rules.rankByHint'))));
}

// ============================================================================
// ROOMMATES (editor come nel foglio)
// ============================================================================
const normRm = (r) => ({ id: r.id || null, name: String(r.name || '').trim(), slot: Number(r.slot) || 1, from: r.from || null, to: r.to || null, expectedTo: r.to ? null : (r.expectedTo || null), color: r.color || null });
const rmList = () => S.rm.map(({ _k, ...r }) => r);
const rmDirty = () => JSON.stringify(rmList().map(normRm)) !== S.rmBase;
function rmInit(ctx) {
  const base = JSON.stringify((ctx.house.roommates || []).map(normRm));
  if (!S.rm || (S.rmBase !== base && !rmDirty())) { S.rm = (ctx.house.roommates || []).map((r) => ({ ...r, slot: Number(r.slot) || 1, _k: r.id })); S.rmBase = base; }
}
function rmIssues(list, today) {
  const rows = list.map((r) => ({ ...normRm(r) }));
  const issues = new Set(validateRoommates(rows, today));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (!a.name || !b.name || a.slot !== b.slot) continue;
    if ((a.from || '0000-00-00') <= (b.to || '9999-12-31') && (b.from || '0000-00-00') <= (a.to || '9999-12-31')) issues.add('slotDup');
  }
  const active = rows.filter((r) => r.name && (!r.from || r.from <= today) && (!r.to || r.to >= today));
  if (active.length > 4) issues.add('max4');
  return [...issues];
}
/** Persone uscite (fino al <= oggi) dopo l'ultima rotazione del codice e non ignorate. */
export function leftPeople(ctx) {
  const hs = ctx.house; const today = ctx.today(); const rot = hs.rotatedAt ? hs.rotatedAt.slice(0, 10) : '0000-00-00';
  return (hs.roommates || []).filter((r) => r.to && r.to <= today && r.to >= rot && !(hs.ignoreLeft || {})[r.id]);
}
async function rmSave(ctx) {
  const list = rmList().map(normRm).filter((r) => r.name);
  const issues = rmIssues(list, ctx.today());
  if (!list.length) { ctx.toast(t('setX.rm.empty')); return false; }
  if (issues.includes('slotRange')) { ctx.toast(t('set.roommates.slotRange')); return false; }
  const ok = await save(ctx, () => ctx.actions.setRoommates(list));
  if (ok) { S.rm = null; ctx.rerender(); }
  return ok;
}

function roommatesSection(ctx) {
  rmInit(ctx);
  const today = ctx.today();
  const warnBox = h('div', { class: 'stack tight', 'data-testid': 'rm-warn', 'aria-live': 'polite' });
  const saveBtn = btn(t('save'), () => rmSave(ctx), { cls: '', ic: 'check', id: 'rm-save' });
  const cancelBtn = btn(t('cancel'), () => { S.rm = null; ctx.rerender(); }, { cls: 'soft', id: 'rm-cancel' });
  const refresh = () => {
    const issues = rmIssues(rmList(), today);
    warnBox.replaceChildren(...issues.map((k) => note(k === 'slotRange' ? 'bad' : 'warn', 'alert', t('set.roommates.' + k))));
    const d = rmDirty(); saveBtn.disabled = !d; cancelBtn.hidden = !d; bar.hidden = !d;
  };
  const bar = h('div', { class: 'st-savebar', 'data-testid': 'rm-bar' }, cancelBtn, saveBtn);
  const list = h('div', { class: 'stack', 'data-testid': 'rm-list' });
  const draw = () => { list.replaceChildren(...S.rm.map((r, i) => personCard(r, i))); refresh(); };

  function statusOf(r) { if (r.to && r.to < today) return ['out', 'bad']; if (r.from && r.from > today) return ['arriving', 'warn']; return ['home', 'ok']; }
  function personCard(r, i) {
    const [st, kind] = statusOf(r);
    const color = r.color || PALETTE[i % PALETTE.length];
    const name = h('input', { class: 'input', value: r.name || '', placeholder: t('set.roommates.name'), 'aria-label': t('set.roommates.name'), 'data-testid': 'rm-name-' + i, maxlength: 30, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done' });
    name.addEventListener('input', () => { r.name = name.value; refresh(); });
    const dateIn = (key, label, testid) => { const el = h('input', { class: 'input', type: 'date', value: r[key] || '', 'aria-label': label, 'data-testid': testid }); el.addEventListener('change', () => { r[key] = el.value || null; if (key === 'to' && r.to) r.expectedTo = null; draw(); }); return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), el); };
    const pal = S.rmColor === r._k ? h('div', { class: 'swatches st-pal' }, PALETTE.map((c) => h('button', { type: 'button', style: { background: c }, 'aria-label': c, 'aria-pressed': String(c === r.color), onclick: () => { r.color = c; S.rmColor = null; draw(); } })),
      h('label', { class: 'st-colorpick', title: t('setX.appearance.custom') }, h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#0a84ff', 'aria-label': t('setX.appearance.custom'), onchange: (e) => { r.color = e.target.value; S.rmColor = null; draw(); } }), icon('plus'))) : null;
    const slot = seg([1, 2, 3, 4].map((n) => [n, String(n)]), Number(r.slot) || 1, (v) => { r.slot = v; refresh(); });
    slot.setAttribute('aria-label', t('set.roommates.slot'));
    return h('section', { class: 'card st-card st-person stack tight', 'data-testid': 'rm-card-' + i },
      h('div', { class: 'row' },
        h('button', { class: 'st-dot', type: 'button', style: { background: color }, 'aria-label': t('set.roommates.color'), 'aria-expanded': String(S.rmColor === r._k), onclick: () => { S.rmColor = S.rmColor === r._k ? null : r._k; draw(); } }, (r.name || '?').trim().slice(0, 1).toUpperCase()),
        h('div', { class: 'grow' }, name)),
      h('div', { class: 'st-chips', 'data-testid': 'rm-chips-' + i }, chip(t('set.roommates.status.' + st), kind),
          !r.to ? (r.expectedTo ? null : chip(t('setX.rm.unknownExit'), '', 'clock')) : r.to > today ? chip(t('setX.rm.leavesChip', { date: fmtDate(r.to, ctx.lang, { year: true }) }), 'warn') : null,
          !r.to && r.expectedTo ? chip(t('setX.rm.expectedChip', { date: fmtDate(r.expectedTo, ctx.lang, { year: true }) }), 'warn', 'alert') : null),
      pal,
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, t('set.roommates.slot')), slot),
      h('div', { class: 'st-dates' }, dateIn('from', t('set.roommates.from'), 'rm-from-' + i), dateIn('to', t('set.roommates.to'), 'rm-to-' + i)),
      r.to ? null : h('div', { class: 'st-expected' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('setX.rm.expectedTo')), (() => { const el = h('input', { class: 'input', type: 'date', value: r.expectedTo || '', 'aria-label': t('setX.rm.expectedTo'), 'data-testid': 'rm-expected-' + i }); el.addEventListener('change', () => { r.expectedTo = el.value || null; draw(); }); return el; })()),
        h('p', { class: 'small muted' }, t('setX.rm.expectedHint'))),
      h('div', { class: 'btn-row' },
        r.to ? null : btn(r.expectedTo ? t('setX.rm.confirmExit') : t('set.roommates.moveOut'), () => moveOutSheet(r), { ic: 'unlock', id: 'rm-out-' + i, cls: r.expectedTo ? 'tonal' : 'soft' }),
        btn(t('setX.rm.replace'), () => replaceSheet(r), { ic: 'swap', id: 'rm-replace-' + i }),
        h('button', { class: 'icon-btn st-del', type: 'button', 'aria-label': t('set.roommates.remove'), 'data-testid': 'rm-del-' + i, onclick: async () => { if (await confirmDialog({ title: t('set.roommates.remove'), text: t('set.roommates.removeHint'), ok: t('set.roommates.remove'), danger: true })) { S.rm.splice(i, 1); draw(); } } }, icon('trash'))));
  }

  function afterExit() { ctx.toast(t('setX.rm.exitSaved')); }
  function moveOutSheet(r) {
    const d = h('input', { class: 'input', type: 'date', value: r.to || r.expectedTo || today, 'aria-label': t('set.roommates.to'), 'data-testid': 'out-date' });
    const sh = ctx.sheet({ title: `${t('set.roommates.moveOut')} · ${r.name}`, body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('setX.rm.moveOutHint')), h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('set.roommates.to')), d),
      h('div', { class: 'btn-row' }, btn(t('cancel'), () => sh.close()), btn(t('set.roommates.moveOut'), async () => {
        if (!d.value) return; if (r.from && d.value < r.from) { ctx.toast(t('trips.invalid')); return; }
        r.to = d.value; r.expectedTo = null; sh.close(); if (await rmSave(ctx)) afterExit();
      }, { cls: '', id: 'out-confirm' }))) });
  }
  function replaceSheet(r) {
    const nm = h('input', { class: 'input', placeholder: t('set.roommates.name'), 'aria-label': t('set.roommates.name'), 'data-testid': 'rep-name', maxlength: 30, autocomplete: 'off' });
    const d = h('input', { class: 'input', type: 'date', value: r.to || today, 'aria-label': t('set.roommates.to'), 'data-testid': 'rep-date' });
    const info = h('p', { class: 'small muted', 'data-testid': 'rep-info' });
    const upd = () => { info.textContent = d.value ? t('setX.rm.replaceInfo', { slot: r.slot, date: fmtDate(addDays(d.value, 1), ctx.lang, { year: true }) }) : ''; };
    d.addEventListener('change', upd); upd();
    const sh = ctx.sheet({ title: `${t('setX.rm.replace')} · ${r.name}`, body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('setX.rm.replaceHint')),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('setX.rm.newName')), nm), h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('setX.rm.exitDay')), d), info,
      h('div', { class: 'btn-row' }, btn(t('cancel'), () => sh.close()), btn(t('setX.rm.replace'), async () => {
        const name = nm.value.trim(); if (!name) { nm.focus(); return; } if (!d.value) return;
        if (r.from && d.value < r.from) { ctx.toast(t('trips.invalid')); return; }
        r.to = d.value; r.expectedTo = null; S.rm.push({ _k: 'n' + uid(), name, slot: Number(r.slot) || 1, from: addDays(d.value, 1), to: null, color: null });
        sh.close(); if (await rmSave(ctx)) afterExit();
      }, { cls: '', id: 'rep-confirm' }))) });
    setTimeout(() => nm.focus(), 420);
  }

  draw();
  const left = leftPeople(ctx);
  const hint = left.length ? card(note('warn', 'alert', h('div', { 'data-testid': 'rm-rotate-hint' }, t('setX.rm.rotateHint', { names: left.map((r) => r.name).join(', ') }))),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn', href: '#/settings/invite', 'data-testid': 'rm-go-invite' }, icon('qr'), t('setX.rm.rotateGo')),
      btn(t('setX.rm.ignore'), () => setHouse(ctx, { ignoreLeft: Object.fromEntries(left.map((r) => [r.id, true])) }), { id: 'rm-ignore' }))) : null;
  const soon = ctx.actions.expectedExits ? ctx.actions.expectedExits(21) : [];
  const soonHint = soon.length ? note('warn', 'clock', h('div', { 'data-testid': 'rm-expected-hint' }, t('setX.rm.expectedSoon', { names: soon.map((r) => `${r.name} (${fmtDate(r.expectedTo, ctx.lang, { year: true })})`).join(', ') }))) : null;
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('set.roommates.hint')),
    soonHint, hint, list, warnBox,
    h('div', { class: 'btn-row' }, btn(t('set.roommates.add'), () => { S.rm.push({ _k: 'n' + uid(), name: '', slot: nextSlot(), from: null, to: null, color: null }); draw(); setTimeout(() => { const el = list.querySelector(`[data-testid="rm-name-${S.rm.length - 1}"]`); if (el) el.focus(); }, 30); }, { ic: 'plus', id: 'rm-add' })),
    bar);
  function nextSlot() { const used = new Set(S.rm.filter((r) => !r.to || r.to >= today).map((r) => Number(r.slot))); for (let s = 1; s <= 4; s++) if (!used.has(s)) return s; return 1; }
}

// ============================================================================
// FEATURES
// ============================================================================
const FEAT_IC = { shared: 'refresh', needs: 'cart', stats: 'chart', tasks: 'list', lastout: 'lock', requests: 'swap', planDay: 'calendar', whatsapp: 'whatsapp', activity: 'history', trips: 'plane', rules: 'book', ranking: 'trophy', ics: 'calendar', refresh: 'refresh', selfDone: 'check', selfAway: 'plane', coverOthers: 'users' };
function featuresSection(ctx) {
  const mk = (k) => switchRow({ ic: FEAT_IC[k] || 'list', title: t('set.feat.' + k), desc: t('uxb.featd.' + k), checked: ctx.feature(k), id: 'feat-' + k, onchange: (v) => setHouse(ctx, { features: { [k]: v } }) });
  const keys = Object.keys(DEFAULT_FEATURES);
  const perm = ['selfDone', 'selfAway', 'coverOthers'];
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('set.feat.hint')),
    group(t('set.features'), keys.filter((k) => !perm.includes(k) && k !== 'refresh').map(mk)),   // 'refresh' (avviso periodico) non esiste più
    group(t('setX.feat.perm'), perm.map(mk), t('setX.feat.permHint')));
}

// ============================================================================
// LINKS
// ============================================================================
function linksSection(ctx) {
  const L = { tricount: { url: '', show: true }, whatsapp: { url: '', show: false }, custom: [], ...(ctx.house.links || {}) };
  const urlSave = (path, v, inp) => {
    const u = normUrl(v);
    if (u === null) { ctx.toast(t('setX.links.https')); inp.value = path.url || ''; inp.focus(); return; }
    inp.value = u; if (u !== (path.url || '')) return setHouse(ctx, path.patch(u));
  };
  const block = (key, ic, title, desc) => {
    const cur = L[key] || {};
    return group(title, [
      textRow({ title: desc, value: cur.url || '', placeholder: 'https://', type: 'url', inputmode: 'url', id: 'link-' + key, onchange: (v, inp) => urlSave({ url: cur.url, patch: (u) => ({ links: { [key]: { url: u } } }) }, v, inp) }),
      switchRow({ ic, title: t('set.showOnHome'), checked: cur.show === undefined ? key === 'tricount' : !!cur.show, id: 'link-show-' + key, onchange: (v) => setHouse(ctx, { links: { [key]: { show: v } } }) }),
    ]);
  };
  const custom = L.custom || [];
  const setCustom = (arr) => setHouse(ctx, { links: { custom: arr } });
  const customRows = custom.map((c, i) => h('div', { class: 'st-custom', 'data-testid': 'custom-' + i },
    h('div', { class: 'st-custom-head' },
      h('input', { class: 'input', value: c.label || '', placeholder: t('set.linkLabel'), 'aria-label': t('set.linkLabel'), 'data-testid': 'custom-label-' + i, maxlength: 30, onchange: (e) => { const arr = custom.map((x) => ({ ...x })); arr[i].label = e.target.value.trim().slice(0, 30); setCustom(arr); } }),
      h('button', { class: 'icon-btn st-del', type: 'button', 'aria-label': t('delete'), 'data-testid': 'custom-del-' + i, onclick: () => { setCustom(custom.filter((_, j) => j !== i)); } }, icon('trash'))),
    h('input', { class: 'input', type: 'url', inputmode: 'url', value: c.url || '', placeholder: 'https://', enterkeyhint: 'done', autocapitalize: 'off', 'aria-label': t('set.linkUrl'), 'data-testid': 'custom-url-' + i, onchange: (e) => { const u = normUrl(e.target.value); if (!u) { ctx.toast(t('setX.links.https')); e.target.value = c.url || ''; return; } const arr = custom.map((x) => ({ ...x })); arr[i].url = u; setCustom(arr); } }),
    switchRow({ title: t('set.showOnHome'), checked: c.show !== false, id: 'custom-show-' + i, onchange: (v) => { const arr = custom.map((x) => ({ ...x })); arr[i].show = v; setCustom(arr); } })));
  const addSheet = () => {
    const lab = h('input', { class: 'input', placeholder: t('set.linkLabel'), 'aria-label': t('set.linkLabel'), maxlength: 30, 'data-testid': 'add-label' });
    const url = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'https://', 'aria-label': t('set.linkUrl'), 'data-testid': 'add-url' });
    const sh = ctx.sheet({ title: t('set.customLink'), body: h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); const name = lab.value.trim(); const u = normUrl(url.value);
      if (!name) { lab.focus(); return; } if (!u) { ctx.toast(t('setX.links.https')); url.focus(); return; }
      sh.close(); await setCustom([...custom, { id: uid(), label: name.slice(0, 30), url: u, show: true }]);
    } }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('set.linkLabel')), lab), h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('set.linkUrl')), url),
      h('div', { class: 'btn-row' }, btn(t('cancel'), () => sh.close()), btn(t('add'), null, { cls: '', type: 'submit', id: 'add-confirm' }))) });
    setTimeout(() => lab.focus(), 420);
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('set.linkHint')),
    block('tricount', 'tricount', t('set.tricount'), t('set.tricountUrl')),
    block('whatsapp', 'whatsapp', t('set.whatsappGroup'), t('set.whatsappGroup')),
    h('div', { class: 'stack tight' }, sectionTitle(t('set.customLink')), customRows.length ? h('div', { class: 'list' }, customRows) : null, btn(t('set.addLink'), addSheet, { ic: 'plus', id: 'link-add' })),
    foot(t('setX.links.httpsHint')));
}

// ============================================================================
// NOTIF-HOUSE (programma notifiche della casa)
// ============================================================================
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SCHEDULED = [
  { k: 'friAbsence', dow: true, time: true }, { k: 'satDuty', dow: true, time: true }, { k: 'sunMark', dow: true, time: true },
  { k: 'late', late: true }, { k: 'monNew', dow: true, time: true }, { k: 'planDay', time: true }, { k: 'adminDigest', dow: true, time: true },
  { k: 'requests' }, { k: 'needs' }, { k: 'nudges' },
];
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Simula il server (un controllo all'ora) per i prossimi giorni, assumendo che nessuno segni nulla da adesso in poi. */
export function previewNotifications(ctx, days = 7) {
  const eh = ctx.calc.eh; const tz = eh.tz || 'Europe/Rome';
  const start = new Date(ctx.now().getTime()); start.setMinutes(0, 0, 0); start.setTime(start.getTime() + 3600000);
  const sent = new Set(); const groups = new Map();
  for (let i = 0; i < days * 24; i++) {
    const now = new Date(start.getTime() + i * 3600000);
    let res = []; try { res = planNotifications({ house: eh, weeks: eh.weeks, now, sent }); } catch { res = []; }
    if (!res.length) continue;
    const lp = localParts(now, tz);
    for (const n of res) {
      sent.add(n.key);
      const type = n.type === 'planDayLate' ? 'planDay' : n.type;
      const key = `${lp.date}|${lp.minutes}|${type}`;
      if (!groups.has(key)) groups.set(key, { date: lp.date, time: hhmm(lp.minutes), type, names: [], dow: lp.dow });
      const g = groups.get(key); const nm = ctx.name(n.personId); if (nm && !g.names.includes(nm)) g.names.push(nm);
    }
  }
  return [...groups.values()];
}

/** Admin: avvio immediato delle notifiche (token GitHub limitato a questo repository). */
function kickBlock(ctx) {
  const hs = ctx.house; const on = hasKick(hs); const repo = repoOf(hs);
  const tok = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', 'aria-label': t('setX.kick.token'), 'data-testid': 'kick-token' });
  const status = h('div', { class: 'small', 'aria-live': 'polite', 'data-testid': 'kick-status' });
  return h('div', { class: 'stack tight', 'data-testid': 'kick' },
    card(
      h('div', { class: 'row' }, h('div', { class: 'ico ' + (on ? 'g' : 'o') }, icon('bell')), h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 650 }, 'data-testid': 'kick-state', 'data-on': on ? '1' : '0' }, on ? t('setX.kick.on') : t('setX.kick.off')), h('div', { class: 'small muted' }, on ? t('setX.kick.onHint') : t('setX.kick.offHint')))),
      on ? null : h('ol', { class: 'st-steps small' }, ['setX.kick.s1', 'setX.kick.s2', 'setX.kick.s3', 'setX.kick.s4'].map((k) => h('li', null, t(k, { repo: repo || 'utente/repo' })))),
      repo ? null : note('warn', 'alert', t('setX.kick.norepo')),
      h('form', { class: 'stack tight', onsubmit: async (e) => {
        e.preventDefault(); const v = tok.value.trim(); if (!v) return;
        await setHouse(ctx, { kick: { token: v } }); tok.value = '';
      } }, tok, btn(t('save'), null, { cls: '', type: 'submit', id: 'kick-save' })),
      on ? h('div', { class: 'btn-row' },
        btn(t('setX.kick.test'), async () => {
          status.textContent = t('setX.kick.testing');
          const r = await kickNow(ctx.house);
          status.textContent = r.ok ? t('setX.kick.testOk') : r.status === 401 || r.status === 403 ? t('setX.kick.testDenied') : r.status === 404 ? t('setX.kick.testNotFound') : t('setX.kick.testFail', { s: r.status || r.reason || '?' });
        }, { cls: 'tonal', ic: 'bell', id: 'kick-test' }),
        btn(t('setX.kick.remove'), () => setHouse(ctx, { kick: null }), { cls: 'soft', ic: 'trash', id: 'kick-remove' })) : null,
      status,
      foot(t('setX.kick.foot'))));
}
/** Chiave pubblica VAPID valida (65 byte non compressi, base64url senza padding = 87 caratteri) oppure null. */
export function validVapidPublic(v) {
  const s = String(v || '').trim().replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]{87}$/.test(s)) return null;
  try { const u = push.b64uToU8(s); return u.length === 65 && u[0] === 4 ? s : null; } catch { return null; }
}
/** Usa una chiave pubblica già esistente (stesso server notifiche per più case dello stesso progetto Firebase). */
function useKeyForm(ctx) {
  const hs = ctx.house;
  const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('setX.sched.useKeyPh'), 'aria-label': t('setX.sched.useKey'), 'data-testid': 'vapid-existing' });
  const [err, setErr] = errLine('vapid', { 'data-testid': 'vapid-existing-err' });
  return h('form', { class: 'stack tight', 'data-testid': 'vapid-use', onsubmit: async (e) => {
    e.preventDefault(); setErr('');
    const v = validVapidPublic(input.value);
    if (!v) { setErr(t('setX.sched.keyInvalid')); return; }
    if (v === hs.vapidPublic) { input.value = ''; return; }
    if (hs.vapidPublic && !(await confirmDialog({ title: t('setX.sched.useKey'), text: t('setX.sched.useKeyWarn'), ok: t('setX.sched.useKeySave'), danger: true }))) return;
    S.open.keys = true;   // la sezione resta aperta dopo il salvataggio
    if (await setHouse(ctx, { vapidPublic: v }, t('setX.sched.keyUsed'))) { S.fresh = null; input.value = ''; }
  } },
  h('div', { class: 'lbl' }, t('setX.sched.useKey')),
  h('p', { class: 'small muted' }, t('setX.sched.useKeyHelp'), ' ', t('setX.sched.useKeyHelp2')),
  input, err, btn(t('setX.sched.useKeySave'), null, { cls: 'soft', type: 'submit', id: 'vapid-existing-save' }));
}
function notifHouse(ctx) {
  const hs = ctx.house; const cfg = notifCfg(hs);
  const patch = (k, p) => setHouse(ctx, { notif: { [k]: p } });
  const dowSel = (k, c) => { const sel = h('select', { class: 'input', 'aria-label': t('sched.day'), 'data-testid': `dow-${k}` }, DOW_ORDER.map((d) => { const o = h('option', { value: String(d) }, t('sched.dow.' + d)); if (d === Number(c.dow)) o.selected = true; return o; })); sel.addEventListener('change', () => patch(k, { dow: Number(sel.value) })); return sel; };
  const timeIn = (k, c, label = t('sched.time')) => { const el = h('input', { class: 'input', type: 'time', value: c.time || '09:00', 'aria-label': label, 'data-testid': `time-${k}` }); el.addEventListener('change', () => { if (el.value) patch(k, { time: el.value }); else el.value = c.time || '09:00'; }); return el; };

  const typeCard = (d) => {
    const k = d.k; const c = cfg[k];
    const head = h('label', { class: 'st-sw st-typehead' }, h('div', { class: 'grow' }, h('div', { class: 't' }, t('notifType.' + k)), h('div', { class: 'd' }, k === 'late' ? t('notifType.late.desc', { n: c.max }) : ['friAbsence', 'satDuty', 'sunMark', 'monNew', 'planDay', 'adminDigest'].includes(k) ? t('notifType.' + k + '.desc') : t('setX.nt.' + k + '.desc'))),
      h('span', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', 'aria-label': t('notifType.' + k), 'data-testid': 'on-' + k, checked: c.on !== false, onchange: (e) => patch(k, { on: e.target.checked }) }), h('i')));
    head.querySelector('input').checked = c.on !== false;
    let body = null;
    if (c.on !== false) {
      if (d.late) {
        const times = (c.times || []).slice(0, 6);
        const upd = (arr) => patch(k, { times: [...arr].sort() });
        body = h('div', { class: 'stack tight' },
          h('div', { class: 'lbl' }, t('sched.times')),
          ...times.map((tm, i) => h('div', { class: 'st-timerow' + (i >= (c.max || 3) ? ' is-off' : ''), 'data-testid': `late-time-${i}` },
            h('input', { class: 'input', type: 'time', value: tm, 'aria-label': t('sched.time'), 'data-testid': `late-t-${i}`, onchange: (e) => { if (e.target.value) { const a = [...times]; a[i] = e.target.value; upd(a); } } }),
            i >= (c.max || 3) ? chip(t('setX.sched.unused'), 'warn') : null,
            h('button', { class: 'icon-btn st-del', type: 'button', 'aria-label': t('delete'), 'data-testid': `late-del-${i}`, disabled: times.length <= 1, onclick: () => upd(times.filter((_, j) => j !== i)) }, icon('x')))),
          times.length < 6 ? btn(t('setX.sched.addTime'), () => upd([...times, '18:00']), { ic: 'plus', id: 'late-add', cls: 'soft sm' }) : null,
          stepRow({ title: t('sched.max'), value: Number(c.max) || 3, min: 1, max: 6, id: 'step-late-max', onchange: (v) => patch(k, { max: v }) }),
          stepRow({ title: t('sched.days'), value: Number(c.days) || 4, min: 1, max: 7, id: 'step-late-days', onchange: (v) => patch(k, { days: v }) }));
      } else if (d.dow || d.time) {
        body = h('div', { class: 'st-sched' }, d.dow ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('sched.day')), dowSel(k, c)) : null, d.time ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('sched.time')), timeIn(k, c)) : null);
      }
    }
    return h('section', { class: 'card st-card stack tight', 'data-testid': 'ncard-' + k }, head, body);
  };

  // anteprima
  const prev = previewNotifications(ctx).slice(0, 30);
  const prevRows = prev.length ? prev.map((g) => liRow({ title: t('notifType.' + g.type), desc: g.names.join(', '), end: h('span', { class: 'st-when' }, `${t('dow.' + g.dow)} ${fmtDate(g.date, ctx.lang)} · ${g.time}`) })) : [h('div', { class: 'li muted', 'data-testid': 'preview-empty' }, t('setX.sched.noPreview'))];

  // chiavi push
  const fresh = S.fresh;
  const keyBlock = card(
    h('div', { class: 'row' }, h('div', { class: 'ico ' + (hs.vapidPublic ? 'g' : 'o') }, icon('lock')), h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 650 }, 'data-testid': 'vapid-state' }, hs.vapidPublic ? t('sched.pushKeys.ready') : t('sched.pushKeys.missing')))),
    hs.vapidPublic ? h('div', { class: 'stack tight' }, h('div', { class: 'lbl' }, t('sched.pushKeys.public')), mono(hs.vapidPublic, 'vapid-public'), btn(t('copy'), async () => { ctx.toast(await copyText(hs.vapidPublic) ? t('copied') : t('error')); }, { ic: 'copy', cls: 'soft sm', id: 'vapid-copy-pub' })) : null,
    fresh ? h('div', { class: 'stack tight st-fresh', 'data-testid': 'vapid-fresh' }, note('warn', 'alert', t('sched.pushKeys.warn')), h('div', { class: 'lbl' }, t('sched.pushKeys.private')), mono(fresh.privateKey, 'vapid-private'),
      h('div', { class: 'btn-row' }, btn(t('copy'), async () => { ctx.toast(await copyText(fresh.privateKey) ? t('copied') : t('error')); }, { ic: 'copy', cls: 'tonal', id: 'vapid-copy-priv' }), btn(t('setX.sched.hideKey'), () => { S.fresh = null; ctx.rerender(); }, { id: 'vapid-hide' }))) : null,
    btn(t('sched.pushKeys.generate'), async () => {
      if (hs.vapidPublic && !(await confirmDialog({ title: t('sched.pushKeys.generate'), text: t('setX.sched.regenWarn'), ok: t('sched.pushKeys.generate'), danger: true }))) return;
      try { const k = await push.generateVapid(); await ctx.actions.setHouse({ vapidPublic: k.publicKey }); S.fresh = k; saved(ctx, t('sched.pushKeys.ready')); ctx.rerender(); } catch (e) { fail(ctx, e); }
    }, { ic: 'refresh', id: 'vapid-generate', cls: hs.vapidPublic ? 'soft' : '' }),
    hs.vapidPublic ? h('p', { class: 'small muted', 'data-testid': 'vapid-gen-have' }, t('setX.sched.genHave')) : null,
    useKeyForm(ctx));

  const run = hs.serverRun;
  const stale = run && ctx.now().getTime() - new Date(run).getTime() > 3 * 3600000;
  const serverBlock = card(
    h('div', { class: 'row' }, h('div', { class: 'ico ' + (run && !stale ? 'g' : 'o') }, icon('clock')), h('div', { class: 'grow' }, h('div', { class: 't', 'data-testid': 'server-run', style: { fontWeight: 650 } }, run ? t('sched.lastRun', { when: rel(ctx, run) }) : t('sched.noRun')), stale ? h('div', { class: 'small muted' }, t('setX.sched.stale')) : null)),
    h('ol', { class: 'st-steps small' },
      h('li', null, t('setX.sched.step1')),
      h('li', null, h('code', null, 'VAPID_PRIVATE_KEY'), ' — ', t('setX.sched.step2')),
      h('li', null, h('code', null, 'FIREBASE_SERVICE_ACCOUNT'), ' — ', t('setX.sched.step3')),
      h('li', null, h('code', null, 'VAPID_SUBJECT'), ', ', h('code', null, 'BACKUP_PASSPHRASE'), ' — ', t('setX.sched.step4'))),
    h('a', { class: 'btn soft', href: README, target: '_blank', rel: 'noopener', 'data-testid': 'readme-link' }, icon('book'), t('setX.sched.readme')));

  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('sched.hint')),
    testAllBlock(ctx),
    group(null, [switchRow({ ic: 'bell', tone: 'r', title: t('sched.master'), checked: cfg.enabled !== false, id: 'sw-notif-master', onchange: (v) => patch('enabled', v) })]),
    SCHEDULED.map(typeCard),
    group(null, [stepRow({ title: t('sched.catchUp'), desc: t('setX.sched.catchUpHint'), value: Number(cfg.catchUpHours) || 5, min: 1, max: 12, id: 'step-catchUp', fmt: (v) => v + ' h', onchange: (v) => setHouse(ctx, { notif: { catchUpHours: v } }) })]),
    // sezioni di contorno richiudibili; le chiavi si aprono da sole finché mancano
    fold('preview', t('sched.preview'), [h('div', { class: 'list', 'data-testid': 'preview' }, prevRows), foot(t('setX.sched.previewNote'))], { id: 'fold-preview' }),
    fold('keys', t('sched.pushKeys'), [keyBlock], { id: 'fold-keys', open: !hs.vapidPublic || !!S.fresh, sub: hs.vapidPublic ? t('setX.sched.keyState.ready') : t('setX.sched.keyState.missing') }),
    fold('kick', t('setX.kick.title'), [kickBlock(ctx)], { id: 'fold-kick', sub: hasKick(hs) ? t('setX.kick.on') : t('setX.kick.off') }),
    fold('server', t('setX.sched.server'), [serverBlock], { id: 'fold-server', sub: hs.serverRun ? t('sched.lastRun', { when: rel(ctx, hs.serverRun) }) : t('sched.noRun') }));
}

// ============================================================================
// INVITE (codice, link, QR, nuovo codice)
// ============================================================================
function waLink(msg) { return 'https://wa.me/?text=' + encodeURIComponent(msg); }
async function qrNode(link) {
  try {
    const { default: qrcode } = await import('../../vendor/qr.js');
    const q = qrcode(0, 'M'); q.addData(link); q.make();
    return h('div', { class: 'qr', 'data-testid': 'invite-qr', role: 'img', 'aria-label': t('inv.qr'), html: q.createSvgTag({ cellSize: 4, margin: 0 }) });
  } catch (e) { console.warn(e); return null; }
}
const inviteMsg = (ctx, extra = '') => t('inv.msg', { house: ctx.house.name || '', link: ctx.joinLink(), code: ctx.code(), url: ctx.baseUrl() }) + extra;

async function inviteSection(ctx) {
  const link = ctx.joinLink(); const msg = inviteMsg(ctx);
  const qr = await qrNode(link);
  const share = typeof navigator !== 'undefined' && navigator.share ? btn(t('share'), () => navigator.share({ title: ctx.house.name || t('app.name'), text: msg }).catch(() => {}), { ic: 'share', id: 'invite-share' }) : null;
  const top = card(
    ctx.mode === 'local' ? note('warn', 'info', h('div', { 'data-testid': 'invite-local' }, t('inv.local'))) : null,
    ctx.mode === 'local' && ctx.cloudAvailable ? btn(t('data.migrate'), () => migrate(ctx), { ic: 'upload', cls: '', id: 'invite-migrate' }) : null,
    h('div', { class: 'lbl' }, t('inv.code')),
    h('div', { class: 'codebox', 'data-testid': 'invite-code' }, ctx.code()),
    h('div', { class: 'lbl' }, t('inv.link')),
    mono(link, 'invite-link'),
    h('div', { class: 'btn-row' },
      btn(t('inv.copyLink'), async () => { ctx.toast(await copyText(link) ? t('copied') : t('error')); }, { ic: 'copy', id: 'invite-copy' }),
      h('a', { class: 'btn soft', href: waLink(msg), target: '_blank', rel: 'noopener', 'data-testid': 'invite-wa' }, icon('whatsapp'), t('inv.shareWa')),
      share),
    qr ? h('div', { class: 'center' }, qr) : null,
    h('p', { class: 'small muted' }, t('inv.hint')));
  return h('div', { class: 'stack' }, top, ctx.isAdmin ? rotateBlock(ctx) : null);
}

function rotateBlock(ctx) {
  const today = ctx.today(); const people = ctx.house.roommates || [];
  if (!S.rot) S.rot = { sel: new Set(people.filter((r) => r.to && r.to <= today).map((r) => r.id)), busy: false, result: null };
  const R = S.rot;
  const rows = people.map((p) => {
    const inp = h('input', { type: 'checkbox', 'aria-label': p.name, 'data-testid': 'rot-' + p.id }); inp.checked = R.sel.has(p.id);
    inp.addEventListener('change', () => { if (inp.checked) R.sel.add(p.id); else R.sel.delete(p.id); });
    return h('label', { class: 'check st-rotrow' }, inp, avatar(p.name, ctx.color(p.id), 'sm'), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, p.name), p.to && p.to <= today ? h('div', { class: 'small muted' }, `${t('set.roommates.status.out')} · ${fmtDate(p.to, ctx.lang, { year: true })}`) : null));
  });
  const go = btn(R.busy ? t('setX.rot.working') : t('setX.rot.go'), async () => {
    if (R.busy) return;
    if (!(await confirmDialog({ title: t('setX.rot.go'), text: t('setX.rot.confirm'), ok: t('setX.rot.go'), danger: true }))) return;
    R.busy = true; ctx.rerender();
    try {
      await ctx.rotateCode({ leavingPersonIds: [...R.sel] });
      S.rot = { sel: new Set(), busy: false, result: { code: ctx.code(), link: ctx.joinLink(), name: ctx.house.name || '', at: ctx.now().toISOString() } };
      ctx.toast(t('setX.rot.done'));
    } catch (e) {
      R.busy = false; console.warn(e);
      ctx.toast(e && e.message === 'clone-failed' ? t('setX.rot.fail') : e && e.message === 'permission' ? t('err.permission') : t('error'));
    }
    ctx.rerender();
  }, { cls: 'danger', ic: 'refresh', id: 'rot-go', disabled: R.busy });
  const res = R.result ? card(note('ok', 'check', h('div', { 'data-testid': 'rot-result' }, t('setX.rot.sendNew'))),
    mono(R.result.code, 'rot-new-code'), mono(R.result.link, 'rot-new-link'),
    h('div', { class: 'btn-row' },
      btn(t('inv.copyLink'), async () => { ctx.toast(await copyText(R.result.link) ? t('copied') : t('error')); }, { ic: 'copy', id: 'rot-copy' }),
      h('a', { class: 'btn', href: waLink(t('setX.rot.msg', { house: R.result.name, link: R.result.link, code: R.result.code, url: ctx.baseUrl() })), target: '_blank', rel: 'noopener', 'data-testid': 'rot-wa' }, icon('whatsapp'), t('inv.shareWa')))) : null;
  return h('div', { class: 'stack' },
    sectionTitle(t('setX.rot.title')),
    card(h('p', { class: 'muted' }, t('setX.rot.explain')), h('ul', { class: 'st-bullets small muted' }, ['setX.rot.b1', 'setX.rot.b2', 'setX.rot.b3'].map((k) => h('li', null, t(k)))),
      h('div', { class: 'lbl' }, t('setX.rot.who')), h('div', { class: 'stack tight' }, rows), go),
    res);
}
async function migrate(ctx) {
  if (!(await confirmDialog({ title: t('data.migrate'), text: t('setX.data.migrateHint'), ok: t('data.migrate') }))) return;
  try { ctx.toast(t('data.importing')); await ctx.migrateToCloud(); ctx.toast(t('data.migrated')); ctx.nav('settings/' + (curSub || 'data')); } catch (e) { fail(ctx, e); }
}

// ============================================================================
// ACCESS (accessi e dispositivi)
// ============================================================================
const DEV_IC = { device: 'device', tablet: 'tablet', desktop: 'desktop' };
function accessSection(ctx) {
  const members = ctx.state.members || {}; const people = ctx.house.roommates || [];
  const devsOf = (pid) => Object.entries(members).filter(([, m]) => m && m.personId === pid).sort((a, b) => String(b[1].lastSeen || '').localeCompare(String(a[1].lastSeen || '')));
  const known = new Set(people.map((p) => p.id));
  const orphans = Object.entries(members).filter(([, m]) => m && (!m.personId || !known.has(m.personId)));
  const withPush = Object.values(members).filter((m) => m && m.push && m.push.endpoint).length;
  const opened = people.filter((p) => devsOf(p.id).length).length;
  const ver = ctx.actions.rulesVersion(); const needRules = ctx.actions.rulesRequired();

  const removeDev = async (id, m) => { if (await confirmDialog({ title: t('acc.remove'), text: m.name || (m.device || {}).label || id, ok: t('acc.remove'), danger: true })) save(ctx, () => ctx.store.delDoc('members', id)); };
  const devRow = ([id, m]) => {
    const d = m.device || {}; const mine = id === ctx.deviceId;
    return h('div', { class: 'li st-dev', 'data-testid': 'dev-' + id },
      h('div', { class: 'ico' }, icon(DEV_IC[d.kind] || 'device')),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, m.name || d.label || id.slice(0, 6), mine ? [' ', chip(t('setX.access.thisDevice'), 'acc')] : null),
        h('div', { class: 'd' }, [d.label, m.version ? 'v' + m.version : '', m.lang ? String(m.lang).toUpperCase() : ''].filter(Boolean).join(' · ')),
        h('div', { class: 'd' }, `${t('acc.openedLast', { when: rel(ctx, m.lastSeen) })}`),
        h('div', { class: 'st-chips' },
          m.push && m.push.endpoint ? chip(t('acc.pushOn'), 'ok', 'bell') : chip(t('acc.pushOff'), '', 'bellOff'),
          m.standalone ? chip(t('setX.access.installed'), '', 'home') : null,
          m.isAdmin ? chip(t('acc.admin'), 'acc', 'shield') : null,
          needRules ? (m.rulesAck && m.rulesAck.version === ver ? chip(t('setX.access.rulesOk'), 'ok', 'check') : chip(t('setX.access.rulesNo'), 'warn')) : null)),
      mine ? null : h('button', { class: 'icon-btn st-del', type: 'button', 'aria-label': t('acc.remove'), 'data-testid': 'dev-del-' + id, onclick: () => removeDev(id, m) }, icon('trash')));
  };
  const personBlock = (p) => {
    const devs = devsOf(p.id);
    const nudge = btn(t('acc.nudge'), () => save(ctx, () => ctx.actions.nudge(p.id), t('acc.nudgeSent')), { ic: 'bell', cls: 'tonal sm', id: 'nudge-' + p.id });
    return h('div', { class: 'stack tight st-person-acc' + (devs.length ? '' : ' never'), 'data-testid': 'acc-' + p.id },
      h('div', { class: 'list' },
        h('div', { class: 'li' }, avatar(p.name, ctx.color(p.id)), h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 'd' }, devs.length ? t('setX.access.devCount', { n: devs.length }) : t('acc.neverOpened'))), devs.length ? null : nudge),
        devs.map(devRow)));
  };
  const views = Object.entries(ctx.state.views || {}).sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || ''))).slice(0, 100);
  const clear = async () => {
    if (!(await confirmDialog({ title: t('acc.clearViews'), text: t('setX.access.clearWarn'), ok: t('acc.clearViews'), danger: true }))) return;
    const ids = Object.keys(ctx.state.views || {});
    save(ctx, async () => { for (let i = 0; i < ids.length; i += 400) await ctx.store.write(ids.slice(i, i + 400).map((id) => ({ coll: 'views', id, del: true }))); });
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('acc.hint')),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'v', 'data-testid': 'kpi-people' }, `${opened}/${people.length}`), h('div', { class: 'k' }, t('acc.people'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v', 'data-testid': 'kpi-devices' }, Object.keys(members).length), h('div', { class: 'k' }, t('acc.devices'))),
      h('div', { class: 'kpi' }, h('div', { class: 'v', 'data-testid': 'kpi-push' }, withPush), h('div', { class: 'k' }, t('acc.push')))),
    people.length ? people.map(personBlock) : [h('div', { class: 'empty' }, icon('users'), t('acc.noPeople'))],
    orphans.length ? h('div', { class: 'stack tight' }, sectionTitle(t('setX.access.unassigned')), h('div', { class: 'list' }, orphans.map(devRow))) : null,
    h('div', { class: 'stack tight' }, h('div', { class: 'eyebrow' }, h('span', null, t('acc.viewsLog')), views.length ? h('button', { type: 'button', 'data-testid': 'views-clear', onclick: clear }, t('acc.clearViews')) : null), renderViewsLog(ctx), foot(t('setX.access.viewsNote', { n: 100 }))));
}

// ============================================================================
// DATA (dati e backup)
// ============================================================================
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Sheet con un campo segreto (passphrase). `run(pass)` può lanciare: l'errore viene mostrato nel sheet. Risolve col risultato o null. */
function askSecret(ctx, { title, text, ok, run, repeat = false, min = 1 }) {
  return new Promise((resolve) => {
    let done = false;
    const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'off', 'aria-label': t('setX.data.passphrase'), placeholder: t('setX.data.passphrase'), 'data-testid': 'pass-1' });
    const p2 = repeat ? h('input', { class: 'input', type: 'password', autocomplete: 'off', 'aria-label': t('setX.data.passphrase2'), placeholder: t('setX.data.passphrase2'), 'data-testid': 'pass-2' }) : null;
    const err = h('div', { class: 'small', style: { color: 'var(--bad)' }, 'aria-live': 'polite', 'data-testid': 'pass-error' });
    const finish = (v) => { if (done) return; done = true; resolve(v); sh.close(); };
    const sh = ctx.sheet({ title, onClose: () => { if (!done) { done = true; resolve(null); } }, body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (p1.value.length < min) { err.textContent = t('setX.sec.short', { n: min }); return; }
      if (p2 && p1.value !== p2.value) { err.textContent = t('setX.sec.mismatch'); return; }
      try { finish(await run(p1.value)); } catch (ex) { err.textContent = ex && ex.message === 'wrong-passphrase' ? t('setX.data.wrongPass') : t('error'); }
    } }, text ? h('p', { class: 'muted' }, text) : null, p1, p2, err, h('div', { class: 'btn-row' }, btn(t('cancel'), () => finish(null)), btn(ok || t('ok'), null, { cls: '', type: 'submit', id: 'pass-ok' }))) });
    setTimeout(() => p1.focus(), 420);
  });
}

const KEEP_FIELDS = ['adminHash', 'adminSalt', 'vapidPublic', 'serverRun', 'prevIds', 'rotatedAt', 'ignoreLeft', 'kick'];
/** Costruisce la casa da importare mantenendo PIN, chiavi push e storico dei codici di quella attuale. */
function importedHouse(cur, incoming) {
  const hs = { ...incoming, id: cur.id };
  for (const k of KEEP_FIELDS) { if (cur[k] !== undefined) hs[k] = cur[k]; else delete hs[k]; }
  const ids = new Set((hs.roommates || []).map((r) => r.id));
  let admins = (incoming.adminIds || []).filter((id) => ids.has(id));
  if (!admins.length) admins = (cur.adminIds || []).filter((id) => ids.has(id));
  if (!admins.length && hs.roommates && hs.roommates.length) admins = [hs.roommates[0].id];
  hs.adminIds = admins;
  return hs;
}
function remapWeeks(weeks, map) {
  const m = (id) => map[id] || id; const out = {};
  for (const [k, w] of Object.entries(weeks || {})) {
    const x = { ...w };
    if (x.awayMap) x.awayMap = Object.fromEntries(Object.entries(x.awayMap).map(([id, v]) => [m(id), v]));
    if (x.result) x.result = Object.fromEntries(Object.entries(x.result).map(([c, v]) => [c, /^(by|skipped):/.test(v) ? v.replace(/:(.+)$/, (_, id) => ':' + m(id)) : v]));
    if (x.swap) x.swap = Object.fromEntries(Object.entries(x.swap).map(([c, id]) => [c, m(id)]));
    out[k] = x;
  }
  return out;
}

function confirmImport(ctx, { lines, warnings = [], build }) {
  const sh = ctx.sheet({ title: t('data.import'), body: h('div', { class: 'stack' },
    h('div', { class: 'list', 'data-testid': 'import-summary' }, lines.map(([k, v]) => h('div', { class: 'li' }, h('div', { class: 'grow t' }, k), h('div', { class: 'end', style: { color: 'var(--text)', fontWeight: 600 } }, v)))),
    warnings.length ? note('warn', 'alert', h('div', null, warnings.map((w) => h('div', null, w)))) : null,
    note('bad', 'alert', t('data.importReplace')),
    h('p', { class: 'small muted' }, t('setX.data.keepPin')),
    h('div', { class: 'btn-row' }, btn(t('cancel'), () => sh.close(), { id: 'import-cancel' }), btn(t('setX.data.doImport'), async () => {
      sh.close();
      try { ctx.toast(t('data.importing')); await ctx.importBackup(build()); ctx.toast(t('data.imported')); ctx.rerender(); } catch (e) { console.warn(e); ctx.toast(t('error')); }
    }, { cls: 'danger', ic: 'upload', id: 'import-confirm' }))) });
}

async function importXlsx(ctx, u8) {
  let imp;
  try { const [{ default: XLSX }, { parseWorkbook }] = await Promise.all([import('../../vendor/xlsx.js'), import('../xlsx-import.js')]); imp = parseWorkbook(XLSX, u8); }
  catch (e) { console.warn(e); ctx.toast(t('setX.data.badSheet')); return; }
  const cur = ctx.house; const byName = Object.fromEntries((cur.roommates || []).map((r) => [r.name.trim().toLowerCase(), r]));
  const map = {}; const roommates = imp.roommates.map((r) => { const old = byName[r.name.trim().toLowerCase()]; if (old) { map[r.id] = old.id; return { ...r, id: old.id, color: old.color || null }; } return r; });
  const warnings = imp.warnings.map((w) => t('setX.data.warn.' + w.code, { v: w.value }));
  confirmImport(ctx, {
    lines: [[t('set.roommates'), roommates.map((r) => r.name).join(', ')], [t('set.firstSunday'), fmtDate(imp.startSunday, ctx.lang, { year: true })], [t('misc.week'), String(Object.keys(imp.weeks).length)]], warnings,
    build: () => ({ app: 'casa-pulita', version: 1, data: { house: importedHouse(cur, { ...cur, roommates, startSunday: imp.startSunday, settings: { ...(cur.settings || {}), ...(imp.settings || {}) }, adminIds: cur.adminIds }), weeks: remapWeeks(imp.weeks, map) } }),
  });
}

async function importFile(ctx, file) {
  try {
    const u8 = new Uint8Array(await file.arrayBuffer());
    if ((u8[0] === 0x50 && u8[1] === 0x4b) || /\.xlsx?$/i.test(file.name)) return await importXlsx(ctx, u8);
    let obj; try { obj = JSON.parse(new TextDecoder().decode(u8)); } catch { ctx.toast(t('setX.data.badFile')); return; }
    if (obj && obj.app === 'casa-pulita-enc') {
      const enc = obj;
      obj = await askSecret(ctx, { title: t('setX.data.passTitle'), text: t('setX.data.passText'), ok: t('setX.data.decrypt'), run: (p) => decryptBackup(enc, p) });
      if (!obj) return;
    }
    if (!obj || obj.app !== 'casa-pulita' || !obj.data || validateHouse(obj.data.house).length) { ctx.toast(t('setX.data.badFile')); return; }
    const d = obj.data; const cur = ctx.house;
    confirmImport(ctx, {
      lines: [[t('set.houseName'), d.house.name || '—'], [t('set.roommates'), (d.house.roommates || []).map((r) => r.name).join(', ')], [t('misc.week'), String(Object.keys(d.weeks || {}).length)], [t('nav.trips'), String(Object.keys(d.trips || {}).length)], ...(obj.exportedAt ? [[t('setX.data.exportedAt'), fmtDate(String(obj.exportedAt).slice(0, 10), ctx.lang, { year: true })]] : [])],
      build: () => ({ app: 'casa-pulita', version: obj.version || 1, data: { ...d, house: importedHouse(cur, d.house) } }),
    });
  } catch (e) { console.warn(e); ctx.toast(t('error')); }
}

function dataSection(ctx) {
  const hs = ctx.house; const base = `tidyhouse-${fileSlug(hs.name)}-${ctx.today()}`;
  const eh = () => ctx.calc.eh, out = () => ctx.calc.out;
  const guard = (fn) => async () => { try { await fn(); } catch (e) { fail(ctx, e); } };
  const exp = [
    liRow({ ic: 'download', tone: 'g', title: t('data.exportJson'), onclick: guard(() => { download(`${base}.json`, JSON.stringify(exportBackup(ctx.state), null, 2), 'application/json'); ctx.toast(t('data.exported')); }) }),
    liRow({ ic: 'lock', tone: 'g', title: t('setX.data.exportEnc'), desc: t('setX.data.exportEncHint'), onclick: guard(async () => {
      const blob = await askSecret(ctx, { title: t('setX.data.exportEnc'), text: t('setX.data.exportEncText'), ok: t('setX.data.encrypt'), repeat: true, min: 6, run: async (p) => JSON.stringify(await encryptBackup(exportBackup(ctx.state), p)) });
      if (blob) { download(`${base}.enc.json`, blob, 'application/json'); ctx.toast(t('data.exported')); }
    }) }),
    liRow({ ic: 'history', tone: 'g', title: t('data.exportCsv'), onclick: guard(() => { download(`${base}.csv`, toCsv(historyRows(eh(), out(), ctx.lang, ctx.state.weeks || {})), 'text/csv;charset=utf-8'); ctx.toast(t('data.exported')); }) }),
    liRow({ ic: 'chart', tone: 'g', title: t('data.exportXlsx'), onclick: guard(async () => {
      const [{ default: XLSX }, { buildWorkbook }] = await Promise.all([import('../../vendor/xlsx.js'), import('../xlsx-import.js')]);
      let stats = null; try { stats = buildStats(eh(), out()); } catch { stats = null; }
      const wb = buildWorkbook(XLSX, eh(), out(), stats, ctx.lang, ctx.state.weeks || {});
      download(`${base}.xlsx`, new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: XLSX_MIME })); ctx.toast(t('data.exported'));
    }) }),
    liRow({ ic: 'print', tone: 'g', title: t('data.print'), onclick: () => window.print() }),
  ];
  const fileIn = h('input', { type: 'file', class: 'sr', accept: '.json,.xlsx,application/json,' + XLSX_MIME, 'data-testid': 'import-file', onchange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importFile(ctx, f); } });
  const imp = h('label', { class: 'li st-import', 'data-testid': 'import-label' }, h('div', { class: 'ico o' }, icon('upload')), h('div', { class: 'grow' }, h('div', { class: 't' }, t('data.import')), h('div', { class: 'd' }, t('data.importHint'))), h('div', { class: 'end' }, icon('chevron')), fileIn);
  const mode = card(
    h('div', { class: 'row' }, h('div', { class: 'ico ' + (ctx.cloud ? 'g' : 'o') }, icon(ctx.cloud ? 'globe' : 'device')), h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 650 }, 'data-testid': 'data-mode' }, ctx.cloud ? t('data.mode.cloud') : t('data.mode.local')))),
    ctx.mode === 'local' && ctx.cloudAvailable ? btn(t('data.migrate'), () => migrate(ctx), { ic: 'upload', cls: '', id: 'data-migrate' }) : null,
    ctx.mode === 'local' && !ctx.cloudAvailable ? h('p', { class: 'small muted' }, t('inv.local')) : null);
  const resetSheet = () => {
    const inp = h('input', { class: 'input', autocomplete: 'off', placeholder: hs.name || '', 'aria-label': t('data.resetConfirm'), 'data-testid': 'reset-name' });
    const go = btn(t('data.reset'), async () => { sh.close(); try { await ctx.deleteHouse(); } catch (e) { fail(ctx, e); } }, { cls: 'danger', ic: 'trash', id: 'reset-confirm', disabled: true });
    inp.addEventListener('input', () => { go.disabled = inp.value.trim().toLowerCase() !== String(hs.name || '').trim().toLowerCase() || !inp.value.trim(); });
    const sh = ctx.sheet({ title: t('data.reset'), body: h('div', { class: 'stack' }, note('bad', 'alert', t('setX.data.resetWarn')), h('label', { class: 'field' }, h('span', { class: 'lbl' }, `${t('data.resetConfirm')}: ${hs.name || ''}`), inp), h('div', { class: 'btn-row' }, btn(t('cancel'), () => sh.close()), go)) });
    setTimeout(() => inp.focus(), 420);
  };
  return h('div', { class: 'stack' },
    mode,
    group(t('setX.data.export'), exp),
    group(t('setX.data.import'), [imp], t('setX.data.importFoot')),
    group(null, [liRow({ ic: 'refresh', tone: '', title: t('data.autoBackup'), desc: t('setX.data.autoBackupText') })]),
    group(t('setX.data.danger'), [
      h('button', { class: 'li', type: 'button', 'data-testid': 'data-leave', onclick: async () => { if (await confirmDialog({ title: t('setX.data.leave'), text: t('setX.data.leaveHint'), ok: t('setX.data.leave'), danger: true })) ctx.leaveHouse(); } }, h('div', { class: 'ico o' }, icon('x')), h('div', { class: 'grow t' }, t('setX.data.leave'))),
      h('button', { class: 'li', type: 'button', 'data-testid': 'data-reset', onclick: resetSheet }, h('div', { class: 'ico r' }, icon('trash')), h('div', { class: 'grow t', style: { color: 'var(--bad)' } }, t('data.reset'))),
    ]));
}

// ============================================================================
// AI
// ============================================================================
function aiSection(ctx) {
  const cfg = readAiConfig(); const prov = PROVIDERS[cfg.provider] ? cfg.provider : 'anthropic';
  const upd = (patch) => { const cur = readAiConfig(); if (!writeAiConfig({ ...cur, provider: PROVIDERS[cur.provider] ? cur.provider : 'anthropic', ...patch })) ctx.toast(t('error')); else saved(ctx); };
  const keyIn = h('input', { class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: cfg.key ? '••••••••••••' : t('uxb.ai.keyPh'), enterkeyhint: 'done', 'aria-label': t('ai.key'), 'data-testid': 'ai-key' });
  keyIn.addEventListener('change', () => { const v = keyIn.value.trim(); if (!v) return; upd({ key: v }); keyIn.value = ''; ctx.rerender(); });
  const testBtn = btn(t('ai.test'), async () => {
    const c = readAiConfig(); if (!c.key) { ctx.toast(t('ai.noKey')); return; }
    testBtn.disabled = true;
    try { await callAi({ provider: c.provider || prov, model: c.model || undefined, key: c.key, system: 'Reply with the single word OK.', user: 'ping' }); ctx.toast(t('ai.test.ok')); }
    catch (e) { ctx.toast(`${t('ai.err')}${e && e.message ? ': ' + e.message : ''}`.slice(0, 140)); }
    finally { testBtn.disabled = false; }
  }, { ic: 'check', cls: 'tonal', id: 'ai-test' });
  const enabled = !!(ctx.house.ai && ctx.house.ai.enabled);
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('ai.hint')),
    card(h('div', { class: 't', style: { fontWeight: 700 } }, t('ai.what')), h('p', { class: 'small muted' }, t('ai.whatText'))),
    group(null, [switchRow({ ic: 'sparkles', tone: 'p', title: t('ai.enable'), checked: enabled, id: 'sw-ai', onchange: (v) => setHouse(ctx, { ai: { enabled: v } }) })]),
    group(t('ai.provider'), [
      selectRow({ title: t('ai.provider'), value: prov, id: 'ai-provider', options: Object.entries(PROVIDERS).map(([k, p]) => [k, p.label]), onchange: (v) => { upd({ provider: v, model: '' }); ctx.rerender(); } }),
      textRow({ title: t('ai.model'), value: cfg.model || '', placeholder: PROVIDERS[prov].model, id: 'ai-model', onchange: (v) => upd({ model: v.trim() }) }),
      h('label', { class: 'li st-text' }, h('div', { class: 'grow' }, h('div', { class: 't' }, t('ai.key')), h('div', { class: 'd' }, cfg.key ? t('ai.keyLocal') : t('setX.ai.noKeyYet'))), keyIn),
    ], t('setX.ai.keyFoot')),
    h('div', { class: 'btn-row' }, testBtn, btn(t('ai.remove'), () => { const c = readAiConfig(); delete c.key; writeAiConfig(c); saved(ctx); ctx.rerender(); }, { ic: 'trash', id: 'ai-remove', disabled: !cfg.key })),
    h('p', { class: 'small muted' }, t('ai.disclosure')),
    btn(t('ai.parse'), () => openAiImportSheet(ctx), { cls: '', ic: 'sparkles', id: 'ai-import' }));
}

// ============================================================================
// SECURITY
// ============================================================================
function adminChangeForm(ctx) {
  const today = ctx.today(); const admins = ctx.house.adminIds || [];
  // candidati: chi è ancora in casa; il primo della lista non deve essere un admin già in carica (un tap sbagliato lo lascerebbe uguale)
  const cand = (ctx.house.roommates || []).filter((r) => !(r.to && r.to < today));
  const list = [...cand.filter((r) => !admins.includes(r.id)), ...cand.filter((r) => admins.includes(r.id))];
  const sel = h('select', { class: 'input', 'aria-label': t('setX.admin.who'), 'data-testid': 'newadmin-who' }, list.map((r) => h('option', { value: r.id }, r.name)));
  const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', enterkeyhint: 'done', placeholder: t('sec.newPin'), 'aria-label': t('sec.newPin'), 'data-testid': 'newadmin-pin' });
  const [err, setErr] = errLine('admin');
  return h('form', { class: 'stack tight', onsubmit: async (e) => {
    e.preventDefault(); setErr('');
    if (pin.value.length < 4) { setErr(t('setX.sec.short', { n: 4 })); return; }
    if (!(await confirmDialog({ title: t('setX.admin.title'), text: t('setX.admin.confirm'), danger: true }))) return;
    try { await ctx.actions.changeAdmin({ personId: sel.value, pin: pin.value }); pin.value = ''; ctx.toast(t('setX.admin.done')); ctx.rerender(); } catch (ex) { fail(ctx, ex); }
  } }, h('div', { class: 't', style: { fontWeight: 700 } }, t('setX.admin.title')), h('p', { class: 'small muted' }, t('setX.admin.hint')), h('div', { class: 'field' }, h('label', null, t('setX.admin.who')), sel), pin, err, btn(t('setX.admin.title'), null, { cls: '', type: 'submit', id: 'admin-change' }));
}
function securitySection(ctx) {
  const cur = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'next', placeholder: t('join.adminPin'), 'aria-label': t('join.adminPin'), 'data-testid': 'pin-old' });
  const n1 = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', enterkeyhint: 'next', placeholder: t('sec.newPin'), 'aria-label': t('sec.newPin'), 'data-testid': 'pin-new' });
  const n2 = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', enterkeyhint: 'done', placeholder: t('setX.sec.repeat'), 'aria-label': t('setX.sec.repeat'), 'data-testid': 'pin-new2' });
  const [err, setErr] = errLine('pin', { 'data-testid': 'pin-error' });
  const form = h('form', { class: 'stack tight', onsubmit: async (e) => {
    e.preventDefault(); setErr('');
    try {
      if (!(await verifyPin(ctx.house, cur.value))) { setErr(t('join.wrongPin')); cur.select(); return; }
      if (n1.value.length < 4) { setErr(t('setX.sec.short', { n: 4 })); return; }
      if (n1.value !== n2.value) { setErr(t('setX.sec.mismatch')); return; }
      const salt = newSalt(); const hash = await hashPin(n1.value, salt);
      if (await save(ctx, () => ctx.actions.setHouse({ adminSalt: salt, adminHash: hash }), t('sec.pinChanged'))) { cur.value = n1.value = n2.value = ''; }
    } catch (ex) { fail(ctx, ex); }
  } }, h('div', { class: 't', style: { fontWeight: 700 } }, t('sec.changePin')), cur, n1, n2, err, btn(t('sec.changePin'), null, { cls: '', type: 'submit', id: 'pin-save' }));
  return h('div', { class: 'stack' },
    card(h('div', { class: 'row' }, h('div', { class: 'ico g' }, icon('unlock')), h('div', { class: 'grow t', style: { fontWeight: 650 } }, t('sec.unlocked')))),
    card(form),
    card(adminChangeForm(ctx)),
    group(null, [h('button', { class: 'li', type: 'button', 'data-testid': 'sec-lock', onclick: () => { ctx.lockAdmin(); ctx.toast(t('sec.locked')); ctx.nav('settings'); } }, h('div', { class: 'ico r' }, icon('lock')), h('div', { class: 'grow t' }, t('sec.lock')))]),
    foot(t('sec.note')));
}
