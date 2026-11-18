/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { createSavedHotelsStore, readSavedHotelIds, savedSearchSetup, SAVED_HOTELS_KEY } = load(path.join(__dirname, 'savedHotelsModel.ts'));
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function memory(initial = null) {
  let raw = initial;
  const reads = [], writes = [];
  return { reads, writes, raw: () => raw,
    getItem: async key => { reads.push(key); return raw; },
    setItem: async (key, value) => { writes.push({ key, value }); raw = value; },
  };
}

test('legacy storage keeps numeric IDs, first unique occurrence, first-100 load and last-100 addition caps', async () => {
  const legacy = JSON.stringify([1, '2', 2, 1, 0, -1, null, true, 1.5, Number.MAX_SAFE_INTEGER + 1,
    ...Array.from({ length: 105 }, (_, index) => index + 3)]);
  const ids = readSavedHotelIds(legacy);
  assert.deepEqual(ids, Array.from({ length: 100 }, (_, index) => index + 1));
  const backend = memory(legacy), store = createSavedHotelsStore(backend);
  await store.load();
  assert.equal(backend.writes.length, 0, 'Reading legacy overflow must not rewrite it automatically');
  assert.equal(backend.raw(), legacy);
  store.toggle(999); await settle();
  assert.deepEqual(store.getSnapshot().saved, [...ids.slice(1), 999]);
  assert.deepEqual(JSON.parse(backend.raw()), [...ids.slice(1), 999]);
  assert.equal(backend.writes[0].key, 'remal.savedHotelIds.v1');
  for (const raw of [null, '', '[]']) assert.deepEqual(readSavedHotelIds(raw), []);
});

test('failed or corrupt reads never enable an empty overwrite; explicit retry safely reloads prior IDs', async () => {
  for (const first of [new Error('storage unavailable'), '{invalid', '{}', 'null', '42']) {
    let attempts = 0;
    const backend = memory('[8,9]');
    const store = createSavedHotelsStore({ ...backend, getItem: async () => {
      attempts += 1;
      if (attempts > 1) return '[8,9]';
      if (first instanceof Error) throw first;
      return first;
    } });
    assert.equal(await store.load(), false);
    assert.deepEqual(store.getSnapshot(), { saved: [], ready: false, loading: false, pending: false, errorKind: 'load' });
    store.toggle(3); store.remove(8); await settle();
    assert.equal(backend.writes.length, 0); assert.equal(backend.raw(), '[8,9]');
    assert.equal(await store.retry(), true);
    assert.deepEqual(store.getSnapshot().saved, [8, 9]);
    assert.equal(store.getSnapshot().ready, true); assert.equal(store.getSnapshot().errorKind, null);
    assert.equal(backend.writes.length, 0);
  }
});

test('overlapping initial loads share one read and cannot accept toggles before that read completes', async () => {
  const read = deferred(); let calls = 0, writes = 0;
  const store = createSavedHotelsStore({ getItem: () => { calls += 1; return read.promise; }, setItem: async () => { writes += 1; } });
  const first = store.load(), second = store.retry();
  assert.equal(first, second); assert.equal(store.getSnapshot().loading, true);
  store.toggle(7); await settle(); assert.equal(calls, 1); assert.equal(writes, 0);
  read.resolve('[4,5]'); await first;
  assert.deepEqual(store.getSnapshot().saved, [4, 5]); assert.equal(store.getSnapshot().pending, false);
});

test('rapid synchronous toggles use the latest desired IDs and coalesce before writing', async () => {
  const backend = memory('[1]'), store = createSavedHotelsStore(backend); await store.load();
  store.toggle(2); store.toggle(3); store.toggle(2);
  assert.deepEqual(store.getSnapshot().saved, [1, 3]); assert.equal(store.getSnapshot().pending, true);
  await settle();
  assert.deepEqual(backend.writes.map(row => JSON.parse(row.value)), [[1, 3]]);
  assert.equal(store.getSnapshot().pending, false); assert.equal(store.getSnapshot().errorKind, null);
});

