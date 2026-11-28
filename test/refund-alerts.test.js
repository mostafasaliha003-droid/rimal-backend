'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const alerts = require('../services/refundAlertService');

function model(rows) {
    const updates = [];
    return { updates, rows,
        find(filter) {
            const stuckBefore = filter.$or[1].refund_sent_at.$lte;
            const hits = rows.filter(r => !r.refund_alert_sent_at && (r.state === 'refund_review'
                || (filter.$or[1].state.$in.includes(r.state) && new Date(r.refund_sent_at) <= stuckBefore)));
            return { sort: () => ({ limit: () => ({ lean: async () => hits.map(r => ({ ...r })) }) }) };
        },
        async updateMany(filter, update) {
            updates.push(filter._id.$in);
            for (const r of rows) if (filter._id.$in.includes(r._id)) Object.assign(r, update.$set);
        } };
}

const now = Date.parse('2026-11-29T12:00:00Z');
const hoursAgo = h => new Date(now - h * 3600000);

test('refused refunds and refunds waiting over 24 hours are reported once, sandbox apart from live', async () => {
    const rows = [
        { _id: 'a', reference: 'ref-a', state: 'refund_review', action_required: 'refund_rejected', error: 'refund_rejected:TRANSACTION_NOT_FOUND',
            refund_amount_minor: 10217, currency: 'AED', ziina_test: true, refund_sent_at: hoursAgo(1), ziina_intent_id: 'pi-a', refund_id: 'r-a' },
        { _id: 'b', reference: 'ref-b', state: 'refund_unknown', refund_amount_minor: 5000, currency: 'AED', ziina_test: false, refund_sent_at: hoursAgo(25) },
        { _id: 'c', reference: 'ref-c', state: 'refund_pending', refund_amount_minor: 5000, currency: 'AED', ziina_test: false, refund_sent_at: hoursAgo(5) },
        { _id: 'd', reference: 'ref-d', state: 'refund_completed', refund_amount_minor: 5000, currency: 'AED', ziina_test: false, refund_sent_at: hoursAgo(50) },
    ];
    const Model = model(rows); const sent = [];
    const result = await alerts.alertStuckRefunds({ now, Model, force: true, send: async message => { sent.push(message); } });
    assert.equal(result.sent, 2);
    assert.equal(sent.length, 2);
    const sandbox = sent.find(m => m.subject.startsWith('[SANDBOX] '));
    const live = sent.find(m => !m.subject.startsWith('[SANDBOX] '));
    assert.equal(sandbox.to, 'accounts@pillowstays.app');
    assert.match(sandbox.subject, /Refund needs attention: 1 booking$/);
    assert.match(sandbox.text, /ref-a[\s\S]*refund_rejected:TRANSACTION_NOT_FOUND[\s\S]*102\.17 AED/);
    assert.match(live.text, /ref-b[\s\S]*25 h ago/);
    assert.doesNotMatch(live.text + sandbox.text, /ref-c|ref-d/, 'a 5-hour-old pending refund and a completed one are not reported');
    const again = await alerts.alertStuckRefunds({ now: now + 3600000, Model, force: true, send: async message => { sent.push(message); } });
    assert.equal(again.sent, 0, 'each refund is reported once');
});

test('a failed alert e-mail is retried on the next run', async () => {
    const rows = [{ _id: 'x', reference: 'ref-x', state: 'refund_review', refund_amount_minor: 100, currency: 'AED', ziina_test: false }];
    const Model = model(rows);
    await alerts.alertStuckRefunds({ now, Model, force: true, send: async () => { throw new Error('smtp down'); } });
    assert.equal(rows[0].refund_alert_sent_at, undefined);
    const sent = [];
    await alerts.alertStuckRefunds({ now, Model, force: true, send: async m => { sent.push(m); } });
    assert.equal(sent.length, 1);
    assert.ok(rows[0].refund_alert_sent_at);
});

test('the alert address can be changed but never to an invalid value', () => {
    assert.equal(alerts.alertRecipient({ REFUND_ALERT_EMAIL: 'operations@pillowstays.app' }), 'operations@pillowstays.app');
    assert.equal(alerts.alertRecipient({ REFUND_ALERT_EMAIL: 'not an address' }), 'accounts@pillowstays.app');
});
