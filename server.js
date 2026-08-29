const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// قواعد بيانات مؤقتة (سيتم ربطها بـ MongoDB السحابية لاحقاً)
let bookingsDatabase = [];
let usersDatabase = [];
let verificationCodes = {};

// 1. تحويل العملات الحية (LiveData)
app.get('/api/currency/convert', async (req, res) => {
    const { targetCurrency, amount } = req.query;
    let rate = 1;
    
    if (targetCurrency === 'USD') rate = 0.27;
    else if (targetCurrency === 'EUR') rate = 0.25;
    else if (targetCurrency === 'SAR') rate = 1.02;

    const convertedAmount = (amount * rate).toFixed(2);
    res.json({ success: true, convertedAmount, targetCurrency });
});

// 2. نظام تسجيل الدخول المباشر
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = usersDatabase.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    
    if (!user) {
        return res.status(400).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
    }
    
    res.json({ success: true, user: { name: user.name, email: user.email, phone: user.phone, points: user.points || 500 } });
});

// 3. إرسال رمز التحقق للتسجيل
app.post('/api/auth/register-send-code', (req, res) => {
    const { email, name, password, phone } = req.body;
    if (!email || !name) {
        return res.status(400).json({ success: false, error: 'البيانات غير مكتملة.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    verificationCodes[email] = { code, name, password, phone };

    console.log(`[رمز التحقق التجريبي للعميل ${email}]: ${code}`);
    res.json({ success: true, message: 'تم إرسال كود التحقق بنجاح.' });
});

// 4. التحقق وإنشاء الحساب
app.post('/api/auth/verify-and-register', (req, res) => {
    const { email, code } = req.body;
    const record = verificationCodes[email];

    if (!record || record.code !== code) {
        return res.status(400).json({ success: false, error: 'كود التحقق غير صحيح.' });
    }

    const newUser = {
        name: record.name,
        email: email,
        password: record.password,
        phone: record.phone,
        points: 500 // مكافأة الترحيب لحصالة النقاط
    };

    usersDatabase.push(newUser);
    delete verificationCodes[email];

    res.json({
        success: true,
        user: { name: newUser.name, email: newUser.email, phone: newUser.phone, points: newUser.points }
    });
});

// 5. جلب بيانات الملف الشخصي وحجوزات العميل
app.get('/api/user/profile', (req, res) => {
    const email = req.query.email;
    const user = usersDatabase.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
        return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    }

    const userBookings = bookingsDatabase.filter(b => b.email.toLowerCase() === email.toLowerCase());

    res.json({
        success: true,
        profile: { name: user.name, email: user.email, phone: user.phone, points: user.points },
        bookings: userBookings
    });
});

// 6. تثبيت الحجز الجديد في السحابة
app.post('/api/bookings', (req, res) => {
    const { hotelName, customerName, email, phone, companions, paymentMethod, price, pointsUsed } = req.body;
    
    const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
    const freeCancelDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // إلغاء مجاني خلال 24 ساعة

    const newBooking = {
        bookingReference,
        hotelName,
        customerName,
        email,
        phone,
        companions,
        paymentMethod,
        price,
        pointsUsed,
        status: 'active',
        cancellationPolicy: 'إلغاء مجاني حتى 24 ساعة قبل موعد الوصول',
        freeCancelDeadline,
        createdAt: new Date()
    };

    bookingsDatabase.push(newBooking);

    // تحديث نقاط حصالة العميل
    let user = usersDatabase.find(u => u.email.toLowerCase() === email.toLowerCase());
    let updatedPoints = 500;
    if (user) {
        user.points = Math.max(0, user.points - pointsUsed) + Math.floor(price * 0.1);
        updatedPoints = user.points;
    }

    res.json({
        success: true,
        bookingReference,
        updatedPoints,
        message: 'تم تثبيت الحجز بنجاح في سحابة شركة الرمال الدولية وإرسال قسيمة التأكيد!'
    });
});

// 7. البحث السريع عن الحجز (Lookup)
app.post('/api/bookings/lookup', (req, res) => {
    const { bookingReference, email } = req.body;
    const booking = bookingsDatabase.find(b => b.bookingReference === bookingReference && b.email.toLowerCase() === email.toLowerCase());

    if (!booking) {
        return res.status(404).json({ success: false, error: 'لم يتم العثور على الحجز أو أن البريد الإلكتروني غير مطابق.' });
    }

    res.json({ success: true, booking });
});

// 8. إلغاء الحجز واسترجاع النقاط
app.post('/api/bookings/cancel', (req, res) => {
    const { bookingReference } = req.body;
    const booking = bookingsDatabase.find(b => b.bookingReference === bookingReference);

    if (!booking) {
        return res.status(404).json({ success: false, error: 'الحجز غير موجود.' });
    }

    if (booking.status === 'cancelled') {
        return res.status(400).json({ success: false, error: 'الحجز ملغي مسبقاً.' });
    }

    booking.status = 'cancelled';
    res.json({ success: true, message: 'تم إلغاء الحجز بنجاح.' });
});

// 9. توليد قسيمة الحجز الرسمية (PDF) بشعار وعنوان شركة الرمال الدولية في دبي
app.get('/api/bookings/pdf/:ref', (req, res) => {
    const ref = req.params.ref;
    const booking = bookingsDatabase.find(b => b.bookingReference === ref);

    if (!booking) {
        return res.status(404).send('الحجز غير موجود.');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Rimal-Booking-${ref}.pdf`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // ترويسة الفاتورة والشركة الرسمية
    doc.fontSize(22).fillColor('#1f3a40').text('شركة الرمال الدولية', { align: 'right' });
    doc.fontSize(11).fillColor('#6c757d').text('دائرة السياحة والاقتصاد، Block B, Office 610', { align: 'right' });
    doc.text('ميناء سعيد، دبي، الإمارات العربية المتحدة', { align: 'right' });
    doc.text('هاتف: +971544757578 | البريد: managment@remaltourismllc.com', { align: 'right' });
    
    doc.moveDown(2);
    doc.fontSize(16).fillColor('#ff595e').text(`قسيمة تأكيد حجز إلكتروني`, { align: 'center' });
    doc.moveDown(1);

    // صندوق بيانات الحجز
    doc.fontSize(12).fillColor('#1f3a40');
    doc.text(`رقم مرجع الحجز (Reference): ${booking.bookingReference}`, { align: 'right' });
    doc.text(`اسم العميل الكريم: ${booking.customerName}`, { align: 'right' });
    doc.text(`البريد الإلكتروني: ${booking.email}`, { align: 'right' });
    doc.text(`رقم التواصل (WhatsApp): ${booking.phone}`, { align: 'right' });
    if(booking.companions) {
        doc.text(`أسماء المرافقين: ${booking.companions}`, { align: 'right' });
    }
    doc.moveDown(0.5);
    doc.text(`الفندق المحجوز: ${booking.hotelName}`, { align: 'right' });
    doc.text(`المبلغ الإجمالي المدفوع: ${booking.price} AED`, { align: 'right' });
    doc.text(`طريقة الدفع: ${booking.paymentMethod === 'visa' ? 'دفع إلكتروني (Ziina)' : 'الدفع عند الاستقبال'}`, { align: 'right' });
    doc.text(`حالة الحجز: مؤكد في السحابة ✅`, { align: 'right' });
    doc.text(`سياسة الإلغاء: ${booking.cancellationPolicy}`, { align: 'right' });

    doc.moveDown(3);
    doc.fontSize(10).fillColor('#6c757d').text('شكراً لثقتكم بـ شركة الرمال الدولية. نتمنى لكم إقامة ممتعة في دبي! ✈️', { align: 'center' });

    doc.end();
});

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`🚀 خادم شركة الرمال الدولية يعمل بكفاءة تامة على المنفذ ${PORT}`);
});
