const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAdminBookingRouter } = require('./services/adminBookingRoutes');

async function withServer(context, router, request) {
    const app = express();
    app.use('/api/admin/data', router);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
    }));
    return request(`http://127.0.0.1:${server.address().port}/api/admin/data`);
}

function adminMiddleware(req, res, next) {
    if (req.get('Authorization') !== 'Bearer fixture-admin-token') return res.status(401).json({ success: false });
    req.auth = { role: 'admin', subject: 'admin-1', realm: 'realm-a' };
    next();
}

test('admin booking data is realm scoped, excludes unowned records, and exposes only its fixed projection', async context => {
    const records = [
        { bookingReference: 'A-1', realm: 'realm-a', email: 'a@example.test', cardToken: 'never', status: 'active', price: 40 },
        { bookingReference: 'B-1', realm: 'realm-b', email: 'b@example.test', cardToken: 'never', status: 'active', price: 90 }
    ];
    const filters = [];
    const BookingModel = {
        async countDocuments(filter) { filters.push(filter); return records.filter(record => record.realm === filter.realm
            && (!filter.status || (Array.isArray(filter.status.$in) ? filter.status.$in.includes(record.status) : record.status === filter.status))).length; },
        async aggregate() { return [{ total: 40 }]; },
        find(filter) {
            filters.push(filter);
            return { sort() { return this; }, limit() { return this; }, select(fields) { this.fields = fields; return this; },
                async lean() { return records.filter(record => record.realm === filter.realm).map(({ cardToken, ...record }) => record); } };
        }
    };
    const router = createAdminBookingRouter({ BookingModel, requireAdmin: adminMiddleware });
    const result = await withServer(context, router, async base => {
        const response = await fetch(base, { headers: { Authorization: 'Bearer fixture-admin-token' } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const data = await response.json();
        assert.deepEqual(data.stats, {
            totalBookings: 1, activeBookings: 1, cancelledBookings: 0, totalRevenueAED: 40
        });
        assert.deepEqual(data.bookings.map(item => item.bookingReference), ['A-1']);
        assert.equal(JSON.stringify(data).includes('cardToken'), false);
        return data;
    });
    assert.equal(result.bookings[0].email, 'a@example.test');
    assert.ok(filters.every(filter => filter.realm === 'realm-a'));

    await withServer(context, router, async base => {
        const response = await fetch(base);
        assert.equal(response.status, 401);
    });
});