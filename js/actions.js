// Operazioni di alto livello sullo store, con controllo dei permessi. Testabile senza DOM.
import { CHORES, compute, dayNum, addDays, weekEnd, isSunday, parseResult, DEFAULT_SETTINGS } from './engine.js';
import { uid, randomCode, normCode, feature, nameOf, swapPatch, DEFAULT_HOME, weekOfDate, DEFAULT_NOTIF, personById, checklistFor, checklistOwners } from './extras.js';
import { engineHouse } from './store.js';
import { ruleAssigned, finalSwap, diffAssign, applySwap } from './assignlogic.js';

// ---------- PIN admin ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return hex(await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256));
}
export const newSalt = () => randomCode(16);
export async function verifyPin(house, pin) { return !!(house && house.adminHash) && (await hashPin(pin, house.adminSalt)) === house.adminHash; }

// ---------- creazione casa ----------
export async function buildHouse({ id, name, startSunday, roommates, adminPersonId, pin, tz, lang }) {
  const salt = newSalt();
  const rm = roommates.map((r, i) => ({ id: r.id || uid(), name: r.name.trim(), slot: r.slot || i + 1, from: r.from || null, to: r.to || null, ...(!r.to && r.expectedTo ? { expectedTo: r.expectedTo } : {}) }));
  const admin = adminPersonId && rm.find((r) => r.id === adminPersonId || r.name === adminPersonId) ? rm.find((r) => r.id === adminPersonId || r.name === adminPersonId).id : rm[0].id;
  return {
    id, name: name.trim() || 'Casa', startSunday, roommates: rm, settings: { ...DEFAULT_SETTINGS }, features: {}, effort: {}, notif: {}, tasks: [],
    links: { tricount: { url: '', show: true }, whatsapp: { url: '', show: false }, custom: [] }, home: DEFAULT_HOME, lang: lang || 'it',
    tz: tz || 'Europe/Rome', adminSalt: salt, adminHash: await hashPin(pin, salt), adminIds: [admin], createdAt: new Date().toISOString(), version: 1,
  };
}
export function normalizeStartSunday(date) { return isSunday(date) ? date : weekEnd(date); }

