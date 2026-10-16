function createCheckoutSessionController({ service }) {
    if (!service || typeof service.createSession !== 'function') {
        throw new TypeError('checkout_session_controller_dependencies_invalid');
    }

    return async function checkoutSessionController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        try {
            const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
                ? req.body : {};
            const result = await service.createSession({
                publicOfferId: body.publicOfferId,
                guestDetails: body.guestDetails,
                termsAccepted: body.termsAccepted,
                acceptedTermsVersion: body.acceptedTermsVersion,
                idempotencyKey: req.get('Idempotency-Key'),
                ownerSubject: req.auth?.subject
            });
            return res.status(201).json({ success: true, ...result });
        } catch (error) {
            const status = [400, 404, 409, 429, 502, 503].includes(error?.httpStatus)
                ? error.httpStatus : 503;
            const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
                ? error.code : 'checkout_unavailable';
            return res.status(status).json({ success: false, error: code });
        }
    };
}

function createCheckoutSessionStatusController({ service }) {
    if (!service || typeof service.getSession !== 'function') {
        throw new TypeError('checkout_session_status_controller_dependencies_invalid');
    }
    return async function checkoutSessionStatusController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        const token = /^Bearer ([a-f\d]{64})$/i.exec(req.get('Authorization') || '')?.[1];
        try {
            const result = await service.getSession(req.params.sessionId, token);
            return res.status(200).json({ success: true, ...result });
        } catch (error) {
            const status = error?.httpStatus === 503 ? 503 : 404;
            return res.status(status).json({ success: false,
                error: status === 503 ? 'checkout_unavailable' : 'checkout_session_not_found' });
        }
    };
}

module.exports = createCheckoutSessionController;
module.exports.createStatusController = createCheckoutSessionStatusController;