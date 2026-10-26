// Schermata "Altro": hub + sotto-pagine (scorte, regole, ultimo che esce, checklist, scambi, registro, guida, info).
// Esporta anche `renderRulesContent(houseOrCtx)` (usato dal gate regole) e `openLastOutSheet(ctx)`.
import { h, icon, loadCss, liRow, empty, avatar, toggle, stepper, seg, confirmDialog, confetti, clear } from '../ui.js';
import { t, getLang, fmtDate, fmtWeekRange, dowLong, registerStrings } from '../i18n.js';
import { CHORES, DEFAULT_SETTINGS, addDays } from '../engine.js';
import { LASTOUT_DEFAULT_KEYS, TASK_TEMPLATES, tasksForWeek, nextDueWeek, weekIndex, weekOfDate, uid } from '../extras.js';
import { it, en } from '../strings/more.js';

registerStrings(it, en);

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
  return `${dowLong(day, ctx.lang)} ${fmtDate(day, ctx.lang, { year: day.slice(0, 4) !== today.slice(0, 4) })}`;
}
const personName = (ctx, id) => (id === 'admin' ? t('misc.admin') : id ? ctx.name(id) : '—');
/** Esegue un'azione mostrando un toast se fallisce. */
async function attempt(ctx, fn) {
  try { return await fn(); } catch (e) { console.error(e); ctx.toast(e && e.message === 'permission' ? t('err.permission') : t('error')); return undefined; }
}
const chip = (cls, ...kids) => h('span', { class: 'chip ' + cls }, ...kids);
const card = (...kids) => h('section', { class: 'card stack' }, ...kids);
function head(title, { back = '#/more', right = null } = {}) {
  return h('div', { class: 'mx-head' }, back ? h('a', { class: 'icon-btn mx-back', href: back, 'aria-label': t('back') }, icon('back')) : null, h('h1', { class: 'title' }, title), right ? h('div', { class: 'mx-right' }, right) : null);
}
function offPage(title) {
  return h('div', { class: 'mx mx-sub' }, head(title), empty('lock', t('moreX.off'), t('moreX.offHint')));
}
const shell = (...kids) => { loadCss('css/more.css'); return h('div', { class: 'mx mx-sub fade-up' }, ...kids); };

