const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const store = require('./models/CheckoutAttempt');
const webhook = require('./services/ziinaWebhookService');

test('signed Ziina webhooks wake durable records without accepting reported payment state', async context => {
    const oldSecret = process.env.ZIINA_WEBHOOK_SECRET;
    const oldEnabled = process.env.ZIINA_WEBHOOK_CONFIGURED;
    process.env.ZIINA_WEBHOOK_SECRET = 'a'.repeat(32);
    process.env.ZIINA_WEBHOOK_CONFIGURED = 'true';
    const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });
    context.after(() => {
        if (oldSecret === undefined) delete process.env.ZIINA_WEBHOOK_SECRET;
        else process.env.ZIINA_WEBHOOK_SECRET = oldSecret;
        if (oldEnabled === undefined) delete process.env.ZIINA_WEBHOOK_CONFIGURED;
        else process.env.ZIINA_WEBHOOK_CONFIGURED = oldEnabled;
        if (descriptor) Object.defineProperty(mongoose.connection, 'readyState', descriptor);
        else delete mongoose.connection.readyState;
    });
    const updated = context.mock.method(store, 'updateOne', async () => ({ matchedCount: 1 }));
    const app = express();
    app.set('trust proxy', 1);
    app.post('/webhook', express.raw({ type: 'application/json' }), webhook.receiveZiinaWebhook);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/webhook`;
    const raw = Buffer.from(JSON.stringify({ event: 'payment_intent.status.updated', data: { id: 'intent-fixture', status: 'completed' } }));
    const signature = crypto.createHmac('sha256', process.env.ZIINA_WEBHOOK_SECRET).update(raw).digest('hex');
    const send = (body, hmac, ip = '3.29.184.186') => fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hmac-Signature': hmac, 'X-Forwarded-For': ip }, body
    });
    assert.equal((await send(raw, '0'.repeat(64))).status, 401);
    assert.equal((await send(raw, signature, '192.0.2.1')).status, 401);
    assert.equal(updated.mock.callCount(), 0);
    assert.equal((await send(raw, signature)).status, 200);
    assert.equal((await send(raw, signature)).status, 200);
    assert.equal(updated.mock.callCount(), 2);
    assert.deepEqual(updated.mock.calls[0].arguments[0], { ziina_intent_id: 'intent-fixture', state: 'awaiting_payment' });
    assert.equal(updated.mock.calls[0].arguments[1].$set.next_check_at.getTime(), 0);
    const refund = Buffer.from(JSON.stringify({ event: 'refund.status.updated', data: { id: 'refund-fixture', status: 'completed' } }));
    assert.equal((await send(refund, crypto.createHmac('sha256', process.env.ZIINA_WEBHOOK_SECRET).update(refund).digest('hex'))).status, 200);
    assert.deepEqual(updated.mock.calls[2].arguments[0], { refund_id: 'refund-fixture', state: { $in: ['refund_unknown', 'refund_pending'] } });
});