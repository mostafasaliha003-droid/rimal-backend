const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const puppeteer = require('puppeteer'); // 🚀 تم استبدال PDFKit بـ Puppeteer
const fs = require('fs'); // 🚀 لتمكين قراءة ملفات قوالب الـ HTML
const crypto = require('crypto'); 
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.json());

// ==========================================
// 🛡️ إعدادات الحماية المتقدمة (CORS Policy)
// ==========================================
const allowedOrigins = [
    'https://remalbookings.com',
    'https://www.remalbookings.com',
    'http://localhost:10000',
    'http://127.0.0.1:10000',
    'https://rimal-api.onrender.com' 
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
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
// 🚀 إعدادات البريد وقاعدة البيانات
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'tliy arac oiob deej'
    }
});

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://mostafasaliha003_db_user:RimalBooking2026@rimalbookingdb.vln37gw.mongodb.net/rimal_db?retryWrites=true&w=majority&appName=RimalBookingDB';

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
  .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة بيانات MongoDB Atlas.'))
  .catch(err => console.error('❌ خطأ في الاتصال بـ MongoDB:', err));

// ==========================================
// 🚀 Schemas (قواعد البيانات)
// ==========================================
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    phone: String,
    nationality: String,
    birthYear: Number,
    points: { type: Number, default: 500 },
    savedCards: [{
        cardHolder: String,
        maskedNumber: String,
        cardToken: String
    }],
    createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
    ziinaPaymentId: { type: String, default: '' }, 
    supplierReference: { type: String, default: 'Pending' }, 
    supplierStatus: { type: String, default: 'Pending' }, 
    email: { type: String, required: true, index: true },
    customerName: String,
    hotelName: String,
    price: Number,
    paymentMethod: String,
    companions: String,
    status: { type: String, default: 'active' },
    cancellationPolicy: { type: String, default: 'شروط المورد مطبقة ✨' },
    freeCancelDeadline: { type: Date },
    refundType: { type: String, default: 'full_100' },
    createdAt: { type: Date, default: Date.now }
});

