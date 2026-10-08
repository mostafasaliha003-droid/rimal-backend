const { test } = require('node:test');
const assert = require('node:assert/strict');
const readiness = require('./services/deploymentReadiness');

const validBaseEnv = Object.freeze({
    MONGO_URI: 'mongodb+srv://user:placeholder@sandbox.example/rimal',
    RIMAL_AUTH_REALM: 'production:primary',
    PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
    RIMAL_INTERNAL_API_KEY: 'internal-fixture-secret-that-is-not-real',
    RATEHAWK_BOOKING_TOKEN: 'different-fixture-secret'
});

const enabledHotelbedsEnv = Object.freeze({
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_API_KEY: 'hotelbeds-fixture-api-key',
    HOTELBEDS_SECRET: 'hotelbeds-fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'fixture-account',
    HOTELBEDS_MTLS_BASE_URL: 'https://api-mtls.test.hotelbeds.com',
    HOTELBEDS_MTLS_CERT_CONTENT: 'certificate-fixture-material',
    HOTELBEDS_MTLS_KEY_CONTENT: 'private-key-fixture-material',
    HOTELBEDS_RATE_MAX_REQUESTS: '8',
    HOTELBEDS_RATE_WINDOW_MS: '4000',
    HOTELBEDS_DAILY_MAX_REQUESTS: '50',
    HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
    HOTELBEDS_MOCK_MONGO_URI: 'mongodb://user:fixture@db.example/rimal_hotelbeds_mock',
    MONGO_URI: 'mongodb://user:fixture@db.example/rimal',
    HOTELBEDS_DAILY_BUDGETS: '{"status":2,"availability":20,"checkrates":10,"booking":10,"contentsync":8}',
    HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
    HOTELBEDS_PILOT_APPROVED: 'true',
    HOTELBEDS_PILOT_HOTEL_CODES: '74001',
    HOTELBEDS_PILOT_LANGUAGE: 'ENG',
    HOTELBEDS_PILOT_PRICE_POLICY: 'supplier-raw-internal-only',
    HOTELBEDS_PILOT_OPERATOR_KEY: 'operator-fixture-secret-with-32-characters'
});

const enabledMockCheckoutEnv = Object.freeze({
    ...validBaseEnv,
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    MULTI_SUPPLIER_MOCK_SEARCH_ENABLED: 'true',
    HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
    HOTELBEDS_PREPAID_CHECKOUT_ENABLED: 'true',
    HOTELBEDS_PREPAID_CHECKOUT_APPROVED: 'true',
    HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED: 'true',
    HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED: 'true',
    ZIINA_MOCK_WEBHOOK_SECRET: 'mock-webhook-fixture-secret-32-characters-min'
});

function collectStrings(value, results = []) {
    if (typeof value === 'string') results.push(value);
    else if (Array.isArray(value)) value.forEach(item => collectStrings(item, results));
    else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, results));
    return results;
}

test('readiness blocks missing or malformed RIMAL_AUTH_REALM without stopping health startup', () => {
    for (const realm of [undefined, '', ' ', 'realm with spaces', 'x'.repeat(101)]) {
        const env = { ...validBaseEnv };
        if (realm === undefined) delete env.RIMAL_AUTH_REALM;
        else env.RIMAL_AUTH_REALM = realm;

        assert.equal(readiness.checkStartupEnvironment(env).status, 'blocked');
    }
    assert.equal(readiness.checkStartupEnvironment({ ...validBaseEnv, RIMAL_AUTH_REALM: ' production:main ' }).status, 'blocked');
    assert.equal(readiness.checkStartupEnvironment({ ...validBaseEnv, RIMAL_AUTH_REALM: 'production:main' }).status, 'ready');
    assert.equal(readiness.getDeploymentReadiness({}).overallStatus, 'blocked');
});

test('base deployment checks expose names and validation states, never environment values', () => {
    const report = readiness.getDeploymentReadiness({ ...validBaseEnv, ...enabledHotelbedsEnv });
    assert.equal(report.overallStatus, 'application_ready');
    assert.equal(report.application.status, 'ready');
    assert.equal(report.internalApiKey.status, 'configured_unverified');
    assert.equal(report.externalConnectivity, 'not_tested');
    assert.equal(report.certification, 'not_claimed');
    for (const secret of collectStrings({ ...validBaseEnv, ...enabledHotelbedsEnv })) {
        if (secret.length >= 8) assert.equal(JSON.stringify(report).includes(secret), false);
    }
    assert.equal(JSON.stringify(report).includes('fixture-account'), false);
    assert.equal(JSON.stringify(report).includes('placeholder'), false);
});

