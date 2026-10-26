// Strato dati con interfaccia unica: memoria (test), locale (localStorage) e cloud (Firestore).
//
// Stato:  { house, weeks:{sunday:{}}, trips:{id:{}}, needs:{id:{}}, members:{deviceId:{}}, log:{id:{}}, requests:{id:{}}, views:{id:{}} }
// Scrittura: write([{coll:'house'|'weeks'|..., id, data, del}])  -- data viene unito (merge profondo); i valori null cancellano il campo.

export const COLLS = ['weeks', 'trips', 'needs', 'members', 'log', 'requests', 'views'];
const emptyState = () => ({ house: null, weeks: {}, trips: {}, needs: {}, members: {}, log: {}, requests: {}, views: {} });

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Merge profondo: i null cancellano la chiave. Restituisce un nuovo oggetto. */
export function mergeDeep(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete out[k];
    else if (v === undefined) continue;
    else if (isObj(v)) { const m = mergeDeep(out[k], v); if (Object.keys(m).length || !isObj(out[k])) out[k] = m; else out[k] = m; }
    else out[k] = v;
  }
  return out;
}
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function applyOps(state, ops) {
  for (const op of ops) {
    if (op.coll === 'house') {
      if (op.del) state.house = null;
      else state.house = op.set ? clone(op.data) : mergeDeep(state.house || {}, clone(op.data));
    } else {
      if (!state[op.coll]) state[op.coll] = {};
      if (op.del) delete state[op.coll][op.id];
      else state[op.coll][op.id] = op.set ? clone(op.data) : mergeDeep(state[op.coll][op.id] || {}, clone(op.data));
    }
  }
  return state;
}

// ---------------- Memoria (con "hub" condiviso per simulare piu' dispositivi) ----------------
export class MemoryHub { constructor() { this.houses = new Map(); this.listeners = new Map(); } }

export class MemoryBackend {
  constructor(hub = new MemoryHub()) { this.hub = hub; this.kind = 'memory'; this.id = null; this.state = emptyState(); this.cbs = new Set(); this.status = 'synced'; this.online = true; this.queue = []; }
  async open(id) {
    this.id = id;
    const h = this.hub.houses.get(id);
    this.state = h ? clone(h) : emptyState();
    if (!this.hub.listeners.has(id)) this.hub.listeners.set(id, new Set());
    this.hub.listeners.get(id).add(this);
    this._emit();
    return { exists: !!this.state.house };
  }
  subscribe(cb) { this.cbs.add(cb); cb(this.state); return () => this.cbs.delete(cb); }
  getState() { return this.state; }
  _emit() { for (const cb of this.cbs) cb(this.state); }
  async write(ops) {
    if (!this.online) { this.queue.push(...ops); this.status = 'offline'; this._applyLocal(ops); return; }
    this._commit(ops);
  }
  _applyLocal(ops) { applyOps(this.state, ops); this._emit(); }
  _commit(ops) {
    const h = this.hub.houses.get(this.id) || emptyState();
    applyOps(h, ops);
    this.hub.houses.set(this.id, h);
    this.persist && this.persist(h);
    for (const peer of this.hub.listeners.get(this.id) || []) { peer.state = clone(h); peer._emit(); }
  }
  /** Copia tutta la casa in un nuovo id (escludendo i dispositivi indicati) e verifica il conteggio. */
  async cloneTo(newId, { dropDevices = [], patchHouse = {} } = {}) {
    const src = clone(this.state);
    const dst = emptyState();
    dst.house = { ...src.house, ...patchHouse, id: newId };
    for (const c of COLLS) for (const [id, v] of Object.entries(src[c] || {})) {
      if (c === 'members' && dropDevices.includes(id)) continue;
      if (c === 'views') continue;
      dst[c][id] = v;
    }
    this.hub.houses.set(newId, dst);
    this.persistOther && this.persistOther(newId, dst);
    const counts = (st) => COLLS.filter((c) => c !== 'views' && c !== 'members').map((c) => Object.keys(st[c] || {}).length).join();
    return { ok: counts(this.hub.houses.get(newId)) === counts(src), id: newId };
  }
  async wipe() { this.hub.houses.delete(this.id); this.removePersisted && this.removePersisted(this.id); this.state = emptyState(); this._emit(); }
  setOnline(on) { this.online = on; if (on && this.queue.length) { const q = this.queue; this.queue = []; this._commit(q); } this.status = on ? 'synced' : 'offline'; }
  close() { const s = this.hub.listeners.get(this.id); if (s) s.delete(this); this.cbs.clear(); }
}

