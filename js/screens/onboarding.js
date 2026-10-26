// Onboarding: schermate a pieno schermo senza shell (landing, join, chi sei, nuova casa, regole, link non valido, offline).
// Esporta `renderGate(stage, boot, params)`; `boot` è l'oggetto di js/app.js.
import { h, icon, loadCss, clear, copyText, confirmDialog, confetti, avatar } from '../ui.js';
import { t, getLang, fmtDate, fmtWeekRange, registerStrings } from '../i18n.js';
import { it, en } from '../strings/onb.js';
import { normCode, fmtCode, colorOf, PALETTE } from '../extras.js';
import { todayStr, weekEnd, isSunday, dayNum } from '../engine.js';

registerStrings(it, en);

const README = 'https://github.com/iantomasi-nicola/tidyhouse#readme';
const MAX_PEOPLE = 4;
const MIN_PIN = 4;

// ---------------------------------------------------------------- utilità
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(dayNum(s));
const toSunday = (s) => (isSunday(s) ? s : weekEnd(s));
const weekLabel = (sunday) => `${fmtWeekRange(sunday)} ${sunday.slice(0, 4)}`;
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
/** Estrae il codice da un testo qualsiasi: codice grezzo, formattato o link d'invito. */
export function extractCode(v) {
  const m = String(v || '').match(/join\/([^/?#\s]+)/i);
  return normCode(m ? m[1] : v).slice(0, 12);
}
const spinner = (label) => h('div', { class: 'onb-wait', role: 'status' }, h('i', { class: 'onb-spin', 'aria-hidden': 'true' }), h('span', null, label));
const logo = () => h('div', { class: 'logo' }, icon('broom'));
const page = (cls, ...kids) => h('div', { class: 'gate onb ' + cls }, h('div', { class: 'panel onb-panel fade-up' }, ...kids));
const errBox = () => h('p', { class: 'onb-err', role: 'alert', hidden: true });
function setErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
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
  const sync = () => { const c = extractCode(inp.value); inp.value = fmtCode(c); btn.disabled = busy || c.length !== 12; };
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
  const { form } = codeForm(boot, { label: t('join.haveCode') });
  const kids = [
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
    swap([spinner(t('join.checking'))]);
    // parte solo quando il nodo è nel DOM: boot.join può ridisegnare lo stage subito
    const go = () => (root.isConnected ? run() : setTimeout(go, 30));
    setTimeout(go, 30);
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
      if (ok) { unlocked = true; showPin = false; paint(); boot.toast(t('onb.who.unlocked')); } else { setErr(pinErr, t('join.wrongPin')); pinInp.select(); }
    } }, h('div', { class: 'field' }, h('label', { for: 'onb-adminpin' }, t('join.adminPin')), pinInp), pinErr,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn soft sm', onclick: () => { showPin = false; paint(); } }, t('cancel')), h('button', { type: 'submit', class: 'btn sm' }, icon('unlock'), t('join.unlock'))));
    clear(body);
    body.append(
      unlocked ? h('div', { class: 'note ok' }, icon('shield'), t('onb.who.unlocked')) : null,
      h('div', { class: 'who-grid' }, rows),
      h('div', { class: 'onb-more' },
        h('button', { type: 'button', class: 'onb-textbtn', 'aria-expanded': String(showHint), onclick: () => { showHint = !showHint; paint(); } }, t('join.notListed')),
        unlocked ? null : h('button', { type: 'button', class: 'onb-textbtn small', 'aria-expanded': String(showPin), onclick: () => { showPin = !showPin; paint(); if (showPin) setTimeout(() => { const i = document.getElementById('onb-adminpin'); i && i.focus(); }, 30); } }, icon('lock'), t('join.alreadyAdmin'))),
      showHint ? h('div', { class: 'note' }, icon('info'), t('join.notListedHint')) : null,
      showPin ? pinForm : null);
  };
  paint();
  return page('onb-who', logo(),
    h('div', { class: 'onb-hero' }, h('h1', { class: 'onb-h' }, t('join.welcome', { house: house.name || 'Tidy House' })), h('p', { class: 'lead' }, t('join.who')), h('p', { class: 'muted small' }, t('join.whoHint'))),
    body,
    h('div', { class: 'center' }, h('button', { type: 'button', class: 'onb-textbtn small', onclick: () => boot.go('landing') }, t('onb.switchHouse'))));
}

