const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const stripe = require('stripe')('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');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// الاتصال بقاعدة البيانات (MongoDB)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/rimal_db', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('📦 متصل بقاعدة بيانات MongoDB بنجاح')).catch(err => console.log('DB Error:', err));

// نموذج العميل (User Schema)
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: { type: String },
    authProvider: { type: String, default: 'email' },
    points: { type: Number, default: 500 }, // عيدية ترحيبية 500 نقطة
    cards: [{ brand: String, last4: String, exp: String }]
});
const User = mongoose.model('User', userSchema);

// نموذج الحجز (Booking Schema)
const bookingSchema = new mongoose.Schema({
    bookingReference: String,
    email: String,
    hotelName: String,
    customerName: String,
    phone: String,
    companions: String,
    paymentMethod: String,
    price: Number,
    createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// إعداد خدمة النودمايلر للإيميلات
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'vqtiunlaehuugjwc'
    }
});

// مسار التسجيل وتسجيل الدخول بالبريد الإلكتروني أو وسائل التواصل
app.post('/api/auth/login-register', async (req, res) => {
    try {
        const { email, name, password, provider } = req.body;
        let user = await User.findOne({ email });

        if (!user) {
            const hashedPassword = password ? await bcrypt.hash(password, 10) : '';
            user = new User({
                name: name || email.split('@')[0],
                email,
                password: hashedPassword,
                authProvider: provider || 'email',
                points: 500
            });
            await user.save();
        }

        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, cards: user.cards } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// مسار جلب بيانات العميل (الحجوزات، النقاط، وقيمتها بالدرهم، والبطاقات)
app.get('/api/user/profile', async (req, res) => {
    try {
        const { email } = req.query;
        const user = await User.findOne({ email });
        const bookings = await Booking.find({ email });

        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

        // حساب قيمة النقاط بالعملة (مثلاً كل 100 نقطة = 10 درهم إماراتي)
        const pointsValueAED = (user.points / 10).toFixed(2);

        res.json({
            success: true,
            profile: {
                name: user.name,
                email: user.email,
                points: user.points,
                pointsValueAED: pointsValueAED,
                cards: user.cards || []
            },
            bookings
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// مسار تثبيت الحجز وتحديث النقاط
app.post('/api/bookings', async (req, res) => {
    try {
        const { hotelName, customerName, email, phone, companions, paymentMethod, price } = req.body;
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);

        const newBooking = new Booking({
            bookingReference,
            email,
            hotelName,
            customerName,
            phone,
            companions,
            paymentMethod,
            price
        });
        await newBooking.save();

        // إضافة نقاط للعميل بناءً على الحجز
        const earnedPoints = Math.round((price || 100) * 0.5);
        await User.findOneAndUpdate({ email }, { $inc: { points: earnedPoints } });

        res.status(201).json({ success: true, message: 'تم تثبيت الحجز بنجاح', bookingReference });

        // إرسال الإيميل في الخلفية
        setImmediate(async () => {
            try {
                const mailOptions = {
                    from: 'management@remaltourismllc.com',
                    to: `${email}, management@remaltourismllc.com`,
                    subject: `تأكيد حجز شركة الرمال الدولية - مرجع: ${bookingReference}`,
                    html: `
                        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background-color: #f7fff7; border: 2px solid #00b4d8; border-radius: 10px;">
                            <h2 style="color: #1f3a40;">🌴 شركة الرمال الدولية - تأكيد الحجز</h2>
                            <p>أهلاً بك <strong>${customerName}</strong>،</p>
                            <p>يسعدنا إبلاغك بأنه تم تأكيد حجزك بنجاح في النظام!</p>
                            <hr style="border: 1px dashed #ccc;">
                            <ul style="list-style: none; padding: 0; line-height: 1.8; color: #333;">
                                <li><strong>رقم المرجع:</strong> <span style="color: #d90429; font-size: 18px;">${bookingReference}</span></li>
                                <li><strong>الفندق المحجوز:</strong> ${hotelName}</li>
                                <li><strong>رقم الجوال:</strong> ${phone}</li>
                                <li><strong>المرافقون:</strong> ${companions || 'لا يوجد'}</li>
                                <li><strong>طريقة الدفع:</strong> ${paymentMethod}</li>
                            </ul>
                            <hr style="border: 1px dashed #ccc;">
                            <p style="font-size: 12px; color: #6c757d;">شكراً لاختيارك شركة الرمال الدولية. نتمنى لك رحلة ممتعة!</p>
                        </div>
                    `
                };
                await transporter.sendMail(mailOptions);
            } catch (mailError) {
                console.log(`⚠️ تنبيه في إرسال الإيميل: ${mailError.message}`);
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// مسار إنشاء جلسة الدفع الإلكتروني عبر Stripe
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { hotelName, customerName, email, price } = req.body;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'aed',
                    product_data: {
                        name: `حجز فندق: ${hotelName}`,
                        description: `حجز لصالح العميل: ${customerName}`,
                    },
                    unit_amount: (price || 100) * 100,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://rimal-api.onrender.com/?payment=success`,
            cancel_url: `https://rimal-api.onrender.com/?payment=cancelled`,
            customer_email: email,
        });

        res.json({ id: session.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 الخادم جاهز على المنفذ ${PORT}`);
});
