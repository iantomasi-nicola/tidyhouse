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
    h('div', { class: 'grow' }, h('div', { class: 'st-me-name' }, ctx.meName || t('setX.noWho')), h('div', { class: 'small muted' }, `${hs.name || ''} · ${ctx.cloud ? t('misc.synced') : t('misc.localOnly')}`)),
    ctx.isAdmin ? chip(t('misc.admin'), 'acc', 'shield') : null, icon('chevron'));
  const groups = INDEX.filter(([, , adm]) => !adm || ctx.isAdmin).map(([label, keys]) =>
    group(t(label), keys.map((k) => { const d = SECTIONS[k]; let sum = ''; try { sum = d.sum(ctx); } catch { /* ignore */ } return liRow({ ic: d.ic, tone: d.tone, title: t(d.title), desc: sum, href: '#/settings/' + k }); })));
  return h('div', { class: 'st-page stack', 'data-testid': 'settings-index' },
    h('h1', { class: 'title' }, t('set.title')),
    meCard, groups,
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
  const p = ctx.prefs; const accent = (p.accent || '#0a84ff').toLowerCase();
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
    card(h('div', { class: 'lbl' }, t('set.accent')), sw),
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
  if (s === 'on') buttons.push(btn(t('set.notif.test'), () => run(push.localTest, t('set.notif.testSent')), { cls: 'tonal', ic: 'bell', id: 'push-test' }), btn(t('set.notif.disable'), () => run(push.disable, t('push.disabled')), { cls: 'soft', ic: 'bellOff', id: 'push-disable' }));
  sbox.append(
    h('div', { class: 'row' }, h('div', { class: 'ico ' + (s === 'on' ? 'g' : s === 'denied' ? 'r' : '') }, icon(s === 'on' ? 'bell' : 'bellOff')),
      h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 650 }, 'data-testid': 'push-state', 'data-state': s }, statusText))),
    buttons.length ? h('div', { class: 'btn-row' }, buttons) : null);
  if (s === 'ios-install') sbox.append(h('ol', { class: 'st-steps' }, ['guide.ios1', 'guide.ios2', 'guide.ios3', 'guide.ios4'].map((k) => h('li', null, t(k)))));
  if (s === 'denied') sbox.append(h('p', { class: 'small muted' }, t('setX.notif.deniedHelp')));

  const m = (ctx.state.members || {})[ctx.deviceId] || {}; const mp = m.prefs || {}; const pp = ctx.prefs.notif || {};
  const cfg = notifCfg(ctx.house);
  const val = (k) => (k in mp ? mp[k] : k in pp ? pp[k] : true) !== false;
  const offBy = (k) => cfg.enabled === false || (cfg[k] && cfg[k].on === false) || (NT_FEATURE[k] && !ctx.feature(NT_FEATURE[k]));
  const types = NOTIF_TYPES.filter((k) => k !== 'adminDigest' || ctx.isAdmin);
  const rows = types.map((k) => {
    const hasDesc = ['friAbsence', 'satDuty', 'sunMark', 'late', 'monNew', 'planDay', 'adminDigest'].includes(k);
    const desc = hasDesc ? t('notifType.' + k + '.desc', { n: cfg.late.max }) : t('setX.nt.' + k + '.desc');
    return switchRow({ title: t('notifType.' + k), desc: offBy(k) ? h('span', null, desc, ' ', chip(t('setX.notif.offByAdmin'), 'warn')) : desc, checked: val(k), id: 'nt-' + k,
      onchange: (v) => save(ctx, async () => { ctx.savePrefs({ notif: { ...(ctx.prefs.notif || {}), [k]: v } }); await ctx.actions.touchMember({ prefs: { [k]: v } }); }) });
  });
  return h('div', { class: 'stack' },
    card(sbox),
    cfg.enabled === false ? note('warn', 'alert', t('setX.notif.masterOff')) : null,
    group(t('set.notif.mine'), rows, t('setX.notif.foot')),
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
      stepRow({ title: t('set.refreshMin'), desc: ctx.feature('refresh') ? null : t('setX.house.refreshOff'), value: Math.max(1, Number(hs.refreshMin) || 5), min: 1, max: 120, step: 1, id: 'step-refreshMin', fmt: (v) => v + ' min', onchange: (v) => setHouse(ctx, { refreshMin: v }) }),
      switchRow({ ic: 'book', title: t('setX.house.requireRules'), desc: t('setX.house.requireRulesHint'), checked: hs.requireRules !== false, id: 'sw-requireRules', onchange: (v) => setHouse(ctx, { requireRules: v }) }),
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
      st('minRest', t('set.minRest'), t('setX.rules.minRestHint'), 1, 4),
      st('startPriority', t('set.startPriority'), t('setX.rules.startPriorityHint'), 0, 12),
      st('window', t('set.window'), t('setX.rules.windowHint'), 0, 260, 4, (v) => (v === 0 ? t('setX.rules.always') : String(v))),
      st('minNights', t('set.minNights'), t('setX.rules.minNightsHint'), 1, 7),
    ]),
    h('section', { class: 'card st-card stack' },
      h('div', null, h('div', { class: 't', style: { fontWeight: 700 } }, t('setX.rules.effort')), h('p', { class: 'small muted' }, t('setX.rules.effortHint'))),
      effort),
    h('section', { class: 'card st-card stack tight' }, h('div', { class: 'lbl' }, t('setX.rules.rankBy')), rank, h('p', { class: 'small muted' }, t('setX.rules.rankByHint'))));
}