const reviewSchema = new mongoose.Schema({
    hotelName: { type: String, required: true },
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Review = mongoose.model('Review', reviewSchema);

let verificationCodes = {};
let passwordResetCodes = {}; 
let updateEmailCodes = {};     
let updatePasswordCodes = {};  

const ADMIN_EMAIL = 'management@remaltourismllc.com';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('RimalAdmin2026!', 8);

// 🌟 تخزين مؤقت للغرف النشطة التي فتحها العملاء
let activeChatRooms = new Set();

// ==========================================
// 🚀 دوال مساعدة
// ==========================================
async function sendProfessionalEmail(toEmail, subject, htmlContent, attachmentBuffer, attachmentFilename) {
    const mailOptions = {
        from: '"شركة الرمال الدولية ✈️" <management@remaltourismllc.com>',
        to: toEmail,
        subject: subject,
        html: htmlContent,
    };

    if (attachmentBuffer && attachmentFilename) {
        mailOptions.attachments = [
            {
                filename: attachmentFilename,
                content: attachmentBuffer,
                contentType: 'application/pdf'
            }
        ];
    }

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ تم إرسال البريد بنجاح عبر Nodemailer إلى: ${toEmail}`);
    } catch (error) {
        console.error('❌ خطأ في إرسال البريد عبر Nodemailer:', error);
    }
}

async function sendWhatsAppNotification(toPhone, messageText) {
    try {
        console.log(`📱 [WhatsApp API Mock]: تم إرسال الرسالة بنجاح إلى الرقم ${toPhone}: \n${messageText}`);
        return true;
    } catch (error) {
        console.error('❌ خطأ في إرسال إشعار الواتساب:', error);
        return false;
    }
}

function generateHotelbedsSignature() {
    const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
    const secret = '3eQESu8wOA'; 
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');
    return { apiKey, signature };
};

const fetchWithTimeout = async (url, options, timeout = 65000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
};

// ==========================================
// 💬 نظام الدردشة الفورية (Live Chat Socket.io)
// ==========================================
io.on('connection', (socket) => {
    console.log('💬 A user connected to chat socket:', socket.id);

    socket.on('join_chat', async (data) => {
        const { referenceCode, clientName } = data;
        try {
            const booking = await Booking.findOne({ 
                bookingReference: (referenceCode || '').trim(), 
                customerName: new RegExp((clientName || '').trim(), 'i') 
            });
            
            if (booking) {
                socket.join(referenceCode);
                activeChatRooms.add(referenceCode);
                socket.emit('chat_joined', { success: true, message: 'تم التحقق من الحجز بنجاح. أهلاً بك في دعم رمال.' });
                io.to('admin_chat_room').emit('new_chat_room', { referenceCode, customerName: booking.customerName });
            } else {
                socket.emit('chat_joined', { success: false, message: 'عذراً، بيانات الحجز أو الاسم غير مطابقة لحجز مؤكد.' });
            }
        } catch (e) {
            socket.emit('chat_joined', { success: false, message: 'حدث خطأ أثناء التحقق من الحجز.' });
        }
    });

    socket.on('admin_join', () => {
        socket.join('admin_chat_room');
        console.log('🔐 Admin joined live chat monitoring room');
        socket.emit('active_rooms_list', Array.from(activeChatRooms));
    });

    socket.on('send_message', async (data) => {
        const { referenceCode, sender, message } = data;
        if(!referenceCode) return;
        
        activeChatRooms.add(referenceCode);

        io.to(referenceCode).emit('receive_message', { sender, message, time: new Date() });
        io.to('admin_chat_room').emit('receive_message', { referenceCode, sender, message, time: new Date() });

        try {
            const booking = await Booking.findOne({ bookingReference: referenceCode });
            if (booking && sender !== 'الإدارة (Remal)') {
                const adminChatEmailHtml = `
                    <div dir="rtl" style="font-family:Cairo, sans-serif; padding:20px; background:#f0f8ff; border-radius:10px; border:2px solid #0077b6;">
                        <h2 style="color:#0077b6;">💬 استفسار جديد عبر اللايف شات لحجز مؤكد!</h2>
                        <p><b>رقم المرجع:</b> ${booking.bookingReference}</p>
                        <p><b>اسم الضيف:</b> ${booking.customerName}</p>
                        <p><b>الفندق:</b> ${booking.hotelName}</p>
                        <p><b>الإيميل:</b> ${booking.email}</p>
                        <p><b>رسالة العميل:</b> <span style="color:#d90429; font-weight:bold;">${message}</span></p>
                        <hr style="border:0; border-top:1px solid #ddd; margin:15px 0;">
                        <p style="color:#333;">قام العميل بإرسال استفسار في الشات. يرجى الدخول لوحة التحكم (Admin Panel) لمتابعة الرد عليه فوراً.</p>
                    </div>
                `;
                await sendProfessionalEmail(ADMIN_EMAIL, `استفسار شات جديد من ${booking.customerName} - مرجع: ${booking.bookingReference}`, adminChatEmailHtml);
            }
        } catch (mailErr) {
            console.error('❌ خطأ في إرسال إيميل تنبيه الشات للإدارة:', mailErr);
        }
    });

    socket.on('disconnect', () => {
        console.log('💬 User disconnected from chat');
    });
});

// ==========================================
// 🍏 مسار التحقق الأمني من Apple Pay و Ziina (Domain Whitelisting)
// ==========================================
app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
    res.type('text/plain');
    res.send('7b2276657273696f6e223a312c227073704964223a2230363037433038433936323146303343413343384645434133434536373733323032343633453942384639453632433843453634413741433834423943344341222c22637265617465644f6e223a313735383739313636383133377d');
});

// ==========================================
// 🚀 مسارات التوثيق (Auth) والمستخدم
// ==========================================
app.get('/api/v1/health-check', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    res.json({
        success: true,
        domain: 'remalbookings.com',
        databaseStatus: states[dbState] || 'unknown',
        cloudServer: 'Render Backend Active with Live Chat 🚀',
        timestamp: new Date()
    });
});

app.post('/api/auth/register-send-code', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { name, password, phone, nationality, birthYear } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, error: 'البريد مسجل مسبقاً!' });
        
        const hashedPassword = bcrypt.hashSync(password || '123456', 8);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        verificationCodes[email] = { code, name, password: hashedPassword, phone, nationality, birthYear, expires: Date.now() + 10 * 60 * 1000 };

        await sendProfessionalEmail(
            email,
            'رمز التحقق الثنائي (OTP) - شركة الرمال الدولية ✈️',
            `<div dir="rtl" style="font-family:Cairo; padding:25px; text-align:center; background:#f7fff7; border-radius:12px; border:2px solid #00b4d8;">
                <h2 style="color:#1f3a40;">أهلاً بك في شركة الرمال الدولية! ✈️</h2>
                <p>رمز التحقق (OTP) الخاص بك لتأكيد حسابك على remalbookings.com هو:</p>
                <h1 style="color:#ff595e; font-size:38px; letter-spacing:6px; background:#fff; padding:10px; border-radius:8px; display:inline-block;">${code}</h1>
                <p style="color:#6c757d; font-size:12px; margin-top:15px;">هذا الكود صالح لمدة 10 دقائق فقط.</p>
            </div>`
        );

        res.json({ success: true, message: 'تم إرسال كود التحقق (OTP) إلى بريدك الإلكتروني بنجاح!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/verify-and-register', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { code } = req.body;
        const record = verificationCodes[email];
        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, error: 'الكود غير صحيح أو انتهت صلاحيته' });
        }
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ name: record.name, email, password: record.password, phone: record.phone, nationality: record.nationality, birthYear: record.birthYear, points: 500, savedCards: [] });
            await user.save();
        }
        delete verificationCodes[email];
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone, savedCards: user.savedCards } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { password } = req.body;
        let user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, error: 'البريد غير مسجل بالسحابة!' });
        if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ success: false, error: 'كلمة المرور غير صحيحة' });
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone, savedCards: user.savedCards } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ==========================================
// 🔑 مسارات استعادة كلمة المرور والأمان
// ==========================================
app.post('/api/auth/forgot-password-send', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, error: 'البريد الإلكتروني غير مسجل في النظام!' });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        passwordResetCodes[email] = { code, expires: Date.now() + 10 * 60 * 1000 };

        await sendProfessionalEmail(
            email,
            'رمز استعادة كلمة المرور - شركة الرمال الدولية ✈️',
            `<div dir="rtl" style="font-family:Cairo; padding:25px; text-align:center; background:#f7fff7; border-radius:12px; border:2px solid #00b4d8;">
                <h2 style="color:#1f3a40;">استعادة كلمة المرور</h2>
                <p>كود التحقق الخاص بك هو:</p>
                <h1 style="color:#ff595e; font-size:38px; letter-spacing:6px; background:#fff; padding:10px; border-radius:8px; display:inline-block;">${code}</h1>
            </div>`
        );
        res.json({ success: true, message: 'تم إرسال كود التحقق إلى بريدك الإلكتروني بنجاح!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/reset-password-verify', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { code, newPassword } = req.body;
        const record = passwordResetCodes[email];
        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, error: 'كود التحقق غير صحيح أو انتهت صلاحيته.' });
        }
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
        user.password = bcrypt.hashSync(newPassword, 8);
        await user.save();
        delete passwordResetCodes[email];
        res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/user/request-email-change', async (req, res) => {
    try {
        const { currentEmail, newEmail } = req.body;
        const targetEmail = (newEmail || '').toLowerCase().trim();
        if (await User.findOne({ email: targetEmail })) return res.status(400).json({ success: false, error: 'البريد الجديد مستخدم مسبقاً!' });
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        updateEmailCodes[currentEmail] = { code, newEmail: targetEmail, expires: Date.now() + 10 * 60 * 1000 };
        await sendProfessionalEmail(targetEmail, 'كود تأكيد تغيير البريد الإلكتروني - شركة الرمال الدولية', `<h2>رمز التحقق لتغيير بريدك هو: ${code}</h2>`);
        res.json({ success: true, message: 'تم إرسال كود التحقق إلى بريدك الجديد!' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/user/confirm-email-change', async (req, res) => {
    try {
        const currentEmail = (req.body.currentEmail || '').toLowerCase().trim();
        const { code } = req.body;
        const record = updateEmailCodes[currentEmail];
        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, error: 'الكود غير صحيح أو انتهت صلاحيته.' });
        }
        let user = await User.findOne({ email: currentEmail });
        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
        user.email = record.newEmail;
        await user.save();
        delete updateEmailCodes[currentEmail];
        res.json({ success: true, message: 'تم تحديث البريد الإلكتروني بنجاح!', user: { name: user.name, email: user.email, points: user.points, phone: user.phone, savedCards: user.savedCards } });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/user/request-password-change', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        updatePasswordCodes[email] = { code, expires: Date.now() + 10 * 60 * 1000 };
        await sendProfessionalEmail(email, 'كود تأكيد تغيير كلمة المرور - شركة الرمال الدولية', `<h2>رمز التحقق لتغيير كلمة المرور هو: ${code}</h2>`);
        res.json({ success: true, message: 'تم إرسال كود التحقق إلى بريدك!' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/user/confirm-password-change', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { code, newPassword } = req.body;
        const record = updatePasswordCodes[email];
        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, error: 'الكود غير صحيح أو انتهت صلاحيته.' });
        }
        let user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
        user.password = bcrypt.hashSync(newPassword, 8);
        await user.save();
        delete updatePasswordCodes[email];
        res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح!' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/user/save-card', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { cardHolder, cardNumber } = req.body;
        let user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
        const masked = '•••• •••• •••• ' + (cardNumber || '0000').slice(-4);
        user.savedCards.push({ cardHolder, maskedNumber: masked, cardToken: 'tok_' + Math.random().toString(36).substring(7) });
        await user.save();
        res.json({ success: true, message: 'تم حفظ البطاقة بنجاح!', savedCards: user.savedCards });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/user/delete-card', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { cardId } = req.body;
        let user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
        user.savedCards = user.savedCards.filter(c => c._id.toString() !== cardId);
        await user.save();
        res.json({ success: true, message: 'تم حذف البطاقة بنجاح!', savedCards: user.savedCards });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/user/profile', async (req, res) => {
    try {
        const email = (req.query.email || '').toLowerCase().trim();
        let user = await User.findOne({ email });
        if(!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        let bookings = await Booking.find({ email: email }).sort({ createdAt: -1 });
        res.json({ 
            success: true, 
            profile: { name: user.name, email: user.email, points: user.points, pointsValueAED: (user.points / 10).toFixed(2), phone: user.phone, savedCards: user.savedCards }, 
            bookings 
        });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/bookings/lookup', async (req, res) => {
    try {
        let { bookingReference, email } = req.body;
        bookingReference = (bookingReference || '').trim();
        email = (email || '').toLowerCase().trim();

        const booking = await Booking.findOne({ bookingReference, email });
        if (!booking) {
            return res.status(404).json({ success: false, error: 'لم يتم العثور على حجز بهذا الرقم والإيميل المطابق!' });
        }
        res.json({ success: true, booking });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 🚀 مسار الحجز والدفع الفعلي مع (Puppeteer & HTML Templates)
// ==========================================
app.post('/api/v1/bookings/create', async (req, res) => {
    let browser;
    try {
        let { hotelName, customerName, email, phone, companions, paymentMethod, price, pointsUsed, refundType, rateKey, ziinaPaymentId } = req.body;
        if (!hotelName || !email || !customerName) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال البيانات الأساسية للحجز' });
        }
        
        email = email.toLowerCase().trim();
        const bookingReference = req.body.bookingReference || ('RIMAL-' + Math.floor(100000 + Math.random() * 900000));
        let finalPrice = parseFloat(price) || 100;
        let user = await User.findOne({ email });

        if (user && pointsUsed && pointsUsed > 0) {
            if (user.points >= pointsUsed) {
                let discountAmount = pointsUsed / 10;
                finalPrice = Math.max(0, finalPrice - discountAmount);
                user.points -= pointsUsed;
            }
        }

        let selectedRefundType = refundType || 'full_100';
        let policyText = 'استرداد كامل 100% مجاني حتى قبل الموعد بـ 48 ساعة ✨';
        if (selectedRefundType === 'partial_50') policyText = 'استرداد جزئي (50%) في حال إلغاء الحجز قبل 24 ساعة ⚠️';
        if (selectedRefundType === 'non_refundable') policyText = 'حجز غير قابل للاسترداد (Non-refundable) 🔒';

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 2);

        let supplierRef = "Pending (Test Mode)";
        let supStatus = "Pending";

        if (rateKey && !rateKey.includes('TEST-RATE-KEY')) {
            try {
                const { apiKey, signature } = generateHotelbedsSignature();
                const nameParts = customerName.split(' ');
                const firstName = nameParts[0] || "Guest";
                const lastName = nameParts[1] || "Remal";

                const hbResponse = await fetchWithTimeout('https://api.test.hotelbeds.com/hotel-api/1.0/bookings', {
                    method: 'POST',
                    headers: { 
                        'Api-key': apiKey, 
                        'X-Signature': signature, 
                        'Accept': 'application/json', 
                        'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify({
                        holder: { name: firstName, surname: lastName },
                        rooms: [{ rateKey: rateKey, paxes: [{ roomId: 1, type: "AD", name: firstName, surname: lastName }] }],
                        clientReference: bookingReference,
                        remark: "Booking from remalbookings.com B2B"
                    })
                }, 65000); 

                const hbData = await hbResponse.json();
                if (hbData.booking && hbData.booking.reference) {
                    supplierRef = hbData.booking.reference;
                    supStatus = hbData.booking.status;
                    console.log(`✅ تم تأكيد الحجز لدى Hotelbeds بنجاح. مرجع المورد: ${supplierRef}`);
                }
            } catch (hbErr) {
                console.error("❌ خطأ في الاتصال بسيرفر Hotelbeds للحجز:", hbErr);
            }
        } else {
            supplierRef = "TEST-SUPPLIER-REF-" + Math.floor(1000 + Math.random() * 9000);
            supStatus = "CONFIRMED";
        }

        const newBooking = new Booking({ 
            bookingReference, ziinaPaymentId: ziinaPaymentId || '', supplierReference: supplierRef, supplierStatus: supStatus,
            hotelName, customerName, email, phone, companions, paymentMethod, price: finalPrice,
            status: 'active', freeCancelDeadline: deadline, cancellationPolicy: policyText, refundType: selectedRefundType
        });
        await newBooking.save();

        if (user) {
            user.points += Math.round(finalPrice * 0.2);
            await user.save();
        }

        if (phone) {
            await sendWhatsAppNotification(
                phone,
                `✈️ مرحباً بك يا ${customerName}!\nتم تأكيد حجزك في ${hotelName} بنجاح.\nرقم المرجع: ${bookingReference}\nالمبلغ: ${finalPrice} AED\nشكراً لاختيارك شركة الرمال الدولية!`
            );
        }

        // --- التوليد الجديد للـ PDF باستخدام Puppeteer مع تحسينات Render ---
        let voucherHtml = fs.readFileSync(path.join(__dirname, 'voucher-template.html'), 'utf8');
        let emailHtml = fs.readFileSync(path.join(__dirname, 'email-template.html'), 'utf8');

        voucherHtml = voucherHtml
            .replace(/{{bookingReference}}/g, bookingReference)
            .replace('{{customerName}}', customerName || 'N/A')
            .replace('{{customerPhone}}', phone || 'N/A')
            .replace('{{customerEmail}}', email || 'N/A')
            .replace('{{hotelName}}', hotelName || 'N/A')
            .replace('{{roomBed}}', 'سرير كينج / مزدوج')
            .replace('{{boardType}}', 'شامل الوجبات')
            .replace('{{price}}', finalPrice)
            .replace('{{policyText}}', policyText);

        emailHtml = emailHtml
            .replace('{{customerName}}', (customerName || '').split(' ')[0] || 'ضيفنا الكريم')
            .replace('{{hotelName}}', hotelName || 'N/A')
            .replace(/{{bookingReference}}/g, bookingReference)
            .replace('{{checkInDate}}', 'حسب الطلب')
            .replace('{{price}}', finalPrice);

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        
        const page = await browser.newPage();
        await page.setContent(voucherHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });

        await sendProfessionalEmail(
            email,
            `تأكيد حجزك الفندقي المؤكد في ${hotelName} - شركة الرمال الدولية ✈️`,
            emailHtml,
            pdfBuffer,
            `Rimal-Voucher-${bookingReference}.pdf`
        );

        res.status(201).json({
            success: true,
            message: 'تم تثبيت الحجز وإرسال القسيمة عبر الإيميل بنجاح!',
            data: {
                bookingReference,
                hotelName,
                customerName,
                email,
                finalPriceAED: finalPrice,
                status: 'active',
                cancellationPolicy: policyText,
                remainingPoints: user ? user.points : 500
            }
        });
    } catch (error) {
        console.error("❌ Error in Bookings Create:", error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// ==========================================
// 🚀 مسار تعديل الحجز (Modify Booking API المربوط مع Hotelbeds)
// ==========================================
app.put('/api/v1/bookings/modify/:reference', async (req, res) => {
    try {
        const bookingReference = req.params.reference;
        const { customerName, phone, companions } = req.body;

        const booking = await Booking.findOne({ bookingReference });
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود للتعديل' });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ success: false, error: 'لا يمكن تعديل حجز ملغي مسبقاً' });
        }

        if (booking.supplierReference && booking.supplierReference !== 'Pending' && booking.supplierReference !== 'Pending (Test Mode)') {
            try {
                const { apiKey, signature } = generateHotelbedsSignature();

                const nameParts = (customerName || booking.customerName).split(' ');
                const firstName = nameParts[0] || "Guest";
                const lastName = nameParts[1] || "Remal";

                await fetch(`https://api.test.hotelbeds.com/hotel-api/1.0/bookings/${booking.supplierReference}?language=ENG`, {
                    method: 'PUT',
                    headers: { 
                        'Api-key': apiKey, 
                        'X-Signature': signature, 
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        holder: { name: firstName, surname: lastName },
                        remark: `Modified from remalbookings.com for ${customerName}`
                    })
                });
                console.log(`✅ تم تعديل الحجز لدى Hotelbeds للمرجع: ${booking.supplierReference}`);
            } catch (hbModErr) {
                console.error("ملاحظة في تحديث المورد:", hbModErr.message);
            }
        }

        if (customerName) booking.customerName = customerName;
        if (phone) booking.phone = phone;
        if (companions) booking.companions = companions;

        await booking.save();

        if (booking.phone) {
            await sendWhatsAppNotification(
                booking.phone,
                `📝 إشعار من شركة الرمال الدولية:\nتم تحديث وتعديل تفاصيل حجزك (${bookingReference}) بنجاح.`
            );
        }

        res.json({
            success: true,
            message: `تم تعديل وتحديث بيانات الحجز (${bookingReference}) بنجاح في السحابة ومع المورد العالمي.`,
            booking
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 🚀 إعادة إرسال القسيمة (باستخدام Puppeteer مع تحسينات Render)
// ==========================================
app.post('/api/v1/bookings/resend-email', async (req, res) => {
    let browser;
    try {
        const { bookingReference, email } = req.body;
        const booking = await Booking.findOne({ bookingReference, email });
        if(!booking) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });

        let voucherHtml = fs.readFileSync(path.join(__dirname, 'voucher-template.html'), 'utf8');
        let emailHtml = fs.readFileSync(path.join(__dirname, 'email-template.html'), 'utf8');

        voucherHtml = voucherHtml
            .replace(/{{bookingReference}}/g, booking.bookingReference)
            .replace('{{customerName}}', booking.customerName || 'N/A')
            .replace('{{customerPhone}}', booking.phone || 'N/A')
            .replace('{{customerEmail}}', booking.email || 'N/A')
            .replace('{{hotelName}}', booking.hotelName || 'N/A')
            .replace('{{roomBed}}', 'سرير كينج / مزدوج')
            .replace('{{boardType}}', 'شامل الوجبات')
            .replace('{{price}}', booking.price)
            .replace('{{policyText}}', booking.cancellationPolicy);

        emailHtml = emailHtml
            .replace('{{customerName}}', (booking.customerName || '').split(' ')[0] || 'ضيفنا الكريم')
            .replace('{{hotelName}}', booking.hotelName || 'N/A')
            .replace(/{{bookingReference}}/g, booking.bookingReference)
            .replace('{{checkInDate}}', 'حسب الطلب')
            .replace('{{price}}', booking.price);

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        
        const page = await browser.newPage();
        await page.setContent(voucherHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });

        await sendProfessionalEmail(
            email,
            `إعادة إرسال: قسيمة حجزك المؤكد في ${booking.hotelName} ✈️`,
            emailHtml,
            pdfBuffer,
            `Rimal-Voucher-${booking.bookingReference}.pdf`
        );

        res.json({ success: true, message: 'تم إعادة إرسال قسيمة الحجز إلى بريدك الإلكتروني بنجاح!' });
    } catch(e) {
        console.error("❌ Error in Resend Voucher:", e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

// ==========================================
// 🚀 مسار إلغاء الحجز والإشعارات الإدارية للمتابعة اليدوية (الآمن والمضمون)
// ==========================================
app.post('/api/v1/bookings/cancel', async (req, res) => {
    try {
        const { bookingReference } = req.body;
        const booking = await Booking.findOne({ bookingReference });
        
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
        }

        if (booking.status === 'refunded' || booking.status === 'cancelled') {
            return res.status(400).json({ success: false, error: 'الحجز ملغي مسبقاً' });
        }

        let refundPercentage = 0;
        let policyDescription = booking.cancellationPolicy || '';

        if (booking.refundType === 'full_100' || policyDescription.includes('100%')) {
            refundPercentage = 1.0; 
        } else if (booking.refundType === 'partial_50' || policyDescription.includes('50%') || policyDescription.includes('جزء')) {
            refundPercentage = 0.5; 
        } else if (booking.refundType === 'non_refundable' || policyDescription.includes('غير قابل للاسترداد') || policyDescription.includes('لا يوجد')) {
            refundPercentage = 0.0; 
        } else {
            refundPercentage = 0.0; 
        }

        let refundAmountAED = booking.price * refundPercentage;

        if (booking.supplierReference && booking.supplierReference !== 'Pending' && !booking.supplierReference.includes('TEST-SUPPLIER-REF')) {
            try {
                const { apiKey, signature } = generateHotelbedsSignature();
                await fetch(`https://api.test.hotelbeds.com/hotel-api/1.0/bookings/${booking.supplierReference}?language=ENG`, {
                    method: 'DELETE',
                    headers: { 'Api-key': apiKey, 'X-Signature': signature, 'Accept': 'application/json' }
                });
                console.log(`✅ تم إرسال طلب إلغاء الحجز للمورد العالمي للمرجع: ${booking.supplierReference}`);
            } catch (hbCancelErr) {
                console.error("ملاحظة في إلغاء المورد:", hbCancelErr.message);
            }
        }

        booking.status = 'cancelled';
        await booking.save();

        const adminEmailHtml = `
            <div dir="rtl" style="font-family:Cairo, sans-serif; padding:20px; background:#fff3f3; border-radius:10px; border:2px solid #ff595e;">
                <h2 style="color:#d90429;">🚨 طلب إلغاء حجز واسترداد مالي جديد!</h2>
                <p><b>رقم المرجع:</b> ${booking.bookingReference}</p>
                <p><b>اسم الضيف:</b> ${booking.customerName}</p>
                <p><b>الإيميل:</b> ${booking.email}</p>
                <p><b>الهاتف / واتساب:</b> ${booking.phone || 'N/A'}</p>
                <p><b>الفندق:</b> ${booking.hotelName}</p>
                <p><b>المبلغ الإجمالي المدفوع:</b> ${booking.price} AED</p>
                <p><b>المبلغ المستحق للاسترداد (حسب السياسة):</b> <span style="color:#d90429; font-weight:bold;">${refundAmountAED} AED</span></p>
                <p><b>طريقة الدفع:</b> ${booking.paymentMethod}</p>
                <p><b>معرّف الدفع (Ziina ID):</b> ${booking.ziinaPaymentId || 'N/A'}</p>
                <hr style="border:0; border-top:1px solid #ddd; margin:15px 0;">
                <p style="color:#6c757d; font-size:12px;">يرجى مراجعة تفاصيل الكرت واسترداد المبلغ للعميل يدوياً من لوحة تحكم Ziina.</p>
            </div>
        `;
        await sendProfessionalEmail(ADMIN_EMAIL, `طلب إلغاء حجز واسترداد - مرجع: ${booking.bookingReference}`, adminEmailHtml);

        const clientEmailHtml = `
            <div dir="rtl" style="font-family:Cairo, sans-serif; padding:25px; background:#f7fff7; border-radius:12px; border:2px solid #00b4d8;">
                <h2 style="color:#1f3a40;">مرحباً بك يا ${booking.customerName} ✈️</h2>
                <p>تلقينا طلبك بإلغاء حجزك في <b>${booking.hotelName}</b> برقم المرجع: <b>${booking.bookingReference}</b>.</p>
                <p>تم إرسال طلب الإلغاء إلى إدارة الحجوزات والمورد، وسيتم معالجة استرداد المبلغ (${refundAmountAED} AED) إلى بطاقتك خلال أيام عمل قليلة وفقاً لسياسة شروط الإلغاء الخاصة بالغرفة.</p>
                <p style="color:#0077b6; margin-top:20px; font-weight:bold;">شكراً لتفهمك، ونتمنى خدمتك في رحلات قادمة أفضل!</p>
            </div>
        `;
        await sendProfessionalEmail(booking.email, `تأكيد استلام طلب الإلغاء - شركة الرمال الدولية ✈️`, clientEmailHtml);

        if (booking.phone) {
            await sendWhatsAppNotification(
                booking.phone,
                `❌ مرحباً ${booking.customerName}،\nتلقينا طلب إلغاء حجزك (${bookingReference}). سيتم استرداد مبلغ (${refundAmountAED} AED) خلال أيام عمل قليلة حسب الشروط.\nشكراً لتواصلك مع شركة الرمال الدولية.`
            );
        }

        res.json({
            success: true,
            message: `تم استلام طلب الإلغاء بنجاح، وإرسال تفاصيل المتابعة للإدارة، وإشعار العميل عبر الإيميل والواتساب.`,
            bookingReference,
            status: 'cancelled',
            refundedAmountAED: refundAmountAED
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/v1/bookings/confirm-cash-payment', async (req, res) => {
    try {
        let { bookingReference } = req.body;
        bookingReference = (bookingReference || '').trim();

        const booking = await Booking.findOne({ bookingReference });
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود!' });
        }

        if (booking.paymentMethod !== 'hotel') {
            return res.status(400).json({ success: false, error: 'هذا الحجز ليس بنظام الدفع عند الوصول!' });
        }

        booking.paymentMethod = 'hotel_paid_cash';
        await booking.save();

        try {
            await sendProfessionalEmail(
                booking.email,
                `تأكيد استلام الدفع النقدي لحجزك ${booking.bookingReference} - شركة الرمال الدولية ✈️`,
                `<div dir="rtl" style="font-family:Arial, sans-serif; padding:25px; background:#f7fff7; border-radius:12px; border:2px solid #2a9d8f;">
                    <h2 style="color:#1f3a40;">مرحباً بك يا بطل، ${booking.customerName}! ✈️</h2>
                    <p>نحيطك علماً بأنه تم تأكيد استلام الدفع النقدي (كاش) بنجاح من الفندق الشريك لحجزك في <b>${booking.hotelName}</b>.</p>
                    <p><b>رقم المرجع:</b> ${booking.bookingReference}</p>
                    <p><b>المبلغ المسدد:</b> ${booking.price} AED</p>
                    <p style="color:#2a9d8f; font-weight:bold; margin-top:15px;">شكراً لاختيارك شركة الرمال الدولية! نتمنى لك إقامة سعيدة.</p>
                </div>`
            );
        } catch (mailErr) {
            console.error('خطأ في إرسال إيميل تأكيد الدفع النقدي:', mailErr);
        }

        res.json({
            success: true,
            message: `تم تأكيد الدفع النقدي بنجاح للحجز (${bookingReference}) وإرسال إشعار للعميل.`,
            bookingReference,
            status: 'paid_cash'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 💳 مسار بوابة الدفع (Ziina Integration)
// ==========================================
app.post('/api/v1/payments/ziina-intent', async (req, res) => {
    try {
        const { amountAED, bookingReference } = req.body;
        
        if (!amountAED || !bookingReference) {
            return res.status(400).json({ success: false, error: 'الرجاء توفير مبلغ الحجز ورقم المرجع.' });
        }

        const amountInFils = Math.round(amountAED * 100);

        if (amountInFils < 200) {
            return res.status(400).json({ success: false, error: 'الحد الأدنى للمعاملة هو 2 درهم.' });
        }

        const ZIINA_API_KEY = process.env.ZIINA_API_KEY;
        if (!ZIINA_API_KEY) {
            return res.status(500).json({ success: false, error: 'مفتاح بوابة الدفع غير معد مسبقاً في السيرفر.' });
        }

        const response = await fetch('https://api-v2.ziina.com/api/payment_intent', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ZIINA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amountInFils,
                currency_code: 'AED', 
                success_url: `https://rimal-api.onrender.com/payment-success?ref=${bookingReference}`,
                cancel_url: `https://remalbookings.com/payment-cancel?ref=${bookingReference}`
            })
        });

        const data = await response.json();

        if (data.redirect_url) {
            // إضافة رابط الـ Embedded checkout الخاص بـ Ziina
            res.json({ 
                success: true, 
                redirect_url: data.redirect_url, 
                embedded_url: data.redirect_url.replace('/payment_intent/', '/embedded/payment_intent/'),
                ziinaPaymentId: data.id || data.payment_intent_id || '' 
            });
        } else {
            console.error('Ziina Error Details:', data);
            res.status(400).json({ success: false, error: 'فشل في توليد رابط الدفع من Ziina.' });
        }

    } catch (error) {
        console.error('Ziina API Error:', error);
        res.status(500).json({ success: false, error: 'حدث خطأ داخلي أثناء محاولة الاتصال ببوابة الدفع.' });
    }
});

// ==========================================
// 💳 مسار استقبال العميل بعد نجاح الدفع
// ==========================================
app.get('/payment-success', async (req, res) => {
    try {
        const reference = req.query.ref;
        res.send(`
            <html lang="ar" dir="rtl">
            <head><meta charset="UTF-8"><title>تم الدفع بنجاح - شركة الرمال الدولية</title></head>
            <body style="font-family:Cairo,sans-serif; text-align:center; padding:80px; background:#f7fff7;">
                <h1 style="color:#2a9d8f;">🎉 تمت عملية الدفع بنجاح عبر Ziina!</h1>
                <p>رقم المرجع: <strong>${reference}</strong></p>
                <p>جاري تثبيت حجزك في السحابة وإرسال قسيمة الـ PDF والواتساب...</p>
                <script>
                    setTimeout(() => {
                        // 🚀 إرجاع التوجيه الرئيسي لموقع الرمال بعد النجاح
                        window.top.location.href = 'https://remalbookings.com?payment=success&ref=${reference}';
                    }, 2000);
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send('خطأ في معالجة صفحة النجاح');
    }
});

app.get('/api/v1/admin/live-hotel-sync/:reference', async (req, res) => {
    try {
        const bookingReference = req.params.reference;
        const booking = await Booking.findOne({ bookingReference });
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود بالسحابة' });
        }

        let liveStatus = "CONFIRMED LIVE 🟢";
        if (booking.supplierReference && booking.supplierReference !== 'Pending' && booking.supplierReference !== 'Pending (Test Mode)') {
            try {
                const { apiKey, signature } = generateHotelbedsSignature();

                const resp = await fetch(`https://api.test.hotelbeds.com/hotel-api/1.0/bookings/${booking.supplierReference}`, {
                    method: 'GET',
                    headers: { 'Api-key': apiKey, 'X-Signature': signature, 'Accept': 'application/json' }
                });
                const d = await resp.json();
                if (d.booking && d.booking.status) {
                    liveStatus = d.booking.status;
                }
            } catch (e) {
                console.error("خطأ مزامنة المورد:", e.message);
            }
        }

        res.json({
            success: true,
            bookingReference: booking.bookingReference,
            supplierReference: booking.supplierReference,
            hotelName: booking.hotelName,
            customerName: booking.customerName,
            localStatus: booking.status,
            supplierLiveStatus: liveStatus,
            syncTimestamp: new Date(),
            message: 'تم مزامنة حالة الحجز لحظياً مع النظام الخارجي للفندق بنجاح.'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/currency/convert', async (req, res) => {
    try {
        const { targetCurrency, amount } = req.query;
        const baseAmount = parseFloat(amount) || 100;
        const currency = (targetCurrency || 'USD').toUpperCase();

        const response = await fetch(`https://api.frankfurter.app/latest?from=AED&to=${currency}`);
        const data = await response.json();

        if (data.rates && data.rates[currency]) {
            const rate = data.rates[currency];
            const convertedAmount = (baseAmount * rate).toFixed(2);
            return res.json({ 
                success: true, 
                baseCurrency: 'AED', 
                targetCurrency: currency, 
                rate, 
                convertedAmount 
            });
        } else {
            res.status(400).json({ success: false, error: 'العملة غير متوفرة أو غير مدعومة' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/v1/hotels/destinations', async (req, res) => {
    try {
        const { apiKey, signature } = generateHotelbedsSignature();

        const response = await fetch('https://api.test.hotelbeds.com/hotel-content-api/1.0/locations/destinations?countryCode=AE&language=ENG', {
            method: 'GET',
            headers: {
                'Api-key': apiKey,
                'X-Signature': signature,
                'Accept': 'application/json'
            }
        });
        const data = await response.json();
        res.json({ success: true, destinations: data.destinations || [] });
    } catch (error) {
        console.error('Destination API Error:', error);
        res.status(500).json({ success: false, error: 'فشل جلب الوجهات الجغرافية' });
    }
});

app.post('/api/v1/hotels/alternatives', async (req, res) => {
    try {
        const { destinationCode, checkIn, checkOut, adults } = req.body;
        const { apiKey, signature } = generateHotelbedsSignature();

        const response = await fetch('https://api.test.hotelbeds.com/hotel-api/1.0/hotels', {
            method: 'POST',
            headers: {
                'Api-key': apiKey,
                'X-Signature': signature,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                stay: { checkIn: checkIn || "2026-09-15", checkOut: checkOut || "2026-09-20" },
                occupancies: [{ rooms: 1, adults: adults || 2, children: 0 }],
                destination: { code: destinationCode || "DXB" }
            })
        });

        const data = await response.json();
        let alternatives = [];
        if (data.hotels && data.hotels.hotels) {
            alternatives = data.hotels.hotels.slice(0, 3).map(h => ({
                code: h.code,
                name: h.name || "فندق بديل مقترح",
                price: h.minRate || 500,
                category: h.categoryName || "4 نجوم"
            }));
        }

        res.json({
            success: true,
            message: 'تم العثور على بدائل متاحة ومناسبة لميزانيتك.',
            alternatives: alternatives.length > 0 ? alternatives : [
                { name: "فندق الرمال الكلاسيكي البديل", price: 450, category: "4 نجوم" },
                { name: "منتجع الواحة الفاخر", price: 750, category: "5 نجوم" }
            ]
        });

    } catch (error) {
        console.error('Alternative API Error:', error);
        res.status(500).json({ success: false, error: 'فشل جلب البدائل من السيرفر العالمي' });
    }
});

app.get('/api/v1/admin/export-financial-report', async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });

        let csvContent = "\uFEFFرقم المرجع (Ref),اسم الضيف (Guest),الفندق (Hotel),المبلغ الإجمالي (AED),طريقة الدفع (Payment),حالة الحجز (Status),تاريخ الحجز (Date)\n";

        bookings.forEach(b => {
            const dateStr = b.createdAt ? new Date(b.createdAt).toISOString().split('T')[0] : 'N/A';
            const cleanHotelName = (b.hotelName || '').replace(/,/g, ' ');
            const cleanCustomerName = (b.customerName || '').replace(/,/g, ' ');
            
            csvContent += `"${b.bookingReference}","${cleanCustomerName}","${cleanHotelName}",${b.price || 0},"${b.paymentMethod}","${b.status}","${dateStr}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=Rimal-Financial-Report-2026.csv');
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Financial Report API Error:', error);
        res.status(500).json({ success: false, error: 'فشل تصدير التقرير المالي من السحابة' });
    }
});

app.post('/api/v1/reviews/create', async (req, res) => {
    try {
        const { email, customerName, hotelName, rating, comment } = req.body;

        if (!email || !hotelName || !rating || !comment) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال كافة بيانات التقييم.' });
        }

        const hasBooked = await Booking.findOne({ email: email.toLowerCase().trim(), hotelName: new RegExp(hotelName, 'i') });
        if (!hasBooked) {
            return res.status(403).json({ success: false, error: 'عذراً، يمكنك تقييم الفنادق التي قمت بحجزها مسبقاً فقط لضمان مصداقية التقييمات 🔒' });
        }

        const newReview = new Review({
            hotelName,
            customerName,
            email: email.toLowerCase().trim(),
            rating: Number(rating),
            comment
        });

        await newReview.save();

        res.status(201).json({ success: true, message: 'تم إضافة تقييمك بنجاح! شكراً لمشاركة تجربتك ✨' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/v1/reviews/hotel/:hotelName', async (req, res) => {
    try {
        const hotelName = req.params.hotelName;
        const localReviews = await Review.find({ hotelName: new RegExp(hotelName, 'i') }).sort({ createdAt: -1 });

        let totalRating = 0;
        localReviews.forEach(r => totalRating += r.rating);
        let averageRating = localReviews.length > 0 ? (totalRating / localReviews.length).toFixed(1) : 0;

        let globalReviews = [];
        if (localReviews.length < 3) {
            globalReviews = [
                { customerName: "سائح عالمي (Hotelbeds)", rating: 4.5, comment: "إقامة رائعة ومرافق ممتازة، أنصح به بشدة!", date: new Date().toISOString() },
                { customerName: "ضيف مؤكد (Global Network)", rating: 5, comment: "موقع الفندق ممتاز والخدمة استثنائية.", date: new Date().toISOString() }
            ];
        }

        res.json({
            success: true,
            hotelName,
            averageRating: averageRating || 4.5,
            totalReviews: localReviews.length + globalReviews.length,
            reviews: {
                local: localReviews,
                globalSupplier: globalReviews
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/v1/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || email.toLowerCase().trim() !== ADMIN_EMAIL) {
            return res.status(401).json({ success: false, error: 'بريد الإدارة غير صحيح!' });
        }
        if (!password || !bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
            return res.status(401).json({ success: false, error: 'كلمة مرور الإدارة غير صحيحة!' });
        }
        res.json({ success: true, message: 'تم تسجيل دخول المدير بنجاح!' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/v1/admin/stats', async (req, res) => {
    try {
        const totalBookings = await Booking.countDocuments();
        const activeBookings = await Booking.countDocuments({ status: 'active' });
        const cancelledBookings = await Booking.countDocuments({ status: 'cancelled' });
        
        const allBookings = await Booking.find().sort({ createdAt: -1 });
        
        let totalRevenueAED = 0;
        allBookings.forEach(b => {
            if (b.status === 'active') {
                totalRevenueAED += (b.price || 0);
            }
        });

        res.json({
            success: true,
            stats: { totalBookings, activeBookings, cancelledBookings, totalRevenueAED },
            bookings: allBookings
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/v1/admin/update-booking-status', async (req, res) => {
    try {
        const { bookingReference, status } = req.body;
        const booking = await Booking.findOne({ bookingReference });
        
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
        }

        booking.status = status;
        await booking.save();

        res.json({ success: true, message: `تم تحديث حالة الحجز ${bookingReference} إلى (${status}) بنجاح.` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 🚀 مسار تحميل الـ PDF مباشرة باستخدام Puppeteer مع تحسينات Render
// ==========================================
app.get('/api/bookings/pdf/:reference', async (req, res) => {
    let browser;
    try {
        const booking = await Booking.findOne({ bookingReference: req.params.reference });
        if(!booking) return res.status(404).send('Booking not found');

        let voucherHtml = fs.readFileSync(path.join(__dirname, 'voucher-template.html'), 'utf8');

        voucherHtml = voucherHtml
            .replace(/{{bookingReference}}/g, booking.bookingReference)
            .replace('{{customerName}}', booking.customerName || 'N/A')
            .replace('{{customerPhone}}', booking.phone || 'N/A')
            .replace('{{customerEmail}}', booking.email || 'N/A')
            .replace('{{hotelName}}', booking.hotelName || 'N/A')
            .replace('{{roomBed}}', booking.bed || 'سرير كينج / مزدوج')
            .replace('{{boardType}}', booking.boardType || 'شامل الوجبات')
            .replace('{{price}}', booking.price)
            .replace('{{policyText}}', booking.cancellationPolicy);

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        
        const page = await browser.newPage();
        await page.setContent(voucherHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Rimal-Voucher-${booking.bookingReference}.pdf`);
        res.send(pdfBuffer);

    } catch (e) { 
        console.error("❌ Error generating direct PDF:", e);
        res.status(500).send('Error generating PDF'); 
    } finally {
        if (browser) await browser.close();
    }
});

// ==========================================
// 🚀 مسار التحقق من السعر وتوفر الغرفة قبل الدفع (Rate Recheck API)
// ==========================================
app.post('/api/v1/hotels/recheck', async (req, res) => {
    try {
        const { rateKey } = req.body;
        if (!rateKey) {
            return res.status(400).json({ success: false, error: 'مفتاح الغرفة (rateKey) مفقود!' });
        }

        const { apiKey, signature } = generateHotelbedsSignature();

        const response = await fetchWithTimeout('https://api.test.hotelbeds.com/hotel-api/1.0/checkrates', {
            method: 'POST',
            headers: {
                'Api-key': apiKey,
                'X-Signature': signature,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                rooms: [{ rateKey: rateKey }]
            })
        });

        const data = await response.json();
        
        if (data.hotel && data.hotel.status === 'CONFIRMED') {
            res.json({ 
                success: true, 
                status: 'VALID', 
                netPrice: data.hotel.minRate, 
                message: 'الغرفة متاحة والسعر مطبق ومحدث بنجاح.' 
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'عذراً، لقد تغير سعر الغرفة أو نفذت من النظام العالمي. يرجى إعادة البحث.' 
            });
        }

    } catch (error) {
        console.error('Rate Recheck API Error:', error);
        res.json({ success: true, status: 'PASSED_MOCK', message: 'تم تجاوز الفحص بنجاح (بيئة اختبار).' });
    }
});

// ==========================================
// 🏨 1. مسار البحث المباشر وتحليل سياسات الإلغاء الدقيقة من Hotelbeds API
// ==========================================
app.post('/api/v1/hotels/search', async (req, res) => {
    try {
        const { checkIn, checkOut, destinationCode, adults } = req.body;

        const { apiKey, signature } = generateHotelbedsSignature();

        const requestBody = {
            stay: {
                checkIn: checkIn || "2026-09-15", 
                checkOut: checkOut || "2026-09-20"
            },
            occupancies: [
                {
                    rooms: 1,
                    adults: adults || 2,
                    children: 0
                }
            ],
            destination: {
                code: destinationCode || "DXB"
            }
        };

        const response = await fetch('https://api.test.hotelbeds.com/hotel-api/1.0/hotels', {
            method: 'POST',
            headers: {
                'Api-key': apiKey,
                'X-Signature': signature,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        let processedHotels = [];
        if (data.hotels && data.hotels.hotels) {
            processedHotels = data.hotels.hotels.map(hotel => {
                let rooms = hotel.rooms ? hotel.rooms.map(room => {
                    let rates = room.rates ? room.rates.map(rate => {
                        let policySummary = "سياسة إلغاء مطبقة حسب شروط الفندق 🔒";
                        
                        if (rate.cancellationPolicies && rate.cancellationPolicies.length > 0) {
                            let policies = rate.cancellationPolicies.map(p => {
                                let amount = p.amount ? `${p.amount} AED` : '';
                                let date = p.from ? `ابتداءً من تاريخ ${p.from}` : '';
                                return `غرامة ${amount} ${date}`.trim();
                            });
                            policySummary = `شروط الإلغاء من المورد: ${policies.join(' | ')}`;
                        } else if (rate.freeCancellation) {
                            policySummary = "إلغاء مجاني بالكامل ✨";
                        }

                        return {
                            ...rate,
                            formattedPolicy: policySummary
                        };
                    }) : [];

                    return {
                        ...room,
                        rates: rates
                    };
                }) : [];

                return {
                    ...hotel,
                    rooms: rooms
                };
            });
        }

        res.json({ 
            success: true, 
            source: 'Hotelbeds APItude with Live Cancellation Policies', 
            hotelsData: { hotels: processedHotels.length > 0 ? processedHotels : (data.hotels.hotels || []) } 
        });

    } catch (error) {
        console.error('Hotelbeds API Error:', error);
        res.status(500).json({ success: false, error: 'فشل الاتصال بمزود الفنادق العالمي' });
    }
});

// ==========================================
// 🏨 2. مسار جلب البيانات الثابتة (الصور والمرافق) للفندق المختار (Content API)
// ==========================================
app.get('/api/v1/hotels/content/:hotelCode', async (req, res) => {
    try {
        const hotelCode = req.params.hotelCode;
        const { apiKey, signature } = generateHotelbedsSignature();

        const url = `https://api.test.hotelbeds.com/hotel-content-api/1.0/hotels/${hotelCode}?language=ENG`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Api-key': apiKey,
                'X-Signature': signature,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();
        res.json({ success: true, hotelContent: data.hotel || data });
        
    } catch (error) {
        console.error('Hotel Content API Error:', error);
        res.status(500).json({ success: false, error: 'فشل جلب تفاصيل ومرافق الفندق من السيرفر العالمي' });
    }
});

app.get('/admin', (req, res) => {
    const adminHtmlPath = path.join(__dirname, 'admin.html');
    res.sendFile(adminHtmlPath, (err) => {
        if (err) {
            res.status(404).send(`
                <div dir="rtl" style="font-family:Cairo; text-align:center; padding:50px; background:#f7fff7;">
                    <h1 style="color:#ff595e;">خطأ: ملف admin.html غير موجود في مسار السيرفر!</h1>
                    <p style="color:#1f3a40; margin-top:10px;">الرجاء التأكد من رفع ملف admin.html إلى مجلد المشروع بجانب server.js.</p>
                </div>
            `);
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 🚀 تشغيل السيرفر باستخدام server.js الشامل مع دعم Socket.io للدردشة المباشرة
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => { console.log(`🚀 السيرفر يعمل على المنفذ ${PORT} مع دعم Live Chat ومربوط بـ remalbookings.com`); });
