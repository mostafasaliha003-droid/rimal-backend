/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  if (full.endsWith('.json')) return JSON.parse(fs.readFileSync(full, 'utf8'));
  const module = { exports: {} }; cache.set(full, module);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const localRequire = name => {
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(full), name);
    if (!path.extname(target)) target += '.ts'; return load(target);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}
const { changedOfferSections } = load('./offerChangeSummary.ts');
const base = () => ({ id: 'rate', name: 'Suite', roomIdentity: 'exact-room', bookHash: 'h-private', offerContext: 'private', images: [],
  price: { amount: '100.00', currency: 'USD' }, meal: 'nomeal',
  taxes: [{ name: 'city_tax', amount: '0.00', currency_code: 'AED', included_by_supplier: false }],
  cancellation: { freeUntil: '2027-02-10T12:00:00.000Z', policies: [
    { startAt: null, endAt: '2027-02-10T12:00:00.000Z', amount: '0', currency: 'USD' },
    { startAt: '2027-02-10T12:00:00.000Z', endAt: null, amount: '100', currency: 'USD' },
  ] } });
test('equivalent decimal formatting and reordered policy rows do not invent changed terms', () => {
  const before = base(), after = base(); after.price.amount = '0100.0'; after.taxes[0].amount = '0';
  after.cancellation.policies.reverse(); after.bookHash = 'p-new-capability'; after.offerContext = 'new-signature';
  assert.deepEqual(changedOfferSections(before, after), []);
});
test('meal, charge inclusion and cancellation changes are explained even with an identical price', () => {
  const before = base(), after = base(); after.meal = 'breakfast';
  after.taxes[0].included_by_supplier = true; after.cancellation.freeUntil = null;
  const original = JSON.stringify(before); assert.deepEqual(changedOfferSections(before, after), ['meal', 'taxes', 'cancellation']);
  assert.equal(JSON.stringify(before), original); assert.equal(after.price.amount, before.price.amount);
});
test('changes in source uncertainty require a new review in both comparisons', () => {
  const { offerTerms } = load('./offerReviewModel.ts');
  const before = base();
  for (const flag of ['incomplete', 'freeUntilInvalid', 'startInvalid', 'endInvalid']) {
    const after = base();
    const target = flag === 'incomplete' || flag === 'freeUntilInvalid' ? after.cancellation : after.cancellation.policies[0];
    target[flag] = true;
    assert.notEqual(offerTerms(before), offerTerms(after));
    assert.deepEqual(changedOfferSections(before, after), ['cancellation']);
  }
});
test('zero, missing amounts and currencies remain distinct, and room changes are not hidden', () => {
  const before = base(), after = base(); after.price.currency = 'AED'; after.taxes[0].amount = null;
  after.name = 'Different suite'; after.roomIdentity = 'different-room';
  assert.deepEqual(changedOfferSections(before, after), ['price', 'room', 'taxes']);
  const cancellation = base(); cancellation.cancellation.policies[0].amount = null;
  assert.deepEqual(changedOfferSections(before, cancellation), ['cancellation']);
});
