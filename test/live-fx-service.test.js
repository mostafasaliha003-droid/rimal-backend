const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    CACHE_TTL_MS,
    FRANKFURTER_BASE_URL,
    createLiveFxService
} = require('../services/liveFxService');
const { createLivePricingService } = require('../services/pricingService');

const NOW = Date.parse('2026-10-01T12:00:00.000Z');

function frankfurterPayload(base, quote, rate, date = '2026-10-01') {
    return { base, quote, rate, date };
}

function response(payload, ok = true) {
    return { ok, async json() { return payload; } };
}

test('fetches a dated Frankfurter v2 pair and caches it for one hour', async () => {
    let now = NOW;
    let calls = 0;
    const service = createLiveFxService({
        now: () => now,
        fetcher: async url => {
            calls += 1;
            assert.equal(url, `${FRANKFURTER_BASE_URL}/v2/rate/eur/aed`);
            return response(frankfurterPayload('EUR', 'AED', 4.2501));
        }
    });

    const first = await service.getRate('eur', 'aed');
    now += CACHE_TTL_MS - 1;
    const cached = await service.getRate('EUR', 'AED');

    assert.deepEqual(first, {
        baseCurrency: 'EUR', quoteCurrency: 'AED', rate: '4.2501',
        date: '2026-10-01', provider: 'frankfurter', stale: false
    });
    assert.deepEqual(cached, first);
    assert.equal(calls, 1);
});

test('refreshes the exchange-rate cache at its TTL boundary', async () => {
    let now = NOW;
    let calls = 0;
    const service = createLiveFxService({
        now: () => now,
        fetcher: async () => {
            calls += 1;
            return response(frankfurterPayload('EUR', 'AED', calls === 1 ? 4.25 : 4.3));
        }
    });

    assert.equal((await service.getRate('EUR', 'AED')).rate, '4.25');
    now += CACHE_TTL_MS;
    assert.equal((await service.getRate('EUR', 'AED')).rate, '4.3');
    assert.equal(calls, 2);
});

test('coalesces simultaneous requests for the same currency pair', async () => {
    let calls = 0;
    let resolveFetch;
    const service = createLiveFxService({
        now: () => NOW,
        fetcher: () => {
            calls += 1;
            return new Promise(resolve => { resolveFetch = resolve; });
        }
    });

    const first = service.getRate('EUR', 'AED');
    const second = service.getRate('EUR', 'AED');
    await new Promise(resolve => setImmediate(resolve));
    resolveFetch(response(frankfurterPayload('EUR', 'AED', 4.25)));
    assert.deepEqual(await Promise.all([first, second]), [
        {
            baseCurrency: 'EUR', quoteCurrency: 'AED', rate: '4.25',
            date: '2026-10-01', provider: 'frankfurter', stale: false
        },
        {
            baseCurrency: 'EUR', quoteCurrency: 'AED', rate: '4.25',
            date: '2026-10-01', provider: 'frankfurter', stale: false
        }
    ]);
    assert.equal(calls, 1);
});

test('uses an identity rate without a network call and rejects invalid currencies', async () => {
    let calls = 0;
    const service = createLiveFxService({
        now: () => NOW,
        fetcher: async () => { calls += 1; return response({}); }
    });

    assert.equal((await service.getRate('AED', 'AED')).rate, '1');
    await assert.rejects(service.getRate('EURO', 'AED'), error => error.code === 'fx_currency_invalid');
    assert.equal(calls, 0);
});

test('rejects malformed, non-positive, and too-old rates without caching them', async () => {
    const invalidPayloads = [
        { base: 'USD', quote: 'AED', rate: 0, date: '2026-10-01' },
        { base: 'EUR', quote: 'AED', rate: '1e2', date: '2026-10-01' },
        { base: 'EUR', quote: 'USD', rate: 1.1, date: '2026-10-01' },
        { base: 'EUR', quote: 'AED', rate: 4.2, date: '2026-02-30' },
        { base: 'EUR', quote: 'AED', rate: 4.2, date: '2026-09-20' }
    ];
    for (const payload of invalidPayloads) {
        let calls = 0;
        const service = createLiveFxService({
            now: () => NOW,
            fetcher: async () => { calls += 1; return response(payload); }
        });
        await assert.rejects(service.getRate('EUR', 'AED'), error =>
            ['fx_rate_response_invalid', 'fx_rate_expired'].includes(error.code));
        await assert.rejects(service.getRate('EUR', 'AED'));
        assert.equal(calls, 2, 'invalid provider responses must not enter cache');
    }
});

test('fails closed when the provider is unavailable and never caches that failure', async () => {
    let calls = 0;
    const service = createLiveFxService({
        now: () => NOW,
        fetcher: async () => { calls += 1; return response(null, false); }
    });

    await assert.rejects(service.getRate('EUR', 'AED'), error => error.code === 'fx_provider_unavailable');
    await assert.rejects(service.getRate('EUR', 'AED'), error => error.code === 'fx_provider_unavailable');
    assert.equal(calls, 2);
});

test('converts with live source and target quotes using the exact pricing service', async () => {
    const quotes = {
        'EUR:AED': { baseCurrency: 'EUR', quoteCurrency: 'AED', rate: '4.2501' },
        'USD:AED': { baseCurrency: 'USD', quoteCurrency: 'AED', rate: '3.6725' }
    };
    const pricing = createLivePricingService({
        fxService: { async getRate(from, to) { return quotes[`${from}:${to}`]; } }
    });
    const offer = {
        provider: 'hotelbeds',
        price: { supplierAmount: { amount: '100.00', currency: 'EUR', basis: 'supplier_net' } }
    };

    const result = await pricing(offer, 'USD', { markupPercent: '0' });
    assert.equal(result.price.display.amount, '115.73');
    assert.equal(result.price.supplierAmount.amount, '100.00');
});