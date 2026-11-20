/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const m = load(path.resolve(__dirname, './chargeCurrencyModel.ts'));
// The booking server's checkout quote arithmetic, copied verbatim for parity checks.
const server = require('../../../../services/checkoutCurrencyService.js');

const now = Date.parse('2026-11-20T10:00:00Z');
const payload = { success: true, base: 'USD', valid_until: now + 5 * 60_000,
  rates: { USD: '1', AED: '3.6725', KWD: '0.3068', SAR: '3.75', XXX: '2' },
  currencies: { USD: { decimals: 2, step: 1 }, AED: { decimals: 2, step: 1 }, KWD: { decimals: 3, step: 10 }, SAR: { decimals: 2, step: 1 } } };

test('payment rates are read only when complete and current', () => {
  const table = m.readChargeRates(payload, now);
  assert.deepEqual(Object.keys(table.rates).sort(), ['AED', 'KWD', 'SAR', 'USD'], 'a rate without currency units is dropped');
  assert.equal(m.readChargeRates({ ...payload, success: false }, now), null);
  assert.equal(m.readChargeRates({ ...payload, valid_until: now - 31 * 60_000 }, now), null, 'an old table is not shown');
  assert.equal(m.readChargeRates({ ...payload, rates: { AED: '3.6725' } }, now), null);
});

test('displayed amounts equal the amount the checkout quote charges', () => {
  const table = m.readChargeRates(payload, now);
  for (const [amount, target] of [['1585.92', 'AED'], ['1392.00', 'AED'], ['12.34', 'KWD'], ['12.35', 'KWD'], ['27.82', 'SAR'], ['0.01', 'AED'], ['98765.43', 'KWD']]) {
    const shown = m.convertMoney({ amount, currency: 'USD' }, target, table, now);
    const minor = server.convertMinor(Math.round(Number(amount) * 100), 'USD', target, payload.rates);
    const decimals = payload.currencies[target].decimals;
    assert.equal(shown.amount, (minor / 10 ** decimals).toFixed(decimals), `${amount} USD → ${target}`);
    assert.equal(shown.currency, target);
  }
  assert.deepEqual(m.convertMoney({ amount: '1585.92', currency: 'USD' }, 'AED', table, now), { amount: '5824.29', currency: 'AED' });
});

test('conversion declines rather than guessing', () => {
  const table = m.readChargeRates(payload, now);
  assert.equal(m.convertMoney({ amount: '10', currency: 'USD' }, 'USD', table, now), null);
  assert.equal(m.convertMoney({ amount: '10', currency: 'USD' }, 'EUR', table, now), null, 'no rate for EUR');
  assert.equal(m.convertMoney({ amount: '10', currency: 'GBP' }, 'AED', table, now), null, 'unknown source currency');
  assert.equal(m.convertMoney({ amount: 'abc', currency: 'USD' }, 'AED', table, now), null);
  assert.equal(m.convertMoney({ amount: '10', currency: 'USD' }, 'AED', null, now), null);
  assert.equal(m.convertMoney({ amount: '10', currency: 'USD' }, 'AED', table, now + 40 * 60_000), null, 'expired table');
});
