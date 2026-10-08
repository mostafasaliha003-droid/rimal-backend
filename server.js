require('dotenv').config(); 
const { getDeploymentReadiness, readinessHttpStatus } = require('./services/deploymentReadiness');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const puppeteer = require('puppeteer'); 
const fs = require('fs'); 
const http = require('http'); 
const { Server } = require('socket.io'); 
const Hotel = require('./models/Hotel');
const AuthSession = require('./models/AuthSession');

// ==========================================
// 🧩 1. استدعاء خدمات المحرك الجديد
// ==========================================
const ratehawkService = require('./services/ratehawkService');
const dubailinkService = require('./services/dubailinkService'); 
const paymentService = require('./services/paymentService');
const notificationService = require('./services/notificationService'); 
const webhookService = require('./services/webhookService'); 
const { createMidofficeWebhookRouter } = require('./services/midofficeWebhookService');
const logger = require('./services/loggerService'); 
const mappingService = require('./services/mappingService'); 
const securityService = require('./services/securityService'); 
const affiliateBookingService = require('./services/affiliateBookingService');
const createAffiliateBookingRouter = require('./services/affiliateBookingRoutes');
const hotelbedsMockCertificationService = require('./services/hotelbedsMockCertificationService');
const createHotelbedsMockCertificationRouter = require('./services/hotelbedsMockCertificationRoutes');
const { createHotelbedsAvailabilityService } = require('./services/hotelbedsAvailabilityService');
const createHotelbedsAvailabilityRouter = require('./services/hotelbedsAvailabilityRoutes');
const { createSearchOrchestrator } = require('./services/searchOrchestrator');
const createSearchController = require('./controllers/searchController');
const createSearchRouter = require('./services/searchRoutes');
const createAggregateSearchController = require('./controllers/aggregateSearchController');
const createAggregateSearchRouter = require('./services/aggregateSearchRoutes');
const createHotelbedsPilotListController = require('./controllers/hotelbedsPilotListController');
const createHotelbedsPilotListRouter = require('./services/hotelbedsPilotListRoutes');
const { createMockAggregateSearchService } = require('./services/mockAggregateSearchService');
const {
    createHotelbedsLiveAggregateSearchService,
    requiredGates: liveAggregateSearchGatesEnabled
} = require('./services/hotelbedsLiveAggregateSearchService');
const createBookingController = require('./controllers/bookingController');
const { normalizeSupplierImage, collectSupplierImages } = require('./services/supplierImages');
const createFrontendRouter = require('./services/frontendService');
const { createAuthSessionService } = require('./services/authSessionService');
const { createSessionAuthMiddleware } = require('./services/sessionAuthMiddleware');
const { registerChatSocketHandlers } = require('./services/chatSocketHandlers');
const { createInternalApiKeyMiddleware } = require('./services/internalApiKeyMiddleware');
const { createUserAuthRouter, createUserProfileRouter } = require('./services/userAuthRoutes');
const createAdminAuthRouter = require('./services/adminAuthRoutes');
const createDisplayCurrencyRouter = require('./services/displayCurrencyRoutes');
const { createDisplayCurrencyService } = require('./services/displayCurrencyService');
const corsPolicy = require('./services/corsPolicy');
const createBookingRouter = require('./services/bookingRoutes');
const { createOwnedBookingPdfRouter } = require('./services/ownedBookingPdfRoutes');
const { createAdminBookingRouter } = require('./services/adminBookingRoutes');
const createAdminHotelbedsSupplierTestController = require('./controllers/adminHotelbedsSupplierTestController');
const createAdminHotelbedsSupplierTestRouter = require('./services/adminHotelbedsSupplierTestRoutes');
const { createAdminHotelbedsSupplierTestService } = require('./services/adminHotelbedsSupplierTest');
const { createBookingRecordPersistence, createEncryptedBookingRecordPayloadSchema } = require('./services/bookingRecordPersistence');
const HotelbedsVerifiedHotelContent = require('./models/HotelbedsVerifiedHotelContent');
const hotelbedsMockDatabase = require('./services/hotelbedsMockDatabase');
const { createHotelbedsBookingService } = require('./services/hotelbedsBookingService');
const { createHotelbedsRateReviewService } = require('./services/hotelbedsRateReviewService');
const createHotelbedsRateReviewController = require('./controllers/hotelbedsRateReviewController');
const createHotelbedsRateReviewRouter = require('./services/hotelbedsRateReviewRoutes');
const createHotelbedsReconciliationController = require('./controllers/hotelbedsReconciliationController');
const createHotelbedsReconciliationRouter = require('./services/hotelbedsReconciliationRoutes');
const { createHotelbedsBookingReconciliationService } = require('./services/hotelbedsBookingReconciliationService');
const { createHotelbedsBookingAttemptStore } = require('./services/hotelbedsBookingAttemptStore');
const hotelbedsClient = require('./services/hotelbedsClient');
const createCheckoutSessionController = require('./controllers/checkoutSessionController');
const createCheckoutSessionRouter = require('./services/checkoutSessionRoutes');
const { createHotelbedsMockCheckoutBookingService } = require('./services/hotelbedsMockCheckoutBookingService');
const { createSocketSessionAuth } = require('./services/socketSessionAuth');
const bookingProcessService = require('./services/bookingProcessService');
const checkoutProcessService = require('./services/checkoutProcessService');
const checkoutReconciliationService = require('./services/checkoutReconciliationService');
const ziinaWebhookService = require('./services/ziinaWebhookService');
const checkoutSessionService = require('./services/checkoutSessionService');
const { createZiinaWebhookHandler } = require('./services/ziinaWebhookHandler');
const { createMockHotelCheckoutPaymentController } = require('./controllers/mockHotelCheckoutPaymentController');

const app = express();
const displayCurrencyService = createDisplayCurrencyService();
const checkoutSessionController = createCheckoutSessionController({ service: checkoutSessionService });
const checkoutSessionStatusController = createCheckoutSessionController.createStatusController({ service: checkoutSessionService });

const frontendContentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://maps.googleapis.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://npmcdn.com; script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://maps.googleapis.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://npmcdn.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: blob: https:; connect-src 'self' https: wss: https://pay.google.com;";
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', frontendContentSecurityPolicy);
    next();
});

