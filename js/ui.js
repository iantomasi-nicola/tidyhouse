// Mini-framework UI: element builder, icone, sheet, toast, confetti.
import { t } from './i18n.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const cssLoaded = new Set(); const cssPending = new Set();
/** Carica un foglio di stile una sola volta. Le schermate possono aspettare `cssReady()` prima di mostrarsi (niente contenuto senza stile / layout shift). */
export function loadCss(href) {
  if (cssLoaded.has(href)) return; cssLoaded.add(href);
  const link = h('link', { rel: 'stylesheet', href: new URL('../' + href, import.meta.url).href });
  const p = new Promise((res) => { link.addEventListener('load', res); link.addEventListener('error', res); setTimeout(res, 2500); }).then(() => cssPending.delete(p));
  cssPending.add(p);
  document.head.append(link);
}
export const cssReady = () => (cssPending.size ? Promise.all([...cssPending]) : Promise.resolve());

// ---- icone (24x24, tratto) ----
const P = {
  home: '<path d="M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.2H9v5.2H5.5A1.5 1.5 0 0 1 4 19z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3.2v3.6M16 3.2v3.6"/>',
  plane: '<path d="M10.5 13.5 4 12l-1 1.5 5 3.2M13.5 10.5 12 4l1.5-1 3.2 5 4.3-1.6c1.2-.4 2 .8 1.1 1.7l-4.3 3.1 3.1 5.5-1.3 1.3-5.3-3.3-3.2 4.2c-.7.9-2 .2-1.7-.9l1.6-4.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v3.5M8.5 20h7M10 16.5h4l.5 3.5h-5z"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" class="f"/><circle cx="12" cy="12" r="1.4" class="f"/><circle cx="18.5" cy="12" r="1.4" class="f"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  chevdown: '<path d="m5 9 7 7 7-7"/>',
  chevup: '<path d="m5 15 7-7 7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/>',
  bellOff: '<path d="M6 16.5V11a6 6 0 0 1 9.5-4.9M18 11v5.5l1.5 2H8M10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 19.5c.7-3.2 3.2-4.8 6.2-4.8s5.5 1.6 6.2 4.8M16 5.5a3.3 3.3 0 0 1 0 6.3M18 15c2 .6 3.3 2 3.7 4.5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.4l2 1.2M17.5 15.4l2 1.2M4.5 16.6l2-1.2M17.5 8.6l2-1.2"/>',
  share: '<path d="M12 15V3.5M8 7l4-3.8L16 7M6 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 11H18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="3"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  cart: '<path d="M3.5 4.5h2.2l2 10.3a1.5 1.5 0 0 0 1.5 1.2h7.6a1.5 1.5 0 0 0 1.5-1.1l1.5-6.4H6.4"/><circle cx="10" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.7" cy="6.5" r=".9" class="f"/><circle cx="4.7" cy="12" r=".9" class="f"/><circle cx="4.7" cy="17.5" r=".9" class="f"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15.5H6.5A1.5 1.5 0 0 0 5 20zM5 20a1.5 1.5 0 0 0 1.5 1.5H19V18.5"/>',
  shield: '<path d="M12 3.2 5 6v5.5c0 4.3 2.8 7.6 7 9.3 4.2-1.7 7-5 7-9.3V6z"/><path d="m8.8 12 2.4 2.4 4-4.6"/>',
  sparkles: '<path d="M10 4.5 11.6 9 16 10.5 11.6 12 10 16.5 8.4 12 4 10.5 8.4 9zM17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM17 3.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z M14.5 7.5l3 3"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8c0-.4.3-.8.8-.8h3.4c.5 0 .8.4.8.8V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/>',
  housecheck: '<path d="M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="m8.6 13.6 2.4 2.4 4.4-4.9"/>',
  broom: '<path d="M14.5 3.5 11 10M9.2 10.5l7.1 3.1c.8.4 1.2 1.3.8 2.1L15 20.5l-9-4 2.1-4.8c.4-.8 1.3-1.2 2.1-.8zM8 15l2.5 1.2M11 13.7l2.5 1.2"/>',
  shower: '<path d="M5 12.5a7 7 0 0 1 14 0zM12 5.5V3.5M9 15.5v1.5M12 15.5v3M15 15.5v1.5M7 15.5v.5M17 15.5v.5"/>',
  pot: '<path d="M4.5 9h15v6.5a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4zM2.5 9h19M8 5.5c0-1 .8-1.5.8-2.3M12 5.5c0-1 .8-1.5.8-2.3M16 5.5c0-1 .8-1.5.8-2.3"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.5l1.7-2M20 20v-4.5h-4.5"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><path d="M14 14h2.5v2.5H14zM19 14v1M14 19h1.5M17.5 18v2.5H20M20 17.5V19"/>',
  whatsapp: '<path d="M4 20l1.2-4.1A8 8 0 1 1 8.2 19z"/><path d="M9 8.8c.2 3 2.7 5.6 5.8 6l1.2-1.4-2-1-.9.7c-.9-.4-1.8-1.3-2.2-2.2l.7-.9-1-2z"/>',
  download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>',
  upload: '<path d="M12 16V5M7.5 9 12 4.5 16.5 9M5 19.5h14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="9.5" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 7.5-1.8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.2"/>',
  alert: '<path d="M12 4 3 19.5h18zM12 10v4.5M12 17v.2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  swap: '<path d="M7 5 3.5 8.5 7 12M3.5 8.5h13a3 3 0 0 1 3 3M17 19l3.5-3.5L17 12M20.5 15.5h-13a3 3 0 0 1-3-3"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5h12a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8H6.5A2.5 2.5 0 0 1 4 5.5"/><circle cx="16.5" cy="13.5" r="1.1" class="f"/>',
  device: '<rect x="7" y="2.8" width="10" height="18.4" rx="2.6"/><path d="M11 18.2h2"/>',
  desktop: '<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16.5V20"/>',
  tablet: '<rect x="4.5" y="3" width="15" height="18" rx="2.6"/><path d="M11 18h2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><rect x="7.5" y="11" width="3" height="6" rx="1"/><rect x="12.5" y="7" width="3" height="10" rx="1"/><rect x="17.5" y="13" width="2.5" height="4" rx="1"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5S14.5 18 12 20.5C9.5 18 8.4 15.3 8.4 12S9.5 5.9 12 3.5z"/>',
  home2: '<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  star: '<path d="m12 3.8 2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z"/>',
  fire: '<path d="M12 3c.5 3-1.7 4.4-3.2 6.3C7.5 11 7 12.4 7 13.8A5 5 0 0 0 12 19a5 5 0 0 0 5-5.2c0-2.2-1.2-3.4-2-4.8-.5 1-1.2 1.6-2 1.8.5-2.2.2-5.1-1-7.8z"/>',
  poo: '<path d="M12 4c.3 1.6-.5 2.4-1.5 3.2C8.6 7.6 7 8.8 7 10.6c-2 .4-3.5 1.8-3.5 3.6 0 2.8 3.6 5.3 8.5 5.3s8.5-2.5 8.5-5.3c0-1.8-1.5-3.2-3.5-3.6 0-1.6-1.2-2.8-3-3.2.8-.8 1.1-1.9 0-3.4z"/><path d="M9 14.5v.2M15 14.5v.2M10 17c1.3.8 2.7.8 4 0"/>',
  crown: '<path d="m4 8 3.5 3.5L12 5l4.5 6.5L20 8l-1.5 10h-13zM6 20.5h12"/>',
  tricount: '<circle cx="12" cy="12" r="8.5"/><path d="M14.7 9.2c-.5-.8-1.5-1.2-2.7-1.2-1.6 0-2.7.8-2.7 2 0 3 5.4 1.2 5.4 4.2 0 1.2-1.2 2-2.7 2-1.3 0-2.4-.5-3-1.4M12 6.5V8M12 16v1.5"/>',
  print: '<path d="M7 9V4h10v5M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v6H7z"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5M12 8v4.2l2.8 1.7"/>',
  dot: '<circle cx="12" cy="12" r="3" class="f"/>',
  drag: '<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke-width="3"/>',
  up: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
  down: '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i ' + cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = (P[name] || P.dot).replace(/class="f"/g, 'fill="currentColor" stroke="none"');
  return s;
}
export const hasIcon = (n) => n in P;

