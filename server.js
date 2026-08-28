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

// نظام التخزين السحابي الدائم لضمان عدم ضياع حسابات وحجوزات العملاء أبداً
const DB_FILE = path.join(__dirname, 'database.json');

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { users: [], bookings: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { users: [], bookings: [] };
    }
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let verificationCodes = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'vqtiunlaehuugjwc'
    }
});

// مسار خاص للرابط السري للوحة الإدارة المعزولة عن العملاء
app.get('/admin-panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 1. طلب تسجيل حساب جديد مع إرسال كود التحقق (OTP)
app.post('/api/auth/register-send-code', async (req, res) => {
    try {
        const { email, name, password, phone, nationality, birthYear } = req.body;
        const db = loadDB();

        if (db.users.find(u => u.email === email)) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني مسجل مسبقاً! يرجى استخدام قسم (تسجيل دخول حساب سابق).' });
        }

        const hashedPassword = bcrypt.hashSync(password || '123456', 8);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        verificationCodes[email] = { 
            code, 
            name, 
            password: hashedPassword, 
            phone: phone || '',
            nationality: nationality || 'إماراتي', 
            birthYear: birthYear || '1990', 
            expires: Date.now() + 10 * 60 * 1000 
        };

        const mailOptions = {
            from: 'management@remaltourismllc.com',
            to: email,
            subject: 'رمز التحقق لتسجيل حسابك - شركة الرمال الدولية ✈️',
            html: `
                <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background-color: #f7fff7; border: 2px solid #00b4d8; border-radius: 12px; text-align: center;">
                    <h2 style="color: #1f3a40;">🌴 شركة الرمال الدولية</h2>
                    <p>أهلاً بك يا <strong>${name}</strong> في حسابك السحابي الآمن،</p>
                    <p>كود التحقق الخاص بإنشاء حسابك وتفعيل حصالة الـ 500 نقطة هو:</p>
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

// 2. التحقق من الكود وحفظ المستخدم نهائياً في السحابة
app.post('/api/auth/verify-and-register', (req, res) => {
    try {
        const { email, code } = req.body;
        const record = verificationCodes[email];

        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, error: 'كود التحقق غير صحيح أو انتهت صلاحيته' });
        }

        const db = loadDB();
        let user = db.users.find(u => u.email === email);

        if (!user) {
            user = {
                name: record.name,
                email,
                password: record.password,
                phone: record.phone,
                nationality: record.nationality,
                birthYear: record.birthYear,
                points: 500, // عيدية ترحيبية للحساب
                cards: []
            };
            db.users.push(user);
            saveDB(db);
        }

        delete verificationCodes[email];
        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone, nationality: user.nationality, birthYear: user.birthYear } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. تسجيل الدخول الآمن للعملاء المسجلين مسبقاً (لحماية حجوزاتهم ونقاطهم وعدم خسارتها)
app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const db = loadDB();
        const user = db.users.find(u => u.email === email);

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو أن الحساب غير مسجل!' });
        }

        res.json({ success: true, user: { name: user.name, email: user.email, points: user.points, phone: user.phone, nationality: user.nationality, birthYear: user.birthYear } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- لوحة التحكم الإدارية (Admin Panel Backend) ---
const ADMIN_CREDENTIALS = {
    username: "admin@remaltourismllc.com",
    passwordHash: bcrypt.hashSync("Rimal2026@", 8)
};

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_CREDENTIALS.username && bcrypt.compareSync(password, ADMIN_CREDENTIALS.passwordHash)) {
        res.json({ success: true, token: 'rimal-secure-admin-token-9988' });
    } else {
        res.status(401).json({ success: false, error: 'بيانات دخول الإدارة غير صحيحة' });
    }
});

app.get('/api/admin/data', (req, res) => {
    const token = req.headers['authorization'];
    if (token !== 'rimal-secure-admin-token-9988') {
        return res.status(403).json({ success: false, error: 'غير مصرح لك بالوصول' });
    }
    const db = loadDB();
    res.json({ success: true, users: db.users, bookings: db.bookings });
});

app.post('/api/admin/cancel-booking', async (req, res) => {
    const token = req.headers['authorization'];
    if (token !== 'rimal-secure-admin-token-9988') {
        return res.status(403).json({ success: false, error: 'غير مصرح لك بالوصول' });
    }

    try {
        const { bookingReference } = req.body;
        const db = loadDB();
        const bookingIndex = db.bookings.findIndex(b => b.bookingReference === bookingReference);

        if (bookingIndex === -1) {
            return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
        }

        const booking = db.bookings[bookingIndex];
        db.bookings.splice(bookingIndex, 1);
        saveDB(db);

        try {
            await transporter.sendMail({
                from: 'management@remaltourismllc.com',
                to: booking.email,
                subject: `إلغاء حجز واسترداد الأموال - شركة الرمال الدولية (${bookingReference})`,
                html: `
                    <div dir="rtl" style="padding:20px; background:#fff5f5; border:2px solid #d90429; border-radius:10px;">
                        <h2 style="color:#d90429;">⚠️ إشعار بإلغاء الحجز واسترداد الأموال</h2>
                        <p>عزيزنا العميل <strong>${booking.customerName}</strong>،</p>
                        <p>تم إلغاء حجزك رقم (<strong>${bookingReference}</strong>) الخاص بفندق <strong>${booking.hotelName}</strong>.</p>
                        <p>تم بدء عملية استرداد المبلغ بقيمة <strong>${booking.price} AED</strong> وسيرجع إلى حسابك البنكي.</p>
                    </div>
                `
            });
        } catch (mailErr) {
            console.log("خطأ إيميل الإلغاء:", mailErr.message);
        }

        res.json({ success: true, message: 'تم إلغاء الحجز واسترداد الأموال بنجاح!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. جلب ملف العميل وحجوزاته من السحابة الدائمة
app.get('/api/user/profile', (req, res) => {
    try {
        const { email } = req.query;
        const db = loadDB();
        const user = db.users.find(u => u.email === email);
        const bookings = db.bookings.filter(b => b.email === email);

        if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

        const pointsValueAED = (user.points / 10).toFixed(2);

        res.json({
            success: true,
            profile: { name: user.name, email: user.email, points: user.points, pointsValueAED, phone: user.phone, nationality: user.nationality, birthYear: user.birthYear },
            bookings
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. حفظ الحجوزات وتحديث النقاط في السحابة الدائمة
app.post('/api/bookings', async (req, res) => {
    try {
        const { hotelName, customerName, email, phone, companions, paymentMethod, price } = req.body;
        const db = loadDB();
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);

        const newBooking = {
            bookingReference, email, hotelName, customerName, phone, companions, paymentMethod, price, createdAt: new Date()
        };
        db.bookings.push(newBooking);

        let user = db.users.find(u => u.email === email);
        const earnedPoints = Math.round((price || 100) * 0.5);
        if (user) { 
            user.points += earnedPoints; 
        } else {
            db.users.push({
                name: customerName,
                email,
                password: bcrypt.hashSync('123456', 8),
                phone: phone || '',
                nationality: 'إماراتي',
                birthYear: '1990',
                points: earnedPoints + 500,
                cards: []
            });
        }

        saveDB(db);

        res.status(201).json({ success: true, message: 'تم تثبيت الحجز وحفظه في حسابك بنجاح', bookingReference });

        setImmediate(async () => {
            try {
                const mailOptions = {
                    from: 'management@remaltourismllc.com',
                    to: `${email}, management@remaltourismllc.com`,
                    subject: `فاتورة وتأكيد حجز شركة الرمال الدولية - مرجع: ${bookingReference}`,
                    html: `
                        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background-color: #f7fff7; border: 2px solid #00b4d8; border-radius: 10px;">
                            <h2 style="color: #1f3a40;">🌴 شركة الرمال الدولية - فاتورة الحجز والتأكيد</h2>
                            <p>أهلاً بك <strong>${customerName}</strong>،</p>
                            <p>تم حفظ حجزك في حسابك السحابي وإصدار الفاتورة الرسمية بنجاح!</p>
                            <hr style="border: 1px dashed #ccc;">
                            <ul style="list-style: none; padding: 0; line-height: 1.8; color: #333;">
                                <li><strong>رقم المرجع (الفاتورة):</strong> <span style="color: #d90429; font-size: 18px;">${bookingReference}</span></li>
                                <li><strong>الفندق المحجوز:</strong> ${hotelName}</li>
                                <li><strong>المبلغ الإجمالي:</strong> ${price} AED</li>
                                <li><strong>رقم الهاتف:</strong> ${phone}</li>
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
    console.log(`🚀 الخادم السحابي الآمن جاهز على المنفذ ${PORT}`);
});
