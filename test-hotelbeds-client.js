const { test } = require('node:test');
const assert = require('node:assert/strict');
const clientModule = require('./services/hotelbedsClient');
const contentClientModule = require('./services/hotelbedsContentClient');
const { createHotelbedsRateLimiter } = require('./services/hotelbedsRateLimiter');

const credentials = {
    HOTELBEDS_ENABLED: 'true',
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_API_KEY: 'fixture-api-key',
    HOTELBEDS_SECRET: 'fixture-secret',
    HOTELBEDS_ACCOUNT_CONFIG: 'fixture-account',
    HOTELBEDS_MTLS_BASE_URL: clientModule.TEST_MTLS_BASE_URL,
    HOTELBEDS_MTLS_CERT_PATH: 'C:\\fixtures\\hotelbeds-client.crt',
    HOTELBEDS_MTLS_KEY_PATH: 'C:\\fixtures\\hotelbeds-client.key',
    HOTELBEDS_RATE_MAX_REQUESTS: '8',
    HOTELBEDS_RATE_WINDOW_MS: '4000',
    HOTELBEDS_DAILY_MAX_REQUESTS: '50',
    HOTELBEDS_DAILY_WINDOW_MS: String(24 * 60 * 60 * 1000)
};

function testClient(options = {}) {
    return clientModule.createHotelbedsClient({
        limiter: { acquire: async () => {} },
        readFileSync: () => Buffer.from('certificate-fixture'),
        agentFactory: () => ({ destroy() {} }),
        ...options
    });
}

test('matches an independent Hotelbeds SHA-256 hexadecimal signature vector', () => {
    assert.equal(clientModule.generateSignature('key', 'secret', 1700000000),
        '278d74471a3b5267e27221967122169ad26fac349e0fb6a94779cdf050a0d038');
    assert.throws(() => clientModule.generateSignature('', 'secret', 1), /hotelbeds_credentials_unavailable/);
    for (const invalid of ['key with space', 'key\tvalue', 'key\nvalue', 'key\0value']) {
        assert.throws(() => clientModule.generateSignature(invalid, 'secret', 1), /hotelbeds_credentials_unavailable/);
        assert.throws(() => clientModule.generateSignature('key', invalid, 1), /hotelbeds_credentials_unavailable/);
    }
});

test('builds the documented authentication headers for GET and JSON POST without Api-version', () => {
    const common = {
        'Api-key': 'key',
        'X-Signature': '278d74471a3b5267e27221967122169ad26fac349e0fb6a94779cdf050a0d038',
        Accept: 'application/json'
    };
    assert.deepEqual(clientModule.buildAuthenticationHeaders({
        apiKey: 'key', secret: 'secret', timestampSeconds: 1700000000, method: 'get'
    }), common);
    assert.deepEqual(clientModule.buildAuthenticationHeaders({
        apiKey: 'key', secret: 'secret', timestampSeconds: 1700000000, method: 'post'
    }), { ...common, 'Accept-Encoding': 'gzip', 'Content-Type': 'application/json' });
    assert.equal(Object.hasOwn(clientModule.buildAuthenticationHeaders({
        apiKey: 'key', secret: 'secret', timestampSeconds: 1700000000, method: 'get'
    }), 'Api-version'), false);
    assert.deepEqual(clientModule.buildAuthenticationHeaders({
        apiKey: 'key', secret: 'secret', timestampSeconds: 1700000000,
        method: 'get', acceptEncoding: 'gzip'
    }), { ...common, 'Accept-Encoding': 'gzip' });
});

test('mTLS agent requires a client certificate and verifies the remote endpoint', () => {
    const agent = clientModule.createMutualTlsAgent({ cert: 'fixture-cert', key: 'fixture-key' });
    assert.equal(agent.options.cert, 'fixture-cert');
    assert.equal(agent.options.key, 'fixture-key');
    assert.equal(agent.options.minVersion, 'TLSv1.2');
    assert.equal(agent.options.rejectUnauthorized, true);
    agent.destroy();
});

