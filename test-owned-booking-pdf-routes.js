const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { createOwnedBookingPdfRouter } = require('./services/ownedBookingPdfRoutes');
const { decryptBookingRecordPayload, encryptBookingRecordPayload } = require('./services/bookingRecordPersistence');
const {
    customerFingerprint,
    hotelbedsVoucherSnapshotMatchesBooking
} = require('./services/hotelbedsVoucherSnapshot');
const { hotelbedsScopeFrom } = require('./services/hotelbedsScope');

const realm = 'voucher-fixture-realm';
const VOUCHER_ENV = {
    RIMAL_AUTH_REALM: realm,
    HOTELBEDS_ENV: 'test',
    HOTELBEDS_ACCOUNT_CONFIG: 'voucher-route-test-account',
    PAYMENT_BOOKING_ENCRYPTION_KEY: 'ef'.repeat(32)
};
const voucherScope = hotelbedsScopeFrom(VOUCHER_ENV);

function requireUser(req, _res, next) {
    req.auth = { subject: 'owner-1', realm, role: 'user' };
    next();
}

function requireAdmin(req, _res, next) {
    req.auth = { subject: 'admin-1', realm, role: 'admin' };
    next();
}

function createPuppeteerFixture() {
    const state = { html: '', intercepted: 0, closed: 0, launches: 0 };
    const page = {
        requestHandler: null,
        async setRequestInterception(value) { assert.equal(value, true); },
        on(event, handler) { if (event === 'request') this.requestHandler = handler; },
        async setContent(html) {
            state.html = html;
            this.requestHandler?.({ abort: async () => { state.intercepted += 1; } });
        },
        async pdf() { return Buffer.from('%PDF-fixture'); }
    };
    return {
        state,
        puppeteer: {
            async launch() {
                state.launches += 1;
                return { async newPage() { return page; }, async close() { state.closed += 1; } };
            },
            executablePath() { return 'fixture'; }
        }
    };
}

async function withServer(context, router, run) {
    const app = express();
    app.use('/api/owned', router);
    const server = http.createServer(app);
    context.after(() => new Promise(resolve => server.close(() => resolve())));
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', async () => {
            try {
                resolve(await run(`http://127.0.0.1:${server.address().port}`));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function makeRouter(record, puppeteerFixture, lookupFilters = [], {
    HotelbedsContentModel,
    hotelbedsDatabase,
    env = VOUCHER_ENV
} = {}) {
    const BookingModel = {
        findOne(filter) {
            lookupFilters.push(filter);
            return { lean: async () => record && record.bookingReference === filter.bookingReference
                && record.realm === filter.realm
                && (!filter.ownerSubject || record.ownerSubject === filter.ownerSubject) ? record : null };
        }
    };
    return createOwnedBookingPdfRouter({
        BookingModel,
        HotelbedsContentModel,
        hotelbedsDatabase,
        env,
        puppeteer: puppeteerFixture.puppeteer,
        templatePath: path.join(__dirname, 'voucher-template.html'),
        hotelbedsTemplatePath: path.join(__dirname, 'hotelbeds-voucher-template.html'),
        requireUser,
        requireAdmin,
        realm,
        sanitizeText: value => String(value || 'N/A').replace(/[<>]/g, '')
    });
}

test('owned booking voucher renders exact status, currency and stay dates without external page requests', async context => {
    const record = {
        bookingReference: 'HBX-PENDING-1',
        ownerSubject: 'owner-1',
        realm,
        status: 'pending',
        supplierStatus: 'ON_REQUEST',
        supplierPaymentType: 'AT_HOTEL',
        paymentMethod: 'hotel',
        hotelName: 'Fixture <Hotel>',
        customerName: 'Ada Lovelace',
        email: 'ada@example.test',
        phone: '+971500000000',
        roomType: 'Double room',
        boardType: 'Breakfast',
        price: 495.25,
        priceCurrency: 'AED',
        checkInDate: '2026-11-10',
        checkOutDate: '2026-11-12',
        cancellationPolicy: 'Supplier terms apply'
    };
    const puppeteerFixture = createPuppeteerFixture();
    const filters = [];
    const router = makeRouter(record, puppeteerFixture, filters);

    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${record.bookingReference}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/pdf');
        assert.equal(response.headers.get('cache-control').includes('no-store'), true);
        assert.equal(await response.text(), '%PDF-fixture');
    });

    assert.deepEqual(filters[0], { bookingReference: record.bookingReference, realm, ownerSubject: 'owner-1' });
    assert.match(puppeteerFixture.state.html, /بانتظار تأكيد الفندق — غير مؤكّد بعد/);
    assert.match(puppeteerFixture.state.html, /السعر المحجوز — الدفع عند الوصول إلى الفندق/);
    assert.match(puppeteerFixture.state.html, /495\.25 AED/);
    assert.match(puppeteerFixture.state.html, /تاريخ الوصول: 2026-11-10/);
    assert.match(puppeteerFixture.state.html, /تاريخ المغادرة: 2026-11-12/);
    assert.match(puppeteerFixture.state.html, /Fixture Hotel/);
    assert.doesNotMatch(puppeteerFixture.state.html, /\{\{[A-Za-z][A-Za-z0-9]*\}\}/);
    assert.equal(puppeteerFixture.state.intercepted, 1);
    assert.equal(puppeteerFixture.state.closed, 1);
});

