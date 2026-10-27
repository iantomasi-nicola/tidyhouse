// Interfaccia dell'importazione da messaggio con IA (solo admin). Nulla viene applicato senza conferma.
import { h, icon } from './ui.js';
import { t, fmtDate, fmtWeekRange, registerStrings } from './i18n.js';
import { buildPrompt, callAi, extractJson, validateAiOutput } from './ai.js';
import { CHORES } from './engine.js';
import { loadOf } from './assignlogic.js';
import { it, en } from './strings/set.js';
import { it as itA, en as enA } from './strings/assign.js';
registerStrings(it, en);
registerStrings(itA, enA);

const KEY = 'cp:ai';
/** Configurazione IA di QUESTO dispositivo ({provider, model, key}); la chiave non va mai nel cloud. */
export function readAiConfig() { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
export function writeAiConfig(cfg) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; } catch { return false; } }

export function openAiImportSheet(ctx) {
  if (!ctx.isAdmin) { ctx.toast(t('ai.adminOnly')); return null; }
  const cfg = readAiConfig();
  const hasKey = !!cfg.key;
  const ta = h('textarea', { class: 'input', placeholder: t('ai.parse.ph'), rows: 5, 'aria-label': t('ai.parse'), 'data-testid': 'ai-text' });
  const out = h('div', { class: 'stack tight', 'aria-live': 'polite' });
  const run = h('button', { class: 'btn', type: 'button', 'data-testid': 'ai-run', onclick: () => interpret() }, icon('sparkles'), t('ai.parse.run'));
  const apply = h('button', { class: 'btn', type: 'button', hidden: true, 'data-testid': 'ai-apply' }, icon('check'), t('ai.parse.apply'));
  let items = [];
  const s = ctx.sheet({
    title: t('ai.parse'), full: true,
    body: h('div', { class: 'stack' },
      hasKey ? null : h('div', { class: 'note warn' }, icon('alert'), h('div', null, t('ai.noKey'), ' ', h('a', { href: '#/settings/ai', onclick: () => s.close(), 'data-testid': 'ai-open-settings' }, t('ai.openSettings')))),
      ta,
      h('p', { class: 'small muted', 'data-testid': 'ai-assign-hint' }, t('assign.ai.hint')),
      h('p', { class: 'small muted' }, t('ai.disclosure')),
      h('div', { class: 'btn-row' }, run),
      out, apply),
  });

  const show = (node) => { out.replaceChildren(node); };
  const chk = (label, sub, checked) => {
    const inp = h('input', { type: 'checkbox' }); inp.checked = checked;
    return { inp, el: h('label', { class: 'check', style: { alignItems: 'center' } }, inp, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, label), sub ? h('div', { class: 'small muted' }, sub) : null)) };
  };

  async function interpret() {
    const text = ta.value.trim(); if (!text) { ta.focus(); return; }
    const c = readAiConfig();
    if (!c.key) { show(h('div', { class: 'note warn' }, icon('alert'), h('div', null, t('ai.noKey'), ' ', h('a', { href: '#/settings/ai', onclick: () => s.close() }, t('ai.openSettings'))))); return; }
    run.disabled = true; apply.hidden = true; show(h('p', { class: 'muted small' }, t('setX.ai.working')));
    try {
      const { out: o } = ctx.calc, today = ctx.today();
      const rows = o.rows.slice(Math.max(0, o.cur - 12), (o.cur < 0 ? 0 : o.cur) + 4);
      const { system, user } = buildPrompt({ text, house: ctx.house, today, rows, admin: ctx.meName });
      const raw = await callAi({ provider: c.provider || 'anthropic', model: c.model || undefined, key: c.key, system, user });
      const res = validateAiOutput(extractJson(raw), ctx.house, { today, firstSunday: ctx.house.startSunday, rows: o.rows });
      render(res);
    } catch (e) {
      const msg = e && e.message === 'no-key' ? t('ai.noKey') : `${t('ai.err')}${e && e.message && !/^no-json$|^provider$/.test(e.message) ? ': ' + e.message : ''}`;
      show(h('div', { class: 'note bad' }, icon('alert'), h('div', { 'data-testid': 'ai-error' }, msg)));
    } finally { run.disabled = false; }
  }

  /** Voci scartate dalla validazione, con il motivo (solo informativo). */
  function rejectedBox(list) {
    if (!list.length) return null;
    const wk = (w) => (/^\d{4}-\d{2}-\d{2}$/.test(w) ? fmtWeekRange(w, ctx.lang) : '');
    return h('div', { class: 'stack tight', 'data-testid': 'ai-rejected' }, h('div', { class: 'eyebrow' }, t('assign.ai.rejTitle')),
      list.map((x) => h('div', { class: 'small muted' }, t('assign.ai.rejItem', {
        what: [CHORES.includes(x.chore) ? t('chore.' + x.chore) : '', wk(x.week), x.person].filter(Boolean).join(' · ') || '—',
        reason: t('assign.ai.rej.' + x.reason, { person: x.person || '?' }),
      }))));
  }

  function render(res) {
    items = [];
    const tripsNow = Object.values(ctx.state.trips || {});
    const box = h('div', { class: 'stack tight' });
    for (const tr of res.trips) {
      const dup = tripsNow.some((x) => x.personId === tr.personId && x.from === tr.from && (x.to || null) === (tr.to || null));
      const { inp, el } = chk(t('ai.parse.trip', { who: ctx.name(tr.personId), from: fmtDate(tr.from, ctx.lang, { year: true }), to: tr.to ? fmtDate(tr.to, ctx.lang, { year: true }) : t('trips.ongoing') }), [tr.note, dup ? t('setX.ai.dup') : ''].filter(Boolean).join(' · '), !dup);
      items.push({ inp, run: () => ctx.actions.addTrip({ personId: tr.personId, from: tr.from, to: tr.to, note: tr.note }) }); box.append(el);
    }
    // assegnazioni: «prima → dopo» per mansione, raggruppate per settimana; le scrive come swap unendole a quello esistente
    const rowsAll = ctx.calc.out.rows, byWeek = new Map();
    for (const a of res.assignments || []) (byWeek.get(a.week) || byWeek.set(a.week, []).get(a.week)).push(a);
    if (byWeek.size) box.append(h('div', { class: 'eyebrow' }, t('assign.ai.section')));
    for (const [week, list] of [...byWeek].sort((x, y) => x[0].localeCompare(y[0]))) {
      const row = rowsAll.find((x) => x.sunday === week); if (!row) continue;
      const after = row.assigned.slice(); for (const a of list) after[CHORES.indexOf(a.chore)] = a.personId;
      const load = loadOf(after);
      for (const a of list) {
        const i = CHORES.indexOf(a.chore), from = row.assigned[i];
        const dup = from === a.personId, many = (load[a.personId] || []).length;
        const sub = [dup ? t('setX.ai.dup') : '', row.closed ? t('assign.ai.closed') : '', many > 1 ? t('assign.ai.multi', { name: ctx.name(a.personId), n: many }) : ''].filter(Boolean).join(' · ');
        const { inp, el } = chk(t('assign.ai.item', { chore: t('chore.' + a.chore), week: fmtWeekRange(week, ctx.lang), from: from ? ctx.name(from) : t('assign.nobody'), to: ctx.name(a.personId) }), sub, !dup);
        items.push({ inp, assign: a }); box.append(el);
      }
    }
    for (const r of res.results) {
      const p = r.value.startsWith('by:') ? t('st.doneBy', { name: ctx.name(r.value.slice(3)) }) : r.value === 'done' ? t('st.done') : t('st.skipped');
      const dup = (((ctx.state.weeks || {})[r.week] || {}).result || {})[r.chore] === r.value;
      const { inp, el } = chk(t('ai.parse.result', { chore: t('chore.' + r.chore), week: fmtWeekRange(r.week, ctx.lang), what: p }), [ctx.name(((ctx.calc.out.rows.find((x) => x.sunday === r.week) || {}).assigned || [])[['floor', 'bathroom', 'kitchen'].indexOf(r.chore)]), dup ? t('setX.ai.dup') : ''].filter(Boolean).join(' · '), !dup);
      items.push({ inp, run: () => ctx.actions.setResult(r.week, r.chore, r.value) }); box.append(el);
    }
    const rej = rejectedBox(res.rejected || []);
    if (!items.length) { show(h('div', { class: 'stack tight' }, h('p', { class: 'muted center', 'data-testid': 'ai-none' }, t('ai.parse.none')), rej)); apply.hidden = true; return; }
    show(h('div', { class: 'stack tight' }, h('p', { class: 'small muted' }, t('ai.parse.confirm')), box, rej));
    apply.hidden = false;
  }

  apply.addEventListener('click', async () => {
    const todo = items.filter((x) => x.inp.checked); if (!todo.length) return;
    apply.disabled = true; let ok = 0, ko = 0;
    for (const x of todo.filter((y) => y.run)) { try { await x.run(); ok++; } catch { ko++; } }
    const groups = new Map();   // assegnazioni: una scrittura per settimana (unita allo swap esistente)
    for (const x of todo.filter((y) => y.assign)) (groups.get(x.assign.week) || groups.set(x.assign.week, {}).get(x.assign.week))[x.assign.chore] = x.assign.personId;
    for (const [week, wanted] of groups) {
      try {
        const changes = Object.entries(wanted).map(([c, id]) => t('assign.logChange', { chore: t('chore.' + c).toLowerCase(), name: ctx.name(id) })).join(', ');
        await ctx.actions.setWeekAssignments(week, wanted, { merge: true, logText: t('assign.log', { week: fmtWeekRange(week, ctx.lang), changes }) });
        ok += Object.keys(wanted).length;
      } catch { ko += Object.keys(wanted).length; }
    }
    apply.disabled = false;
    ctx.toast(ko ? `${t('setX.ai.applied', { n: ok })} · ${t('error')}` : t('setX.ai.applied', { n: ok }));
    if (!ko) s.close();
  });
  return s;
}
