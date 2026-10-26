// Impostazioni: indice a liste raggruppate + sottopagine (#/settings/<sezione>).
// Personali (tutti): profile, appearance, home, notifications. Amministrazione (solo admin): house, rules, roommates,
// features, links, notif-house, invite*, access, data, ai, security. (*invite: codice/link visibili a tutti, rotazione solo admin)
import { h, icon, loadCss, avatar, stepper, seg, liRow, copyText, download, confirmDialog, deviceInfo } from '../ui.js';
import { t, registerStrings, fmtDate, fmtWeekRange, LANGS } from '../i18n.js';
import { DEFAULT_FEATURES, NOTIF_TYPES, HOME_WIDGETS, DEFAULT_HOME, PALETTE, planNotifications, notifCfg, effortOf, localParts, uid, buildStats, historyRows, toCsv, validateHouse } from '../extras.js';
import { validateRoommates, addDays, DEFAULT_SETTINGS, CHORES } from '../engine.js';
import { exportBackup, verifyPin, hashPin, newSalt } from '../actions.js';
import { encryptBackup, decryptBackup } from '../backupcrypto.js';
import * as push from '../push.js';
import { openAiImportSheet, readAiConfig, writeAiConfig } from '../ai-ui.js';
import { PROVIDERS, callAi } from '../ai.js';
import { it, en } from '../strings/set.js';
registerStrings(it, en);
loadCss('css/settings.css');

const README = 'https://github.com/iantomasi-nicola/tidyhouse#readme';

// ============================================================================
// Stato effimero (sopravvive ai rerender; si azzera cambiando sezione)
// ============================================================================
let curSub = null;
const S = { rm: null, rmBase: '', rmColor: null, fresh: null, rot: null, homeBusy: false };
function resetDrafts() { S.rm = null; S.rmBase = ''; S.rmColor = null; S.fresh = null; S.rot = null; }

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
  const inp = h('input', { class: 'input', type, value: value ?? '', placeholder, 'data-testid': id, inputmode, autocomplete, autocapitalize: type === 'text' ? 'sentences' : 'off', spellcheck: 'false', maxlength, 'aria-label': title });
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
  data: { admin: true, ic: 'download', tone: 'g', title: 'set.data', build: dataSection, sum: (c) => (c.mode === 'cloud' ? t('data.mode.cloud').split(' ')[0] === 'Modalità' ? t('data.mode.local') : t('misc.synced') : t('misc.localOnly')) },
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
  if (sub !== curSub) { resetDrafts(); curSub = sub; }
  const def = SECTIONS[sub];
  if (!sub || !def) return indexPage(ctx);
  if (def.admin && !def.open && !ctx.isAdmin) return page(ctx, t(def.title), h('div', { class: 'empty', 'data-testid': 'admin-only' }, icon('lock'), h('div', { style: { fontWeight: 650, color: 'var(--text)' } }, t('ai.adminOnly')), h('div', { class: 'small' }, t('setX.adminOnly.hint'))));
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

function indexPage(ctx) {
  const hs = ctx.house; const me = ctx.me;
  const meCard = h('a', { class: 'st-me', href: '#/settings/profile', 'data-testid': 'st-me' },
    avatar(ctx.meName || '?', me ? ctx.color(me) : '#888', 'lg'),
    h('div', { class: 'grow' }, h('div', { class: 'st-me-name' }, ctx.meName || t('setX.noWho')), h('div', { class: 'small muted' }, `${hs.name || ''} · ${ctx.cloud ? t('data.mode.cloud').replace(/^.*?$/, t('misc.synced')) : t('misc.localOnly')}`)),
    ctx.isAdmin ? chip(t('misc.admin'), 'acc', 'shield') : null, icon('chevron'));
  const groups = INDEX.filter(([, , adm]) => !adm || ctx.isAdmin).map(([label, keys]) =>
    group(t(label), keys.map((k) => { const d = SECTIONS[k]; let sum = ''; try { sum = d.sum(ctx); } catch { /* ignore */ } return liRow({ ic: d.ic, tone: d.tone, title: t(d.title), desc: sum, href: '#/settings/' + k }); })));
  return h('div', { class: 'st-page stack', 'data-testid': 'settings-index' },
    h('h1', { class: 'title' }, t('set.title')),
    meCard, groups,
    h('div', { class: 'st-about' }, h('div', null, `${t('app.name')} · ${t('misc.version', { v: ctx.VERSION || '' })}`), h('a', { href: '#/guide' }, t('guide.title'))));
}

