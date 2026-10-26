// Spesa: funzioni pure per i suggerimenti (voci frequenti) e per l'incolla di più righe. Nessuna dipendenza dal DOM.

/** Chiave di confronto di una voce: minuscole, spazi compressi, senza accenti "sporchi" di normalizzazione. */
export function normNeed(s) {
  return String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

const ts = (iso) => { const v = Date.parse(iso); return Number.isNaN(v) ? 0 : v; };

/**
 * Voci più usate dalla casa.
 * Fonti: documenti `needs` (anche già comprati) e registro `log` con type 'need' (p.text). Ogni aggiunta scrive entrambi,
 * quindi per ogni voce si prende il MAGGIORE dei due conteggi (non la somma: sarebbe doppio) e così sopravvivono sia le
 * voci cancellate dalla lista (restano nel registro) sia quelle più vecchie del registro (restano tra le scorte).
 * Escluse le voci già in lista aperta. `query` filtra per prefisso (prima) o inclusione (dopo).
 * Ritorna [{ text, key, count, last }], ordinate per uso, poi per recenza, poi alfabetico.
 */
export function frequentNeeds({ needs = {}, log = {}, query = '', limit = 8, max = 80 } = {}) {
  const acc = new Map();   // key -> { text, textAt, fromNeeds, fromLog, last, open }
  const slot = (key) => { let e = acc.get(key); if (!e) { e = { key, text: '', textAt: -1, fromNeeds: 0, fromLog: 0, last: 0, open: false }; acc.set(key, e); } return e; };
  const seen = (e, text, at) => { if (at >= e.textAt) { e.text = text; e.textAt = at; } if (at > e.last) e.last = at; };
  for (const n of Object.values(needs || {})) {
    if (!n || typeof n.text !== 'string') continue;
    const text = n.text.replace(/\s+/g, ' ').trim(); const key = normNeed(text); if (!key) continue;
    const e = slot(key); e.fromNeeds += 1; seen(e, text, ts(n.at));
    if (!n.done) e.open = true;
  }
  for (const l of Object.values(log || {})) {
    if (!l || l.type !== 'need' || !l.p || typeof l.p.text !== 'string') continue;
    const text = l.p.text.replace(/\s+/g, ' ').trim(); const key = normNeed(text); if (!key) continue;
    const e = slot(key); e.fromLog += 1; seen(e, text, ts(l.at));
  }
  const q = normNeed(query);
  const rows = [];
  for (const e of acc.values()) {
    if (e.open || !e.text || e.text.length > max) continue;
    rows.push({ text: e.text, key: e.key, count: Math.max(e.fromNeeds, e.fromLog), last: e.last, pre: q ? (e.key.startsWith(q) ? 0 : e.key.includes(q) ? 1 : 2) : 0 });
  }
  return rows.filter((r) => r.pre < 2)
    .sort((a, b) => a.pre - b.pre || b.count - a.count || b.last - a.last || a.key.localeCompare(b.key))
    .slice(0, limit).map(({ text, key, count, last }) => ({ text, key, count, last }));
}

/** C'è almeno una voce nello storico (scorte o registro)? Serve a decidere se mostrare i suggerimenti di partenza. */
export function hasNeedHistory({ needs = {}, log = {} } = {}) {
  if (Object.values(needs || {}).some((n) => n && typeof n.text === 'string' && n.text.trim())) return true;
  return Object.values(log || {}).some((l) => l && l.type === 'need' && l.p && typeof l.p.text === 'string' && l.p.text.trim());
}

/** Quante voci DIVERSE (normalizzate) compaiono nello storico: sotto una soglia la casa è «nuova» e si propongono le voci di partenza. */
export function distinctNeeds({ needs = {}, log = {} } = {}) {
  const keys = new Set();
  for (const n of Object.values(needs || {})) if (n && typeof n.text === 'string' && normNeed(n.text)) keys.add(normNeed(n.text));
  for (const l of Object.values(log || {})) if (l && l.type === 'need' && l.p && typeof l.p.text === 'string' && normNeed(l.p.text)) keys.add(normNeed(l.p.text));
  return keys.size;
}

/** Suggerimenti di partenza (casa nuova): `starters` = testi localizzati; esclude quelli già in lista aperta. */
export function starterNeeds(starters, needs = {}, limit = 8) {
  const open = new Set(Object.values(needs || {}).filter((n) => n && !n.done && typeof n.text === 'string').map((n) => normNeed(n.text)));
  const seen = new Set(); const out = [];
  for (const s of starters || []) { const k = normNeed(s); if (!k || open.has(k) || seen.has(k)) continue; seen.add(k); out.push(String(s).trim()); }
  return out.slice(0, limit);
}

/**
 * Testo incollato → voci. Una riga = una voce; toglie elenchi puntati/numerati ("- ", "• ", "1) "), spazi doppi, righe vuote,
 * doppioni (case-insensitive) e taglia a `max` caratteri. Una sola riga senza a capo → [] (il campo la gestisce da sé).
 */
export function splitPasted(text, max = 80) {
  const raw = String(text == null ? '' : text);
  if (!/[\r\n\u2028\u2029]/.test(raw.trim())) return [];
  const seen = new Set(); const out = [];
  for (let line of raw.split(/[\r\n\u2028\u2029]+/)) {
    line = line.replace(/^\s*(?:[-*•·▪◦–—]|\d{1,2}[.)]|\[[ xX]?\])\s+/, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
    const k = normNeed(line); if (!k || seen.has(k)) continue;
    seen.add(k); out.push(line);
  }
  return out;
}
