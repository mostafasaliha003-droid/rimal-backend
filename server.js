const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const path = require('path');
const stripe = require('stripe')('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');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

let usersMemory = [];
let bookingsMemory = [];
let verificationCodes = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'vqtiunlaehuugjwc'
    }
});

// 1. طلب إرسال كود التحقق وتخزين البيانات المؤقتة
app.post('/api/auth/send-code', async (req, res) => {
    try {
        const { email, name, password, nationality, birthYear } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني غير صالح' });
        }

        const safePassword = password || '123456'; // قيمة احتياطية لمنع خطأ undefined
        const hashedPassword = bcrypt.hashSync(safePassword, 8);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        verificationCodes[email] = { 
            code, 
            name, 
            password: hashedPassword, 
            nationality: nationality || 'غير محدد', 
            birthYear: birthYear || '2000', 
            expires: Date.now() + 10 * 60 * 1000 
        };

        const mailOptions = {
            from: 'management@remaltourismllc.com',
            to: email,
            subject: 'رمز التحقق الخاص بك - شركة الرمال الدولية ✈️',
            html: `
                <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background-color: #f7fff7; border: 2px solid #00b4d8; border-radius: 12px; text-align: center;">
                    <h2 style="color: #1f3a40;">🌴 شركة الرمال الدولية</h2>
                    <p>أهلاً بك يا <strong>${name || 'صديقنا'}</strong>،</p>
                    <p>كود التحقق الخاص بتفعيل حسابك واستلام التحديثات والحجوزات هو:</p>
                    <div style="font-size: 32px; font-weight: 900; color: #d90429; background: #fff; padding: 15px; border-radius: 10px; display: inline-block; margin: 15px 0; border: 2px dashed #ffca3a;">
                        ${code}
                    </div>
                    <p style="font-size: 13px; color: #6c757d;">هذا الكود صالح لمدة 10 دقائق فقط.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'تم إرسال كود التحقق بنجاح!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. التحقق من الكود وتفعيل الحساب بشكل دائم
app.post('/api/auth/verify-code', (req, res) => {
    try {
        const { email, code } = req.body;
        const record = verificationCodes[email];

        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, error: 'كود التحقق غير صحيح أو انتهت صلاحيته' });
        }

        let user = usersMemory.find(u => u.email === email);
        if (!user) {
            user = {
                name: record.name,
                email,
                password: record.password,
                nationality: record.nationality,
                birthYear: record.birthYear,
                points: 500, // عيدية ترحيبية
                cards: []
            };
            usersMemory.push(user);
        }

        delete verificationCodes[email];

        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, nationality: user.nationality, birthYear: user.birthYear } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/user/profile', (req, res) => {
    try {
        const { email } = req.query;
        const user = usersMemory.find(u => u.email === email);
        const bookings = bookingsMemory.filter(b => b.email === email);

        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

        const pointsValueAED = (user.points / 10).toFixed(2);

        res.json({
            success: true,
            profile: { name: user.name, email: user.email, points: user.points, pointsValueAED, nationality: user.nationality, birthYear: user.birthYear },
            bookings
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const { hotelName, customerName, email, phone, companions, paymentMethod, price } = req.body;
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);

        const newBooking = {
            bookingReference, email, hotelName, customerName, phone, companions, paymentMethod, price, createdAt: new Date()
        };
        bookingsMemory.push(newBooking);

        let user = usersMemory.find(u => u.email === email);
        const earnedPoints = Math.round((price || 100) * 0.5);
        if (user) { user.points += earnedPoints; }

        res.status(201).json({ success: true, message: 'تم تثبيت الحجز بنجاح', bookingReference });

        setImmediate(async () => {
            try {
                const mailOptions = {
                    from: 'management@remaltourismllc.com',
                    to: `${email}, management@remaltourismllc.com`,
                    subject: `تأكيد وفاتورة حجز شركة الرمال الدولية - مرجع: ${bookingReference}`,
                    html: `
                        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background-color: #f7fff7; border: 2px solid #00b4d8; border-radius: 10px;">
                            <h2 style="color: #1f3a40;">🌴 شركة الرمال الدولية - فاتورة الحجز والتأكيد</h2>
                            <p>أهلاً بك <strong>${customerName}</strong>،</p>
                            <p>تم تأكيد حجزك وإصدار الفاتورة الرسمية بنجاح!</p>
                            <hr style="border: 1px dashed #ccc;">
                            <ul style="list-style: none; padding: 0; line-height: 1.8; color: #333;">
                                <li><strong>رقم المرجع (الفاتورة):</strong> <span style="color: #d90429; font-size: 18px;">${bookingReference}</span></li>
                                <li><strong>الفندق المحجوز:</strong> ${hotelName}</li>
                                <li><strong>المبلغ الإجمالي:</strong> ${price} AED</li>
                                <li><strong>طريقة الدفع:</strong> ${paymentMethod}</li>
                            </ul>
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

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { hotelName, customerName, email, price } = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'aed',
                    product_data: { name: `حجز فندق: ${hotelName}`, description: `حجز لصالح: ${customerName}` },
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
