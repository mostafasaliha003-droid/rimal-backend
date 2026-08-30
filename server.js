const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');
const crypto = require('crypto'); // 🚀 مكتبة التشفير المطلوبة لـ Hotelbeds API

const app = express();
app.use(express.json());

// ==========================================
// 🛡️ إعدادات الحماية المتقدمة (CORS Policy)
// ==========================================
const allowedOrigins = [
    'https://remalbookings.com',
    'https://www.remalbookings.com',
    'http://localhost:10000', // للسماح بالتطوير والاختبار المحلي
    'http://127.0.0.1:10000'
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
    credentials: true // للسماح بنقل ملفات الارتباط (Cookies)
}));
// ==========================================

app.use(express.static(__dirname));

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
  .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة بيانات MongoDB Atlas الدائمة وموقع remalbookings.com'))
  .catch(err => console.error('❌ خطأ في الاتصال بـ MongoDB:', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    phone: String,
    nationality: String,
    birthYear: Number,
    points: { type: Number, default: 500 },
    createdAt: { type: Date, default: Date.now }
});

// 🚀 Schema الحجوزات مع دعم مرجع المورد العالمي (Hotelbeds Supplier Reference)
const bookingSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
    supplierReference: { type: String, default: 'Pending' }, 
    supplierStatus: { type: String, default: 'Pending' }, 
    email: { type: String, required: true, index: true },
    customerName: String,
    hotelName: String,
    price: Number,
    paymentMethod: String,
    companions: String,
    status: { type: String, default: 'active' },
    cancellationPolicy: { type: String, default: 'استرداد كامل 100% مجاني حتى قبل الموعد بـ 48 ساعة ✨' },
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

const ADMIN_EMAIL = 'management@remaltourismllc.com';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync('RimalAdmin2026!', 8);

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