// ================================================================ hub
function hub(ctx) {
  const f = (k) => ctx.feature(k);
  const house = ctx.house;
  const needsOpen = Object.values(ctx.state.needs || {}).filter((n) => !n.done).length;
  const inReq = ctx.badges().more || 0;
  const tasksOn = (house.tasks || []).filter((x) => x.enabled !== false).length;
  const badge = (n, cls = 'bad') => (n > 0 ? chip(cls, String(n)) : undefined);
  const row = (o) => liRow(o);
  const group = (title, rows) => (rows.filter(Boolean).length ? h('section', null, title ? h('div', { class: 'eyebrow' }, title) : null, h('div', { class: 'list' }, rows.filter(Boolean))) : null);

  const me = ctx.me ? ctx.meName : null;
  const profile = h('section', { class: 'card mx-me' },
    avatar(me || '?', ctx.me ? ctx.color(ctx.me) : '#888', 'lg'),
    h('div', { class: 'grow' }, h('div', { class: 'mx-me-name' }, me || t('misc.person')), h('div', { class: 'muted small' }, house.name || 'Tidy House')),
    h('div', { class: 'mx-me-chips' }, ctx.isAdmin ? chip('acc', icon('shield'), t('misc.admin')) : null, chip('', icon(ctx.cloud ? 'users' : 'device'), ctx.cloud ? t('moreX.cloud') : t('misc.localOnly'))));

  const ai = ctx.isAdmin && house.ai && house.ai.enabled
    ? h('button', { type: 'button', class: 'btn tonal block mx-ai', onclick: async () => {
      try { const m = await import('../ai-ui.js'); await m.openAiImportSheet(ctx); } catch (e) { console.warn(e); ctx.toast(t('moreX.aiMissing')); }
    } }, icon('sparkles'), t('moreX.ai'))
    : null;

  return shell(
    h('h1', { class: 'title' }, t('more.title')),
    profile,
    group(t('moreX.g.house'), [
      f('needs') ? row({ ic: 'cart', tone: 'o', title: t('more.needs'), desc: needsOpen ? t('moreX.needsOpen', { n: needsOpen }) : t('needs.empty'), end: badge(needsOpen, 'warn'), href: '#/needs' }) : null,
      f('requests') ? row({ ic: 'swap', tone: 'p', title: t('more.requests'), desc: t('moreX.d.requests'), end: badge(inReq), href: '#/requests' }) : null,
      f('lastout') ? row({ ic: 'plane', tone: 'g', title: t('more.lastout'), desc: t('moreX.d.lastout'), href: '#/lastout' }) : null,
      f('tasks') ? row({ ic: 'list', tone: '', title: t('more.tasks'), desc: tasksOn ? t('moreX.tasksOn', { n: tasksOn }) : t('moreX.d.tasks'), href: '#/tasks' }) : null,
      f('rules') ? row({ ic: 'book', tone: 'r', title: t('more.rules'), desc: t('moreX.d.rules'), href: '#/rules' }) : null,
      f('activity') ? row({ ic: 'history', tone: '', title: t('more.activity'), desc: t('moreX.d.activity'), href: '#/activity' }) : null,
    ]),
    ai,
    group(t('moreX.g.manage'), [
      ctx.isAdmin ? row({ ic: 'users', tone: 'g', title: t('more.invite'), desc: t('moreX.d.invite'), href: '#/settings/invite' }) : null,
      row({ ic: 'download', tone: '', title: t('more.export'), desc: t('moreX.d.export'), href: '#/settings/data' }),
      row({ ic: 'settings', tone: '', title: t('more.settings'), desc: t('moreX.d.settings'), href: '#/settings' }),
    ]),
    group(t('moreX.g.app'), [
      row({ ic: 'device', tone: 'p', title: t('more.guide'), desc: isStandalone() ? t('guide.installed') : t('moreX.d.guide'), href: '#/guide' }),
      row({ ic: 'info', tone: '', title: t('more.about'), desc: t('misc.version', { v: ctx.VERSION || '' }), href: '#/more/about' }),
    ]),
    h('p', { class: 'mx-ver muted small center' }, `${t('app.name')} · ${t('misc.version', { v: ctx.VERSION || '' })}`));
}

