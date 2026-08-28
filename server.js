const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

const memoryBookings = [];

// إعداد خدمة النودمايلر (Nodemailer) بكلمة مرور التطبيق الجديدة
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'vqtiunlaehuugjwc'
    }
});

app.post('/api/bookings', async (req, res) => {
    try {
        const { hotelName, customerName, email, phone, companions, paymentMethod } = req.body;
        
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);

        const newBooking = {
            bookingReference,
            hotelName,
            customerName,
            email,
            phone,
            companions,
            paymentMethod,
            createdAt: new Date()
        };

        memoryBookings.push(newBooking);

        // إرسال رد النجاح للمستخدم فوراً وبسرعة فائقة
        res.status(201).json({
            success: true,
            message: 'تم تثبيت الحجز بنجاح',
            bookingReference
        });

        // إرسال البريد الإلكتروني الحقيقي في الخلفية
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
                console.log(`✅ تم إرسال إيميل التأكيد الحقيقي بنجاح للحجز: ${bookingReference}`);
            } catch (mailError) {
                console.log(`⚠️ تنبيه في إرسال الإيميل: ${mailError.message}`);
            }
        });

    } catch (error) {
        console.error('❌ خطأ:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 الخادم جاهز على المنفذ ${PORT}`);
});
