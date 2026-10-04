const { createMockWebhookSignature } = require('../services/ziinaWebhookHandler');

const PAYMENT_GATES = Object.freeze([
    'MULTI_SUPPLIER_MOCK_SEARCH_ENABLED',
    'HOTELBEDS_MOCK_DATABASE_ENABLED',
    'HOTELBEDS_PREPAID_CHECKOUT_ENABLED',
    'HOTELBEDS_PREPAID_CHECKOUT_APPROVED',
    'HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED',
    'HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED'
]);

function createMockHotelCheckoutPaymentController({
    service,
    webhookHandler,
    env = process.env,
    now = () => Date.now(),
    enabled = () => PAYMENT_GATES.every(gate => env[gate] === 'true')
        && env.HOTELBEDS_ENABLED === 'true'
        && String(env.HOTELBEDS_ENV || '').trim().toLowerCase() === 'test'
        && typeof env.ZIINA_MOCK_WEBHOOK_SECRET === 'string'
        && env.ZIINA_MOCK_WEBHOOK_SECRET.length >= 32
} = {}) {
    if (!service || typeof service.getSession !== 'function'
        || !webhookHandler || typeof webhookHandler.verifyMockSignature !== 'function'
        || typeof webhookHandler.processSignedEvent !== 'function'
        || !env || typeof now !== 'function' || typeof enabled !== 'function') {
        throw new TypeError('mock_checkout_payment_dependencies_invalid');
    }

    return async function mockHotelCheckoutPaymentController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        if (!enabled()) return res.status(404).json({ success: false, error: 'not_found' });
        if (req.body?.action !== 'complete') {
            return res.status(400).json({ success: false, error: 'mock_payment_action_invalid' });
        }

        const token = /^Bearer ([a-f\d]{64})$/i.exec(req.get('Authorization') || '')?.[1];
        try {
            // Verifies that this browser possesses the bearer token issued for this
            // exact session. Amount and intent identity are read only from Mongo.
            const session = await service.getSession(req.params.sessionId, token);
            if (session.status !== 'awaiting_payment') {
                return res.status(200).json({ success: true, sessionId: session.sessionId, status: session.status, duplicate: true });
            }
            const timestamp = String(now());
            if (!/^\d{10,13}$/.test(timestamp)) throw Object.assign(new Error('mock_payment_clock_invalid'), { httpStatus: 503 });
            const rawBody = Buffer.from(JSON.stringify({
                event: 'payment_intent.status.updated',
                data: {
                    id: `mock_${session.sessionId.replaceAll('-', '')}`,
                    sessionId: session.sessionId,
                    status: 'completed',
                    amount: session.totalAmount,
                    currency: session.currency
                }
            }));
            const signature = createMockWebhookSignature(rawBody, env.ZIINA_MOCK_WEBHOOK_SECRET, timestamp);
            const result = await webhookHandler.processSignedEvent(rawBody, signature, timestamp);
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            const status = error?.httpStatus === 503 ? 503 : 404;
            if (status === 503) res.set('Retry-After', '15');
            return res.status(status).json({ success: false,
                error: status === 503 ? 'mock_payment_unavailable' : 'checkout_session_not_found' });
        }
    };
}

module.exports = { PAYMENT_GATES, createMockHotelCheckoutPaymentController };