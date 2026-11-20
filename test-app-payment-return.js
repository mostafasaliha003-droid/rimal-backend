const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ziina = require('./services/ziinaClient');
const appReturn = require('./services/appPaymentReturn');
const { publicApi } = require('./services/membershipAccessGate');

function fixtureFetcher(calls) {
    return async (url, config) => {
        calls.push(JSON.parse(config.body));
        const payload = calls.at(-1);
        return { ok: true, json: async () => ({ id: 'intent-fixture', account_id: 'fixture-account', operation_id: 'operation-1',
            amount: payload.amount, currency_code: payload.currency_code, tip_amount: 0,
            status: 'requires_payment_instrument', redirect_url: 'https://pay.ziina.com/test' }) };
    };
}

test('app-started payments return to the app page; website payments keep the website return', async () => {
    const calls = [], fetcher = fixtureFetcher(calls);
    const base = { amount: '100', currency: 'AED', reference: crypto.randomUUID(), accountId: 'fixture-account',
        frontendUrl: 'https://rimal-api-staging.onrender.com', test: true, fetcher, token: 'fixture-token' };
    await ziina.createIntent({ ...base, appReturn: 'mkhadda-preview' });
    for (const [field, result] of [['success_url', 'success'], ['cancel_url', 'cancel'], ['failure_url', 'failed']]) {
        const url = new URL(calls[0][field]);
        assert.equal(url.origin + url.pathname, 'https://rimal-api-staging.onrender.com/api/payment/app-return');
        assert.equal(url.searchParams.get('app'), 'mkhadda-preview');
        assert.equal(url.searchParams.get('payment'), result);
        assert.equal(url.searchParams.has('ref'), false);
    }
    await ziina.createIntent(base);
    assert.match(calls[1].success_url, /^https:\/\/rimal-api-staging\.onrender\.com\/checkout\?payment=success&ref=/);
    await assert.rejects(ziina.createIntent({ ...base, appReturn: 'https://example.org' }), /invalid_app_return/);
});

test('only the app schemes are accepted as a return target', () => {
    assert.equal(appReturn.appReturnScheme(undefined), null);
    assert.equal(appReturn.appReturnScheme('mkhadda'), 'mkhadda');
    assert.equal(appReturn.appReturnScheme('mkhadda-preview'), 'mkhadda-preview');
    for (const value of ['javascript', 'https', 'mkhadda://evil', 42, {}]) assert.throws(() => appReturn.appReturnScheme(value), /invalid_app_return/);
});

test('the return page opens the app checkout and nothing else', () => {
    const page = appReturn.renderReturnPage({ app: 'mkhadda-preview', payment: 'success' });
    assert.match(page.html, /href="mkhadda-preview:\/\/checkout"/);
    assert.match(page.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.equal(page.headers['Cache-Control'], 'no-store');
    const script = /<script>([^<]*)<\/script>/.exec(page.html)[1];
    const hash = crypto.createHash('sha256').update(script).digest('base64');
    assert.ok(page.headers['Content-Security-Policy'].includes(`'sha256-${hash}'`));
    for (const app of [undefined, 'evil', ['mkhadda'], 'javascript:alert(1)']) assert.equal(appReturn.renderReturnPage({ app }), null);
    assert.equal(publicApi({ path: '/api/payment/app-return', method: 'GET', query: {} }), true);
    assert.equal(publicApi({ path: '/api/payment/app-return', method: 'POST', query: {} }), false);
});
