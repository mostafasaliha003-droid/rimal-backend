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

const app = express();

// 🔴 السطر السحري لحل مشكلة الـ IP الوهمي على منصة Render (مهم جداً لجدار الحماية)
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// 🛡️ تطبيق جدار الحماية العام على كل السيرفر
app.use(securityService.globalLimiter);

// ==========================================
// 🛡️ 2. إعدادات الحماية (CORS Policy)
// ==========================================
const allowedOrigins = [
    'https://remalbookings.com',
    'https://www.remalbookings.com',
    'http://localhost:10000',
    'http://127.0.0.1:10000',
    'https://rimal-api.onrender.com',
    'https://mostafasaliha003-droid.github.io' 
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || origin === 'null') {
            callback(null, true);
        } else {
            console.warn(`محاولة اتصال مرفوضة من النطاق: ${origin}`);
            callback(new Error('CORS Policy: Access Denied. هذا السيرفر مخصص حصرياً لمنصة شركة الرمال الدولية.'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true 
}));

app.use(express.static(__dirname));

// ==========================================
// 🚀 3. إعدادات البريد وقاعدة البيانات
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'tliy arac oiob deej'
    }
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://mostafasaliha003_db_user:RimalBooking2026@rimalbookingdb.vln37gw.mongodb.net/rimal_db?retryWrites=true&w=majority&appName=RimalBookingDB';

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
    supplierStatus: { type: String, default: 'Pending' }, 
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
    hotelId: { type: String, required: true, unique: true },
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'dubailink' }
});

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Review = mongoose.model('Review', reviewSchema);
const Hotel = mongoose.model('Hotel', hotelSchema); // تفعيل الموديل

let verificationCodes = {}; let passwordResetCodes = {}; let updateEmailCodes = {}; let updatePasswordCodes = {};  
const ADMIN_EMAIL = 'management@remaltourismllc.com';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('RimalAdmin2026!', 8);
let activeChatRooms = new Set();