// ============================================================================
// ROOMMATES (editor come nel foglio)
// ============================================================================
const normRm = (r) => ({ id: r.id || null, name: String(r.name || '').trim(), slot: Number(r.slot) || 1, from: r.from || null, to: r.to || null, color: r.color || null });
const rmList = () => S.rm.map(({ _k, ...r }) => r);
const rmDirty = () => JSON.stringify(rmList().map(normRm)) !== S.rmBase;
function rmInit(ctx) {
  const base = JSON.stringify((ctx.house.roommates || []).map(normRm));
  if (!S.rm || (S.rmBase !== base && !rmDirty())) { S.rm = (ctx.house.roommates || []).map((r) => ({ ...r, slot: Number(r.slot) || 1, _k: r.id })); S.rmBase = base; }
}
function rmIssues(list, today) {
  const rows = list.map((r) => ({ ...normRm(r) }));
  const issues = new Set(validateRoommates(rows.filter((r) => r.name || true), today));
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
    const d = rmDirty(); saveBtn.disabled = !d; cancelBtn.hidden = !d;
  };
  const list = h('div', { class: 'stack', 'data-testid': 'rm-list' });
  const draw = () => { list.replaceChildren(...S.rm.map((r, i) => personCard(r, i))); refresh(); };

  function statusOf(r) { if (r.to && r.to < today) return ['out', 'bad']; if (r.from && r.from > today) return ['arriving', 'warn']; return ['home', 'ok']; }
  function personCard(r, i) {
    const [st, kind] = statusOf(r);
    const color = r.color || PALETTE[i % PALETTE.length];
    const name = h('input', { class: 'input', value: r.name || '', placeholder: t('set.roommates.name'), 'aria-label': t('set.roommates.name'), 'data-testid': 'rm-name-' + i, maxlength: 30, autocomplete: 'off' });
    name.addEventListener('input', () => { r.name = name.value; refresh(); });
    const dateIn = (key, label, testid) => { const el = h('input', { class: 'input', type: 'date', value: r[key] || '', 'aria-label': label, 'data-testid': testid }); el.addEventListener('change', () => { r[key] = el.value || null; draw(); }); return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), el); };
    const pal = S.rmColor === r._k ? h('div', { class: 'swatches st-pal' }, PALETTE.map((c) => h('button', { type: 'button', style: { background: c }, 'aria-label': c, 'aria-pressed': String(c === r.color), onclick: () => { r.color = c; S.rmColor = null; draw(); } })),
      h('label', { class: 'st-colorpick', title: t('setX.appearance.custom') }, h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#0a84ff', 'aria-label': t('setX.appearance.custom'), onchange: (e) => { r.color = e.target.value; S.rmColor = null; draw(); } }), icon('plus'))) : null;
    const slot = seg([1, 2, 3, 4].map((n) => [n, String(n)]), Number(r.slot) || 1, (v) => { r.slot = v; refresh(); });
    slot.setAttribute('aria-label', t('set.roommates.slot'));
    return h('section', { class: 'card st-card st-person stack tight', 'data-testid': 'rm-card-' + i },
      h('div', { class: 'row' },
        h('button', { class: 'st-dot', type: 'button', style: { background: color }, 'aria-label': t('set.roommates.color'), 'aria-expanded': String(S.rmColor === r._k), onclick: () => { S.rmColor = S.rmColor === r._k ? null : r._k; draw(); } }, (r.name || '?').trim().slice(0, 1).toUpperCase()),
        h('div', { class: 'grow' }, name),
        chip(t('set.roommates.status.' + st), kind)),
      pal,
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, t('set.roommates.slot')), slot),
      h('div', { class: 'st-dates' }, dateIn('from', t('set.roommates.from'), 'rm-from-' + i), dateIn('to', t('set.roommates.to'), 'rm-to-' + i)),
      h('div', { class: 'btn-row' },
        btn(t('set.roommates.moveOut'), () => moveOutSheet(r), { ic: 'unlock', id: 'rm-out-' + i }),
        btn(t('setX.rm.replace'), () => replaceSheet(r), { ic: 'swap', id: 'rm-replace-' + i }),
        h('button', { class: 'icon-btn st-del', type: 'button', 'aria-label': t('set.roommates.remove'), 'data-testid': 'rm-del-' + i, onclick: async () => { if (await confirmDialog({ title: t('set.roommates.remove'), text: t('set.roommates.removeHint'), ok: t('set.roommates.remove'), danger: true })) { S.rm.splice(i, 1); draw(); } } }, icon('trash'))));
  }

  function afterExit() { ctx.toast(t('setX.rm.exitSaved')); }
  function moveOutSheet(r) {
    const d = h('input', { class: 'input', type: 'date', value: r.to || today, 'aria-label': t('set.roommates.to'), 'data-testid': 'out-date' });
    const sh = ctx.sheet({ title: `${t('set.roommates.moveOut')} · ${r.name}`, body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('setX.rm.moveOutHint')), h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('set.roommates.to')), d),
      h('div', { class: 'btn-row' }, btn(t('cancel'), () => sh.close()), btn(t('set.roommates.moveOut'), async () => {
        if (!d.value) return; if (r.from && d.value < r.from) { ctx.toast(t('trips.invalid')); return; }
        r.to = d.value; sh.close(); if (await rmSave(ctx)) afterExit();
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
        r.to = d.value; S.rm.push({ _k: 'n' + uid(), name, slot: Number(r.slot) || 1, from: addDays(d.value, 1), to: null, color: null });
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
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('set.roommates.hint')),
    hint, list, warnBox,
    h('div', { class: 'btn-row' }, btn(t('set.roommates.add'), () => { S.rm.push({ _k: 'n' + uid(), name: '', slot: nextSlot(), from: null, to: null, color: null }); draw(); setTimeout(() => { const el = list.querySelector(`[data-testid="rm-name-${S.rm.length - 1}"]`); if (el) el.focus(); }, 30); }, { ic: 'plus', id: 'rm-add' })),
    h('div', { class: 'st-savebar' }, cancelBtn, saveBtn));
  function nextSlot() { const used = new Set(S.rm.filter((r) => !r.to || r.to >= today).map((r) => Number(r.slot))); for (let s = 1; s <= 4; s++) if (!used.has(s)) return s; return 1; }
}

