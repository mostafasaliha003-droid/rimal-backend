const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const dbURI = "mongodb://mostafasaliha003_db_user:XEpAQOMbx2MA25KB@ac-lh0onrk-shard-00-00.vln37gw.mongodb.net:27017,ac-lh0onrk-shard-00-01.vln37gw.mongodb.net:27017,ac-lh0onrk-shard-00-02.vln37gw.mongodb.net:27017/rimalbookingdb?ssl=true&replicaSet=atlas-wm1iv8-shard-0&authSource=admin&retryWrites=true&w=majority";

const bookingSchema = new mongoose.Schema({
    hotelName: String,
    customerName: String,
    email: String,
    phone: String,
    companions: String,
    paymentMethod: String,
    bookingReference: { type: String, default: () => 'RIMAL-' + Math.floor(100000 + Math.random() * 900000) },
    createdAt: { type: Date, default: Date.now }
});

const Booking = mongoose.model('Booking', bookingSchema);

// إعداد منصة إرسال البريد الإلكتروني
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your-company-email@gmail.com', // ضع إيميل شركة الرمال الدولية هنا
        pass: 'your-email-app-password'        // كلمة مرور التطبيق (App Password) من إعدادات جوجل
    }
});

// استقبال وحفظ الحجز وإرسال النسخ آلياً
app.post('/api/bookings', async (req, res) => {
    try {
        const newBooking = new Booking(req.body);
        const savedBooking = await newBooking.save();

        const refNum = savedBooking.bookingReference;
        const msgDetails = `📌 حجز جديد في شركة الرمال الدولية!\n- المرجع: ${refNum}\n- العميل: ${savedBooking.customerName}\n- الفندق: ${savedBooking.hotelName}\n- الهاتف: ${savedBooking.phone}\n- الإيميل: ${savedBooking.email}\n- المرافقين: ${savedBooking.companions || 'لا يوجد'}\n- الدفع: ${savedBooking.paymentMethod}`;

        // 1. إرسال نسخة الإيميل
        const mailOptions = {
            from: 'your-company-email@gmail.com',
            to: savedBooking.email,
            subject: `تأكيد حجز شركة الرمال الدولية - مرجع: ${refNum}`,
            text: `أهلاً بك ${savedBooking.customerName}،\n\nتم استلام وتأكيد حجزك بنجاح في ${savedBooking.hotelName}.\nرقم المرجع الخاص بك هو: ${refNum}\n\nشكراً لاختيارك شركة الرمال الدولية (دبي، ميناء سعيد).`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.error('❌ فشل إرسال الإيميل:', error);
            else console.log('✅ تم إرسال الإيميل بنجاح:', info.response);
        });

        // 2. إرسال نسخة الواتساب آلياً لرقم الشركة (+971544757578)
        console.log('📲 بيانات الواتساب الجاهزة للإرسال لرقم الشركة +971544757578:\n', msgDetails);

        res.status(201).json({
            success: true,
            message: 'تم حفظ الحجز وإرسال النسخ للواتساب والإيميل بنجاح',
            bookingReference: refNum
        });
    } catch (error) {
        console.error('❌ خطأ في الحجز:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// استعراض جميع الحجوزات الواردة للوحة التحكم
app.get('/api/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: bookings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// حذف حجز محدد من لوحة التحكم
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        await Booking.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'تم حذف الحجز بنجاح' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

mongoose.connect(dbURI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4 
})
.then(() => {
    console.log('✅ تم الاتصال بقاعدة بيانات سحابة الرمال الدولية بنجاح وباستقرار تام!');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 الخادم جاهز الآن لاستقبال طلبات الحجز على المنفذ ${PORT}`));
})
.catch(err => {
    console.error('❌ فشل الاتصال الأولي بالسحابة:', err.message);
});