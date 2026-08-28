const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');
const PDFDocument = require('pdfkit');

const stripe = require('stripe')('sk_test_51U9NrgF2L2Zp7ynOmT46T8dRcAwW8gScf5OtOU23wE4NZSAVF4ZUlspuB1WI62aqMzblavLr6zHfW3HaDAx2hhZx00IC95noxG');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

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

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'management@remaltourismllc.com', pass: 'dkvnseslexedcefd' }
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

        await transporter.sendMail({
            from: 'management@remaltourismllc.com',
            to: email,
            subject: 'رمز التحقق - شركة الرمال الدولية ✈️',
            html: `<div dir="rtl" style="padding:20px; text-align:center;"><h2>كود التحقق الخاص بك يا بطل:</h2><h1 style="color:#d90429;">${code}</h1></div>`
        });
        res.json({ success: true, message: 'تم إرسال كود التحقق!' });
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

        const doc = new PDFDocument();
        let buffers = [];
        doc.on('data', chunk => buffers.push(chunk));
        doc.on('end', async () => {
            let pdfBuffer = Buffer.concat(buffers);
            try {
                await transporter.sendMail({
                    from: 'management@remaltourismllc.com',
                    to: email,
                    subject: `تأكيد حجزك في ${hotelName} - شركة الرمال الدولية ✈️`,
                    html: `<div dir="rtl" style="font-family:Cairo; padding:20px;"><h1>أهلاً بك يا بطل! 🤪✈️</h1><p>تم تأكيد حجزك برقم: <strong>${bookingReference}</strong> والمبلغ: ${finalPrice} AED.</p></div>`,
                    attachments: [{ filename: `Voucher-${bookingReference}.pdf`, content: pdfBuffer }]
                });
            } catch (mailErr) { console.error(mailErr); }
        });
        doc.fontSize(20).text('شركة الرمال الدولية - قسيمة الحجز ✈️', { align: 'center' });
        doc.text(`المرجع: ${bookingReference} | الفندق: ${hotelName} | المبلغ: ${finalPrice} AED`);
        doc.end();

        console.log(`📱 WhatsApp API sent to ${phone}: أهلاً ${customerName}! تم تأكيد حجزك ${hotelName} برقم مرجع ${bookingReference}.`);

        res.status(201).json({ success: true, message: 'تم تثبيت الحجز بنجاح', bookingReference, finalPrice, updatedPoints: user ? user.points : 500 });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/admin/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });
        res.json({ success: true, bookings });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/bookings/refund-cancel', async (req, res) => {
    try {
        const { bookingReference, refundType } = req.body;
        const booking = await Booking.findOne({ bookingReference });
        if(!booking) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });

        booking.status = 'refunded';
        booking.refundType = refundType;
        await booking.save();

        let refundMsg = refundType === 'full' ? 'استرداد كامل المبلغ على نفس الكارت' : 'إلغاء بدون استرداد';
        res.json({ success: true, message: `تم إلغاء الحجز بنجاح (${refundMsg}) وإرسال طلب الاسترداد للبنك.` });
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

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rimal-Voucher-${booking.bookingReference}.pdf`);
        doc.pipe(res);

        const logoPath = path.join(__dirname, '6eacaf6a-cbc4-4406-aef8-708797c931cb-removebg-preview.png');
        try {
            doc.image(logoPath, 40, 35, { width: 50 });
        } catch (imgErr) {
            console.log('Logo image not found, skipping logo rendering.');
        }

        doc.fillColor('#1f3a40').fontSize(18).font('Helvetica-Bold').text('RIMAL INTERNATIONAL', 100, 42, { align: 'left' });
        doc.fontSize(9).fillColor('#ff595e').font('Helvetica').text('Laugh, Book, & Escape! - Official Booking Voucher ✈️', 100, 62, { align: 'left' });
        
        doc.moveDown(2);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(1);

        doc.rect(40, doc.y, 515, 45).fillAndStroke('#f7fff7', '#00b4d8');
        let boxY = doc.y + 12;
        doc.fillColor('#1f3a40').fontSize(12).font('Helvetica-Bold').text(`Booking ID Reference: ${booking.bookingReference}`, 55, boxY);
        doc.fontSize(11).fillColor('#0077b6').text('Status: CONFIRMED ✅', 390, boxY);
        doc.moveDown(3);

        doc.fontSize(12).fillColor('#1f3a40').font('Helvetica-Bold').text('Reservation & Property Details:');
        doc.moveDown(0.8);

        let paymentDesc = booking.paymentMethod === 'visa' ? 'Credit Card (Visa - Paid)' : 'Pay at Hotel (Payment to be collected at property check-in)';

        const details = [
            ['Guest Name:', booking.customerName || 'N/A'],
            ['Property / Hotel:', booking.hotelName || 'N/A'],
            ['Email Address:', booking.email || 'N/A'],
            ['Phone Number:', booking.phone || 'N/A'],
            ['Companions:', booking.companions || 'None'],
            ['Payment Method:', paymentDesc],
            ['Total Amount:', `${booking.price || 0} AED`],
            ['Cancellation Policy:', 'Free cancellation up to 48 hours before check-in.']
        ];

        let startY = doc.y;
        details.forEach(item => {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#1f3a40').text(item[0], 50, startY, { width: 150 });
            doc.font('Helvetica').fillColor('#333333').text(item[1], 210, startY, { width: 330 });
            startY += 20;
        });

        doc.y = startY + 15;
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(1.5);

        doc.fontSize(11).font('Helvetica-Bold').fillColor('#ff595e').text('Important Notes & Hotel Rules:');
        doc.moveDown(0.5);
        doc.fontSize(9).fillColor('#555555').text('• Please present either an electronic or paper copy of your booking confirmation upon check-in.');
        doc.text('• Make sure your name matches your official passport.');
        if (booking.paymentMethod === 'hotel') {
            doc.text('• Note: Payment has not been collected online. You will pay the total amount directly to the property upon arrival.');
        }
        doc.text('• Fun Note: No spicy chips allowed in rooms! Have a wonderful trip with Rimal International. 😂');

        doc.moveDown(3);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1f3a40').text('Authorized Stamp & Signature', { align: 'left' });

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
