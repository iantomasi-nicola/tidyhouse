// Onboarding: schermate a pieno schermo senza shell (landing, join, chi sei, nuova casa, regole, link non valido, offline).
// Esporta `renderGate(stage, boot, params)`; `boot` è l'oggetto di js/app.js.
import { h, icon, loadCss, clear, copyText, confirmDialog, avatar } from '../ui.js';
import { t, getLang, fmtDate, fmtWeekRange, registerStrings } from '../i18n.js';
import { normalizeStartSunday } from '../actions.js';
import { it, en } from '../strings/onb.js';
import { normCode, fmtCode, colorOf, PALETTE } from '../extras.js';
import { todayStr, dayNum } from '../engine.js';

registerStrings(it, en);

const README = 'https://github.com/iantomasi-nicola/tidyhouse#readme';
const MAX_PEOPLE = 4;
const MIN_PIN = 4;

// ---------------------------------------------------------------- utilità
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(dayNum(s));
const weekLabel = (sunday) => `${fmtWeekRange(sunday)} ${sunday.slice(0, 4)}`;
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
/** Estrae il codice da un testo qualsiasi: codice grezzo, formattato o link d'invito. */
export function extractCode(v) {
  const m = String(v || '').match(/join\/([^/?#\s]+)/i);
  return normCode(m ? m[1] : v).slice(0, 12);
}
const put = (el, ...kids) => el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const spinner = (label) => h('div', { class: 'onb-wait', role: 'status' }, h('i', { class: 'onb-spin', 'aria-hidden': 'true' }), h('span', null, label));
// Marchio Tidy House (icons/logo-mark.svg): tetto + casa con spunta in negativo; segue il colore del riquadro .logo (currentColor)
const MARK = '<svg class="mark" viewBox="78 48.5 356 356" aria-hidden="true" focusable="false">'
  + '<path fill="currentColor" fill-opacity=".8" d="M100 242A22 22 0 0 0 131.11 242L246.04 127.07A14.08 14.08 0 0 1 265.96 127.07L380.89 242A22 22 0 0 0 412 242L412 242A22 22 0 0 0 412 210.89L265.96 64.84A14.08 14.08 0 0 0 246.04 64.84L100 210.89A22 22 0 0 0 100 242Z"/>'
  + '<path fill="currentColor" fill-rule="evenodd" d="M247.51 148.23A12 12 0 0 1 264.49 148.23L360.49 244.23A12 12 0 0 1 364 252.71L364 370A28 28 0 0 1 336 398L176 398A28 28 0 0 1 148 370L148 252.71A12 12 0 0 1 151.51 244.23ZM198 322A18 18 0 0 0 198 347.46L232.57 382.02A7.92 7.92 0 0 0 243.9 381.89L322.59 299.45A18 18 0 0 0 322 274L322 274A18 18 0 0 0 296.55 274.59L243.3 330.38A7.92 7.92 0 0 1 231.97 330.51L223.46 322A18 18 0 0 0 198 322Z"/></svg>';
const logo = () => h('div', { class: 'logo', html: MARK });
const page = (cls, ...kids) => h('div', { class: 'gate onb ' + cls }, h('div', { class: 'panel onb-panel fade-up' }, ...kids));
const errBox = () => h('p', { class: 'onb-err', role: 'alert', hidden: true });
function setErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
/** Selettore IT/EN delle schermate di accesso: cambia lingua subito e se la ricorda (preferenza del dispositivo). */
const LANGS = [['it', 'IT', 'Italiano'], ['en', 'EN', 'English']];
const langPick = (boot) => h('div', { class: 'onb-lang', 'data-testid': 'onb-lang', role: 'group', 'aria-label': t('uxc.lang.label') },
  LANGS.map(([l, short, long]) => h('button', { type: 'button', 'data-lang': l, lang: l, title: long, 'aria-label': long, 'aria-pressed': String(getLang() === l), onclick: () => { if (getLang() !== l && boot.setLang) boot.setLang(l); } }, short)));
const readmeLink = (label) => h('a', { class: 'onb-link', href: README, target: '_blank', rel: 'noopener' }, label || t('onb.cloudGuide'), icon('chevron'));

/** Messaggio per un errore di join. */
function joinError(reason) {
  if (reason === 'offline') return { text: t('join.offline'), retry: true };
  if (reason === 'nocloud') return { text: t('join.cloudMissing'), guide: true };
  if (reason === 'error') return { text: t('error'), retry: true };
  return { text: t('join.invalid') }; // invalid | notfound
}

// ---------------------------------------------------------------- campo codice (landing, join, notfound)
function codeForm(boot, { initial = '', label, cta, onGo }) {
  const inp = h('input', { class: 'input code', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '80', placeholder: t('onb.codePh'), 'aria-label': label || t('join.code'), id: 'onb-code' });
  const err = errBox();
  const guide = h('div', { class: 'onb-guide', hidden: true }, readmeLink(), h('button', { type: 'button', class: 'btn soft sm', onclick: () => boot.go('create') }, t('onb.tryLocal')));
  const btn = h('button', { type: 'submit', class: 'btn block', disabled: true }, cta || t('join.enter'));
  let busy = false;
  const sync = () => {
    const raw = inp.value, pos = inp.selectionStart, c = extractCode(raw), f = fmtCode(c);
    if (f !== raw) {   // riformatta mantenendo il cursore dov'era (conta i caratteri validi prima del cursore)
      const n = pos === null || pos === undefined || pos >= raw.length ? c.length : Math.min(c.length, extractCode(raw.slice(0, pos)).length);
      inp.value = f; if (document.activeElement === inp) { const np = n ? n + Math.floor((n - 1) / 4) : 0; try { inp.setSelectionRange(np, np); } catch { /* ignore */ } }
    }
    btn.disabled = busy || c.length !== 12;
  };
  inp.addEventListener('input', sync);
  if (initial) { inp.value = fmtCode(extractCode(initial)); }
  const form = h('form', { class: 'onb-code', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const code = extractCode(inp.value); if (code.length !== 12 || busy) return;
    busy = true; btn.disabled = true; setErr(err, ''); guide.hidden = true;
    btn.replaceChildren(h('i', { class: 'onb-spin sm', 'aria-hidden': 'true' }), t('join.checking'));
    let r;
    try { r = await (onGo ? onGo(code) : boot.join(code)); } catch { r = { ok: false, reason: 'error' }; }
    if (r && r.ok) return; // l'app passa da sola allo stage successivo
    busy = false; btn.replaceChildren(cta || t('join.enter')); sync();
    const m = joinError(r && r.reason); setErr(err, m.text); guide.hidden = !m.guide;
    if (m.retry) btn.replaceChildren(icon('refresh'), t('onb.retry'));
  } }, h('div', { class: 'field' }, h('label', { for: 'onb-code' }, label || t('join.code')), inp), btn, err, guide);
  sync();
  return { form, inp };
}

// ---------------------------------------------------------------- LANDING
function landing(boot) {
  const houses = [...(boot.houses || [])].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  const { form } = codeForm(boot, { label: t('join.code') });
  const kids = [
    langPick(boot),
    logo(),
    h('div', { class: 'onb-hero' }, h('h1', null, t('app.name')), h('p', { class: 'lead' }, t('join.hello'))),
  ];
  if (!boot.cloudAvailable) {
    kids.push(h('div', { class: 'note onb-cloudnote' }, icon('info'), h('div', { class: 'stack tight' },
      h('div', null, t('join.cloudMissing')), readmeLink())));
  }
  kids.push(h('section', { class: 'card onb-card', 'aria-label': t('join.haveCode') },
    h('div', { class: 'onb-cardhead' }, h('div', { class: 'ico' }, icon('link')), h('div', null, h('h2', null, t('join.haveCode')), h('p', { class: 'muted small' }, t('onb.haveCodeHint')))),
    form));
  kids.push(h('div', { class: 'onb-or' }, h('span', null, t('onb.or'))));
  kids.push(h('button', { type: 'button', class: 'btn lg block', onclick: () => boot.go('create') }, icon('plus'), t('join.create')),
    h('p', { class: 'muted small center' }, t('onb.createHint')));
  if (houses.length) {
    kids.push(h('section', { class: 'onb-houses' }, h('div', { class: 'eyebrow' }, t('join.recent')),
      h('div', { class: 'list' }, houses.map((x) => h('button', { type: 'button', class: 'li', onclick: () => { try { window.__app.switchHouse(x.id); } catch (e) { console.error(e); } } },
        h('div', { class: 'ico' }, icon('home2')),
        h('div', { class: 'grow' }, h('div', { class: 't' }, x.name || fmtCode(x.id)), h('div', { class: 'd' }, x.mode === 'cloud' ? t('data.mode.cloud') : t('misc.localOnly'))),
        h('div', { class: 'end' }, icon('chevron')))))));
  }
  return page('onb-landing', ...kids);
}

// ---------------------------------------------------------------- JOIN (#/join/CODE)
function joinStage(boot, params) {
  const code = normCode(params.code || '');
  const root = page('onb-join', logo(), h('h1', { class: 'onb-h' }, t('join.title')));
  const panel = root.firstChild;
  const showForm = (msg) => {
    const { form } = codeForm(boot, { initial: code });
    const bits = [];
    if (msg) bits.push(h('div', { class: 'note bad', role: 'alert' }, icon('alert'), h('div', { class: 'stack tight' }, h('div', null, msg.text), msg.guide ? readmeLink() : null)));
    bits.push(h('section', { class: 'card onb-card' }, form));
    bits.push(h('div', { class: 'btn-row' },
      msg && msg.retry && code ? h('button', { type: 'button', class: 'btn tonal', onclick: () => run() }, icon('refresh'), t('onb.retry')) : null,
      msg && msg.guide ? h('button', { type: 'button', class: 'btn tonal', onclick: () => boot.go('create') }, t('onb.tryLocal')) : null,
      h('button', { type: 'button', class: 'btn soft', onclick: () => { try { history.replaceState(null, '', '#/'); } catch { /* ignore */ } boot.go('landing'); } }, t('back'))));
    swap(bits);
  };
  const swap = (nodes) => { [...panel.querySelectorAll('.onb-dyn')].forEach((n) => n.remove()); nodes.flat().filter(Boolean).forEach((n) => { n.classList.add('onb-dyn'); panel.append(n); }); };
  const run = async () => {
    swap([spinner(t('join.checking'))]);
    let r;
    try { r = await boot.join(code); } catch { r = { ok: false, reason: 'error' }; }
    if (r && r.ok) return;
    showForm(joinError(r && r.reason));
  };
  if (code.length === 12) {
    // casa già salvata in questo browser e link di una casa diversa: una riga di domanda; stessa casa (o nessuna casa): si entra senza chiedere
    const saved = [...(boot.houses || [])].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    const known = saved.some((x) => normCode(x.id) === code);
    const start = () => {
      swap([spinner(t('join.checking'))]);
      // parte solo quando il nodo è nel DOM: boot.join può ridisegnare lo stage subito
      const go = () => (root.isConnected ? run() : setTimeout(go, 30));
      setTimeout(go, 30);
    };
    if (saved.length && !known && boot.cloudAvailable) {
      const cur = saved[0].name || fmtCode(saved[0].id);
      swap([h('section', { class: 'card onb-card onb-ask', role: 'group', 'aria-label': t('onb.join.ask', { current: cur }) },
        h('p', { class: 'onb-askq' }, t('onb.join.ask', { current: cur })),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn soft', id: 'onb-join-no', onclick: () => { try { boot.resume(); } catch (e) { console.error(e); boot.go('landing'); } } }, t('onb.join.keep')),
          h('button', { type: 'button', class: 'btn', id: 'onb-join-yes', onclick: start }, icon('plus'), t('onb.join.add'))))]);
    } else start();
  } else {
    showForm(params.code ? { text: t('join.invalid') } : null);
  }
  return root;
}

// ---------------------------------------------------------------- CHI SEI
function whoStage(boot) {
  const house = boot.house || {};
  const today = todayStr();
  const all = house.roommates || [];
  const left = (p) => !!(p.to && p.to < today);
  const people = [...all.filter((p) => !left(p)), ...all.filter(left)];
  const admins = new Set(house.adminIds || []);
  let unlocked = false, busy = false, showHint = false, showPin = false;
  const body = h('div', { class: 'onb-dyn-body stack' });
  const paint = () => {
    const rows = people.map((p) => {
      const gone = left(p);
      const sub = gone ? t('onb.who.left', { date: fmtDate(p.to, getLang(), { year: true }) }) : (p.from && p.from > today ? t('onb.who.from', { date: fmtDate(p.from, getLang(), { year: true }) }) : '');
      return h('button', { type: 'button', class: 'who' + (gone ? ' gone' : ''), disabled: busy, onclick: async () => {
        if (busy) return; busy = true; paint();
        try { await boot.setMe(p.id); } catch (e) { console.error(e); busy = false; paint(); boot.toast(t('error')); }
      } },
      avatar(p.name, colorOf(house, p.id), 'lg'),
      h('span', { class: 'grow' }, h('span', { class: 'onb-wname' }, p.name), sub ? h('span', { class: 'onb-wsub' }, sub) : null),
      unlocked && admins.has(p.id) ? h('span', { class: 'chip acc' }, icon('shield'), t('misc.admin')) : null,
      icon('chevron'));
    });
    const pinInp = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': t('join.adminPin'), placeholder: t('join.adminPin'), id: 'onb-adminpin' });
    const pinErr = errBox();
    const pinForm = h('form', { class: 'card onb-card stack tight', onsubmit: async (e) => {
      e.preventDefault(); if (!pinInp.value) return;
      let ok = false; try { ok = await boot.unlockAdmin(pinInp.value); } catch { ok = false; }
      if (ok) { unlocked = true; showPin = false; paint(); } else { setErr(pinErr, t('join.wrongPin')); pinInp.select(); }
    } }, h('div', { class: 'field' }, h('label', { for: 'onb-adminpin' }, t('join.adminPin')), pinInp), pinErr,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn soft sm', onclick: () => { showPin = false; paint(); } }, t('cancel')), h('button', { type: 'submit', class: 'btn sm' }, icon('unlock'), t('join.unlock'))));
    clear(body);
    put(body,
      unlocked ? h('div', { class: 'note ok' }, icon('shield'), t('onb.who.unlocked')) : null,
      h('div', { class: 'who-grid' }, rows),
      h('div', { class: 'onb-more' },
        h('button', { type: 'button', class: 'onb-textbtn', 'aria-expanded': String(showHint), onclick: () => { showHint = !showHint; paint(); } }, t('join.notListed')),
        unlocked ? null : h('button', { type: 'button', class: 'onb-textbtn small', 'aria-expanded': String(showPin), onclick: () => { showPin = !showPin; paint(); if (showPin) setTimeout(() => { const i = document.getElementById('onb-adminpin'); i && i.focus(); }, 30); } }, icon('lock'), t('join.alreadyAdmin'))),
      showHint ? h('div', { class: 'note' }, icon('info'), t('join.notListedHint')) : null,
      showPin ? pinForm : null);
  };
  paint();
  return page('onb-who', langPick(boot), logo(),
    h('div', { class: 'onb-hero' }, h('div', { class: 'onb-kicker' }, t('onb.who.kicker')), h('h1', { class: 'onb-h onb-housename' }, house.name || 'Tidy House'), h('p', { class: 'lead onb-whoq' }, t('join.who')), h('p', { class: 'muted small' }, t('onb.who.tap'))),
    body,
    h('div', { class: 'center' }, h('button', { type: 'button', class: 'onb-textbtn small', onclick: () => boot.go('landing') }, t('onb.switchHouse'))));
}

// ---------------------------------------------------------------- NUOVA CASA (wizard in 3 passi: nome -> persone -> PIN)
let wiz = null;
const blankPerson = () => ({ name: '', from: '', to: '', expectedTo: '', adv: false });
function newWiz() {
  return {
    step: 1, name: t('onb.defaultName'), defName: t('onb.defaultName'), startSunday: normalizeStartSunday(todayStr()), startAdjusted: false, optsOpen: false,
    mode: 'local', people: [blankPerson(), blankPerson(), blankPerson()],
    adminIdx: 0, adminOpen: false, pin: '', hidePin: false, imported: null, importing: false, importErr: '', busy: false, err: '',
  };
}
/** Persone realmente compilate (le righe vuote si ignorano). */
const named = () => wiz.people.filter((p) => norm(p.name));
const peopleNow = () => (wiz.imported ? wiz.imported.roommates.map((r) => ({ name: r.name, from: r.from || '', to: r.to || '', expectedTo: '' })) : named());

function createStage(boot) {
  if (!wiz) { wiz = newWiz(); wiz.mode = boot.cloudAvailable ? 'cloud' : 'local'; }
  const W = wiz;
  if (W.defName !== undefined && W.name === W.defName) { W.defName = W.name = t('onb.defaultName'); }   // cambio lingua: il nome proposto segue, quello scritto dall'utente no
  const TOTAL = 3;
  const content = h('div', { class: 'onb-step', tabindex: '-1' });
  const stepsEl = h('div', { class: 'steps', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(TOTAL) });
  const labelEl = h('div', { class: 'onb-steplabel' });
  const nav = h('div', { class: 'onb-nav' });
  const exit = () => { wiz = null; boot.go('landing'); };

  /** Porta il cursore nel campo principale del passo (sul telefono apre subito la tastiera). */
  const focusMain = (sel, selectAll) => {
    let n = 0;
    const go = () => {
      const el = content.querySelector(sel);
      if (el && el.isConnected) { el.focus({ preventScroll: true }); if (selectAll && el.select) { try { el.select(); el.setSelectionRange(0, el.value.length); } catch { /* ignore */ } } }
      else if (n++ < 30) setTimeout(go, 50);
    };
    setTimeout(go, 30);
  };
  const focusStep = () => {
    if (W.step === 1) focusMain('#onb-name', true);
    else if (W.step === 2) {
      if (W.imported) return;
      setTimeout(() => { const ins = [...content.querySelectorAll('.onb-prow input[type=text]')]; const el = ins.find((i) => !i.value) || ins[0]; if (el) el.focus({ preventScroll: true }); }, 60);
    } else focusMain('#onb-pin');
  };
  const goStep = (n) => { W.step = n; W.err = ''; render(); window.scrollTo(0, 0); focusStep(); };

  // ---- validazione passo
  const validate = (n) => {
    if (n === 1) {
      if (!norm(W.name)) return t('onb.err.houseName');
      if (!W.imported && !isIso(W.startSunday)) return t('onb.err.date');
      return '';
    }
    if (n === 2 && !W.imported) {
      const list = named();
      if (!list.length) return t('setup.minPeople');
      if (list.length > MAX_PEOPLE) return t('setup.maxPeople');
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (same(list[i].name, list[j].name)) return t('onb.err.dupName');
      if (list.some((p) => (p.from && !isIso(p.from)) || (p.to && !isIso(p.to)) || (p.expectedTo && !isIso(p.expectedTo)) || (p.from && p.to && p.to <= p.from))) return t('onb.err.dates');
      return '';
    }
    if (n === 3) {
      if (!peopleNow().length) return t('setup.minPeople');
      if (W.pin.length < MIN_PIN) return t('setup.pinShort');
      return '';
    }
    return '';
  };

  // ---- passi
  const field = (label, input, hint, id) => h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'onb-hint' }, hint) : null);

  /** Passo 1: solo il nome (già proposto e selezionato). Il resto è sotto «Altre opzioni». */
  const step1 = () => {
    const nameI = h('input', { class: 'input lg', id: 'onb-name', type: 'text', maxlength: '40', autocomplete: 'off', enterkeyhint: 'next', placeholder: t('setup.houseNamePh'), value: W.name, oninput: (e) => { W.name = e.target.value; } });
    const preview = h('div', { class: 'chip acc onb-weekchip' });
    const note = h('p', { class: 'onb-hint onb-adjusted', hidden: !W.startAdjusted });
    const upd = () => { preview.replaceChildren(icon('calendar'), t('onb.firstWeekPreview', { range: weekLabel(W.imported ? W.imported.startSunday : W.startSunday) })); note.textContent = W.startAdjusted ? t('onb.firstWeekAdjusted', { date: fmtDate(W.startSunday, getLang(), { dow: true, year: true }) }) : ''; note.hidden = !W.startAdjusted; };
    const dateI = h('input', { class: 'input', id: 'onb-start', type: 'date', value: W.imported ? W.imported.startSunday : W.startSunday, disabled: !!W.imported, onchange: (e) => {
      const v = e.target.value;
      if (!isIso(v)) { e.target.value = W.startSunday; return; }
      const s = normalizeStartSunday(v); W.startAdjusted = s !== v; W.startSunday = s; e.target.value = s; upd();
    } });
    upd();
    const opt = (val, ic, title, desc, off) => {
      const radio = h('input', { type: 'radio', name: 'onb-mode', value: val, class: 'sr', disabled: !!off, checked: W.mode === val, onchange: () => { W.mode = val; [...choices.children].forEach((c) => c.classList.toggle('on', c.dataset.v === val)); } });
      return h('label', { class: 'onb-choice' + (W.mode === val ? ' on' : '') + (off ? ' off' : ''), 'data-v': val }, radio,
        h('div', { class: 'ico' }, icon(ic)), h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)), h('i', { class: 'onb-radio', 'aria-hidden': 'true' }));
    };
    const choices = h('div', { class: 'onb-choices', role: 'radiogroup', 'aria-label': t('onb.mode.title') },
      opt('cloud', 'users', t('join.cloudMode'), boot.cloudAvailable ? t('onb.mode.cloud.desc') : t('onb.mode.cloudOff'), !boot.cloudAvailable),
      opt('local', 'device', t('join.localMode'), t('onb.mode.local.desc'), false));
    const more = h('details', { class: 'onb-opts', open: W.optsOpen, ontoggle: (e) => { W.optsOpen = e.target.open; } },
      h('summary', null, t('onb.moreOpts')),
      h('div', { class: 'stack onb-opts-body' },
        field(t('setup.firstSunday'), dateI, W.imported ? t('onb.firstWeekImported') : t('onb.firstWeekHelp'), 'onb-start'), preview, note,
        h('div', { class: 'lbl onb-lbl' }, t('onb.mode.title')), choices));
    return [
      h('h2', null, t('onb.s1.title')), h('p', { class: 'muted' }, t('onb.s1.lead')),
      field(t('setup.houseName'), nameI, null, 'onb-name'),
      !boot.cloudAvailable ? h('div', { class: 'note' }, icon('info'), h('div', { class: 'stack tight' }, h('div', null, t('join.cloudMissing')), readmeLink())) : null,
      more, importBlock(),
    ];
  };

  /** Passo 2: nomi come semplici campi; Invio passa al successivo o aggiunge una riga; il primo sei tu. */
  const step2 = () => {
    if (W.imported) {
      return [h('h2', null, t('onb.s2.title')), h('p', { class: 'muted' }, t('onb.imported.lock')),
        h('div', { class: 'list' }, W.imported.roommates.map((r, i) => h('div', { class: 'li' }, avatar(r.name, PALETTE[i % PALETTE.length]), h('div', { class: 'grow' }, h('div', { class: 't' }, r.name), r.from || r.to ? h('div', { class: 'd' }, [r.from ? t('onb.from') + ' ' + fmtDate(r.from, getLang(), { year: true }) : '', r.to ? t('onb.to') + ' ' + fmtDate(r.to, getLang(), { year: true }) : ''].filter(Boolean).join(' · ')) : null)))),
        h('button', { type: 'button', class: 'btn soft', onclick: () => { W.imported = null; W.adminIdx = 0; render(); } }, t('setup.skipImport'))];
    }
    while (W.people.length < 3) W.people.push(blankPerson());
    const list = h('div', { class: 'onb-people' });
    const addBtn = h('button', { type: 'button', class: 'btn tonal block', onclick: () => addRow() }, icon('plus'), t('setup.addPerson'));
    const addRow = () => { if (W.people.length >= MAX_PEOPLE) return false; W.people.push(blankPerson()); paint(W.people.length - 1); return true; };
    const paint = (focusIdx) => {
      clear(list);
      W.people.forEach((p, i) => {
        const av = avatar(p.name || '?', PALETTE[i % PALETTE.length]);
        const inp = h('input', { class: 'input', type: 'text', maxlength: '24', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'next', placeholder: i === 0 ? t('onb.youPh') : t('setup.namePh'), 'aria-label': t('onb.person', { n: i + 1 }), value: p.name,
          oninput: (e) => { p.name = e.target.value; av.textContent = (p.name.trim().slice(0, 1) || '?').toUpperCase(); },
          onkeydown: (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            const inputs = [...list.querySelectorAll('.onb-prow input[type=text]')];
            const k = inputs.indexOf(e.target);
            if (k < inputs.length - 1) inputs[k + 1].focus();               // riga successiva
            else if (norm(p.name) && addRow()) { /* aggiunta rapida: nuova riga con il cursore */ }
            else next();                                                      // ultima riga: avanti
          } });
        const adv = h('div', { class: 'onb-adv', hidden: !p.adv },
          h('div', { class: 'field' }, h('label', null, t('onb.from')), h('input', { class: 'input', type: 'date', value: p.from, 'aria-label': t('onb.from') + ' ' + (p.name || i + 1), onchange: (e) => { p.from = e.target.value; } })),
          h('div', { class: 'field' }, h('label', null, t('onb.to')), h('input', { class: 'input', type: 'date', value: p.to, 'aria-label': t('onb.to') + ' ' + (p.name || i + 1), onchange: (e) => { p.to = e.target.value; } })),
          h('p', { class: 'onb-hint onb-adv-hint' }, t('onb.toUnknown')),
          h('div', { class: 'field onb-adv-wide' }, h('label', null, t('onb.expectedTo')), h('input', { class: 'input', type: 'date', value: p.expectedTo || '', 'aria-label': t('onb.expectedTo') + ' ' + (p.name || i + 1), onchange: (e) => { p.expectedTo = e.target.value; } }),
            h('p', { class: 'onb-hint' }, t('onb.expectedToHint'))),
          h('p', { class: 'onb-hint onb-adv-hint' }, t('onb.advancedHint')));
        const toggleAdv = h('button', { type: 'button', class: 'icon-btn' + (p.adv || p.from || p.to || p.expectedTo ? ' on' : ''), 'aria-label': t('onb.advanced'), 'aria-expanded': String(!!p.adv), title: t('onb.advanced'), onclick: () => { p.adv = !p.adv; paint(); } }, icon('calendar'));
        const rm = W.people.length > 1 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('onb.removePerson', { name: p.name || (i + 1) }), onclick: () => { W.people.splice(i, 1); paint(); } }, icon('x')) : null;
        list.append(h('div', { class: 'onb-person' }, h('div', { class: 'onb-prow' }, av, inp, toggleAdv, rm), adv));
        if (focusIdx === i) setTimeout(() => inp.focus(), 20);
      });
      addBtn.disabled = W.people.length >= MAX_PEOPLE;
      addBtn.title = W.people.length >= MAX_PEOPLE ? t('setup.maxPeople') : '';
    };
    paint();
    return [h('h2', null, t('onb.s2.title')), h('p', { class: 'muted' }, t('onb.s2.lead')), list, addBtn,
      W.people.length >= MAX_PEOPLE ? h('p', { class: 'onb-hint center' }, t('setup.maxPeople')) : null];
  };

  /** Importa il foglio Excel: opzione secondaria, sotto le altre opzioni del passo 1. */
  function importBlock() {
    const box = h('div', { class: 'stack tight onb-import' });
    const paintImp = () => {
      clear(box);
      if (W.importing) { box.append(spinner(t('onb.import.reading'))); return; }
      if (!W.imported) {
        const file = h('input', { type: 'file', class: 'sr', id: 'onb-xlsx', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', onchange: async (e) => {
          const f = e.target.files && e.target.files[0]; if (!f) return;
          W.importing = true; W.importErr = ''; paintImp();
          try {
            const res = await boot.importExcel(f);
            W.imported = res; W.startSunday = res.startSunday; W.startAdjusted = false; W.adminIdx = 0;
          } catch (err) { console.warn('import', err); W.importErr = t('setup.importFail'); }
          W.importing = false; render();
        } });
        put(box, h('div', { class: 'onb-cardhead' }, h('div', { class: 'ico g' }, icon('upload')), h('div', null, h('h3', null, t('onb.import.title')), h('p', { class: 'muted small' }, t('setup.importHint')))),
          h('label', { class: 'btn tonal onb-file', for: 'onb-xlsx' }, icon('upload'), t('setup.import'), file),
          W.importErr ? h('p', { class: 'onb-err', role: 'alert' }, W.importErr) : null);
        return;
      }
      const im = W.imported;
      const nWeeks = Object.keys(im.weeks || {}).length;
      const warn = [];
      for (const w of im.warnings || []) {
        if (w.code === 'unknownName') warn.push(t('onb.import.unknown', { name: w.value }));
        else if (w.code === 'startNotSunday') warn.push(t('onb.import.notSunday', { date: fmtDate(w.value, getLang(), { year: true }) }));
        else warn.push(String(w.code || '') + (w.value ? ': ' + w.value : ''));
      }
      put(box,
        h('div', { class: 'row' }, h('div', { class: 'ico g onb-ico' }, icon('check')), h('div', { class: 'grow' }, h('h3', null, t('onb.import.preview')), h('p', { class: 'muted small' }, t('setup.importDone', { n: im.roommates.length, w: nWeeks })))),
        h('dl', { class: 'onb-dl' },
          h('dt', null, t('onb.import.people')), h('dd', null, h('div', { class: 'onb-chips' }, im.roommates.map((r, i) => h('span', { class: 'chip', style: { background: 'color-mix(in srgb,' + PALETTE[i % PALETTE.length] + ' 18%, var(--surface))' } }, r.name)))),
          h('dt', null, t('onb.import.start')), h('dd', null, weekLabel(im.startSunday)),
          h('dt', null, t('onb.import.data')), h('dd', null, t('onb.import.weeks', { n: nWeeks }))),
        warn.length ? h('div', { class: 'note warn', role: 'status' }, icon('alert'), h('div', { class: 'stack tight' }, h('strong', null, t('onb.import.warnings')), h('ul', { class: 'onb-warn' }, warn.map((x) => h('li', null, x))),
          (im.warnings || []).some((w) => w.code === 'unknownName') ? h('p', { class: 'small' }, t('onb.import.unknownHint')) : null)) : null,
        h('button', { type: 'button', class: 'btn soft sm', onclick: () => { W.imported = null; W.adminIdx = 0; render(); } }, t('setup.skipImport')));
    };
    paintImp();
    return h('section', { class: 'card flat onb-card' }, box);
  }

  /** Passo 3: solo il PIN (l'admin è già «tu»; si cambia da un link). Tastiera numerica, nessuna conferma. */
  const step3 = () => {
    const people = peopleNow();
    if (W.adminIdx >= people.length) W.adminIdx = 0;
    const adminName = (people[W.adminIdx] || { name: '' }).name;
    const radios = h('div', { class: 'onb-admins', role: 'radiogroup', 'aria-label': t('setup.adminWho'), hidden: !W.adminOpen }, people.map((p, i) => h('label', { class: 'onb-admin' + (W.adminIdx === i ? ' on' : '') },
      h('input', { type: 'radio', class: 'sr', name: 'onb-admin', checked: W.adminIdx === i, onchange: () => { W.adminIdx = i; [...radios.children].forEach((c, k) => c.classList.toggle('on', k === i)); who.textContent = p.name; } }),
      avatar(p.name, PALETTE[i % PALETTE.length]), h('span', { class: 'grow' }, p.name), h('i', { class: 'onb-radio', 'aria-hidden': 'true' }))));
    const who = h('strong', null, adminName);
    const adminLine = people.length > 1 ? h('div', { class: 'onb-adminline' },
      h('span', null, icon('shield'), t('onb.adminIs'), ' ', who),
      h('button', { type: 'button', class: 'onb-textbtn small', 'aria-expanded': String(W.adminOpen), onclick: () => { W.adminOpen = !W.adminOpen; radios.hidden = !W.adminOpen; } }, t('onb.adminChange'))) : null;
    const pin = h('input', { class: 'input lg onb-pin', id: 'onb-pin', type: W.hidePin ? 'password' : 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'done', placeholder: '••••', value: W.pin, oninput: (e) => { W.pin = e.target.value; } });
    const eye = h('button', { type: 'button', class: 'btn ghost sm', 'aria-pressed': String(W.hidePin), onclick: () => { W.hidePin = !W.hidePin; pin.type = W.hidePin ? 'password' : 'text'; eye.setAttribute('aria-pressed', String(W.hidePin)); eye.replaceChildren(icon('eye'), W.hidePin ? t('onb.showPin') : t('onb.hidePin')); } }, icon('eye'), W.hidePin ? t('onb.showPin') : t('onb.hidePin'));
    return [h('h2', null, t('onb.s3.title')), h('p', { class: 'muted' }, t('onb.s3.lead')),
      field(t('onb.pinLabel'), pin, t('setup.pinHint'), 'onb-pin'), h('div', null, eye),
      adminLine, adminLine ? radios : null];
  };

  // ---- creazione
  const create = async () => {
    if (W.busy) return;
    const people = peopleNow(); const adminP = people[W.adminIdx] || people[0];
    W.busy = true; W.err = ''; render();
    try {
      const id = await boot.createHouse({
        name: norm(W.name), startSunday: W.imported ? W.imported.startSunday : normalizeStartSunday(W.startSunday),
        roommates: people.map((p) => ({ name: norm(p.name), from: p.from || null, to: p.to || null, ...(!p.to && p.expectedTo ? { expectedTo: p.expectedTo } : {}) })),
        adminName: adminP.name, pin: W.pin, mode: boot.cloudAvailable ? W.mode : 'local', imported: W.imported || undefined,
      });
      const summary = { name: norm(W.name), mode: boot.cloudAvailable ? W.mode : 'local', id };
      wiz = null;
      showCreated(boot, summary);
    } catch (e) {
      console.error(e);
      W.busy = false; W.err = navigator.onLine === false ? t('err.network') : t('onb.err.create'); render();
    }
  };

  function render() {
    const s = W.step;
    clear(stepsEl); for (let i = 1; i <= TOTAL; i++) stepsEl.append(h('i', { class: i <= s ? 'on' : '' }));
    stepsEl.setAttribute('aria-valuenow', String(s)); stepsEl.setAttribute('aria-valuetext', t('onb.step', { n: s, total: TOTAL }) + ' · ' + t('onb.stepName' + s));
    labelEl.textContent = t('onb.step', { n: s, total: TOTAL }) + ' · ' + t('onb.stepName' + s);
    const kids = s === 1 ? step1() : s === 2 ? step2() : step3();
    const err = h('p', { class: 'onb-err', role: 'alert', hidden: !W.err }, W.err);
    const form = h('form', { class: 'stack onb-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } }, ...kids, err, h('button', { type: 'submit', class: 'sr', tabindex: '-1', 'aria-hidden': 'true' }, t('next')));
    const pane = h('div', { class: 'onb-pane fade-up' }, form);
    clear(content); content.append(pane);
    clear(nav);
    nav.append(
      h('button', { type: 'button', class: 'btn soft', disabled: W.busy, onclick: () => (s === 1 ? exit() : goStep(s - 1)) }, icon('back'), s === 1 ? t('cancel') : t('back')),
      s < TOTAL ? h('button', { type: 'button', class: 'btn', onclick: next }, t('next'), icon('chevron'))
        : h('button', { type: 'button', class: 'btn lg', disabled: W.busy, onclick: next }, W.busy ? [h('i', { class: 'onb-spin sm on-accent' }), t('onb.creating')] : [icon('check'), t('setup.create')]));
  }
  function next() {
    if (W.step === 1 && W.importing) return;
    const err = validate(W.step);
    if (err) { W.err = err; const e = content.querySelector('.onb-err'); if (e) { e.textContent = err; e.hidden = false; } return; }
    if (W.step === 2 && !W.imported) W.people = named();   // via le righe vuote
    if (W.step < TOTAL) goStep(W.step + 1); else create();
  }
  render();
  focusStep();
  return page('onb-create wide',
    h('div', { class: 'onb-top' }, logo(), h('div', { class: 'grow' }, h('div', { class: 'onb-kicker' }, t('setup.title')), labelEl), langPick(boot)),
    stepsEl, content, nav);
}

// ---- "Casa creata!" (overlay sopra l'app: boot.createHouse ha già avviato l'app dietro le quinte)
async function inviteQr(link) {
  try {
    const { default: qrcode } = await import('../../vendor/qr.js');
    const q = qrcode(0, 'M'); q.addData(link); q.make();
    return h('div', { class: 'qr', 'data-testid': 'invite-qr', role: 'img', 'aria-label': t('inv.qr'), html: q.createSvgTag({ cellSize: 4, margin: 0 }) });
  } catch (e) { console.warn('qr', e); return null; }
}
async function showCreated(boot, { name, mode, id }) {
  const app = window.__app || {};
  const code = (app.code && app.code()) || fmtCode(id);
  const link = (app.joinLink && app.joinLink()) || `${location.origin}${location.pathname}#/join/${id}`;
  const url = (app.baseUrl && app.baseUrl()) || location.origin + location.pathname;
  const cloud = mode === 'cloud';
  const msg = t('inv.msg', { house: name, link, code, url });
  const qr = cloud ? await inviteQr(link) : null;
  const close = () => { ov.remove(); document.body.classList.remove('onb-lock'); try { location.hash = '#/'; } catch { /* ignore */ } try { boot.evaluate(); } catch (e) { console.error(e); } };
  const heading = h('h1', { class: 'onb-h', tabindex: '-1', id: 'onb-done-title' }, t('setup.created'));
  const ov = h('div', { class: 'gate onb onb-done', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onb-done-title' },
    h('div', { class: 'panel onb-panel center fade-up' },
      h('div', { class: 'logo onb-check' }, icon('check')),
      h('div', { class: 'onb-hero' }, heading, h('p', { class: 'lead' }, name)),
      cloud ? h('div', { class: 'stack' },
        h('p', { class: 'muted' }, t('onb.done.scan')),
        qr ? h('div', { class: 'center' }, qr) : null,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn tonal', onclick: async () => { const ok = await copyText(link); boot.toast(ok ? t('copied') : t('error')); } }, icon('copy'), t('inv.copyLink')),
          h('a', { class: 'btn tonal', href: 'https://wa.me/?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener' }, icon('whatsapp'), t('inv.shareWa'))),
        h('div', { class: 'card onb-card stack tight' },
          h('div', { class: 'lbl' }, t('inv.code')), h('div', { class: 'codebox', 'data-testid': 'house-code' }, code),
          h('div', { class: 'lbl' }, t('inv.link')), h('div', { class: 'onb-linkbox' }, link)),
        h('p', { class: 'muted small' }, t('inv.hint')))
        : h('div', { class: 'note' }, icon('info'), t('onb.done.localLead')),
      h('button', { type: 'button', class: 'btn lg block', onclick: close, id: 'onb-go' }, icon('home'), t('onb.done.go'))));
  document.body.append(ov); document.body.classList.add('onb-lock');
  setTimeout(() => { heading.focus({ preventScroll: true }); }, 60);
}

// ---------------------------------------------------------------- REGOLE (gate obbligatorio)
async function rulesStage(boot) {
  const house = boot.house || {};
  let renderRulesContent;
  try { ({ renderRulesContent } = await import('./more.js')); } catch (e) { console.error(e); }
  const content = renderRulesContent ? renderRulesContent(house) : h('p', null, t('error'));
  // niente riquadro con scorrimento interno (su telefono bloccava la pagina): le regole scorrono con la pagina
  // e il pulsante resta sempre visibile in fondo; finché non si è arrivati in fondo il tocco scorre fino alla fine
  const box = h('div', { class: 'rules-scroll onb-rules', role: 'region', 'aria-label': t('onb.rules.region') }, content);
  const end = h('div', { class: 'onb-end', 'aria-hidden': 'true' });
  let atEnd = false, busy = false;
  const btn = h('button', { type: 'button', class: 'btn lg block', 'data-testid': 'rules-accept', onclick: async () => {
    if (busy) return;
    if (!atEnd) { try { end.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch { end.scrollIntoView(); } return; }
    busy = true; btn.disabled = true; btn.replaceChildren(h('i', { class: 'onb-spin sm on-accent' }), t('loading'));
    try { await boot.acceptRules(); } catch (e) { console.error(e); boot.toast(t('error')); busy = false; btn.disabled = false; paint(); }
  } });
  function paint() {
    btn.classList.toggle('soft', !atEnd);
    btn.replaceChildren(icon(atEnd ? 'check' : 'down'), atEnd ? t('onb.rules.accept') : t('onb.rules.scrollHint'));
    btn.setAttribute('data-ready', atEnd ? '1' : '0');
  }
  function check() {
    if (atEnd || !end.isConnected) return;
    const r = end.getBoundingClientRect();
    const bar = (document.querySelector('.onb-sticky') || {}).offsetHeight || 0;   // l'ultima riga non deve restare sotto la barra del pulsante
    if (r.top <= window.innerHeight - bar - 8 || document.documentElement.scrollHeight - window.scrollY - window.innerHeight <= 12) { atEnd = true; paint(); window.removeEventListener('scroll', check); window.removeEventListener('resize', check); }
  }
  paint();
  window.addEventListener('scroll', check, { passive: true }); window.addEventListener('resize', check);
  setTimeout(check, 50); setTimeout(check, 400); setTimeout(check, 1200);
  return page('onb-rulespage wide',
    h('div', { class: 'steps', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '3', 'aria-valuenow': '3' }, h('i', { class: 'on' }), h('i', { class: 'on' }), h('i', { class: 'on' })),
    h('div', { class: 'onb-kicker' }, t('onb.step', { n: 3, total: 3 }) + ' · ' + (house.name || '')),
    h('h1', { class: 'onb-h' }, t('rules.title')), h('p', { class: 'muted' }, t('onb.rules.lead')),
    box, end, h('div', { class: 'onb-sticky' }, btn));
}

// ---------------------------------------------------------------- LINK NON VALIDO / OFFLINE
function notFoundStage(boot, params) {
  const name = params.name || t('onb.nf.unnamed');
  const { form } = codeForm(boot, { label: t('onb.nf.field'), cta: t('join.enter') });
  const forget = async () => {
    const ok = await confirmDialog({ title: t('onb.nf.forget'), text: t('onb.nf.forgetConfirm', { name }), ok: t('onb.nf.forget'), danger: true });
    if (!ok) return;
    try {
      const reg = JSON.parse(localStorage.getItem('cp:houses') || '[]').filter((x) => x.id !== params.id);
      localStorage.setItem('cp:houses', JSON.stringify(reg));
      if (JSON.parse(localStorage.getItem('cp:last') || 'null') === params.id) localStorage.removeItem('cp:last');
      const adm = JSON.parse(localStorage.getItem('cp:admin') || '{}'); if (adm[params.id]) { delete adm[params.id]; localStorage.setItem('cp:admin', JSON.stringify(adm)); }
    } catch (e) { console.error(e); }
    boot.go('landing');
  };
  return page('onb-nf', h('div', { class: 'logo onb-warn-logo' }, icon('link')),
    h('div', { class: 'onb-hero' }, h('h1', { class: 'onb-h' }, t('onb.nf.title')), h('p', { class: 'lead' }, t('onb.nf.text', { name }))),
    h('section', { class: 'card onb-card' }, form),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn danger', onclick: forget }, icon('trash'), t('onb.nf.forget')),
      h('button', { type: 'button', class: 'btn soft', onclick: () => boot.go('landing') }, t('onb.nf.other'))));
}

function offlineStage(boot, params) {
  window.addEventListener('online', () => location.reload(), { once: true });
  return page('onb-off', h('div', { class: 'logo onb-warn-logo' }, icon('alert')),
    h('div', { class: 'onb-hero' }, h('h1', { class: 'onb-h' }, t('onb.off.title')), h('p', { class: 'lead' }, params && params.name ? t('onb.off.text', { name: params.name }) : t('join.offline'))),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn lg', onclick: () => location.reload() }, icon('refresh'), t('onb.retry'))));
}

// ---------------------------------------------------------------- entry point
export async function renderGate(stage, boot, params = {}) {
  loadCss('css/onboarding.css');
  if (stage !== 'create') wiz = null;
  switch (stage) {
    case 'create': return createStage(boot);
    case 'join': return joinStage(boot, params);
    case 'who': return whoStage(boot);
    case 'rules': return rulesStage(boot);
    case 'notfound': return notFoundStage(boot, params);
    case 'offline': return offlineStage(boot, params);
    case 'landing': default: return landing(boot);
  }
}
