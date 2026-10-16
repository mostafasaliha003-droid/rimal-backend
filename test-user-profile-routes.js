const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createUserProfileRouter } = require('./services/userAuthRoutes');

function withServer(context, router, run) {
    const app = express();
    app.use('/api/user', router);
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

test('user profile returns only the authenticated owner’s pending and confirmed bookings', async context => {
    const fixture = {
        bookingReference: 'HBX-PENDING-1',
        ownerSubject: 'owner-1',
        realm: 'realm-a',
        status: 'pending',
        supplierStatus: 'ON_REQUEST',
        provider: 'hotelbeds',
        hotelName: 'Fixture Hotel',
        price: 495.25,
        priceCurrency: 'AED',
        cardNumber: 'must-not-leak'
    };
    const queryLog = [];
    const UserModel = {
        findOne(filter) {
            assert.deepEqual(filter, { _id: 'owner-1', email: 'user@example.test' });
            return { lean: async () => ({ _id: 'owner-1', name: 'Ada Lovelace', email: 'user@example.test' }) };
        }
    };
    const BookingModel = {
        find(filter) {
            queryLog.push({ filter });
            return {
                sort(value) { this.sortValue = value; return this; },
                select(value) { this.selected = value; return this; },
                async lean() { return [fixture]; }
            };
        }
    };
    const auth = { requireRole: role => (req, _res, next) => {
        assert.equal(role, 'user');
        req.auth = { subject: 'owner-1', email: 'user@example.test', realm: 'realm-a' };
        next();
    } };
    const router = createUserProfileRouter({ UserModel, BookingModel, auth });

    await withServer(context, router, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/user/profile`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const result = await response.json();
        assert.deepEqual(result.bookings, [{
            bookingReference: 'HBX-PENDING-1',
            supplierStatus: 'ON_REQUEST',
            provider: 'hotelbeds',
            hotelName: 'Fixture Hotel',
            price: 495.25,
            priceCurrency: 'AED',
            status: 'pending'
        }]);
        assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
    });

    assert.deepEqual(queryLog[0].filter, { ownerSubject: 'owner-1', realm: 'realm-a' });
});
