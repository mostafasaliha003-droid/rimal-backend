const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createSessionAuthMiddleware } = require('./services/sessionAuthMiddleware');
const { createDeskRouter, rateRows } = require('./services/deskRoutes');
const finance = require('./services/deskFinanceModel');
const { publicApi } = require('./services/membershipAccessGate');

// A tiny in-memory stand-in for the Mongoose calls Desk makes.
function matches(row, filter) {
    return Object.entries(filter).every(([key, condition]) => {
        if (key === '$or') return condition.some(part => matches(row, part));
        const value = row[key];
        if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
            if ('$in' in condition) return condition.$in.includes(value);
            if ('$type' in condition) return condition.$type === 'date' ? value instanceof Date : typeof value === condition.$type;
            if ('$regex' in condition) return new RegExp(condition.$regex, condition.$options).test(String(value ?? ''));
            if ('$gte' in condition || '$lt' in condition) return (!condition.$gte || value >= condition.$gte) && (!condition.$lt || value < condition.$lt);
        }
        return value === condition;
    });
}
function model(rows) {
    const query = list => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => list.map(row => structuredClone(row)) });
    return {
        rows,
        find: filter => query(rows.filter(row => matches(row, filter || {}))),
        findOne: filter => { const one = { select() { return one; }, lean: async () => structuredClone(rows.find(row => matches(row, filter)) || null) }; return one; },
        findById: id => ({ lean: async () => structuredClone(rows.find(row => row._id === id) || null) }),
        create: async doc => { if (rows.some(row => row._id === doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); rows.push(structuredClone(doc)); return doc; },
        updateOne: async (filter, update, options = {}) => {
            let row = rows.find(item => matches(item, filter));
            if (!row && options.upsert) { row = { ...filter }; rows.push(row); }
            if (row) Object.assign(row, update.$set || {});
            return { matchedCount: row ? 1 : 0 };
        },
        findOneAndUpdate: (filter, update) => ({ lean: async () => { const row = rows.find(item => matches(item, filter)); if (!row) return null; Object.assign(row, update.$set); return structuredClone(row); } })
    };
}

