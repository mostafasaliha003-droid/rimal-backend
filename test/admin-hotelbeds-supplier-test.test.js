const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createAdminHotelbedsSupplierTestService } = require('../services/adminHotelbedsSupplierTest');
const createAdminHotelbedsSupplierTestController = require('../controllers/adminHotelbedsSupplierTestController');
const createAdminHotelbedsSupplierTestRouter = require('../services/adminHotelbedsSupplierTestRoutes');

const NOW = new Date('2026-10-04T12:00:00.000Z');

function approvedEnv() {
    return {
        HOTELBEDS_ENABLED: 'true',
        HOTELBEDS_ENV: 'test',
        HOTELBEDS_AVAILABILITY_PILOT_ENABLED: 'true',
        HOTELBEDS_PILOT_APPROVED: 'true',
        HOTELBEDS_PILOT_HOTEL_CODES: '74001',
        HOTELBEDS_PILOT_LANGUAGE: 'ENG',
        HOTELBEDS_PILOT_PRICE_POLICY: 'supplier-raw-internal-only',
        HOTELBEDS_PILOT_OPERATOR_KEY: 'private-operator-key-supplier-test-fixture-0123456789',
        HOTELBEDS_DAILY_BUDGETS: JSON.stringify({ availability: 10 }),
        HOTELBEDS_DAILY_MAX_REQUESTS: '20',
        HOTELBEDS_DAILY_WINDOW_MS: String(24 * 60 * 60 * 1000)
    };
}

const REQUEST = Object.freeze({ hotelCode: '74001', checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2 });

function supplierResponse() {
    return {
        pricePolicy: 'supplier-raw-internal-only',
        supplierRequests: 1,
        hotels: [{
            code: 74001,
            name: 'Unverified supplier name must not be returned',
            contentSource: 'hotelbeds_content_api',
            contentHotelCode: 74001,
            contentLanguage: 'ENG',
            contentSyncedAt: '2026-10-03T12:00:00.000Z',
            contentMissing: false,
            content: {
                contentStatus: 'complete',
                name: 'Verified fixture name',
                category: { code: '4EST', name: 'Four stars' },
                description: 'Verified fixture description',
                images: [{ path: 'fixture/hotel.jpg', visualOrder: 0, type: { code: 'GEN' } }]
            },
            rooms: [{ code: 'PRIVATE-ROOM-CODE', rates: [
                { rateKey: 'PRIVATE-RATE-KEY-FIXTURE', net: '123.45', rateCommentsResolved: true },
                { rateKey: 'PRIVATE-SECOND-RATE-KEY', net: '234.56', rateCommentsResolved: false }
            ] }]
        }]
    };
}

async function withServer(t, router, callback) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin/hotelbeds', router);
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.once('error', reject);
    });
    t.after(() => new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())));
    return callback(`http://127.0.0.1:${server.address().port}`);
}

test('admin supplier test only calls allowlisted test Availability and redacts private rates', async () => {
    const requests = [];
    const service = createAdminHotelbedsSupplierTestService({
        env: approvedEnv(),
        now: () => NOW,
        availabilityService: {
            async searchAvailability(criteria) {
                requests.push(criteria);
                return supplierResponse();
            }
        }
    });
    const report = await service.run(REQUEST);
    assert.deepEqual(requests, [{
        checkIn: REQUEST.checkIn,
        checkOut: REQUEST.checkOut,
        hotelCodes: [74001],
        occupancies: [{ rooms: 1, adults: 2, children: 0 }]
    }]);
    assert.deepEqual(service.listHotels(), {
        success: true,
        environment: 'test',
        configured: true,
        hotels: [{ providerHotelId: '74001', label: 'Hotelbeds ID 74001' }]
    });
    assert.equal(report.environment, 'test');
    assert.equal(report.mode, 'availability_only');
    assert.equal(report.checkRateRequests, 0);
    assert.equal(report.bookingRequests, 0);
    assert.equal(report.paymentRequests, 0);
    assert.deepEqual(report.hotels[0], {
        providerHotelId: '74001',
        name: 'Verified fixture name',
        contentVerified: true,
        available: true,
        roomCount: 1,
        rateCount: 2,
        resolvedRateTermsCount: 1,
        unresolvedRateTermsCount: 1
    });
    const serialized = JSON.stringify(report);
    for (const secret of ['PRIVATE-RATE-KEY', '123.45', '234.56', 'PRIVATE-ROOM-CODE',
        'operator-key', 'rateKey', 'net']) {
        assert.equal(serialized.includes(secret), false, `report must not expose ${secret}`);
    }
});

