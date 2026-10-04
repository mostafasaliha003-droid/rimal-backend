const mongoose = require('mongoose');

const midofficeWebhookSchema = new mongoose.Schema({
    _id: String,
    payload_hash: { type: String, required: true },
    partner_order_id: { type: String, required: true, index: true },
    agreement_number: String,
    event_type: { type: String, enum: ['created', 'updated', 'cancelled'], required: true },
    action_required: { type: String, required: true },
    state: { type: String, enum: ['pending', 'review_required'], required: true },
    supplier_status: String,
    reconciliation_attempts: { type: Number, default: 0, min: 0 },
    next_check_at: Date,
    check_lease_id: String,
    check_lease_until: Date
}, { timestamps: true, bufferCommands: false });

midofficeWebhookSchema.index({ state: 1, next_check_at: 1 });

module.exports = mongoose.models.MidofficeWebhook || mongoose.model('MidofficeWebhook', midofficeWebhookSchema);