// 🔴 السطر السحري لحل مشكلة الـ IP الوهمي على منصة Render (مهم جداً لجدار الحماية)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: corsPolicy.origin, credentials: true, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 16 * 1024
});
const authSessionService = createAuthSessionService({ Model: AuthSession, database: mongoose.connection });
const sessionAuth = createSessionAuthMiddleware({ sessions: authSessionService });
io.use(createSocketSessionAuth({ sessions: authSessionService }));
const requireUser = sessionAuth.requireRole('user');
const requireAdmin = sessionAuth.requireRole('admin');
const verifyInternalAPIKey = createInternalApiKeyMiddleware({ env: process.env, logger });
const internalSearchLimiter = (req, res, next) => {
    if (req.get('Origin')) return res.status(403).json({ success: false, error: 'server_to_server_only' });
    return securityService.searchLimiter(req, res, next);
};

app.use('/api/v1/documents', securityService.globalLimiter, createBookingRouter.createDocumentRouter());
app.use('/api/v1/order-groups', securityService.globalLimiter, createBookingRouter.createOrderGroupRouter());
app.use('/api/v1/profiles', securityService.globalLimiter, createBookingRouter.createProfileRouter());
app.use('/api/v1/webhooks/midoffice', createMidofficeWebhookRouter());
app.post('/api/payment/ziina/webhook', express.raw({ type: 'application/json', limit: '256kb' }), ziinaWebhookService.receiveZiinaWebhook);
if (process.env.HOTELBEDS_PREPAID_CHECKOUT_ENABLED === 'true'
    && process.env.HOTELBEDS_PREPAID_CHECKOUT_APPROVED === 'true'
    && process.env.HOTELBEDS_MOCK_DATABASE_ENABLED === 'true'
    && process.env.HOTELBEDS_PREPAID_MOCK_PAYMENT_ENABLED === 'true'
    && process.env.HOTELBEDS_PREPAID_MOCK_BOOKING_ENABLED === 'true'
    && process.env.HOTELBEDS_ENABLED === 'true'
    && String(process.env.HOTELBEDS_ENV || '').toLowerCase() === 'test') {
    const ziinaMockWebhookHandler = createZiinaWebhookHandler({
        hotelbedsBookingService: createHotelbedsMockCheckoutBookingService()
    });
    // Mock-only; registered before express.json so HMAC covers the original body bytes.
    app.post('/api/v1/webhooks/ziina-mock', express.raw({ type: 'application/json', limit: '64kb' }), ziinaMockWebhookHandler.receiveWebhook);
}
app.use(express.json());

// 🛡️ تطبيق جدار الحماية العام على كل السيرفر
app.use(securityService.globalLimiter);

// Keep internal readiness diagnostics outside browser CORS handling while still
// applying the same server-to-server credential checks before inspecting Origin.
app.use('/api/v1/internal/health/readiness', verifyInternalAPIKey);
app.use('/api/v1/internal/health/readiness', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('Origin')) {
        return res.status(403).json({ success: false, error: 'server_to_server_only' });
    }
    return next();
});

// ==========================================
// 🛡️ 2. إعدادات الحماية (CORS Policy)
// ==========================================
app.use(cors(corsPolicy));
app.use('/api', createDisplayCurrencyRouter(displayCurrencyService));
app.use('/api/booking', createBookingRouter());
app.use('/api/v1/contracts', createBookingRouter.createContractRouter());
// ==========================================
// 🚀 3. إعدادات البريد وقاعدة البيانات
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});

const MONGO_URI = process.env.MONGO_URI;

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    phone: String,
    nationality: String,
    birthYear: Number,
    points: { type: Number, default: 500 },
    savedCards: [{ cardHolder: String, maskedNumber: String, cardToken: String }],
    createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
    ownerSubject: { type: String, immutable: true, index: true, default: undefined },
    realm: { type: String, immutable: true, index: true, default: undefined },
    ziinaPaymentId: { type: String, default: '' }, 
    supplierReference: { type: String, default: 'Pending' }, 
    hotelConfirmationNumber: { type: String, default: '' },
    supplierStatus: { type: String, default: 'Pending' }, 
    provider: { type: String, default: 'ratehawk' }, 
    email: { type: String, required: true, index: true },
    customerName: String, 
    phone: String, 
    hotelName: String, 
    roomType: String, 
    boardType: String, 
    price: Number, 
    priceCurrency: { type: String, default: 'AED', match: /^[A-Z]{3}$/ },
    paymentMethod: String,
    companions: String, 
    status: { type: String, default: 'active' },
    cancellationPolicy: { type: String, default: 'شروط المورد مطبقة' },
    supplierPaymentType: { type: String, default: 'unknown' },
    bookingClientReference: { type: String, default: undefined, select: false, maxlength: 100 },
    providerHotelCode: { type: String, default: undefined, select: false, match: /^\d{1,10}$/ },
    hotelbedsVoucherSnapshotEncrypted: {
        type: createEncryptedBookingRecordPayloadSchema(mongoose),
        default: undefined,
        select: false
    },
    hotelbedsVoucherSnapshotProcessed: { type: Boolean, default: false, select: false },
    checkInDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkOutDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    confirmedAt: Date,
    freeCancelDeadline: { type: Date }, 
    refundType: { type: String, default: 'full_100' },
    createdAt: { type: Date, default: Date.now }
});

const reviewSchema = new mongoose.Schema({
    hotelName: { type: String, required: true }, customerName: { type: String, required: true },
    email: { type: String, required: true }, rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true }, createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Review = mongoose.model('Review', reviewSchema);
const bookingRecordPersistence = createBookingRecordPersistence({
    BookingModel: Booking,
    realm: process.env.RIMAL_AUTH_REALM,
    env: process.env
});

const verificationCodes = new Map();
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'management@remaltourismllc.com').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

// Public search keys are not authentication. Customer-facing routes are protected
// with IP limits; private operations use a separate server-only credential or role.
const publicSearchGuard = securityService.searchLimiter;

const adminAuthRouter = createAdminAuthRouter({
    sessions: authSessionService,
    auth: sessionAuth,
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: ADMIN_PASSWORD_HASH,
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    bookingLimiter: securityService.authLimiter
});

app.use('/api/v1/admin', adminAuthRouter);
app.use('/api/v1/admin/data', createAdminBookingRouter({ BookingModel: Booking, requireAdmin }));
app.use('/api/v1/admin/hotelbeds', createAdminHotelbedsSupplierTestRouter({
    controller: createAdminHotelbedsSupplierTestController({
        service: createAdminHotelbedsSupplierTestService({
            availabilityService: createHotelbedsAvailabilityService(),
            env: process.env
        })
    }),
    requireAdmin,
    searchLimiter: securityService.searchLimiter
}));

