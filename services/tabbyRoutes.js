const mongoose = require('mongoose');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const tabby = require('./tabbyClient');

/*
 * Tabby webhooks only wake the reconciler: the payment is always read back from Tabby's API,
 * never taken from the webhook body. The shared header Tabby sends is checked in constant time.
 */
function createTabbyWebhookHandler({ database = mongoose.connection, Model = CheckoutAttempt } = {}) {
  return async function receiveTabbyWebhook(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!tabby.isTabbyReady() || database.readyState !== 1) return res.status(503).json({ received: false });
    if (!tabby.verifyWebhook(req.get(tabby.WEBHOOK_HEADER))) return res.status(401).json({ received: false });
    const id = req.body?.id;
    if (typeof id !== 'string' || !tabby.PAYMENT_ID.test(id)) return res.status(400).json({ received: false });
    try {
        await Model.updateOne({ tabby_payment_id: id, payment_provider: 'tabby',
            state: { $in: ['awaiting_payment', 'refund_unknown', 'refund_pending'] } }, { $set: { next_check_at: new Date(0) } });
        return res.status(200).json({ received: true });
    } catch {
        res.set('Retry-After', '30');
        return res.status(503).json({ received: false });
    }
  };
}
const receiveTabbyWebhook = createTabbyWebhookHandler();

const REASONS = new Set(['not_available', 'order_amount_too_high', 'order_amount_too_low']);
/**
 * Pre-scoring before the guest chooses Tabby: is this amount payable in four for this buyer?
 * Any failure answers "available" without a check (Tabby's fail-safe guidance); the real
 * decision is always Tabby's checkout itself.
 */
async function tabbyEligibility(req, res) {
    res.set('Cache-Control', 'no-store');
    if (!tabby.isTabbyReady()) return res.status(200).json({ success: true, available: false, reason: 'tabby_unavailable' });
    const body = req.body || {};
    const amount = tabby.amountMinor(body.amount);
    if (body.currency !== 'AED' || amount === null || amount <= 0 || amount > 100000000
        || typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254
        || typeof body.phone !== 'string' || !/^\+[1-9]\d{6,19}$/.test(body.phone)) {
        return res.status(400).json({ success: false, error: 'invalid_tabby_eligibility' });
    }
    try {
        const result = await tabby.prescore({ amount, email: body.email.trim(), phone: body.phone, language: body.language === 'en' ? 'en' : 'ar' });
        return res.status(200).json({ success: true, available: result.available, checked: true,
            ...(!result.available && REASONS.has(result.reason) ? { reason: result.reason } : {}) });
    } catch {
        return res.status(200).json({ success: true, available: true, checked: false });
    }
}

module.exports = { createTabbyWebhookHandler, receiveTabbyWebhook, tabbyEligibility };
