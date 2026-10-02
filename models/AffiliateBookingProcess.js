const mongoose = require('mongoose');

const affiliateBookingProcessSchema = new mongoose.Schema({
    _id: String,
    reference: { type: String, required: true, unique: true },
    request_hash: { type: String, required: true },
    contract_identity: { type: String, required: true },
    book_hash: { type: String, required: true },
    state: {
        type: String,
        required: true,
        enum: ['creating', 'form_ready', 'finishing', 'processing', 'action_required', 'confirmed', 'failed', 'price_changed', 'expired']
    },
    hotel: { type: mongoose.Schema.Types.Mixed, required: true },
    expected_price: { type: String, required: true },
    expected_currency: { type: String, required: true },
    form: mongoose.Schema.Types.Mixed,
    form_expires_at: Date,
    partner_order_id: String,
    attempt_order_ids: [String],
    encrypted_details: { iv: String, tag: String, ciphertext: String },
    finish_hash: String,
    finish_sent_at: Date,
    booking_deadline_at: Date,
    next_check_at: Date,
    check_lease_until: Date,
    check_lease_id: String,
    lease_until: Date,
    lease_id: String,
    data_3ds: mongoose.Schema.Types.Mixed,
    booking_recorded: { type: Boolean, default: false },
    error: String
}, { timestamps: true, bufferCommands: false });

affiliateBookingProcessSchema.index({ state: 1, next_check_at: 1 });

module.exports = mongoose.models.AffiliateBookingProcess
    || mongoose.model('AffiliateBookingProcess', affiliateBookingProcessSchema);