// Read-only BookingList reconciliation for operators. It never mutates booking
// attempts, and it stays unmounted unless the explicit operational approval
// flag is set; resolution itself remains a separate human workflow.
if (process.env.HOTELBEDS_RECONCILIATION_OPERATOR_ENABLED === 'true') {
    app.use('/api/v1/admin/hotelbeds', createHotelbedsReconciliationRouter({
        controller: createHotelbedsReconciliationController({
            service: createHotelbedsBookingReconciliationService({
                client: hotelbedsClient,
                attemptStore: createHotelbedsBookingAttemptStore(),
                env: process.env
            })
        }),
        requireAdmin,
        searchLimiter: securityService.searchLimiter
    }));
}
app.use('/api/v1/admin', requireAdmin);
app.use('/api/auth', createUserAuthRouter({
    UserModel: User,
    BookingModel: Booking,
    sessions: authSessionService,
    auth: sessionAuth,
    verificationCodes,
    sendVerificationEmail: (email, code) => sendProfessionalEmail(
        email,
        'رمز التحقق لتفعيل حسابك - رمال!',
        `<h2 dir="rtl">الكود: ${code}</h2>`
    ),
    hashPassword: password => bcrypt.hash(password, 12),
    comparePassword: (password, hash) => bcrypt.compare(password, hash),
    authLimiter: securityService.authLimiter
}));
app.use('/api/user', createUserProfileRouter({ UserModel: User, BookingModel: Booking, auth: sessionAuth }));

const hotelbedsSearchController = createSearchController({
    orchestrator: createSearchOrchestrator()
});
const hotelbedsSearchRouter = createSearchRouter({
    controller: hotelbedsSearchController,
    searchLimiter: securityService.searchLimiter
});
const hotelbedsRateReviewService = createHotelbedsRateReviewService({ env: process.env });
app.use('/api/v1/hotels', createHotelbedsRateReviewRouter({
    controller: createHotelbedsRateReviewController({ service: hotelbedsRateReviewService }),
    requireUser,
    bookingLimiter: securityService.bookingLimiter
}));
const hotelbedsBookingController = createBookingController({
    hotelbedsBookingService: createHotelbedsBookingService({
        rateReviewService: hotelbedsRateReviewService,
        persistBooking: bookingRecordPersistence.persist
    })
});
app.use('/api/v1/hotels', createHotelbedsPilotListRouter({
    controller: createHotelbedsPilotListController(),
    searchLimiter: securityService.searchLimiter
}));
app.use('/api/v1/hotels', createCheckoutSessionRouter({
    controller: checkoutSessionController,
    statusController: checkoutSessionStatusController,
    mockPaymentController: createMockHotelCheckoutPaymentController({
        service: checkoutSessionService,
        webhookHandler: createZiinaWebhookHandler({
            hotelbedsBookingService: createHotelbedsMockCheckoutBookingService()
        })
    }),
    requireUser,
    bookingLimiter: securityService.bookingLimiter
}));

// Explicitly isolated, deterministic mock search. This adapter cannot call live
// Hotelbeds/RateHawk/FX services; production supplier search has a separate route
// and the orchestrator retains all supplier approval gates.
app.use('/api/v1/hotels', createAggregateSearchRouter({
    controller: createAggregateSearchController({
        service: createMockAggregateSearchService(),
        enabled: () => process.env.MULTI_SUPPLIER_MOCK_SEARCH_ENABLED === 'true'
    }),
    access: 'public',
    searchLimiter: securityService.searchLimiter
}));

// Isolated live Hotelbeds pilot. The route is mounted independently from the
// deterministic mock and legacy RateHawk routes, and stays unavailable unless
// every database, supplier, pricing, FX, content, and pilot approval gate is set.
app.use('/api/v1/hotels', createAggregateSearchRouter({
    routePath: '/search/aggregate/live',
    controller: createAggregateSearchController({
        service: createHotelbedsLiveAggregateSearchService(),
        enabled: () => liveAggregateSearchGatesEnabled(process.env),
        requiredSchemaVersion: 2
    }),
    access: 'internal',
    internalAuth: verifyInternalAPIKey,
    searchLimiter: securityService.searchLimiter
}));

app.use('/api/v1/admin', requireAdmin);
app.use('/api/affiliate', createAffiliateBookingRouter({
    service: affiliateBookingService,
    securityService,
    requireUser
}));

// This mock-only route never calls a supplier and remains independent from
// HOTELBEDS_ENABLED. Mount it only when explicitly requested for UI development.
if (process.env.HOTELBEDS_MOCK_CERTIFICATION_ENABLED === 'true') {
    app.use('/api/hotelbeds', createHotelbedsMockCertificationRouter({
        service: hotelbedsMockCertificationService,
        searchLimiter: securityService.searchLimiter
    }));
}

// Internal pilot endpoint only. It is not wired into customer SERP/checkout and
// remains unmounted unless explicitly enabled; the service validates all gates.
if (process.env.HOTELBEDS_AVAILABILITY_PILOT_ENABLED === 'true') {
    app.use('/api/hotelbeds', createHotelbedsAvailabilityRouter({
        service: createHotelbedsAvailabilityService(),
        verifyAPIKey: verifyInternalAPIKey,
        searchLimiter: securityService.searchLimiter
    }));
}

// ==========================================
// 🚀 5. دوال مساعدة القديمة
// ==========================================
async function sendProfessionalEmail(toEmail, subject, htmlContent, attachmentBuffer, attachmentFilename) {
    const mailOptions = { from: '"شركة الرمال الدولية" <management@remaltourismllc.com>', to: toEmail, subject: subject, html: htmlContent };
    if (attachmentBuffer && attachmentFilename) {
        mailOptions.attachments = [{ filename: attachmentFilename, content: attachmentBuffer, contentType: 'application/pdf' }];
    }
    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        logger.error('Verification/notification email failed', { error: error.message, toEmail });
        return false;
    }
}

async function sendWhatsAppNotification(toPhone, messageText) {
    try { console.log(`📱 [WhatsApp API Mock]: رسالة لـ ${toPhone}: \n${messageText}`); return true; } catch (error) { return false; }
}

const fetchWithTimeout = async (url, options, timeout = 65000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
};

const sanitizeText = (str) => {
    if (!str) return 'N/A';
    return str.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]+/gu, '').trim();
};

// ==========================================
// 💬 6. نظام الدردشة الفورية (Live Chat Socket.io)
// ==========================================
registerChatSocketHandlers(io, { BookingModel: Booking, sendEmail: sendProfessionalEmail, adminEmail: ADMIN_EMAIL });