test('MongoDB rate limiter fails closed and validates the daily quota cap', async () => {
    const disconnected = createHotelbedsRateLimiter({ database: null });
    await assert.rejects(disconnected.acquire({
        account: 'fixture-account', apiKey: 'fixture-key', environment: 'test',
        maxRequests: 8, windowMs: 4000
    }), /hotelbeds_rate_limiter_unavailable/);
    assert.throws(() => require('./services/hotelbedsRateLimiter')._test.settingsFor({
        maxRequests: 8, windowMs: 4000, dailyMaxRequests: 51
    }), /hotelbeds_daily_quota_exceeds_evaluation_limit/);
    assert.throws(() => require('./services/hotelbedsRateLimiter')._test.settingsFor({
        maxRequests: 8, windowMs: 4000, dailyWindowMs: 1000
    }), /hotelbeds_daily_quota_window_too_short/);
});

test('uses the mTLS Sandbox host, fresh signature, authentication headers, and shared limiter', async () => {
    const calls = [];
    const limiterCalls = [];
    const logs = [];
    let clock = 1000;
    const client = testClient({
        http: { request: async config => { calls.push(config); return { status: 200, data: { hotels: [] } }; } },
        limiter: { acquire: async options => { limiterCalls.push(options); clock = 2500; } },
        env: credentials,
        now: () => clock,
        log: { logEtgExchange: entry => logs.push(entry) }
    });

    const payload = { stay: { checkIn: '2030-01-01', checkOut: '2030-01-02' } };
    const result = await client.availability(payload);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${clientModule.TEST_MTLS_BASE_URL}/hotel-api/1.0/hotels`);
    assert.equal(calls[0].method, 'post');
    assert.equal(calls[0].timeout, 5000);
    assert.deepEqual(calls[0].data, payload);
    assert.equal(calls[0].headers['Api-key'], credentials.HOTELBEDS_API_KEY);
    assert.deepEqual(calls[0].headers, {
        'Api-key': credentials.HOTELBEDS_API_KEY,
        'X-Signature': clientModule.generateSignature(credentials.HOTELBEDS_API_KEY, credentials.HOTELBEDS_SECRET, 2),
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json'
    });
    assert.equal(limiterCalls.length, 1);
    assert.equal(limiterCalls[0].account, 'fixture-account');
    assert.equal(limiterCalls[0].apiKey, credentials.HOTELBEDS_API_KEY);
    assert.equal(limiterCalls[0].maxRequests, '8');
    assert.equal(limiterCalls[0].windowMs, '4000');
    assert.equal(limiterCalls[0].dailyMaxRequests, '50');
    assert.equal(JSON.stringify(logs).includes(credentials.HOTELBEDS_SECRET), false);
});

test('availability allows at most 2,000 hotel IDs and rejects excess before limiter or transport', async () => {
    let limiterCalls = 0;
    let outboundCalls = 0;
    const client = testClient({
        http: { request: async () => { outboundCalls += 1; return { status: 200, data: {} }; } },
        limiter: { acquire: async () => { limiterCalls += 1; } },
        env: credentials
    });

    const atLimit = await client.availability({ hotels: { hotel: Array(2000).fill(1) } });
    assert.equal(atLimit.ok, true);
    assert.equal(limiterCalls, 1);
    assert.equal(outboundCalls, 1);

    await assert.rejects(
        client.availability({ hotels: { hotel: Array(2001).fill(1) } }),
        error => error.code === 'hotelbeds_availability_hotel_limit_exceeded'
            && error.httpStatus === 400 && error.maxHotels === 2000
    );
    assert.equal(limiterCalls, 1);
    assert.equal(outboundCalls, 1);
});

test('mTLS configuration accepts only the documented test host and resolves relative cert paths from the project root', () => {
    const config = clientModule.configurationFrom(credentials, {
        readFileSync: filePath => Buffer.from(filePath.endsWith('.crt') ? 'cert-fixture' : 'key-fixture')
    });
    assert.equal(config.baseUrl, clientModule.TEST_MTLS_BASE_URL);
    assert.equal(config.cert.toString(), 'cert-fixture');
    assert.equal(config.key.toString(), 'key-fixture');
    assert.throws(() => clientModule.configurationFrom({
        ...credentials, HOTELBEDS_MTLS_BASE_URL: 'https://api.test.hotelbeds.com'
    }, { readFileSync: () => Buffer.from('fixture') }), /hotelbeds_mtls_endpoint_invalid/);
    const relative = clientModule.configurationFrom({
        ...credentials,
        HOTELBEDS_MTLS_CERT_PATH: './certs/hotelbeds-mtls.pem',
        HOTELBEDS_MTLS_KEY_PATH: './certs/hotelbeds-mtls.key'
    }, { readFileSync: file => Buffer.from(file.endsWith('.pem') ? 'cert-fixture' : 'key-fixture') });
    assert.equal(relative.cert.toString(), 'cert-fixture');
    assert.equal(relative.key.toString(), 'key-fixture');
    assert.equal(require('node:path').isAbsolute(relative.baseUrl), false);
});

test('mTLS configuration prefers environment PEM contents and expands escaped newlines', () => {
    let fileReads = 0;
    const certContent = '-----BEGIN CERTIFICATE-----\\nfixture-cert\\n-----END CERTIFICATE-----';
    const keyContent = '-----BEGIN PRIVATE KEY-----\\nfixture-key\\n-----END PRIVATE KEY-----';
    const config = clientModule.configurationFrom({
        ...credentials,
        HOTELBEDS_MTLS_CERT_CONTENT: certContent,
        HOTELBEDS_MTLS_KEY_CONTENT: keyContent
    }, { readFileSync: () => { fileReads += 1; throw new Error('file_fallback_not_expected'); } });

    assert.equal(config.cert, certContent.replace(/\\n/g, '\n'));
    assert.equal(config.key, keyContent.replace(/\\n/g, '\n'));
    assert.equal(fileReads, 0);
});

test('mTLS configuration rejects partial environment PEM content without reading files', () => {
    let fileReads = 0;
    assert.throws(() => clientModule.configurationFrom({
        ...credentials,
        HOTELBEDS_MTLS_CERT_CONTENT: '-----BEGIN CERTIFICATE-----\\nfixture-cert',
        HOTELBEDS_MTLS_KEY_CONTENT: ''
    }, { readFileSync: () => { fileReads += 1; return Buffer.from('fixture'); } }),
    error => error.code === 'hotelbeds_mtls_certificate_unavailable');
    assert.equal(fileReads, 0);
});

test('fails closed when disabled, production is requested, or credentials are missing', async () => {
    let outboundCalls = 0;
    const makeClient = env => clientModule.createHotelbedsClient({
        http: { request: async () => { outboundCalls += 1; return { status: 200, data: {} }; } },
        limiter: { acquire: async options => {
            if (!options.maxRequests) throw new Error('invalid_hotelbeds_rate_max_requests');
        } },
        env,
        log: { logEtgExchange() {} }
    });
    await assert.rejects(makeClient({ ...credentials, HOTELBEDS_ENABLED: 'false' }).getStatus(), /hotelbeds_disabled/);
    await assert.rejects(makeClient({ ...credentials, HOTELBEDS_ENV: 'production' }).getStatus(), /hotelbeds_environment_not_supported/);
    await assert.rejects(makeClient({ ...credentials, HOTELBEDS_SECRET: '' }).getStatus(), /hotelbeds_credentials_unavailable/);
    await assert.rejects(makeClient({ ...credentials, HOTELBEDS_MTLS_CERT_PATH: '' }).availability({ stay: {} }), /hotelbeds_mtls_certificate_unavailable/);
    assert.equal(outboundCalls, 0);
});

test('status endpoint uses GET and omits the request body', async () => {
    let captured;
    const client = testClient({
        http: { request: async config => { captured = config; return { status: 200, data: {} }; } },
        limiter: { acquire: async () => {} },
        env: { ...credentials, HOTELBEDS_MTLS_BASE_URL: '', HOTELBEDS_MTLS_CERT_PATH: '', HOTELBEDS_MTLS_KEY_PATH: '' }, now: () => 2000,
        log: { logEtgExchange() {} }
    });
    await client.getStatus();
    assert.equal(captured.method, 'get');
    assert.equal(captured.url, `${clientModule.TEST_BASE_URL}/hotel-api/1.0/status`);
    assert.equal(Object.hasOwn(captured, 'data'), false);
    assert.equal(Object.hasOwn(captured, 'httpsAgent'), false);
    assert.deepEqual(captured.headers, clientModule.buildAuthenticationHeaders({
        apiKey: credentials.HOTELBEDS_API_KEY,
        secret: credentials.HOTELBEDS_SECRET,
        timestampSeconds: 2,
        method: 'get'
    }));
});

test('MongoDB-backed limiter fails closed when the shared store is unavailable', async () => {
    const limiter = createHotelbedsRateLimiter({ database: null });
    const options = { account: 'fixture-account', apiKey: 'fixture-api-key', environment: 'test', maxRequests: '2', windowMs: '4000' };
    await assert.rejects(limiter.acquire(options), /hotelbeds_rate_limiter_unavailable/);
});

test('shared limiter atomically updates the same API-key bucket across internal account labels', async () => {
    const updates = [];
    const Bucket = {
        updateOne: () => ({ exec: async () => ({ acknowledged: true }) }),
        findOneAndUpdate: (filter, pipeline, options) => {
            updates.push({ filter, pipeline, options });
            return { exec: async () => ({ requests: [new Date(10000)] }) };
        }
    };
    const limiter = createHotelbedsRateLimiter({
        Bucket, testOnly: true, ensureDatabaseReady: async () => {}, now: () => 10000
    });
    const base = { apiKey: 'same-hotel-api-key', environment: 'test', maxRequests: 8, windowMs: 4000 };
    await limiter.acquire({ ...base, account: 'internal-account-one' });
    await limiter.acquire({ ...base, account: 'internal-account-two' });

    assert.equal(updates.length, 2);
    assert.equal(updates[0].filter._id, updates[1].filter._id);
    assert.ok(updates[0].filter.$expr);
    assert.ok(Array.isArray(updates[0].pipeline));
    assert.ok(updates[0].pipeline[0].$set.requests.$concatArrays);
    assert.equal(updates[0].options.new, true);
});

test('Hotelbeds client does not call the supplier when the shared limiter rejects', async () => {
    let outboundCalls = 0;
    let limiterCalls = 0;
    const client = testClient({
        http: { request: async () => { outboundCalls += 1; return { status: 200, data: {} }; } },
        limiter: { acquire: async () => {
            limiterCalls += 1;
            throw Object.assign(new Error('hotelbeds_rate_limiter_unavailable'), { code: 'hotelbeds_rate_limiter_unavailable' });
        } },
        env: { ...credentials, HOTELBEDS_RATE_MAX_REQUESTS: '1' },
        log: { logEtgExchange() {} }
    });
    await assert.rejects(client.getStatus(), error => error.code === 'hotelbeds_rate_limiter_unavailable');
    assert.equal(limiterCalls, 1);
    assert.equal(outboundCalls, 0);
});

test('BookingList uses the read-only Hotels GET contract, mTLS, params, and shared booking budget', async () => {
    let captured;
    const limiterCalls = [];
    const client = testClient({
        http: { request: async config => { captured = config; return { status: 200, data: { bookings: [] } }; } },
        limiter: { acquire: async options => limiterCalls.push(options) },
        env: credentials,
        log: { logEtgExchange() {} }
    });
    const query = {
        start: '2026-10-01', end: '2026-10-03', filterType: 'CREATION',
        status: 'ALL', from: 1, to: 25, clientReference: 'RMLTEST00000000001'
    };
    const response = await client.getBookingList(query);
    assert.equal(response.ok, true);
    assert.equal(captured.method, 'get');
    assert.equal(captured.url, `${clientModule.TEST_MTLS_BASE_URL}/hotel-api/1.0/bookings`);
    assert.deepEqual(captured.params, query);
    assert.equal(Object.hasOwn(captured, 'data'), false);
    assert.equal(captured.timeout, 30000);
    assert.equal(limiterCalls.length, 1);
    assert.equal(limiterCalls[0].operation, 'booking');
    assert.equal(clientModule.ENDPOINTS.bookingList.mtls, true);
});

test('BookingList GET transport errors are not retried and are not treated as a negative reconciliation', async () => {
    let calls = 0;
    const client = testClient({
        http: { request: async () => {
            calls += 1;
            throw Object.assign(new Error('fixture transport reset'), { code: 'ECONNRESET' });
        } },
        env: credentials,
        log: { logEtgExchange() {} }
    });
    await assert.rejects(client.getBookingList({
        start: '2026-10-01', end: '2026-10-02', filterType: 'CREATION',
        status: 'ALL', from: 1, to: 25, clientReference: 'RMLTEST00000000001'
    }), error => error.code === 'hotelbeds_request_unavailable');
    assert.equal(calls, 1);
});

test('does not retry requests and sanitizes transport failures', async () => {
    let outboundCalls = 0;
    const logs = [];
    const client = testClient({
        http: { request: async () => { outboundCalls += 1; throw Object.assign(new Error('private detail'), { code: 'ECONNRESET' }); } },
        env: { ...credentials, HOTELBEDS_MTLS_BASE_URL: '', HOTELBEDS_MTLS_CERT_PATH: '', HOTELBEDS_MTLS_KEY_PATH: '' }, now: () => 2000,
        log: { logEtgExchange: entry => logs.push(entry) }
    });
    await assert.rejects(client.getStatus(), error => error.code === 'hotelbeds_request_unavailable');
    assert.equal(outboundCalls, 1);
    assert.equal(JSON.stringify(logs).includes('private detail'), false);
});

test('separate Content API client signs and bounds a static hotel page request', async () => {
    let captured;
    const client = contentClientModule.createHotelbedsContentClient({
        http: { request: async config => { captured = config; return { status: 200, data: { hotels: [] } }; } },
        requestLimiter: { acquire: async options => {
            assert.equal(options.account, credentials.HOTELBEDS_ACCOUNT_CONFIG);
            assert.equal(options.apiKey, credentials.HOTELBEDS_API_KEY);
        } },
        env: { ...credentials, HOTELBEDS_MTLS_BASE_URL: '', HOTELBEDS_MTLS_CERT_PATH: '', HOTELBEDS_MTLS_KEY_PATH: '' },
        now: () => 1700000000000,
        log: { logEtgExchange() {} }
    });

    const result = await client.getHotelsPage({ language: 'eng', from: 1, to: 1000, lastUpdateTime: '2026-09-30' });
    assert.equal(result.ok, true);
    assert.equal(captured.method, 'get');
    assert.equal(captured.url, `https://api.test.hotelbeds.com${contentClientModule.HOTEL_CONTENT_PATH}`);
    assert.deepEqual(captured.params, {
        fields: 'all', language: 'ENG', from: 1, to: 1000, lastUpdateTime: '2026-09-30'
    });
    assert.deepEqual(captured.headers, clientModule.buildAuthenticationHeaders({
        apiKey: credentials.HOTELBEDS_API_KEY,
        secret: credentials.HOTELBEDS_SECRET,
        timestampSeconds: 1700000000,
        method: 'get',
        acceptEncoding: 'gzip'
    }));
    assert.equal(captured.timeout, 60000);
});

test('Content API page builder rejects oversized or invalid pages and impossible dates', () => {
    assert.throws(() => contentClientModule.buildHotelContentQuery({ language: 'en', from: 1, to: 1001 }), /hotelbeds_content_query_invalid/);
    assert.throws(() => contentClientModule.buildHotelContentQuery({ language: 'en', from: 2, to: 1 }), /hotelbeds_content_query_invalid/);
    assert.throws(() => contentClientModule.buildHotelContentQuery({ language: 'en', from: 1, to: 1, lastUpdateTime: '2026-02-30' }), /hotelbeds_content_last_update_invalid/);
});