test('missing and malformed base settings block readiness without echoing values', () => {
    const missing = readiness.getDeploymentReadiness({
        RIMAL_AUTH_REALM: 'production:primary',
        MONGO_URI: 'mongodb://db.example/rimal'
    });
    assert.equal(missing.application.status, 'blocked');
    assert(missing.application.checks.some(item =>
        item.name === 'PAYMENT_BOOKING_ENCRYPTION_KEY' && item.status === 'missing'));

    const invalid = readiness.getDeploymentReadiness({
        ...validBaseEnv,
        RIMAL_AUTH_REALM: 'not valid!'
    });
    assert.equal(invalid.overallStatus, 'blocked');
    assert(invalid.application.checks.some(item => item.status === 'invalid'));
});

test('application readiness does not claim or require Hotelbeds integration readiness', () => {
    const application = readiness.getDeploymentReadiness(validBaseEnv);
    assert.equal(application.overallStatus, 'application_ready');
    assert.equal(application.hotelbeds.status, 'disabled');
    assert.equal(readiness.readinessHttpStatus(application, 'connected'), 200);
    assert.equal(readiness.readinessHttpStatus(application, 'disconnected'), 503);
});

test('Content readiness is independent from the Hotels API mTLS certificate', () => {
    const noCertificate = readiness.checkHotelbedsEnvironment({
        ...enabledHotelbedsEnv,
        HOTELBEDS_MTLS_CERT_CONTENT: '',
        HOTELBEDS_MTLS_KEY_CONTENT: ''
    });
    assert.equal(noCertificate.hotelsApi.status, 'client_configured_unverified');
    assert.equal(noCertificate.hotelsApi.mutualTls, 'missing');
    assert.equal(noCertificate.contentApi.mutualTls, 'not_used_by_current_content_client');
    assert.equal(noCertificate.contentApi.client, 'test_configuration_present_unverified');
});

test('Hotelbeds remains disabled by default and no external readiness is claimed', () => {
    const result = readiness.getDeploymentReadiness(validBaseEnv);
    assert.equal(result.hotelbeds.status, 'disabled');
    assert.equal(result.hotelbeds.pilot.status, 'disabled');
    assert.equal(result.hotelbeds.publicSearch.status, 'disabled');
    assert.equal(result.hotelbeds.booking.status, 'disabled');
    assert.equal(result.hotelbeds.mockCheckout.status, 'disabled');
    assert.equal(result.hotelbeds.cacheApi.status, 'not_implemented_or_configured');
    assert.equal(result.hotelbeds.cdsApi.status, 'not_implemented_or_configured');
    assert.equal(result.externalConnectivity, 'not_tested');
    assert.equal(result.certification, 'not_claimed');
});

test('Hotelbeds TEST readiness remains explicitly unverified and Live stays blocked', () => {
    const test = readiness.checkHotelbedsEnvironment(enabledHotelbedsEnv);
    assert.equal(test.status, 'test_only_unverified');
    assert.equal(test.environment, 'test');
    assert.equal(test.certificate.status, 'configured_unverified');
    assert.equal(test.operationBudgets.status, 'configured_unverified');
    assert.equal(test.pilot.status, 'configured_unverified');
    assert.equal(test.hotelsApi.status, 'client_configured_unverified');

    const live = readiness.checkHotelbedsEnvironment({ ...enabledHotelbedsEnv, HOTELBEDS_ENV: 'live' });
    assert.equal(live.status, 'blocked');
    assert.equal(live.environment, 'unsupported');
    assert.equal(live.hotelsApi.status, 'blocked');
});

test('certificate pairs and request budgets are diagnosed safely', () => {
    const partialCertificate = readiness.checkHotelbedsEnvironment({
        ...enabledHotelbedsEnv,
        HOTELBEDS_MTLS_KEY_CONTENT: ''
    });
    assert.equal(partialCertificate.certificate.status, 'invalid_pair');
    assert.equal(partialCertificate.pilot.status, 'invalid_or_incomplete');
    assert.equal(partialCertificate.hotelsApi.status, 'client_configured_unverified');
    assert.equal(partialCertificate.hotelsApi.mutualTls, 'invalid_pair');

    const invalidBudgets = readiness.checkHotelbedsEnvironment({
        ...enabledHotelbedsEnv,
        HOTELBEDS_DAILY_BUDGETS: '{"availability":40,"booking":20}'
    });
    assert.equal(invalidBudgets.operationBudgets.status, 'exceeds_evaluation_limit');
    const malformedBudgets = readiness.checkHotelbedsEnvironment({
        ...enabledHotelbedsEnv,
        HOTELBEDS_DAILY_BUDGETS: 'not-json'
    });
    assert.equal(malformedBudgets.operationBudgets.status, 'invalid');

    const falseBudgets = readiness.checkHotelbedsEnvironment({
        ...enabledHotelbedsEnv,
        HOTELBEDS_DAILY_BUDGETS: '{"availability":false}'
    });
    assert.equal(falseBudgets.operationBudgets.status, 'invalid');
});

test('pilot gates alone do not claim a public customer-search integration', () => {
    const pilotOnly = readiness.checkHotelbedsEnvironment({
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
        HOTELBEDS_PILOT_APPROVED: 'true'
    });
    assert.equal(pilotOnly.pilot.status, 'invalid_or_incomplete');
    assert.equal(pilotOnly.publicSearch.status, 'disabled');
    assert.equal(pilotOnly.booking.status, 'disabled');
});

