/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { DISPLAY_CURRENCIES, currencyForCountry, isDisplayCurrency, currencyName, bookingCurrency, findCurrencies } =
  load(path.join(__dirname, 'currencyCatalog.ts'));
const { paymentCurrencyUnits } = load(path.join(__dirname, '../api/paymentCurrencies.ts'));
const serverUnits = require('../../../../shared/paymentCurrencies.json');

test('catalog exposes current legal tender and bilingual names; stale and pseudo currencies are excluded', () => {
  assert.ok(DISPLAY_CURRENCIES.length >= 150);
  assert.equal(new Set(DISPLAY_CURRENCIES).size, DISPLAY_CURRENCIES.length);
  for (const code of DISPLAY_CURRENCIES) {
    assert.match(code, /^[A-Z]{3}$/);
    assert.match(currencyName(code, 'ar'), /\p{Script=Arabic}/u, code);
    assert.match(currencyName(code, 'en'), /[A-Za-z]/, code);
  }
  for (const code of ['ANG', 'BGN', 'SLL', 'ZWL', 'XXX', 'XAU', 'toString', '__proto__', null]) {
    assert.equal(isDisplayCurrency(code), false);
  }
});

test('country automatic selection uses the primary current tender for that region', () => {
  for (const [region, code] of Object.entries({ ae: 'AED', sa: 'SAR', EG: 'EGP', GB: 'GBP', CA: 'CAD', CH: 'CHF',
    jp: 'JPY', BG: 'EUR', CW: 'XCG', SL: 'SLE', ZW: 'ZWG', PA: 'PAB', XK: 'EUR', ' us ': 'USD' })) {
    assert.equal(currencyForCountry(region), code);
  }
  for (const unknown of [null, 'ZZ', 'en-US', 'ar-AE', 'AQ', '__proto__']) assert.equal(currencyForCountry(unknown), null);
});

test('transaction currencies and increments match the gateway; all other display preferences book in USD', () => {
  assert.deepEqual(Object.keys(paymentCurrencyUnits).sort(), Object.keys(serverUnits).sort());
  for (const [code, { decimals, step }] of Object.entries(serverUnits)) {
    assert.deepEqual(paymentCurrencyUnits[code], { decimals, step });
  }
  for (const code of DISPLAY_CURRENCIES) assert.equal(bookingCurrency(code), Object.hasOwn(serverUnits, code) ? code : 'USD');
  assert.equal(bookingCurrency(null), 'USD');
  assert.equal(bookingCurrency('constructor'), 'USD');
});

test('matches either language, including Arabic articles, tashkeel, hamza, and English or ISO queries', () => {
  assert.deepEqual(findCurrencies('  الدرهم الإِمَـارَاتي  ', 'en'), ['AED']);
  assert.equal(findCurrencies('الدولار', 'ar')[0], 'USD');
  assert.deepEqual(findCurrencies('Japanese yen', 'ar'), ['JPY']);
  assert.equal(findCurrencies('jPy', 'en')[0], 'JPY');
  assert.deepEqual(findCurrencies('الجنيه الاسترليني', 'ar'), ['GBP']);
  assert.equal(findCurrencies('دولار كندي', 'ar')[0], 'CAD');
  assert.deepEqual(findCurrencies('a non-existent currency', 'en'), []);
});
test('sandbox preserves bookable USD supplier rates regardless of the preferred display currency', () => {
  for (const code of ['USD', 'AED', 'EUR', 'QAR', 'JPY']) assert.equal(bookingCurrency(code, 'staging'), 'USD');
  assert.equal(bookingCurrency('AED', 'production'), 'AED');
  assert.equal(bookingCurrency('JPY', 'production'), 'USD');
});
