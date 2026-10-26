// Lo stato "notifiche attive" non deve dipendere dal documento cloud (che arriva dopo l'apertura).
import test from 'node:test';
import assert from 'node:assert/strict';

function setup({ permission = 'granted', flag = false, sub = true, ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' } = {}) {
  const store = new Map(flag ? [['cp:pushsub', '1']] : []);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.Notification = { permission };
  globalThis.window = { PushManager: {}, Notification: globalThis.Notification };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ua, maxTouchPoints: 5, serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (sub ? { endpoint: 'e' } : null) } }) } } });
  globalThis.matchMedia = () => ({ matches: true });
  return store;
}
const ctx = (members = {}) => ({ mode: 'cloud', house: { vapidPublic: 'K' }, deviceId: 'd1', state: { members } });

test('notifiche già attive: "on" subito all\'apertura anche se il cloud non ha ancora caricato il dispositivo', async () => {
  const push = await import('../js/push.js');
  setup({ flag: true });
  assert.equal(push.status(ctx({})).state, 'on', 'ricordo locale + permesso → attive');
  setup({ flag: false });
  assert.equal(push.status(ctx({})).state, 'off', 'mai attivate: da chiedere');
  assert.equal(push.status(ctx({ d1: { push: { endpoint: 'x' } } })).state, 'on', 'oppure già registrate sul cloud');
});
test('probe: controlla il browser e aggiorna il ricordo (sottoscrizione persa o permesso tolto)', async () => {
  const push = await import('../js/push.js');
  let st = setup({ flag: false, sub: true }); assert.equal(await push.probe(), true); assert.equal(st.get('cp:pushsub'), '1');
  assert.equal(push.status(ctx({})).state, 'on');
  st = setup({ flag: true, sub: false }); assert.equal(await push.probe(), false); assert.equal(st.has('cp:pushsub'), false); assert.equal(push.status(ctx({})).state, 'off');
  st = setup({ flag: true, permission: 'default' }); assert.equal(await push.probe(), false); assert.equal(push.status(ctx({})).state, 'off', 'permesso tolto → di nuovo da chiedere');
  setup({ permission: 'denied', flag: true }); assert.equal(push.status(ctx({})).state, 'denied');
});
