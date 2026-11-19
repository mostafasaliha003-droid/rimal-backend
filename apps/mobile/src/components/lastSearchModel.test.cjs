/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const model = load(path.resolve(__dirname, './lastSearchModel.ts'));

const now = Date.parse('2026-11-19T10:00:00Z');
const family = () => ({ checkin: '2026-12-14', checkout: '2026-12-17', residency: 'ae', currency: 'USD', language: 'ar',
  guests: [{ adults: 1, children: [8] }, { adults: 1, children: [5] }], regionId: 6053839 });
function memory(initial = null) {
  const values = new Map(initial === null ? [] : [[model.LAST_SEARCH_KEY, initial]]);
  return { values, getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } };
}

test('round-trips destination and occupancy for the same environment only', () => {
  const encoded = model.encodeLastSearch(family(), 'دبي', 'staging', now);
  const record = model.decodeLastSearch(encoded, 'staging', now);
  assert.equal(record.name, 'دبي');
  assert.deepEqual(record.criteria.guests, [{ adults: 1, children: [8] }, { adults: 1, children: [5] }]);
  assert.equal(record.criteria.regionId, 6053839);
  assert.equal(model.decodeLastSearch(encoded, 'production', now), null);
});

test('keeps no language, display currency or extra fields from the original search', () => {
  const source = { ...family(), currency: 'AED', bookHash: 'h-secret', email: 'private@example.test' };
  const stored = JSON.parse(model.encodeLastSearch(source, 'Dubai', 'staging', now));
  assert.deepEqual(Object.keys(stored.criteria).sort(), ['checkin', 'checkout', 'currency', 'guests', 'regionId', 'residency']);
  assert.equal(stored.criteria.currency, 'USD');
  assert.ok(!JSON.stringify(stored).includes('secret') && !JSON.stringify(stored).includes('example.test'));
});

test('rejects multi-hotel saved searches, invalid occupancy and unsafe labels', () => {
  assert.equal(model.encodeLastSearch({ ...family(), regionId: undefined, hids: [1, 2] }, 'Saved', 'staging', now), null);
  assert.equal(model.encodeLastSearch({ ...family(), guests: [{ adults: 0, children: [] }] }, 'Dubai', 'staging', now), null);
  assert.equal(model.encodeLastSearch({ ...family(), guests: [{ adults: 1, children: [18] }] }, 'Dubai', 'staging', now), null);
  assert.equal(model.encodeLastSearch(family(), 'Dubai‮', 'staging', now), null);
  assert.equal(model.encodeLastSearch(family(), '', 'staging', now), null);
  assert.ok(model.encodeLastSearch({ ...family(), regionId: undefined, hids: [9100102] }, 'One hotel', 'staging', now));
});

test('expires after the retention window and ignores malformed storage', () => {
  const encoded = model.encodeLastSearch(family(), 'Dubai', 'staging', now);
  assert.ok(model.decodeLastSearch(encoded, 'staging', now + model.LAST_SEARCH_MAX_AGE_MS));
  assert.equal(model.decodeLastSearch(encoded, 'staging', now + model.LAST_SEARCH_MAX_AGE_MS + 1), null);
  for (const raw of [null, '', '{', '[]', JSON.stringify({ v: 2 }), 'x'.repeat(5000)]) assert.equal(model.decodeLastSearch(raw, 'staging', now), null);
});

test('past stay dates stay visible so the traveler can choose new dates', () => {
  const record = model.decodeLastSearch(model.encodeLastSearch(family(), 'Dubai', 'staging', now), 'staging', now);
  assert.equal(model.resumeState(record, '2026-11-19'), 'ready');
  assert.equal(model.resumeState(record, '2026-12-14'), 'ready');
  assert.equal(model.resumeState(record, '2026-12-15'), 'datesPassed');
  const later = model.decodeLastSearch(model.encodeLastSearch(family(), 'Dubai', 'staging', now), 'staging', Date.parse('2027-01-10T00:00:00Z'));
  assert.ok(later, 'a past stay is still decoded within the retention window');
});

test('resuming builds fresh criteria with the current currency and language', () => {
  const record = model.decodeLastSearch(model.encodeLastSearch(family(), 'Dubai', 'staging', now), 'staging', now);
  const criteria = model.resumeCriteria(record, 'USD', 'en');
  assert.equal(criteria.language, 'en');
  criteria.guests[0].children.push(3);
  assert.deepEqual(record.criteria.guests[0].children, [8], 'the stored record is not mutated');
});

test('store loads once, saves in order and clears on demand', async () => {
  const storage = memory(model.encodeLastSearch(family(), 'Dubai', 'staging', Date.now()));
  const store = model.createLastSearchStore(storage, 'staging');
  let notified = 0; store.subscribe(() => { notified++; });
  await store.load();
  assert.equal(store.getSnapshot().record.name, 'Dubai');
  await store.save({ ...family(), regionId: undefined, hids: [9100102] }, 'Marina hotel');
  assert.equal(store.getSnapshot().record.name, 'Marina hotel');
  assert.equal(JSON.parse(storage.values.get(model.LAST_SEARCH_KEY)).name, 'Marina hotel');
  await store.clear();
  assert.equal(store.getSnapshot().record, null);
  assert.equal(storage.values.has(model.LAST_SEARCH_KEY), false);
  assert.ok(notified >= 3);
});

test('a save made while storage is still loading is not overwritten by the older stored value', async () => {
  let release;
  const storage = memory(model.encodeLastSearch(family(), 'Old', 'staging', Date.now()));
  const slow = { ...storage, getItem: key => new Promise(resolve => { release = () => resolve(storage.values.get(key)); }) };
  const store = model.createLastSearchStore(slow, 'staging');
  const loading = store.load();
  await store.save(family(), 'New');
  release(); await loading;
  assert.equal(store.getSnapshot().record.name, 'New');
});
