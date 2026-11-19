/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { createCurrencyPreference, CURRENCY_PREFERENCE_KEY } = load(path.join(__dirname, 'currencyPreferenceModel.ts'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function pending() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { resolve, promise };
}
function memory(initial = null) {
  const data = new Map(initial ? [[CURRENCY_PREFERENCE_KEY, initial]] : []);
  return {
    data,
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async key => { data.delete(key); },
  };
}
const deviceUS = () => ({ regionCode: 'US', currencyCode: 'USD' });
test('automatic network country takes precedence over device region; only a manual choice is persisted', async () => {
  const storage = memory(), store = createCurrencyPreference(storage, async () => 'AE', deviceUS);
  await store.start();
  assert.deepEqual(store.getSnapshot(), { currency: 'AED', country: 'AE', source: 'network', ready: true, detecting: false, saveFailed: false });
  assert.equal(storage.data.size, 0);
  await store.choose('GBP');
  assert.equal(storage.data.get(CURRENCY_PREFERENCE_KEY), 'GBP');
  let calls = 0;
  const restart = createCurrencyPreference(storage, async () => { calls++; return 'AE'; }, deviceUS);
  await restart.start(); await restart.start();
  assert.equal(restart.getSnapshot().currency, 'GBP');
  assert.equal(calls, 0);
  await restart.useAutomatic();
  assert.equal(calls, 1);
  assert.equal(storage.data.size, 0);
  assert.equal(restart.getSnapshot().currency, 'AED');
});
test('unavailable or unsupported network country uses device settings or the USD default', async () => {
  const fr = createCurrencyPreference(memory('INVALID'), async () => { throw Error('offline'); },
    () => ({ regionCode: 'FR' }));
  await fr.start();
  assert.equal(fr.getSnapshot().currency, 'EUR'); assert.equal(fr.getSnapshot().source, 'device');
  const fallback = createCurrencyPreference(memory(), async () => 'XX', () => ({}));
  await fallback.start(); fallback.choose('BAD-CODE');
  assert.equal(fallback.getSnapshot().currency, 'USD'); assert.equal(fallback.getSnapshot().source, 'default');
});
test('manual choice wins an outstanding restore and an outstanding network result', async () => {
  const reading = pending(), storage = memory();
  const stored = createCurrencyPreference({ ...storage, getItem: () => reading.promise },
    async () => { throw Error('unexpected'); }, deviceUS);
  const hydration = stored.start(); await stored.choose('EUR'); reading.resolve('GBP'); await hydration;
  assert.equal(stored.getSnapshot().currency, 'EUR');
  const network = pending();
  let controller;
  const detected = createCurrencyPreference(memory(), signal => { controller = signal; return network.promise; }, deviceUS);
  const activity = detected.start(); await tick();
  await detected.choose('USD'); assert.equal(controller.aborted, true);
  network.resolve('AE'); await activity;
  assert.equal(detected.getSnapshot().source, 'manual');
  assert.equal(detected.getSnapshot().currency, 'USD');
});
test('simultaneous screens share a detection and recheck the country after returning later', async () => {
  const first = pending(); let calls = 0, time = 0;
  const store = createCurrencyPreference(memory(), () => ++calls === 1 ? first.promise : Promise.resolve('GB'), deviceUS, () => time);
  const a = store.start(), b = store.start(); await tick(); assert.equal(calls, 1);
  first.resolve('AE'); await Promise.all([a,b]); await store.start();
  assert.equal(calls, 1);
  time += 16 * 60000; await store.start();
  assert.equal(store.getSnapshot().currency, 'GBP'); assert.equal(calls, 2);
});
test('rapid choices serialize persistence, including a reset to automatic, and report a storage failure', async () => {
  const storage = memory(), first = pending(); let writes = 0;
  const store = createCurrencyPreference({ ...storage, setItem: async (key, value) => {
    if (++writes === 1) await first.promise;
    await storage.setItem(key, value);
  } }, async () => 'FR', deviceUS);
  const a = store.choose('AED'), b = store.choose('GBP'), end = store.useAutomatic();
  first.resolve(); await Promise.all([a,b,end]);
  assert.equal(storage.data.size, 0); assert.equal(store.getSnapshot().currency, 'EUR');
  const failure = createCurrencyPreference({ ...storage, setItem: async () => { throw Error('disk'); } }, async () => null, deviceUS);
  await failure.choose('AED'); assert.equal(failure.getSnapshot().saveFailed, true);
  assert.equal(failure.getSnapshot().currency, 'AED');
});
