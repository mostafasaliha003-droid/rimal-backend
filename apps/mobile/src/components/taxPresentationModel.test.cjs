/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, filename);
  if (cache.has(full)) return cache.get(full).exports;
  if (full.endsWith('.json')) return JSON.parse(fs.readFileSync(full, 'utf8'));
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = name => name.startsWith('.')
    ? load(path.resolve(path.dirname(full), path.extname(name) ? name : `${name}.ts`)) : require(name);
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
const { presentTaxes } = load('./taxPresentationModel.ts');
const tax = (name, amount, currency = 'USD', included = false) => ({ name, amount, currency_code: currency, included_by_supplier: included });
const group = (model, currency) => model.excludedGroups.find(value => value.currency === currency);

test('missing or empty data never implies a zero subtotal or that every tax is included', () => {
  for (const input of [undefined, null, [], {}, 'taxes']) {
    const model = presentTaxes(input);
    assert.equal(model.dataState, 'notSupplied'); assert.deepEqual(model.rows, []);
    assert.deepEqual(model.excludedGroups, []); assert.equal(model.hasExcluded, false);
    assert.deepEqual(Object.keys(model).sort(), ['rows', 'dataState', 'hasExcluded', 'hasUnknown', 'excludedGroups', 'unassignedExcluded'].sort());
  }
});

test('supplied excluded rows yield exact separate-currency subtotals without adding included fees', () => {
  const model = presentTaxes([
    tax('city_tax', '2.50'), tax('service_fee', '3.0001'), tax('tiny_fee', '0.0001'),
    tax('zero_fee', '0.00'), tax('', '0.50'), tax('property_fee', '15.00', 'AED'), tax('vat', '7.25', 'USD', true),
  ]);
  assert.equal(model.dataState, 'supplied'); assert.equal(model.hasExcluded, true); assert.equal(model.hasUnknown, false);
  assert.deepEqual(model.excludedGroups.map(value => value.currency), ['USD', 'AED']);
  assert.deepEqual(group(model, 'USD').subtotal, { amount: '6.0002', currency: 'USD' });
  assert.deepEqual(group(model, 'AED').subtotal, { amount: '15', currency: 'AED' });
  assert.equal(group(model, 'USD').rows.length, 5); assert.equal(model.rows[6].inclusion, 'included');
  assert.deepEqual(model.rows[6].money, { amount: '7.25', currency: 'USD' });
  assert.equal(model.excludedGroups.every(value => value.complete), true);
});

test('real duplicate fees retain occurrence/order and are summed rather than silently deduplicated', () => {
  const input = [tax('same_fee', '001.2500'), tax('same_fee', '001.2500'), tax('included', '0.000', 'EUR', true)];
  const model = presentTaxes(input);
  assert.deepEqual(model.rows.map(row => [row.index, row.name, row.amount]), [[0, 'same_fee', '001.2500'], [1, 'same_fee', '001.2500'], [2, 'included', '0.000']]);
  assert.deepEqual(group(model, 'USD').subtotal, { amount: '2.5', currency: 'USD' });
  input[0].amount = '999'; input[1].name = 'Changed'; input.push(tax('other', '99'));
  assert.equal(model.rows[0].amount, '001.2500'); assert.equal(model.rows[1].name, 'same_fee'); assert.equal(model.rows.length, 3);
  assert.equal(Object.isFrozen(model), true); assert.equal(Object.isFrozen(model.rows), true);
  assert.equal(Object.isFrozen(model.rows[0]), true); assert.equal(Object.isFrozen(model.rows[0].money), true);
  assert.equal(Object.isFrozen(model.excludedGroups[0].rows), true);
});

test('included rows with unknown amount/currency remain visible but do not contaminate excluded subtotals', () => {
  const model = presentTaxes([tax('excluded', '3.25'), tax('included_missing_amount', null, 'USD', true),
    tax('included_missing_currency', '2', null, true)]);
  assert.equal(model.hasUnknown, true); assert.equal(model.rows[1].money, null);
  assert.equal(model.rows[2].inclusion, 'included'); assert.equal(model.excludedGroups.length, 1);
  assert.equal(group(model, 'USD').complete, true); assert.deepEqual(group(model, 'USD').subtotal, { amount: '3.25', currency: 'USD' });
  const includedOnly = presentTaxes([tax('vat', '0.00', 'USD', true)]);
  assert.equal(includedOnly.dataState, 'supplied'); assert.equal(includedOnly.hasUnknown, false);
  assert.equal(includedOnly.hasExcluded, false); assert.deepEqual(includedOnly.excludedGroups, []);
});

test('a missing excluded amount blocks its currency subtotal without fabricating a partial or zero total', () => {
  const model = presentTaxes([tax('known', '2.50'), tax('missing', null), tax('other_currency', '15', 'AED')]);
  assert.equal(group(model, 'USD').complete, false); assert.equal(group(model, 'USD').subtotal, null);
  assert.deepEqual(group(model, 'USD').incompleteReasons, ['amount']);
  assert.deepEqual(group(model, 'AED').subtotal, { amount: '15', currency: 'AED' });
  assert.equal(model.rows.length, 3); assert.equal(model.hasUnknown, true);
});

test('unknown inclusion blocks only its known currency and does not classify string booleans', () => {
  const model = presentTaxes([tax('usd', '1'), tax('unknown', '4', 'USD', null), tax('aed', '15', 'AED'),
    tax('text_boolean', '2', 'USD', 'false')]);
  assert.equal(model.rows[1].inclusion, 'unknown'); assert.equal(model.rows[3].inclusion, 'unknown');
  assert.equal(group(model, 'USD').subtotal, null); assert.deepEqual(group(model, 'USD').incompleteReasons, ['inclusion']);
  assert.deepEqual(group(model, 'AED').subtotal, { amount: '15', currency: 'AED' });
  assert.equal(group(model, 'USD').rows.length, 1, 'Unknown inclusion must not be silently counted as excluded');
});

