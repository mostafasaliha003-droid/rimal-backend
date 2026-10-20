const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: String, realm: { type: String, required: true }, ownerSubject: { type: String, required: true },
    reference: { type: String, required: true }, customerName: String, hotelName: String,
    topic: { type: String, enum: ['booking', 'payment', 'voucher', 'cancellation', 'refund', 'other'], default: 'booking' },
    status: { type: String, enum: ['open', 'waiting', 'resolved'], default: 'open' },
    priority: { type: String, enum: ['normal', 'high'], default: 'normal' }, assignedTo: String,
    lastMessage: String, lastMessageId: { type: String, default: '' }, lastMessageAt: { type: Date, default: () => new Date(0) },
    lastCustomerAt: Date, lastStaffAt: Date, staffReadAt: Date, customerReadAt: Date
}, { timestamps: true, bufferCommands: false });
schema.index({ realm: 1, ownerSubject: 1, reference: 1 }, { unique: true });
schema.index({ realm: 1, status: 1, updatedAt: -1 });
module.exports = mongoose.models.SupportConversation || mongoose.model('SupportConversation', schema);
