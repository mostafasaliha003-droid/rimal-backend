const mongoose = require('mongoose');

const checkoutAttemptSchema = new mongoose.Schema({
    _id: String,
    reference: { type: String, required: true, unique: true },
    request_hash: { type: String, required: true, unique: true },
    state: {
        type: String, required: true,
        enum: ['preparing', 'preflight_failed', 'intent_creating', 'intent_unknown', 'awaiting_payment',
            'payment_failed', 'payment_verified', 'booking_pending', 'booking_confirmed', 'booking_failed',
            'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed', 'refund_review', 'manual_review']
    },
    amount_minor: Number,
    currency: String,
    ziina_test: Boolean,
    ziina_intent_id: { type: String, unique: true, sparse: true },
    ziina_account_id: String,
    ziina_operation_id: String,
    payment_verified_at: Date,
    redirect_url: String,
    partner_order_id: String,
    booking_process_id: String,
    supplier_payment: mongoose.Schema.Types.Mixed,
    form_expires_at: Date,
    payment_expires_at: Date,
    encrypted_details: { iv: String, tag: String, ciphertext: String },
    refund_id: { type: String, unique: true, sparse: true },
    refund_status: String,
    refund_sent_at: Date,
    refund_verified_at: Date,
    next_check_at: Date,
    lease_id: String,
    lease_until: Date,
    error: String,
    action_required: String
}, { timestamps: true, bufferCommands: false });

checkoutAttemptSchema.index({ state: 1, next_check_at: 1 });

module.exports = mongoose.models.CheckoutAttempt || mongoose.model('CheckoutAttempt', checkoutAttemptSchema);