app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
    res.type('text/plain'); res.send('7b2276657273696f6e223a312c227073704964223a2230363037433038433936323146303343413343384645434133434536373733323032343633453942384639453632433843453634413741433834423943344341222c22637265617465644f6e223a313735383739313636383133377d');
});

// ==========================================
// 🔔 7. مسار الاستماع (Webhooks) لـ RateHawk
// ==========================================
app.post('/api/v1/webhooks/ratehawk', webhookService.receiveRateHawkWebhook);

// ==========================================
// 🚀 8. مسارات التوثيق (Auth) والمستخدمين
// ==========================================
app.get('/api/v1/health-check', async (req, res) => {
    res.json({ success: true, cloudServer: 'Render Backend Active with Live Chat & Multi-Supplier Engine 🚀', timestamp: new Date() });
});

// 🩺 Health/monitoring endpoint (uptime + MongoDB connection state).
app.get('/api/v1/health', (req, res) => {
    const DB_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting', 99: 'uninitialized' };
    const readyState = mongoose.connection.readyState;
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: DB_STATES[readyState] || 'unknown',
        databaseState: readyState
    });
});

// Configuration diagnostics only: never contact suppliers or reveal credentials.
app.get('/api/v1/internal/health/readiness', (req, res) => {
    const readiness = getDeploymentReadiness(process.env);
    const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting', 99: 'uninitialized' };
    const databaseState = states[mongoose.connection.readyState] || 'unknown';
    readiness.runtime = { database: databaseState };
    return res.status(readinessHttpStatus(readiness, databaseState)).json(readiness);
});

// 🌍 قائمة الوجهات لقائمة البحث المنسدلة (كانت مفقودة وتُرجع 404)
app.get('/api/v1/hotels/destinations', (req, res) => {
    res.json({
        success: true,
        destinations: [
            { code: 'DXB', name: { content: 'دبي — Dubai' } }
        ]
    });
});

app.get('/api/v1/hotels/filters', publicSearchGuard, async (req, res) => {
    try {
        const result = await ratehawkService.getFilterValues();
        return res.status(200).json({
            success: true,
            filters: result.filters,
            language: result.filters.language || [],
            country: result.filters.country || [],
            serp_filter: result.filters.serp_filter || [],
            star_rating: result.filters.star_rating || [],
            kind: result.filters.kind || [],
            cachedAt: result.fetchedAt,
            source: result.source,
            stale: result.stale
        });
    } catch (error) {
        logger.error('Hotel filter values endpoint failed', { error: error.message });
        return res.status(502).json({
            success: false,
            error: 'FILTERS_UNAVAILABLE',
            message: 'Hotel filter values are temporarily unavailable.'
        });
    }
});

app.get('/api/v1/hotels/:hid', publicSearchGuard, async (req, res) => {
    const hid = String(req.params.hid || '').trim();
    const language = req.query.language || 'en';
    if (!['ar', 'en', 'es'].includes(language)) return res.status(400).json({ success: false, error: 'INVALID_LANGUAGE' });
    if (!/^\d+$/.test(hid)) {
        return res.status(404).json({ success: false, message: 'Hotel is no longer available.' });
    }

    try {
        const hotel = await Hotel.findOne({ hid }).lean();
        if (!hotel) {
            return res.status(404).json({ success: false, message: 'Hotel is no longer available.' });
        }

        const staticData = hotel.staticData && typeof hotel.staticData === 'object'
            ? hotel.staticData
            : hotel;
        const translations = hotel.translations instanceof Map
            ? Object.fromEntries(hotel.translations)
            : hotel.translations || {};
        const translation = translations[language];
        const approvedTranslation = translation?.reviewStatus === 'approved' ? translation : null;
        if (hotel.is_closed === true || hotel.deleted === true
            || staticData.is_closed === true || staticData.deleted === true) {
            return res.status(404).json({ success: false, message: 'Hotel is no longer available.' });
        }

        return res.status(200).json({
            success: true,
            hotel: {
                ...staticData,
                name: approvedTranslation?.name || staticData.name || hotel.name || '',
                description: approvedTranslation?.description || staticData.description || '',
                city: approvedTranslation?.city || staticData.city || hotel.city || '',
                address: approvedTranslation?.address || staticData.address || hotel.address || '',
                hid: hotel.hid || staticData.hid || hid,
                hotelId: hotel.hotelId || staticData.hotelId,
                requestedLanguage: language,
                resolvedLanguage: approvedTranslation?.name ? language : 'en',
                availableLanguages: ['en', ...['ar', 'es'].filter(code => Boolean(
                    translations[code]?.reviewStatus === 'approved' && translations[code]?.name
                ))],
                image: formatHotelImage(hotel.image || staticData.image) || '',
                images: hotelImageStrings(hotel.images, hotel.images_ext, staticData.images, staticData.images_ext, hotel.image, staticData.image),
                reviews: hotel.reviews || staticData.reviews || [],
                detailed_ratings: hotel.detailed_ratings || staticData.detailed_ratings || {}
            }
        });
    } catch (error) {
        logger.error('Hotel static detail lookup failed', { hid, error: error.message });
        return res.status(500).json({ success: false, error: 'HOTEL_LOOKUP_FAILED' });
    }
});

app.get('/api/hotels/:hid/live', publicSearchGuard, async (req, res) => {
    try {
        const hotel = await ratehawkService.getSingleHotelInfo(req.params.hid);
        return res.status(200).json({ success: true, hotel });
    } catch (error) {
        if (error.ratehawkError === 'hotel_not_found') {
            return res.status(404).json({ success: false, error: 'hotel_not_found' });
        }
        logger.error('Live hotel info lookup failed', {
            hid: req.params.hid,
            error: error.message
        });
        return res.status(502).json({ success: false, error: 'HOTEL_INFO_UNAVAILABLE' });
    }
});