// ---- layer: sheet / toast ----
const layer = () => document.getElementById('layer');
const calm = () => document.documentElement.classList.contains('no-motion') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let sheetStack = [];
export const hasOpenSheets = () => sheetStack.length > 0;

// Il tasto "indietro" del browser chiude lo sheet aperto (invece di cambiare pagina): ogni sheet aggiunge una voce alla cronologia.
let swallow = 0, swallowTimer = 0, popQueue = 0, popTimer = 0, popHash = '', popBound = false;
function bindPop() {
  if (popBound) return; popBound = true;
  window.addEventListener('popstate', () => {
    if (swallow > 0) { swallow--; return; }               // è il "indietro" che abbiamo chiesto noi
    const top = sheetStack[sheetStack.length - 1]; if (top) top.close({ keepHistory: true });
  });
}
function queuePop(hash) {
  popQueue++; popHash = hash;
  if (popTimer) return;
  popTimer = setTimeout(() => {   // rimandato: se nel frattempo è cambiata pagina (link dentro lo sheet) non si torna indietro
    popTimer = 0; const n = popQueue; popQueue = 0;
    if (!n || location.hash !== popHash || !(history.state && history.state.thSheet)) return;
    swallow++; clearTimeout(swallowTimer); swallowTimer = setTimeout(() => { swallow = 0; }, 900);
    try { history.go(-n); } catch { swallow = 0; }
  }, 0);
}
function syncInert() {
  const app = document.getElementById('app'); const n = sheetStack.length;
  if (app) { if (n) app.setAttribute('inert', ''); else app.removeAttribute('inert'); }
  sheetStack.forEach((s, i) => { if (i < n - 1) s.el.setAttribute('inert', ''); else s.el.removeAttribute('inert'); });
}

