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
    status: { type: String, default: 'active' }, // active, cancelled
    cancellationPolicy: { type: String, default: 'استرداد كامل مجاني حتى قبل الموعد بـ 48 ساعة ✨' },
    freeCancelDeadline: { type: Date },
    refundType: { type: String, default: 'full' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Booking = mongoose.model('Booking', bookingSchema);

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

app.post('/api/bookings', async (req, res) => {
    try {
        let { hotelName, customerName, email, phone, companions, paymentMethod, price } = req.body;
        email = (email || '').toLowerCase().trim();
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
        
        const policies = [
            { type: 'full', text: 'استرداد كامل مجاني حتى قبل الموعد بـ 48 ساعة ✨' },
            { type: 'partial', text: 'استرداد مع خصم رسوم غرامة بنسبة 20% عند الإلغاء ⚠️' },
            { type: 'non-refundable', text: 'غير مسترد نهائياً (سعر محروق 💸)' }
        ];
        const selectedPolicy = policies[Math.floor(Math.random() * policies.length)];
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 2);

        const newBooking = new Booking({ 
            bookingReference, hotelName, customerName, email, phone, companions, paymentMethod, price,
            status: 'active', cancellationPolicy: selectedPolicy.text, freeCancelDeadline: deadline, refundType: selectedPolicy.type
        });
        await newBooking.save();

        let user = await User.findOne({ email });
        if (user) {
            user.points += Math.round((price || 100) * 0.2);
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
                    html: `
                        <div dir="rtl" style="font-family: Cairo, Arial, sans-serif; padding: 20px; background: #f7fff7; color: #1f3a40;">
                            <h1 style="color: #ff595e;">أهلاً بك يا بطل في عالم الرمال الدولية! 🤪✈️</h1>
                            <p>تم تأكيد حجزك بنجاح تام، ومرفق قسيمة الحجز الرسمية بصيغة PDF.</p>
                            <div style="background: white; padding: 15px; border-radius: 12px; border: 2px dashed #ffca3a;">
                                <h3>📋 تفاصيل الحجز:</h3>
                                <p><strong>رقم المرجع:</strong> ${bookingReference}</p>
                                <p><strong>الفندق:</strong> ${hotelName}</p>
                                <p><strong>المبلغ الإجمالي:</strong> ${price} AED</p>
                                <p><strong>سياسة الإلغاء:</strong> ${selectedPolicy.text}</p>
                            </div>
                        </div>
                    `,
                    attachments: [{ filename: `Voucher-${bookingReference}.pdf`, content: pdfBuffer }]
                });
            } catch (mailErr) { console.error('خطأ الإيميل:', mailErr); }
        });

        doc.fontSize(20).text('شركة الرمال الدولية - قسيمة الحجز الرسمية ✈️', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(`رقم المرجع: ${bookingReference}`);
        doc.text(`اسم العميل: ${customerName}`);
        doc.text(`الفندق المحجوز: ${hotelName}`);
        doc.text(`المبلغ المدفوع: ${price} AED`);
        doc.text(`سياسة الإلغاء: ${selectedPolicy.text}`);
        doc.text(`حالة الحجز: مؤكد ومثبت بالسحابة الدائمة ✅`);
        doc.end();

        res.status(201).json({ success: true, message: 'تم تثبيت الحجز بنجاح', bookingReference });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/bookings/cancel', async (req, res) => {
    try {
        const { bookingReference } = req.body;
        const booking = await Booking.findOne({ bookingReference });
        if (!booking) return res.status(404).json({ success: false, error: 'الحجز غير موجود!' });
        if (booking.status === 'cancelled') return res.status(400).json({ success: false, error: 'الحجز ملغي مسبقاً!' });

        booking.status = 'cancelled';
        await booking.save();
        res.json({ success: true, message: 'تم إلغاء الحجز بنجاح حسب سياسة الفندق.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/bookings/pdf/:reference', async (req, res) => {
    try {
        const booking = await Booking.findOne({ bookingReference: req.params.reference });
        if(!booking) return res.status(404).send('الحجز غير موجود');

        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rimal-Voucher-${booking.bookingReference}.pdf`);
        doc.pipe(res);

        doc.fontSize(22).fillColor('#1f3a40').text('شركة الرمال الدولية - قسيمة الحجز 🏨', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(`رقم المرجع: ${booking.bookingReference}`);
        doc.text(`اسم العميل: ${booking.customerName}`);
        doc.text(`الفندق: ${booking.hotelName}`);
        doc.text(`المبلغ: ${booking.price} AED`);
        doc.text(`طريقة الدفع: ${booking.paymentMethod}`);
        doc.text(`سياسة الإلغاء: ${booking.cancellationPolicy}`);
        doc.text(`حالة الحجز: ${booking.status === 'active' ? 'مؤكد ونشط ✅' : 'ملغي ❌'}`);
        doc.end();
    } catch (e) { res.status(500).send('خطأ في تحميل الـ PDF'); }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT} ومربوط بقاعدة بيانات MongoDB الدائمة`); 
});
