const mongoose = require('mongoose');

const bookingCancellationSchema = new mongoose.Schema({
    _id: String,
    request_hash: { type: String, required: true },
    state: { type: String, required: true, enum: ['cancelling', 'cancel_pending', 'cancelled', 'cancel_failed'] },
    accepted_penalty: mongoose.Schema.Types.Mixed,
    checkout_attempt_id: String,
    customer_refund_amount_minor: Number,
    amount_refunded: mongoose.Schema.Types.Mixed,
    amount_payable: mongoose.Schema.Types.Mixed,
    amount_sell: mongoose.Schema.Types.Mixed,
    upsells_require_manual_cancellation: Boolean,
    action_required: String,
    error: String,
    next_check_at: Date,
    check_lease_id: String,
    check_lease_until: Date
}, { timestamps: true, bufferCommands: false });

bookingCancellationSchema.index({ state: 1, next_check_at: 1 });

module.exports = mongoose.models.BookingCancellation || mongoose.model('BookingCancellation', bookingCancellationSchema);