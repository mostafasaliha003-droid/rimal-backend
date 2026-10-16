const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCheckoutReadiness, isCheckoutReady } = require('./services/paymentService');
const { getReleaseReadiness, releaseRevision } = require('./services/releaseReadiness');
const { checkRemote } = require('./scripts/check-readiness');

const sandbox = () => ({
    PAYMENT_ROLLOUT_APPROVED: 'true', PAYMENT_CHECKOUT_ENABLED: 'true', RATEHAWK_BOOKING_ENABLED: 'true',
    ZIINA_REFUNDS_ENABLED: 'true', ZIINA_WEBHOOK_CONFIGURED: 'true',
    MONGO_URI: 'mongodb://127.0.0.1/rimal_sandbox', PAYMENT_SANDBOX_DATABASE: 'rimal_sandbox',
    RATEHAWK_KEY_ID: 'fixture-key-id', RATEHAWK_API_KEY: 'fixture-supplier-secret',
    ZIINA_API_KEY: 'fixture-payment-secret', ZIINA_ACCOUNT_ID: 'fixture-account',
    ZIINA_WEBHOOK_SECRET: 's'.repeat(32), PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
    ZIINA_TEST_MODE: 'true', PAYMENT_SANDBOX_ENABLED: 'true', PAYMENT_ETG_SANDBOX_ISOLATED: 'true',
    RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', FRONTEND_URL: 'https://rimal-api-staging.onrender.com',
    RIMAL_AUTH_REALM: 'fixture-staging', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'fixture-mail-secret'
});

test('readiness identifies missing gates without disclosing configuration values', () => {
    const env = sandbox();
    assert.deepEqual(getCheckoutReadiness(env), { ready: true, mode: 'sandbox', blockers: [] });
    for (const key of ['PAYMENT_CHECKOUT_ENABLED', 'RATEHAWK_API_KEY', 'ZIINA_WEBHOOK_SECRET', 'PAYMENT_BOOKING_ENCRYPTION_KEY']) {
        const broken = { ...env, [key]: '' };
        assert.equal(isCheckoutReady(broken), false);
        const report = getReleaseReadiness({ env: broken, databaseState: 1 });
        assert(report.blockers.includes(key));
        for (const secret of ['fixture-mongo-secret', 'fixture-payment-secret', 'fixture-mail-secret']) {
            assert.equal(JSON.stringify(report).includes(secret), false);
        }
    }
});

test('sandbox cannot target the public frontend or supplier production host', () => {
    assert.equal(isCheckoutReady({ ...sandbox(), FRONTEND_URL: 'https://remalbookings.com' }), false);
    assert.equal(isCheckoutReady({ ...sandbox(), RATEHAWK_BASE_URL: 'https://api.ratehawk.com' }), false);
    assert.equal(isCheckoutReady({ ...sandbox(), FRONTEND_URL: 'https://user:pass@staging.example.test' }), false);
    assert.equal(isCheckoutReady({ ...sandbox(), MONGO_URI: 'mongodb://127.0.0.1/production' }), false);
    assert.equal(isCheckoutReady({ ...sandbox(), PAYMENT_SANDBOX_DATABASE: 'production' }), false);
});

test('checkout availability is distinct from full email, authentication, and database readiness', () => {
    const env = { ...sandbox(), SMTP_PASSWORD: '', RIMAL_AUTH_REALM: '' };
    assert.equal(isCheckoutReady(env), true);
    const report = getReleaseReadiness({ env, databaseState: 0 });
    assert.equal(report.configurationReady, false);
    assert.deepEqual(report.blockers, ['RIMAL_AUTH_REALM', 'SMTP_PASSWORD', 'DATABASE_CONNECTION']);
    assert.equal(report.certification, 'requires_external_verification');
    assert.equal(releaseRevision({ RENDER_GIT_COMMIT: '<untrusted>' }), null);
});

test('remote readiness verifies frontend/backend revisions and refuses arbitrary URLs before fetching', async () => {
    const revision = 'a'.repeat(40);
    const fetcher = async url => ({ ok: true, json: async () => url.endsWith('/health')
        ? { databaseState: 1, revision } : { enabled: true },
        text: async () => `<meta name="remal-revision" content="${revision}">` });
    assert.equal((await checkRemote('https://rimal-api-staging.onrender.com', { fetcher })).matchingRevision, true);
    for (const url of ['https://example.test', 'https://rimal-api-staging.onrender.com/private',
        'https://user:pass@rimal-api-staging.onrender.com']) {
        await assert.rejects(checkRemote(url, { fetcher: () => { throw new Error('must_not_fetch'); } }), /not_allowlisted/);
    }
});
