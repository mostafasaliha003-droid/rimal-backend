require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const puppeteer = require('puppeteer'); 
const fs = require('fs'); 
const crypto = require('crypto'); 
const http = require('http'); 
const { Server } = require('socket.io'); 

// ==========================================
// 🧩 1. استدعاء خدمات المحرك الجديد
// ==========================================
const ratehawkService = require('./services/ratehawkService');
const dubailinkService = require('./services/dubailinkService'); 
const paymentService = require('./services/paymentService');
const notificationService = require('./services/notificationService'); 
const webhookService = require('./services/webhookService'); 
const logger = require('./services/loggerService'); 
const mappingService = require('./services/mappingService'); 
const securityService = require('./services/securityService'); 
const createFrontendRouter = require('./services/frontendService');
const corsPolicy = require('./services/corsPolicy');
const createBookingRouter = require('./services/bookingRoutes');
const bookingProcessService = require('./services/bookingProcessService');

const app = express();

const frontendContentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://maps.googleapis.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://npmcdn.com; script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://maps.googleapis.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://npmcdn.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: blob: https:; connect-src 'self' https: wss: https://pay.google.com;";
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', frontendContentSecurityPolicy);
    next();
});

// 🔴 السطر السحري لحل مشكلة الـ IP الوهمي على منصة Render (مهم جداً لجدار الحماية)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use('/api/v1/documents', securityService.globalLimiter, createBookingRouter.createDocumentRouter());
app.use('/api/v1/order-groups', securityService.globalLimiter, createBookingRouter.createOrderGroupRouter());
app.use('/api/v1/profiles', securityService.globalLimiter, createBookingRouter.createProfileRouter());
app.use(express.json());

// 🛡️ تطبيق جدار الحماية العام على كل السيرفر
app.use(securityService.globalLimiter);

// ==========================================
// 🛡️ 2. إعدادات الحماية (CORS Policy)
// ==========================================
app.use(cors(corsPolicy));
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
    password: { type: String, required: true },
    phone: String,
    nationality: String,
    birthYear: Number,
    points: { type: Number, default: 500 },
    savedCards: [{ cardHolder: String, maskedNumber: String, cardToken: String }],
    createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
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
    paymentMethod: String,
    companions: String, 
    status: { type: String, default: 'active' },
    cancellationPolicy: { type: String, default: 'شروط المورد مطبقة' },
    freeCancelDeadline: { type: Date }, 
    refundType: { type: String, default: 'full_100' },
    createdAt: { type: Date, default: Date.now }
});

const reviewSchema = new mongoose.Schema({
    hotelName: { type: String, required: true }, customerName: { type: String, required: true },
    email: { type: String, required: true }, rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true }, createdAt: { type: Date, default: Date.now }
});

// 🌟 تعريف هيكل الفنادق المخزنة لربطها بأسعار دبي لينك
const hotelSchema = new mongoose.Schema({
    hid: { type: String, index: true },
    hotelId: { type: String, required: true, unique: true },
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'dubailink' },
    staticData: mongoose.Schema.Types.Mixed,
    reviews: [{ type: mongoose.Schema.Types.Mixed }],
    detailed_ratings: mongoose.Schema.Types.Mixed
});

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Review = mongoose.model('Review', reviewSchema);
const Hotel = mongoose.model('Hotel', hotelSchema); // تفعيل الموديل

let verificationCodes = {}; let passwordResetCodes = {}; let updateEmailCodes = {}; let updatePasswordCodes = {};  
const ADMIN_EMAIL = 'management@remaltourismllc.com';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
let activeChatRooms = new Set();

// ==========================================
// 🛡️ 4. حارس الأمن (API Security Guard)
// ==========================================
const verifyAPIKey = (req, res, next) => {
    const clientKey = req.headers['x-api-key'];
    const serverKey = process.env.REMAL_SECURE_KEY; 
    
    if (!serverKey || !clientKey || clientKey !== serverKey) {
        logger.warn(`Blocked unauthorized access attempt`, { ip: req.ip }); 
        return res.status(403).json({ success: false, error: "Access Denied: Invalid API Key" });
    }
    next(); 
};

