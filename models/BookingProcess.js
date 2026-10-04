const mongoose = require('mongoose');

const bookingProcessSchema = new mongoose.Schema({
    _id: String,
    request_hash: { type: String, required: true },
    partner_order_id: { type: String, index: true },
    attempt_order_ids: [String],
    language: String,
    guests: [{ _id: false, adults: Number, children: [Number] }],
    state: {
        type: String,
        required: true,
        enum: ['creating', 'form_ready', 'form_failed', 'card_pending', 'card_ready', 'card_failed', 'card_unknown', 'finishing', 'processing', '3ds', 'confirmed', 'failed', 'expired', 'cancelled']
    },
    form: mongoose.Schema.Types.Mixed,
    form_expires_at: Date,
    card_token: { init_uuid: String, pay_uuid: String },
    card_payment: { type: mongoose.Schema.Types.Mixed },
    finish_hash: String,
    finish_sent_at: Date,
    booking_deadline_at: Date,
    next_check_at: Date,
    check_lease_until: Date,
    check_lease_id: String,
    data_3ds: mongoose.Schema.Types.Mixed,
    error: String
}, { timestamps: true, bufferCommands: false });

bookingProcessSchema.index({ state: 1, next_check_at: 1 });

module.exports = mongoose.models.BookingProcess || mongoose.model('BookingProcess', bookingProcessSchema);