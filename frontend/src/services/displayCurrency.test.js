import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadUsdDisplayRates, parseUsdDisplayRates, parseUsdDisplayRatePayload } from './displayCurrency.js';

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
    const payload = { success: true, date: '2026-09-23', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 } };
    const fetcher = async url => {
        requests += 1;
        assert.equal(url, '/api/display-rates');
        return { ok: true, json: async () => payload };
    };
    assert.deepEqual((await loadUsdDisplayRates({ storage, fetcher, now })).rates, { AED: 3.6725, SAR: 3.75, EUR: 0.87088 });
    assert.deepEqual((await loadUsdDisplayRates({ storage, fetcher, now: now + 60_000 })).rates, { AED: 3.6725, SAR: 3.75, EUR: 0.87088 });
    assert.equal(requests, 1);
    await assert.rejects(loadUsdDisplayRates({ storage, fetcher: async () => ({ ok: false }), now: now + 6 * 24 * 60 * 60 * 1000 }), /unavailable/);
});

test('validates the shared API payload and rejects incomplete or malformed quotes', () => {
    assert.deepEqual(parseUsdDisplayRatePayload({
        success: true, date: '2026-09-23', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 }
    }, now), { date: '2026-09-23', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 } });
    assert.equal(parseUsdDisplayRatePayload({ success: true, date: '2026-09-23', rates: { AED: 3.6725 } }, now), null);
    assert.equal(parseUsdDisplayRatePayload({ success: true, date: '2026-09-23', rates: { AED: 0, SAR: 3.75, EUR: 0.87 } }, now), null);
    assert.equal(parseUsdDisplayRatePayload({ success: false, date: '2026-09-23', rates: { AED: 3.6, SAR: 3.7, EUR: 0.8 } }, now), null);
    assert.equal(parseUsdDisplayRatePayload({ success: true, date: 'not-a-date', rates: { AED: 3.6, SAR: 3.7, EUR: 0.8 } }, now), null);
});

test('marks server-provided fallback quotes as stale for the customer label', async () => {
    const payload = { success: true, stale: true, date: '2026-09-23', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87088 } };
    const loaded = await loadUsdDisplayRates({
        storage: { getItem: () => null, setItem() {} },
        fetcher: async () => ({ ok: true, json: async () => payload }),
        now
    });
    assert.equal(loaded.stale, true);
});