// ================================================================ scorte e spesa
let needDraft = { text: '', urgent: false };
function needsPage(ctx) {
  if (!ctx.feature('needs')) return offPage(t('needs.title'));
  const house = ctx.house;
  const inp = h('input', { class: 'input', id: 'mx-need', type: 'text', maxlength: '80', autocomplete: 'off', enterkeyhint: 'done', placeholder: t('needs.placeholder'), 'aria-label': t('needs.add'), value: needDraft.text, oninput: (e) => { needDraft.text = e.target.value; } });
  const urgentSw = toggle(needDraft.urgent, (v) => { needDraft.urgent = v; }, t('needs.urgent'));
  const listBox = h('div', { class: 'stack' });

  const add = async () => {
    const text = inp.value.trim();
    if (!text) { inp.focus(); return; }
    const ok = await attempt(ctx, async () => { await ctx.actions.addNeed(text, needDraft.urgent); return true; });
    if (!ok) return;
    needDraft = { text: '', urgent: false }; inp.value = ''; urgentSw.querySelector('input').checked = false;
    ctx.haptic(ctx.prefs.haptics, 8); paint(); inp.focus();
  };
  const form = h('form', { class: 'card stack tight mx-needform', onsubmit: (e) => { e.preventDefault(); add(); } },
    h('div', { class: 'field' }, h('label', { for: 'mx-need' }, t('needs.add')), h('div', { class: 'mx-addrow' }, inp, h('button', { type: 'submit', class: 'btn', 'aria-label': t('add') }, icon('plus'), h('span', { class: 'mx-hide-s' }, t('add'))))),
    h('div', { class: 'row-between' }, h('div', { class: 'row' }, icon('alert'), h('span', { class: 'mx-lblb' }, t('needs.urgent'))), urgentSw));

  function paint() {
    const entries = Object.entries(ctx.state.needs || {}).map(([id, n]) => ({ id, ...n }));
    const open = entries.filter((n) => !n.done).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || String(b.at || '').localeCompare(String(a.at || '')));
    const done = entries.filter((n) => n.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
    clear(listBox);
    listBox.append(open.length
      ? h('div', null, h('div', { class: 'eyebrow' }, t('needs.open'), chip('', String(open.length))), h('div', { class: 'list' }, open.map((n) => needRow(n, false))))
      : h('div', { class: 'card' }, empty('cart', t('needs.empty'))));
    if (done.length) {
      listBox.append(h('div', null,
        h('div', { class: 'eyebrow' }, t('needs.history'), h('button', { type: 'button', onclick: async () => {
          if (!(await confirmDialog({ title: t('needs.clearDone'), text: t('moreX.clearConfirm', { n: done.length }), ok: t('needs.clearDone'), danger: true }))) return;
          await attempt(ctx, () => ctx.actions.clearBought()); paint();
        } }, t('needs.clearDone'))),
        h('div', { class: 'list mx-done' }, done.map((n) => needRow(n, true)))));
    }
  }
  function needRow(n, isDone) {
    const by = ctx.name(n.by);
    return h('div', { class: 'li mx-need' + (isDone ? ' done' : '') + (n.urgent && !isDone ? ' urgent' : '') },
      h('button', { type: 'button', class: 'checkcircle' + (isDone ? ' on' : ''), 'aria-pressed': String(isDone), 'aria-label': (isDone ? t('moreX.undoBought') : t('needs.bought')) + ': ' + n.text, onclick: async () => {
        await attempt(ctx, () => ctx.actions.setNeedDone(n.id, !isDone)); if (!isDone) ctx.haptic(ctx.prefs.haptics, 10); paint();
      } }, icon('check')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, n.text, n.urgent && !isDone ? chip('bad mx-urg', icon('alert'), t('needs.urgent')) : null),
        h('div', { class: 'd' }, isDone ? `${t('moreX.boughtBy', { name: ctx.name(n.doneBy) })} · ${whenLabel(ctx, n.doneAt)}` : `${t('needs.addedBy', { name: by })} · ${whenLabel(ctx, n.at)}`)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${t('delete')}: ${n.text}`, onclick: async () => { await attempt(ctx, () => ctx.actions.removeNeed(n.id)); paint(); } }, icon('trash')));
  }
  paint();
  const tri = house.links && house.links.tricount && house.links.tricount.url;
  return shell(head(t('needs.title')), form, h('div', { class: 'note' }, icon('info'), t('needs.rule')), listBox,
    tri ? h('a', { class: 'btn tonal block', href: tri, target: '_blank', rel: 'noopener' }, icon('tricount'), t('home.tricount')) : null);
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
  const s = ctx.sheet({ title: t('rules.edit'), full: true, body: h('div', { class: 'stack' },
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

function rulesPage(ctx) {
  if (!ctx.feature('rules')) return offPage(t('rules.title'));
  const house = ctx.house; const lang = ctx.lang;
  const custom = customText(house, lang);
  const ver = String((house.rules && house.rules.version) || 1);
  const admin = ctx.isAdmin;
  const kids = [head(t('rules.title'), { right: admin ? h('button', { type: 'button', class: 'btn tonal sm', onclick: () => openRulesEditor(ctx) }, icon('edit'), t('rules.edit')) : null })];
  kids.push(h('div', { class: 'mx-chips' }, custom ? chip('acc', icon('edit'), t('rules.custom')) : null, chip('', t('misc.version', { v: ver }))));
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
  let rows = lastoutItems(house).map((i) => ({ ...i }));
  const list = h('div', { class: 'stack tight' });
  const paint = () => {
    clear(list);
    rows.forEach((r, i) => {
      list.append(h('div', { class: 'mx-edrow' },
        h('input', { class: 'input', type: 'text', maxlength: '140', value: r.text, 'aria-label': `${t('lastout.addItem')} ${i + 1}`, oninput: (e) => { r.text = e.target.value; } }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('moreX.moveUp'), disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; paint(); } }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('moreX.moveDown'), disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; paint(); } }, icon('down')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${t('delete')} ${i + 1}`, onclick: () => { rows.splice(i, 1); paint(); } }, icon('trash'))));
    });
  };
  paint();
  const s = ctx.sheet({ title: t('lastout.edit'), full: true, body: h('div', { class: 'stack' }, list,
    h('button', { type: 'button', class: 'btn tonal block', onclick: () => { rows.push({ id: uid(), text: '' }); paint(); const ins = list.querySelectorAll('input'); ins[ins.length - 1].focus(); } }, icon('plus'), t('lastout.addItem')),
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

// ================================================================ checklist ricorrenti
const everyLabel = (n) => (n === 1 ? t('tasks.week1') : `${t('tasks.every')} ${t('tasks.weeksN', { n })}`);

function openTaskSheet(ctx, task, preset = {}) {
  const house = ctx.house;
  const cur = weekOfDate(house, ctx.today());
  const S = { id: task ? task.id : uid(), chore: (task && task.chore) || preset.chore || 'floor', text: (task && task.text) || preset.text || '', every: (task && parseInt(task.every, 10)) || preset.every || 1,
    anchor: task && task.anchor ? (addDays(task.anchor, 0)) : cur, enabled: task ? task.enabled !== false : true };
  // anchor è una data qualsiasi: la porto alla domenica della sua settimana
  S.anchor = weekOfDate(house, S.anchor);
  const first = house.startSunday > cur ? house.startSunday : cur;
  const opts = new Set([S.anchor]); for (let k = 0; k < 13; k++) opts.add(addDays(first, 7 * k));
  const anchors = [...opts].sort();
  const textI = h('input', { class: 'input', id: 'mx-task-text', type: 'text', maxlength: '120', value: S.text, placeholder: t('tasks.name'), oninput: (e) => { S.text = e.target.value; } });
  const anchorSel = h('select', { class: 'input', id: 'mx-task-anchor', onchange: (e) => { S.anchor = e.target.value; } },
    anchors.map((a) => h('option', { value: a, selected: a === S.anchor }, `${fmtWeekRange(a)}${a === cur ? ' · ' + t('moreX.thisWeek') : ''}`)));
  const s = ctx.sheet({ title: task ? t('edit') : t('tasks.add'), full: true, body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
    h('div', { class: 'field' }, h('label', { for: 'mx-task-text' }, t('tasks.name')), textI),
    h('div', { class: 'field' }, h('div', { class: 'lbl' }, t('tasks.forChore')), seg(CHORES.map((c) => [c, t('chore.' + c)]), S.chore, (v) => { S.chore = v; })),
    h('div', { class: 'row-between' }, h('div', { class: 'lbl mx-lblb' }, t('tasks.every')), h('div', { class: 'row' }, stepper(S.every, { min: 1, max: 26, onchange: (v) => { S.every = v; } }), h('span', { class: 'muted' }, t('tasks.weeks')))),
    h('div', { class: 'field' }, h('label', { for: 'mx-task-anchor' }, t('tasks.firstDue')), anchorSel),
    task ? h('div', { class: 'row-between' }, h('div', { class: 'lbl mx-lblb' }, t('tasks.enabled')), toggle(S.enabled, (v) => { S.enabled = v; }, t('tasks.enabled'))) : null,
    h('div', { class: 'btn-row' },
      task ? h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog({ title: t('delete'), text: task.text, ok: t('delete'), danger: true }))) return;
        const ok = await attempt(ctx, async () => { await ctx.actions.setHouse({ tasks: (ctx.house.tasks || []).filter((x) => x.id !== task.id) }); return true; });
        if (ok) s.close();
      } }, icon('trash'), t('delete')) : null,
      h('button', { type: 'button', class: 'btn soft', onclick: () => s.close() }, t('cancel')),
      h('button', { type: 'submit', class: 'btn' }, icon('check'), t('save')))) });
  async function save() {
    const text = S.text.trim(); if (!text) { textI.focus(); return; }
    const rec = { id: S.id, chore: S.chore, text, every: S.every, anchor: S.anchor, enabled: S.enabled };
    const list = [...(ctx.house.tasks || [])]; const i = list.findIndex((x) => x.id === S.id);
    if (i >= 0) list[i] = { ...list[i], ...rec }; else list.push(rec);
    const ok = await attempt(ctx, async () => { await ctx.actions.setHouse({ tasks: list }); return true; });
    if (ok) { ctx.toast(t('saved')); s.close(); }
  }
  setTimeout(() => textI.focus(), 380);
}

