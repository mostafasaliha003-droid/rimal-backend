/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { readDisplayQuotes, displayEstimate } = load(path.join(__dirname, 'displayEstimateModel.ts'));
const now = Date.parse('2026-11-19T12:00:00Z');

test('world references require USD source and a valid recent date per currency', () => {
  const payload = { success: true, base: 'USD', rates: { JPY: 140.5, CAD: 1.4, RUB: 0, GBP: '2', PLN: 4, EUR: 0.8 },
    dates: { JPY: '2026-11-18', CAD: '2026-11-09', RUB: '2026-11-19', GBP: '2026-11-19', PLN: '2026-11-25', EUR: '2026-02-31' } };
  assert.deepEqual(readDisplayQuotes(payload, now), { JPY: { rate: 140.5, date: '2026-11-18' } });
  assert.deepEqual(readDisplayQuotes({ ...payload, base: 'AED' }, now), {});
});

test('stay estimates never convert a different base, a stale quote or a missing price', () => {
  const quotes = { JPY: { rate: 140.5, date: '2026-11-18' } };
  const source = Object.freeze({ amount: '10.00', currency: 'USD' });
  assert.match(displayEstimate(source, 'JPY', quotes, 'en', now).text, /1,405/);
  assert.equal(displayEstimate({ ...source, currency: 'AED' }, 'JPY', quotes, 'en', now), null);
  assert.equal(displayEstimate(source, 'JPY', quotes, 'ar', now+6*86400000), null);
  assert.equal(displayEstimate(source, 'CAD', quotes, 'ar', now), null);
  assert.equal(displayEstimate({ ...source, amount: '1e5' }, 'JPY', quotes, 'en', now), null);
  assert.equal(source.amount, '10.00');
});
