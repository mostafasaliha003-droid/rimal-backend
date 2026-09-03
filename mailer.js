const express = require('express');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const app = express();

app.use(express.json());

// إعداد خدمة الإرسال (مثال: استخدام SendGrid أو أي SMTP مخصص)
const transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net', // استبدل بمزودك
    port: 587,
    auth: {
        user: 'apikey', 
        pass: process.env.SMTP_PASSWORD 
    }
});

app.post('/api/v1/bookings/finalize', async (req, res) => {
    let browser;
    try {
        const bookingData = req.body; 

        // 1. قراءة قوالب الـ HTML
        let voucherHtml = fs.readFileSync('./voucher-template.html', 'utf8');
        let emailHtml = fs.readFileSync('./email-template.html', 'utf8');

        // 2. استبدال المتغيرات في قالب الـ PDF
        voucherHtml = voucherHtml
            .replace(/{{bookingReference}}/g, bookingData.bookingReference)
            .replace('{{customerName}}', bookingData.customerName)
            .replace('{{customerPhone}}', bookingData.phone)
            .replace('{{customerEmail}}', bookingData.email)
            .replace('{{hotelName}}', bookingData.hotelName)
            .replace('{{roomBed}}', bookingData.bed || 'غير محدد')
            .replace('{{boardType}}', bookingData.boardType || 'غير محدد')
            .replace('{{price}}', bookingData.price)
            .replace('{{policyText}}', bookingData.cancellationPolicy);

        // 3. استبدال المتغيرات في قالب الإيميل
        emailHtml = emailHtml
            .replace('{{customerName}}', bookingData.customerName.split(' ')[0]) // الاسم الأول
            .replace('{{hotelName}}', bookingData.hotelName)
            .replace('{{bookingReference}}', bookingData.bookingReference)
            .replace('{{checkInDate}}', bookingData.checkInDate || 'حسب الطلب')
            .replace('{{price}}', bookingData.price);

        // 4. تشغيل Puppeteer مع تحسينات الأداء
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        await page.setContent(voucherHtml, { waitUntil: 'networkidle0' });

        // التقاط الـ PDF من الذاكرة
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px' }
        });

        // 5. إعداد وإرسال البريد الإلكتروني مع المرفق في الذاكرة
        const mailOptions = {
            from: '"رمال وفلّها" <reservations@remalbookings.com>',
            to: bookingData.email,
            subject: `تأكيد حجزك المؤكد - ${bookingData.hotelName} 🌴`,
            html: emailHtml,
            attachments: [
                {
                    filename: `Remal_Voucher_${bookingData.bookingReference}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ تم تأكيد الحجز وإرسال الإيميل والقسيمة إلى ${bookingData.email}`);

        // إرجاع استجابة نجاح للواجهة الأمامية
        res.status(200).json({ success: true, message: 'تم إرسال القسيمة بنجاح!' });

    } catch (error) {
        console.error('❌ خطأ في معالجة الحجز:', error);
        res.status(500).json({ success: false, error: 'حدث خطأ أثناء معالجة القسيمة.' });
    } finally {
        // حماية الذاكرة: إغلاق المتصفح دائماً
        if (browser) await browser.close();
    }
});

app.listen(3000, () => console.log('✅ خادم الحجوزات يعمل ومستعد لإرسال الإيميلات!'));
