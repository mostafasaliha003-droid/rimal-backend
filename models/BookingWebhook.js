const mongoose = require('mongoose');

const bookingWebhookSchema = new mongoose.Schema({
    _id: String,
    payload_hash: { type: String, required: true },
    partner_order_id: { type: String, required: true, index: true },
    reported_status: { type: String, enum: ['completed', 'failed'], required: true },
    state: { type: String, enum: ['received', 'processing', 'processed'], required: true },
    lease_id: String,
    lease_until: Date,
    outcome: { type: String, enum: ['confirmed', 'failed', 'cancelled'] },
    action_required: String,
    processed_at: Date
}, { timestamps: true, bufferCommands: false });

module.exports = mongoose.models.BookingWebhook || mongoose.model('BookingWebhook', bookingWebhookSchema);