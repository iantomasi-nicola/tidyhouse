// Cifratura dei backup (AES-GCM, chiave derivata con PBKDF2). Funziona in browser e in Node 20+.
const toB64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64') : btoa(String.fromCharCode(...u8)));
const fromB64 = (s) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
async function key(pass, salt) {
  const enc = new TextEncoder();
  const base = await globalThis.crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBackup(obj, pass) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt), new TextEncoder().encode(JSON.stringify(obj))));
  return { app: 'casa-pulita-enc', v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}
export async function decryptBackup(env, pass) {
  if (!env || env.app !== 'casa-pulita-enc') throw new Error('invalid');
  try {
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, await key(pass, fromB64(env.salt)), fromB64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { throw new Error('wrong-passphrase'); }
}
