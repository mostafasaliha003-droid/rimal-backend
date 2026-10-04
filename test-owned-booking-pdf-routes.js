const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { createOwnedBookingPdfRouter } = require('./services/ownedBookingPdfRoutes');

const realm = 'voucher-fixture-realm';

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

function makeRouter(record, puppeteerFixture, lookupFilters = []) {
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
        puppeteer: puppeteerFixture.puppeteer,
        templatePath: path.join(__dirname, 'voucher-template.html'),
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