function tasksPage(ctx) {
  if (!ctx.feature('tasks')) return offPage(t('tasks.title'));
  const house = ctx.house; const admin = ctx.isAdmin;
  const tasks = house.tasks || [];
  const cur = weekOfDate(house, ctx.today()); const idx = weekIndex(house, cur);
  const due = tasksForWeek(house, ctx.state.weeks || {}, cur); const byId = Object.fromEntries(due.map((x) => [x.task.id, x]));
  const rowFor = (task) => {
    const off = task.enabled === false; const s = byId[task.id];
    const every = Math.max(1, parseInt(task.every, 10) || 1);
    let status = null; let desc = everyLabel(every);
    if (off) status = chip('', t('off'));
    else if (s && s.status === 'done') status = chip('ok', icon('check'), s.done && s.done.by ? t('tasks.doneBy', { name: personName(ctx, s.done.by) }) : t('done'));
    else if (s && s.status === 'due') status = chip('warn', icon('clock'), t('tasks.due'));
    else if (s && s.status === 'overdue') status = chip('bad', icon('alert'), t('tasks.overdue', { date: fmtDate(s.since, ctx.lang) }));
    else {
      const k = nextDueWeek(house, task, idx); const sunday = addDays(house.startSunday, 7 * k);
      desc += ` · ${t('tasks.nextDue', { date: fmtWeekRange(sunday) })}`;
      status = chip('', t('tasks.dueIn', { n: Math.max(1, k - idx) }));
    }
    const main = h('div', { class: 'grow' }, h('div', { class: 't' }, task.text), h('div', { class: 'd' }, desc), h('div', { class: 'mx-st' }, status));
    if (!admin) return h('div', { class: 'li mx-task' + (off ? ' off' : '') }, main);
    return h('div', { class: 'li mx-task' + (off ? ' off' : '') },
      h('button', { type: 'button', class: 'mx-taskmain', 'aria-label': `${t('edit')}: ${task.text}`, onclick: () => openTaskSheet(ctx, task) }, main),
      toggle(!off, (v) => attempt(ctx, () => ctx.actions.setHouse({ tasks: (ctx.house.tasks || []).map((x) => (x.id === task.id ? { ...x, enabled: v } : x)) })), `${t('tasks.enabled')}: ${task.text}`));
  };
  const kids = [head(t('tasks.title'), { right: admin ? h('button', { type: 'button', class: 'btn sm', onclick: () => openTaskSheet(ctx, null) }, icon('plus'), t('tasks.add')) : null }),
    h('p', { class: 'muted' }, t('tasks.hint'))];
  const known = new Set(CHORES);
  const groups = [...CHORES, null];
  let any = false;
  for (const c of groups) {
    const list = tasks.filter((x) => (c ? x.chore === c : !known.has(x.chore)));
    if (!list.length) continue; any = true;
    kids.push(h('section', null,
      h('div', { class: 'eyebrow' }, h('span', { class: 'mx-chore' }, c ? h('i', { class: 'mx-ct ' + c }, icon(CHORE_ICON[c])) : null, c ? t('chore.' + c) : t('chore.any'))),
      h('div', { class: 'list' }, list.map(rowFor))));
  }
  if (!any) kids.push(h('div', { class: 'card' }, empty('list', t('tasks.empty'))));
  if (!admin) kids.push(h('div', { class: 'note' }, icon('lock'), t('moreX.readOnly')));
  if (admin) {
    const tpl = TASK_TEMPLATES.filter((x) => !tasks.some((y) => y.chore === x.chore && y.text === t(x.key)));
    if (tpl.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('tasks.templates')),
      h('div', { class: 'mx-tpl' }, tpl.map((x) => h('button', { type: 'button', class: 'mx-tplbtn', onclick: () => openTaskSheet(ctx, null, { chore: x.chore, text: t(x.key), every: x.every }) },
        h('i', { class: 'mx-ct ' + x.chore }, icon(CHORE_ICON[x.chore])), h('span', { class: 'grow' }, t(x.key)), h('span', { class: 'chip' }, everyLabel(x.every)))))));
  }
  return shell(...kids);
}

