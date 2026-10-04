const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const createDisplayCurrencyRouter = require('./services/displayCurrencyRoutes');
const { createDisplayCurrencyService } = require('./services/displayCurrencyService');

const now = Date.parse('2026-09-26T12:00:00Z');
const rows = [
    { date: '2026-09-26', base: 'USD', quote: 'AED', rate: 3.6725 },
    { date: '2026-09-26', base: 'USD', quote: 'SAR', rate: 3.75 },
    { date: '2026-09-26', base: 'USD', quote: 'EUR', rate: 0.87 }
];

test('server shares one validated FX fetch across concurrent calls and caches fresh rates', async () => {
    let calls = 0;
    const service = createDisplayCurrencyService({ fetcher: async (url, options) => {
        calls += 1;
        assert.equal(url, 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=AED,SAR,EUR');
        assert.ok(options.signal);
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ok: true, json: async () => rows };
    } });
    const results = await Promise.all(Array.from({ length: 5 }, () => service.getRates({ now })));
    assert.equal(calls, 1);
    assert.ok(results.every(result => result.date === '2026-09-26'));
    assert.deepEqual(results[0].rates, { AED: 3.6725, SAR: 3.75, EUR: 0.87 });
    assert.equal((await service.getRates({ now: now + 60_000 })).stale, false);
    assert.equal(calls, 1);
});

test('server falls back only to still-young quotes and fails closed for invalid or old rates', async () => {
    let online = true;
    const service = createDisplayCurrencyService({ fetcher: async () => online
        ? { ok: true, json: async () => rows }
        : { ok: false } });
    await service.getRates({ now });
    online = false;
    assert.equal((await service.getRates({ now: now + 7 * 60 * 60 * 1000 })).stale, true);
    await assert.rejects(service.getRates({ now: now + 6 * 24 * 60 * 60 * 1000 }));

    const invalid = createDisplayCurrencyService({ fetcher: async () => ({ ok: true, json: async () => rows.slice(0, 1) }) });
    await assert.rejects(invalid.getRates({ now }), /Invalid display exchange rates/);
});

test('public endpoint returns cacheable estimates and a safe unavailable response', async context => {
    let available = true;
    const service = { getRates: async () => {
        if (!available) throw new Error('private upstream error');
        return { date: '2026-09-26', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87 }, stale: false };
    } };
    const app = express().use('/api', createDisplayCurrencyRouter(service));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close(error => error ? reject(error) : resolve());
    }));
    const url = `http://127.0.0.1:${server.address().port}/api/display-rates`;

    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=900/);
    assert.deepEqual(await response.json(), { success: true, date: '2026-09-26', rates: { AED: 3.6725, SAR: 3.75, EUR: 0.87 }, stale: false });

    available = false;
    const failed = await fetch(url);
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await failed.json(), { success: false, error: 'DISPLAY_RATES_UNAVAILABLE' });
});