// ==========================================
// 🌟 9. المحرك الجديد الشامل (RateHawk + Dubai Link) مع دمج صور متعددة الخصائص
// ==========================================
app.post('/api/search/rates', publicSearchGuard, async (req, res) => {
    const body = req.body || {};
    const { checkin, checkout, hids, guests } = body;
    const displayLanguage = body.display_language || body.language || 'en';
    if (!['ar', 'en', 'es'].includes(displayLanguage)) return res.status(400).json({ success: false, error: 'INVALID_LANGUAGE' });
    if (!Array.isArray(hids) || guests === undefined || guests === null) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_SEARCH_CRITERIA',
            message: 'hids must be an array and guests are required.'
        });
    }

    try {
        const result = await ratehawkService.searchLiveRates({
            checkin,
            checkout,
            hids,
            residency: body.residency || 'ae',
            language: body.language || 'en',
            currency: body.currency || 'USD',
            guests
        });
        const hotels = Array.isArray(result)
            ? result
            : (result?.hotels || result?.data?.hotels || result?.data?.data?.hotels || []);
        const enrichedHotels = await enrichRateHotels(hotels.map(hotel => ({
            ...hotel, displayLanguage, supplierLanguage: body.language || 'en'
        })));
        const resolvedLanguages = [...new Set(enrichedHotels.map(hotel => hotel.resolvedLanguage).filter(Boolean))];
        return res.status(200).json({ success: true, ...(Array.isArray(result) ? {} : result), hotels: enrichedHotels,
            requested_language: displayLanguage, resolved_language: resolvedLanguages.length > 1 ? 'mixed' : resolvedLanguages[0] || body.language || 'en' });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_SEARCH_CRITERIA', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        logger.error('Live hotel ID search failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'SEARCH_UNAVAILABLE' });
    }
});

app.post('/api/search/rates/geo', publicSearchGuard, async (req, res) => {
    const body = req.body || {};
    const { checkin, checkout, latitude, longitude, guests } = body;
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null
        || guests === undefined || guests === null) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_SEARCH_CRITERIA',
            message: 'latitude, longitude, and guests are required.'
        });
    }

    try {
        const result = await ratehawkService.searchLiveRatesByGeo({
            checkin,
            checkout,
            latitude: Number(latitude),
            longitude: Number(longitude),
            radius: body.radius === undefined || body.radius === null ? 10000 : Number(body.radius),
            residency: body.residency || 'ae',
            language: body.language || 'en',
            currency: body.currency || 'USD',
            guests
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_SEARCH_CRITERIA', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        logger.error('Live geo hotel search failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'SEARCH_UNAVAILABLE' });
    }
});

function formatHotelImage(value) {
    return normalizeSupplierImage(value);
}

function firstHotelString(...values) {
    return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function hotelImageStrings(...values) {
    return collectSupplierImages(...values);
}

async function enrichRateHotels(hotels) {
    if (!Array.isArray(hotels) || !hotels.length) return [];

    const ids = hotels.map(hotel => hotel?.id || hotel?.hotel_id).filter(Boolean).map(String);
    const hids = hotels.map(hotel => hotel?.hid || hotel?.hotel_id || hotel?.id).filter(Boolean).map(String);
    let staticById = new Map();

    try {
        const staticHotels = await Hotel.find({
            $or: [
                ...(hids.length ? [{ hid: { $in: hids } }] : []),
                ...(ids.length ? [{ hotelId: { $in: ids } }] : [])
            ]
        }).lean();
        staticHotels.forEach(hotel => {
            [hotel.hid, hotel.hotelId].filter(Boolean).forEach(id => staticById.set(String(id), hotel));
        });
    } catch (error) {
        logger.warn('Static hotel enrichment skipped', { error: error.message });
    }

    return hotels.filter(hotel => {
        const staticHotel = staticById.get(String(hotel?.hid || hotel?.hotel_id || hotel?.id));
        return !ratehawkService.isDeletedHotel(staticHotel);
    }).map(hotel => {
        const hid = hotel?.hid || hotel?.hotel_id || hotel?.id;
        const staticHotel = staticById.get(String(hid)) || {};
        const staticData = staticHotel.staticData && typeof staticHotel.staticData === 'object'
            ? staticHotel.staticData
            : {};
        const language = hotel.displayLanguage || 'en';
        const translations = staticHotel.translations instanceof Map
            ? Object.fromEntries(staticHotel.translations)
            : staticHotel.translations || {};
        const translation = translations[language];
        const approvedTranslation = translation?.reviewStatus === 'approved' ? translation : null;
        const images = hotelImageStrings(
            hotel?.images,
            hotel?.images_ext,
            hotel?.image,
            staticHotel.images,
            staticHotel.image,
            staticData.images,
            staticData.images_ext,
            staticData.image
        );

        return {
            ...hotel,
            hid,
            name: firstHotelString(approvedTranslation?.name, hotel?.name, staticHotel.name, staticData.name, staticData.hotel_name) || 'Hotel',
            description: firstHotelString(approvedTranslation?.description, hotel?.description, staticHotel.description, staticData.description),
            city: firstHotelString(approvedTranslation?.city, hotel?.city, staticHotel.city, staticData.city),
            address: firstHotelString(approvedTranslation?.address, hotel?.address, staticHotel.address, staticData.address),
            requestedLanguage: language,
            resolvedLanguage: approvedTranslation?.name ? language : hotel.supplierLanguage || 'en',
            images,
            image: images[0] || '',
            stars: firstHotelString(hotel?.stars, hotel?.star_rating, staticHotel.stars, staticData.stars, staticData.star_rating)
        };
    });
}

app.post('/api/search/rates/region', publicSearchGuard, async (req, res) => {
    const body = req.body || {};
    const { checkin, checkout, region_id: regionId, guests } = body;
    const displayLanguage = body.display_language || body.language || 'en';
    if (!['ar', 'en', 'es'].includes(displayLanguage)) return res.status(400).json({ success: false, error: 'INVALID_LANGUAGE' });
    const numericRegionId = Number(regionId);
    if (regionId === undefined || regionId === null || !Number.isInteger(numericRegionId)
        || guests === undefined || guests === null) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_SEARCH_CRITERIA',
            message: 'region_id and guests are required.'
        });
    }

    try {
        const result = await ratehawkService.searchLiveRatesByRegion({
            checkin,
            checkout,
            region_id: numericRegionId,
            residency: body.residency || 'ae',
            language: body.language || 'en',
            currency: body.currency || 'USD',
            guests
        });
        const hotels = Array.isArray(result)
            ? result
            : (result?.hotels || result?.data?.hotels || result?.data?.data?.hotels || []);
        const enrichedHotels = await enrichRateHotels(hotels.map(hotel => ({
            ...hotel, displayLanguage, supplierLanguage: body.language || 'en'
        })));
        const resolvedLanguages = [...new Set(enrichedHotels.map(hotel => hotel.resolvedLanguage).filter(Boolean))];
        return res.status(200).json({ success: true, hotels: enrichedHotels,
            requested_language: displayLanguage, resolved_language: resolvedLanguages.length > 1 ? 'mixed' : resolvedLanguages[0] || body.language || 'en' });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_SEARCH_CRITERIA', message: error.message });
        }
        if (error.ratehawkError === 'hotels_not_found') {
            return res.status(404).json({ success: false, error: 'HOTELS_NOT_FOUND', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        logger.error('Live region hotel search failed', {
            error: error.message,
            stack: error.stack,
            regionId: numericRegionId,
            checkin,
            checkout
        });
        return res.status(502).json({ success: false, error: 'SEARCH_UNAVAILABLE' });
    }
});