async function desk(t, { financialDetails, rates } = {}) {
    process.env.RIMAL_AUTH_REALM = 'sandbox';
    const tokens = new Map();
    let counter = 0;
    const sessions = {
        create: async ({ subject, email, role }) => { const token = String(++counter).padStart(64, 'a'); tokens.set(token, { subject, email, role, realm: 'sandbox', expiresAt: new Date(Date.now() + 3600e3) }); return { token, expiresAt: new Date(Date.now() + 3600e3) }; },
        resolve: async token => tokens.get(token) || null,
        revoke: async token => tokens.delete(token)
    };
    const adminHash = await bcrypt.hash('admin-password-long', 4);
    const Staff = model([{ _id: 'agent@mkhadda.test', name: 'Sara', role: 'agent', passwordHash: await bcrypt.hash('agent-password-long', 4), active: true },
        { _id: 'gone@mkhadda.test', name: 'Gone', role: 'agent', passwordHash: await bcrypt.hash('agent-password-long', 4), active: false }]);
    const created = new Date();
    const Checkout = model([
        { reference: 'MKH-1', state: 'booking_confirmed', payment_verified_at: created, createdAt: created, amount_minor: 100000, currency: 'AED', payment_provider: 'ziina',
            supplier_payment: { type: 'deposit', amount: '200.00', currency_code: 'USD' }, partner_order_id: 'P-1', ziina_test: true,
            payment_quote: { rates: { USD: '1', AED: '3.6725' } }, prebook_snapshot: { hid: 7, room_name: 'Suite', checkin: '2099-01-01', checkout: '2099-01-03',
                cancellation_info: { policies: [{ start_at: null, end_at: '2098-12-30T00:00:00', penalty: { amount: '0.00', currency_code: 'USD' } }] } } },
        { reference: 'MKH-2', state: 'refund_completed', payment_verified_at: created, createdAt: created, amount_minor: 50000, currency: 'AED', payment_provider: 'tabby',
            supplier_payment: { type: 'deposit', amount: '100.00', currency_code: 'USD' }, partner_order_id: 'P-2', cancellation_request_hash: 'h', refund_amount_minor: 50000 },
        { reference: 'MKH-3', state: 'awaiting_payment', createdAt: created, amount_minor: 1000, currency: 'AED' }
    ]);
    const Booking = model([
        { bookingReference: 'MKH-1', hotelName: 'Shore Resort', providerHotelCode: '7', customerName: 'Layla', email: 'layla@example.test', phone: '+9715', status: 'active', supplierStatus: 'CONFIRMED',
            provider: 'ratehawk', supplierReference: 'P-1', confirmedAt: created, createdAt: created, cancellationPolicy: 'Free until 30 Dec' },
        { bookingReference: 'MKH-2', hotelName: 'Shore Resort', providerHotelCode: '7', customerName: 'Omar', status: 'cancelled', createdAt: created }
    ]);
    const Cancellation = model([{ _id: 'P-2', state: 'cancelled', amount_payable: { amount: '0.00', currency_code: 'USD' } }]);
    const Conversation = model([{ _id: 'c'.repeat(64), reference: 'MKH-1', realm: 'sandbox', status: 'open', lastMessage: 'hi' }]);
    const FinanceSetting = model([]);
    let financialCalls = 0;
    const app = express(); app.use(express.json());
    app.use('/desk', createDeskRouter({ sessions, auth: createSessionAuthMiddleware({ sessions, realm: 'sandbox' }), adminEmail: 'boss@mkhadda.test', adminPasswordHash: adminHash,
        comparePassword: bcrypt.compare, hashPassword: password => bcrypt.hash(password, 4), Staff, Booking, Checkout, Cancellation, Conversation, FinanceSetting,
        ratehawk: { retrieveFinancialDetails: async () => { financialCalls++; return financialDetails || { contract: { reporting_currency: 'USD', deposit: '1500.00', credit_limit: '5000.00', max_booking_price: '6100.00', overdue_debt: '0.00', unpaid_orders_sum: '400.00', unpaid_ref_orders_sum: '300.00', unpaid_non_ref_orders_sum: '100.00', contract_overpay: '0.00' }, contract_datas: [] }; },
            getHotelPageRates: async () => [{ hid: 7, rates: rates || [] }], searchLiveRatesByRegion: async () => [] },
        customerPrice: rate => ({ amount: Math.round(Number(rate.payment_options.payment_types[0].amount) * 107) / 100, currency: rate.payment_options.payment_types[0].currency_code }),
        liveRates: async () => ({ rates: { USD: '1', AED: '3.6725' } }), bookingInfo: async () => ({ status: 'completed', isCancellable: true, current_penalty: { amount: '0.00', currency_code: 'USD' } }) }));
    const server = app.listen(0); t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/desk`;
    const call = async (path, { token, method = 'GET', body } = {}) => {
        const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: await response.json() };
    };
    const login = async (email, password) => (await call('/login', { method: 'POST', body: { email, password } })).body;
    return { call, login, Staff, FinanceSetting, financialCalls: () => financialCalls };
}

test('the administrator and active agents sign in; everyone else gets the same refusal', async t => {
    const d = await desk(t);
    const admin = await d.login('boss@mkhadda.test', 'admin-password-long');
    assert.equal(admin.role, 'admin');
    const agent = await d.login('Agent@Mkhadda.test', 'agent-password-long');
    assert.equal(agent.role, 'agent'); assert.equal(agent.name, 'Sara');
    for (const [email, password] of [['boss@mkhadda.test', 'wrong-password'], ['gone@mkhadda.test', 'agent-password-long'], ['nobody@mkhadda.test', 'agent-password-long']]) {
        const response = await d.call('/login', { method: 'POST', body: { email, password } });
        assert.equal(response.status, 401); assert.equal(response.body.error, 'invalid_credentials');
    }
    assert.equal((await d.call('/me', { token: agent.token })).body.name, 'Sara');
});

test('agents work on bookings and chats but never see finance, costs or the team', async t => {
    const d = await desk(t);
    const agent = (await d.login('agent@mkhadda.test', 'agent-password-long')).token;
    for (const path of ['/finance/overview', '/finance/providers', '/suppliers', '/team']) assert.equal((await d.call(path, { token: agent })).status, 401, path);
    assert.equal((await d.call('/rates', { token: agent, method: 'POST', body: {} })).status, 401);
    const list = await d.call('/care/bookings?q=layla', { token: agent });
    assert.deepEqual(list.body.bookings.map(row => row.reference), ['MKH-1']);
    const detail = (await d.call('/care/bookings/MKH-1', { token: agent })).body;
    assert.equal(detail.economics, undefined);
    assert.doesNotMatch(JSON.stringify(detail), /supplier_payment|"cost"|"net"/);
    assert.equal(detail.policy.freeBefore, '2098-12-30T00:00:00');
    assert.equal(detail.live.cancellable, true);
    assert.equal(detail.conversation.id, 'c'.repeat(64));
    assert.deepEqual(detail.timeline.map(row => row.event), ['created', 'paid', 'confirmed']);
    const admin = (await d.login('boss@mkhadda.test', 'admin-password-long')).token;
    assert.equal((await d.call('/care/bookings/MKH-1', { token: admin })).body.economics.reporting.net, 1000 - 200 * 3.6725);
});

test('net per booking is sell − refunds − supplier cost − provider fees, in AED', async t => {
    const d = await desk(t);
    const admin = (await d.login('boss@mkhadda.test', 'admin-password-long')).token;
    let overview = (await d.call('/finance/overview?days=7', { token: admin })).body;
    assert.equal(overview.totals.bookings, 2, 'unpaid attempts are not revenue');
    assert.ok(overview.warnings.includes('fees_not_configured:ziina'));
    assert.equal(overview.totals.sell, 1500); assert.equal(overview.totals.refunds, 500);
    assert.equal(overview.totals.cost, 734.5, 'the cancelled booking costs nothing: the supplier keeps 0');
    // Ziina 2.9% + AED 1 + 5% VAT; Tabby 5%.
    const saved = await d.call('/finance/providers', { token: admin, method: 'PUT', body: { providers: { ziina: { percent: '2.9', fixed: '1', fixedCurrency: 'AED', vatPercent: '5' }, tabby: { percent: '5' } } } });
    assert.equal(saved.body.providers.ziina.configured, true); assert.equal(saved.body.providers.tamara.connected, false);
    overview = (await d.call('/finance/overview?days=7', { token: admin })).body;
    const ziinaFee = (1000 * 0.029 + 1) * 1.05, tabbyFee = 500 * 0.05;
    const first = overview.bookings.find(row => row.reference === 'MKH-1');
    assert.equal(first.reporting.fee, Math.round(ziinaFee * 100) / 100);
    assert.equal(first.reporting.net, Math.round((1000 - 734.5 - ziinaFee) * 100) / 100);
    assert.equal(first.rateSource, 'booking');
    assert.equal(overview.hotels[0].hotel, 'Shore Resort'); assert.equal(overview.hotels[0].count, 2);
    assert.equal(overview.totals.fees, Math.round((ziinaFee + tabbyFee) * 100) / 100);
    for (const bad of [{ ziina: { percent: 'lots' } }, { ziina: { percent: '45' } }, { tabby: { fixedCurrency: 'XYZ' } }, null]) {
        assert.equal((await d.call('/finance/providers', { token: admin, method: 'PUT', body: { providers: bad } })).status, 400);
    }
});

test('supplier balance is read from RateHawk, cached for a minute, and Hotelbeds shows as not connected', async t => {
    const d = await desk(t);
    const admin = (await d.login('boss@mkhadda.test', 'admin-password-long')).token;
    const first = (await d.call('/suppliers', { token: admin })).body;
    assert.deepEqual([first.suppliers[0].deposit, first.suppliers[0].creditLimit, first.suppliers[0].availableForBooking, first.suppliers[0].unpaidOrders], [1500, 5000, 6100, 400]);
    assert.equal(first.suppliers[1].connected, false);
    await d.call('/suppliers', { token: admin });
    assert.equal(d.financialCalls(), 1);
    await d.call('/suppliers?refresh=1', { token: admin });
    assert.equal(d.financialCalls(), 2);
});

test('the cost portal shows the supplier net, our sell price and the margin for each rate', async t => {
    const rate = (amount, room) => ({ room_name: room, meal_data: { value: 'breakfast' }, payment_options: { payment_types: [{ type: 'deposit', amount, currency_code: 'USD',
        cancellation_penalties: { free_cancellation_before: '2099-01-01T00:00:00' } }] } });
    const d = await desk(t, { rates: [rate('120.00', 'Deluxe'), rate('100.00', 'Standard')] });
    const admin = (await d.login('boss@mkhadda.test', 'admin-password-long')).token;
    const result = (await d.call('/rates', { token: admin, method: 'POST', body: { hid: 7, checkin: '2099-02-01', checkout: '2099-02-03', adults: 2 } })).body;
    assert.deepEqual(result.hotels[0].rates.map(row => [row.room, row.net.amount, row.sell.amount, row.margin]), [['Standard', 100, 107, 7], ['Deluxe', 120, 128.4, 8.4]]);
    assert.equal((await d.call('/rates', { token: admin, method: 'POST', body: { hid: 7, checkin: '2099-02-03', checkout: '2099-02-01' } })).status, 400);
    assert.deepEqual(rateRows({ rates: [{ payment_options: { payment_types: [{ type: 'now', amount: '1' }] } }] }, () => null), []);
});

test('the administrator manages agents; weak passwords and duplicates are refused', async t => {
    const d = await desk(t);
    const admin = (await d.login('boss@mkhadda.test', 'admin-password-long')).token;
    assert.equal((await d.call('/team', { token: admin, method: 'POST', body: { email: 'new@mkhadda.test', name: 'Noor', password: 'short' } })).body.error, 'desk_weak_password');
    assert.equal((await d.call('/team', { token: admin, method: 'POST', body: { email: 'new@mkhadda.test', name: 'Noor', password: 'a-long-enough-pass' } })).status, 200);
    assert.equal((await d.call('/team', { token: admin, method: 'POST', body: { email: 'new@mkhadda.test', name: 'Noor', password: 'a-long-enough-pass' } })).status, 409);
    assert.equal((await d.login('new@mkhadda.test', 'a-long-enough-pass')).role, 'agent');
    assert.equal((await d.call('/team/new@mkhadda.test', { token: admin, method: 'PATCH', body: { active: false } })).body.member.active, false);
    assert.equal((await d.call('/login', { method: 'POST', body: { email: 'new@mkhadda.test', password: 'a-long-enough-pass' } })).status, 401);
    assert.equal(d.Staff.rows.find(row => row._id === 'new@mkhadda.test').passwordHash.startsWith('$2'), true, 'passwords are stored hashed');
    assert.equal((await d.call('/team', { token: admin, method: 'POST', body: { email: 'boss@mkhadda.test', name: 'X', password: 'a-long-enough-pass' } })).body.error, 'desk_invalid_email');
});

test('membership gate: Desk sign-in is public and agents reach only Desk', () => {
    assert.equal(publicApi({ path: '/api/v1/desk/login', method: 'POST', query: {} }), true);
    assert.equal(publicApi({ path: '/api/v1/desk/finance/overview', method: 'GET', query: {} }), false);
});

test('fee arithmetic and conversion are exact for the documented inputs', () => {
    const schedule = finance.normalizeSchedule({ percent: '2.9', fixed: '1', fixedCurrency: 'AED', vatPercent: '5' });
    assert.equal(schedule.configured, true);
    assert.equal(finance.feeFor(schedule, 100, 'AED', {}), (2.9 + 1) * 1.05);
    assert.equal(finance.convert(100, 'USD', 'AED', { USD: '1', AED: '3.6725' }), 367.25);
    assert.equal(finance.convert(100, 'EUR', 'AED', { USD: '1', AED: '3.6725' }), null);
    assert.equal(finance.feeFor(finance.normalizeSchedule({}), 100, 'AED', {}), null);
});

test('money owed back to the guest is never counted as profit, even before the refund completes', () => {
    const base = { reference: 'R', amount_minor: 100000, currency: 'AED', supplier_payment: { type: 'deposit', amount: '200.00', currency_code: 'USD' }, partner_order_id: 'P' };
    const failed = finance.economics({ checkout: { ...base, state: 'booking_failed' }, liveRates: { USD: '1', AED: '3.6725' } });
    assert.deepEqual([failed.reporting.refunded, failed.reporting.cost, failed.reporting.net, failed.refundPending], [1000, 0, 0, true]);
    const cancelling = finance.economics({ checkout: { ...base, state: 'refund_pending', cancellation_request_hash: 'h', refund_amount_minor: 80000 },
        cancellation: { amount_payable: { amount: '20.00', currency_code: 'USD' } }, liveRates: { USD: '1', AED: '3.6725' } });
    assert.equal(cancelling.reporting.refunded, 800);
    assert.equal(cancelling.reporting.net, Math.round((1000 - 800 - 20 * 3.6725) * 100) / 100);
    assert.equal(cancelling.refundPending, true);
});

test('crash reports are scrubbed, counted by fingerprint and listed for the administrator only', async t => {
    const { createAppErrorRouters } = require('./services/appErrorRoutes');
    const rows = new Map();
    const AppError = {
        updateOne: async (filter, update) => { const row = rows.get(filter._id) || { _id: filter._id, ...update.$setOnInsert, count: 0 }; Object.assign(row, update.$set); row.count += update.$inc.count; rows.set(filter._id, row); },
        find: () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [...rows.values()] })
    };
    const routers = createAppErrorRouters({ AppError, requireAdmin: (req, res, next) => req.headers.authorization === 'Bearer admin' ? next() : res.sendStatus(401), limiter: (_q, _r, n) => n() });
    const app = express(); app.use('/api/app', routers.app); app.use('/desk', routers.desk);
    const server = app.listen(0); t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    const report = body => fetch(base + '/api/app/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const body = { message: 'Cannot read booking for layla@example.test (+971 50 000 0001)', stack: 'at Checkout (a.js:1)\nat b', version: '0.60.0', platform: 'android', route: '/hotel/10004834', fatal: true };
    assert.equal((await report(body)).status, 202);
    assert.equal((await report(body)).status, 202);
    assert.equal((await report({ message: '' })).status, 400);
    assert.equal(rows.size, 1);
    const [row] = rows.values();
    assert.equal(row.count, 2);
    assert.doesNotMatch(JSON.stringify(row), /layla|971/);
    assert.equal((await fetch(base + '/desk/errors')).status, 401);
    const list = await (await fetch(base + '/desk/errors', { headers: { Authorization: 'Bearer admin' } })).json();
    assert.equal(list.errors[0].count, 2); assert.equal(list.errors[0].platform, 'android');
    assert.equal(publicApi({ path: '/api/app/errors', method: 'POST', query: {} }), true);
});
