// Backup cifrato di ogni casa in backups/<id>.json (richiede BACKUP_PASSPHRASE). I dati restano illeggibili senza la passphrase.
import admin from 'firebase-admin';
import fs from 'node:fs';
import { encryptBackup } from '../js/backupcrypto.js';

if (!process.env.BACKUP_PASSPHRASE) { console.log('BACKUP_PASSPHRASE non impostata: nessun backup.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const fdb = admin.firestore();
fs.mkdirSync('backups', { recursive: true });
const hs = await fdb.collection('houses').get();
for (const h of hs.docs) {
  const data = { house: h.data() };
  for (const c of ['weeks', 'trips', 'needs', 'requests', 'log']) { const qs = await h.ref.collection(c).get(); data[c] = {}; qs.forEach((d) => { data[c][d.id] = d.data(); }); }
  const env = await encryptBackup({ app: 'casa-pulita', version: 1, exportedAt: new Date().toISOString(), data }, process.env.BACKUP_PASSPHRASE);
  fs.writeFileSync(`backups/${h.id}.json`, JSON.stringify(env));
  console.log('backup', h.id);
}
