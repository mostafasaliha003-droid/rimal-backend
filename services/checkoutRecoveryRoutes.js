function createPaymentAvailabilityHandler({ payment, database } = {}) {
    if (!payment || typeof payment.getCheckoutReadiness !== 'function' || !database) throw new TypeError('checkout_availability_dependencies_invalid');
    return (_req, res) => {
        res.set('Cache-Control', 'no-store');
        let readiness;
        try { readiness = payment.getCheckoutReadiness(); } catch { readiness = { ready: false, mode: 'unconfigured' }; }
        const mode = ['sandbox', 'production', 'unconfigured'].includes(readiness.mode) ? readiness.mode : 'unconfigured';
        const enabled = readiness.ready === true && mode !== 'unconfigured' && database.readyState === 1;
        let tabby = false;
        try { tabby = enabled && require('./tabbyClient').isTabbyReady(); } catch { tabby = false; }
        return res.json({ enabled, mode, tabby, ...(!enabled ? { reason: 'checkout_unavailable' } : {}) });
    };
}

function createCheckoutRecoveryHandler({ service } = {}) {
    if (!service || typeof service.recoverCheckout !== 'function') throw new TypeError('checkout_recovery_dependencies_invalid');
    return async (req, res) => {
        res.set({ 'Cache-Control': 'no-store', Vary: 'Authorization' });
        if (Object.keys(req.query || {}).length || !req.is('application/json') || !req.body
            || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) {
            return res.status(400).json({ success: false, error: 'invalid_checkout_recovery' });
        }
        try {
            return res.status(200).json(await service.recoverCheckout(req.get('Idempotency-Key'), req.auth));
        } catch (error) {
            const status = [400, 401, 503].includes(error?.httpStatus) ? error.httpStatus : 503;
            const code = ['invalid_idempotency_key', 'unauthorized', 'checkout_unavailable', 'checkout_encryption_unavailable'].includes(error?.code)
                ? error.code : 'checkout_recovery_unavailable';
            return res.status(status).json({ success: false, error: code });
        }
    };
}

module.exports = { createCheckoutRecoveryHandler, createPaymentAvailabilityHandler };
