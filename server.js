const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const stripe = require('stripe')('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');

const app = express();
app.use(express.json());
app.use(cors());

app.use(express.static(__dirname));

const memoryBookings = [];

// إعداد خدمة النودمايلر (Nodemailer) بكلمة مرور التطبيق
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'management@remaltourismllc.com',
        pass: 'vqtiunlaehuugjwc'
    }
});

// مسار تثبيت الحجز العادي
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

// مسار إنشاء جلسة الدفع الإلكتروني الفعلي عبر Stripe
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { hotelName, customerName, email, price } = req.body;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'aed', // العملة بالدرهم الإماراتي
                    product_data: {
                        name: `حجز فندق: ${hotelName}`,
                        description: `حجز مؤكد لصالح العميل: ${customerName}`,
                    },
                    unit_amount: (price || 100) * 100, // السعر بالفلوس (الافتراضي 100 درهم إذا لم يُرسل)
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `https://rimal-api.onrender.com/success.html`,
            cancel_url: `https://rimal-api.onrender.com/cancel.html`,
            customer_email: email,
        });

        res.json({ id: session.id });
    } catch (error) {
        console.error('❌ Stripe Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 الخادم جاهز على المنفذ ${PORT}`);
});