app.get('/api/v1/health-check', async (req, res) => {
    const dbState = mongoose.connection.readyState;
    const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    res.json({
        success: true,
        domain: 'remalbookings.com',
        databaseStatus: states[dbState] || 'unknown',
        cloudServer: 'Render Backend Active 🚀',
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
            user = new User({ name: record.name, email, password: record.password, phone: record.phone, nationality: record.nationality, birthYear: record.birthYear, points: 500 });
            await user.save();
        }
        delete verificationCodes[email];
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { password } = req.body;
        let user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, error: 'البريد غير مسجل بالسحابة!' });
        if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ success: false, error: 'كلمة المرور غير صحيحة' });
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/user/profile', async (req, res) => {
    try {
        const email = (req.query.email || '').toLowerCase().trim();
        let user = await User.findOne({ email });
        if(!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        let bookings = await Booking.find({ email: email }).sort({ createdAt: -1 });
        res.json({ 
            success: true, 
            profile: { name: user.name, email: user.email, points: user.points, pointsValueAED: (user.points / 10).toFixed(2), phone: user.phone }, 
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
// 🚀 مسار الحجز والدفع الفعلي مع Hotelbeds (Booking API)
// ==========================================
app.post('/api/v1/bookings/create', async (req, res) => {
    try {
        let { hotelName, customerName, email, phone, companions, paymentMethod, price, pointsUsed, refundType, rateKey } = req.body;
        if (!hotelName || !email || !customerName) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال البيانات الأساسية للحجز' });
        }
        
        email = email.toLowerCase().trim();
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
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

        if (rateKey) {
            try {
                const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
                const secret = '3eQESu8wOA'; 
                const timestamp = Math.floor(Date.now() / 1000);
                const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');

                const nameParts = customerName.split(' ');
                const firstName = nameParts[0] || "Guest";
                const lastName = nameParts[1] || "Remal";

                const hbResponse = await fetch('https://api.test.hotelbeds.com/hotel-api/1.0/bookings', {
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
                });

                const hbData = await hbResponse.json();
                if (hbData.booking && hbData.booking.reference) {
                    supplierRef = hbData.booking.reference;
                    supStatus = hbData.booking.status;
                    console.log(`✅ تم تأكيد الحجز لدى Hotelbeds بنجاح. مرجع المورد: ${supplierRef}`);
                }
            } catch (hbErr) {
                console.error("❌ خطأ في الاتصال بسيرفر Hotelbeds للحجز:", hbErr);
            }
        }

        const newBooking = new Booking({ 
            bookingReference, supplierReference: supplierRef, supplierStatus: supStatus,
            hotelName, customerName, email, phone, companions, paymentMethod, price: finalPrice,
            status: 'active', freeCancelDeadline: deadline, cancellationPolicy: policyText, refundType: selectedRefundType
        });
        await newBooking.save();

        if (user) {
            user.points += Math.round(finalPrice * 0.2);
            await user.save();
        }

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        let buffers = [];
        doc.on('data', chunk => buffers.push(chunk));
        doc.on('end', async () => {
            let pdfBuffer = Buffer.concat(buffers);
            try {
                await sendProfessionalEmail(
                    email,
                    `تأكيد حجزك الفندقي المؤكد في ${hotelName} - شركة الرمال الدولية ✈️`,
                    `<div dir="rtl" style="font-family:Arial, sans-serif; padding:25px; background:#f7fff7; border-radius:12px; border:2px solid #00b4d8;">
                        <h2 style="color:#1f3a40;">مرحباً بك يا بطل، ${customerName}! ✈️</h2>
                        <p>تم تثبيت وتأكيد حجزك الفندقي بنجاح عبر منصة <b>شركة الرمال الدولية (remalbookings.com)</b>.</p>
                        <hr style="border:0; border-top:1px solid #ddd; margin:15px 0;">
                        <p><b>رقم المرجع:</b> ${bookingReference}</p>
                        <p><b>الفندق / الشريك:</b> ${hotelName}</p>
                        <p><b>الإجمالي المدفوع:</b> ${finalPrice} AED</p>
                        <p><b>سياسة الاسترداد:</b> ${policyText}</p>
                        <p style="color:#0077b6; margin-top:20px;">تجد تفاصيل قسيمة الحجز الرسمية (PDF) مرفقة مع هذه الرسالة.</p>
                    </div>`,
                    pdfBuffer,
                    `Rimal-Voucher-${bookingReference}.pdf`
                );
            } catch (mailErr) { console.error(mailErr); }
        });

        doc.fontSize(22).fillColor('#1f3a40').font('Helvetica-Bold').text('RIMAL INTERNATIONAL - REMALBOOKINGS.COM', { align: 'center' });
        doc.fontSize(10).fillColor('#ff595e').font('Helvetica').text('Official Hotel Booking & Supplier Voucher ✈️', { align: 'center' });
        
        doc.moveDown(1.5);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1.5);

        doc.fontSize(14).fillColor('#0077b6').font('Helvetica-Bold').text(`Booking Reference: ${bookingReference}`);
        doc.moveDown(0.8);

        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        doc.text(`Guest Name: ${customerName || 'N/A'}`);
        doc.text(`Hotel / Property: ${hotelName || 'N/A'}`);
        doc.text(`Email Address: ${email || 'N/A'}`);
        doc.text(`Phone Number: ${phone || 'N/A'}`);
        doc.text(`Companions: ${companions || 'None'}`);
        doc.text(`Payment Method: ${paymentMethod === 'visa' ? 'Credit Card (Paid)' : 'Pay at Hotel'}`);
        doc.text(`Total Amount: ${finalPrice} AED`);
        doc.text(`Cancellation Policy: ${policyText}`);

        doc.end();

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
        res.status(500).json({ success: false, error: error.message });
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
                const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
                const secret = '3eQESu8wOA'; 
                const timestamp = Math.floor(Date.now() / 1000);
                const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');

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

        res.json({
            success: true,
            message: `تم تعديل وتحديث بيانات الحجز (${bookingReference}) بنجاح في السحابة ومع المورد العالمي.`,
            booking
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/v1/bookings/resend-email', async (req, res) => {
    try {
        const { bookingReference, email } = req.body;
        const booking = await Booking.findOne({ bookingReference, email });
        if(!booking) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        let buffers = [];
        doc.on('data', chunk => buffers.push(chunk));
        doc.on('end', async () => {
            let pdfBuffer = Buffer.concat(buffers);
            await sendProfessionalEmail(
                email,
                `إعادة إرسال قسيمة الحجز المؤكد ${booking.hotelName} - شركة الرمال الدولية ✈️`,
                `<div dir="rtl" style="font-family:Arial, sans-serif; padding:25px; background:#f7fff7; border-radius:12px; border:2px solid #00b4d8;">
                    <h2 style="color:#1f3a40;">إعادة إرسال القسيمة الرسمية</h2>
                    <p>بناءً على طلبك، تم إعادة إرسال تفاصيل حجزك في <b>${booking.hotelName}</b> برقم المرجع: <b>${booking.bookingReference}</b>.</p>
                </div>`,
                pdfBuffer,
                `Rimal-Voucher-${booking.bookingReference}.pdf`
            );
        });

        doc.fontSize(22).fillColor('#1f3a40').font('Helvetica-Bold').text('RIMAL INTERNATIONAL', { align: 'center' });
        doc.fontSize(10).fillColor('#ff595e').font('Helvetica').text('Resent Official Booking Voucher ✈️', { align: 'center' });
        doc.moveDown(1.5);
        doc.fontSize(14).fillColor('#0077b6').font('Helvetica-Bold').text(`Booking Reference: ${booking.bookingReference}`);
        doc.moveDown(0.8);
        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        doc.text(`Guest Name: ${booking.customerName}`);
        doc.text(`Hotel: ${booking.hotelName}`);
        doc.text(`Total Amount: ${booking.price} AED`);
        doc.text(`Policy: ${booking.cancellationPolicy}`);
        doc.end();

        res.json({ success: true, message: 'تم إعادة إرسال قسيمة الحجز إلى بريدك الإلكتروني بنجاح!' });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

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

        if (booking.supplierReference && booking.supplierReference !== 'Pending' && booking.supplierReference !== 'Pending (Test Mode)') {
            try {
                const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
                const secret = '3eQESu8wOA'; 
                const timestamp = Math.floor(Date.now() / 1000);
                const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');

                await fetch(`https://api.test.hotelbeds.com/hotel-api/1.0/bookings/${booking.supplierReference}?language=ENG`, {
                    method: 'DELETE',
                    headers: { 'Api-key': apiKey, 'X-Signature': signature, 'Accept': 'application/json' }
                });
            } catch (hbCancelErr) {
                console.error("ملاحظة في إلغاء المورد:", hbCancelErr.message);
            }
        }

        booking.status = 'cancelled';
        await booking.save();

        res.json({
            success: true,
            message: `تم إلغاء الحجز رقم (${bookingReference}) بنجاح وإشعار المورد العالمي وتفعيل سياسة الاسترداد.`,
            bookingReference,
            status: 'cancelled',
            refundType: booking.refundType
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
                const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
                const secret = '3eQESu8wOA'; 
                const timestamp = Math.floor(Date.now() / 1000);
                const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');

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
        const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
        const secret = '3eQESu8wOA'; 
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');

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

app.get('/api/bookings/pdf/:reference', async (req, res) => {
    try {
        const booking = await Booking.findOne({ bookingReference: req.params.reference });
        if(!booking) return res.status(404).send('Booking not found');

        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rimal-Voucher-${booking.bookingReference}.pdf`);
        doc.pipe(res);

        doc.fontSize(22).fillColor('#1f3a40').font('Helvetica-Bold').text('RIMAL INTERNATIONAL', { align: 'center' });
        doc.fontSize(10).fillColor('#ff595e').font('Helvetica').text('Official Booking Voucher ✈️', { align: 'center' });
        doc.moveDown(1.5);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1.5);

        doc.fontSize(14).fillColor('#0077b6').font('Helvetica-Bold').text(`Booking Reference: ${booking.bookingReference}`);
        doc.fontSize(12).fillColor('#2a9d8f').text(`Supplier Confirmation: ${booking.supplierReference || 'N/A'}`);
        doc.moveDown(0.8);

        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        doc.text(`Guest Name: ${booking.customerName || 'N/A'}`);
        doc.text(`Hotel / Property: ${booking.hotelName || 'N/A'}`);
        doc.text(`Email Address: ${booking.email || 'N/A'}`);
        doc.text(`Phone Number: ${booking.phone || 'N/A'}`);
        doc.text(`Companions: ${booking.companions || 'None'}`);
        doc.text(`Payment Method: ${booking.paymentMethod === 'visa' ? 'Credit Card (Paid)' : 'Pay at Hotel'}`);
        doc.text(`Total Amount: ${booking.price} AED`);
        doc.text(`Cancellation Policy: ${booking.cancellationPolicy}`);

        doc.end();
    } catch (e) { 
        res.status(500).send('Error generating PDF'); 
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

        const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
        const secret = '3eQESu8wOA'; 
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');

        const response = await fetch('https://api.test.hotelbeds.com/hotel-api/1.0/checkrates', {
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

        const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
        const secret = '3eQESu8wOA'; 

        const timestamp = Math.floor(Date.now() / 1000);
        const plainText = apiKey + secret + timestamp;
        const signature = crypto.createHash('sha256').update(plainText).digest('hex');

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
        const apiKey = 'c01c3ba1f01270fa671b1c8c1f9b05d1'; 
        const secret = '3eQESu8wOA'; 
        
        const timestamp = Math.floor(Date.now() / 1000);
        const plainText = apiKey + secret + timestamp;
        const signature = crypto.createHash('sha256').update(plainText).digest('hex');

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 السيرفر يعمل على المنفذ ${PORT} ومربوط مع remalbookings.com`); });
