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

test('independent quote dates are accepted only while every currency remains recent', async () => {
    const quotes = rows.map(row => ({ ...row, date: row.quote === 'EUR' ? '2026-09-25' : row.date }));
    const service = createDisplayCurrencyService({ fetcher: async () => ({ ok: true, json: async () => quotes }) });
    assert.equal((await service.getRates({ now })).date, '2026-09-25');
    quotes[2].date = '2026-09-01';
    const expired = createDisplayCurrencyService({ fetcher: async () => ({ ok: true, json: async () => quotes }) });
    await assert.rejects(expired.getRates({ now }), /Invalid display exchange rates/);
});

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

test('world estimates keep individual dates and discard each duplicate, stale or malformed quote independently', async () => {
    const quote = (quote, rate, date = '2026-09-26', base = 'USD') => ({ base, quote, rate, date });
    const samples = [
        quote('JPY', 145.1), quote('CHF', 0.79, '2026-09-24'), quote('BRL', 4.9, '2026-09-15'),
        quote('CNY', 7.13), quote('CNY', 7.2), quote('CNY', 7.21), quote('GBP', 0), quote('EUR', Infinity),
        quote('INR', 83, '2026-09-28'), quote('USD', 1), quote('AED', 1, '2026-09-26', 'EUR'),
        quote('CAD', '1.34'), quote('AUD', 1.5, '2026-02-30'),
    ];
    const service = createDisplayCurrencyService({ fetcher: async (url, options) => {
        assert.equal(url, 'https://api.frankfurter.dev/v2/rates?base=USD');
        assert.ok(options.signal);
        return { ok: true, json: async () => samples };
    } });
    assert.deepEqual(await service.getWorldRates({ now }), {
        base: 'USD', stale: false, rates: { JPY:145.1, CHF:0.79 }, dates: { JPY:'2026-09-26', CHF:'2026-09-24' },
    });
});

test('coalesced world requests revalidate per-currency cache ages; expired entries never leak on failure', async () => {
    const samples = [
        {base:'USD',quote:'JPY',rate:149,date:'2026-09-26'},
        {base:'USD',quote:'CAD',rate:1.33,date:'2026-09-22'},
    ];
    let calls = 0, online = true;
    const service = createDisplayCurrencyService({ fetcher: async () => {
        calls += 1;
        if (!online) throw new Error('upstream offline');
        return {ok:true,json:async()=>samples};
    } });
    const [a,b] = await Promise.all([service.getWorldRates({now}),service.getWorldRates({now})]);
    assert.deepEqual(a,b); assert.equal(calls,1);
    assert.deepEqual(a.rates,{JPY:149,CAD:1.33});
    online = false;
    const fresh = await service.getWorldRates({now:now+60_000});
    assert.equal(fresh.stale,false); assert.equal(calls,1);
    const stale = await service.getWorldRates({now:now+2*86_400_000});
    assert.equal(calls,2);
    assert.deepEqual(stale,{base:'USD',stale:true,rates:{JPY:149},dates:{JPY:'2026-09-26'}});
    await assert.rejects(service.getWorldRates({now:now+6*86_400_000}));
    online = true;
    assert.deepEqual((await service.getWorldRates({now:now+8*3_600_000})).rates,{JPY:149,CAD:1.33});
});

test('world endpoint selects the world feed and preserves fresh, stale and unavailable response contracts', async context => {
    let mode = 'fresh';
    const service = {
        getRates: async () => ({ date:'2026-09-26',rates:{EUR:0.87},stale:false }),
        getWorldRates: async () => {
            if (mode === 'offline') throw new Error('private source message');
            return {base:'USD',rates:{JPY:145.1},dates:{JPY:'2026-09-24'},stale:mode === 'stale'};
        },
    };
    const app = express().use('/api',createDisplayCurrencyRouter(service));
    const server = await new Promise(resolve => {
        const instance = app.listen(0,'127.0.0.1',()=>resolve(instance));
    });
    context.after(() => new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));
    const url = 'http://127.0.0.1:'+server.address().port+'/api/display-rates';
    const get = () => fetch(url+'?scope=world');
    const fresh = await get();
    assert.equal(fresh.status,200);assert.match(fresh.headers.get('cache-control'), /max-age=900/);
    assert.deepEqual(await fresh.json(),{success:true,base:'USD',rates:{JPY:145.1},dates:{JPY:'2026-09-24'},stale:false});
    mode='stale';
    const stale=await get();
    assert.match(stale.headers.get('cache-control'), /max-age=0/);assert.equal((await stale.json()).stale,true);
    mode='offline';
    const failed=await get();
    assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');
    assert.deepEqual(await failed.json(),{success:false,error:'DISPLAY_RATES_UNAVAILABLE'});
    assert.equal((await (await fetch(url)).json()).rates.EUR,0.87);
});
