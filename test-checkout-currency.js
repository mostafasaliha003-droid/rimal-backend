const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./services/checkoutCurrencyService');
const ziina = require('./services/ziinaClient');

test('Ziina currency units preserve three-decimal currencies and reject unsupported precision', () => {
    assert.equal(ziina.minorUnits(101.23, 'AED'), 10123);
    assert.equal(ziina.minorUnits(1.23, 'KWD'), 1230);
    assert.equal(ziina.formatAmountMinor(1230, 'KWD'), '1.230');
    assert.throws(() => ziina.minorUnits(1.234, 'KWD'));
    assert.throws(() => ziina.minorUnits(1.001, 'AED'));
    assert.equal(fx.convertMinor(1234, 'USD', 'KWD', { USD: 1, KWD: 0.1 }), 1230);
    assert.equal(fx.convertMinor(1235, 'USD', 'KWD', { USD: 1, KWD: 0.1 }), 1240);
    assert.equal(fx.convertMinor(2782, 'USD', 'AED', { USD: 1, AED: 3.6725 }), 10217);
    assert.equal(fx.convertMinor(2782, 'USD', 'SAR', { USD: 1, SAR: 3.75 }), 10433);
});

test('financial quotes fail closed for missing, duplicated or expired FX rates', async () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    const row = { base: 'USD', quote: 'KWD', date: '2026-10-20', rate: '0.3068' };
    const request = rows => ({ now, fetcher: async () => ({ ok: true, json: async () => rows }) });
    assert.equal((await fx.liveRates('USD', 'KWD', request([row]))).rates.KWD, '0.3068');
    for (const rows of [[], [row, row], [{ ...row, date: '2026-09-01' }], [{ ...row, rate: 0 }]]) {
        await assert.rejects(fx.liveRates('USD', 'KWD', request(rows)), /checkout_fx_unavailable/);
    }
});

test('display rates and checkout quotes read one table with identical rounding', async () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    const rows = [{ base: 'USD', quote: 'AED', date: '2026-10-20', rate: 3.6725 },
        { base: 'USD', quote: 'KWD', date: '2026-10-20', rate: '0.3068' },
        { base: 'USD', quote: 'EUR', date: '2026-09-01', rate: '0.92' }];
    let urls = [];
    const options = { now, fetcher: async url => { urls.push(url); return { ok: true, json: async () => rows }; } };
    const table = await fx.paymentRates(options);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /quotes=AED,BHD,EUR,GBP,INR,KWD,OMR,QAR,SAR$/);
    assert.deepEqual(table.rates, { USD: '1', AED: '3.6725', KWD: '0.3068' }, 'stale or missing currencies are left out');
    assert.deepEqual(table.currencies.KWD, { decimals: 3, step: 10 });
    assert.equal(table.valid_until, now + 5 * 60 * 1000);
    const quoteRates = await fx.liveRates('USD', 'AED', options);
    assert.equal(fx.convertMinor(158592, 'USD', 'AED', quoteRates.rates), fx.convertMinor(158592, 'USD', 'AED', table.rates));
    await assert.rejects(fx.liveRates('USD', 'EUR', options), /checkout_fx_unavailable/);
});

test('KWD intent and refund transmit integer fils with Ziina-compatible rounding', async () => {
    const fetcher = async (_url, options) => {
        const payload = JSON.parse(options.body);
        assert.equal(payload.amount, 1230);
        assert.equal(payload.currency_code, 'KWD');
        return { ok: true, json: async () => ({ id: 'fixture-intent', account_id: 'fixture-account', operation_id: 'fixture-operation',
            amount: payload.amount, currency_code: 'KWD', tip_amount: 0, allow_tips: false, status: 'pending', redirect_url: 'https://pay.ziina.com/fixture' }) };
    };
    const intent = await ziina.createIntent({ amount: 1.23, currency: 'KWD', reference: 'fixture-reference',
        accountId: 'fixture-account', token: 'fixture-token', test: true, frontendUrl: 'https://example.test', fetcher });
    assert.equal(intent.amount, 1230);
    await ziina.createRefund({ id: 'fixture-refund', intentId: 'fixture-intent', amount: 1.23, currency: 'KWD', test: true,
        token: 'fixture-token', fetcher: async (_url, options) => {
            const p = JSON.parse(options.body); assert.equal(p.amount, 1230);
            return { ok: true, json: async () => ({ id: p.id, payment_intent_id: p.payment_intent_id, amount: p.amount, currency_code: p.currency_code, status: 'pending' }) };
        } });
});
