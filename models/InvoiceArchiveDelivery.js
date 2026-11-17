const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    realm: { type: String, required: true, immutable: true, match: /^[a-z0-9:_-]{1,100}$/i },
    supplier: { type: String, required: true, immutable: true, enum: ['ratehawk'] },
    supplierScope: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
    invoiceId: { type: String, required: true, immutable: true, maxlength: 256 },
    recipient: { type: String, required: true, immutable: true, enum: ['connect@remaltourismllc.com'] },
    state: { type: String, required: true, enum: ['pending', 'sending', 'sent', 'unknown', 'failed'] },
    claimId: String,
    leaseUntil: Date,
    phase: String,
    retryable: { type: Boolean, default: true },
    attempts: { type: Number, default: 0 },
    pdfSha256: { type: String, match: /^[a-f0-9]{64}$/ },
    pdfBytes: Number,
    pdfValidation: { type: String, enum: ['header-objects-eof-v1'] },
    messageId: { type: String, maxlength: 1024 },
    sentAt: Date,
    errorCode: String
}, { collection: 'invoicearchivedeliveries', timestamps: true, versionKey: false,
    bufferCommands: false, strict: 'throw', autoCreate: false, autoIndex: false });

schema.index({ realm: 1, supplier: 1, invoiceId: 1, recipient: 1 }, { unique: true });
schema.index({ realm: 1, supplier: 1, state: 1, leaseUntil: 1 });

module.exports = mongoose.models.InvoiceArchiveDelivery || mongoose.model('InvoiceArchiveDelivery', schema);