app.get('/api/search/sort/:region_id', publicSearchGuard, async (req, res) => {
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(parsedLimit) ? Math.min(250, Math.max(1, parsedLimit)) : 250;
    try {
        const result = await ratehawkService.getRegionHotelSort(req.params.region_id, limit);
        return res.status(200).json({ success: true, hotels: result });
    } catch (error) {
        if (error.ratehawkError === 'hotels_not_found') {
            return res.status(404).json({ success: false, error: 'HOTELS_NOT_FOUND', message: error.message });
        }
        if (error.ratehawkError === 'invalid_params' || error instanceof TypeError) {
            return res.status(400).json({ success: false, error: 'INVALID_SORT_CRITERIA', message: error.message });
        }
        logger.error('Hotel region sort failed', {
            regionId: req.params.region_id,
            error: error.message
        });
        return res.status(502).json({ success: false, error: 'SORT_UNAVAILABLE' });
    }
});

app.get('/api/search/suggest', publicSearchGuard, async (req, res) => {
    const query = req.query.query;
    const language = req.query.language || 'en';
    const displayLanguage = req.query.display_language || language;
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 160) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_QUERY',
            message: 'query is required and must be a string.'
        });
    }

    try {
        const result = await ratehawkService.getAutocompleteSuggestions(query, language, displayLanguage);
        return res.status(200).json({ success: true, suggestions: result });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_QUERY', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        if (error.httpStatus === 400) return res.status(400).json({ success: false, error: 'INVALID_LANGUAGE' });
        logger.error('Hotel autocomplete failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'SUGGESTIONS_UNAVAILABLE' });
    }
});

app.post('/api/search/hotelpage', publicSearchGuard, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const body = req.body || {};
    const { checkin, checkout, hid, guests, match_hash: matchHash } = body;
    const numericHid = Number(hid);
    if (hid === undefined || hid === null || !Number.isSafeInteger(numericHid) || numericHid < 0 || numericHid > 9999999999
        || guests === undefined || guests === null) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_HOTELPAGE_CRITERIA',
            message: 'hid and guests are required.'
        });
    }

    try {
        const result = await ratehawkService.getHotelPageRates({
            checkin,
            checkout,
            hid: numericHid,
            residency: body.residency || 'ae',
            language: body.language || 'en',
            currency: body.currency || 'USD',
            guests,
            ...(matchHash ? { match_hash: matchHash } : {})
        });
        const hotels = Array.isArray(result)
            ? result
            : (result?.hotels || result?.data?.hotels || []);
        return res.status(200).json({
            success: true,
            hotels,
            hotel: hotels[0] || null,
            rates: hotels[0]?.rates || []
        });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_HOTELPAGE_CRITERIA', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        logger.error('Hotelpage rates lookup failed', { hid, error: error.message });
        return res.status(502).json({ success: false, error: 'HOTELPAGE_UNAVAILABLE' });
    }
});

app.post('/api/booking/prebook', publicSearchGuard, async (req, res) => {
    const body = req.body || {};
    const hash = body.hash;
    if (typeof hash !== 'string' || !hash.trim()) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_PREBOOK_CRITERIA',
            message: 'hash is required.'
        });
    }

    try {
        const result = await ratehawkService.validatePrebookRate(
            hash,
            body.price_increase_percent === undefined ? 0 : body.price_increase_percent
        );
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code)) {
            logger.warn('RateHawk hotel prebook timed out', { code: error.code });
            return res.status(504).json({
                success: false,
                error: 'PREBOOK_TIMEOUT',
                message: 'تعذر التحقق من السعر في الوقت المحدد. يرجى المحاولة مرة أخرى.'
            });
        }
        if (error.ratehawkError === 'rate_not_found') {
            return res.status(409).json({
                success: false,
                error: 'RATE_NOT_FOUND',
                message: 'The selected rate has expired or is no longer available.'
            });
        }
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_PREBOOK_CRITERIA', message: error.message });
        }
        if (error.ratehawkError === 'prebook_disabled') {
            return res.status(502).json({ success: false, error: 'PREBOOK_DISABLED', message: error.message });
        }
        logger.error('Hotel rate prebook failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'PREBOOK_UNAVAILABLE' });
    }
});

app.post('/api/booking/prebook-serp', publicSearchGuard, async (req, res) => {
    const body = req.body || {};
    const hash = body.hash;
    if (typeof hash !== 'string' || !hash.trim()) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_PREBOOK_CRITERIA',
            message: 'hash is required.'
        });
    }

    try {
        const result = await ratehawkService.validateSerpPrebookRate(
            hash,
            body.price_increase_percent === undefined ? 0 : body.price_increase_percent
        );
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code)) {
            logger.warn('RateHawk SERP prebook timed out', { code: error.code });
            return res.status(504).json({
                success: false,
                error: 'PREBOOK_TIMEOUT',
                message: 'تعذر التحقق من السعر في الوقت المحدد. يرجى المحاولة مرة أخرى.'
            });
        }
        if (error.ratehawkError === 'rate_not_found') {
            return res.status(409).json({
                success: false,
                error: 'RATE_NOT_FOUND',
                message: 'The selected rate has expired or is no longer available.'
            });
        }
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_PREBOOK_CRITERIA', message: error.message });
        }
        if (error.ratehawkError === 'prebook_from_serp_disabled') {
            return res.status(502).json({ success: false, error: 'PREBOOK_FROM_SERP_DISABLED', message: error.message });
        }
        logger.error('SERP hotel rate prebook failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'PREBOOK_UNAVAILABLE' });
    }
});

app.get('/api/payment/availability', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ enabled: false, reason: 'legacy_ziina_creation_temporarily_disabled' });
});

app.post('/api/payment/ziina/intent', requireUser, securityService.bookingLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({ success: false, error: 'legacy_ziina_creation_temporarily_disabled',
        message: 'إنشاء دفعات جديدة متوقف مؤقتًا. لا يؤثر ذلك على متابعة عمليات قائمة.' });
});

app.get('/api/payment/ziina/:reference/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Authorization');
    const token = /^Bearer ([a-f\d]{64})$/i.exec(req.get('Authorization') || '')?.[1];
    checkoutProcessService.getCheckout(req.params.reference, token).then(result => res.json(result)).catch(error => {
        const status = error.httpStatus === 503 ? 503 : 404;
        res.status(status).json({ success: false, error: status === 503 ? 'checkout_unavailable' : 'checkout_not_found' });
    });
});