// ---------------- Locale (localStorage) ----------------
export class LocalBackend extends MemoryBackend {
  constructor() { super(new MemoryHub()); this.kind = 'local'; }
  key(id) { return 'cp:h:' + id; }
  async open(id) {
    let raw = null;
    try { raw = localStorage.getItem(this.key(id)); } catch { /* ignore */ }
    if (raw) { try { this.hub.houses.set(id, { ...emptyState(), ...JSON.parse(raw) }); } catch { /* ignore */ } }
    this.persist = (h) => { try { localStorage.setItem(this.key(id), JSON.stringify(h)); } catch { /* quota */ } };
    this.persistOther = (nid, h) => { try { localStorage.setItem(this.key(nid), JSON.stringify(h)); } catch { /* quota */ } };
    this.removePersisted = (rid) => { try { localStorage.removeItem(this.key(rid)); } catch { /* ignore */ } };
    this._onStorage = (e) => { if (e.key === this.key(id) && e.newValue) { try { const h = { ...emptyState(), ...JSON.parse(e.newValue) }; this.hub.houses.set(id, h); this.state = clone(h); this._emit(); } catch { /* ignore */ } } };
    try { window.addEventListener('storage', this._onStorage); } catch { /* node */ }
    return super.open(id);
  }
  close() { try { window.removeEventListener('storage', this._onStorage); } catch { /* ignore */ } super.close(); }
  exportAll() { return clone(this.hub.houses.get(this.id) || this.state); }
}

