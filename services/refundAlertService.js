'use strict';

/*
 * Refunds that need a person: one e-mail per checkout, sent to REFUND_ALERT_EMAIL
 * (default accounts@pillowstays.app, where payments are handled).
 * - refund_review: Ziina refused the refund, or its details did not match; nothing more happens on its own.
 * - refund_creating / refund_unknown / refund_pending for more than 24 hours since the refund was sent.
 * Checked at most every 10 minutes; several refunds found together go in one message.
 */
const CheckoutAttempt = require('../models/CheckoutAttempt');
const logger = require('./loggerService');

const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const WAITING_STATES = ['refund_creating', 'refund_unknown', 'refund_pending'];
let lastRun = 0;

function alertRecipient(env = process.env) {
    const value = String(env.REFUND_ALERT_EMAIL || 'accounts@pillowstays.app').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : 'accounts@pillowstays.app';
}

function hoursSince(date, now) {
    return Math.floor((now - new Date(date).getTime()) / 3600000);
}

function describe(record, now) {
    const amount = Number.isSafeInteger(record.refund_amount_minor) ? record.refund_amount_minor : record.amount_minor;
    const sent = record.refund_sent_at ? `${new Date(record.refund_sent_at).toISOString()} (${hoursSince(record.refund_sent_at, now)} h ago)` : 'not sent';
    return [
        `Booking reference: ${record.reference}`,
        `State: ${record.state}${record.action_required ? ` · action: ${record.action_required}` : ''}${record.error ? ` · ${record.error}` : ''}`,
        `Refund: ${Number.isSafeInteger(amount) ? (amount / 100).toFixed(2) : '?'} ${record.currency || ''} via ${record.payment_provider || 'ziina'}`,
        `Refund sent: ${sent}`,
        `Payment intent: ${record.ziina_intent_id || record.tabby_payment_id || '-'} · refund id: ${record.refund_id || '-'}`,
    ].join('\n');
}

function renderAlert(records, { sandbox, now = Date.now() }) {
    const subject = `${sandbox ? '[SANDBOX] ' : ''}Refund needs attention: ${records.length} booking${records.length === 1 ? '' : 's'}`;
    const text = [
        'These refunds have not completed on their own and need a person.',
        'For a refused refund, check the payment in the Ziina dashboard and refund it there if it is due. Desk cannot yet record a refund made by hand, so the customer is not e-mailed automatically for it.',
        '',
        ...records.map(record => describe(record, now) + '\n'),
    ].join('\n');
    return { subject, text };
}

async function alertStuckRefunds({ now = Date.now(), send = input => require('./notificationService').sendStaffAlert(input),
    Model = CheckoutAttempt, force = false } = {}) {
    if (!force && now - lastRun < CHECK_EVERY_MS) return { sent: 0, skipped: true };
    lastRun = now;
    const stuckBefore = new Date(now - STUCK_AFTER_MS);
    const records = await Model.find({ refund_alert_sent_at: { $exists: false }, $or: [
        { state: 'refund_review' },
        { state: { $in: WAITING_STATES }, refund_sent_at: { $lte: stuckBefore } },
    ] }).sort({ refund_sent_at: 1 }).limit(50).lean();
    let sent = 0;
    for (const sandbox of [true, false]) {
        const group = records.filter(record => (record.ziina_test === true || record.tabby_test === true) === sandbox);
        if (!group.length) continue;
        try {
            await send({ to: alertRecipient(), ...renderAlert(group, { sandbox, now }) });
            await Model.updateMany({ _id: { $in: group.map(record => record._id) }, refund_alert_sent_at: { $exists: false } },
                { $set: { refund_alert_sent_at: new Date(now) } });
            sent += group.length;
        } catch {
            logger.error('Refund alert e-mail could not be sent', { count: group.length });
        }
    }
    return { sent, skipped: false };
}

module.exports = { alertStuckRefunds, renderAlert, alertRecipient, STUCK_AFTER_MS };