test('pilot readiness requires both rollout approvals and an isolated mock database', () => {
    const valid = {
        ...validBaseEnv,
        ...enabledHotelbedsEnv,
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb://user:fixture@db.example/rimal_hotelbeds_mock'
    };
    const approved = readiness.checkHotelbedsEnvironment({
        ...valid,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal'
    });
    assert.equal(approved.pilot.status, 'configured_unverified');
    assert.equal(approved.pilot.database, 'isolated_target_validated_not_connected');

    for (const overrides of [
        { HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'false' },
        { HOTELBEDS_PILOT_APPROVED: 'false' },
        { HOTELBEDS_MOCK_DATABASE_ENABLED: 'false' },
        { MONGO_URI: 'mongodb://user:fixture@db.example/rimal_hotelbeds_mock' }
    ]) {
        const result = readiness.checkHotelbedsEnvironment({
            ...valid,
            MONGO_URI: 'mongodb://user:fixture@db.example/rimal',
            ...overrides
        });
        assert.equal(result.pilot.status, 'invalid_or_incomplete');
    }
});

test('content importer needs explicit approval, operation quota and isolated mock database', () => {
    const base = {
        ...validBaseEnv,
        ...enabledHotelbedsEnv,
        HOTELBEDS_CONTENT_IMPORT_ENABLED: 'true',
        HOTELBEDS_CONTENT_IMPORT_APPROVED: 'true',
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'true',
        HOTELBEDS_MOCK_MONGO_URI: 'mongodb://user:fixture@db.example/rimal_hotelbeds_mock'
    };
    const content = readiness.checkHotelbedsEnvironment({
        ...base,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal'
    });
    assert.equal(content.contentApi.status, 'manual_pilot_sync_configured_unverified');
    assert.equal(content.contentApi.runtimeCaller, 'manual_apply_requires_approval_and_transactions');
    assert.equal(content.contentApi.isolatedDatabase, 'isolated_target_validated_not_connected');
    assert.equal(content.contentApi.rateLimiter, 'configured_unverified');
    assert.equal(readiness.contentPlanningReadiness({
        ...base,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal'
    }).ready, true);

    const missingDatabaseGate = readiness.checkHotelbedsEnvironment({
        ...base,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal',
        HOTELBEDS_MOCK_DATABASE_ENABLED: 'false'
    });
    assert.equal(missingDatabaseGate.contentApi.status, 'blocked_invalid_or_incomplete');

    const sameDatabase = readiness.checkHotelbedsEnvironment({
        ...base,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal_hotelbeds_mock'
    });
    assert.equal(sameDatabase.contentApi.isolatedDatabase, 'invalid_or_not_isolated');
    assert.equal(sameDatabase.contentApi.status, 'blocked_invalid_or_incomplete');

    const invalidRateSettings = readiness.checkHotelbedsEnvironment({
        ...base,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal',
        HOTELBEDS_RATE_WINDOW_MS: '0'
    });
    assert.equal(invalidRateSettings.contentApi.rateLimiter, 'invalid');
    assert.equal(invalidRateSettings.contentApi.status, 'blocked_invalid_or_incomplete');

    const missingContentCredentials = readiness.checkHotelbedsEnvironment({
        ...base,
        MONGO_URI: 'mongodb://user:fixture@db.example/rimal',
        HOTELBEDS_SECRET: ''
    });
    assert.equal(missingContentCredentials.contentApi.status, 'blocked_invalid_or_incomplete');
});

test('mock checkout configuration is identified as mock-only and never a real payment/booking', () => {
    const result = readiness.getDeploymentReadiness(enabledMockCheckoutEnv);
    assert.equal(result.hotelbeds.mockCheckout.status, 'configured_unverified');
    assert.equal(result.hotelbeds.mockCheckout.mode, 'test_only_mock_workflow');
    assert.equal(result.hotelbeds.mockCheckout.externalPayment, 'not_tested');
    assert.equal(result.hotelbeds.mockCheckout.externalSupplierBooking, 'not_tested');
    assert.equal(JSON.stringify(result).includes(enabledMockCheckoutEnv.ZIINA_MOCK_WEBHOOK_SECRET), false);

    const missingMockSecret = readiness.checkHotelbedsEnvironment({
        ...enabledMockCheckoutEnv,
        ZIINA_MOCK_WEBHOOK_SECRET: ''
    });
    assert.equal(missingMockSecret.mockCheckout.status, 'invalid_or_incomplete');
});

test('internal server credential never appears in readiness output', () => {
    const internalKey = 'startup-readiness-internal-fixture-key';
    const report = readiness.getDeploymentReadiness({
        ...validBaseEnv,
        RIMAL_INTERNAL_API_KEY: internalKey
    });
    assert.equal(report.internalApiKey.status, 'configured_unverified');
    assert.equal(JSON.stringify(report).includes(internalKey), false);
});