test('supplier test rejects live or missing pilot configuration before Availability', async () => {
    for (const env of [
        { ...approvedEnv(), HOTELBEDS_PILOT_HOTEL_CODES: '' },
        { ...approvedEnv(), HOTELBEDS_PILOT_APPROVED: 'false' },
        { ...approvedEnv(), HOTELBEDS_PILOT_OPERATOR_KEY: '' }
    ]) {
        let calls = 0;
        const service = createAdminHotelbedsSupplierTestService({
            env,
            now: () => NOW,
            availabilityService: { async searchAvailability() { calls += 1; return supplierResponse(); } }
        });
        await assert.rejects(service.run(REQUEST));
        assert.equal(calls, 0);
    }
});

test('supplier test rejects unapproved hotel, malformed input, and out-of-range dates before Availability', async () => {
    let calls = 0;
    const service = createAdminHotelbedsSupplierTestService({
        env: approvedEnv(), now: () => NOW,
        availabilityService: { async searchAvailability() { calls += 1; return supplierResponse(); } }
    });
    for (const input of [
        { ...REQUEST, hotelCode: '999999' },
        { ...REQUEST, checkIn: '2026-10-03' },
        { ...REQUEST, adults: 7 },
        { ...REQUEST, rateKey: 'untrusted' },
        { ...REQUEST, checkOut: '2026-02-30' }
    ]) await assert.rejects(service.run(input));
    assert.equal(calls, 0);
});

test('admin-only HTTP route denies unauthenticated calls, limits search, and never invokes booking or payment', async t => {
    const requests = [];
    let limiterCalls = 0;
    const service = createAdminHotelbedsSupplierTestService({
        env: approvedEnv(), now: () => NOW,
        availabilityService: {
            async searchAvailability(criteria) { requests.push(criteria); return supplierResponse(); }
        }
    });
    const requireAdmin = (req, res, next) => {
        if (req.get('authorization') !== 'Bearer admin-test-token') {
            return res.status(401).json({ success: false, error: 'unauthorized' });
        }
        req.auth = { subject: 'fixture-admin', role: 'admin' };
        return next();
    };
    const router = createAdminHotelbedsSupplierTestRouter({
        controller: createAdminHotelbedsSupplierTestController({ service }),
        requireAdmin,
        searchLimiter: (_req, _res, next) => { limiterCalls += 1; next(); }
    });

    await withServer(t, router, async base => {
        const pilotList = await fetch(`${base}/api/v1/admin/hotelbeds/pilot-list`);
        assert.equal(pilotList.status, 401, 'approved hotel IDs must remain behind the admin session');
        const url = `${base}/api/v1/admin/hotelbeds/supplier-test`;
        const unauthorized = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(REQUEST)
        });
        assert.equal(unauthorized.status, 401);
        assert.equal(requests.length, 0);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-test-token' },
            body: JSON.stringify(REQUEST)
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
        assert.equal((await response.json()).bookingRequests, 0);
        assert.equal(requests.length, 1);
        assert.equal(limiterCalls, 1);
    });
});

test('admin dashboard supplier test never embeds Hotelbeds credentials and displays the search-only form', () => {
    const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
    assert.match(adminHtml, /hotelbedsSupplierTestForm/);
    assert.match(adminHtml, /\/api\/v1\/admin\/hotelbeds\/supplier-test/);
    assert.match(adminHtml, /HOTELBEDS_PILOT_HOTEL_CODES|pilot-list/);
    assert.doesNotMatch(adminHtml, /RIMAL_INTERNAL_API_KEY|HOTELBEDS_API_KEY|HOTELBEDS_SECRET|HOTELBEDS_PILOT_OPERATOR_KEY|x-hotelbeds-operator-key/);
    assert.match(adminHtml, /CheckRate أو حجزًا أو دفعًا/);
});