export function sheet({ title, body, full = false, onClose, actions } = {}) {
  const scrim = h('div', { class: 'scrim' });
  const bodyEl = h('div', { class: 'body' });
  const head = h('header', null, h('h2', null, title || ''), h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('close'), onclick: () => api.close() }, icon('x')));
  const el = h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '', tabindex: '-1' }, h('div', { class: 'grab' }), head, bodyEl);
  const wrap = h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none' } }, scrim, el);
  const opener = document.activeElement;
  layer().append(wrap); layer().style.pointerEvents = 'auto';
  requestAnimationFrame(() => requestAnimationFrame(() => { if (closed) return; scrim.classList.add('on'); el.classList.add('on'); }));
  let closed = false, hist = false; const hashAtOpen = location.hash;
  const onKey = (e) => {
    if (sheetStack[sheetStack.length - 1] !== api) return;
    if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented) { e.preventDefault(); api.close(); return; }
    if (e.key === 'Tab') {   // il focus resta dentro lo sheet
      const f = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length);
      if (!f.length) { e.preventDefault(); el.focus(); return; }
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === el || !el.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !el.contains(a))) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  const openedAt = performance.now();
  scrim.addEventListener('click', () => { if (performance.now() - openedAt > 450) api.close(); });   // il secondo tocco di un doppio tocco sul pulsante che apre lo sheet non lo richiude
  const api = {
    el, body: bodyEl, setTitle: (s) => { head.firstChild.textContent = s; el.setAttribute('aria-label', s); },
    set(content2) { clear(bodyEl); add(bodyEl, [content2]); },
    close(opts = {}) {
      if (closed) return; closed = true;
      scrim.classList.remove('on'); el.classList.remove('on');
      scrim.style.pointerEvents = 'none'; el.style.pointerEvents = 'none';   // durante l'uscita non blocca più i click
      document.removeEventListener('keydown', onKey);
      const hadFocus = el.contains(document.activeElement);
      sheetStack = sheetStack.filter((x) => x !== api);
      syncInert();
      if (hist) { hist = false; if (!opts.keepHistory) queuePop(hashAtOpen); }
      if (!sheetStack.length) layer().style.pointerEvents = 'none';
      // il focus torna a chi ha aperto lo sheet (se esiste ancora e nessun altro l'ha preso)
      const top = sheetStack[sheetStack.length - 1];
      if (hadFocus || document.activeElement === document.body) {
        const back = opener && opener.isConnected && opener !== document.body && (!top || top.el.contains(opener)) ? opener : null;
        if (back) { try { back.focus({ preventScroll: true }); } catch { /* ignore */ } }
        else if (top && !top.el.contains(document.activeElement)) top.el.focus({ preventScroll: true });
      }
      setTimeout(() => { wrap.remove(); onClose && onClose(); }, calm() ? 30 : 380);
    },
  };
  sheetStack.push(api);
  try { history.pushState({ thSheet: 1 }, '', location.href); hist = true; bindPop(); } catch { /* ignore */ }
  syncInert();
  add(bodyEl, [typeof body === 'function' ? body(api) : body]);
  if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  return api;
}
/** Chiude tutti gli sheet. { keepHistory:true } quando la chiusura nasce già da un cambio di pagina. */
export function closeAllSheets(opts = {}) { [...sheetStack].reverse().forEach((s) => s.close(opts)); }

let toastBox;
/** Notifica temporanea. opts.action = { label, onClick } mostra un pulsante (es. "Annulla"). Restituisce una funzione per chiuderla. */
export function toast(msg, ms = 2600, opts = {}) {
  if (!toastBox || !toastBox.isConnected) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); layer().append(toastBox); }
  // lo stesso messaggio già visibile (doppio tocco) non si accumula: si rinnova
  const dup = !opts.action && [...toastBox.children].find((x) => !x.classList.contains('out') && x.__msg === msg && !x.__action);
  if (dup) { clearTimeout(dup.__timer); dup.__timer = setTimeout(dup.__dismiss, ms); return dup.__dismiss; }
  while (toastBox.children.length >= 3) toastBox.firstChild.remove();
  const el = h('div', { class: 'toast' }, msg);
  const dismiss = () => { if (!el.isConnected || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), calm() ? 30 : 260); };
  if (opts.action) el.append(h('button', { type: 'button', class: 'toast-action', onclick: () => { if (el.__used) return; el.__used = true; try { opts.action.onClick(); } finally { dismiss(); } } }, opts.action.label));
  el.__msg = msg; el.__action = !!opts.action; el.__dismiss = dismiss;
  toastBox.append(el);
  el.__timer = setTimeout(dismiss, opts.action ? Math.max(ms, 6000) : ms);
  return dismiss;
}

