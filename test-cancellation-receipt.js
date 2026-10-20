const { test } = require('node:test');
const assert = require('node:assert/strict');
const Cancellation = require('./models/BookingCancellation');
const service = require('./services/cancellationReceiptService');

function fixture() {
    const cancellation = { _id: 'supplier', checkout_attempt_id: 'checkout', state: 'cancelled', request_hash: 'a'.repeat(64),
        customer_refund_amount_minor: 14146, createdAt: new Date('2026-10-20T10:00:00Z') };
    const checkout = { _id: 'checkout', reference: 'booking', partner_order_id: 'supplier', ownerSubject: 'owner', realm: 'sandbox',
        cancellation_request_hash: 'a'.repeat(64), payment_verified_at: new Date(), amount_minor: 14146,
        currency: 'AED', refund_amount_minor: 14146, state: 'refund_unknown', ziina_test: true };
    const booking = { bookingReference: 'booking', supplierReference: 'supplier', ownerSubject: 'owner', realm: 'sandbox',
        status: 'cancelled', provider: 'ratehawk', email: 'guest@example.test', customerName: '<Guest & Name>', hotelName: 'Hotel' };
    return { cancellation, checkout, booking };
}
test('cancellation receipt binds the confirmed cancellation, original charge, owner and authorized refund', () => {
    const f = fixture();
    const details = service.receiptDetails(f.cancellation, f.checkout, f.booking, new Date('2026-10-20T12:00:00Z'));
    assert.equal(details.refund, '141.46'); assert.equal(details.currency, 'AED');
    assert.equal(details.refundStatus, 'pending');
    assert.equal(details.hotelName, '', 'Never invent a hotel name for a generic stored label');
    const html = service.renderReceipt(details);
    assert.match(html, /&lt;Guest &amp; Name&gt;/);
    assert.match(html, /Refund processing|الاسترداد قيد المعالجة/);
    assert.match(html, /does not confirm credit to your card/);
    assert.match(html, /SANDBOX/);
    assert.match(html, /16:00/);
    for (const bookingChange of [{ ownerSubject: 'other' }, { realm: 'production' }, { status: 'active' }, { supplierReference: 'other' }]) {
        assert.throws(() => service.receiptDetails(f.cancellation, f.checkout, { ...f.booking, ...bookingChange }), /binding_invalid/);
    }
    assert.throws(() => service.receiptDetails({ ...f.cancellation, customer_refund_amount_minor: 20000 }, f.checkout, f.booking), /binding_invalid/);
});
test('receipt never claims refund completion before gateway verification, and retains three-decimal currency', () => {
    const f = fixture();
    f.checkout.state = 'refund_completed';
    assert.equal(service.receiptDetails(f.cancellation, f.checkout, f.booking).refundStatus, 'pending');
    f.checkout.refund_verified_at = new Date();
    assert.equal(service.receiptDetails(f.cancellation, f.checkout, f.booking).refundStatus, 'completed');
    f.checkout.currency = 'KWD'; f.checkout.amount_minor = 10000; f.checkout.refund_amount_minor = 7000;
    f.cancellation.customer_refund_amount_minor = 7000;
    const details = service.receiptDetails(f.cancellation, f.checkout, f.booking);
    assert.equal(details.refund, '7.000'); assert.equal(details.fee, '3.000');
});
test('receipt mail claims atomically and never retries an uncertain SMTP outcome', async t => {
    const record = { _id: 'supplier', state: 'cancelled', receipt_status: 'pending' };
    t.mock.method(Cancellation, 'findById', () => ({ lean: async () => ({ ...record }) }));
    t.mock.method(Cancellation, 'findOneAndUpdate', (_filter, update) => ({ lean: async () => {
        if (record.receipt_status !== 'pending') return null;
        Object.assign(record, update.$set); return { ...record };
    } }));
    t.mock.method(Cancellation, 'updateOne', async (_filter, update) => Object.assign(record, update.$set));
    let sends = 0;
    const generate = async () => ({ details: { email: 'guest@example.test' }, buffer: Buffer.from('%PDF-fixture') });
    const send = async () => { sends++; throw new Error('smtp connection closed after delivery'); };
    assert.equal(await service.sendReceipt('supplier', { generate, send }), false);
    assert.equal(record.receipt_status, 'unknown');
    assert.equal(await service.sendReceipt('supplier', { generate, send }), false);
    assert.equal(sends, 1);
    record.receipt_status = 'pending'; sends = 0;
    await Promise.all([service.sendReceipt('supplier', { generate, send: async () => { sends++; return { messageId: 'one' }; } }),
        service.sendReceipt('supplier', { generate, send: async () => { sends++; return { messageId: 'two' }; } })]);
    assert.equal(sends, 1);
    assert.equal(record.receipt_status, 'sent');
});
