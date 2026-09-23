const mongoose = require('mongoose');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const ziina = require('./ziinaClient');

async function receiveZiinaWebhook(req, res) {
    res.set('Cache-Control', 'no-store');
    if (process.env.ZIINA_WEBHOOK_CONFIGURED !== 'true' || mongoose.connection.readyState !== 1) {
        return res.status(503).json({ received: false });
    }
    if (!ziina.verifyWebhook(req.body, req.get('X-Hmac-Signature'), req.ip)) {
        return res.status(401).json({ received: false });
    }
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ received: false }); }
    const eventId = event?.data?.id;
    if (!['payment_intent.status.updated', 'refund.status.updated'].includes(event?.event)
        || typeof eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(eventId)) {
        return res.status(400).json({ received: false });
    }
    const filter = event.event === 'payment_intent.status.updated'
        ? { ziina_intent_id: eventId, state: 'awaiting_payment' }
        : { refund_id: eventId, state: { $in: ['refund_unknown', 'refund_pending'] } };
    try {
        await CheckoutAttempt.updateOne(filter, { $set: { next_check_at: new Date(0) } });
        return res.status(200).json({ received: true });
    } catch {
        res.set('Retry-After', '30');
        return res.status(503).json({ received: false });
    }
}

module.exports = { receiveZiinaWebhook };