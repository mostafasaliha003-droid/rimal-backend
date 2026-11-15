const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ratehawk = require('./services/ratehawkService');
const Process = require('./models/BookingProcess');
const Attempts = require('./models/CheckoutAttempt');
const snapshots = require('./services/ratehawkBookingSnapshot');
const history = require('./services/ratehawkOrderHistory');

function connected(context, state = 1) {
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => state });
    context.after(() => descriptor ? Object.defineProperty(mongoose.connection, 'readyState', descriptor)
        : delete mongoose.connection.readyState);
}

test('only trusted server-side history intent reaches order/info, including aliases', async context => {
    context.mock.method(history, 'pendingHistory', async () => null);
    const request = context.mock.method(ratehawk.client, 'orderInfo', async () => ({ ok: true, httpStatus: 200,
        data: { orders: [], current_page_number: 1, total_orders: 0, total_pages: 0, found_orders: 0, found_pages: 0 } }));
    await assert.rejects(ratehawk.retrieveBookings(), /order_history_only/);
    await assert.rejects(ratehawk.retrieveBookings({ purpose: 'history' }, { purpose: 'history' }), /invalid_order_request/);
    assert.equal((await ratehawk.getOrderInfo('fixture-order')).error, 'order_history_only');
    assert.equal((await ratehawk.fetchOrderDetails('fixture-order')).error, 'order_history_only');
    assert.equal(request.mock.callCount(), 0);
    await ratehawk.retrieveBookings({}, { purpose: 'history' });
    assert.equal(request.mock.callCount(), 1);
});

test('raw history and aliases share in-flight/30-second guard without changing final booking state', async context => {
    connected(context);
    let now = 100000;
    context.mock.method(Date, 'now', () => now);
    let process;
    const lookup = context.mock.method(Process, 'findOne', () => ({ lean: async () => process }));
    const updates = context.mock.method(Process, 'updateOne', async () => assert.fail('History cannot change final status'));
    const request = context.mock.method(ratehawk.client, 'orderInfo', async () => ({ ok: true, httpStatus: 200,
        data: { orders: [], current_page_number: 1, total_orders: 0, total_pages: 0, found_orders: 0, found_pages: 0 } }));
    for (const state of ['creating', 'form_ready', 'card_pending', 'card_ready', 'card_unknown', 'finishing', 'processing', '3ds']) {
        process = { state };
        assert.equal((await ratehawk.retrieveBookings({ search: { partner_order_ids: ['fixture-order'] } }, { purpose: 'history' })).pending, true);
    }
    process = { state: 'confirmed' };
    assert.equal((await ratehawk.fetchOrderDetails('fixture-order', { purpose: 'history' })).pending, true);
    process.confirmed_at = new Date(now);
    now += 29999;
    assert.equal((await ratehawk.retrieveBookings({}, { purpose: 'history' })).pending, true);
    assert.equal(request.mock.callCount(), 0);
    now += 1;
    await ratehawk.retrieveBookings({ search: { order_ids: [42] } }, { purpose: 'history' });
    assert.deepEqual(lookup.mock.calls.at(-1).arguments[0].$and, [{ 'form.order_id': { $in: [42] } }]);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(updates.mock.callCount(), 0);
    assert.equal(process.state, 'confirmed');
});

test('history fails closed when the local confirmation guard cannot be checked', async context => {
    connected(context, 0);
    const request = context.mock.method(ratehawk.client, 'orderInfo', async () => assert.fail('No supplier lookup without database'));
    await assert.rejects(ratehawk.retrieveBookings({}, { purpose: 'history' }), /order_history_unavailable/);
    const result = await ratehawk.getOrderInfo('fixture-order', { purpose: 'history' });
    assert.equal(result.httpStatus, 503);
    assert.equal(request.mock.callCount(), 0);
});

function prebook() {
    return { hotels: [{ hid: 123, rates: [{ room_name: 'Supplier double', book_hash: 'private-hash',
        payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD',
            cancellation_penalties: { policies: [
                { start_at: null, end_at: '2099-10-14T12:00:00', amount_charge: '0.00', amount_show: '99.00' },
                { start_at: '2099-10-14T12:00:00', end_at: null, amount_charge: '100.00' }
            ] } }] } }] }] };
}
const details = { hid: 123, roomName: 'Supplier double', checkin: '2099-10-15', checkout: '2099-10-17',
    cancellation_info: { policies: [{ penalty: { amount: '0.00', currency_code: 'AED' } }] }, email: 'private@example.test' };
const selected = { type: 'deposit', amount: '100', currency_code: 'USD' };

test('saved policy comes only from the verified prebook and preserves zero supplier-currency penalties', () => {
    const snapshot = snapshots.createSnapshot(prebook(), details, selected);
    assert.deepEqual(snapshot.cancellation_info.policies[0].penalty, { amount: '0.00', currency_code: 'USD' });
    assert.deepEqual(snapshot.cancellation_info.policies[1].penalty, { amount: '100.00', currency_code: 'USD' });
    assert.doesNotMatch(JSON.stringify(snapshot), /private|amount_show|AED/);
    assert.throws(() => snapshots.createSnapshot(prebook(), details, { ...selected, amount: '99' }), /payment_mismatch/);
    assert.throws(() => snapshots.createSnapshot(prebook(), { ...details, roomName: 'Other' }, selected), /identity_mismatch/);
    const missing = prebook(); delete missing.hotels[0].rates[0].payment_options.payment_types[0].cancellation_penalties.policies[0].amount_charge;
    assert.equal(snapshots.createSnapshot(missing, details, selected).cancellation_info.policies[0].penalty, undefined);
});

test('local booking detail/penalty reads use the persisted prebook at UTC boundaries and never order/info', async context => {
    const payment = require('./services/paymentService');
    context.mock.method(payment, 'supplierIdentity', () => 'fixture-supplier');
    const record = { payment_verified_at: new Date(), supplier_identity: 'fixture-supplier', booking_process_id: 'fixture-process',
        prebook_snapshot: snapshots.createSnapshot(prebook(), details, selected) };
    context.mock.method(Attempts, 'find', () => ({ limit: () => ({ lean: async () => [record] }) }));
    let process = { state: 'confirmed' };
    context.mock.method(Process, 'findOne', () => ({ lean: async () => process }));
    const request = context.mock.method(ratehawk.client, 'orderInfo', async () => assert.fail('Local details cannot request supplier history'));
    let now = Date.parse('2099-10-14T11:59:59.999Z');
    context.mock.method(Date, 'now', () => now);
    const post = require('./services/postBookingService');
    assert.deepEqual((await post.getBookingInfo('fixture-order')).current_penalty, { amount: '0.00', currency_code: 'USD' });
    now += 1;
    assert.deepEqual((await post.getBookingInfo('fixture-order')).current_penalty, { amount: '100.00', currency_code: 'USD' });
    process = { state: 'processing' };
    assert.equal((await post.getBookingInfo('fixture-order')).pending, true);
    process = { state: 'cancelled' };
    assert.equal((await post.getBookingInfo('fixture-order')).status, 'cancelled');
    record.prebook_snapshot = undefined;
    await assert.rejects(post.getBookingInfo('fixture-order'), /local_booking_details_unavailable/);
    assert.equal(request.mock.callCount(), 0);
});