function confirmedVoucherFixture() {
    const snapshot = {
        version: 1,
        binding: {
            ownerSubject: 'owner-1',
            realm,
            accountId: voucherScope.accountId,
            contentLanguage: 'ENG',
            customerName: 'Ada Lovelace',
            bookingReference: 'HBX-OWNED-1',
            clientReference: 'RMLVOUCHERTEST01',
            hotelCode: 74001,
            customerFingerprint: customerFingerprint('Ada Lovelace')
        },
        confirmation: {
            reference: 'HBX-OWNED-1',
            clientReference: 'RMLVOUCHERTEST01',
            status: 'CONFIRMED',
            holder: { name: 'Ada', surname: 'Lovelace' },
            hotel: {
                code: 74001,
                checkIn: '2026-11-10',
                checkOut: '2026-11-12',
                supplier: { name: 'Fixture Supplier', vatNumber: 'FIXTURE-VAT' },
                rooms: [{
                    name: 'Double Standard',
                    code: 'DBL.ST',
                    paxes: [{ name: 'Ada', surname: 'Lovelace', type: 'AD' }],
                    rates: [{ boardCode: 'BB', boardName: 'Bed and Breakfast',
                        rateComments: ['Fixture check-in condition.'] }]
                }]
            }
        }
    };
    const record = {
        bookingReference: snapshot.binding.bookingReference,
        ownerSubject: 'owner-1',
        realm,
        provider: 'hotelbeds',
        providerHotelCode: '74001',
        bookingClientReference: snapshot.binding.clientReference,
        hotelbedsVoucherSnapshotEncrypted: encryptBookingRecordPayload(snapshot, VOUCHER_ENV),
        hotelbedsVoucherSnapshotProcessed: true,
        customerName: 'Ada Lovelace',
        status: 'active',
        supplierStatus: 'CONFIRMED',
        checkInDate: '2026-11-10',
        checkOutDate: '2026-11-12'
    };
    const content = {
        hotelCode: 74001,
        language: 'ENG',
        source: 'hotelbeds_content_api',
        syncedAt: new Date('2026-10-06T12:00:00.000Z'),
        content: {
            contentStatus: 'complete',
            name: 'Verified Fixture Hotel',
            category: { code: '4EST', name: '4 STARS' },
            address: '1 Verified Road, Dubai',
            phone: '+971-4-555-0100'
        }
    };
    const HotelbedsContentModel = {
        findOne(filter) {
            assert.deepEqual(filter, { hotelCode: 74001, language: 'ENG', source: 'hotelbeds_content_api' });
            return { lean: async () => content };
        }
    };
    return {
        record,
        HotelbedsContentModel,
        hotelbedsDatabase: { async ensureModelConnected() {} }
    };
}

test('owned Hotelbeds PDF uses only a matching encrypted confirmation and verified Hotelbeds content', async context => {
    const fixture = confirmedVoucherFixture();
    const puppeteerFixture = createPuppeteerFixture();
    const router = makeRouter(fixture.record, puppeteerFixture, [], fixture);

    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${fixture.record.bookingReference}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/pdf');
        assert.equal(response.headers.get('cache-control').includes('no-store'), true);
        assert.equal(await response.text(), '%PDF-fixture');
    });

    assert.match(puppeteerFixture.state.html, /Verified Fixture Hotel/);
    assert.match(puppeteerFixture.state.html, /Bed and Breakfast/);
    assert.match(puppeteerFixture.state.html, /Fixture check-in condition\./);
    assert.match(puppeteerFixture.state.html, /FIXTURE-VAT/);
    assert.doesNotMatch(puppeteerFixture.state.html, /\{\{[A-Za-z][A-Za-z0-9]*\}\}/);
    assert.equal(puppeteerFixture.state.launches, 1);
});