// ---------------- Cloud (Firestore) ----------------
export class CloudBackend {
  constructor(config, loader) { this.config = config; this.loader = loader || (() => import('../vendor/firebase.js')); this.kind = 'cloud'; this.state = emptyState(); this.cbs = new Set(); this.unsubs = []; this.status = 'syncing'; this.fs = null; }
  async _init() {
    if (this.db) return;
    const m = (this.fs = await this.loader());
    // un solo app/Firestore per sessione: richiamare initializeFirestore due volte lancia un errore
    const key = JSON.stringify(this.config);
    if (!CloudBackend._shared || CloudBackend._shared.key !== key) {
      const app = m.initializeApp(this.config);
      let db;
      try { db = m.initializeFirestore(app, { localCache: m.persistentLocalCache({ tabManager: m.persistentMultipleTabManager() }) }); }
      catch { db = m.initializeFirestore(app, {}); }
      // solo per i test: ?emu=127.0.0.1:8080 collega l'app all'emulatore locale (accettati solo host locali)
      try { const emu = new URLSearchParams(location.search).get('emu'); const mm = emu && emu.match(/^(127\.0\.0\.1|localhost):(\d{2,5})$/); if (mm && m.connectFirestoreEmulator) m.connectFirestoreEmulator(db, mm[1], +mm[2]); } catch { /* ignore */ }
      CloudBackend._shared = { key, db };
    }
    this.db = CloudBackend._shared.db;
  }
  _doc(coll, id) { const m = this.fs; return coll === 'house' ? m.doc(this.db, 'houses', this.id) : m.doc(this.db, 'houses', this.id, coll, id); }
  _coll(coll) { return this.fs.collection(this.db, 'houses', this.id, coll); }
  async open(id) {
    this.id = id;
    await this._init();
    const m = this.fs;
    const snap = await m.getDoc(this._doc('house'));
    if (!snap.exists()) return { exists: false };
    this.state = emptyState(); this.state.house = snap.data();
    const ready = new Set();
    const markReady = (k) => { ready.add(k); if (ready.size === 1 + COLLS.length) this._emit(); };
    this.unsubs.push(m.onSnapshot(this._doc('house'), { includeMetadataChanges: true }, (s) => {
      if (s.exists()) this.state.house = s.data();
      this.status = s.metadata.hasPendingWrites ? 'syncing' : (s.metadata.fromCache && typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'synced');
      markReady('house'); if (ready.size > COLLS.length) this._emit();
    }, () => { this.status = 'offline'; this._emit(); }));
    for (const c of COLLS) {
      const q = c === 'log' || c === 'views' ? m.query(this._coll(c), m.orderBy('at', 'desc'), m.limit(c === 'log' ? 200 : 400)) : this._coll(c);
      this.unsubs.push(m.onSnapshot(q, (qs) => {
        const o = {}; qs.forEach((d) => { o[d.id] = d.data(); }); this.state[c] = o;
        markReady(c); if (ready.size > COLLS.length) this._emit();
      }, () => { this.status = 'offline'; markReady(c); }));
    }
    return { exists: true };
  }
  subscribe(cb) { this.cbs.add(cb); cb(this.state); return () => this.cbs.delete(cb); }
  getState() { return this.state; }
  _emit() { for (const cb of this.cbs) cb(this.state); }
  _fsData(data) {
    const m = this.fs;
    const walk = (v) => {
      if (v === null) return m.deleteField();
      if (Array.isArray(v)) return v.map((x) => (isObj(x) ? walkNoDel(x) : x));
      if (isObj(v)) { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = walk(x); return o; }
      return v;
    };
    const walkNoDel = (v) => { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== null) o[k] = isObj(x) ? walkNoDel(x) : x; return o; };
    return walk(data);
  }
  async write(ops) {
    // aggiornamento ottimistico immediato, poi invio
    applyOps(this.state, ops); this._emit();
    const m = this.fs; const b = m.writeBatch(this.db);
    for (const op of ops) {
      const ref = this._doc(op.coll, op.id);
      if (op.del) b.delete(ref);
      else if (op.set) b.set(ref, this._fsData(JSON.parse(JSON.stringify(op.data))));
      else b.set(ref, this._fsData(clone(op.data)), { merge: true });
    }
    await b.commit();
  }
  /** Copia la casa in un nuovo id (a blocchi da 400 scritture) e verifica il conteggio dei documenti. */
  async cloneTo(newId, { dropDevices = [], patchHouse = {} } = {}) {
    const m = this.fs;
    const items = [];
    const house = { ...this.state.house, ...patchHouse, id: newId };
    items.push({ ref: m.doc(this.db, 'houses', newId), data: house });
    const expect = {};
    for (const c of COLLS) {
      if (c === 'views') continue;
      const qs = await m.getDocs(this._coll(c)); let n = 0;
      qs.forEach((d) => { if (c === 'members' && dropDevices.includes(d.id)) return; items.push({ ref: m.doc(this.db, 'houses', newId, c, d.id), data: d.data() }); n++; });
      expect[c] = n;
    }
    for (let i = 0; i < items.length; i += 400) {
      const b = m.writeBatch(this.db);
      for (const it of items.slice(i, i + 400)) b.set(it.ref, JSON.parse(JSON.stringify(it.data)));
      await b.commit();
    }
    // verifica: stessi conteggi nella nuova casa
    for (const c of COLLS) { if (c === 'views') continue; const qs = await m.getDocs(m.collection(this.db, 'houses', newId, c)); if (qs.size !== expect[c]) return { ok: false, id: newId }; }
    return { ok: true, id: newId };
  }
  /** Elimina tutti i dati della casa (documento + sottocollezioni). */
  async wipe() {
    const m = this.fs;
    for (const c of COLLS) {
      const qs = await m.getDocs(this._coll(c)); const refs = []; qs.forEach((d) => refs.push(d.ref));
      for (let i = 0; i < refs.length; i += 400) { const b = m.writeBatch(this.db); refs.slice(i, i + 400).forEach((r) => b.delete(r)); await b.commit(); }
    }
    await m.deleteDoc(this._doc('house'));
  }
  close() { this.unsubs.forEach((u) => u()); this.unsubs = []; this.cbs.clear(); }
}

// ---------------- Store ----------------
export class Store {
  constructor(backend) { this.b = backend; this.listeners = new Set(); this._unsub = backend.subscribe((s) => { for (const l of this.listeners) l(s); }); }
  get state() { return this.b.getState(); }
  get kind() { return this.b.kind; }
  get status() { return this.b.status; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  write(ops) { return this.b.write(Array.isArray(ops) ? ops : [ops]); }
  setHouse(patch, set = false) { return this.write({ coll: 'house', data: patch, set }); }
  setDoc(coll, id, data, set = false) { return this.write({ coll, id, data, set }); }
  delDoc(coll, id) { return this.write({ coll, id, del: true }); }
  close() { this._unsub(); this.b.close(); }
}

/** Costruisce la vista "house" per il motore: casa + settimane (con assenze unite) + viaggi. */
export function engineHouse(state) {
  const h = state.house || {};
  const weeks = {};
  for (const [k, w] of Object.entries(state.weeks || {})) {
    const away = [...(w.away || []), ...Object.entries(w.awayMap || {}).filter(([, v]) => v).map(([id]) => id)];
    weeks[k] = { ...w, away: [...new Set(away)] };
  }
  return { ...h, weeks, trips: Object.entries(state.trips || {}).map(([id, t]) => ({ id, ...t })) };
}
