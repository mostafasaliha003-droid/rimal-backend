const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors());

// 1. الاتصال بقاعدة البيانات MongoDB (بدون خيارات قديمة مسببة للتحذيرات)
mongoose.connect('mongodb+srv://mostafasalihadroid:dY04Y61kUjO6b1rJ@cluster0.pblx5.mongodb.net/rimal_db?retryWrites=true&w=majority')
  .then(() => console.log('✅ تم الاتصال بقاعدة بيانات سحابة الرمال الدولية بنجاح واستقرار تام'))
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

// 2. تصميم هيكل بيانات الحجز في قاعدة البيانات
const bookingSchema = new mongoose.Schema({
    bookingReference: String,
    hotelName: String,
    customerName: String,
    email: String,
    phone: String,
    companions: String,
    paymentMethod: String,
    createdAt: { type: Date, default: Date.now }
});

const Booking = mongoose.model('Booking', bookingSchema);

// 3. إعداد خدمة النودمايلر (Nodemailer) لإرسال الإيميلات عبر بريد الإدارة
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'vgrhcsilcikucf'
    }
});

// 4. نقطة النهاية (API) لاستقبال الحجوزات وحفظها وإرسال الإيميل
app.post('/api/bookings', async (req, res) => {
    try {
        const { hotelName, customerName, email, phone, companions, paymentMethod } = req.body;
        
        // توليد رقم مرجعي عشوائي للحجز
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);

        // حفظ الحجز في قاعدة البيانات
        const newBooking = new Booking({
            bookingReference,
            hotelName,
            customerName,
            email,
            phone,
            companions,
            paymentMethod
        });

        await newBooking.save();

        // محتوى البريد الإلكتروني الذي سيتم إرساله
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

        // إرسال الإيميل
        await transporter.sendMail(mailOptions);
        console.log(`✅ تم إرسال إيميل التأكيد بنجاح للحجز: ${bookingReference}`);

        res.status(201).json({
            success: true,
            message: 'تم حفظ الحجز وإرسال الإيميل بنجاح',
            bookingReference
        });

    } catch (error) {
        console.error('❌ خطأ أثناء معالجة الحجز:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// تشغيل الخادم على المنفذ المتاح أو المنفذ 5000
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 الخادم جاهز الآن لاستقبال طلبات الحجز على المنفذ ${PORT}`);
});
