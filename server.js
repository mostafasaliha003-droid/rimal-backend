const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// إعداد خدمة Nodemailer باستخدام بريد Gmail الحقيقي وكلمة مرور التطبيق المفعلة
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
  .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة بيانات MongoDB Atlas الدائمة'))
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

const bookingSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
    email: { type: String, required: true, index: true },
    customerName: String,
    hotelName: String,
    price: Number,
    paymentMethod: String,
    companions: String,
    status: { type: String, default: 'active' },
    cancellationPolicy: { type: String, default: 'استرداد كامل مجاني حتى قبل الموعد بـ 48 ساعة ✨' },
    freeCancelDeadline: { type: Date },
    refundType: { type: String, default: 'full' },
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

// دالة إرسال البريد الموحدة عبر Nodemailer
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
            'رمز التحقق - شركة الرمال الدولية ✈️',
            `<div dir="rtl" style="font-family:Cairo; padding:20px; text-align:center;"><h2>كود التحقق الخاص بك يا بطل:</h2><h1 style="color:#d90429; font-size:36px; letter-spacing:5px;">${code}</h1><p>صالح لمدة 10 دقائق.</p></div>`
        );

        res.json({ success: true, message: 'تم إرسال كود التحقق بنجاح!' });
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

app.post('/api/bookings', async (req, res) => {
    try {
        let { hotelName, customerName, email, phone, companions, paymentMethod, price, pointsUsed } = req.body;
        email = (email || '').toLowerCase().trim();
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
        
        let finalPrice = price;
        let user = await User.findOne({ email });

        if (user && pointsUsed && pointsUsed > 0) {
            if (user.points >= pointsUsed) {
                let discountAmount = pointsUsed / 10;
                finalPrice = Math.max(0, price - discountAmount);
                user.points -= pointsUsed;
            }
        }

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 2);

        const newBooking = new Booking({ 
            bookingReference, hotelName, customerName, email, phone, companions, paymentMethod, price: finalPrice,
            status: 'active', freeCancelDeadline: deadline
        });
        await newBooking.save();

        if (user) {
            user.points += Math.round((finalPrice || 100) * 0.2);
            await user.save();
        }

        // توليد قسيمة PDF بسيطة ومرحة
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        let buffers = [];
        doc.on('data', chunk => buffers.push(chunk));
        doc.on('end', async () => {
            let pdfBuffer = Buffer.concat(buffers);
            try {
                await sendProfessionalEmail(
                    email,
                    `تأكيد حجزك في ${hotelName} - شركة الرمال الدولية ✈️`,
                    `<div dir="rtl" style="font-family:Arial, sans-serif; padding:20px; background:#f4f6f8; border-radius:10px;">
                        <h2 style="color:#1f3a40;">مرحباً بك يا بطل! ✈️</h2>
                        <p>تم تثبيت وتأكيد حجزك الفندقي بكل نجاح عبر منصة <b>شركة الرمال الدولية</b>.</p>
                        <hr style="border:0; border-top:1px solid #ddd; margin:15px 0;">
                        <p><b>رقم المرجع:</b> ${bookingReference}</p>
                        <p><b>الفندق:</b> ${hotelName}</p>
                        <p><b>الإجمالي المدفوع:</b> ${finalPrice} AED</p>
                        <p style="color:#0077b6; margin-top:20px;">تجد تفاصيل قسيمة الحجز الرسمية (PDF) مرفقة مع هذه الرسالة. نتمنى لك إقامة ممتعة ولا تنسَ: <i>Laugh, Book, & Escape!</i> 😂</p>
                    </div>`,
                    pdfBuffer,
                    `Rimal-Voucher-${bookingReference}.pdf`
                );
            } catch (mailErr) { console.error(mailErr); }
        });

        // محتوى ملف الـ PDF المرتب والنظيف
        doc.fontSize(22).fillColor('#1f3a40').font('Helvetica-Bold').text('RIMAL INTERNATIONAL', { align: 'center' });
        doc.fontSize(10).fillColor('#ff595e').font('Helvetica').text('Laugh, Book, & Escape! - Official Booking Voucher ✈️', { align: 'center' });
        
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

        doc.moveDown(1.5);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        doc.fontSize(10).fillColor('#ff595e').font('Helvetica-Bold').text('Fun Note & Rules:');
        doc.fontSize(9).fillColor('#555555').font('Helvetica').text('• No spicy chips allowed in rooms! Have a wonderful trip with Rimal International. 😂');
        doc.text('• Free cancellation up to 48 hours before check-in.');

        doc.end();

        res.status(201).json({ success: true, message: 'تم تثبيت الحجز بنجاح', bookingReference, finalPrice, updatedPoints: user ? user.points : 500 });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// مسار تحويل العملات الحية عبر Frankfurter API المجانية تماماً
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

// ==========================================
// 🔌 نظام Booking & Reservation API المتكامل
// ==========================================

// 1. إنشاء حجز جديد (Create Booking API)
app.post('/api/v1/bookings/create', async (req, res) => {
    try {
        let { hotelName, customerName, email, phone, companions, paymentMethod, price, pointsUsed } = req.body;
        if (!hotelName || !email || !customerName) {
            return res.status(400).json({ success: false, error: 'الرجاء إدخال البيانات الأساسية للحجز (اسم الفندق، الاسم، البريد)' });
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

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 2);

        const newBooking = new Booking({ 
            bookingReference, hotelName, customerName, email, phone, companions, paymentMethod, price: finalPrice,
            status: 'active', freeCancelDeadline: deadline
        });
        await newBooking.save();

        if (user) {
            user.points += Math.round(finalPrice * 0.2);
            await user.save();
        }

        res.status(201).json({
            success: true,
            message: 'تم إنشاء وتأكيد الحجز بنجاح عبر الـ API',
            data: {
                bookingReference,
                hotelName,
                customerName,
                email,
                finalPriceAED: finalPrice,
                status: 'active',
                remainingPoints: user ? user.points : 500
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. تعديل أو تحديث الحجز (Update Booking API)
app.put('/api/v1/bookings/update/:reference', async (req, res) => {
    try {
        const reference = req.params.reference;
        const { companions, paymentMethod, status } = req.body;

        const booking = await Booking.findOne({ bookingReference: reference });
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود برقم المرجع المحدد' });
        }

        if (companions) booking.companions = companions;
        if (paymentMethod) booking.paymentMethod = paymentMethod;
        if (status) booking.status = status;

        await booking.save();

        res.json({
            success: true,
            message: 'تم تحديث بيانات الحجز بنجاح',
            booking
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. إلغاء الحجز بشكل آلي (Cancel Booking API)
app.post('/api/v1/bookings/cancel', async (req, res) => {
    try {
        const { bookingReference, refundType } = req.body;
        const booking = await Booking.findOne({ bookingReference });
        
        if (!booking) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
        }

        if (booking.status === 'refunded' || booking.status === 'cancelled') {
            return res.status(400).json({ success: false, error: 'الحجز ملغي مسبقاً' });
        }

        booking.status = 'cancelled';
        booking.refundType = refundType || 'full';
        await booking.save();

        res.json({
            success: true,
            message: `تم إلغاء الحجز رقم (${bookingReference}) وتفعيل مسار الاسترداد (${booking.refundType}) بنجاح.`,
            bookingReference,
            status: 'cancelled'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });
        res.json({ success: true, bookings });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/reviews', async (req, res) => {
    try {
        const hotelName = req.query.hotelName;
        const reviews = await Review.find(hotelName ? { hotelName } : {}).sort({ createdAt: -1 });
        res.json({ success: true, reviews });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const { hotelName, customerName, email, rating, comment } = req.body;
        const newReview = new Review({ hotelName, customerName, email, rating, comment });
        await newReview.save();
        res.json({ success: true, message: 'تم إضافة تقييمك بنجاح!' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
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
        doc.fontSize(10).fillColor('#ff595e').font('Helvetica').text('Laugh, Book, & Escape! - Official Booking Voucher ✈️', { align: 'center' });
        
        doc.moveDown(1.5);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1.5);

        doc.fontSize(14).fillColor('#0077b6').font('Helvetica-Bold').text(`Booking Reference: ${booking.bookingReference}`);
        doc.moveDown(0.8);

        doc.fontSize(11).fillColor('#333333').font('Helvetica');
        doc.text(`Guest Name: ${booking.customerName || 'N/A'}`);
        doc.text(`Hotel / Property: ${booking.hotelName || 'N/A'}`);
        doc.text(`Email Address: ${booking.email || 'N/A'}`);
        doc.text(`Phone Number: ${booking.phone || 'N/A'}`);
        doc.text(`Companions: ${booking.companions || 'None'}`);
        doc.text(`Payment Method: ${booking.paymentMethod === 'visa' ? 'Credit Card (Paid)' : 'Pay at Hotel'}`);
        doc.text(`Total Amount: ${booking.price} AED`);

        doc.moveDown(1.5);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(1);

        doc.fontSize(10).fillColor('#ff595e').font('Helvetica-Bold').text('Fun Note & Rules:');
        doc.fontSize(9).fillColor('#555555').font('Helvetica').text('• No spicy chips allowed in rooms! Have a wonderful trip with Rimal International. 😂');
        doc.text('• Free cancellation up to 48 hours before check-in.');

        doc.end();
    } catch (e) { 
        res.status(500).send('Error generating PDF'); 
    }
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`); });