test('a pending write completes before one latest coalesced follow-up, never out of order', async () => {
  const first = deferred(), writes = []; let concurrent = 0, highestConcurrent = 0;
  const store = createSavedHotelsStore({ getItem: async () => '[1]', setItem: async (key, value) => {
    concurrent += 1; highestConcurrent = Math.max(highestConcurrent, concurrent); writes.push({ key, value });
    if (writes.length === 1) await first.promise;
    concurrent -= 1;
  } });
  await store.load(); store.toggle(2); await settle();
  store.toggle(3); store.remove(1); store.toggle(4); store.remove(4);
  assert.deepEqual(store.getSnapshot().saved, [2, 3]); assert.equal(writes.length, 1);
  first.resolve(); await settle();
  assert.equal(highestConcurrent, 1);
  assert.deepEqual(writes.map(row => JSON.parse(row.value)), [[1, 2], [2, 3]]);
  assert.equal(store.getSnapshot().pending, false);
});

test('returning to acknowledged IDs during an in-flight write stays pending until storage is restored', async () => {
  const first = deferred(), second = deferred(), writes = [];
  const store = createSavedHotelsStore({ getItem: async () => '[1]', setItem: (key, value) => {
    writes.push({ key, value }); return writes.length === 1 ? first.promise : second.promise;
  } });
  await store.load(); store.toggle(2); await settle(); store.toggle(2);
  assert.deepEqual(store.getSnapshot().saved, [1]); assert.equal(store.getSnapshot().pending, true);
  first.resolve(); await settle(); assert.equal(store.getSnapshot().pending, true);
  assert.deepEqual(writes.map(row => JSON.parse(row.value)), [[1, 2], [1]]);
  second.resolve(); await settle(); assert.equal(store.getSnapshot().pending, false);
});

test('write errors retain desired IDs and truthful pending state, pause automatic writes and retry only the latest IDs', async () => {
  let failing = true, raw = '[1]'; const writes = [];
  const store = createSavedHotelsStore({ getItem: async () => raw, setItem: async (key, value) => {
    writes.push({ key, value }); if (failing) throw new Error('write unavailable'); raw = value;
  } });
  await store.load(); store.toggle(2); await settle();
  assert.deepEqual(store.getSnapshot().saved, [1, 2]); assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().pending, true); assert.equal(store.getSnapshot().errorKind, 'save');
  store.remove(1); store.toggle(3); await settle();
  assert.deepEqual(store.getSnapshot().saved, [2, 3]); assert.equal(writes.length, 1); assert.equal(raw, '[1]');
  failing = false;
  const first = store.retry(), second = store.retry(); assert.equal(first, second);
  assert.equal(await first, true); await settle();
  assert.equal(raw, '[2,3]'); assert.equal(store.getSnapshot().errorKind, null); assert.equal(store.getSnapshot().pending, false);
  assert.equal(writes.length, 2);
});

test('an ambiguous rejected write cannot be mistaken for saved when the desired IDs return to the old acknowledgement', async () => {
  let raw = '[1]', fail = true; const writes = [];
  const store = createSavedHotelsStore({ getItem: async () => raw, setItem: async (key, value) => {
    raw = value; writes.push(value); if (fail) throw new Error('reply lost after write');
  } });
  await store.load(); store.toggle(2); await settle(); store.remove(2);
  assert.deepEqual(store.getSnapshot().saved, [1]); assert.equal(raw, '[1,2]');
  assert.equal(store.getSnapshot().pending, true); assert.equal(store.getSnapshot().errorKind, 'save');
  fail = false; await store.retry(); await settle();
  assert.equal(raw, '[1]'); assert.deepEqual(writes, ['[1,2]', '[1]']); assert.equal(store.getSnapshot().pending, false);
});

