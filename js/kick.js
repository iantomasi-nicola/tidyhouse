// Avvio immediato del controllo notifiche sul server: invece di aspettare il turno orario di GitHub Actions,
// quando succede qualcosa (voce della spesa, richiesta, sollecito, prova) l'app chiede a GitHub di lanciare subito il workflow.
// Serve un token GitHub «fine-grained» limitato a questo repository con il solo permesso Actions: lettura e scrittura (salvato nella casa).
const WF = 'notify.yml';
const DELAY = 6000;   // raggruppa più azioni ravvicinate in un solo avvio (il server le tratta tutte insieme)
let timer = 0;

/** Repository da avvisare: impostato nella casa, altrimenti dedotto dall'indirizzo di GitHub Pages (utente.github.io/repo). */
export function repoOf(house, loc = (typeof location !== 'undefined' ? location : null)) {
  const k = (house && house.kick) || {};
  if (/^[\w.-]+\/[\w.-]+$/.test(k.repo || '')) return k.repo;
  if (loc && /\.github\.io$/i.test(loc.hostname || '')) { const repo = (loc.pathname || '').split('/').filter(Boolean)[0]; if (repo) return `${loc.hostname.split('.')[0]}/${repo}`; }
  return null;
}
export const hasKick = (house) => !!(house && house.kick && house.kick.token && repoOf(house));

/** Lancia subito il workflow. Ritorna { ok, status }. Non lancia mai. */
export async function kickNow(house, { fetchFn = (typeof fetch !== 'undefined' ? fetch : null), ref = 'main' } = {}) {
  const repo = repoOf(house); const token = house && house.kick && house.kick.token;
  if (!repo || !token || !fetchFn) return { ok: false, status: 0, reason: 'config' };
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/actions/workflows/${WF}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref }),
    });
    return { ok: res.status === 204, status: res.status };
  } catch { return { ok: false, status: 0, reason: 'network' }; }
}

/** Da chiamare dopo una scrittura che genera una notifica. Silenziosa; più chiamate vicine diventano un solo avvio. */
export function scheduleKick(getHouse, opts) {
  if (typeof setTimeout === 'undefined') return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = 0; try { const h = getHouse(); if (hasKick(h)) kickNow(h, opts); } catch { /* ignore */ } }, DELAY);
}
