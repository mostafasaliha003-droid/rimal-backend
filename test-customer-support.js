const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createCustomerSupportRouters } = require('./services/customerSupportRoutes');

function model(seed = []) {
    const rows = structuredClone(seed);
    const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
        if (key === '$or') return value.some(option => matches(row, option));
        if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, operand]) =>
            op === '$type' ? operand === 'date' ? row[key] instanceof Date : typeof row[key] === operand : op === '$lt' ? row[key] < operand : op === '$lte' ? row[key] <= operand
                : op === '$regex' ? new RegExp(operand, value.$options).test(row[key] || '') : op === '$options');
        return value instanceof Date ? +row[key] === +value : row[key] === value;
    });
    const query = (filter, single) => {
        let ordering, count = Infinity;
        return { select() { return this; }, sort(value) { ordering = value; return this; }, limit(value) { count = value; return this; },
            async lean() { let values = rows.filter(row => matches(row, filter));
                if (ordering) values.sort((a, b) => { for (const [key, direction] of Object.entries(ordering)) {
                    if (a[key] < b[key]) return -direction; if (a[key] > b[key]) return direction;
                } return 0; });
                return structuredClone(single ? values[0] || null : values.slice(0, count)); }
        };
    };
    return { rows, findOne: filter => query(filter, true), find: filter => query(filter, false),
        countDocuments: async filter => rows.filter(row => matches(row, filter)).length,
        async create(row) { if (rows.some(existing => existing._id === row._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
            const value = { ...row, createdAt: new Date() }; rows.push(value); return structuredClone(value); },
        async updateOne(filter, update, options = {}) {
            let row = rows.find(value => matches(value, filter));
            if (!row && options.upsert) { row = { ...update.$setOnInsert, status: 'open', priority: 'normal',
                lastMessageAt: new Date(0), lastMessageId: '', createdAt: new Date() }; rows.push(row); }
            if (!row) return { matchedCount: 0 };
            Object.assign(row, update.$set);
            for (const [key, value] of Object.entries(update.$max || {})) if (!row[key] || row[key] < value) row[key] = value;
            if (options.timestamps !== false) row.updatedAt = new Date();
            return { matchedCount: 1 };
        }
    };
}
async function fixture(t) {
    const BookingModel = model([{ bookingReference: 'owned-booking', ownerSubject: 'customer', realm: 'sandbox', hotelName: 'Actual Hotel', customerName: 'Guest', status: 'active', price: 100, priceCurrency: 'AED' },
        { bookingReference: 'foreign-booking', ownerSubject: 'other', realm: 'sandbox', status: 'active' }]);
    const CheckoutModel = model([{ reference: 'owned-payment', ownerSubject: 'customer', realm: 'sandbox', ziina_intent_id: 'recorded-intent', payment_verified_at: new Date(), state: 'booking_pending', amount_minor: 10000, currency: 'AED' },
        { reference: 'unpaid-intent', ownerSubject: 'customer', realm: 'sandbox', ziina_intent_id: 'unpaid-intent', state: 'awaiting_payment' },
        { reference: 'unstarted', ownerSubject: 'customer', realm: 'sandbox', state: 'preparing' }]);
    const Conversation = model(), Message = model();
    const auth = role => (req, res, next) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const identities = { customer: { subject: 'customer', realm: 'sandbox', role: 'user' }, other: { subject: 'other', realm: 'sandbox', role: 'user' },
            admin: { subject: 'staff', realm: 'sandbox', role: 'admin' }, foreignAdmin: { subject: 'staff', realm: 'production', role: 'admin' } };
        if (identities[token]?.role !== role) return res.sendStatus(401);
        req.auth = identities[token]; next();
    };
    const routers = createCustomerSupportRouters({ BookingModel, CheckoutModel, Conversation, Message,
        requireUser: auth('user'), requireAdmin: auth('admin'), env: { RIMAL_AUTH_REALM: 'sandbox' },
        readLimiter: (_req, _res, next) => next(), writeLimiter: (_req, _res, next) => next() });
    const app = express(); app.use(express.json()); app.use('/customer', routers.customer); app.use('/staff', routers.staff);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const request = async (url, { token = 'customer', method = 'GET', body } = {}) => {
        const r = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
    };
    const open = async reference => (await request('/customer/conversations', { method: 'POST', body: { reference } })).body.conversation;
    return { request, open, Conversation, Message };
}

