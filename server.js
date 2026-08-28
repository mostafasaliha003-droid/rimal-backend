const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const stripe = require('stripe')('sk_test_51U9NrgF2L2Zp7ynOs5mVpNm6pxj5OZDxOmZlcBEbxOZSDdap65X31OzsaKe6xTY6wIKvn6bgG4u3OQSq9NRBfCA300H1qrZt2z');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'database.json');

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], bookings: [] }, null, 2));
    }
    try { 
        let data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); 
        if(!data.bookings) data.bookings = [];
        if(!data.users) data.users = [];
        return data;
    } 
    catch (e) { return { users: [], bookings: [] }; }
}

function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

let verificationCodes = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'management@remaltourismllc.com', pass: 'dkvnseslexedcefd' }
});

app.get('/admin-panel', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/auth/register-send-code', async (req, res) => {
    try {
        const email = (req.body.email || '').toLowerCase().trim();
        const { name, password, phone, nationality, birthYear } = req.body;
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
        const email = (req.body.email || '').toLowerCase().trim();
        const { code } = req.body;
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
        const email = (req.body.email || '').toLowerCase().trim();
        const { password } = req.body;
        const db = loadDB();
        let user = db.users.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({ success: false, error: 'البريد غير مسجل، يرجى فتح حساب جديد!' });
        }
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ success: false, error: 'كلمة المرور غير صحيحة' });
        }
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/user/profile', (req, res) => {
    try {
        const email = (req.query.email || '').toLowerCase().trim();
        const db = loadDB();
        let user = db.users.find(u => u.email === email);
        if(!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير مسجل' });
        }
        
        let bookings = db.bookings.filter(b => b.email.toLowerCase() === email);
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
        const email = (req.body.email || '').toLowerCase().trim();
        const { bookingReference } = req.body;
        const db = loadDB();
        const bookingIndex = db.bookings.findIndex(b => b.bookingReference === bookingReference);
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

        if (booking.paymentIntentId && refundedAmount > 0) {
            try {
                await stripe.refunds.create({
                    payment_intent: booking.paymentIntentId,
                    amount: Math.round(refundedAmount * 100)
                });
                refundStatusMsg += ` وتم تحويل المبلغ بنجاح إلى بطاقتك 💳`;
            } catch (stripeErr) {}
        }

        db.bookings.splice(bookingIndex, 1);
        saveDB(db);

        try {
            await transporter.sendMail({
                from: 'management@remaltourismllc.com',
                to: email || booking.email,
                subject: `إلغاء الحجز - شركة الرمال الدولية (${bookingReference})`,
                html: `<div dir="rtl" style="padding:20px; background:#fff5f5; border:2px solid #d90429; border-radius:10px;"><h2>⚠️ تفاصيل الإلغاء</h2><p>${refundStatusMsg}</p></div>`
            });
        } catch (e) {}
        res.json({ success: true, message: refundStatusMsg, refundedAmount });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/bookings/resend-voucher', async (req, res) => {
    try {
        const { bookingReference } = req.body;
        const db = loadDB();
        const booking = db.bookings.find(b => b.bookingReference === bookingReference);

        if (!booking) return res.status(404).json({ success: false, error: 'لم يتم العثور على الحجز' });

        const emailVoucherHtml = `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; border: 3px dashed #ffca3a; border-radius: 15px; background-color: #f7fff7; color: #1f3a40; max-width: 600px; margin: auto;">
            <h2 style="color: #0077b6;">🎉 تأكيد الحجز</h2>
            <p>أهلاً بك يا <strong>${booking.customerName}</strong>، تفاصيل حجزك أدناه:</p>
            <p><strong>🏨 الفندق:</strong> ${booking.hotelName}</p>
            <p><strong>رقم المرجع:</strong> <span style="color:#d90429; font-weight:bold;">${booking.bookingReference}</span></p>
            <p><strong>إجمالي السعر:</strong> <span style="font-weight:bold;">${booking.price} AED</span></p>
        </div>`;

        await transporter.sendMail({
            from: 'management@remaltourismllc.com',
            to: booking.email,
            subject: `نسخة من فاوتشر الحجز - (${bookingReference})`,
            html: emailVoucherHtml
        });

        res.json({ success: true, message: 'تم إرسال الفاوتشر إلى بريدك الإلكتروني بنجاح! 📨' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

async function processAndSaveBooking(bookingData) {
    const db = loadDB();
    const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
    const newBooking = { bookingReference, ...bookingData, createdAt: new Date() };
    
    db.bookings.push(newBooking);
    let user = db.users.find(u => u.email.toLowerCase() === bookingData.email.toLowerCase());
    if (user) { 
        user.points += Math.round((bookingData.price || 100) * 0.5); 
        saveDB(db);
    }

    try {
        await transporter.sendMail({
            from: 'management@remaltourismllc.com',
            to: bookingData.email,
            subject: `تأكيد حجزك النهائي - شركة الرمال الدولية (Voucher: ${bookingReference})`,
            html: `<div dir="rtl" style="padding:20px; border:2px dashed #ffca3a; background:#f7fff7;"><h2>حجز مؤكد: ${bookingData.hotelName}</h2><p>المرجع: ${bookingReference}</p><p>السعر: ${bookingData.price} AED</p></div>`
        });
    } catch (e) {}

    return bookingReference;
}

app.post('/api/bookings', async (req, res) => {
    try {
        let { hotelName, customerName, email, phone, companions, paymentMethod, price, policyType, policyText, hotelAddress, hotelPhone, hotelMapLink } = req.body;
        email = (email || '').toLowerCase().trim();
        const bookingRef = await processAndSaveBooking({ hotelName, customerName, email, phone, companions, paymentMethod, price, policyType, policyText, hotelAddress, hotelPhone, hotelMapLink });
        res.status(201).json({ success: true, message: 'تم التثبيت', bookingReference: bookingRef });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        let { hotelName, customerName, email, price, phone, policyType, policyText, hotelAddress, hotelPhone, hotelMapLink } = req.body;
        email = (email || '').toLowerCase().trim();

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ 
                price_data: { currency: 'aed', product_data: { name: `حجز فندق: ${hotelName}`, description: `العميل: ${customerName}` }, unit_amount: Math.round(price * 100) }, 
                quantity: 1 
            }],
            mode: 'payment',
            success_url: `https://rimal-api.onrender.com/?payment=success&hotel=${encodeURIComponent(hotelName)}&name=${encodeURIComponent(customerName)}&email=${encodeURIComponent(email)}&phone=${encodeURIComponent(phone || '')}&price=${price}&ptype=${encodeURIComponent(policyType || 'full')}&policy=${encodeURIComponent(policyText || '')}&addr=${encodeURIComponent(hotelAddress || '')}&ph=${encodeURIComponent(hotelPhone || '')}&map=${encodeURIComponent(hotelMapLink || '')}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `https://rimal-api.onrender.com/?payment=cancelled`,
            customer_email: email,
        });
        res.json({ id: session.id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/', async (req, res) => {
    if (req.query.payment === 'success') {
        const { hotel, name, email, phone, price, ptype, policy, addr, ph, map, session_id } = req.query;
        if (hotel && email) {
            let paymentIntentId = null;
            if (session_id) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(session_id);
                    paymentIntentId = session.payment_intent;
                } catch(e) {}
            }
            const db = loadDB();
            const existing = db.bookings.find(b => b.email.toLowerCase() === email.toLowerCase() && b.hotelName === hotel && (new Date() - new Date(b.createdAt) < 60000));
            if (!existing) {
                await processAndSaveBooking({
                    hotelName: hotel,
                    customerName: name || 'عميل',
                    email: email,
                    phone: phone || '',
                    paymentMethod: 'visa',
                    price: Number(price) || 1,
                    policyType: ptype || 'full',
                    policyText: policy || 'استرداد كامل 100%',
                    hotelAddress: addr || '',
                    hotelPhone: ph || '',
                    hotelMapLink: map || '',
                    paymentIntentId: paymentIntentId
                });
            }
        }
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`); });
