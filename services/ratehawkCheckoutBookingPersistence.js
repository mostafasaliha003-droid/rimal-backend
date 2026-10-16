const mongoose = require('mongoose');
const checkout = require('./checkoutProcessService');

async function persistConfirmedCheckout(record, { Model = mongoose.models.Booking } = {}) {
    if (!Model || !record.ownerSubject || !record.realm || !record.partner_order_id || !record.payment_verified_at) {
        throw new Error('confirmed_booking_persistence_unavailable');
    }
    const details = checkout.decryptDetails(record);
    const guest = details.rooms?.[0]?.guests?.[0];
    if (!guest || !details.user?.email) throw new Error('confirmed_booking_guest_unavailable');
    const value = {
        bookingReference: record.reference, ownerSubject: record.ownerSubject, realm: record.realm,
        supplierReference: record.partner_order_id, supplierStatus: 'CONFIRMED', provider: 'ratehawk',
        ziinaPaymentId: record.ziina_intent_id, email: details.user.email, phone: details.user.phone,
        customerName: `${guest.first_name} ${guest.last_name}`, hotelName: details.hotelName,
        roomType: details.roomName, price: record.amount_minor / 100, priceCurrency: record.currency,
        paymentMethod: 'ziina', supplierPaymentType: record.supplier_payment?.type || 'deposit',
        status: 'active', checkInDate: details.checkin, checkOutDate: details.checkout,
        confirmedAt: new Date()
    };
    // Unique bookingReference makes a crash/retry idempotent. Never reactivate
    // an existing cancelled booking or overwrite its original ownership.
    await Model.updateOne({ bookingReference: record.reference }, { $setOnInsert: value }, {
        upsert: true, runValidators: true, writeConcern: { w: 'majority', j: true, wtimeout: 10000 }
    });
    const saved = await Model.findOne({ bookingReference: record.reference }).lean();
    if (!saved || saved.ownerSubject !== record.ownerSubject || saved.realm !== record.realm
        || saved.supplierReference !== record.partner_order_id || saved.provider !== 'ratehawk') {
        throw new Error('confirmed_booking_owner_mismatch');
    }
    return saved;
}

module.exports = { persistConfirmedCheckout };
