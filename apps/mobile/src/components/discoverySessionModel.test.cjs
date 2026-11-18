/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  if (full.endsWith('.json')) return JSON.parse(fs.readFileSync(full, 'utf8'));
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(full), name);
    if (!path.extname(target)) target += '.ts';
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
const model = load('./discoverySessionModel.ts');
const now = Date.parse('2027-02-14T12:00:00Z');
const criteria = () => ({ checkin: '2027-02-16', checkout: '2027-02-18', residency: 'ae',
  guests: [{ adults: 2, children: [0, 17] }], currency: 'USD', regionId: 6053839 });
const hotel = hid => ({ hid, id: String(hid), name: `Hotel ${hid}`, address: 'Supplied address', stars: 4,
  imageUrl: 'https://cdn.worldota.net/t/640x480/fixture.jpg', price: { amount: '100.01', currency: 'USD' },
  offers: [{ bookHash: 'h-private', offerContext: 'private-signed-offer' }], email: 'private@example.test', token: 'private-token' });
const add = (selection, value, current = 'scope-a', expected = current, currency = 'USD', at = now) =>
  model.toggleComparisonSelection(selection, value, current, expected, currency, at);

test('comparison keeps only copied presentation fields, never offer/account/payment capabilities', () => {
  const input = hotel(1), result = add(model.emptyComparison(), input);
  assert.equal(result.outcome, 'added'); input.price.amount = '999'; input.name = 'Changed';
  const item = model.comparisonItemsFor(result.selection, 'scope-a', now)[0];
  assert.equal(item.name, 'Hotel 1'); assert.equal(item.price.amount, '100.01');
  for (const secret of ['offers', 'bookHash', 'email', 'token', 'private']) assert.equal(JSON.stringify(item).includes(secret), false);
  assert.equal(Object.isFrozen(item), true); assert.equal(Object.isFrozen(item.price), true);
});
test('three unique comparisons can be toggled off at the limit without altering supplier objects', () => {
  let selection = model.emptyComparison();
  for (const id of [1, 2, 3]) selection = add(selection, hotel(id)).selection;
  assert.equal(add(selection, hotel(4)).outcome, 'limit'); assert.equal(selection.items.length, 3);
  const removed = add(selection, hotel(2)); assert.equal(removed.outcome, 'removed');
  assert.deepEqual(removed.selection.items.map(item => item.hid), [1, 3]);
  assert.equal(add(removed.selection, hotel(4)).selection.items.length, 3);
});
test('old owner/search/language handlers cannot add or remove from a new comparison context', () => {
  const original = add(model.emptyComparison(), hotel(1)).selection;
  assert.equal(add(original, hotel(2), 'scope-b', 'scope-a').outcome, 'context_changed');
  assert.deepEqual(model.comparisonItemsFor(original, 'scope-b', now), []);
  assert.equal(model.removeComparisonSelection(original, 1, 'scope-b', 'scope-a'), original);
  assert.deepEqual(add(original, hotel(2), 'scope-b').selection.items.map(item => item.hid), [2]);
  assert.equal(add(original, hotel(2), '', '').outcome, 'context_changed');
});
test('missing/malformed/mismatched-currency prices remain unknown, while exact zero is preserved', () => {
  for (const price of [null, { amount: '1e3', currency: 'USD' }, { amount: '-1', currency: 'USD' },
    { amount: '50', currency: 'EUR' }, { amount: 'Infinity', currency: 'USD' }]) {
    const selection = add(model.emptyComparison(), { ...hotel(1), price }).selection;
    assert.equal(model.comparisonItemsFor(selection, 'scope-a', now)[0].price, null);
  }
  const selection = add(model.emptyComparison(), { ...hotel(1), price: { amount: '0.00', currency: 'USD' } }).selection;
  assert.deepEqual(model.comparisonItemsFor(selection, 'scope-a', now)[0].price, { amount: '0.00', currency: 'USD' });
  assert.equal(add(model.emptyComparison(), { ...hotel(1), hid: 0 }).outcome, 'unavailable');
});
test('captured comparison prices expire without deleting the shortlist or pretending availability', () => {
  const selection = add(model.emptyComparison(), hotel(1)).selection;
  const before = model.comparisonItemsFor(selection, 'scope-a', now + model.COMPARISON_PRICE_LIFETIME_MS - 1)[0];
  assert.equal(before.price.amount, '100.01'); assert.equal(before.priceExpired, false);
  const after = model.comparisonItemsFor(selection, 'scope-a', now + model.COMPARISON_PRICE_LIFETIME_MS)[0];
  assert.equal(after.price, null); assert.equal(after.priceExpired, true); assert.equal(after.hid, 1);
  assert.equal(model.comparisonItemsFor(selection, 'scope-a', now - 1)[0].price, null);
});
test('recent searches are copied, stripped, bounded and deduplicated using the complete stay criteria', () => {
  let selection = model.emptyRecentSearches(); const input = { ...criteria(), token: 'private-token', email: 'private@example.test' };
  selection = model.addRecentSearch(selection, 'owner-a', input, 'Dubai', now); input.guests[0].children[0] = 15;
  assert.deepEqual(selection.items[0].criteria.guests[0].children, [0, 17]);
  assert.equal(JSON.stringify(selection).includes('private'), false);
  selection = model.addRecentSearch(selection, 'owner-a', criteria(), 'Updated title', now + 1);
  assert.equal(selection.items.length, 1); assert.equal(selection.items[0].name, 'Updated title');
  for (let id = 2; id <= 6; id++) selection = model.addRecentSearch(selection, 'owner-a', { ...criteria(), regionId: id }, `City ${id}`, now + id);
  assert.equal(selection.items.length, 4); assert.equal(selection.items[0].name, 'City 6');
  assert.equal(Object.isFrozen(selection.items[0].criteria.guests), true);
});
test('recent searches hide immediately for another session and omit expired/invalid stays', () => {
  const selection = model.addRecentSearch(model.emptyRecentSearches(), 'owner-a', criteria(), 'Dubai', now);
  assert.deepEqual(model.recentSearchesFor(selection, 'owner-b', now), []);
  assert.equal(model.recentSearchesFor(selection, 'owner-a', now).length, 1);
  assert.deepEqual(model.recentSearchesFor(selection, 'owner-a', Date.parse('2027-02-19T12:00:00Z')), []);
  const rejected = model.addRecentSearch(selection, 'owner-a', { ...criteria(), checkout: '2027-02-15' }, 'Bad stay', now);
  assert.equal(rejected, selection);
  assert.equal(model.addRecentSearch(selection, '', criteria(), 'Dubai', now), selection);
});