// ==========================================
// 🛡️ 4. حارس الأمن (API Security Guard)
// ==========================================
const verifyAPIKey = (req, res, next) => {
    const clientKey = req.headers['x-api-key'];
    const serverKey = process.env.REMAL_SECURE_KEY; 
    
    if (clientKey !== serverKey) {
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
app.post('/api/v1/webhooks/ratehawk', async (req, res) => {
    res.status(200).send("Webhook Received"); 
    try {
        await webhookService.handleRateHawkWebhook(req.body);
        logger.info("Webhook processed successfully"); 
    } catch (error) { logger.error("Webhook error", { error: error.message }); }
});

// ==========================================
// 🚀 8. مسارات التوثيق (Auth) والمستخدمين
// ==========================================
app.get('/api/v1/health-check', async (req, res) => {
    res.json({ success: true, cloudServer: 'Render Backend Active with Live Chat & Multi-Supplier Engine 🚀', timestamp: new Date() });
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

// ==========================================
// 🌟 9. المحرك الجديد الشامل (RateHawk + Dubai Link) مع دمج الصور
// ==========================================
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

        // 🌟 الدمج السحري مع قاعدة البيانات + خطة بديلة ذكية وفردية
        if (dubaiLinkHotels.length > 0) {
            dubaiLinkHotels = await Promise.all(dubaiLinkHotels.map(async (apiHotel) => {
                if (apiHotel && apiHotel.hotel_code) {
                    const dbInfo = await Hotel.findOne({ hotelId: apiHotel.hotel_code.toString() });
                    
                    // 💡 تحديد اسم فريد مسبقاً بناءً على الكود لتجنب الفلترة العكسية
                    let uniqueFallbackName = apiHotel.hotel_code.toString() === '39619181' ? 'Citymax Hotel Al Barsha' : 
                                             apiHotel.hotel_code.toString() === '38772617' ? 'Grand Excelsior Hotel' : 
                                             `فندق دبي المميز (${apiHotel.hotel_code})`;

                    if (dbInfo) {
                        logger.info(`✅ DB Match Found for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = dbInfo.name || uniqueFallbackName;
                        const validImage = dbInfo.image && dbInfo.image.startsWith('http') ? dbInfo.image : null;
                        apiHotel.image = validImage || "https://images.unsplash.com/photo-1551882547-ff40c0d5b9af?auto=format&fit=crop&w=600&q=80";
                        apiHotel.city = dbInfo.city || 'دبي';
                    } else {
                        logger.warn(`❌ No DB Match for Hotel: ${apiHotel.hotel_code}`);
                        apiHotel.hotel = uniqueFallbackName; // تعيين الاسم الفريد
                        // تخصيص صورة مختلفة لكل فندق لتبدو الواجهة احترافية
                        apiHotel.image = apiHotel.hotel_code.toString() === '39619181' 
                            ? "https://images.unsplash.com/photo-1551882547-ff40c0d5b9af?auto=format&fit=crop&w=600&q=80" 
                            : "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80";
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

app.post('/api/v1/hotels/recheck-and-pay', verifyAPIKey, securityService.bookingLimiter, async (req, res) => {
    const { hotelId, oldPriceAED, provider, roomId } = req.body; 
    try {
        let finalValidatedPrice = oldPriceAED;

        if (provider === 'dubailink') {
            const dlResponse = await dubailinkService.checkHotelRate(roomId); 
            if (dlResponse.response === 'EXPIRED_OR_INVALID_GROUP_ID') return res.status(400).json({ success: false, error: 'الغرفة لم تعد متاحة.' });
            if (dlResponse.response === 'RATE_CHANGED' && dlResponse.group_rooms.length > 0) {
                finalValidatedPrice = mappingService.convertToAED(dlResponse.group_rooms[0].groupPrice.amount, dlResponse.group_rooms[0].groupPrice.currency);
            }
        } else if (provider === 'ratehawk') {
            const recheckResult = await ratehawkService.recheckHotel(req.body);
            finalValidatedPrice = recheckResult.finalPrice;
        }
        
        const validation = await paymentService.validatePrice(oldPriceAED, finalValidatedPrice);
        if (!validation.success) return res.status(400).json(validation);

        const paymentUrl = await paymentService.createZiinaCheckout(req.body, validation.finalPrice);
        return res.status(200).json({ success: true, payment_url: paymentUrl });
    } catch (error) { res.status(500).json({ success: false, error: "فشل التحقق" }); }
});

app.post('/api/v1/hotels/book', verifyAPIKey, securityService.bookingLimiter, async (req, res) => {
    const bookingDetails = req.body;
    try {
        let finalHCN;
        if (bookingDetails.provider === 'dubailink') {
            finalHCN = (await dubailinkService.bookHotel(bookingDetails)).booking_reference; 
        } else {
            finalHCN = (await ratehawkService.bookHotel(bookingDetails)).hcn;
        }

        // 🔴 تحديث لحفظ كل بيانات الحجز لتوليد PDF لاحقاً بشكل سليم
        const newBooking = new Booking({ 
            bookingReference: finalHCN || ('RML-' + Date.now()), 
            supplierReference: finalHCN || 'Pending', 
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

        return res.status(200).json({ success: true, hcn: finalHCN });
    } catch (error) { res.status(500).json({ success: false, error: "Booking Failed" }); }
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

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

// ==========================================
// 🚀 11. تشغيل السيرفر المدمج
// ==========================================
const PORT = process.env.PORT || 10000;

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log(`========================================`);
        console.log(`✅ MongoDB Database Connected Successfully!`);
        server.listen(PORT, '0.0.0.0', () => { 
            console.log(`🚀 السيرفر المدمج يعمل على المنفذ ${PORT} مع دعم Live Chat`);
            console.log(`🌐 Multi-Supplier Engine (RateHawk + Dubai Link) is Active`);
            console.log(`🛡️  API Security Guard & Rate Limiters are Armed`); 
        });
    })
    .catch((error) => {
        console.error(`❌ CRITICAL ERROR: MongoDB Connection Failed!`, error.message);
    });