// ---------- permessi ----------
export function currentSunday(house, now = new Date()) { return weekOfDate(house, localDate(now)); }
export function localDate(d) { const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

export class Actions {
  /** ctx: { meId, isAdmin, deviceId, now:()=>Date } */
  constructor(store, ctx) { this.s = store; this.ctx = ctx; if (!ctx.now) ctx.now = () => new Date(); }
  get house() { return this.s.state.house || {}; }
  /** Chiede al server di controllare subito le notifiche (se l'admin ha configurato l'avvio immediato). */
  kick() { try { if (this.ctx.kick) this.ctx.kick(); } catch { /* ignore */ } }
  get me() { return this.ctx.meId; }
  get admin() { return !!this.ctx.isAdmin; }
  today() { return localDate(this.ctx.now()); }
  out() { return compute(engineHouse(this.s.state), this.today(), 12); }
  row(sunday) { return this.out().rows.find((r) => r.sunday === sunday); }

  // ---- permessi (usati anche dalla UI per mostrare/nascondere) ----
  canResult(sunday, chore, value) {
    if (this.admin) return true;
    const f = (k) => feature(this.house, k);
    if (!this.me || !f('selfDone')) return false;
    const r = this.row(sunday); if (!r) return false;
    const a = r.assigned[CHORES.indexOf(chore)];
    const age = dayNum(this.today()) - dayNum(sunday);
    if (age > 21) return false;                                     // storico vecchio: solo admin
    const p = parseResult(value);
    if (p.kind === 'done') return a === this.me;
    if (p.kind === '') return a === this.me || (((this.s.state.weeks[sunday] || {}).resultBy || {})[chore] === this.me);  // annulla: l'assegnato o chi aveva segnato
    if (p.kind === 'by') return (p.id === this.me && a !== this.me) || (a === this.me && f('coverOthers'));
    return false;                                                    // saltato / saltato(nome): solo admin
  }
  canAway(personId) { return this.admin || (!!this.me && personId === this.me && feature(this.house, 'selfAway')); }
  canPlan(sunday, chore) { if (!feature(this.house, 'planDay')) return false; if (this.admin) return true; const r = this.row(sunday); return !!r && !!this.me && r.assigned[CHORES.indexOf(chore)] === this.me; }
  canTrip(personId) { return feature(this.house, 'trips') && (this.admin || personId === this.me); }
  canTask(sunday, chore) {   // l'assegnato, l'admin, o chi è responsabile di un arretrato di quella mansione
    if (this.admin) return true; if (!this.me) return false;
    const row = this.row(sunday); if (row && row.assigned[CHORES.indexOf(chore)] === this.me) return true;
    try { const weeks = { ...(this.s.state.weeks || {}) }; return checklistOwners({ ...this.house, weeks }, this.out(), weeks, sunday).some((x) => x.chore === chore && x.owner === this.me); } catch { return false; }
  }
  need(ok) { if (!ok) throw new Error('permission'); }

  // ---- registro ----
  log(type, p = {}) {
    return this.s.setDoc('log', uid(), { at: this.ctx.now().toISOString(), by: this.me || (this.admin ? 'admin' : ''), type, p });
  }

  // ---- turni ----
  async setResult(sunday, chore, value) {
    this.need(this.canResult(sunday, chore, value));
    const at = this.ctx.now().toISOString();
    await this.s.setDoc('weeks', sunday, { result: { [chore]: value || null }, resultAt: { [chore]: value ? at : null }, resultBy: { [chore]: value ? (this.me || 'admin') : null } });
    const p = parseResult(value);
    const type = p.kind === 'done' ? 'done' : p.kind === 'by' ? 'cover' : p.kind === '' ? 'reset' : 'skipped';
    await this.log(type, { week: sunday, chore, who: p.id || null });
  }
  // ---- completamento con checklist, annulla, volontari, sostituzioni, ritardi ----
  weekDoc(sunday) { return (this.s.state.weeks || {})[sunday] || {}; }
  /** Voci di checklist ancora da spuntare per una mansione di una settimana. */
  pendingChecklist(sunday, chore, { all = false } = {}) {
    if (!feature(this.house, 'tasks')) return [];   // funzione spenta: nessun blocco
    const weeks = { ...(this.s.state.weeks || {}) }; const eh = { ...this.house, weeks }; const out = this.out();
    const row = out.rows.find((r) => r.sunday === sunday); const assignee = row && row.assigned[CHORES.indexOf(chore)];
    return checklistOwners(eh, out, weeks, sunday)
      .filter((x) => x.chore === chore && x.status !== 'done' && (all || x.owner === assignee))   // gli arretrati di un altro (se a casa) non bloccano chi ha la mansione ora
      .map((x) => ({ id: x.task.id, text: x.task.text, status: x.status, owner: x.owner, reason: x.reason }));
  }
  /**
   * Segna una mansione come fatta (value 'done' oppure 'by:ID') verificando la checklist.
   * Se mancano voci e !force → { ok:false, missing } e non scrive nulla. Con force scrive e segnala "incompleto".
   */
  async completeChore(sunday, chore, { value = 'done', force = false, checkAll = false } = {}) {
    this.need(this.canResult(sunday, chore, value));
    const missing = this.pendingChecklist(sunday, chore);
    if (missing.length && checkAll) {
      const at = this.ctx.now().toISOString(); const done = {};
      for (const m of missing) done[m.id] = { by: this.me || 'admin', at };
      await this.s.setDoc('weeks', sunday, { tasksDone: done });
      return this.completeChore(sunday, chore, { value, force });
    }
    if (missing.length && !force) return { ok: false, missing };
    await this.s.setDoc('weeks', sunday, { incomplete: { [chore]: missing.length ? missing.map((m) => m.text) : null } });
    await this.setResult(sunday, chore, value);
    if (missing.length) await this.log('incomplete', { week: sunday, chore, n: missing.length });
    return { ok: true, missing };
  }
  /** Annulla un "fatto" segnato per errore (torna "da fare"). */
  async undoResult(sunday, chore) {
    await this.setResult(sunday, chore, '');
    await this.s.setDoc('weeks', sunday, { incomplete: { [chore]: null }, volunteer: { [chore]: null } });
  }
  /** Qualcuno pulisce una mansione che non gli spetta, di sua iniziativa: segnalato all'assegnato. */
  async volunteer(sunday, chore, { force = false, checkAll = false } = {}) {
    const row = this.row(sunday); const a = row && row.assigned[CHORES.indexOf(chore)];
    this.need(!!this.me && !!a && a !== this.me);
    const r = await this.completeChore(sunday, chore, { value: 'by:' + this.me, force, checkAll });
    if (!r.ok) return r;
    await this.s.setDoc('weeks', sunday, { volunteer: { [chore]: this.me } });
    await this.log('volunteer', { week: sunday, chore, who: a });
    await this.notice(a, 'volunteer', { week: sunday, chore });
    return r;
  }
  /** Messaggio informativo (push alla prossima esecuzione del server). */
  async notice(toId, code, p = {}) {
    if (!toId || toId === this.me) return;
    await this.s.setDoc('requests', 'n' + uid(), { kind: 'notice', code, to: toId, from: this.me || 'admin', ...p, status: 'info', at: this.ctx.now().toISOString() });
  }
  /** L'assegnato chiede una sostituzione (a una persona precisa o a chiunque). */
  async requestCover({ week, chore, to = null, terms = 'repay' }) {
    const row = this.row(week); this.need(feature(this.house, 'requests') && !!row && (this.admin || row.assigned[CHORES.indexOf(chore)] === this.me));
    const id = uid(); const from = row.assigned[CHORES.indexOf(chore)];
    await this.s.setDoc('requests', id, { kind: 'cover', week, chore, from, to, terms: terms === 'gift' ? 'gift' : 'repay', status: 'pending', at: this.ctx.now().toISOString() });
    return id;
  }
  /** Qualcuno si offre di fare il turno di un altro: serve il consenso dell'assegnato. */
  /** terms: 'repay' = lo faccio io e tu recuperi (regole del foglio: recupero + riposo) · 'gift' = lo faccio io al posto tuo, senza recupero. */
  async offerCover({ week, chore, terms = 'repay' }) {
    const row = this.row(week); const a = row && row.assigned[CHORES.indexOf(chore)];
    this.need(feature(this.house, 'requests') && !!this.me && !!a && a !== this.me);
    const id = uid();
    await this.s.setDoc('requests', id, { kind: 'offer', week, chore, from: this.me, to: a, terms: terms === 'gift' ? 'gift' : 'repay', status: 'pending', at: this.ctx.now().toISOString() });
    return id;
  }
  /** Risposta a una richiesta di sostituzione/offerta. Accettando, il turno risulta "concordato" con quella persona. */
  async answerCover(reqId, accept) {
    const rq = this.s.state.requests[reqId]; this.need(!!rq && (rq.kind === 'cover' || rq.kind === 'offer') && rq.status === 'pending');
    if (rq.kind === 'cover') this.need(!!this.me && rq.from !== this.me && (!rq.to || rq.to === this.me));
    else this.need(this.admin || rq.to === this.me);
    if (!accept) { await this.s.setDoc('requests', reqId, { status: 'declined', answeredAt: this.ctx.now().toISOString(), notifiedAnswer: false }); return; }
    const who = rq.kind === 'cover' ? this.me : rq.from;
    // 'gift': il turno passa a chi se ne fa carico come scambio concordato (nessun recupero, nessun riposo, nessun CDM); 'repay': resta all'assegnato finché chi lo fa non segna "ha pulito X" (recupero + riposo come da regole)
    await this.s.setDoc('weeks', rq.week, { agreed: { [rq.chore]: who }, ...(rq.terms === 'gift' ? { swap: { [rq.chore]: who } } : {}) });
    await this.s.setDoc('requests', reqId, { status: 'accepted', by: who, answeredAt: this.ctx.now().toISOString(), notifiedAnswer: false });
    await this.log('agreed', { week: rq.week, chore: rq.chore, who, terms: rq.terms || 'repay' });
  }
  /** L'admin sceglie chi deve fare una mansione non svolta/da coprire. */
  async assignCover(sunday, chore, personId) {
    this.need(this.admin);
    await this.s.setDoc('weeks', sunday, { agreed: { [chore]: personId || null } });
    if (personId) { await this.log('agreed', { week: sunday, chore, who: personId }); await this.notice(personId, 'assigned', { week: sunday, chore }); }
  }
  /** "Pulirò in ritardo": annuncia quando (entro 14 giorni dopo la domenica). */
  async setDelay(sunday, chore, date) {
    const row = this.row(sunday); this.need(!!row && (this.admin || row.assigned[CHORES.indexOf(chore)] === this.me));
    if (date && !(dayNum(date) > dayNum(sunday) && dayNum(date) <= dayNum(sunday) + 14)) throw new Error('invalid');
    await this.s.setDoc('weeks', sunday, { delay: { [chore]: date || null } });
    if (date) await this.log('delay', { week: sunday, chore, day: date });
  }

  async setAway(sunday, personId, away) {
    this.need(this.canAway(personId));
    await this.s.setDoc('weeks', sunday, { awayMap: { [personId]: away ? true : null } });
    await this.log(away ? 'away' : 'back', { week: sunday, who: personId });
  }
  async setEveryoneAway(sunday, on) { this.need(this.admin); await this.s.setDoc('weeks', sunday, { everyone: on ? true : null }); }
  async setPlanDay(sunday, chore, date) {
    this.need(this.canPlan(sunday, chore));
    await this.s.setDoc('weeks', sunday, { plan: { [chore]: date || null } });
    if (date) await this.log('plan', { week: sunday, chore, day: date });
  }
  async setNote(sunday, text) { this.need(this.admin || !!this.me); await this.s.setDoc('weeks', sunday, { note: text || null }); }
  async setSwap(sunday, swap) { this.need(this.admin); await this.s.setDoc('weeks', sunday, { swap }); }
  async clearSwap(sunday) { this.need(this.admin); await this.s.setDoc('weeks', sunday, { swap: null }); }
  /**
   * Assegnazione manuale della settimana (solo admin): `wanted` = { floor|bathroom|kitchen: personId | '' | null }.
   * Senza `merge` sostituisce tutto lo swap della settimana (le mansioni non indicate tornano «come da regole»);
   * con `merge` tocca solo le mansioni indicate. Una persona uguale a quella delle regole non crea override (salvo `explicit`).
   * Valida gli id (devono essere persone attive in quella settimana). Ritorna { prev, swap, changes } (prev serve per Annulla).
   */
  async setWeekAssignments(sunday, wanted, { merge = false, explicit = false, logText = '' } = {}) {
    this.need(this.admin);
    const eh = engineHouse(this.s.state);
    const row = compute(eh, this.today(), 26).rows.find((r) => r.sunday === sunday);
    if (!row) throw new Error('invalid');
    const active = new Set(row.nm.filter(Boolean));
    const w = wanted && typeof wanted === 'object' ? wanted : {};
    for (const c of CHORES) if (w[c] && (typeof w[c] !== 'string' || !active.has(w[c]))) throw new Error('invalid');
    const prev = { ...(this.weekDoc(sunday).swap || {}) };
    const ruled = ruleAssigned(eh, this.today(), sunday);
    const { patch, swap } = finalSwap({ existing: prev, ruled, wanted: w, merge, explicit });
    const changes = diffAssign(row.assigned, applySwap(ruled, swap));
    await this.s.setDoc('weeks', sunday, { swap: Object.keys(swap).length ? patch : null });
    await this.log('assign', { week: sunday, text: logText || changes.map((x) => `${x.chore}: ${x.to}`).join(', ') || sunday, n: changes.length });
    return { prev, swap, changes };
  }
  async toggleTask(sunday, taskId, chore, done) {
    this.need(this.canTask(sunday, chore));
    await this.s.setDoc('weeks', sunday, { tasksDone: { [taskId]: done ? { by: this.me || 'admin', at: this.ctx.now().toISOString() } : null } });
    const t = (this.house.tasks || []).find((x) => x.id === taskId);
    if (done && t) await this.log('task', { text: t.text });
  }

  // ---- scambi turno ----
  async requestSwap({ week, myChore, otherId, otherChore }) {
    this.need(!!this.me && feature(this.house, 'requests'));
    const id = uid();
    await this.s.setDoc('requests', id, { week, from: this.me, to: otherId, fromChore: myChore, toChore: otherChore, status: 'pending', at: this.ctx.now().toISOString() });
    return id;
  }
  async answerSwap(reqId, accept) {
    const rq = this.s.state.requests[reqId]; this.need(rq && (rq.to === this.me || this.admin));
    if (!accept) return this.s.setDoc('requests', reqId, { status: 'declined', answeredAt: this.ctx.now().toISOString() });
    const row = this.row(rq.week); this.need(!!row);
    const patch = swapPatch(row, { chore: rq.fromChore, personId: rq.from }, { chore: rq.toChore, personId: rq.to });
    await this.s.setDoc('weeks', rq.week, { swap: patch });
    await this.s.setDoc('requests', reqId, { status: 'accepted', answeredAt: this.ctx.now().toISOString() });
    await this.log('swap', { week: rq.week, chore: rq.fromChore, who: rq.to });
  }
  async cancelSwap(reqId) { const rq = this.s.state.requests[reqId]; this.need(rq && (rq.from === this.me || this.admin)); await this.s.delDoc('requests', reqId); }

  // ---- assenze/viaggi ----
  async addTrip({ personId, from, to, note }) {
    this.need(this.canTrip(personId));
    if (to && dayNum(to) <= dayNum(from)) throw new Error('invalid');
    const id = uid();
    await this.s.setDoc('trips', id, { personId, from, to: to || null, note: note || null, by: this.me || 'admin', at: this.ctx.now().toISOString() });
    await this.log('trip', { who: personId });
    return id;
  }
  async removeTrip(id) { const t = this.s.state.trips[id]; this.need(t && this.canTrip(t.personId)); await this.s.delDoc('trips', id); }

  // ---- compiti condivisi (spazzatura, ecc.) ----
  async completeShared(taskId) {
    this.need(!!this.me || this.admin);
    const t = (this.house.shared || []).find((x) => x.id === taskId); this.need(!!t);
    const st = ((this.house.sharedState || {})[taskId]) || {};
    const history = [...(st.history || []), { by: this.me || 'admin', at: this.ctx.now().toISOString() }].slice(-30);
    await this.s.setHouse({ sharedState: { [taskId]: { history } } });
    await this.log('shared', { text: t.text });
  }
  /** Annulla l'ultimo "fatto" (solo chi l'ha segnato o l'admin). */
  async undoShared(taskId) {
    const st = ((this.house.sharedState || {})[taskId]) || {}; const history = [...(st.history || [])];
    const last = history[history.length - 1]; this.need(!!last && (this.admin || last.by === this.me));
    history.pop(); await this.s.setHouse({ sharedState: { [taskId]: { history } } });
  }
  async saveShared(list) {
    this.need(this.admin);
    const clean = list.map((t) => ({ id: t.id || uid(), text: String(t.text || '').trim().slice(0, 60), every: Math.max(1, Math.min(60, parseInt(t.every, 10) || 1)), enabled: t.enabled !== false })).filter((t) => t.text);
    await this.s.setHouse({ shared: clean });
  }

  // ---- scorte ----
  async addNeed(text, urgent = false) {
    this.need(!!this.me || this.admin);
    const clean = String(text || '').trim().slice(0, 80); if (!clean) throw new Error('invalid');
    const id = uid(); await this.s.setDoc('needs', id, { text: clean, urgent: !!urgent, by: this.me || 'admin', at: this.ctx.now().toISOString(), done: false });
    await this.log('need', { text: clean }); this.kick(); return id;
  }
  async setNeedDone(id, done) { await this.s.setDoc('needs', id, { done: !!done, doneBy: done ? (this.me || 'admin') : null, doneAt: done ? this.ctx.now().toISOString() : null }); if (done) this.kick(); }
  async removeNeed(id) { await this.s.delDoc('needs', id); }
  async clearBought() { const ops = Object.entries(this.s.state.needs).filter(([, n]) => n.done).map(([id]) => ({ coll: 'needs', id, del: true })); if (ops.length) await this.s.write(ops); }

  // ---- ultimo che esce ----
  async setLastOut(itemId, on) {
    this.need(!!this.me || this.admin);
    await this.s.setHouse({ lastOut: { checked: { [itemId]: on ? { by: this.me || 'admin', at: this.ctx.now().toISOString() } : null } } });
  }
  async resetLastOut() { this.need(!!this.me || this.admin); await this.s.setHouse({ lastOut: { checked: null, doneBy: null } }); }
  async finishLastOut() { this.need(!!this.me || this.admin); await this.s.setHouse({ lastOut: { doneBy: this.me || 'admin', doneAt: this.ctx.now().toISOString() } }); }

  // ---- admin ----
  async setHouse(patch) {
    this.need(this.admin);
    // chi cambia le regole (o le rende obbligatorie) le ha appena scritte: non rimandarlo alla schermata "leggi le regole"
    const ack = !!(this.me && patch && ((patch.rules && patch.rules.version) || patch.requireRules === true));
    const v = ack ? String((patch.rules && patch.rules.version) || this.rulesVersion()) : null;
    if (ack && this.ctx.localRulesAckSave) this.ctx.localRulesAckSave(v);   // prima della scrittura: il rerender non deve vedere "non letto"
    await this.s.setHouse(patch);
    if (ack) await this.touchMember({ rulesAck: { version: v, at: this.ctx.now().toISOString() } }).catch(() => {});
  }
  async setRoommates(list) {
    this.need(this.admin);
    // `to` = uscita CERTA (cambia i turni); `expectedTo` = uscita solo prevista/indicativa (non influisce sul piano); vuoti = "non si sa"
    const clean = list.map((r) => ({ id: r.id || uid(), name: String(r.name || '').trim(), slot: +r.slot || 1, from: r.from || null, to: r.to || null, ...(!r.to && r.expectedTo ? { expectedTo: r.expectedTo } : {}), ...(r.color ? { color: r.color } : {}) })).filter((r) => r.name);
    await this.s.write({ coll: 'house', data: { roommates: clean } });
    await this.log('roommates', {});
  }
  /** Prova dal server a tutte le persone con notifiche attive (una richiesta per persona: arriva a tutti i suoi dispositivi). Ritorna quante. */
  async testAll() {
    this.need(this.admin);
    const people = new Set(Object.values(this.s.state.members || {}).filter((m) => m && m.personId && m.push && m.push.endpoint).map((m) => m.personId));
    const at = this.ctx.now().toISOString();
    for (const to of people) await this.s.setDoc('requests', 'tst' + uid(), { kind: 'test', to, from: this.me || 'admin', status: 'info', at });
    return people.size;
  }
  async nudge(personId, text) {
    this.need(this.admin || !!this.me);
    const id = uid(); await this.s.setDoc('requests', 'n' + id, { kind: 'nudge', to: personId, from: this.me || 'admin', text: text || '', status: 'pending', at: this.ctx.now().toISOString() });
  }

  /** Passa il ruolo di admin a un'altra persona con un nuovo PIN. I dispositivi admin precedenti vengono bloccati (adminEpoch). */
  async changeAdmin({ personId, pin }) {
    this.need(this.admin);
    if (!personById(this.house, personId) || String(pin || '').length < 4) throw new Error('invalid');
    const salt = newSalt();
    await this.s.setHouse({ adminIds: [personId], adminEpoch: (this.house.adminEpoch || 1) + 1, adminSalt: salt, adminHash: await hashPin(pin, salt) });
    await this.log('settings', {});
  }

  // ---- codice casa ----
  /** Genera un nuovo codice: copia tutto, verifica, poi cancella la vecchia casa (il vecchio link smette di funzionare). */
  async rotateCode({ leavingPersonIds = [] } = {}) {
    this.need(this.admin);
    const members = this.s.state.members || {};
    const drop = Object.entries(members).filter(([, m]) => leavingPersonIds.includes(m.personId)).map(([id]) => id);
    const newId = randomCode(12);
    const oldId = this.house.id;
    const prev = [...(this.house.prevIds || []), oldId].slice(-5);
    const r = await this.s.b.cloneTo(newId, { dropDevices: drop, patchHouse: { prevIds: prev, rotatedAt: this.ctx.now().toISOString(), createdAt: this.house.createdAt } });
    if (!r.ok) throw new Error('clone-failed');
    await this.s.b.wipe();
    return { newId, oldId };
  }
  /** Persone uscite (data "fino al" passata) dopo l'ultima rotazione del codice: servono a ricordare di cambiare il link. */
  leftSinceRotation() {
    const h = this.house; const today = this.today();
    const rot = h.rotatedAt ? h.rotatedAt.slice(0, 10) : '';
    return (h.roommates || []).filter((r) => r.to && r.to < today && r.to >= (rot || '0000-00-00') && !(h.ignoreLeft || {})[r.id]);
  }

  /** Persone senza data di uscita certa ma con "uscita prevista" (indicativa) entro `days` giorni o già passata: servono a ricordare di organizzare il cambio. */
  expectedExits(days = 21) {
    const today = this.today(); const lim = addDays(today, days);
    return (this.house.roommates || []).filter((r) => !r.to && r.expectedTo && r.expectedTo <= lim && !(this.house.ignoreLeft || {})[r.id])
      .map((r) => ({ ...r, overdue: r.expectedTo < today, inDays: dayNum(r.expectedTo) - dayNum(today) }));
  }

  // ---- regole da leggere ----
  rulesVersion() { return String((this.house.rules && this.house.rules.version) || 1); }
  rulesRequired() { return this.house.requireRules !== false && feature(this.house, 'rules'); }
  async acceptRules() {
    this.need(!!this.me);
    await this.touchMember({ rulesAck: { version: this.rulesVersion(), at: this.ctx.now().toISOString() } });
  }
  rulesAccepted() {
    if (this.ctx.localRulesAck && this.ctx.localRulesAck() === this.rulesVersion()) return true; // ricordato su questo dispositivo (i dati del cloud possono arrivare dopo)
    const m = (this.s.state.members || {})[this.ctx.deviceId]; return !!(m && m.rulesAck && m.rulesAck.version === this.rulesVersion());
  }

  // ---- dispositivi / accessi ----
  async touchMember(patch) {
    if (!this.ctx.deviceId) return;
    await this.s.setDoc('members', this.ctx.deviceId, { ...patch, lastSeen: this.ctx.now().toISOString(), personId: this.me || null, isAdmin: !!this.admin });
  }
  async recordView(screen) {
    if (!this.ctx.deviceId) return;
    await this.s.setDoc('views', uid(), { at: this.ctx.now().toISOString(), device: this.ctx.deviceId, personId: this.me || null, screen });
  }
}

/** Esporta/importa backup JSON della casa. */
export function exportBackup(state) {
  const data = JSON.parse(JSON.stringify({ ...state, members: {}, views: {} }));
  if (data.house) delete data.house.kick;   // il token GitHub non finisce mai in un file di backup/esportazione
  return { app: 'casa-pulita', version: 1, exportedAt: new Date().toISOString(), data };
}
export function importBackupOps(backup, keepHouseId) {
  if (!backup || backup.app !== 'casa-pulita' || !backup.data || !backup.data.house) throw new Error('invalid');
  const d = backup.data; const ops = [];
  ops.push({ coll: 'house', data: { ...d.house, id: keepHouseId || d.house.id }, set: true });
  for (const c of ['weeks', 'trips', 'needs', 'log', 'requests']) for (const [id, v] of Object.entries(d[c] || {})) ops.push({ coll: c, id, data: v, set: true });
  return ops;
}

// Le azioni che generano una notifica chiedono al server di controllare subito (vedi js/kick.js).
for (const m of ['requestCover', 'offerCover', 'answerCover', 'requestSwap', 'answerSwap', 'assignCover', 'nudge', 'testAll', 'setDelay']) {
  const f = Actions.prototype[m];
  Actions.prototype[m] = async function (...a) { const r = await f.apply(this, a); this.kick(); return r; };
}
