// Logica del "server" notifiche, indipendente da Firebase e web-push (iniettati) per poterla testare.
// Eseguita ogni ora da GitHub Actions (vedi .github/workflows/notify.yml).
import { planNotifications, targetsFor, notifMessage, notifCfg, nameOf } from '../js/extras.js';
import { engineHouse } from '../js/store.js';
import { tr } from '../js/i18n.js';

const DAY = 86400000;

/**
 * @param {object} deps
 *   db: { listHouses():[{id,house}], coll(hid,name):Promise<Object>, setDoc(hid,coll,id,data,merge?), delDoc(hid,coll,id), setHouse(hid,patch) }
 *   send: async (subscription, payload) => void   (lancia errori con .statusCode)
 *   now: Date, vapidPublic: string (chiave pubblica che deve combaciare con quella della casa)
 */
export async function runNotify({ db, send, now = new Date(), vapidPublic, log = () => {} }) {
  const summary = { houses: 0, sent: 0, failed: 0, removed: 0, skipped: [] };
  for (const { id: hid, house } of await db.listHouses()) {
    summary.houses++;
    try {
      if (!house || !house.roommates) { summary.skipped.push(hid + ':empty'); continue; }
      if (vapidPublic && house.vapidPublic && house.vapidPublic !== vapidPublic) { summary.skipped.push(hid + ':vapid-mismatch'); log(`[${hid}] chiave VAPID diversa: salto`); continue; }
      const [weeks, trips, members, sentDocs, requests, needs] = await Promise.all(['weeks', 'trips', 'members', 'sent', 'requests', 'needs'].map((c) => db.coll(hid, c)));
      const eh = engineHouse({ house, weeks, trips });
      const sent = new Set(Object.keys(sentDocs));
      const cfg = notifCfg(house);
      const lang = (m) => (m && m.lang) || house.lang || 'it';

      const deliver = async (n, extra = {}) => {
        const targets = targetsFor(n, members, house);
        let ok = 0;
        for (const t of targets) {
          const msg = n.custom ? n.custom(lang(t)) : notifMessage(n, house, lang(t), eh.weeks);
          const payload = { title: msg.title, body: msg.body, url: msg.url || '#/', tag: n.key || n.type, house: hid, ...extra };
          try { await send(t.push, payload); ok++; summary.sent++; }
          catch (e) {
            summary.failed++;
            if (e && (e.statusCode === 404 || e.statusCode === 410)) { await db.setDoc(hid, 'members', t.id, { push: null }, true); delete members[t.id].push; summary.removed++; }
            else log(`[${hid}] invio fallito a ${t.id}: ${e && (e.statusCode || e.message)}`);
          }
        }
        return ok;
      };

      // 1) promemoria programmati
      for (const n of planNotifications({ house: eh, weeks: eh.weeks, now, sent })) {
        const ok = await deliver(n);
        if (ok > 0) { await db.setDoc(hid, 'sent', n.key, { at: now.toISOString() }, true); sent.add(n.key); }
      }
      // 2) eventi: richieste di scambio, solleciti, scorte
      for (const [rid, rq] of Object.entries(requests)) {
        const name = (id) => nameOf(house, id);
        if (rq.kind === 'nudge') {
          if (rq.notified) continue;
          const ok = await deliver({ type: 'nudges', personId: rq.to, key: 'nudge:' + rid, custom: (l) => ({ title: tr(l, 'n.nudge.title'), body: tr(l, 'n.nudge.body', { name: name(rq.from) || 'Admin', text: rq.text || tr(l, 'n.nudge.default') }), url: '#/' }) });
          if (ok > 0 || !targetsFor({ type: 'nudges', personId: rq.to }, members, house).length) await db.setDoc(hid, 'requests', rid, { notified: true }, true);
        } else if (rq.status === 'pending' && !rq.notified && cfg.requests.on !== false) {
          const ok = await deliver({ type: 'requests', personId: rq.to, key: 'req:' + rid, custom: (l) => ({ title: tr(l, 'n.req.title'), body: tr(l, 'n.req.body', { name: name(rq.from) }), url: '#/requests' }) });
          if (ok > 0) await db.setDoc(hid, 'requests', rid, { notified: true }, true);
        } else if (rq.status === 'accepted' && !rq.notifiedAnswer && cfg.requests.on !== false) {
          const ok = await deliver({ type: 'requests', personId: rq.from, key: 'reqok:' + rid, custom: (l) => ({ title: tr(l, 'n.reqOk.title'), body: tr(l, 'n.reqOk.body', { name: name(rq.to) }), url: '#/' }) });
          if (ok > 0) await db.setDoc(hid, 'requests', rid, { notifiedAnswer: true }, true);
        }
      }
      if (cfg.needs.on) {
        for (const [nid, nd] of Object.entries(needs)) {
          if (nd.notified || nd.done || now - new Date(nd.at) > DAY) continue;
          let any = 0;
          for (const r of house.roommates) {
            if (r.id === nd.by) continue;
            any += await deliver({ type: 'needs', personId: r.id, key: 'need:' + nid + ':' + r.id, custom: (l) => ({ title: tr(l, 'n.need.title'), body: tr(l, 'n.need.body', { name: nameOf(house, nd.by), text: nd.text }), url: '#/needs' }) });
          }
          if (any > 0) await db.setDoc(hid, 'needs', nid, { notified: true }, true);
        }
      }
      // 3) pulizia: voci "sent" e visualizzazioni vecchie
      for (const [k, v] of Object.entries(sentDocs)) if (v.at && now - new Date(v.at) > 5 * DAY) await db.delDoc(hid, 'sent', k);
      const views = await db.coll(hid, 'views');
      for (const [k, v] of Object.entries(views)) if (v.at && now - new Date(v.at) > 60 * DAY) await db.delDoc(hid, 'views', k);
      await db.setHouse(hid, { serverRun: now.toISOString() });
    } catch (e) {
      summary.skipped.push(hid + ':error');
      log(`[${hid}] errore: ${e && e.message}`);
    }
  }
  return summary;
}
