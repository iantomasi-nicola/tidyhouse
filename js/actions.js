// Operazioni di alto livello sullo store, con controllo dei permessi. Testabile senza DOM.
import { CHORES, compute, dayNum, addDays, weekEnd, isSunday, parseResult, DEFAULT_SETTINGS } from './engine.js';
import { uid, randomCode, normCode, feature, nameOf, swapPatch, DEFAULT_HOME, weekOfDate, DEFAULT_NOTIF } from './extras.js';
import { engineHouse } from './store.js';

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
    if (p.kind === 'done' || p.kind === '') return a === this.me;
    if (p.kind === 'by') return (p.id === this.me && a !== this.me) || (a === this.me && f('coverOthers'));
    return false;                                                    // saltato / saltato(nome): solo admin
  }
  canAway(personId) { return this.admin || (!!this.me && personId === this.me && feature(this.house, 'selfAway')); }
  canPlan(sunday, chore) { if (!feature(this.house, 'planDay')) return false; if (this.admin) return true; const r = this.row(sunday); return !!r && !!this.me && r.assigned[CHORES.indexOf(chore)] === this.me; }
  canTrip(personId) { return feature(this.house, 'trips') && (this.admin || personId === this.me); }
  canTask(sunday, chore) { return this.admin || (!!this.me && (this.row(sunday) || { assigned: [] }).assigned[CHORES.indexOf(chore)] === this.me); }
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

  // ---- scorte ----
  async addNeed(text, urgent = false) {
    this.need(!!this.me || this.admin);
    const clean = String(text || '').trim().slice(0, 80); if (!clean) throw new Error('invalid');
    const id = uid(); await this.s.setDoc('needs', id, { text: clean, urgent: !!urgent, by: this.me || 'admin', at: this.ctx.now().toISOString(), done: false });
    await this.log('need', { text: clean }); return id;
  }
  async setNeedDone(id, done) { await this.s.setDoc('needs', id, { done: !!done, doneBy: done ? (this.me || 'admin') : null, doneAt: done ? this.ctx.now().toISOString() : null }); }
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
  async setHouse(patch) { this.need(this.admin); await this.s.setHouse(patch); }
  async setRoommates(list) {
    this.need(this.admin);
    // `to` = uscita CERTA (cambia i turni); `expectedTo` = uscita solo prevista/indicativa (non influisce sul piano); vuoti = "non si sa"
    const clean = list.map((r) => ({ id: r.id || uid(), name: String(r.name || '').trim(), slot: +r.slot || 1, from: r.from || null, to: r.to || null, ...(!r.to && r.expectedTo ? { expectedTo: r.expectedTo } : {}), ...(r.color ? { color: r.color } : {}) })).filter((r) => r.name);
    await this.s.write({ coll: 'house', data: { roommates: clean } });
    await this.log('roommates', {});
  }
  async nudge(personId, text) {
    this.need(this.admin || !!this.me);
    const id = uid(); await this.s.setDoc('requests', 'n' + id, { kind: 'nudge', to: personId, from: this.me || 'admin', text: text || '', status: 'pending', at: this.ctx.now().toISOString() });
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
  rulesAccepted() { const m = (this.s.state.members || {})[this.ctx.deviceId]; return !!(m && m.rulesAck && m.rulesAck.version === this.rulesVersion()); }

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
export function exportBackup(state) { return { app: 'casa-pulita', version: 1, exportedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify({ ...state, members: {}, views: {} })) }; }
export function importBackupOps(backup, keepHouseId) {
  if (!backup || backup.app !== 'casa-pulita' || !backup.data || !backup.data.house) throw new Error('invalid');
  const d = backup.data; const ops = [];
  ops.push({ coll: 'house', data: { ...d.house, id: keepHouseId || d.house.id }, set: true });
  for (const c of ['weeks', 'trips', 'needs', 'log', 'requests']) for (const [id, v] of Object.entries(d[c] || {})) ops.push({ coll: c, id, data: v, set: true });
  return ops;
}
