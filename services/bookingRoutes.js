const express = require('express');
const crypto = require('node:crypto');
const booking = require('./bookingProcessService');
const postBooking = require('./postBookingService');
const ratehawk = require('./ratehawkService');
const { bookingLimiter } = require('./securityService');

function authorize(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const secret = process.env.RATEHAWK_BOOKING_TOKEN;
    if (!secret || secret.length < 32 || secret === process.env.REMAL_SECURE_KEY) {
        return res.status(503).json({ success: false, error: 'booking_auth_not_configured' });
    }
    const token = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '')?.[1];
    const digest = value => crypto.createHash('sha256').update(value).digest();
    if (!token || !crypto.timingSafeEqual(digest(token), digest(secret))) {
        return res.status(401).json({ success: false, error: 'unauthorized' });
    }
    if (req.get('Origin')) return res.status(403).json({ success: false, error: 'server_to_server_only' });
    next();
}

function enabled(req, res, next) {
    if (process.env.RATEHAWK_BOOKING_ENABLED !== 'true') return res.status(503).json({ success: false, error: 'booking_disabled' });
    next();
}

function handle(operation, unavailableCode = 'booking_service_unavailable') {
    return async (req, res) => {
        try {
            const result = await operation(req);
            const status = result.pending || ['creating', 'card_pending', 'finishing', 'processing', 'cancelling', 'cancel_pending'].includes(result.status)
                ? 202 : result.status === 'cancel_failed' ? 409 : 200;
            res.status(status).json(result);
        } catch (error) {
            const known = typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code);
            const status = known && [400, 404, 409, 429, 502, 503].includes(error.httpStatus) ? error.httpStatus : 503;
            if (status === 429 && Number.isFinite(error.retry_after_ms)) res.set('Retry-After', String(Math.ceil(error.retry_after_ms / 1000)));
            res.status(status).json({ success: false, error: known ? error.code : unavailableCode });
        }
    };
}

function createBookingRouter() {
    const router = express.Router();
    router.post('/form', authorize, enabled, bookingLimiter, handle(req => booking.createProcess(req.body || {}, req.get('Idempotency-Key'))));
    router.post('/card-token', authorize, enabled, bookingLimiter, handle(req => booking.tokenizeCard(req.body?.process_id, req.body || {})));
    router.post('/finish', authorize, enabled, bookingLimiter, handle(req => booking.finishProcess(req.body?.process_id, req.body || {})));
    router.post('/status', authorize, handle(req => booking.checkProcess(req.body?.process_id)));
    return router;
}

function createPostBookingRouter() {
    const router = express.Router();
    router.use(authorize);
    router.post('/retrieve', handle(req => ratehawk.retrieveBookings(req.body || {})));
    router.get('/:partnerOrderId/info', handle(req => postBooking.getBookingInfo(req.params.partnerOrderId)));
    router.post('/:partnerOrderId/cancel', bookingLimiter, handle(req => postBooking.cancelBooking(req.params.partnerOrderId, req.body || {})));
    router.get('/:partnerOrderId/cancel/status', handle(req => postBooking.checkCancellation(req.params.partnerOrderId)));
    router.post('/cancel', (req, res) => res.status(410).json({ success: false, error: 'legacy_cancellation_disabled' }));
    return router;
}

function createContractRouter() {
    const router = express.Router();
    router.use(authorize);
    router.use((req, res, next) => {
        if (Object.keys(req.query).length || (req.body && Object.keys(req.body).length)) {
            return res.status(400).json({ success: false, error: 'invalid_contract_request' });
        }
        next();
    });
    router.get('/', handle(() => ratehawk.retrieveContract(), 'contract_service_unavailable'));
    router.get('/financial-details', handle(() => ratehawk.retrieveFinancialDetails(), 'contract_service_unavailable'));
    return router;
}

function createDocumentRouter() {
    const router = express.Router();
    const errorStatuses = {
        failed_to_generate_document: 202, pending: 202,
        order_not_found: 404, invoice_not_found: 404,
        voucher_is_not_downloadable: 409, invoice_not_available: 409,
        terminal_invoice: 409, order_not_assigned: 409, single_act_is_not_downloadable: 409,
        rate_limit: 429,
        supplier_unauthorized: 502, supplier_endpoint_unavailable: 502,
        supplier_request_rejected: 502, supplier_connection_failed: 502, supplier_unknown: 502,
        invalid_document_response: 502, invalid_closing_documents_info_response: 502, document_unavailable: 502,
        supplier_credentials_missing: 503
    };
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        const end = res.end;
        res.end = function (...args) {
            res.removeHeader('ETag');
            return end.apply(this, args);
        };
        next();
    });
    router.use(authorize);
    router.use(express.json({ limit: '8kb' }));
    router.use((error, req, res, next) => {
        if (error?.status >= 400 && error?.status < 500) {
            return res.status(400).json({ success: false, error: 'invalid_document_request' });
        }
        next(error);
    });

    function documentRoute(path, method, fields, filename) {
        router.post(path, async (req, res) => {
            if (Object.keys(req.query).length || !req.is('application/json') || !req.body
                || typeof req.body !== 'object' || Array.isArray(req.body)
                || Object.keys(req.body).some(field => !fields.includes(field))) {
                return res.status(400).json({ success: false, error: 'invalid_document_request' });
            }
            try {
                const result = await ratehawk[method](req.body);
                if (!filename) return res.json(result);
                if (!Buffer.isBuffer(result)) throw new Error('Unexpected document response');
                res.set({
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'X-Content-Type-Options': 'nosniff'
                });
                return res.send(result);
            } catch (error) {
                const code = error?.code;
                const status = errorStatuses[code];
                if (status === error?.httpStatus) {
                    if (status === 202) {
                        res.set('Retry-After', '5');
                        return res.status(202).json({ success: false, pending: true, error: code });
                    }
                    if (status === 429 && Number.isFinite(error.retry_after_ms)) {
                        res.set('Retry-After', String(Math.ceil(error.retry_after_ms / 1000)));
                    }
                    return res.status(status).json({ success: false, error: code });
                }
                if (error?.httpStatus === 400 && typeof code === 'string' && /^invalid_[a-z0-9_]+$/.test(code)) {
                    return res.status(400).json({ success: false, error: code });
                }
                return res.status(503).json({ success: false, error: 'document_service_unavailable' });
            }
        });
    }

    documentRoute('/closing-documents', 'retrieveClosingDocuments', ['package_id', 'seal'], 'closing-documents.pdf');
    documentRoute('/closing-documents/info', 'retrieveClosingDocumentsInfo', ['order_ids', 'agreement_numbers', 'issue_date']);
    documentRoute('/voucher', 'retrieveVoucher', ['partner_order_id', 'language'], 'voucher.pdf');
    documentRoute('/invoice-info', 'retrieveInvoiceInfo', ['partner_order_id'], 'invoice-info.pdf');
    documentRoute('/invoice', 'retrieveInvoice', ['invoice_id'], 'invoice.pdf');
    documentRoute('/single-act', 'retrieveSingleAct', ['partner_order_id', 'add_commission', 'seal', 'show_b2b2c_price'], 'single-act.pdf');
    return router;
}

module.exports = createBookingRouter;
module.exports.createPostBookingRouter = createPostBookingRouter;
module.exports.createContractRouter = createContractRouter;
module.exports.createDocumentRouter = createDocumentRouter;