test('chat eligibility requires a real owned booking or recorded payment; knowing a reference grants no access', async t => {
    const s = await fixture(t);
    const allowed = await s.request('/customer/eligibility');
    assert.deepEqual(allowed.body.references.map(row => row.reference).sort(), ['owned-booking', 'owned-payment']);
    assert.match(allowed.headers.get('cache-control'), /no-store/);
    for (const reference of ['foreign-booking', 'unstarted', 'unpaid-intent', 'fabricated']) assert.equal((await s.request('/customer/conversations',
        { method: 'POST', body: { reference, ownerSubject: 'other', realm: 'production' } })).status, 404);
    const booking = await s.open('owned-booking'), payment = await s.open('owned-payment');
    assert(booking.id); assert(payment.id); assert.equal((await s.open('owned-booking')).id, booking.id);
    assert.equal((await s.request(`/customer/conversations/${booking.id}`, { token: 'other' })).status, 404);
    assert.equal((await s.request('/staff/conversations', { token: 'customer' })).status, 401);
    assert.equal((await s.request('/customer/eligibility', { token: 'anonymous' })).status, 401);
    assert.equal((await s.request(`/staff/conversations/${booking.id}`, { token: 'foreignAdmin' })).status, 401);
});
test('messages persist, replay is idempotent, sender cannot be forged, and internal notes never reach customers', async t => {
    const s = await fixture(t), conversation = await s.open('owned-booking');
    const url = `/customer/conversations/${conversation.id}/messages`, clientId = crypto.randomUUID();
    const payload = { body: '<script>visible as plain text</script>', clientId, senderRole: 'admin', kind: 'note' };
    const first = await s.request(url, { method: 'POST', body: payload });
    assert.equal(first.body.message.role, 'user'); assert.equal(first.body.message.kind, 'message');
    const again = await s.request(url, { method: 'POST', body: payload });
    assert.equal(first.body.message.id, again.body.message.id); assert.equal(s.Message.rows.length, 1);
    assert.equal((await s.request(url, { method: 'POST', body: { ...payload, body: 'changed' } })).status, 409);
    await s.request(`/staff/conversations/${conversation.id}/messages`, { token: 'admin', method: 'POST',
        body: { body: 'PRIVATE-TEAM-NOTE', kind: 'note', clientId: crypto.randomUUID() } });
    const customer = await s.request(`/customer/conversations/${conversation.id}`);
    assert.equal(customer.body.messages.length, 1); assert.doesNotMatch(JSON.stringify(customer.body), /PRIVATE-TEAM-NOTE|senderSubject/);
    const staff = await s.request(`/staff/conversations/${conversation.id}`, { token: 'admin' });
    assert.equal(staff.body.messages.length, 2); assert.match(JSON.stringify(staff.body), /PRIVATE-TEAM-NOTE/);
    assert.equal((await s.request(url, { token: 'other', method: 'POST', body: payload })).status, 404);
    assert.equal((await s.request(url, { method: 'POST', body: { body: 'a'.repeat(2001), clientId: crypto.randomUUID() } })).status, 400);
});
test('staff can assign, prioritize and resolve cases with a private audit trail; retrying a delivered message cannot reopen a case', async t => {
    const s = await fixture(t), conversation = await s.open('owned-booking');
    const payload = { body: 'Help with voucher', clientId: crypto.randomUUID() };
    await s.request(`/customer/conversations/${conversation.id}/messages`, { method: 'POST', body: payload });
    const updated = await s.request(`/staff/conversations/${conversation.id}`, { token: 'admin', method: 'PATCH', body: { status: 'resolved', priority: 'high', assignToMe: true } });
    assert.equal(updated.body.conversation.status, 'resolved'); assert.equal(updated.body.conversation.assignedTo, 'staff');
    await s.request(`/customer/conversations/${conversation.id}/messages`, { method: 'POST', body: payload });
    const latest = await s.request(`/customer/conversations/${conversation.id}`);
    assert.equal(latest.body.conversation.status, 'resolved'); assert.equal(latest.body.messages.length, 1);
    assert.equal(latest.body.conversation.assignedTo, undefined);
    assert.equal((await s.request('/staff/conversations?status=resolved&q=Actual', { token: 'admin' })).body.conversations.length, 1);
    assert.equal((await s.request('/staff/conversations?status=invalid', { token: 'admin' })).status, 400);
    assert.equal((await s.request('/staff/conversations?q=.*', { token: 'admin' })).body.conversations.length, 0, 'Search treats user input as literal text');
});

test('history pagination is bounded, scoped to the conversation and does not mark unseen latest messages read', async t => {
    const s = await fixture(t), conversation = await s.open('owned-booking');
    for (let index = 0; index < 105; index++) s.Message.rows.push({ _id: String(index).padStart(64, '0'),
        conversation: conversation.id, realm: 'sandbox', senderRole: 'admin', kind: 'message', body: `Reply ${index}`, createdAt: new Date(1000 + index) });
    const latest = await s.request(`/customer/conversations/${conversation.id}?read=0`);
    assert.equal(latest.body.messages.length, 100); assert.equal(latest.body.hasMore, true);
    assert.equal(s.Conversation.rows[0].customerReadAt, undefined);
    const previous = await s.request(`/customer/conversations/${conversation.id}?before=${latest.body.messages[0].id}`);
    assert.equal(previous.body.messages.length, 5); assert.equal(previous.body.hasMore, false);
    assert.equal(s.Conversation.rows[0].customerReadAt, undefined);
    assert.equal((await s.request(`/customer/conversations/${conversation.id}?before=${'f'.repeat(64)}`)).status, 400);
    assert.equal((await s.request(`/customer/conversations/${conversation.id}?before[$ne]=x`)).status, 400);
});
