/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { DISPLAY_CURRENCIES, currencyForCountry, isDisplayCurrency, currencyName, bookingCurrency, paymentCurrency, findCurrencies } =
  load(path.join(__dirname, 'currencyCatalog.ts'));
const { paymentCurrencyUnits } = load(path.join(__dirname, '../api/paymentCurrencies.ts'));
const serverUnits = require('../../../../shared/paymentCurrencies.json');

test('only currencies the payment gateway can charge are offered, with bilingual names', () => {
  assert.deepEqual([...DISPLAY_CURRENCIES].sort(), Object.keys(serverUnits).sort());
  for (const code of DISPLAY_CURRENCIES) {
    assert.match(currencyName(code, 'ar'), /\p{Script=Arabic}/u, code);
    assert.match(currencyName(code, 'en'), /[A-Za-z]/, code);
  }
  for (const code of ['EGP', 'JPY', 'ANG', 'XXX', 'toString', '__proto__', null]) assert.equal(isDisplayCurrency(code), false);
});

test('automatic selection uses the country currency when it is payable, otherwise none', () => {
  for (const [region, code] of Object.entries({ ae: 'AED', sa: 'SAR', KW: 'KWD', qa: 'QAR', GB: 'GBP', BG: 'EUR', XK: 'EUR', in: 'INR', ' us ': 'USD' })) {
    assert.equal(currencyForCountry(region), code, region);
  }
  for (const other of [null, 'ZZ', 'EG', 'JP', 'PA', 'en-US', '__proto__']) assert.equal(currencyForCountry(other), null);
});

test('gateway units match the server; the supplier is always searched in US dollars', () => {
  assert.deepEqual(Object.keys(paymentCurrencyUnits).sort(), Object.keys(serverUnits).sort());
  for (const [code, { decimals, step }] of Object.entries(serverUnits)) assert.deepEqual(paymentCurrencyUnits[code], { decimals, step });
  for (const code of [...DISPLAY_CURRENCIES, 'JPY', null]) {
    assert.equal(bookingCurrency(code, 'production'), 'USD');
    assert.equal(bookingCurrency(code, 'staging'), 'USD');
  }
  assert.equal(paymentCurrency('KWD'), 'KWD');
  assert.equal(paymentCurrency('JPY'), 'USD');
  assert.equal(paymentCurrency('constructor'), 'USD');
});

test('matches either language, including Arabic articles, tashkeel, hamza, and English or ISO queries', () => {
  assert.deepEqual(findCurrencies('  الدرهم الإِمَـارَاتي  ', 'en'), ['AED']);
  assert.equal(findCurrencies('الدولار', 'ar')[0], 'USD');
  assert.deepEqual(findCurrencies('الجنيه الاسترليني', 'ar'), ['GBP']);
  assert.equal(findCurrencies('kwd', 'en')[0], 'KWD');
  assert.deepEqual(findCurrencies('Japanese yen', 'ar'), []);
  assert.deepEqual(findCurrencies('a non-existent currency', 'en'), []);
});
