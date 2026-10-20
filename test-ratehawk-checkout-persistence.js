const { test } = require('node:test');
const assert = require('node:assert/strict');
const checkout = require('./services/checkoutProcessService');
const { persistConfirmedCheckout } = require('./services/ratehawkCheckoutBookingPersistence');

test('confirmed paid bookings persist the authenticated owner and survive retries without reactivating cancellation', async context => {
    let saved;
    context.mock.method(checkout, 'decryptDetails', () => ({
        rooms: [{ guests: [{ first_name: 'Sandbox', last_name: 'Guest' }] }],
        user: { email: 'sandbox@example.test', phone: '+971500000001' },
        hid: 123, hotelName: 'Sandbox Hotel', roomName: 'Double', checkin: '2026-11-10', checkout: '2026-11-12'
    }));
    const Model = {
        async updateOne(filter, update, options) {
            assert.equal(options.writeConcern.w, 'majority');
            saved ||= { ...update.$setOnInsert };
        },
        findOne() { return { lean: async () => saved }; }
    };
    const record = { reference: 'fixture-reference', ownerSubject: 'owner-1', realm: 'sandbox',
        partner_order_id: 'supplier-order', payment_verified_at: new Date(), amount_minor: 10700,
        currency: 'USD', ziina_intent_id: 'test-intent', supplier_payment: { type: 'deposit' } };
    await persistConfirmedCheckout(record, { Model });
    assert.equal(saved.ownerSubject, 'owner-1');
    assert.equal(saved.priceCurrency, 'USD');
    assert.equal(saved.price, 107);
    assert.equal(saved.providerHotelCode, '123');
    saved.status = 'cancelled';
    await persistConfirmedCheckout(record, { Model });
    assert.equal(saved.status, 'cancelled');
    await assert.rejects(persistConfirmedCheckout({ ...record, ownerSubject: 'other-owner' }, { Model }), /owner_mismatch/);
    await assert.rejects(persistConfirmedCheckout({ ...record, ownerSubject: undefined }, { Model }), /persistence_unavailable/);
});
