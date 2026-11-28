const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createOwnedBookingPdfRouter } = require('./services/ownedBookingPdfRoutes');
const { decryptBookingRecordPayload, encryptBookingRecordPayload } = require('./services/bookingRecordPersistence');
const {
    customerFingerprint,
    hotelbedsVoucherSnapshotMatchesBooking
} = require('./services/hotelbedsVoucherSnapshot');
const { hotelbedsScopeFrom } = require('./services/hotelbedsScope');

const realm = 'voucher-fixture-realm';
const VOUCHER_NOW = new Date('2026-10-07T12:00:00.000Z');
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
    env = VOUCHER_ENV,
    now = () => VOUCHER_NOW
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
        now,
        puppeteer: puppeteerFixture.puppeteer,
        requireUser,
        requireAdmin,
        realm
    });
}

test('confirmed voucher uses the selected language, hotel details and owner scope without embedding transaction or contact data', async context => {
    const record = {
        bookingReference: 'OWNED-CONFIRMED-1',
        ownerSubject: 'owner-1',
        realm,
        status: 'active',
        supplierStatus: 'CONFIRMED',
        supplierReference: 'PARTNER-1',
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
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${record.bookingReference}?language=en`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/pdf');
        assert.equal(response.headers.get('cache-control').includes('no-store'), true);
        assert.equal(await response.text(), '%PDF-fixture');
    });

    assert.deepEqual(filters[0], { bookingReference: record.bookingReference, realm, ownerSubject: 'owner-1' });
    assert.match(puppeteerFixture.state.html, /lang="en" dir="ltr"/);
    assert.match(puppeteerFixture.state.html, /Confirmed/);
    assert.match(puppeteerFixture.state.html, /10 November 2026/);
    assert.match(puppeteerFixture.state.html, /12 November 2026/);
    assert.match(puppeteerFixture.state.html, /Fixture &lt;Hotel&gt;/);
    assert.doesNotMatch(puppeteerFixture.state.html, /495\.25|ada@example|971500000000|DESIGN SAMPLE/);
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

test('owned Hotelbeds PDF rejects stale supplier content without launching a browser', async context => {
    const fixture = confirmedVoucherFixture();
    const puppeteerFixture = createPuppeteerFixture();
    const router = makeRouter(fixture.record, puppeteerFixture, [], {
        ...fixture, now: () => new Date('2026-10-16T12:00:00.000Z')
    });
    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/owned/bookings/pdf/${fixture.record.bookingReference}`);
        assert.equal(response.status, 503);
    });
    assert.equal(puppeteerFixture.state.launches, 0);
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

test('pending, inconsistent and cancelled bookings cannot issue a voucher', async context => {
    for (const [status, supplierStatus] of [['cancelled', 'CONFIRMED'], ['active', 'PENDING'],
        ['pending', 'ON_REQUEST'], ['pending', 'CONFIRMED'], ['active', undefined]]) {
        const record = { bookingReference: 'OWNED-1', ownerSubject: 'owner-1', realm, status, supplierStatus };
        const browser = createPuppeteerFixture();
        await withServer(context, makeRouter(record, browser), async base => {
            for (const format of ['pdf', 'html']) {
                const response = await fetch(base + '/api/owned/bookings/pdf/OWNED-1?format=' + format);
                assert.equal(response.status, 409);
            }
        });
        assert.equal(browser.state.launches, 0);
    }
});

