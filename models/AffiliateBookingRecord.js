const mongoose = require('mongoose');

const affiliateBookingRecordSchema = new mongoose.Schema({
    contract_identity: { type: String, required: true },
    process_id: { type: String, required: true, unique: true },
    reference: { type: String, required: true, unique: true },
    partner_order_id: { type: String, required: true },
    hotel: { type: mongoose.Schema.Types.Mixed, required: true },
    checkin: { type: String, required: true },
    checkout: { type: String, required: true },
    guests: [{ _id: false, adults: Number, children: [Number] }],
    guest_rooms: mongoose.Schema.Types.Mixed,
    encrypted_details: { iv: String, tag: String, ciphertext: String },
    status: { type: String, enum: ['confirmed'], required: true },
    confirmed_at: { type: Date, required: true }
}, { timestamps: true, bufferCommands: false });

affiliateBookingRecordSchema.index({ contract_identity: 1, partner_order_id: 1 }, { unique: true });

module.exports = mongoose.models.AffiliateBookingRecord
    || mongoose.model('AffiliateBookingRecord', affiliateBookingRecordSchema);