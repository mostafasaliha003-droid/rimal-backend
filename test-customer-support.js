const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createCustomerSupportRouters } = require('./services/customerSupportRoutes');

function model(seed = []) {
    const rows = structuredClone(seed);
    const value = (row, expression) => typeof expression === 'string' && expression.startsWith('$') ? row[expression.slice(1)]
        : expression?.$ifNull ? value(row, expression.$ifNull[0]) ?? value(row, expression.$ifNull[1]) : expression;
    const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
        if (key === '$or') return value.some(option => matches(row, option));
        if (key === '$expr') return evalExpression(row, value);
        if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, operand]) =>
            op === '$type' ? operand === 'date' ? row[key] instanceof Date : typeof row[key] === operand : op === '$lt' ? row[key] < operand : op === '$lte' ? row[key] <= operand
                : op === '$in' ? operand.includes(row[key] ?? null) : op === '$regex' ? new RegExp(operand, value.$options).test(row[key] || '') : op === '$options');
        return value instanceof Date ? +row[key] === +value : row[key] === value;
    });
    const evalExpression = (row, expression) => expression.$gt && value(row, expression.$gt[0]) > value(row, expression.$gt[1]);
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
    const BookingModel = model([{ bookingReference: 'owned-booking', ownerSubject: 'customer', realm: 'sandbox', hotelName: 'Actual Hotel', customerName: 'Guest', email: 'booking@example.test', phone: '+971500000002', provider: 'ratehawk', supplierReference: 'supplier-1', supplierStatus: 'CONFIRMED', status: 'active', price: 100, priceCurrency: 'AED' },
        { bookingReference: 'foreign-booking', ownerSubject: 'other', realm: 'sandbox', status: 'active' }]);
    const CheckoutModel = model([{ reference: 'owned-payment', ownerSubject: 'customer', realm: 'sandbox', ziina_intent_id: 'recorded-intent', payment_verified_at: new Date(), state: 'booking_pending', amount_minor: 10000, currency: 'AED' },
        { reference: 'unpaid-intent', ownerSubject: 'customer', realm: 'sandbox', ziina_intent_id: 'unpaid-intent', state: 'awaiting_payment' },
        { reference: 'unstarted', ownerSubject: 'customer', realm: 'sandbox', state: 'preparing' }]);
    const Conversation = model(), Message = model();
    const UserModel = model([{ _id: 'customer', name: 'Registered Guest', email: 'registered@example.test', phone: '+971500000001' }]);
    const auth = role => (req, res, next) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const identities = { customer: { subject: 'customer', realm: 'sandbox', role: 'user' }, other: { subject: 'other', realm: 'sandbox', role: 'user' },
            admin: { subject: 'staff', realm: 'sandbox', role: 'admin' }, foreignAdmin: { subject: 'staff', realm: 'production', role: 'admin' } };
        if (identities[token]?.role !== role) return res.sendStatus(401);
        req.auth = identities[token]; next();
    };
    const routers = createCustomerSupportRouters({ BookingModel, CheckoutModel, UserModel, Conversation, Message,
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
    return { request, open, Conversation, Message, BookingModel, CheckoutModel, UserModel };
}

test('staff see registered contact details, supplier identity and real document availability without leaking them to customers', async t => {
    const s = await fixture(t), conversation = await s.open('owned-booking');
    const staff = (await s.request(`/staff/conversations/${conversation.id}`, { token: 'admin' })).body.context;
    assert.deepEqual(staff.customer, { name: 'Registered Guest', email: 'registered@example.test', phone: '+971500000001', source: 'account' });
    assert.equal(staff.bookingContact.email, 'booking@example.test'); assert.equal(staff.bookingContact.phone, '+971500000002');
    assert.equal(staff.provider, 'ratehawk'); assert.equal(staff.supplierReference, 'supplier-1'); assert.equal(staff.documents.voucher, true);
    const customer = (await s.request(`/customer/conversations/${conversation.id}`)).body.context;
    assert.equal(customer.customer, undefined); assert.equal(customer.provider, undefined); assert.equal(customer.supplierReference, undefined);
    delete s.UserModel.rows[0].phone;
    assert.equal((await s.request(`/staff/conversations/${conversation.id}`, { token: 'admin' })).body.context.customer.phone, null, 'Never label the booking phone as the registered account phone');
    const payment = await s.open('owned-payment');
    assert.equal((await s.request(`/staff/conversations/${payment.id}`, { token: 'admin' })).body.context.documents.voucher, false, 'A verified payment alone is not a confirmed hotel voucher');
});
test('staff search registered and booking contact details, filter assignments and unread cases, and never cross realm boundaries', async t => {
    const s = await fixture(t), conversation = await s.open('owned-booking');
    const list = async query => (await s.request(`/staff/conversations?${query}`, { token: 'admin' })).body;
    for (const query of ['registered@example.test', 'booking@example.test', '+971 50 000 0001', '971500000002']) {
        assert.equal((await list(`q=${encodeURIComponent(query)}`)).conversations[0]?.id, conversation.id);
    }
    assert.equal((await list('inbox=unassigned')).conversations.length, 1);
    assert.equal((await list('inbox=mine')).conversations.length, 0);
    assert.equal((await list('inbox=unread')).conversations.length, 0);
    await s.request(`/customer/conversations/${conversation.id}/messages`, { method: 'POST', body: { body: 'Need assistance', clientId: crypto.randomUUID() } });
    assert.equal((await list('inbox=unread')).conversations.length, 1); assert.equal((await list('')).counts.unread, 1);
    await s.request(`/staff/conversations/${conversation.id}`, { token: 'admin' });
    assert.equal((await list('inbox=unread')).conversations.length, 0); assert.equal((await list('')).counts.unread, 0);
    await s.request(`/staff/conversations/${conversation.id}`, { token: 'admin', method: 'PATCH', body: { assignToMe: true } });
    assert.equal((await list('inbox=mine')).conversations.length, 1); assert.equal((await list('inbox=unassigned')).conversations.length, 0);
    s.UserModel.rows.push({ _id: 'production-owner', email: 'private@production.test', phone: '+966500000000' });
    s.Conversation.rows.push({ _id: 'c'.repeat(64), realm: 'production', ownerSubject: 'production-owner', reference: 'secret-booking', status: 'open' });
    assert.equal((await list('q=private%40production.test')).conversations.length, 0);
    assert.equal((await s.request('/staff/conversations?inbox=invalid', { token: 'admin' })).status, 400);
});
test('staff cancellation PDFs verify conversation realm, booking ownership and generated receipt binding', async t => {
    const s = await fixture(t), conversation = await s.open('owned-booking');
    s.BookingModel.rows[0].status = 'cancelled';
    let receiptOwner = 'customer';
    t.mock.method(require('./services/cancellationReceiptService'), 'generateReceipt', async id => {
        assert.equal(id, 'supplier-1'); return { details: { owner: receiptOwner, realm: 'sandbox', reference: 'owned-booking' }, buffer: Buffer.from('%PDF-1.4 fixture') };
    });
    const good = await s.request(`/staff/conversations/${conversation.id}/cancellation-receipt`, { token: 'admin' });
    assert.equal(good.status, 200); assert.match(good.headers.get('content-type'), /application\/pdf/); assert.match(good.headers.get('cache-control'), /no-store/);
    receiptOwner = 'other';
    assert.equal((await s.request(`/staff/conversations/${conversation.id}/cancellation-receipt`, { token: 'admin' })).status, 404);
    assert.equal((await s.request(`/staff/conversations/${conversation.id}/cancellation-receipt`, { token: 'customer' })).status, 401);
});

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