test('owned Hotelbeds PDF renders without optional category, phone or agency reference', async context => {
    const fixture = confirmedVoucherFixture();
    const snapshot = decryptBookingRecordPayload(fixture.record.hotelbedsVoucherSnapshotEncrypted, VOUCHER_ENV);
    snapshot.confirmation.hotel.supplier = { name: 'Fixture Supplier', vatNumber: 'FIXTURE-VAT' };
    fixture.record.hotelbedsVoucherSnapshotEncrypted = encryptBookingRecordPayload({
        ...snapshot,
        confirmation: {
            ...snapshot.confirmation,
            hotel: {
                ...snapshot.confirmation.hotel
            }
        }
    }, VOUCHER_ENV);
    const content = fixture.HotelbedsContentModel.findOne;
    fixture.HotelbedsContentModel.findOne = filter => {
        const query = content.call(fixture.HotelbedsContentModel, filter);
        return { lean: async () => {
            const row = await query.lean();
            const content = { ...row.content };
            delete content.category;
            delete content.phone;
            return { ...row, content };
        } };
    };
    const puppeteerFixture = createPuppeteerFixture();
    const router = makeRouter(fixture.record, puppeteerFixture, [], fixture);
    assert.equal(hotelbedsVoucherSnapshotMatchesBooking(snapshot, fixture.record, {
        accountId: voucherScope.accountId
    }), true);
    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${fixture.record.bookingReference}`);
        const body = await response.text();
        assert.equal(response.status, 200, body);
        assert.equal(body, '%PDF-fixture');
    });
    assert.doesNotMatch(puppeteerFixture.state.html, /Category|Telephone/);
    assert.doesNotMatch(puppeteerFixture.state.html, /Agency reference/);
    assert.match(puppeteerFixture.state.html, /Verified Fixture Hotel/);
});

test('owned Hotelbeds PDF rejects a mismatched stay before launching a browser', async context => {
    const fixture = confirmedVoucherFixture();
    fixture.record.checkInDate = '2026-11-11';
    const puppeteerFixture = createPuppeteerFixture();
    const router = makeRouter(fixture.record, puppeteerFixture, [], fixture);

    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${fixture.record.bookingReference}`);
        assert.equal(response.status, 409);
        assert.equal(await response.text(), 'Voucher unavailable');
    });
    assert.equal(puppeteerFixture.state.launches, 0);
});

test('owner mismatch returns not found without launching a browser', async context => {
    const record = { bookingReference: 'HBX-PRIVATE-1', ownerSubject: 'another-owner', realm, status: 'active' };
    const puppeteerFixture = createPuppeteerFixture();
    const router = makeRouter(record, puppeteerFixture);

    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${record.bookingReference}`);
        assert.equal(response.status, 404);
        assert.equal(await response.text(), 'Booking not found');
    });
    assert.equal(puppeteerFixture.state.launches, 0);
});

test('confirmed and cancelled voucher states are never mislabeled', async context => {
    for (const record of [
        { bookingReference: 'HBX-CONFIRMED-1', ownerSubject: 'owner-1', realm, status: 'active', supplierStatus: 'CONFIRMED' },
        { bookingReference: 'HBX-CANCELLED-1', ownerSubject: 'owner-1', realm, status: 'cancelled', supplierStatus: 'CONFIRMED' }
    ]) {
        const puppeteerFixture = createPuppeteerFixture();
        const router = makeRouter(record, puppeteerFixture);
        await withServer(context, router, async baseUrl => {
            const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${record.bookingReference}`);
            assert.equal(response.status, 200);
        });
        assert.match(puppeteerFixture.state.html, record.status === 'active' ? />مؤكد<\/span>/ : />ملغي<\/span>/);
        if (record.status === 'cancelled') assert.doesNotMatch(puppeteerFixture.state.html, />مؤكد<\/span>/);
    }
});
