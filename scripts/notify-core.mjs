// Logica del "server" notifiche, indipendente da Firebase e web-push (iniettati) per poterla testare.
// Eseguita ogni ora da GitHub Actions (vedi .github/workflows/notify.yml).
import { planNotifications, targetsFor, notifMessage, notifCfg, nameOf, awayToday, localParts } from '../js/extras.js';
import { engineHouse } from '../js/store.js';
import { tr, registerStrings } from '../js/i18n.js';
import { it as nIt, en as nEn } from '../js/strings/notify.js';
registerStrings(nIt, nEn);
const CH = (l, c) => tr(l, 'chore.' + c);

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
    const label = 'casa ' + summary.houses;   // mai il codice della casa nei log (il repo è pubblico: i log li legge chiunque)
    try {
      if (!house || !house.roommates) { summary.skipped.push(label + ':empty'); continue; }
      if (vapidPublic && house.vapidPublic && house.vapidPublic !== vapidPublic) { summary.skipped.push(label + ':vapid-mismatch'); log(`[${label}] chiave VAPID diversa da quella del server: salto`); continue; }
      const [weeks, trips, members, sentDocs, requests, needs] = await Promise.all(['weeks', 'trips', 'members', 'sent', 'requests', 'needs'].map((c) => db.coll(hid, c)));
      const eh = engineHouse({ house, weeks, trips });
      const sent = new Set(Object.keys(sentDocs));
      const cfg = notifCfg(house);
      const lang = (m) => (m && m.lang) || house.lang || 'it';
      const today = localParts(now, house.tz || 'Europe/Rome').date;
      const active = house.roommates.filter((r) => !r.to || r.to >= today);
      const home = (id) => !awayToday(eh, id, today);
      { // diagnosi (solo conteggi: i log di un repo pubblico sono leggibili da tutti)
        const withPush = Object.values(members).filter((m) => m && m.push && m.push.endpoint);
        log(`[${label}] diagnosi: dispositivi ${Object.keys(members).length}, con push ${withPush.length} (persone ${new Set(withPush.map((m) => m.personId)).size}), voci spesa ${Object.keys(needs).length}, spesa ${cfg.needs.on ? 'attiva' : 'spenta'}`);
      }

      // Le notifiche della stessa esecuzione per lo stesso dispositivo si fondono in UN solo avviso («3 novità in casa»).
      const queue = new Map();   // deviceId -> { t, items: [pending] }
      const after = [];          // azioni da fare dopo l'invio (segnare come inviato)
      /** Mette in coda una notifica; ritorna { ok, targets } che si riempie dopo l'invio. */
      const go = (n) => {
        const targets = targetsFor(n, members, house).filter((t) => !n.onlyDevice || t.id === n.onlyDevice).filter((t) => !n.skipAway || home(t.personId));
        const p = { n, targets: targets.length, ok: 0 };
        for (const t of targets) { if (!queue.has(t.id)) queue.set(t.id, { t, items: [] }); queue.get(t.id).items.push(p); }
        return p;
      };
      const msgFor = (n, t) => (n.custom ? n.custom(lang(t)) : notifMessage(n, house, lang(t), eh.weeks));
      const flush = async () => {
        for (const { t, items } of queue.values()) {
          const l = lang(t);
          const msgs = items.map((p) => ({ p, m: msgFor(p.n, t) }));
          let payload;
          if (msgs.length === 1) {
            const { p, m } = msgs[0];
            payload = { title: m.title, body: m.body, url: m.url || '#/', tag: p.n.key || p.n.type, house: hid, ...(m.actions && m.actions.length ? { actions: m.actions.slice(0, 2) } : {}) };
          } else {
            const line = (m) => (m.body && m.body.length <= 70 ? m.body : m.title);
            payload = { title: tr(l, 'n.multi.title', { n: msgs.length }), body: msgs.map(({ m }) => line(m)).join(tr(l, 'n.multi.sep')), url: '#/', tag: 'multi', house: hid };
          }
          try { await send(t.push, payload); summary.sent++; for (const { p } of msgs) p.ok++; }
          catch (e) {
            summary.failed++;
            if (e && (e.statusCode === 404 || e.statusCode === 410)) { await db.setDoc(hid, 'members', t.id, { push: null }, true); delete members[t.id].push; summary.removed++; }
            else log(`[${label}] invio fallito: ${e && (e.statusCode || e.message)}`);
          }
        }
        for (const fn of after) await fn();
      };
      const markSent = (key) => async () => { await db.setDoc(hid, 'sent', key, { at: now.toISOString() }, true); sent.add(key); };
      const act = (l, action, url) => ({ action, title: tr(l, 'n.act.' + action), url });

      // 1) promemoria programmati
      for (const n of planNotifications({ house: eh, weeks: eh.weeks, now, sent })) {
        const p = go(n); after.push(async () => { if (p.ok > 0) await markSent(n.key)(); });
      }
      // 2) eventi: richieste di scambio, solleciti, prove
      for (const [rid, rq] of Object.entries(requests)) {
        const name = (id) => nameOf(house, id) || 'Admin';
        const reqOn = cfg.requests.on !== false;
        const mark = (patch, p) => after.push(async () => { if (p.ok > 0) await db.setDoc(hid, 'requests', rid, patch, true); });
        const answer = (l) => [act(l, 'accept', '#/do/accept/' + rid), act(l, 'decline', '#/do/decline/' + rid)];
        if (rq.kind === 'nudge') {
          if (rq.notified) continue;
          const p = go({ type: 'nudges', personId: rq.to, key: 'nudge:' + rid, custom: (l) => ({ title: tr(l, 'n.nudge.title'), body: tr(l, 'n.nudge.body', { name: name(rq.from), text: rq.text || tr(l, 'n.nudge.default') }), url: '#/' }) });
          after.push(async () => { if (p.ok > 0 || !p.targets) await db.setDoc(hid, 'requests', rid, { notified: true }, true); });
        } else if (rq.kind === 'test') {   // prova dal server: una prova vecchia non parte più; dopo il tentativo è comunque chiusa
          if (rq.notified) continue;
          if (!rq.at || now - new Date(rq.at) <= DAY) go({ type: 'test', personId: rq.to, onlyDevice: rq.device, key: 'test:' + rid, custom: (l) => ({ title: tr(l, 'n.test.title'), body: tr(l, 'n.test.body'), url: '#/' }) });
          after.push(async () => { await db.setDoc(hid, 'requests', rid, { notified: true }, true); });
        } else if (rq.kind === 'notice') {
          if (rq.notified || !reqOn) continue;
          mark({ notified: true }, go({ type: 'requests', personId: rq.to, key: 'notice:' + rid, custom: (l) => ({ title: tr(l, `n.notice.${rq.code}.title`), body: tr(l, `n.notice.${rq.code}.body`, { name: name(rq.from), chore: CH(l, rq.chore) }), url: '#/' }) }));
        } else if (rq.kind === 'cover' || rq.kind === 'offer') {
          if (!reqOn) continue;
          if (rq.status === 'pending' && !rq.notified) {
            // sostituzione aperta a tutti: solo a chi è a casa (gli assenti non possono comunque farla)
            const targets = rq.kind === 'offer' ? [rq.to] : rq.to ? [rq.to] : active.map((r) => r.id).filter((x) => x !== rq.from);
            const ps = targets.map((pid) => go({ type: 'requests', personId: pid, key: `${rq.kind}:${rid}:${pid}`, skipAway: rq.kind === 'cover' && !rq.to, custom: (l) => ({ title: tr(l, rq.kind === 'offer' ? 'n.offer.title' : 'n.cover.title'), body: tr(l, rq.kind === 'offer' ? 'n.offer.body' : 'n.cover.body', { name: name(rq.from), chore: CH(l, rq.chore) }) + ' ' + tr(l, rq.terms === 'gift' ? 'n.terms.gift' : 'n.terms.repay'), url: '#/requests', actions: answer(l) }) }));
            after.push(async () => { if (ps.some((p) => p.ok > 0) || ps.every((p) => !p.targets)) await db.setDoc(hid, 'requests', rid, { notified: true }, true); });
          } else if (rq.status !== 'pending' && rq.notifiedAnswer === false) {
            const ok = rq.status === 'accepted'; const who = rq.kind === 'offer' ? rq.to : rq.by;
            mark({ notifiedAnswer: true }, go({ type: 'requests', personId: rq.from, key: `${rq.kind}ans:${rid}`, custom: (l) => ({ title: tr(l, ok ? 'n.coverOk.title' : 'n.coverNo.title'), body: tr(l, ok ? 'n.coverOk.body' : 'n.coverNo.body', { name: name(rq.kind === 'offer' ? rq.from : who), chore: CH(l, rq.chore) }), url: '#/' }) }));
          }
        } else if (!rq.kind) {   // scambio di turno
          if (rq.status === 'pending' && !rq.notified && reqOn) {
            mark({ notified: true }, go({ type: 'requests', personId: rq.to, key: 'req:' + rid, custom: (l) => ({ title: tr(l, 'n.req.title'), body: tr(l, 'n.req.body', { name: name(rq.from) }), url: '#/requests', actions: answer(l) }) }));
          } else if (rq.status === 'accepted' && !rq.notifiedAnswer && reqOn) {
            mark({ notifiedAnswer: true }, go({ type: 'requests', personId: rq.from, key: 'reqok:' + rid, custom: (l) => ({ title: tr(l, 'n.reqOk.title'), body: tr(l, 'n.reqOk.body', { name: name(rq.to) }), url: '#/' }) }));
          }
        }
      }
      // 3) lista della spesa: solo a chi serve — voci nuove a chi è a casa (non a chi le ha aggiunte), «comprato» solo a chi aveva aggiunto la voce
      if (cfg.needs.on) {
        const list = (arr) => arr.join(', ');
        const fresh = Object.entries(needs).filter(([, nd]) => !nd.done && nd.at && now - new Date(nd.at) <= DAY);
        for (const r of active) {
          const items = fresh.filter(([nid, nd]) => nd.by !== r.id && !sent.has(`need:${nid}:${r.id}`));
          if (!items.length) continue;
          const authors = [...new Set(items.map(([, nd]) => nd.by))];
          const texts = items.map(([, nd]) => nd.text);
          const p = go({ type: 'needs', personId: r.id, key: 'need:' + items.map(([nid]) => nid).join(','), skipAway: true, custom: (l) => ({ title: tr(l, 'n.need.title'),
            body: items.length === 1 ? tr(l, 'n.need.body', { name: nameOf(house, authors[0]), text: texts[0] }) : authors.length === 1 ? tr(l, 'n.need.many.body', { name: nameOf(house, authors[0]), n: items.length, text: list(texts) }) : tr(l, 'n.need.multi.body', { n: items.length, text: list(texts) }), url: '#/needs' }) });
          after.push(async () => { if (p.ok > 0) for (const [nid] of items) await markSent(`need:${nid}:${r.id}`)(); });
        }
        const bought = Object.entries(needs).filter(([nid, nd]) => nd.done && nd.by && nd.doneBy && nd.by !== nd.doneBy && nd.doneAt && now - new Date(nd.doneAt) <= DAY && !sent.has(`bought:${nid}`));
        const byAuthor = new Map();
        for (const [nid, nd] of bought) { const k = nd.by + '|' + nd.doneBy; if (!byAuthor.has(k)) byAuthor.set(k, { by: nd.by, doneBy: nd.doneBy, items: [] }); byAuthor.get(k).items.push([nid, nd]); }
        for (const g of byAuthor.values()) {
          if (!active.some((r) => r.id === g.by)) continue;
          const p = go({ type: 'needs', personId: g.by, key: 'bought:' + g.items.map(([nid]) => nid).join(','), skipAway: true, custom: (l) => ({ title: tr(l, 'n.need.bought.title'), body: g.items.length === 1 ? tr(l, 'n.need.bought.body', { name: nameOf(house, g.doneBy), text: g.items[0][1].text }) : tr(l, 'n.need.bought.many', { name: nameOf(house, g.doneBy), text: list(g.items.map(([, nd]) => nd.text)) }), url: '#/needs' }) });
          after.push(async () => { if (p.ok > 0 || !p.targets) for (const [nid] of g.items) await markSent(`bought:${nid}`)(); });
        }
      }
      await flush();
      // 4) pulizia: voci "sent" e visualizzazioni vecchie
      for (const [k, v] of Object.entries(sentDocs)) if (v.at && now - new Date(v.at) > 5 * DAY) await db.delDoc(hid, 'sent', k);
      const views = await db.coll(hid, 'views');
      for (const [k, v] of Object.entries(views)) if (v.at && now - new Date(v.at) > 60 * DAY) await db.delDoc(hid, 'views', k);
      await db.setHouse(hid, { serverRun: now.toISOString() });
    } catch (e) {
      summary.skipped.push(label + ':error');
      log(`[${label}] errore: ${e && e.message}`);
    }
  }
  return summary;
}
