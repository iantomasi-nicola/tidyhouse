// Lancia TUTTI i test end-to-end (tests/e2e/*.e2e.mjs) UNO ALLA VOLTA. Mai in parallelo: in parallelo danno falsi errori
// (orologio finto, risorse del browser). Uso:
//   npm run e2e                                  tutti, tranne cloud-emulator (richiede l'emulatore Firestore)
//   npm run e2e -- --only smoke,foreground       solo questi (nome senza ".e2e.mjs")
//   npm run e2e -- --skip settings,home          tutti tranne questi
//   npm run e2e -- --only cloud-emulator         il test con l'emulatore (avviarlo prima: vedi HANDOFF.md)
//   npm run e2e -- --timeout 600                 tempo massimo per file in secondi (predefinito 400)
//   npm run e2e -- --list                        mostra i test e esce
// Esce con codice 1 se un test fallisce, va in timeout o se un nome indicato non esiste.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'tests', 'e2e');
const DEFAULT_SKIP = ['cloud-emulator'];   // richiede l'emulatore di Firestore su 127.0.0.1:8080
const DEFAULT_TIMEOUT_S = 400;

function parseArgs(argv) {
  const o = { only: null, skip: null, timeout: DEFAULT_TIMEOUT_S, list: false };
  const list = (v) => String(v || '').split(',').map((s) => s.trim().replace(/\.e2e\.mjs$/, '')).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; let v;
    const val = () => { if (a.includes('=')) return a.slice(a.indexOf('=') + 1); v = argv[++i]; if (v === undefined) throw new Error(`manca il valore di ${a}`); return v; };
    if (a === '--only' || a.startsWith('--only=')) o.only = list(val());
    else if (a === '--skip' || a.startsWith('--skip=')) o.skip = list(val());
    else if (a === '--timeout' || a.startsWith('--timeout=')) { o.timeout = Number(val()); if (!(o.timeout > 0)) throw new Error('--timeout vuole un numero di secondi > 0'); }
    else if (a === '--list') o.list = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`opzione sconosciuta: ${a}`);
  }
  return o;
}

const fmt = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`);

/** Esegue un file e2e; risolve con { ok, code, timedOut, ms, tail }. Alla scadenza termina tutto il gruppo di processi (anche Chromium). */
function runOne(name, timeoutS) {
  return new Promise((resolve) => {
    const t0 = Date.now(); const tail = []; let timedOut = false;
    const child = spawn(process.execPath, [path.join(DIR, `${name}.e2e.mjs`)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: process.env });
    const feed = (stream, out) => stream.on('data', (b) => { out.write(b); for (const l of b.toString().split('\n')) if (l.trim()) { tail.push(l); if (tail.length > 25) tail.shift(); } });
    feed(child.stdout, process.stdout); feed(child.stderr, process.stderr);
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* già finito */ } } };
    const timer = setTimeout(() => { timedOut = true; console.log(`\n  [timeout] ${name}: oltre ${timeoutS} s, lo fermo`); kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, timeoutS * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, timedOut: false, ms: Date.now() - t0, tail: [String(e)] }); });
    child.on('close', (code) => { clearTimeout(timer); kill('SIGKILL'); resolve({ ok: code === 0 && !timedOut, code, timedOut, ms: Date.now() - t0, tail }); });
  });
}

async function main() {
  let opt;
  try { opt = parseArgs(process.argv.slice(2)); } catch (e) { console.error('Errore:', e.message); process.exit(2); }
  if (opt.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); return; }
  const all = fs.readdirSync(DIR).filter((f) => f.endsWith('.e2e.mjs')).map((f) => f.replace(/\.e2e\.mjs$/, '')).sort();
  if (opt.list) { for (const n of all) console.log(n + (DEFAULT_SKIP.includes(n) ? '   (saltato di default: serve l\'emulatore Firestore)' : '')); return; }

  const unknown = [...(opt.only || []), ...(opt.skip || [])].filter((n) => !all.includes(n));
  if (unknown.length) { console.error(`Test sconosciuti: ${unknown.join(', ')}\nDisponibili: ${all.join(', ')}`); process.exit(2); }

  const skip = new Set(opt.skip || (opt.only ? [] : DEFAULT_SKIP));
  const todo = (opt.only || all).filter((n) => !skip.has(n));
  const skipped = all.filter((n) => !todo.includes(n) && (opt.only ? false : skip.has(n)));
  for (const n of skipped) console.log(`salto ${n}${DEFAULT_SKIP.includes(n) ? ': richiede l\'emulatore Firestore (--only ' + n + ' per provarlo)' : ''}`);
  if (!todo.length) { console.error('Nessun test da eseguire.'); process.exit(2); }

  const T0 = Date.now(); const res = [];
  for (const [i, n] of todo.entries()) {
    console.log(`\n=== [${i + 1}/${todo.length}] ${n} ===`);
    const r = await runOne(n, opt.timeout); res.push({ n, ...r });
    console.log(`--- ${n}: ${r.ok ? 'OK' : r.timedOut ? 'TIMEOUT' : 'FALLITO (codice ' + r.code + ')'} in ${fmt(r.ms)}`);
  }

  const bad = res.filter((r) => !r.ok);
  console.log('\n================ Riepilogo e2e ================');
  for (const r of res) console.log(`${r.ok ? 'ok     ' : r.timedOut ? 'TIMEOUT' : 'FALLITO'}  ${r.n.padEnd(20)} ${fmt(r.ms)}`);
  for (const n of skipped) console.log(`salto    ${n}`);
  console.log(`\n${res.length - bad.length} ok, ${bad.length} falliti, ${skipped.length} saltati — tempo totale ${fmt(Date.now() - T0)}`);
  if (bad.length) {
    console.log('\nUltime righe dei test falliti:');
    for (const r of bad) { console.log(`\n# ${r.n}`); console.log(r.tail.map((l) => '  ' + l).join('\n')); }
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