export function confirmDialog({ title, text, ok = t('ok'), danger = false, cancel = t('cancel') }) {
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; res(v); s.close(); };
    const s = sheet({ title: title || t('confirm'), onClose: () => finish(false), body: h('div', { class: 'stack' },
      text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn soft', onclick: () => finish(false) }, cancel), h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: () => finish(true) }, ok))) });
  });
}
export function promptDialog({ title, label, value = '', type = 'text', ok = t('save'), placeholder = '' }) {
  return new Promise((res) => {
    let done = false;
    const inp = h('input', { class: 'input', type, value, placeholder, autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'done', 'aria-label': label || title || '' });
    const finish = (v) => { if (done) return; done = true; res(v); s.close(); };
    const s = sheet({ title, onClose: () => finish(null), body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); finish(inp.value); } },
      h('div', { class: 'field' }, label ? h('label', null, label) : null, inp),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn soft', onclick: () => finish(null) }, t('cancel')), h('button', { type: 'submit', class: 'btn' }, ok))) });
    setTimeout(() => { if (!done) inp.focus(); }, calm() ? 40 : 420);
  });
}

// ---- piccoli componenti ----
export function avatar(name, color, cls = '') { return h('div', { class: 'av ' + cls, style: { background: color || '#888' }, title: name }, (name || '?').trim().slice(0, 1).toUpperCase()); }
export function toggle(checked, onchange, label) {
  const inp = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label || '', onchange: (e) => onchange(e.target.checked) });
  inp.checked = !!checked;
  return h('label', { class: 'switch' }, inp, h('i'));
}
export function stepper(value, { min = 0, max = 99, step = 1, onchange, fmt = (v) => v }) {
  let v = value; const out = h('span', null, fmt(v));
  const set = (n) => { v = Math.max(min, Math.min(max, n)); out.textContent = fmt(v); onchange(v); };
  return h('div', { class: 'num' }, h('button', { type: 'button', 'aria-label': '−', onclick: () => set(v - step) }, '−'), out, h('button', { type: 'button', 'aria-label': '+', onclick: () => set(v + step) }, '+'));
}
export function seg(options, value, onchange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  options.forEach(([val, label]) => wrap.append(h('button', { type: 'button', 'aria-pressed': String(val === value), onclick: () => { [...wrap.children].forEach((b) => b.setAttribute('aria-pressed', 'false')); wrap.children[options.findIndex((o) => o[0] === val)].setAttribute('aria-pressed', 'true'); onchange(val); } }, label)));
  return wrap;
}
export function empty(ic, text, sub) { return h('div', { class: 'empty' }, icon(ic), h('div', { style: { fontWeight: 650, color: 'var(--text)' } }, text), sub ? h('div', { class: 'small' }, sub) : null); }
export function liRow({ ic, tone = '', title, desc, end, onclick, href }) {
  const tag = href ? 'a' : onclick ? 'button' : 'div';
  return h(tag, { class: 'li', onclick, href, type: tag === 'button' ? 'button' : undefined }, ic ? h('div', { class: 'ico ' + tone }, icon(ic)) : null,
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), end !== undefined ? h('div', { class: 'end' }, end, onclick || href ? icon('chevron') : null) : (onclick || href ? h('div', { class: 'end' }, icon('chevron')) : null));
}
export function haptic(on = true, ms = 8) { try { if (on && navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } }
export function confetti(x, y) {
  if (document.documentElement.classList.contains('no-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff'];
  for (let i = 0; i < 22; i++) {
    const c = h('i', { class: 'confetti' });
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
    c.style.cssText = `left:${x}px;top:${y}px;background:${cols[i % cols.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d + 60}px;--rot:${Math.random() * 720 - 360}deg`;
    document.body.append(c); setTimeout(() => c.remove(), 1200);
  }
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
}
export function download(filename, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function deviceInfo(ua = navigator.userAgent) {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '?';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) || /CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '?';
  const kind = /iPhone|Android.*Mobile/.test(ua) ? 'device' : /iPad|Android/.test(ua) ? 'tablet' : 'desktop';
  return { os, browser: br, kind, label: `${os} · ${br}` };
}
