const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ziina = require('./services/ziinaClient');

test('creates only validated test intents in supported supplier currencies', async () => {
    const calls = [];
    const fetcher = async (url, config) => {
        calls.push({ url, config });
        const payload = JSON.parse(config.body);
        return { ok: true, json: async () => ({ id: 'intent-fixture', account_id: 'fixture-account', operation_id: 'operation-1',
            amount: payload.amount, currency_code: payload.currency_code, tip_amount: 0,
            status: 'requires_payment_instrument', redirect_url: 'https://pay.ziina.com/test' }) };
    };
    for (const currency of ['AED', 'USD', 'SAR', 'EUR']) {
        const result = await ziina.createIntent({ amount: '10.50', currency, reference: crypto.randomUUID(), accountId: 'fixture-account', frontendUrl: 'https://remalbookings.com', test: true, fetcher, token: 'fixture-token' });
        assert.equal(result.amount, 1050);
        assert.equal(result.currency, currency);
        assert.equal(result.accountId, 'fixture-account');
        assert.equal(result.operationId, 'operation-1');
        assert.equal(result.redirectUrl, 'https://pay.ziina.com/test');
        const call = calls.at(-1);
        assert.equal(call.url, 'https://api-v2.ziina.com/api/payment_intent');
        assert.equal(call.config.redirect, 'error');
        const payload = JSON.parse(call.config.body);
        assert.equal(payload.test, true);
        assert.equal(payload.currency_code, currency);
        assert.equal(payload.amount, 1050);
        assert.equal(payload.allow_tips, false);
        assert.match(payload.success_url, /payment=success&ref=/);
    }
    for (const amount of ['0', '10.555', Infinity]) assert.throws(() => ziina.minorUnits(amount), /invalid_payment_amount/);
    await assert.rejects(ziina.createIntent({ amount: 10, currency: 'GBP', reference: crypto.randomUUID(), fetcher, token: 'fixture-token' }), /invalid_payment_context/);
});

test('does not accept redirects outside Ziina or an intent with changed amount', async () => {
    const options = { amount: 10, currency: 'USD', reference: crypto.randomUUID(), accountId: 'fixture-account', test: true, token: 'fixture-token' };
    const intent = { id: 'i', account_id: 'fixture-account', operation_id: 'operation-1', tip_amount: 0,
        amount: 1000, currency_code: 'USD', status: 'pending', redirect_url: 'https://example.org/steal' };
    const fetcher = async () => ({ ok: true, json: async () => intent });
    await assert.rejects(ziina.createIntent({ ...options, fetcher }), /invalid_ziina_redirect/);
    await assert.rejects(ziina.createIntent({ ...options, fetcher: async () => ({ ok: true, json: async () => ({ ...intent, amount: 999 }) }) }), /invalid_ziina_intent/);
});

test('reads status and refunds by immutable IDs and validates amount and currency', async () => {
    const intent = { id: 'payment-1', account_id: 'fixture-account', operation_id: 'operation-1', tip_amount: 0,
        amount: 2345, currency_code: 'EUR', status: 'completed' };
    const refund = { id: 'refund-1', payment_intent_id: 'payment-1', amount: 2345, currency_code: 'EUR', status: 'pending' };
    const fetcher = async url => ({ ok: true, json: async () => url.endsWith('/refund/refund-1') ? refund : intent });
    assert.equal((await ziina.getIntent('payment-1', { fetcher, token: 'fixture-token' })).status, 'completed');
    assert.equal((await ziina.getRefund('refund-1', { fetcher, token: 'fixture-token' })).status, 'pending');
    assert.throws(() => ziina.validateIntent(intent, { id: 'payment-1', amount: 2345, currency: 'USD' }), /invalid_ziina_intent/);
    for (const changed of [{ account_id: 'other' }, { operation_id: 'other' }, { tip_amount: 1 }, { test: false }]) {
        assert.throws(() => ziina.validateIntent({ ...intent, ...changed }, {
            accountId: 'fixture-account', operationId: 'operation-1', test: true
        }), /invalid_ziina_intent/);
    }
    assert.throws(() => ziina.validateRefund(refund, { intentId: 'wrong' }), /invalid_ziina_refund/);
    await assert.rejects(ziina.createRefund({ id: 'refund-1', intentId: 'payment-1', amount: '23.45', currency: 'EUR', test: true, token: 'fixture-token',
        fetcher: async (url, config) => {
            assert.equal(JSON.parse(config.body).test, true);
            return { ok: true, json: async () => ({ ...refund, amount: 2 }) };
        } }), /invalid_ziina_refund/);
});

test('webhook HMAC requires raw body, valid signature and Ziina source address', () => {
    const secret = 's'.repeat(32);
    const raw = Buffer.from('{"event":"payment_intent.status.updated","data":{"id":"i"}}');
    const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    assert.equal(ziina.verifyWebhook(raw, signature, '3.29.184.186', secret), true);
    assert.equal(ziina.verifyWebhook(raw, signature, '192.0.2.1', secret), false);
    assert.equal(ziina.verifyWebhook(Buffer.from('{}'), signature, '3.29.184.186', secret), false);
    assert.equal(ziina.verifyWebhook(raw, 'invalid', '3.29.184.186', secret), false);
});