// ================================================================ scambi turno
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
function requestsPage(ctx) {
  if (!ctx.feature('requests')) return offPage(t('req.title'));
  const me = ctx.me; const admin = ctx.isAdmin;
  const all = Object.entries(ctx.state.requests || {}).filter(([, r]) => r.kind !== 'nudge').map(([id, r]) => ({ id, ...r }));
  const pending = all.filter((r) => r.status === 'pending');
  const incoming = pending.filter((r) => r.to === me);
  const sent = pending.filter((r) => r.from === me);
  const others = admin ? pending.filter((r) => r.from !== me && r.to !== me) : [];
  const history = all.filter((r) => r.status !== 'pending' && (admin || r.from === me || r.to === me))
    .sort((a, b) => String(b.answeredAt || b.at || '').localeCompare(String(a.answeredAt || a.at || ''))).slice(0, 20);
  const line = (r) => t('moreX.reqLine', { from: ctx.name(r.from), to: ctx.name(r.to), a: t('chore.' + r.fromChore), b: t('chore.' + r.toChore), week: fmtWeekRange(r.week) });
  const answer = (r, ok) => attempt(ctx, async () => { await ctx.actions.answerSwap(r.id, ok); ctx.toast(ok ? t('req.accepted') : t('req.declined')); });
  const incomingCard = (r) => h('div', { class: 'card stack tight mx-req' },
    h('div', { class: 'row' }, avatar(ctx.name(r.from), ctx.color(r.from)), h('p', { class: 'grow' }, t('req.incoming', { name: ctx.name(r.from), theirs: t('chore.' + r.toChore).toLowerCase(), mine: t('chore.' + r.fromChore).toLowerCase(), week: fmtWeekRange(r.week) }))),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn soft', onclick: () => answer(r, false) }, icon('x'), t('req.decline')), h('button', { type: 'button', class: 'btn', onclick: () => answer(r, true) }, icon('check'), t('req.accept'))));
  const sentRow = (r, adminView) => h('div', { class: 'li mx-req' }, icon('swap'),
    h('div', { class: 'grow' }, h('div', { class: 't' }, adminView ? line(r) : t('moreX.outgoing', { to: ctx.name(r.to), mine: t('chore.' + r.fromChore).toLowerCase(), theirs: t('chore.' + r.toChore).toLowerCase(), week: fmtWeekRange(r.week) })), h('div', { class: 'd' }, whenLabel(ctx, r.at))),
    adminView ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm soft', onclick: () => answer(r, false) }, t('req.decline')), h('button', { type: 'button', class: 'btn sm', onclick: () => answer(r, true) }, t('req.accept'))) : chip('warn', t('req.pending')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${t('req.cancel')}: ${line(r)}`, title: t('req.cancel'), onclick: () => attempt(ctx, () => ctx.actions.cancelSwap(r.id)) }, icon('x')));
  const kids = [head(t('req.title'), { right: me ? h('button', { type: 'button', class: 'btn sm', onclick: () => askSwap(ctx) }, icon('plus'), t('req.new')) : null })];
  if (incoming.length) kids.push(h('section', { class: 'stack tight' }, h('div', { class: 'eyebrow' }, t('moreX.reqForMe'), chip('bad', String(incoming.length))), incoming.map(incomingCard)));
  if (sent.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.reqSent')), h('div', { class: 'list' }, sent.map((r) => sentRow(r, false)))));
  if (others.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.reqAll')), h('div', { class: 'list' }, others.map((r) => sentRow(r, true)))));
  if (!incoming.length && !sent.length && !others.length) kids.push(h('div', { class: 'card' }, empty('swap', t('req.empty'), me ? t('moreX.reqEmptyHint') : null)));
  if (history.length) kids.push(h('section', null, h('div', { class: 'eyebrow' }, t('moreX.reqHistory')),
    h('div', { class: 'list' }, history.map((r) => h('div', { class: 'li mx-req' }, h('div', { class: 'grow' }, h('div', { class: 't' }, line(r)), h('div', { class: 'd' }, whenLabel(ctx, r.answeredAt || r.at))),
      r.status === 'accepted' ? chip('ok', icon('check'), t('req.accepted')) : chip('bad', t('req.declined')))))));
  return shell(...kids);
}

// ================================================================ registro attività
let actLimit = 60;
const ACT_ICON = { done: ['check', 'g'], cover: ['swap', 'p'], skipped: ['x', 'r'], reset: ['refresh', ''], away: ['plane', 'o'], back: ['home', 'g'], trip: ['plane', 'o'], plan: ['calendar', ''], swap: ['swap', 'p'], need: ['cart', 'o'], task: ['list', 'g'], settings: ['settings', ''], roommates: ['users', ''], import: ['upload', ''] };
function actText(ctx, e) {
  const p = e.p || {};
  if (!ACT_ICON[e.type]) return t('act.generic', { name: personName(ctx, e.by), text: p.text || e.type || '' });
  return t('act.' + e.type, {
    name: personName(ctx, e.by), chore: p.chore ? t('chore.' + p.chore).toLowerCase() : '', who: p.who ? ctx.name(p.who) : '',
    day: p.day ? `${dowLong(p.day, ctx.lang)} ${fmtDate(p.day, ctx.lang)}` : '', text: p.text || '',
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
function aboutPage(ctx) {
  const house = ctx.house;
  return shell(head(t('more.about')),
    h('section', { class: 'card mx-about center stack' }, h('div', { class: 'logo mx-logo' }, icon('broom')), h('h2', null, t('app.name')), h('p', { class: 'muted' }, t('moreX.aboutText')),
      chip('', t('misc.version', { v: ctx.VERSION || '' }))),
    h('div', { class: 'list' },
      liRow({ ic: 'home2', title: house.name || t('app.name'), desc: ctx.cloudStatusLabel ? ctx.cloudStatusLabel() : '' }),
      liRow({ ic: 'link', title: t('moreX.repo'), desc: REPO.replace('https://', ''), href: REPO, end: undefined }),
      liRow({ ic: 'book', title: t('moreX.readme'), desc: t('moreX.readmeDesc'), href: REPO + '#readme' })),
    h('p', { class: 'muted small center' }, t('moreX.credits')));
}

// ================================================================ entry point
export async function render(ctx, params = {}) {
  loadCss('css/more.css');
  const sub = (params && params.sub) || '';
  switch (sub) {
    case 'needs': return needsPage(ctx);
    case 'rules': return rulesPage(ctx);
    case 'lastout': return lastoutPage(ctx);
    case 'tasks': return tasksPage(ctx);
    case 'requests': return requestsPage(ctx);
    case 'activity': return activityPage(ctx);
    case 'guide': return guidePage(ctx);
    case 'about': return aboutPage(ctx);
    default: return hub(ctx);
  }
}