// ---------------------------------------------------------------- NUOVA CASA (wizard)
let wiz = null;
function newWiz() {
  return {
    step: 1, name: '', startSunday: toSunday(todayStr()), startAdjusted: false,
    mode: 'local', people: [{ name: '', from: '', to: '', adv: false }, { name: '', from: '', to: '', adv: false }, { name: '', from: '', to: '', adv: false }],
    adminIdx: 0, pin: '', pin2: '', showPin: false, imported: null, importing: false, importErr: '', busy: false, err: '',
  };
}
const peopleNow = () => (wiz.imported ? wiz.imported.roommates.map((r) => ({ name: r.name, from: r.from || '', to: r.to || '' })) : wiz.people);

function createStage(boot) {
  if (!wiz) { wiz = newWiz(); wiz.mode = boot.cloudAvailable ? 'cloud' : 'local'; }
  const W = wiz;
  const content = h('div', { class: 'onb-step', tabindex: '-1' });
  const stepsEl = h('div', { class: 'steps', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '4' });
  const labelEl = h('div', { class: 'onb-steplabel' });
  const nav = h('div', { class: 'onb-nav' });
  const exit = () => { wiz = null; boot.go('landing'); };

  const goStep = (n, focus = true) => {
    W.step = n; W.err = '';
    render();
    if (focus) { const hd = content.querySelector('h2'); if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
  };

  // ---- validazione passo
  const validate = (n) => {
    if (n === 1) {
      if (!norm(W.name)) return t('onb.err.houseName');
      if (!W.imported && !isIso(W.startSunday)) return t('onb.err.date');
      return '';
    }
    if (n === 2 && !W.imported) {
      const list = W.people;
      if (!list.length) return t('setup.minPeople');
      if (list.length > MAX_PEOPLE) return t('setup.maxPeople');
      if (list.some((p) => !norm(p.name))) return t('onb.err.emptyName');
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (same(list[i].name, list[j].name)) return t('onb.err.dupName');
      if (list.some((p) => (p.from && !isIso(p.from)) || (p.to && !isIso(p.to)) || (p.from && p.to && p.to <= p.from))) return t('onb.err.dates');
      return '';
    }
    if (n === 3) {
      if (!peopleNow().length) return t('setup.minPeople');
      if (W.pin.length < MIN_PIN) return t('setup.pinShort');
      if (W.pin !== W.pin2) return t('onb.err.pinMismatch');
      return '';
    }
    return '';
  };

  // ---- passi
  const field = (label, input, hint, id) => h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'onb-hint' }, hint) : null);

  const step1 = () => {
    const nameI = h('input', { class: 'input', id: 'onb-name', type: 'text', maxlength: '40', autocomplete: 'off', placeholder: t('setup.houseNamePh'), value: W.name, oninput: (e) => { W.name = e.target.value; } });
    const preview = h('div', { class: 'chip acc onb-weekchip' });
    const note = h('p', { class: 'onb-hint onb-adjusted', hidden: !W.startAdjusted });
    const upd = () => { preview.replaceChildren(icon('calendar'), t('onb.firstWeekPreview', { range: weekLabel(W.imported ? W.imported.startSunday : W.startSunday) })); note.textContent = W.startAdjusted ? t('onb.firstWeekAdjusted', { date: fmtDate(W.startSunday, getLang(), { dow: true, year: true }) }) : ''; note.hidden = !W.startAdjusted; };
    const dateI = h('input', { class: 'input', id: 'onb-start', type: 'date', value: W.imported ? W.imported.startSunday : W.startSunday, disabled: !!W.imported, onchange: (e) => {
      const v = e.target.value;
      if (!isIso(v)) { e.target.value = W.startSunday; return; }
      const s = toSunday(v); W.startAdjusted = s !== v; W.startSunday = s; e.target.value = s; upd();
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
    return [
      h('h2', null, t('onb.s1.title')), h('p', { class: 'muted' }, t('onb.s1.lead')),
      field(t('setup.houseName'), nameI, null, 'onb-name'),
      field(t('setup.firstSunday'), dateI, W.imported ? t('onb.firstWeekImported') : t('onb.firstWeekHelp'), 'onb-start'), preview, note,
      h('div', { class: 'lbl onb-lbl' }, t('onb.mode.title')), choices,
      !boot.cloudAvailable ? h('div', { class: 'note' }, icon('info'), h('div', { class: 'stack tight' }, h('div', null, t('join.cloudMissing')), readmeLink())) : null,
    ];
  };

  const step2 = () => {
    if (W.imported) {
      return [h('h2', null, t('onb.s2.title')), h('p', { class: 'muted' }, t('onb.imported.lock')),
        h('div', { class: 'list' }, W.imported.roommates.map((r, i) => h('div', { class: 'li' }, avatar(r.name, PALETTE[i % PALETTE.length]), h('div', { class: 'grow' }, h('div', { class: 't' }, r.name), r.from || r.to ? h('div', { class: 'd' }, [r.from ? t('onb.from') + ' ' + fmtDate(r.from, getLang(), { year: true }) : '', r.to ? t('onb.to') + ' ' + fmtDate(r.to, getLang(), { year: true }) : ''].filter(Boolean).join(' · ')) : null)))),
        h('button', { type: 'button', class: 'btn soft', onclick: () => { W.imported = null; W.adminIdx = 0; render(); } }, t('setup.skipImport'))];
    }
    const list = h('div', { class: 'onb-people' });
    const addBtn = h('button', { type: 'button', class: 'btn tonal block', onclick: () => { if (W.people.length >= MAX_PEOPLE) return; W.people.push({ name: '', from: '', to: '', adv: false }); paint(true); } }, icon('plus'), t('setup.addPerson'));
    const paint = (focusLast) => {
      clear(list);
      W.people.forEach((p, i) => {
        const av = avatar(p.name || '?', PALETTE[i % PALETTE.length]);
        const inp = h('input', { class: 'input', type: 'text', maxlength: '24', autocomplete: 'off', placeholder: t('setup.namePh'), 'aria-label': t('onb.person', { n: i + 1 }), value: p.name, oninput: (e) => { p.name = e.target.value; av.textContent = (p.name.trim().slice(0, 1) || '?').toUpperCase(); } });
        const adv = h('div', { class: 'onb-adv', hidden: !p.adv },
          h('div', { class: 'field' }, h('label', null, t('onb.from')), h('input', { class: 'input', type: 'date', value: p.from, 'aria-label': t('onb.from') + ' ' + (p.name || i + 1), onchange: (e) => { p.from = e.target.value; } })),
          h('div', { class: 'field' }, h('label', null, t('onb.to')), h('input', { class: 'input', type: 'date', value: p.to, 'aria-label': t('onb.to') + ' ' + (p.name || i + 1), onchange: (e) => { p.to = e.target.value; } })),
          h('p', { class: 'onb-hint onb-adv-hint' }, t('onb.advancedHint')));
        const toggleAdv = h('button', { type: 'button', class: 'icon-btn' + (p.adv || p.from || p.to ? ' on' : ''), 'aria-label': t('onb.advanced'), 'aria-expanded': String(!!p.adv), title: t('onb.advanced'), onclick: () => { p.adv = !p.adv; paint(); } }, icon('calendar'));
        const rm = W.people.length > 1 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('onb.removePerson', { name: p.name || (i + 1) }), onclick: () => { W.people.splice(i, 1); paint(); } }, icon('x')) : null;
        list.append(h('div', { class: 'onb-person' }, h('div', { class: 'onb-prow' }, av, inp, toggleAdv, rm), adv));
        if (focusLast && i === W.people.length - 1) setTimeout(() => inp.focus(), 20);
      });
      addBtn.disabled = W.people.length >= MAX_PEOPLE;
      addBtn.title = W.people.length >= MAX_PEOPLE ? t('setup.maxPeople') : '';
    };
    paint();
    return [h('h2', null, t('onb.s2.title')), h('p', { class: 'muted' }, t('onb.s2.lead')), list, addBtn,
      W.people.length >= MAX_PEOPLE ? h('p', { class: 'onb-hint center' }, t('setup.maxPeople')) : null];
  };

  const importBlock = () => {
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
          W.importing = false; render(W.step);
        } });
        box.append(h('div', { class: 'onb-cardhead' }, h('div', { class: 'ico g' }, icon('upload')), h('div', null, h('h3', null, t('onb.import.title')), h('p', { class: 'muted small' }, t('setup.importHint')))),
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
      box.append(
        h('div', { class: 'row' }, h('div', { class: 'ico g onb-ico' }, icon('check')), h('div', { class: 'grow' }, h('h3', null, t('onb.import.preview')), h('p', { class: 'muted small' }, t('setup.importDone', { n: im.roommates.length, w: nWeeks })))),
        h('dl', { class: 'onb-dl' },
          h('dt', null, t('onb.import.people')), h('dd', null, h('div', { class: 'onb-chips' }, im.roommates.map((r, i) => h('span', { class: 'chip', style: { background: 'color-mix(in srgb,' + PALETTE[i % PALETTE.length] + ' 18%, var(--surface))' } }, r.name)))),
          h('dt', null, t('onb.import.start')), h('dd', null, weekLabel(im.startSunday)),
          h('dt', null, t('onb.import.data')), h('dd', null, t('onb.import.weeks', { n: nWeeks }))),
        warn.length ? h('div', { class: 'note warn', role: 'status' }, icon('alert'), h('div', { class: 'stack tight' }, h('strong', null, t('onb.import.warnings')), h('ul', { class: 'onb-warn' }, warn.map((x) => h('li', null, x))),
          (im.warnings || []).some((w) => w.code === 'unknownName') ? h('p', { class: 'small' }, t('onb.import.unknownHint')) : null)) : null,
        h('button', { type: 'button', class: 'btn soft sm', onclick: () => { W.imported = null; W.adminIdx = 0; render(W.step); } }, t('setup.skipImport')));
    };
    paintImp();
    return h('section', { class: 'card flat onb-card' }, box);
  };

  const step3 = () => {
    const people = peopleNow();
    if (W.adminIdx >= people.length) W.adminIdx = 0;
    const radios = h('div', { class: 'onb-admins', role: 'radiogroup', 'aria-label': t('setup.adminWho') }, people.map((p, i) => h('label', { class: 'onb-admin' + (W.adminIdx === i ? ' on' : '') },
      h('input', { type: 'radio', class: 'sr', name: 'onb-admin', checked: W.adminIdx === i, onchange: () => { W.adminIdx = i; [...radios.children].forEach((c, k) => c.classList.toggle('on', k === i)); } }),
      avatar(p.name, PALETTE[i % PALETTE.length]), h('span', { class: 'grow' }, p.name), h('i', { class: 'onb-radio', 'aria-hidden': 'true' }))));
    const pin = h('input', { class: 'input', id: 'onb-pin', type: W.showPin ? 'text' : 'password', autocomplete: 'new-password', placeholder: '••••', value: W.pin, oninput: (e) => { W.pin = e.target.value; } });
    const pin2 = h('input', { class: 'input', id: 'onb-pin2', type: W.showPin ? 'text' : 'password', autocomplete: 'new-password', placeholder: '••••', value: W.pin2, oninput: (e) => { W.pin2 = e.target.value; } });
    const eye = h('button', { type: 'button', class: 'btn ghost sm', 'aria-pressed': String(W.showPin), onclick: () => { W.showPin = !W.showPin; pin.type = pin2.type = W.showPin ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(W.showPin)); } }, icon('eye'), t('onb.showPin'));
    return [h('h2', null, t('onb.s3.title')), h('p', { class: 'muted' }, t('onb.s3.lead')),
      h('div', { class: 'lbl onb-lbl' }, t('setup.adminWho')), radios,
      field(t('setup.pin'), pin, t('setup.pinHint'), 'onb-pin'), field(t('onb.pinConfirm'), pin2, null, 'onb-pin2'), h('div', null, eye),
      importBlock()];
  };

  const step4 = () => {
    const people = peopleNow();
    const adminP = people[W.adminIdx] || people[0] || { name: '' };
    const start = W.imported ? W.imported.startSunday : W.startSunday;
    const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
    return [h('h2', null, t('onb.s4.title')), h('p', { class: 'muted' }, t('onb.s4.lead')),
      h('dl', { class: 'onb-dl card' },
        row(t('onb.sum.house'), norm(W.name)), row(t('onb.sum.start'), weekLabel(start)),
        row(t('onb.sum.mode'), W.mode === 'cloud' ? t('join.cloudMode') : t('join.localMode')),
        row(t('onb.sum.people'), h('div', { class: 'onb-chips' }, people.map((p, i) => h('span', { class: 'chip' }, avatar(p.name, PALETTE[i % PALETTE.length], 'sm'), p.name)))),
        row(t('onb.sum.admin'), h('span', { class: 'chip acc' }, icon('shield'), adminP.name)),
        W.imported ? row(t('onb.sum.import'), t('setup.importDone', { n: W.imported.roommates.length, w: Object.keys(W.imported.weeks || {}).length })) : null),
      W.mode === 'local' ? h('div', { class: 'note' }, icon('info'), t('onb.sum.localNote')) : null];
  };

  // ---- creazione
  const create = async () => {
    if (W.busy) return;
    const people = peopleNow(); const adminP = people[W.adminIdx] || people[0];
    W.busy = true; W.err = ''; render();
    try {
      const id = await boot.createHouse({
        name: norm(W.name), startSunday: W.imported ? W.imported.startSunday : toSunday(W.startSunday),
        roommates: people.map((p) => ({ name: norm(p.name), from: p.from || null, to: p.to || null })),
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

  function render(n) {
    if (typeof n === 'number') W.step = n;
    const s = W.step;
    clear(stepsEl); for (let i = 1; i <= 4; i++) stepsEl.append(h('i', { class: i <= s ? 'on' : '' }));
    stepsEl.setAttribute('aria-valuenow', String(s)); stepsEl.setAttribute('aria-valuetext', t('onb.step', { n: s, total: 4 }) + ' · ' + t('setup.step' + s));
    labelEl.textContent = t('onb.step', { n: s, total: 4 }) + ' · ' + t('setup.step' + s);
    const kids = s === 1 ? step1() : s === 2 ? step2() : s === 3 ? step3() : step4();
    const err = h('p', { class: 'onb-err', role: 'alert', hidden: !W.err }, W.err);
    const form = h('form', { class: 'stack onb-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } }, ...kids, err, h('button', { type: 'submit', class: 'sr', tabindex: '-1' }, t('next')));
    const pane = h('div', { class: 'onb-pane fade-up' }, form);
    clear(content); content.append(pane);
    clear(nav);
    nav.append(
      h('button', { type: 'button', class: 'btn soft', disabled: W.busy, onclick: () => (s === 1 ? exit() : goStep(s - 1)) }, icon('back'), s === 1 ? t('cancel') : t('back')),
      s < 4 ? h('button', { type: 'button', class: 'btn', onclick: next }, t('next'), icon('chevron'))
        : h('button', { type: 'button', class: 'btn lg', disabled: W.busy, onclick: create }, W.busy ? [h('i', { class: 'onb-spin sm on-accent' }), t('onb.creating')] : [icon('check'), t('setup.create')]));
  }
  function next() {
    if (W.step === 3 && W.importing) return;
    const err = validate(W.step);
    if (err) { W.err = err; const e = content.querySelector('.onb-err'); if (e) { e.textContent = err; e.hidden = false; } return; }
    if (W.step < 4) goStep(W.step + 1); else create();
  }
  render();
  return page('onb-create wide',
    h('div', { class: 'onb-top' }, logo(), h('div', { class: 'grow' }, h('div', { class: 'onb-kicker' }, t('setup.title')), labelEl)),
    stepsEl, content, nav);
}

// ---- "Casa creata!" (overlay sopra l'app: boot.createHouse ha già avviato l'app dietro le quinte)
function showCreated(boot, { name, mode, id }) {
  const app = window.__app || {};
  const code = (app.code && app.code()) || fmtCode(id);
  const link = (app.joinLink && app.joinLink()) || `${location.origin}${location.pathname}#/join/${id}`;
  const url = (app.baseUrl && app.baseUrl()) || location.origin + location.pathname;
  const cloud = mode === 'cloud';
  const msg = t('inv.msg', { house: name, link, code, url });
  const close = () => { ov.remove(); document.body.classList.remove('onb-lock'); try { location.hash = '#/'; } catch { /* ignore */ } try { boot.evaluate(); } catch (e) { console.error(e); } };
  const heading = h('h1', { class: 'onb-h', tabindex: '-1', id: 'onb-done-title' }, t('setup.created'));
  const ov = h('div', { class: 'gate onb onb-done', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onb-done-title' },
    h('div', { class: 'panel onb-panel center fade-up' },
      h('div', { class: 'logo onb-check' }, icon('check')),
      h('div', { class: 'onb-hero' }, heading, h('p', { class: 'lead' }, name)),
      cloud ? h('div', { class: 'stack' },
        h('p', { class: 'muted' }, t('setup.next.invite')),
        h('div', { class: 'card onb-card stack tight' },
          h('div', { class: 'lbl' }, t('inv.code')), h('div', { class: 'codebox', 'data-testid': 'house-code' }, code),
          h('div', { class: 'lbl' }, t('inv.link')), h('div', { class: 'onb-linkbox' }, link)),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn tonal', onclick: async () => { const ok = await copyText(link); boot.toast(ok ? t('copied') : t('error')); } }, icon('copy'), t('inv.copyLink')),
          h('a', { class: 'btn tonal', href: 'https://wa.me/?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener' }, icon('whatsapp'), t('inv.shareWa'))),
        h('p', { class: 'muted small' }, t('inv.hint')))
        : h('div', { class: 'note' }, icon('info'), t('onb.done.localLead')),
      h('button', { type: 'button', class: 'btn lg block', onclick: close, id: 'onb-go' }, icon('home'), t('onb.done.go'))));
  document.body.append(ov); document.body.classList.add('onb-lock');
  setTimeout(() => { heading.focus({ preventScroll: true }); confetti(Math.round(innerWidth / 2), Math.round(innerHeight / 4)); }, 60);
}

// ---------------------------------------------------------------- REGOLE (gate obbligatorio)
async function rulesStage(boot) {
  const house = boot.house || {};
  let renderRulesContent;
  try { ({ renderRulesContent } = await import('./more.js')); } catch (e) { console.error(e); }
  const content = renderRulesContent ? renderRulesContent(house) : h('p', null, t('error'));
  const box = h('div', { class: 'rules-scroll onb-rules', tabindex: '0', role: 'region', 'aria-label': t('onb.rules.region') }, content);
  const hint = h('div', { class: 'onb-scrollhint', role: 'status' }, icon('down'), t('onb.rules.scrollHint'));
  const chk = h('input', { type: 'checkbox', id: 'onb-accept', disabled: true, onchange: upd });
  const lab = h('label', { class: 'check onb-accept', for: 'onb-accept' }, chk, h('span', null, t('onb.rules.accept')));
  const btn = h('button', { type: 'button', class: 'btn lg block', disabled: true, onclick: async () => {
    if (btn.disabled) return; btn.disabled = true; btn.replaceChildren(h('i', { class: 'onb-spin sm on-accent' }), t('loading'));
    try { await boot.acceptRules(); } catch (e) { console.error(e); boot.toast(t('error')); btn.replaceChildren(icon('check'), t('onb.rules.read')); upd(); }
  } }, icon('check'), t('onb.rules.read'));
  let atEnd = false;
  function check() {
    if (box.clientHeight === 0) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight <= 12) atEnd = true;
    chk.disabled = !atEnd; lab.classList.toggle('off', !atEnd); hint.hidden = atEnd; box.classList.toggle('more-below', !atEnd);
    upd();
  }
  function upd() { btn.disabled = !(atEnd && chk.checked); }
  box.addEventListener('scroll', check, { passive: true });
  try { new ResizeObserver(check).observe(box); } catch { /* ignore */ }
  window.addEventListener('resize', check);
  setTimeout(check, 50); setTimeout(check, 400);
  return page('onb-rules wide',
    h('div', { class: 'steps', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '3', 'aria-valuenow': '3' }, h('i', { class: 'on' }), h('i', { class: 'on' }), h('i', { class: 'on' })),
    h('div', { class: 'onb-kicker' }, t('onb.step', { n: 3, total: 3 }) + ' · ' + (house.name || '')),
    h('h1', { class: 'onb-h' }, t('rules.title')), h('p', { class: 'muted' }, t('onb.rules.lead')),
    h('div', { class: 'onb-rulesbox' }, box, hint), lab, btn);
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