test('idempotent removal, invalid IDs and immutable snapshots cannot add or corrupt a saved ID', async () => {
  const backend = memory('[1,2]'), store = createSavedHotelsStore(backend); await store.load();
  const snapshot = store.getSnapshot();
  assert.throws(() => snapshot.saved.push(99), TypeError);
  store.remove(2); store.remove(2); store.remove(999);
  for (const id of [0, -1, NaN, Infinity, 1.5, '2', true, Number.MAX_SAFE_INTEGER + 1]) store.toggle(id);
  await settle();
  assert.deepEqual(store.getSnapshot().saved, [1]); assert.equal(backend.writes.length, 1);
  assert.deepEqual(backend.writes.map(row => row.key), [SAVED_HOTELS_KEY]);
  assert.equal(JSON.parse(backend.writes[0].value).every(id => typeof id === 'number'), true);
});

test('undo restores once at the original bounded index even while a removal write is in flight', async () => {
  const first = deferred(), writes = [];
  const store = createSavedHotelsStore({ getItem: async () => '[1,2,3]', setItem: async (key, value) => {
    writes.push({ key, value }); if (writes.length === 1) await first.promise;
  } });
  store.restore(8, 0); assert.deepEqual(store.getSnapshot().saved, []);
  await store.load(); store.remove(2); await settle(); store.restore(2, 1); store.restore(2, 1);
  assert.deepEqual(store.getSnapshot().saved, [1, 2, 3]); assert.equal(store.getSnapshot().pending, true);
  first.resolve(); await settle();
  assert.deepEqual(writes.map(row => JSON.parse(row.value)), [[1, 3], [1, 2, 3]]);
  assert.equal(store.getSnapshot().pending, false);
  store.restore(4, -10); store.restore(5, 999);
  for (const index of [NaN, Infinity, 1.5, '1']) store.restore(99, index);
  await settle(); assert.deepEqual(store.getSnapshot().saved, [4, 1, 2, 3, 5]);
});

test('undo at the cap never evicts another ID or overwrites intervening additions', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => index + 1);
  const backend = memory(JSON.stringify(ids)), store = createSavedHotelsStore(backend); await store.load();
  store.remove(50); store.toggle(999); store.restore(50, 49); await settle();
  assert.deepEqual(store.getSnapshot().saved, [...ids.filter(id => id !== 50), 999]);
  assert.equal(store.getSnapshot().saved.length, 100);
  assert.equal(store.getSnapshot().saved.includes(50), false);
  assert.deepEqual(JSON.parse(backend.raw()), store.getSnapshot().saved);
});

const criteria = patch => ({ checkin: '2027-02-16', checkout: '2027-02-18', residency: 'ae', currency: 'USD',
  guests: [{ adults: 2, children: [4] }], ...patch });
test('saved travel setup replaces travel facts but preserves a named Explore destination without aliasing', () => {
  const existing = criteria({ regionId: 9650, hids: [10, 11] });
  const input = criteria({ checkin: '2027-03-01', checkout: '2027-03-04', residency: 'gb', currency: 'EUR', language: 'ar',
    guests: [{ adults: 1, children: [7, 9] }], hids: [99], regionId: 123 });
  const result = savedSearchSetup(input, existing, 'Dubai');
  assert.deepEqual(result, { destinationName: 'Dubai', criteria: { ...input, regionId: 9650, hids: [10, 11] } });
  input.guests[0].children.push(12); existing.hids.push(20);
  assert.deepEqual(result.criteria.guests[0].children, [7, 9]); assert.deepEqual(result.criteria.hids, [10, 11]);
  assert.deepEqual(existing.guests[0].children, [4]);
});

test('without a named Explore destination, saved travel setup uses only the supplied saved IDs and an empty name', () => {
  for (const [existing, name] of [[null, ''], [criteria({ regionId: 9650 }), ''], [criteria({ hids: [1] }), '  ']]) {
    const input = criteria({ hids: [8, 9], regionId: 123 });
    const result = savedSearchSetup(input, existing, name);
    assert.equal(result.destinationName, ''); assert.equal(result.criteria.regionId, undefined);
    assert.deepEqual(result.criteria.hids, [8, 9]);
    input.hids.push(10); assert.deepEqual(result.criteria.hids, [8, 9]);
  }
});