// ============================================================================
// FEATURES
// ============================================================================
const FEAT_IC = { needs: 'cart', stats: 'chart', tasks: 'list', lastout: 'lock', requests: 'swap', planDay: 'calendar', whatsapp: 'whatsapp', activity: 'history', trips: 'plane', rules: 'book', ranking: 'trophy', ics: 'calendar', refresh: 'refresh', selfDone: 'check', selfAway: 'plane', coverOthers: 'users' };
function featuresSection(ctx) {
  const mk = (k) => switchRow({ ic: FEAT_IC[k], title: t('set.feat.' + k), checked: ctx.feature(k), id: 'feat-' + k, onchange: (v) => setHouse(ctx, { features: { [k]: v } }) });
  const keys = Object.keys(DEFAULT_FEATURES);
  const perm = ['selfDone', 'selfAway', 'coverOthers'];
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, t('set.feat.hint')),
    group(t('set.features'), keys.filter((k) => !perm.includes(k)).map(mk)),
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
      switchRow({ ic, title: t('set.showOnHome'), checked: cur.show !== false && (cur.show === true || key === 'tricount'), id: 'link-show-' + key, onchange: (v) => setHouse(ctx, { links: { [key]: { show: v } } }) }),
    ]);
  };
  const custom = L.custom || [];
  const setCustom = (arr) => setHouse(ctx, { links: { custom: arr } });
  const customRows = custom.map((c, i) => h('div', { class: 'st-custom', 'data-testid': 'custom-' + i },
    h('div', { class: 'st-custom-head' },
      h('input', { class: 'input', value: c.label || '', placeholder: t('set.linkLabel'), 'aria-label': t('set.linkLabel'), 'data-testid': 'custom-label-' + i, maxlength: 30, onchange: (e) => { const arr = custom.map((x) => ({ ...x })); arr[i].label = e.target.value.trim().slice(0, 30); setCustom(arr); } }),
      h('button', { class: 'icon-btn st-del', type: 'button', 'aria-label': t('delete'), 'data-testid': 'custom-del-' + i, onclick: () => { setCustom(custom.filter((_, j) => j !== i)); } }, icon('trash'))),
    h('input', { class: 'input', type: 'url', inputmode: 'url', value: c.url || '', placeholder: 'https://', 'aria-label': t('set.linkUrl'), 'data-testid': 'custom-url-' + i, onchange: (e) => { const u = normUrl(e.target.value); if (!u) { ctx.toast(t('setX.links.https')); e.target.value = c.url || ''; return; } const arr = custom.map((x) => ({ ...x })); arr[i].url = u; setCustom(arr); } }),
    switchRow({ title: t('set.showOnHome'), checked: c.show !== false, id: 'custom-show-' + i, onchange: (v) => { const arr = custom.map((x) => ({ ...x })); arr[i].show = v; setCustom(arr); } })));
  const addSheet = () => {
    const lab = h('input', { class: 'input', placeholder: t('set.linkLabel'), 'aria-label': t('set.linkLabel'), maxlength: 30, 'data-testid': 'add-label' });
    const url = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'https://', 'aria-label': t('set.linkUrl'), 'data-testid': 'add-url' });
    const sh = ctx.sheet({ title: t('set.customLink'), body: h('form', { class: 'stack', onsubmit: async (e) => {
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
