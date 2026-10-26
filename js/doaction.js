// Azioni dirette dalla notifica: «Segna fatto», «Accetta», «Rifiuta».
// L'app le riceve come rotta #/do/done/<domenica>/<mansione> · #/do/accept/<id> · #/do/decline/<id> (vedi sw.js e js/app.js).
// Non aggira nulla: la checklist resta obbligatoria (se incompleta si apre la scheda mansione) e i permessi sono quelli di ctx.actions.
import { registerStrings } from './i18n.js';
import { CHORES } from './engine.js';
import { markDoneFlow, openChoreSheet, rowOf } from './choresheet.js';
import { it, en } from './strings/doaction.js';

registerStrings(it, en);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const running = new Set();   // azioni in corso (un render ravvicinato non deve ripeterle)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Aspetta che lo stato sia pronto (apertura a freddo da notifica): casa caricata, persona scelta, piano calcolabile. */
async function waitState(ctx, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (ctx.state && ctx.house && ctx.house.roommates && ctx.me && ctx.calc && ctx.calc.out.rows.length) {
        // in cloud le raccolte arrivano dopo la casa: finché non c'è nessuna settimana si aspetta ancora un poco
        if (!ctx.cloud || Object.keys(ctx.state.weeks || {}).length || Date.now() - t0 > 2500) return true;
      }
    } catch { /* stato non ancora pronto */ }
    if (Date.now() - t0 > ms) return false;
    await sleep(120);
  }
}

/** Cerca una richiesta; in cloud può arrivare qualche istante dopo l'apertura. */
async function findRequest(ctx, id) {
  const until = Date.now() + (ctx.cloud ? 5000 : 0);
  for (;;) {
    const q = (ctx.state.requests || {})[id];
    if (q || Date.now() >= until) return q || null;
    await sleep(150);
  }
}

async function doDone(ctx, sunday, chore) {
  const t = ctx.t; const c = CHORES.indexOf(chore);
  if (!DATE.test(sunday || '') || c < 0) return ctx.toast(t('doact.badLink'));
  const row = rowOf(ctx, sunday);
  if (!row) return ctx.toast(t('doact.noTurn'));
  const assigned = row.assigned[c];
  if (assigned !== ctx.me) return ctx.toast(t('doact.notYours', { chore: t('chore.' + chore), name: assigned ? ctx.name(assigned) : '-' }), 5000);
  const res = row.res[c];
  if (res && res.kind) return ctx.toast(t(res.kind === 'done' || res.kind === 'by' ? 'doact.alreadyDone' : 'doact.alreadyRecorded'));
  if (!ctx.actions.canResult(sunday, chore, 'done')) return ctx.toast(t('err.permission'));
  // checklist incompleta: niente scorciatoie, si apre la scheda della mansione
  if (ctx.actions.pendingChecklist(sunday, chore).length) {
    ctx.toast(t('doact.checklist'), 4000);
    return openChoreSheet(ctx, sunday, chore);
  }
  await markDoneFlow(ctx, sunday, chore);   // toast «Segnato come fatto» con Annulla
}

async function doAnswer(ctx, accept, id) {
  const t = ctx.t; const A = ctx.actions;
  const q = id ? await findRequest(ctx, id) : null;
  if (!q || ['notice', 'nudge'].includes(q.kind)) return ctx.toast(t('doact.reqGone'));
  if (q.status === 'accepted') return ctx.toast(t('doact.reqAccepted'));
  if (q.status !== 'pending') return ctx.toast(t('doact.reqDeclined'));
  const cover = q.kind === 'cover', offer = q.kind === 'offer';
  // stessi destinatari di badges()/awaitingMe(): cover a me o a tutti (tranne chi la chiede), offerte e scambi solo a me
  const mine = cover ? q.from !== ctx.me && (!q.to || q.to === ctx.me) : q.to === ctx.me;
  if (!mine) return ctx.toast(t('doact.reqNotMine'));
  try {
    if (cover || offer) {
      await A.answerCover(id, accept);
      ctx.toast(!accept ? t('flow.req.declined') : cover ? t('flow.req.agreedMe') : t('flow.req.agreedHim', { name: ctx.name(q.from) }));
    } else {
      await A.answerSwap(id, accept);
      ctx.toast(accept ? t('req.accepted') : t('req.declined'));
    }
    ctx.haptic(ctx.prefs.haptics, 10);
  } catch (e) { ctx.toast(e && e.message === 'permission' ? t('err.permission') : t('error')); }
}

/**
 * Esegue un'azione della notifica. `parts` = ['do', 'done'|'accept'|'decline', ...] (o senza il primo 'do').
 * Sostituisce subito l'hash con '#/': un refresh non la ripete. Va chiamata a persona scelta e regole accettate (l'app lo garantisce).
 */
export async function runDo(ctx, parts) {
  const p = [...(parts || [])]; if (p[0] === 'do') p.shift();
  try { sessionStorage.removeItem('cp:do'); } catch { /* ignore */ }
  if (/^#\/do\b/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
  const key = p.join('/'); if (!key || running.has(key)) return;
  running.add(key);
  try {
    if (!(await waitState(ctx))) return ctx.toast(ctx.t('error'));
    const [kind, a, b] = p;
    if (kind === 'done') await doDone(ctx, a, b);
    else if (kind === 'accept' || kind === 'decline') await doAnswer(ctx, kind === 'accept', a);
    else ctx.toast(ctx.t('doact.badLink'));
  } catch (e) { console.error(e); ctx.toast(ctx.t('error')); }
  finally { running.delete(key); }
}