// ==========================================
// 🚀 5. دوال مساعدة القديمة
// ==========================================
async function sendProfessionalEmail(toEmail, subject, htmlContent, attachmentBuffer, attachmentFilename) {
    const mailOptions = { from: '"شركة الرمال الدولية" <management@remaltourismllc.com>', to: toEmail, subject: subject, html: htmlContent };
    if (attachmentBuffer && attachmentFilename) {
        mailOptions.attachments = [{ filename: attachmentFilename, content: attachmentBuffer, contentType: 'application/pdf' }];
    }
    try { await transporter.sendMail(mailOptions); } catch (error) { console.error('❌ خطأ البريد:', error); }
}

async function sendWhatsAppNotification(toPhone, messageText) {
    try { console.log(`📱 [WhatsApp API Mock]: رسالة لـ ${toPhone}: \n${messageText}`); return true; } catch (error) { return false; }
}

function generateHotelbedsSignature() {
    const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
    const secret = '3eQESu8wOA'; 
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');
    return { apiKey, signature };
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
io.on('connection', (socket) => {
    socket.on('join_chat', async (data) => {
        const { referenceCode, clientName } = data;
        try {
            const booking = await Booking.findOne({ bookingReference: (referenceCode || '').trim(), customerName: new RegExp((clientName || '').trim(), 'i') });
            if (booking) {
                socket.join(referenceCode); activeChatRooms.add(referenceCode);
                socket.emit('chat_joined', { success: true, message: 'تم التحقق من الحجز بنجاح. أهلاً بك.' });
                io.to('admin_chat_room').emit('new_chat_room', { referenceCode, customerName: booking.customerName });
            } else {
                socket.emit('chat_joined', { success: false, message: 'عذراً، بيانات الحجز أو الاسم غير مطابقة.' });
            }
        } catch (e) { socket.emit('chat_joined', { success: false, message: 'حدث خطأ.' }); }
    });

    socket.on('admin_join', () => { socket.join('admin_chat_room'); socket.emit('active_rooms_list', Array.from(activeChatRooms)); });

    socket.on('send_message', async (data) => {
        const { referenceCode, sender, message } = data;
        if(!referenceCode) return;
        activeChatRooms.add(referenceCode);
        io.to(referenceCode).emit('receive_message', { sender, message, time: new Date() });
        io.to('admin_chat_room').emit('receive_message', { referenceCode, sender, message, time: new Date() });
        
        try {
            const booking = await Booking.findOne({ bookingReference: referenceCode });
            if (booking && sender !== 'الإدارة (Remal)') {
                const adminChatEmailHtml = `<div dir="rtl" style="font-family:Cairo; padding:20px; background:#f0f8ff;"><h2>💬 استفسار شات جديد!</h2><p><b>مرجع:</b> ${booking.bookingReference}</p><p><b>العميل:</b> ${booking.customerName}</p><p><b>رسالة:</b> ${message}</p></div>`;
                await sendProfessionalEmail(ADMIN_EMAIL, `استفسار شات جديد من ${booking.customerName}`, adminChatEmailHtml);
            }
        } catch (mailErr) {}
    });
});

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

app.post('/api/auth/register-send-code', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, error: 'البريد مسجل مسبقاً!' });
        
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        verificationCodes[email] = { ...req.body, password: bcrypt.hashSync(req.body.password || '123456', 8), code, expires: Date.now() + 10 * 60000 };

        await sendProfessionalEmail(email, 'رمز التحقق لتفعيل حسابك - رمال!', `<h2 dir="rtl">الكود: ${code}</h2>`);
        res.json({ success: true, message: 'تم إرسال كود التحقق!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/verify-and-register', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const record = verificationCodes[email];
        if (!record || record.code !== req.body.code || Date.now() > record.expires) return res.status(400).json({ success: false, error: 'كود غير صحيح' });
        
        let user = new User({ name: record.name, email, password: record.password, phone: record.phone, nationality: record.nationality, birthYear: record.birthYear, points: 500 });
        await user.save();
        delete verificationCodes[email];
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        let user = await User.findOne({ email });
        if (!user || !bcrypt.compareSync(req.body.password, user.password)) return res.status(400).json({ success: false, error: 'بيانات الدخول غير صحيحة' });
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone, savedCards: user.savedCards } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/user/profile', async (req, res) => {
    try {
        const email = (req.query.email || '').toLowerCase().trim();
        let user = await User.findOne({ email });
        if(!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        let bookings = await Booking.find({ email: email }).sort({ createdAt: -1 });
        res.json({ success: true, profile: { name: user.name, email: user.email, points: user.points, phone: user.phone, savedCards: user.savedCards }, bookings });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
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

app.get('/api/v1/hotels/filters', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

app.get('/api/v1/hotels/:hid', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
    const hid = String(req.params.hid || '').trim();
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
        if (hotel.is_closed === true || hotel.deleted === true
            || staticData.is_closed === true || staticData.deleted === true) {
            return res.status(404).json({ success: false, message: 'Hotel is no longer available.' });
        }

        return res.status(200).json({
            success: true,
            hotel: {
                ...staticData,
                hid: hotel.hid || staticData.hid || hid,
                hotelId: hotel.hotelId || staticData.hotelId,
                image: formatHotelImage(hotel.image || staticData.image) || DEFAULT_HOTEL_IMAGE,
                images: hotelImageStrings(hotel.images, staticData.images, staticData.images_ext, hotel.image, staticData.image),
                reviews: hotel.reviews || staticData.reviews || [],
                detailed_ratings: hotel.detailed_ratings || staticData.detailed_ratings || {}
            }
        });
    } catch (error) {
        logger.error('Hotel static detail lookup failed', { hid, error: error.message });
        return res.status(500).json({ success: false, error: 'HOTEL_LOOKUP_FAILED' });
    }
});

app.get('/api/hotels/:hid/live', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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
app.post('/api/search/rates', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
    const body = req.body || {};
    const { checkin, checkout, hids, guests } = body;
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
        return res.status(200).json({ success: true, ...result });
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

app.post('/api/search/rates/geo', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

const DEFAULT_HOTEL_IMAGE = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80';

function formatHotelImage(value) {
    const raw = typeof value === 'string' ? value : value?.url || value?.src || '';
    if (!raw.trim()) return '';
    const image = raw.trim().replace(/\{size\}/gi, '1024x768');
    if (image.startsWith('//')) return `https:${image}`;
    if (/^https?:\/\//i.test(image)) return image;
    return `https://cdn.worldota.net/2048x1536/${image.replace(/^\/+/, '')}`;
}

function firstHotelString(...values) {
    return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function hotelImageStrings(...values) {
    return values.flatMap(value => {
        const items = Array.isArray(value) ? value : [value];
        return items.map(formatHotelImage).filter(Boolean);
    }).filter((image, index, images) => images.indexOf(image) === index);
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

    return hotels.map(hotel => {
        const hid = hotel?.hid || hotel?.hotel_id || hotel?.id;
        const staticHotel = staticById.get(String(hid)) || {};
        const staticData = staticHotel.staticData && typeof staticHotel.staticData === 'object'
            ? staticHotel.staticData
            : {};
        const images = hotelImageStrings(
            hotel?.images,
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
            name: firstHotelString(hotel?.name, staticHotel.name, staticData.name, staticData.hotel_name) || 'Hotel',
            images: images.length ? images : [DEFAULT_HOTEL_IMAGE],
            image: images[0] || DEFAULT_HOTEL_IMAGE,
            stars: firstHotelString(hotel?.stars, hotel?.star_rating, staticHotel.stars, staticData.stars, staticData.star_rating)
        };
    });
}

app.post('/api/search/rates/region', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
    const body = req.body || {};
    const { checkin, checkout, region_id: regionId, guests } = body;
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
        const enrichedHotels = await enrichRateHotels(hotels);
        return res.status(200).json({ success: true, hotels: enrichedHotels });
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

app.get('/api/search/sort/:region_id', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

app.get('/api/search/suggest', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
    const query = req.query.query;
    const language = req.query.language || 'en';
    if (typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_QUERY',
            message: 'query is required and must be a string.'
        });
    }

    try {
        const result = await ratehawkService.getAutocompleteSuggestions(query, language);
        return res.status(200).json({ success: true, suggestions: result });
    } catch (error) {
        if (error.ratehawkError === 'invalid_params') {
            return res.status(400).json({ success: false, error: 'INVALID_QUERY', message: error.message });
        }
        if (error.ratehawkError === 'core_search_error') {
            return res.status(502).json({ success: false, error: 'CORE_SEARCH_ERROR', message: error.message });
        }
        logger.error('Hotel autocomplete failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'SUGGESTIONS_UNAVAILABLE' });
    }
});

app.post('/api/search/hotelpage', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
    const body = req.body || {};
    const { checkin, checkout, hid, guests, match_hash: matchHash } = body;
    const numericHid = Number(hid);
    if (hid === undefined || hid === null || !Number.isSafeInteger(numericHid) || numericHid < 0 || numericHid > 0xFFFFFFFF
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

app.post('/api/booking/prebook', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

app.post('/api/booking/prebook-serp', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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
    res.json({ enabled: process.env.PAYMENT_CHECKOUT_ENABLED === 'true' && !!process.env.ZIINA_API_KEY });
});

app.post('/api/payment/ziina/intent', verifyAPIKey, securityService.bookingLimiter, async (req, res) => {
    if (process.env.PAYMENT_CHECKOUT_ENABLED !== 'true') {
        return res.status(503).json({ success: false, error: 'PAYMENTS_UNAVAILABLE', message: 'الدفع الإلكتروني غير متاح حالياً. لم يتم خصم أي مبلغ. يرجى التواصل مع فريق الحجوزات.' });
    }
    const body = req.body || {};
    const sourceAmount = Number(body.total);
    const currency = String(body.currency || 'AED').toUpperCase();
    const supportedCurrencies = new Set(['AED']);
    const amount = sourceAmount;
    if (!Number.isFinite(sourceAmount) || sourceAmount <= 0 || !supportedCurrencies.has(currency) || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_PAYMENT_AMOUNT',
            message: 'A positive supported-currency booking total is required.'
        });
    }
    if (!body.hid || !body.book_hash || !body.guest?.email) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_PAYMENT_CONTEXT',
            message: 'Hotel, room, and guest details are required.'
        });
    }

    try {
        const prebook = await ratehawkService.validatePrebookRate(body.book_hash, 0);
        const validated = paymentService.resolveValidatedPayment(prebook, { ...body, currency });
        const paymentUrl = await paymentService.createZiinaCheckout({
            ...body,
            book_hash: validated.book_hash,
            bookingReference: body.bookingReference || `RML-${Date.now()}`
        }, validated.amount);
        return res.status(200).json({ success: true, payment_url: paymentUrl, amount: validated.amount, currency: 'AED' });
    } catch (error) {
        if (error.message === 'RATE_CHANGED' || error.ratehawkError === 'rate_not_found') {
            return res.status(409).json({ success: false, error: 'RATE_CHANGED', message: 'تغير العرض أو لم يعد متاحاً. ارجع لاختيار الغرفة بالسعر الحالي بالدرهم.' });
        }
        logger.error('Ziina payment intent failed', { error: error.message, hid: body.hid });
        return res.status(502).json({ success: false, error: 'PAYMENT_INTENT_FAILED', message: 'تعذر تجهيز رابط الدفع.' });
    }
});

app.get('/api/search/rate/:book_hash', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

app.post('/api/v1/hotels/search', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

                    let defaultImage = "https://cf.bstatic.com/xdata/images/hotel/max1024x768/33036666.jpg?k=3f4e2f819446d61688abcb51b1473db2f6afc949704dbabf3d82a1738be789f2&o=&hp=1";
                    
                    if (apiHotel.hotel_code.toString() === '38772617') {
                        defaultImage = "https://cf.bstatic.com/xdata/images/hotel/max1024x768/35165972.jpg?k=c6fa07659695d3dc685511b81628178c7c73a628003f0b2fbebb9f1cd2fc151f&o=&hp=1";
                    }

                    if (dbInfo) {
                        logger.info(`✅ DB Match Found for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = dbInfo.name || uniqueFallbackName;
                        apiHotel.city = dbInfo.city || 'دبي';
                        // حقن الصورة الحقيقية إذا وجدت أو الافتراضية الموثوقة
                        let finalImage = (dbInfo.image && dbInfo.image.startsWith('http')) ? dbInfo.image : defaultImage;
                        apiHotel.image = finalImage;
                        apiHotel.thumb = finalImage; // إضافة لضمان التوافق
                        apiHotel.photo = finalImage; // إضافة لضمان التوافق
                    } else {
                        logger.warn(`❌ No DB Match for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = uniqueFallbackName;
                        apiHotel.city = 'دبي';
                        apiHotel.image = defaultImage;
                        apiHotel.thumb = defaultImage; // إضافة لضمان التوافق
                        apiHotel.photo = defaultImage; // إضافة لضمان التوافق
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
app.post('/api/v1/hotels/:hotelId/rates', verifyAPIKey, securityService.searchLimiter, async (req, res) => {
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

app.post('/api/v1/hotels/recheck-and-pay', verifyAPIKey, securityService.bookingLimiter, async (req, res) => {
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

app.post('/api/v1/hotels/book', verifyAPIKey, securityService.bookingLimiter, async (req, res) => {
    return res.status(410).json({ success: false, error: 'SERVER_CONFIRMATION_REQUIRED', message: 'لا يمكن تأكيد الحجز من المتصفح. يرجى التواصل مع فريق الحجوزات.' });
    /*
    const bookingDetails = req.body;
    try {
        // 🛡️ لا يُنفَّذ الحجز إلا بعد دفع ناجح (visa) أو عند اختيار الدفع في الفندق (Pay at Hotel)
        const method = String(bookingDetails.paymentMethod || '').toLowerCase();
        const isPayAtHotel = !['visa', 'card', 'online', 'ziina'].includes(method);
        const paymentConfirmed = bookingDetails.paymentStatus === 'success' || bookingDetails.paymentConfirmed === true;
        if (!isPayAtHotel && !paymentConfirmed) {
            return res.status(402).json({ success: false, error: 'PAYMENT_REQUIRED', message: 'لا يمكن تأكيد الحجز قبل إتمام عملية الدفع.' });
        }

        let finalHCN;
        let supplierReference = 'Pending';
        let supplierStatus = 'Pending';

        if (bookingDetails.provider === 'dubailink') {
            finalHCN = (await dubailinkService.bookHotel(bookingDetails)).booking_reference; 
            supplierReference = finalHCN || 'Pending';
            supplierStatus = 'Confirmed';
        } else {
            // 🔵 RateHawk: Create + Start + Check (polling) للحجز.
            // - دفع بالبطاقة: نستخدم الـ book_hash المُثبَّت مسبقاً في مسار recheck-and-pay (لا نكرر الـ Prebook بعد الدفع).
            // - الدفع في الفندق: لا يوجد Prebook سابق، لذا نُثبّت السعر الآن قبل الحجز.
            let bookHashToUse = bookingDetails.book_hash;
            if (!bookHashToUse) {
                const pre = await ratehawkService.recheckHotel(bookingDetails);
                if (!pre.success) {
                    return res.status(400).json({ success: false, error: 'SOLD_OUT', message: 'عذراً، لم تعد هذه الغرفة متاحة للحجز.' });
                }
                bookHashToUse = pre.book_hash;
            }
            const booking = await ratehawkService.bookHotel({ ...bookingDetails, book_hash: bookHashToUse });
            if (!booking.success) {
                return res.status(400).json({ success: false, error: booking.status || 'BOOKING_FAILED', message: 'تعذر تأكيد الحجز لدى المورد. لم يتم خصم أي مبلغ من طرفنا.' });
            }
            finalHCN = booking.hcn;                               // partner_order_id (مرجعنا)
            supplierReference = booking.hcn;
            supplierStatus = booking.status === 'confirmed' ? 'CONFIRMED' : 'PROCESSING';
        }

        // 🔴 تحديث لحفظ كل بيانات الحجز لتوليد PDF لاحقاً بشكل سليم
        const newBooking = new Booking({ 
            bookingReference: finalHCN || ('RML-' + Date.now()), 
            supplierReference: supplierReference || 'Pending', 
            supplierStatus: supplierStatus,
            provider: bookingDetails.provider || 'ratehawk',
            hotelName: bookingDetails.hotelName || 'Unknown Hotel', 
            customerName: bookingDetails.guestName || bookingDetails.customerName || "ضيفنا", 
            email: bookingDetails.email || bookingDetails.holderEmail || "customer@example.com", 
            phone: bookingDetails.phone || bookingDetails.holderPhone || "",
            roomType: bookingDetails.roomName || 'غرفة قياسية',
            boardType: bookingDetails.board || 'RO',
            cancellationPolicy: bookingDetails.cancellationPolicy || bookingDetails.policyText || 'شروط المورد مطبقة',
            status: 'active', 
            price: bookingDetails.price || 0
        });
        await newBooking.save();

        const pdfBuffer = await notificationService.generateVoucher(bookingDetails, finalHCN);
        await notificationService.sendEmailConfirmation(newBooking.email, newBooking.customerName, finalHCN, pdfBuffer);

        return res.status(200).json({ success: true, hcn: finalHCN, supplierStatus });
    } catch (error) { 
        logger.error("Booking Failed", { error: error.message });
        if (error.code === 'invalid_upsells') {
            return res.status(400).json({ success: false, error: 'INVALID_UPSELLS', message: error.message });
        }
        res.status(500).json({ success: false, error: "Booking Failed" }); 
    }
    */
});

// ==========================================
// 🚀 10. مسارات تحميل الـ PDF و التقييمات والإدارة
// ==========================================
app.get('/api/bookings/pdf/:reference', async (req, res) => {
    let browser;
    try {
        const booking = await Booking.findOne({ bookingReference: req.params.reference });
        if(!booking) return res.status(404).send('Booking not found');

        let voucherHtml = fs.readFileSync(path.join(__dirname, 'voucher-template.html'), 'utf8');
        
        let cleanHotelName = sanitizeText(booking.hotelName);

        // 🔴 تعبئة كافة الحقول المطلوبة في القالب الفاخر
        voucherHtml = voucherHtml
            .replace(/{{bookingReference}}/g, booking.bookingReference)
            .replace(/{{hotelName}}/g, cleanHotelName)
            .replace(/{{encodedHotelName}}/g, encodeURIComponent(cleanHotelName))
            .replace('{{customerName}}', booking.customerName || 'N/A')
            .replace('{{customerPhone}}', booking.phone || 'N/A')
            .replace('{{customerEmail}}', booking.email || 'N/A')
            .replace('{{roomBed}}', booking.roomType || 'غرفة فندقية')
            .replace('{{boardType}}', booking.boardType || 'N/A')
            .replace('{{price}}', booking.price)
            .replace('{{policyText}}', sanitizeText(booking.cancellationPolicy));

        browser = await puppeteer.launch({ 
            headless: true, 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });
        
        const page = await browser.newPage();
        await page.setContent(voucherHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' } });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Rimal-Voucher-${booking.bookingReference}.pdf`);
        res.send(pdfBuffer);
    } catch (e) { 
        res.status(500).send('Error generating PDF'); 
    } finally { 
        if (browser) await browser.close(); 
    }
});

app.post('/api/v1/reviews/create', async (req, res) => {
    try {
        const { email, customerName, hotelName, rating, comment } = req.body;
        const newReview = new Review({ hotelName, customerName, email: email.toLowerCase().trim(), rating: Number(rating), comment });
        await newReview.save();
        res.status(201).json({ success: true, message: 'تم الإضافة بنجاح!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/v1/admin/stats', async (req, res) => {
    try {
        const totalBookings = await Booking.countDocuments();
        const activeBookings = await Booking.countDocuments({ status: 'active' });
        res.json({ success: true, stats: { totalBookings, activeBookings } });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 📊 مراقبة حدود RateHawk API الحية (Rate Limits) — لفريق العمليات
app.get('/api/v1/admin/ratehawk-limits', verifyAPIKey, async (req, res) => {
    try {
        // Array of { endpoint, is_active, is_limited, requests_number, seconds_number }
        const limits = await ratehawkService.getApiOverview();
        return res.json({ success: true, count: limits.length, limits });
    } catch (error) {
        logger.error('RateHawk overview (rate limits) failed', { error: error.message });
        return res.status(502).json({ success: false, error: 'overview_failed', message: error.message });
    }
});

app.get('/api/v1/admin/logs/:partnerOrderId', verifyAPIKey, (req, res) => {
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
app.use(createFrontendRouter(__dirname));

// ==========================================
// 🚀 11. تشغيل السيرفر المدمج
// ==========================================
const PORT = process.env.PORT || 10000;

// 🚀 ابدأ سيرفر HTTP فورًا حتى لا يسقط الموقع بالكامل إذا تأخّر اتصال قاعدة البيانات.
// (سابقًا كان server.listen داخل mongoose.connect().then فيؤدي فشل الاتصال إلى توقّف الموقع كليًا.)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`🚀 السيرفر المدمج يعمل على المنفذ ${PORT} مع دعم Live Chat`);
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
mongoose.connection.once('connected', () => {
    stopBookingStatusWorker = bookingProcessService.startBookingStatusWorker();
});
server.once('close', () => stopBookingStatusWorker());
connectMongoWithRetry();
