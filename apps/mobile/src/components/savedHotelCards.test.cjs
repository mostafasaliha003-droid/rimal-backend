/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { savedHotelCard, loadSavedHotelCards, returnedSavedHotels } = load(path.join(__dirname, 'savedHotelCards.ts'));

test('metadata is bound to a requested open hotel and exposes presentation fields only', () => {
  const raw = { hid: '43', name: ' Hotel One ', address: 'City', image: 'https://cdn.worldota.net/t/640x480/example.jpg',
    closed: false, rates: [{ amount: 99 }], phone: 'private', owner: 'private', star_rating: '4' };
  assert.deepEqual(savedHotelCard(43, raw), { hid: 43, name: 'Hotel One', address:'City', imageUrl:raw.image, stars:4 });
  for (const incompatible of [{}, { hid: 44 }, { ...raw, is_closed: true }, { ...raw, deleted:true }]) {
    assert.throws(() => savedHotelCard(43, incompatible), /invalid_response/);
  }
  assert.deepEqual(savedHotelCard(43, {hid:43, name:'bad\u202ename', image:'https://example.test/foreign', star_rating:8}),
    {hid:43, name:''});
});

test('saved prices discard foreign and duplicate IDs in the supplier order', () => {
  const a = { hid:1 }, b = { hid:2 };
  assert.deepEqual(returnedSavedHotels([1,2,3], [b,{hid:9},a,{hid:2}]), [b,a]);
  assert.deepEqual(returnedSavedHotels([], [a]), []);
});

test('metadata limits parallel requests, preserves missing rows and skips unsupported legacy IDs', async () => {
  let concurrent = 0, maximum = 0;
  const ids = [1,2,3,4,5,99999999999,6], called = [], result = new Map();
  await loadSavedHotelCards(ids, async id => {
    called.push(id);
    maximum = Math.max(maximum, ++concurrent);
    await new Promise(resolve => setImmediate(resolve));
    concurrent--;
    if (id === 2) throw Object.assign(new Error(), {status:404});
    return {hid:id === 4 ? 44 : id, name:'A hotel'};
  }, () => true, (id, value) => result.set(id, value));
  assert.equal(maximum, 3);
  assert.equal(result.size, ids.length);
  assert.deepEqual(called, [1,2,3,4,5,6]);
  for (const id of [2,4,99999999999]) assert.equal(result.get(id), null);
  assert.equal(result.get(6).hid, 6);
});

test('an expired owner never publishes a late result or starts more reads', async () => {
  let active = true, released;
  const gate = new Promise(resolve => { released = resolve; });
  const ids = [1,2,3,4], called = [], results = [];
  const operation = loadSavedHotelCards(ids, async id => { called.push(id); await gate; return {hid:id,name:'Late'}; },
    () => active, (_id, card) => results.push(card));
  active = false; released(); await operation;
  assert.deepEqual(called, [1,2,3]);
  assert.deepEqual(results, []);
});

test('auth and rate limits stop queued detail requests without dropping saved IDs', async () => {
  for (const status of [401,403,429]) {
    const requested = [], rows = [];
    await loadSavedHotelCards([1,2,3,4,5], async id => {
      requested.push(id); throw Object.assign(new Error(),{status});
    }, () => true, (id, card) => rows.push([id,card]));
    assert.deepEqual(requested, [1,2,3]);
    assert.deepEqual(rows, [[1,null],[2,null],[3,null],[4,null],[5,null]]);
  }
});