app.get('/api/search/rate/:book_hash', publicSearchGuard, async (req, res) => {
    const bookHash = String(req.params.book_hash || '').trim();
    const language = req.query.language || 'en';
    if (!bookHash) {
        return res.status(400).json({ success: false, error: 'INVALID_RATE_HASH', message: 'book_hash is required.' });
    }

    try {
        const result = await ratehawkService.getRateDetailsByHash(bookHash, language);
        return res.status(200).json({ success: true, rate: result });
    } catch (error) {
        if (error.ratehawkError === 'rate_not_found') {
            return res.status(404).json({ success: false, error: 'RATE_NOT_FOUND', message: error.message });
        }
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_RATE_HASH', message: error.message });
        }
        if (error.ratehawkError === 'contract_mismatch') {
            return res.status(502).json({ success: false, error: 'CONTRACT_MISMATCH', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        logger.error('Rate lookup failed', { bookHash, error: error.message });
        return res.status(502).json({ success: false, error: 'RATE_LOOKUP_UNAVAILABLE' });
    }
});

app.use('/api/v1/hotels', hotelbedsSearchRouter);

app.post('/api/v1/hotels/search', publicSearchGuard, async (req, res) => {
    logger.info("New live secure search request received");
    try {
        const [rateHawkResult, dubaiLinkResult] = await Promise.allSettled([
            ratehawkService.fetchHotelsInChunks(req.body),
            dubailinkService.searchAvailability(req.body)
        ]);

        const rateHawkHotels = rateHawkResult.status === 'fulfilled' && rateHawkResult.value ? rateHawkResult.value : [];
        
        let dubaiLinkHotels = [];
        if (dubaiLinkResult.status === 'fulfilled' && dubaiLinkResult.value) {
            dubaiLinkHotels = Array.isArray(dubaiLinkResult.value) ? dubaiLinkResult.value : (dubaiLinkResult.value.hotelList || []);
        }

        // 🌟 الدمج السحري مع صور حقيقية غير قابلة للحظر وبخصائص متعددة
        if (dubaiLinkHotels.length > 0) {
            dubaiLinkHotels = await Promise.all(dubaiLinkHotels.map(async (apiHotel) => {
                if (apiHotel && apiHotel.hotel_code) {
                    const dbInfo = await Hotel.findOne({ hotelId: apiHotel.hotel_code.toString() });
                    
                    let uniqueFallbackName = apiHotel.hotel_code.toString() === '39619181' ? 'Citymax Hotel Al Barsha' : 
                                             apiHotel.hotel_code.toString() === '38772617' ? 'Grand Excelsior Hotel' : 
                                             `فندق دبي المميز (${apiHotel.hotel_code})`;

                    if (dbInfo) {
                        logger.info(`✅ DB Match Found for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = dbInfo.name || uniqueFallbackName;
                        apiHotel.city = dbInfo.city || 'دبي';
                        const finalImage = formatHotelImage(dbInfo.image);
                        apiHotel.image = finalImage;
                        apiHotel.thumb = finalImage;
                        apiHotel.photo = finalImage;
                    } else {
                        logger.warn(`❌ No DB Match for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = uniqueFallbackName;
                        apiHotel.city = 'دبي';
                        apiHotel.image = '';
                        apiHotel.thumb = '';
                        apiHotel.photo = '';
                    }
                }
                return apiHotel;
            }));
        }

        const allRawHotels = [...rateHawkHotels, ...dubaiLinkHotels]; 
        const cleanAndCheapestHotels = mappingService.deduplicateHotels(allRawHotels);

        return res.status(200).json({ success: true, hotelsData: cleanAndCheapestHotels });
    } catch (error) { 
        logger.error("Search Error", { error: error.message });
        res.status(500).json({ success: false, error: "Search Failed" }); 
    }
});

// 🏨 HP-on-selection: full rooms/rates (bookable book_hash) for a single hotel the
// user opened. SERP powers the listing; this powers the hotel details page.
app.post('/api/v1/hotels/:hotelId/rates', publicSearchGuard, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
        const { hotelId } = req.params;
        const result = await ratehawkService.getHotelPricing(hotelId, req.body || {});
        if (!result.success) {
            return res.status(404).json({ success: false, error: result.error || 'not_found', message: 'تعذّر جلب أسعار الغرف لهذا الفندق.' });
        }
        return res.status(200).json({
            success: true,
            hotel: {
                hotelId: result.hotelId, hid: result.hid, name: result.name,
                image: result.image, stars: result.stars,
                latitude: result.latitude, longitude: result.longitude,
                metapolicy: result.metapolicy || []
            },
            rooms: result.rooms
        });
    } catch (error) {
        logger.error('Hotel rates (HP-on-selection) failed', { error: error.message });
        return res.status(500).json({ success: false, error: 'rates_error', message: 'حدث خطأ أثناء جلب أسعار الغرف.' });
    }
});

app.post('/api/v1/hotels/recheck-and-pay', (_req, res) => {
    return res.status(410).json({ success: false, error: 'LEGACY_CHECKOUT_DISABLED', message: 'يرجى استخدام تجربة الحجز الجديدة.' });
    /*
    const { hotelId, oldPriceAED, provider, roomId } = req.body; 
    try {
        let finalValidatedPrice = oldPriceAED;
        let validatedBookHash = null;

        if (provider === 'dubailink') {
            const dlResponse = await dubailinkService.checkHotelRate(roomId); 
            if (dlResponse.response === 'EXPIRED_OR_INVALID_GROUP_ID') return res.status(400).json({ success: false, error: 'الغرفة لم تعد متاحة.' });
            if (dlResponse.response === 'RATE_CHANGED' && dlResponse.group_rooms.length > 0) {
                finalValidatedPrice = mappingService.convertToAED(dlResponse.group_rooms[0].groupPrice.amount, dlResponse.group_rooms[0].groupPrice.currency);
            }
        } else if (provider === 'ratehawk') {
            // 🔵 خطوة الـ Prebook: التحقق الحي من التوافر والسعر قبل توليد رابط الدفع
            const recheckResult = await ratehawkService.recheckHotel(req.body);
            if (!recheckResult.success) {
                // الغرفة لم تعد متاحة (sold out / rate expired)
                return res.status(400).json({ success: false, error: 'SOLD_OUT', message: 'عذراً، لم تعد هذه الغرفة متاحة. يرجى إعادة البحث واختيار غرفة أخرى.' });
            }
            finalValidatedPrice = recheckResult.finalPrice;
            validatedBookHash = recheckResult.book_hash;
        }
        
        // 🛡️ بوابة الـ 2%: ترفض أي زيادة سعر تتجاوز 2% (paymentService.validatePrice)
        const validation = await paymentService.validatePrice(oldPriceAED, finalValidatedPrice);
        if (!validation.success) return res.status(400).json(validation);

        const paymentUrl = await paymentService.createZiinaCheckout(req.body, validation.finalPrice);
        return res.status(200).json({ success: true, payment_url: paymentUrl, book_hash: validatedBookHash, validatedPriceAED: validation.finalPrice });
    } catch (error) { 
        logger.error("Recheck/Prebook failed", { error: error.message });
        res.status(500).json({ success: false, error: "فشل التحقق" }); 
    }
    */
});

app.post('/api/v1/hotels/book', requireUser, securityService.bookingLimiter, hotelbedsBookingController);

app.use('/api/owned', createOwnedBookingPdfRouter({
    BookingModel: Booking,
    HotelbedsContentModel: HotelbedsVerifiedHotelContent,
    hotelbedsDatabase: hotelbedsMockDatabase,
    env: process.env,
    puppeteer,
    templatePath: path.join(__dirname, 'voucher-template.html'),
    hotelbedsTemplatePath: path.join(__dirname, 'hotelbeds-voucher-template.html'),
    requireUser,
    requireAdmin,
    sanitizeText
}));

// The public legacy lookup and PDF were removed; vouchers now require a live
// user session and an owner+realm match (or an administrator session).
app.post('/api/bookings/lookup', requireUser, (_req, res) =>
    res.status(410).json({ success: false, error: 'legacy_booking_lookup_disabled' }));

app.post('/api/v1/reviews/create', requireUser, async (req, res) => {
    try {
        const { hotelName, rating, comment } = req.body || {};
        const user = await User.findById(req.auth.subject).lean();
        if (!user) return res.status(401).json({ success: false, error: 'unauthorized' });
        const newReview = new Review({ hotelName, customerName: user.name, email: user.email,
            rating: Number(rating), comment });
        await newReview.save();
        res.status(201).json({ success: true, message: 'تم الإضافة بنجاح!' });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 📊 مراقبة حدود RateHawk API الحية (Rate Limits) — لفريق العمليات
app.get('/api/v1/admin/ratehawk-limits', requireAdmin, async (req, res) => {
    try {
        // Array of { endpoint, is_active, is_limited, requests_number, seconds_number }
        const limits = await ratehawkService.getApiOverview();
        return res.json({ success: true, count: limits.length, limits });
    } catch (error) {
        logger.error('RateHawk overview (rate limits) failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'overview_failed', message: error.message });
    }
});

app.get('/api/v1/admin/logs/:partnerOrderId', requireAdmin, (req, res) => {
    const partnerOrderId = String(req.params.partnerOrderId || '').trim();
    if (!partnerOrderId || partnerOrderId.length > 200) {
        return res.status(400).json({ success: false, error: 'invalid_partner_order_id' });
    }

    const logs = logger.readEtgLogsForPartnerOrderId(partnerOrderId);
    return res.json({ success: true, partnerOrderId, count: logs.length, logs });
});

// ==========================================
// 🛑 مسار إلغاء الحجز (RateHawk order/cancel + تحديث قاعدة البيانات)
// ==========================================
app.use('/api/v1/bookings', createBookingRouter.createPostBookingRouter());

app.get(['/admin', '/admin.html'], (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/style.css', (req, res) => { res.sendFile(path.join(__dirname, 'style.css')); });
app.get('/logo.jpg', (req, res) => { res.sendFile(path.join(__dirname, 'logo.jpg')); });
// The frontend router resolves frontend/dist/index.html and frontend/dist/assets
// from this absolute project root, falling back to the committed root site when
// a Render deployment has not produced a local frontend build.
app.use(createFrontendRouter(path.resolve(__dirname), { Hotel }));

// ==========================================
// 🚀 11. تشغيل السيرفر المدمج
// ==========================================
const PORT = process.env.PORT || 10000;
const STARTUP_PROBE = process.env.NODE_ENV === 'test' && process.env.RIMAL_STARTUP_PROBE === 'true';
const HOST = STARTUP_PROBE ? '127.0.0.1' : '0.0.0.0';

// 🚀 ابدأ سيرفر HTTP فورًا حتى لا يسقط الموقع بالكامل إذا تأخّر اتصال قاعدة البيانات.
// (سابقًا كان server.listen داخل mongoose.connect().then فيؤدي فشل الاتصال إلى توقّف الموقع كليًا.)
server.listen(PORT, HOST, () => {
    console.log(`========================================`);
    if (STARTUP_PROBE) {
        console.log(`server-startup-probe-listening:${server.address()?.port}`);
    }
    console.log(`🚀 السيرفر المدمج يعمل على المنفذ ${server.address()?.port || PORT} مع دعم Live Chat`);
    console.log(`🌐 Multi-Supplier Engine (RateHawk + Dubai Link) is Active`);
    console.log(`🛡️  API Security Guard & Rate Limiters are Armed`);
});

// 🔗 الاتصال بقاعدة البيانات في الخلفية مع إعادة محاولة تلقائية (لا يمنع تشغيل السيرفر).
async function connectMongoWithRetry(attempt = 1) {
    try {
        await mongoose.connect(MONGO_URI);
        console.log(`✅ MongoDB Database Connected Successfully!`);
    } catch (error) {
        const delay = Math.min(30000, 2000 * attempt);
        console.error(`❌ MongoDB connection failed (attempt ${attempt}): ${error.message}. Retrying in ${delay / 1000}s...`);
        setTimeout(() => connectMongoWithRetry(attempt + 1), delay);
    }
}
mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB disconnected.'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected.'));
let stopBookingStatusWorker = () => {};
let stopCheckoutWorker = () => {};
let stopAffiliateBookingStatusWorker = () => {};
mongoose.connection.once('connected', () => {
    stopBookingStatusWorker = bookingProcessService.startBookingStatusWorker();
    stopCheckoutWorker = checkoutReconciliationService.startCheckoutWorker();
    stopAffiliateBookingStatusWorker = affiliateBookingService.startStatusWorker();
});
server.once('close', () => { stopBookingStatusWorker(); stopCheckoutWorker(); stopAffiliateBookingStatusWorker(); });
connectMongoWithRetry();
