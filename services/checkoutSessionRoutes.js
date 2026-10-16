const express = require('express');

function createCheckoutSessionRouter({ controller, statusController, mockPaymentController, requireUser, bookingLimiter } = {}) {
    if (typeof controller !== 'function' || typeof statusController !== 'function'
        || typeof requireUser !== 'function') {
        throw new TypeError('checkout_session_route_dependencies_invalid');
    }
    const router = express.Router();
    const limiter = typeof bookingLimiter === 'function' ? bookingLimiter : (_req, _res, next) => next();
    router.post('/checkout', requireUser, limiter, controller);
    router.get('/checkout/:sessionId', statusController);
    if (mockPaymentController !== undefined) {
        if (typeof mockPaymentController !== 'function') throw new TypeError('checkout_session_mock_payment_controller_invalid');
        router.post('/checkout/:sessionId/mock-payment', limiter, mockPaymentController);
    }
    return router;
}

module.exports = createCheckoutSessionRouter;