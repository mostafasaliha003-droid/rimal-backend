import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUsdDisplayRates, parseUsdDisplayRates } from './displayCurrency.js';

const now = Date.parse('2026-09-23T12:00:00Z');
const rows = [
    { date: '2026-09-23', base: 'USD', quote: 'AED', rate: 3.6725 },
    { date: '2026-09-23', base: 'USD', quote: 'SAR', rate: 3.75 },
    { date: '2026-09-23', base: 'USD', quote: 'EUR', rate: 0.87088 }
];

test('accepts complete fresh USD quotes and rejects missing, invalid or stale rates', () => {
    assert.deepEqual(parseUsdDisplayRates(rows, now), { date: '2026-09-23', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 } });
    assert.equal(parseUsdDisplayRates(rows.slice(0, 2), now), null);
    assert.equal(parseUsdDisplayRates([...rows, rows[0]], now), null);
    assert.equal(parseUsdDisplayRates(rows.map(row => ({ ...row, date: '2026-09-16' })), now), null);
    assert.equal(parseUsdDisplayRates(rows.map(row => ({ ...row, rate: 0 })), now), null);
    assert.equal(parseUsdDisplayRates(rows.map(row => ({ ...row, date: '2026-09-31' })), now), null);
});

test('caches valid quotes, but never serves expired quotes when the provider is unavailable', async () => {
    let saved = null;
    let requests = 0;
    const storage = { getItem: () => saved, setItem: (key, value) => { saved = value; } };
    const fetcher = async () => { requests += 1; return { ok: true, json: async () => rows }; };
    assert.deepEqual((await loadUsdDisplayRates({ storage, fetcher, now })).rates, { AED: 3.6725, SAR: 3.75, EUR: 0.87088 });
    assert.deepEqual((await loadUsdDisplayRates({ storage, fetcher, now: now + 60_000 })).rates, { AED: 3.6725, SAR: 3.75, EUR: 0.87088 });
    assert.equal(requests, 1);
    await assert.rejects(loadUsdDisplayRates({ storage, fetcher: async () => ({ ok: false }), now: now + 6 * 24 * 60 * 60 * 1000 }), /unavailable/);
});