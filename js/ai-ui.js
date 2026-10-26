// Interfaccia dell'importazione da messaggio con IA (solo admin). Nulla viene applicato senza conferma.
import { h, icon } from './ui.js';
import { t, fmtDate, fmtWeekRange, registerStrings } from './i18n.js';
import { buildPrompt, callAi, extractJson, validateAiOutput } from './ai.js';
import { it, en } from './strings/set.js';
registerStrings(it, en);

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
      const { system, user } = buildPrompt({ text, house: ctx.house, today, rows });
      const raw = await callAi({ provider: c.provider || 'anthropic', model: c.model || undefined, key: c.key, system, user });
      const res = validateAiOutput(extractJson(raw), ctx.house, { today, firstSunday: ctx.house.startSunday });
      render(res);
    } catch (e) {
      const msg = e && e.message === 'no-key' ? t('ai.noKey') : `${t('ai.err')}${e && e.message && !/^no-json$|^provider$/.test(e.message) ? ': ' + e.message : ''}`;
      show(h('div', { class: 'note bad' }, icon('alert'), h('div', { 'data-testid': 'ai-error' }, msg)));
    } finally { run.disabled = false; }
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
    for (const r of res.results) {
      const p = r.value.startsWith('by:') ? t('st.doneBy', { name: ctx.name(r.value.slice(3)) }) : r.value === 'done' ? t('st.done') : t('st.skipped');
      const dup = (((ctx.state.weeks || {})[r.week] || {}).result || {})[r.chore] === r.value;
      const { inp, el } = chk(t('ai.parse.result', { chore: t('chore.' + r.chore), week: fmtWeekRange(r.week, ctx.lang), what: p }), [ctx.name(((ctx.calc.out.rows.find((x) => x.sunday === r.week) || {}).assigned || [])[['floor', 'bathroom', 'kitchen'].indexOf(r.chore)]), dup ? t('setX.ai.dup') : ''].filter(Boolean).join(' · '), !dup);
      items.push({ inp, run: () => ctx.actions.setResult(r.week, r.chore, r.value) }); box.append(el);
    }
    if (!items.length) { show(h('p', { class: 'muted center', 'data-testid': 'ai-none' }, t('ai.parse.none'))); apply.hidden = true; return; }
    show(h('div', { class: 'stack tight' }, h('p', { class: 'small muted' }, t('ai.parse.confirm')), box));
    apply.hidden = false;
  }

  apply.addEventListener('click', async () => {
    const todo = items.filter((x) => x.inp.checked); if (!todo.length) return;
    apply.disabled = true; let ok = 0, ko = 0;
    for (const x of todo) { try { await x.run(); ok++; } catch { ko++; } }
    apply.disabled = false;
    ctx.toast(ko ? `${t('setX.ai.applied', { n: ok })} · ${t('error')}` : t('setX.ai.applied', { n: ok }));
    if (!ko) s.close();
  });
  return s;
}
