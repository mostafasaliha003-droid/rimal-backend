/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'nationalityRepriceModel.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
const { matchOfferForNationality, samePrice } = loaded.exports;

const offer = (patch = {}) => ({ id: 'o', name: 'Standard Double room', bookHash: 'h-1', offerContext: 'ctx', roomIdentity: 'rg-a',
  price: { amount: '612.00', currency: 'AED' }, meal: 'breakfast', paymentType: 'deposit', images: [], taxes: [],
  cancellation: { freeUntil: '2099-01-01T00:00:00', policies: [] }, ...patch });

test('finds the same rate at the same price for another nationality', () => {
  const original = offer();
  const same = offer({ id: 'same', bookHash: 'h-2' });
  const pricier = offer({ id: 'pricier', bookHash: 'h-3', price: { amount: '650.00', currency: 'AED' } });
  assert.equal(matchOfferForNationality(original, [pricier, same]).id, 'same');
});

test('takes the cheapest equivalent rate when the price differs', () => {
  const original = offer();
  const a = offer({ id: 'a', bookHash: 'h-2', price: { amount: '700', currency: 'AED' } });
  const b = offer({ id: 'b', bookHash: 'h-3', price: { amount: '640', currency: 'AED' } });
  assert.equal(matchOfferForNationality(original, [a, b]).id, 'b');
});

test('never swaps in a different room, meal, payment or cancellation deadline', () => {
  const original = offer();
  for (const patch of [{ roomIdentity: 'rg-b' }, { meal: 'nomeal' }, { noChildMeal: true }, { paymentType: undefined },
    { cancellation: { freeUntil: null, policies: [] } }, { bookHash: 'p-prebooked' }, { offerContext: undefined }, { price: null }])
    assert.equal(matchOfferForNationality(original, [offer({ id: 'x', bookHash: 'h-9', ...patch })]), null, JSON.stringify(patch));
  // Without classifications on both sides the room name decides.
  assert.equal(matchOfferForNationality(offer({ roomIdentity: undefined }), [offer({ id: 'n', bookHash: 'h-2', roomIdentity: undefined })]).id, 'n');
  assert.equal(matchOfferForNationality(offer({ roomIdentity: undefined }), [offer({ id: 'n', bookHash: 'h-2', roomIdentity: undefined, name: 'Suite' })]), null);
});

test('prices compare by currency and numeric amount', () => {
  assert.equal(samePrice({ amount: '612.00', currency: 'AED' }, { amount: '612', currency: 'AED' }), true);
  assert.equal(samePrice({ amount: '612', currency: 'AED' }, { amount: '612', currency: 'USD' }), false);
  assert.equal(samePrice(null, { amount: '1', currency: 'AED' }), false);
});
