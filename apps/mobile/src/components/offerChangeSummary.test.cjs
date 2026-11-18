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
const { changedOfferSections, compareStayPrices } = load('./offerChangeSummary.ts');
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

test('review acceptance compares individual taxes even when their currency subtotal is unchanged', () => {
  const { offerTerms } = load('./offerReviewModel.ts');
  const tax = amount => ({ name: 'city_tax', amount, currency_code: 'AED', included_by_supplier: false });
  const before = { ...base(), taxes: [tax('2.00'), tax('2.00')] };
  const reordered = { ...base(), taxes: [tax('2'), tax('02.000')] };
  const replaced = { ...base(), taxes: [tax('4.00')] };
  assert.equal(offerTerms(before), offerTerms(reordered));
  assert.deepEqual(changedOfferSections(before, reordered), []);
  assert.notEqual(offerTerms(before), offerTerms(replaced));
  assert.deepEqual(changedOfferSections(before, replaced), ['taxes']);
});

const price = (amount, currency = 'USD') => ({ amount, currency });
test('complete-stay increases and decreases expose absolute exact differences and copied source totals', () => {
  const before = price('107.00'), after = price('120.50');
  assert.deepEqual(compareStayPrices(before, after), {
    status: 'increase', before, after, difference: price('13.5'),
  });
  assert.deepEqual(compareStayPrices(after, before), {
    status: 'decrease', before: after, after: before, difference: price('13.5'),
  });
  const result = compareStayPrices(before, after);
  before.amount = '999'; after.currency = 'EUR';
  assert.deepEqual(result.before, price('107.00')); assert.deepEqual(result.after, price('120.50'));
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.before), true);
  assert.equal(Object.isFrozen(result.after), true); assert.equal(Object.isFrozen(result.difference), true);
});

test('sub-minor differences and amounts beyond floating-point precision never round to unchanged or zero', () => {
  for (const [before, after, difference] of [
    ['1.0000001', '1.0000002', '0.0000001'],
    ['9007199254740993.000000001', '9007199254740993.000000002', '0.000000001'],
    ['99999999999999999999999999999999.9999', '100000000000000000000000000000000.0001', '0.0002'],
    ['0.999999999999999999999999', '1', '0.000000000000000000000001'],
    ['0', '0.000000000000000000000000000000000000001', '0.000000000000000000000000000000000000001'],
  ]) {
    const result = compareStayPrices(price(before), price(after));
    assert.equal(result.status, 'increase', before); assert.deepEqual(result.difference, price(difference));
    const reversed = compareStayPrices(price(after), price(before));
    assert.equal(reversed.status, 'decrease'); assert.deepEqual(reversed.difference, price(difference));
  }
});

test('equivalent source formats remain unchanged without discarding their original decimal precision', () => {
  for (const [before, after] of [['000100.0000', '100.0'], ['0.000', '0000'], ['000.0100', '0.01']]) {
    const result = compareStayPrices(price(before), price(after));
    assert.equal(result.status, 'unchanged'); assert.deepEqual(result.difference, price('0'));
    assert.equal(result.before.amount, before); assert.equal(result.after.amount, after);
  }
});

test('different authoritative currencies retain both totals and never produce a direction, FX rate or numeric delta', () => {
  const result = compareStayPrices(price('100.00', 'USD'), price('1.000', 'AED'));
  assert.deepEqual(result, { status: 'differentCurrency', before: price('100.00', 'USD'), after: price('1.000', 'AED'), difference: null });
  assert.deepEqual(Object.keys(result).sort(), ['status', 'before', 'after', 'difference'].sort());
});

test('missing or malformed money never becomes zero, while any valid source side remains available', () => {
  const invalid = [null, undefined, {}, [], price(''), price(' 1'), price('-1'), price('+1'), price('1e2'),
    price('Infinity'), price('NaN'), price('.1'), price('1.'), price('1,000'), price(0), price(true),
    price('1'.repeat(129)), price('1', 'usd'), price('1', ''), price('1', 'US'), price('1', 'USDD')];
  for (const value of invalid) {
    assert.deepEqual(compareStayPrices(value, price('0.00')), {
      status: 'unavailable', before: null, after: price('0.00'), difference: null,
    });
    assert.deepEqual(compareStayPrices(price('1.00'), value), {
      status: 'unavailable', before: price('1.00'), after: null, difference: null,
    });
  }
  assert.deepEqual(compareStayPrices(null, undefined), { status: 'unavailable', before: null, after: null, difference: null });
  assert.equal(compareStayPrices(price('0.00'), price('1')).status, 'increase');
  assert.equal(compareStayPrices(price('1'), price('0.000')).status, 'decrease');
});

test('exact arithmetic handles the maximum input precision, including a delta wider than either source spelling', () => {
  const whole = '9'.repeat(128), fraction = '0.' + '0'.repeat(125) + '1';
  const result = compareStayPrices(price(fraction), price(whole));
  assert.equal(result.status, 'increase');
  assert.equal(result.difference.amount, '9'.repeat(127) + '8.' + '9'.repeat(126));
  assert.equal(result.before.amount, fraction); assert.equal(result.after.amount, whole);
});

test('digit subtraction agrees with an independent integer oracle over varied decimal scales and directions', () => {
  const oracle = (before, after) => {
    const [bw, bf = ''] = before.split('.'), [aw, af = ''] = after.split('.');
    const scale = Math.max(bf.length, af.length);
    const oldValue = BigInt(bw + bf.padEnd(scale, '0')), newValue = BigInt(aw + af.padEnd(scale, '0'));
    const difference = (newValue > oldValue ? newValue - oldValue : oldValue - newValue).toString().padStart(scale + 1, '0');
    const raw = scale ? difference.slice(0, -scale) + '.' + difference.slice(-scale) : difference;
    const amount = raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw;
    return { status: newValue > oldValue ? 'increase' : newValue < oldValue ? 'decrease' : 'unchanged', difference: amount };
  };
  let seed = 157;
  const digits = count => Array.from({ length: count }, () => { seed = (seed * 48271) % 2147483647; return String(seed % 10); }).join('');
  for (let index = 0; index < 150; index += 1) {
    const before = digits(index % 27 + 1) + '.' + digits(index % 19 + 1);
    const after = digits(index % 23 + 1) + '.' + digits(index % 17 + 1);
    const expected = oracle(before, after), actual = compareStayPrices(price(before), price(after));
    assert.equal(actual.status, expected.status); assert.equal(actual.difference.amount, expected.difference);
  }
});

test('same-price non-price changes and identity-only changes remain explicit without a fabricated price difference', () => {
  const before = base(), after = base();
  after.roomIdentity = 'updated-exact-classification';
  assert.deepEqual(changedOfferSections(before, after), ['room']);
  assert.equal(compareStayPrices(before.price, after.price).status, 'unchanged');
  after.meal = 'breakfast'; after.taxes[0].included_by_supplier = true; after.cancellation.incomplete = true;
  assert.deepEqual(changedOfferSections(before, after), ['room', 'meal', 'taxes', 'cancellation']);
  assert.equal(compareStayPrices(before.price, after.price).difference.amount, '0');
});