test('an unassignable excluded currency prevents every potentially-incomplete currency subtotal', () => {
  const model = presentTaxes([tax('usd', '2.5'), tax('aed', '15', 'AED'), tax('unassigned', '1.25', null),
    tax('unknown_inclusion', '4', 'USD', null)]);
  assert.equal(model.unassignedExcluded.length, 1); assert.equal(model.unassignedExcluded[0].index, 2);
  assert.equal(model.excludedGroups.every(value => value.subtotal === null && !value.complete), true);
  assert.deepEqual(group(model, 'USD').incompleteReasons, ['inclusion', 'currency']);
  assert.deepEqual(group(model, 'AED').incompleteReasons, ['currency']);
  const unknownBoth = presentTaxes([tax('known', '1'), tax('unknown', '2', null, null)]);
  assert.deepEqual(group(unknownBoth, 'USD').incompleteReasons, ['inclusion', 'currency']);
});

test('invalid/unknown monetary values never coerce to zero and raw supplied spelling is retained', () => {
  for (const amount of [null, undefined, '', ' ', '-1', '+1', '.5', '1.', '1e2', 'NaN', 'Infinity', true, 0, '1'.repeat(129)]) {
    const model = presentTaxes([tax('bad', amount)]), row = model.rows[0];
    assert.equal(row.amountValid, false, String(amount)); assert.equal(row.money, null);
    assert.equal(group(model, 'USD').subtotal, null); assert.equal(model.hasUnknown, true);
  }
  for (const currency of [null, '', 'usd', 'US', 'USDD', true]) {
    const row = { ...tax('bad_currency', '0.00'), currency_code: currency };
    const model = presentTaxes([row]);
    assert.equal(model.rows[0].currencyValid, false); assert.equal(model.rows[0].money, null);
    assert.equal(model.excludedGroups.length, 0); assert.equal(model.unassignedExcluded.length, 1);
    assert.equal(model.rows[0].currency, typeof currency === 'string' ? currency : null);
  }
  assert.deepEqual(presentTaxes([tax('real_zero', '000.0000')]).excludedGroups[0].subtotal, { amount: '0', currency: 'USD' });
});

test('malformed and sparse rows are retained as unknown rather than silently disappearing', () => {
  const sparse = new Array(1);
  for (const input of [[null], [42], sparse]) {
    const model = presentTaxes(input);
    assert.equal(model.dataState, 'supplied'); assert.equal(model.rows.length, 1);
    assert.equal(model.rows[0].inclusion, 'unknown'); assert.equal(model.rows[0].money, null);
    assert.equal(model.hasUnknown, true); assert.equal(model.excludedGroups.length, 0);
  }
});

test('large and subcent sums stay exact even when the derived subtotal exceeds the source length limit', () => {
  const maximum = '9'.repeat(128), tiny = '0.' + '0'.repeat(125) + '1';
  const model = presentTaxes([tax('large', maximum), tax('large_again', maximum), tax('tiny', tiny)]);
  assert.equal(group(model, 'USD').subtotal.amount, '1' + '9'.repeat(127) + '8.' + '0'.repeat(125) + '1');
  assert.equal(model.rows[2].amount, tiny);
  assert.equal(group(model, 'USD').subtotal.amount.length > 128, true);
  const subcent = presentTaxes([tax('one', '0.0001'), tax('two', '0.0001'), tax('three', '0.0001')]);
  assert.equal(group(subcent, 'USD').subtotal.amount, '0.0003');
});

test('per-currency sums agree with an independent scaled-integer oracle over varied source precision', () => {
  let seed = 917;
  const digits = count => Array.from({ length: count }, () => { seed = seed * 48271 % 2147483647; return String(seed % 10); }).join('');
  const input = Array.from({ length: 150 }, (_, index) => tax(`fee_${index}`, digits(index % 27 + 1) + '.' + digits(index % 19 + 1), index % 2 ? 'USD' : 'AED'));
  const model = presentTaxes(input);
  for (const currency of ['USD', 'AED']) {
    const values = input.filter(row => row.currency_code === currency).map(row => row.amount.split('.'));
    const scale = Math.max(...values.map(([, fraction]) => fraction.length));
    const sum = values.reduce((total, [whole, fraction]) => total + BigInt(whole + fraction.padEnd(scale, '0')), 0n).toString().padStart(scale + 1, '0');
    const expected = (sum.slice(0, -scale) + '.' + sum.slice(-scale)).replace(/0+$/, '').replace(/\.$/, '');
    assert.equal(group(model, currency).subtotal.amount, expected);
  }
});

test('presentation never derives payer/timing, alters a quoted price or emits a cross-currency grand total', () => {
  const model = presentTaxes([tax('fee', '15', 'AED'), tax('fee', '3', 'USD')]);
  assert.equal(model.excludedGroups.length, 2);
  for (const forbidden of ['total', 'grandTotal', 'payee', 'paymentTime', 'quote', 'customerPrice', 'rate']) {
    assert.equal(Object.hasOwn(model, forbidden), false);
  }
  assert.equal(model.excludedGroups.every(value => Object.keys(value).every(key => ['currency', 'rows', 'complete', 'subtotal', 'incompleteReasons'].includes(key))), true);
});