test('approved room list is encrypted, scoped, and unavailable after five days from checkout', async context => {
    const { ratePlan, makeVoucherSnapshot, readVoucherSnapshot } = require('./services/ratehawkStayVoucherSnapshot');
    const details = { hid: 123, checkout: '2026-10-10', roomName: 'Queen', user: { comment: 'Quiet room requested' },
        rooms: [{ guests: [{ first_name: 'آمنة', last_name: 'الحداد' }] },
            { guests: [{ first_name: 'Alexandra', last_name: 'Taylor' }, { first_name: 'Sam', last_name: 'Taylor', is_child: true, age: 7 }] }] };
    const selected = { book_hash: 'p-fixture', amount: 12, currency: 'USD' };
    const data = { hotels: [{ hid: 123, rates: [{ book_hash: 'p-fixture', room_name: 'Queen', meal: 'Breakfast',
        payment_options: { payment_types: [{ type: 'deposit', currency_code: 'USD', amount: '12.00',
            tax_data: { taxes: [{ name: 'City tax', amount: '5', currency_code: 'AED', included_by_supplier: false },
                { name: 'Included VAT', amount: '1', currency_code: 'AED', included_by_supplier: true }] } }] } }] }] };
    const record = { reference: 'OWNED-2', ownerSubject: 'owner-1', realm, partner_order_id: 'PARTNER-2',
        prebook_snapshot: ratePlan(data, details, selected) };
    const booking = { bookingReference: record.reference, supplierReference: record.partner_order_id, realm, ownerSubject: 'owner-1',
        status: 'active', supplierStatus: 'CONFIRMED', provider: 'ratehawk', hotelName: 'Fixture Hotel', customerName: 'آمنة الحداد',
        checkInDate: '2026-10-08', checkOutDate: details.checkout, ...makeVoucherSnapshot(record, details, {}, VOUCHER_ENV) };
    assert.doesNotMatch(JSON.stringify(booking.stayVoucherEncrypted), /Taylor|الحداد/);
    assert.equal(readVoucherSnapshot(booking, new Date('2026-10-15T00:00:00Z'), VOUCHER_ENV), undefined);
    assert.throws(() => readVoucherSnapshot({ ...booking, realm: 'changed' }, VOUCHER_NOW, VOUCHER_ENV), /mismatch/);
    const browser = createPuppeteerFixture();
    await withServer(context, makeRouter(booking, browser), async base => {
        const response = await fetch(base + '/api/owned/bookings/pdf/OWNED-2?format=html&language=ar');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
        const html = await response.text();
        for (const string of ['dir="rtl"', 'الحداد', 'Alexandra Taylor', 'Sam Taylor', 'Quiet room requested', 'City tax', '5 · AED']) {
            assert.ok(html.includes(string), string);
        }
        assert.doesNotMatch(html, /Included VAT|p-fixture/);
    });
    assert.equal(browser.state.launches, 0);
});

test('simultaneous voucher downloads never run two Chromes at once, and all of them succeed', async context => {
    const record = { bookingReference: 'OWNED-QUEUE-1', ownerSubject: 'owner-1', realm, status: 'active', supplierStatus: 'CONFIRMED',
        supplierReference: 'PARTNER-QUEUE-1', hotelName: 'Queue Hotel', customerName: 'Ada Lovelace', roomType: 'Double room',
        price: 100, priceCurrency: 'AED', checkInDate: '2026-11-10', checkOutDate: '2026-11-12' };
    const fixture = createPuppeteerFixture();
    let open = 0, peak = 0;
    const launch = fixture.puppeteer.launch;
    fixture.puppeteer.launch = async () => {
        const browser = await launch();
        open += 1; peak = Math.max(peak, open);
        const page = await browser.newPage();
        const slowPage = { ...page, on: page.on.bind(page), setContent: page.setContent.bind(page),
            async pdf() { await new Promise(resolve => setTimeout(resolve, 40)); return page.pdf(); } };
        return { async newPage() { return slowPage; }, async close() { open -= 1; await browser.close(); } };
    };
    const router = makeRouter(record, fixture);
    await withServer(context, router, async baseUrl => {
        const responses = await Promise.all([1, 2, 3].map(() => fetch(`${baseUrl}/api/owned/bookings/pdf/${record.bookingReference}`)));
        assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
    });
    assert.equal(fixture.state.launches, 3);
    assert.equal(peak, 1, 'one Chrome at a time');
    assert.equal(open, 0, 'every Chrome is closed');
});
