const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const stripe = require('stripe')('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');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'database.json');

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], bookings: [] }, null, 2));
    }
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } 
    catch (e) { return { users: [], bookings: [] }; }
}

function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

let verificationCodes = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'management@remaltourismllc.com', pass: 'vqtiunlaehuugjwc' }
});

app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/auth/register-send-code', async (req, res) => {
    try {
        const { email, name, password, phone, nationality, birthYear } = req.body;
        const db = loadDB();
        if (db.users.find(u => u.email === email)) return res.status(400).json({ success: false, error: 'البريد مسجل مسبقاً!' });
        
        const hashedPassword = bcrypt.hashSync(password || '123456', 8);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        verificationCodes[email] = { code, name, password: hashedPassword, phone, nationality, birthYear, expires: Date.now() + 10 * 60 * 1000 };

        await transporter.sendMail({
            from: 'management@remaltourismllc.com',
            to: email,
            subject: 'رمز التحقق - شركة الرمال الدولية ✈️',
            html: `<div dir="rtl" style="padding:20px; text-align:center;"><h2>كود التحقق الخاص بك:</h2><h1 style="color:#d90429;">${code}</h1></div>`
        });
        res.json({ success: true, message: 'تم إرسال كود التحقق!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/verify-and-register', (req, res) => {
    try {
        const { email, code } = req.body;
        const record = verificationCodes[email];
        if (!record || record.code !== code || Date.now() > record.expires) return res.status(400).json({ success: false, error: 'الكود غير صحيح' });
        
        const db = loadDB();
        let user = db.users.find(u => u.email === email);
        if (!user) {
            user = { name: record.name, email, password: record.password, phone: record.phone, nationality: record.nationality, birthYear: record.birthYear, points: 500 };
            db.users.push(user);
            saveDB(db);
        }
        delete verificationCodes[email];
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const db = loadDB();
        const user = db.users.find(u => u.email === email);
        if (!user || !bcrypt.compareSync(password, user.password)) return res.status(400).json({ success: false, error: 'البيانات غير صحيحة' });
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/user/profile', (req, res) => {
    try {
        const { email } = req.query;
        const db = loadDB();
        const user = db.users.find(u => u.email === email);
        const bookings = db.bookings.filter(b => b.email === email);
        if (!user) return res.status(404).json({ success: false, error: 'غير موجود' });
        res.json({ success: true, profile: { name: user.name, email: user.email, points: user.points, pointsValueAED: (user.points / 10).toFixed(2), phone: user.phone }, bookings });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

const ADMIN_CREDENTIALS = { username: "admin@remaltourismllc.com", passwordHash: bcrypt.hashSync("Rimal2026@", 8) };

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_CREDENTIALS.username && bcrypt.compareSync(password, ADMIN_CREDENTIALS.passwordHash)) {
        res.json({ success: true, token: 'rimal-secure-admin-token-9988' });
    } else { res.status(401).json({ success: false, error: 'غير مصرح' }); }
});

app.get('/api/admin/data', (req, res) => {
    if (req.headers['authorization'] !== 'rimal-secure-admin-token-9988') return res.status(403).json({ success: false, error: 'غير مصرح' });
    const db = loadDB();
    res.json({ success: true, users: db.users, bookings: db.bookings });
});

app.post('/api/bookings/cancel', async (req, res) => {
    try {
        const { bookingReference, email } = req.body;
        const db = loadDB();
        const bookingIndex = db.bookings.findIndex(b => b.bookingReference === bookingReference && b.email === email);
        if (bookingIndex === -1) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });

        const booking = db.bookings[bookingIndex];
        let refundStatusMsg = '', refundedAmount = 0;
        const pType = booking.policyType || 'full';

        if (pType === 'full') {
            refundedAmount = booking.price;
            refundStatusMsg = `تم استرداد المبلغ بالكامل (100%): ${refundedAmount} AED`;
        } else if (pType === 'penalty') {
            let penalty = Math.round(booking.price * 0.2);
            refundedAmount = booking.price - penalty;
            refundStatusMsg = `تم تطبيق الغرامة (خصم 20% بقيمة ${penalty} AED)، الاسترداد: ${refundedAmount} AED`;
        } else {
            refundStatusMsg = `الحجز غير قابل للاسترداد، وتم الإلغاء دون استرداد نقدي.`;
        }

        db.bookings.splice(bookingIndex, 1);
        saveDB(db);

        try {
            await transporter.sendMail({
                from: 'management@remaltourismllc.com',
                to: email,
                subject: `إلغاء الحجز - شركة الرمال الدولية (${bookingReference})`,
                html: `<div dir="rtl" style="padding:20px; background:#fff5f5; border:2px solid #d90429; border-radius:10px;"><h2>⚠️ تفاصيل الإلغاء</h2><p>${refundStatusMsg}</p></div>`
            });
        } catch (e) {}
        res.json({ success: true, message: refundStatusMsg, refundedAmount });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// المسار الخاص بتأكيد الحجز وحفظه وإرسال الإيميل
app.post('/api/bookings', async (req, res) => {
    try {
        const { hotelName, customerName, email, phone, companions, paymentMethod, price, policyType, policyText } = req.body;
        const db = loadDB();
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
        
        db.bookings.push({ bookingReference, email, hotelName, customerName, phone, companions, paymentMethod, price, policyType, policyText, createdAt: new Date() });
        let user = db.users.find(u => u.email === email);
        if (user) { user.points += Math.round((price || 100) * 0.5); }
        saveDB(db);

        // إرسال إيميل تأكيد الحجز للعميل
        try {
            await transporter.sendMail({
                from: 'management@remaltourismllc.com',
                to: email,
                subject: `تأكيد الحجز المبدئي - شركة الرمال الدولية (${bookingReference})`,
                html: `<div dir="rtl" style="padding:20px; border:2px solid #00b4d8; border-radius:10px;">
                        <h2>🎉 تم تأكيد حجزك بنجاح!</h2>
                        <p>الفندق: <strong>${hotelName}</strong></p>
                        <p>رقم المرجع: <strong style="color:#d90429;">${bookingReference}</strong></p>
                        <p>المبلغ الإجمالي: <strong>${price} AED</strong></p>
                        <p>طريقة الدفع: <strong>${paymentMethod === 'hotel' ? 'الدفع في الفندق' : 'دفع إلكتروني (بطاقة)'}</strong></p>
                        <p style="background:#f1f5f9; padding:10px; border-radius:5px;">سياسة الإلغاء: ${policyText}</p>
                       </div>`
            });
        } catch (e) { console.log('خطأ إرسال الإيميل:', e.message); }

        res.status(201).json({ success: true, message: 'تم التثبيت', bookingReference });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// المسار الخاص ببوابة الدفع Stripe
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { hotelName, customerName, email, price } = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ 
                price_data: { currency: 'aed', product_data: { name: `حجز فندق: ${hotelName}`, description: `العميل: ${customerName}` }, unit_amount: Math.round(price * 100) }, 
                quantity: 1 
            }],
            mode: 'payment',
            success_url: `https://rimal-api.onrender.com/?payment=success`,
            cancel_url: `https://rimal-api.onrender.com/?payment=cancelled`,
            customer_email: email,
        });
        res.json({ id: session.id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`); });
