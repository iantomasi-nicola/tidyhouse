// Esegue il controllo notifiche con Firebase Admin e web-push. Lanciato da GitHub Actions ogni ora.
// Variabili: FIREBASE_SERVICE_ACCOUNT (JSON), VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY (opzionale), VAPID_SUBJECT (mailto:...)
import admin from 'firebase-admin';
import webpush from 'web-push';
import { runNotify } from './notify-core.mjs';

const need = (k) => { if (!process.env[k]) { console.error(`Manca il secret ${k}`); process.exit(1); } return process.env[k]; };
const sa = JSON.parse(need('FIREBASE_SERVICE_ACCOUNT'));
const priv = need('VAPID_PRIVATE_KEY');
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fdb = admin.firestore();

// la chiave pubblica viene letta dalla casa; per web-push serve la coppia: la derivo dalla chiave privata
import crypto from 'node:crypto';
function publicFromPrivate(privB64u) {
  const d = Buffer.from(privB64u.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(d);
  return ecdh.getPublicKey().toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const pub = process.env.VAPID_PUBLIC_KEY || publicFromPrivate(priv);
webpush.setVapidDetails(subject, pub, priv);

const toObj = (qs) => { const o = {}; qs.forEach((d) => { o[d.id] = d.data(); }); return o; };
const db = {
  async listHouses() { const qs = await fdb.collection('houses').get(); return qs.docs.map((d) => ({ id: d.id, house: d.data() })); },
  async coll(hid, name) { return toObj(await fdb.collection('houses').doc(hid).collection(name).get()); },
  async setDoc(hid, coll, id, data, merge = true) {
    const clean = JSON.parse(JSON.stringify(data, (k, v) => (v === null ? '__NULL__' : v)));
    const del = (o) => { for (const k of Object.keys(o)) { if (o[k] === '__NULL__') o[k] = admin.firestore.FieldValue.delete(); else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) del(o[k]); } return o; };
    await fdb.collection('houses').doc(hid).collection(coll).doc(id).set(del(clean), { merge });
  },
  async delDoc(hid, coll, id) { await fdb.collection('houses').doc(hid).collection(coll).doc(id).delete(); },
  async setHouse(hid, patch) { await fdb.collection('houses').doc(hid).set(patch, { merge: true }); },
};
const send = (sub, payload) => webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });

const summary = await runNotify({ db, send, now: new Date(), vapidPublic: pub, log: (m) => console.log(m) });
console.log('Riepilogo:', JSON.stringify(summary));
