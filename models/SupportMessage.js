const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: String, conversation: { type: String, required: true }, realm: { type: String, required: true },
    senderSubject: { type: String, required: true }, senderRole: { type: String, enum: ['user', 'admin'], required: true },
    kind: { type: String, enum: ['message', 'note', 'event'], default: 'message' },
    body: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now }
}, { bufferCommands: false });
schema.index({ realm: 1, conversation: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.models.SupportMessage || mongoose.model('SupportMessage', schema);
