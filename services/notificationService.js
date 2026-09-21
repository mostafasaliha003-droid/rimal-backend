// services/notificationService.js

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer'); 
const logger = require('./loggerService'); 

// 🌟 فلتر ذكي لتنظيف النصوص من الإيموجيز قبل حقنها في الـ PDF
const sanitizeText = (str) => {
    if (!str) return 'N/A';
    return str.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]+/gu, '').trim();
};

// إعداد خادم الإيميل (يفضل إبقاء حساب Gmail الرسمي لضمان وصول الرسائل للـ Inbox)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER || 'management@remaltourismllc.com',
        pass: process.env.SMTP_PASS || 'tliy arac oiob deej'
    }
});

// 1. توليد قسيمة الحجز الفاخرة باستخدام Puppeteer (في الذاكرة - Buffer)
async function generateVoucher(bookingDetails, hcn) {
    logger.info(`📄 Generating Luxury PDF Voucher via Puppeteer for HCN: ${hcn}...`);
    let browser;
    try {
        // استدعاء قالب الـ HTML الأساسي من المجلد الجذري
        const templatePath = path.join(__dirname, '../voucher-template.html');
        let voucherHtml = fs.readFileSync(templatePath, 'utf8');

        // تنظيف البيانات
        let cleanHotelName = sanitizeText(bookingDetails.hotelName);
        let cleanPolicyText = sanitizeText(bookingDetails.cancellationPolicy || bookingDetails.policyText);

        // حقن البيانات في القالب
        voucherHtml = voucherHtml
            .replace(/{{bookingReference}}/g, hcn)
            .replace(/{{hotelName}}/g, cleanHotelName)
            .replace(/{{encodedHotelName}}/g, encodeURIComponent(cleanHotelName)) 
            .replace('{{customerName}}', bookingDetails.guestName || bookingDetails.customerName || 'N/A')
            .replace('{{customerPhone}}', bookingDetails.phone || bookingDetails.holderPhone || 'N/A')
            .replace('{{customerEmail}}', bookingDetails.email || bookingDetails.holderEmail || 'N/A')
            .replace('{{roomBed}}', bookingDetails.roomName || 'سرير مزدوج / كينج')
            .replace('{{boardType}}', bookingDetails.board || 'شامل الوجبات')
            .replace('{{price}}', bookingDetails.price || 0)
            .replace('{{policyText}}', cleanPolicyText);

        // تشغيل Puppeteer بإعدادات متوافقة مع Render
        browser = await puppeteer.launch({
            headless: true, 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        
        const page = await browser.newPage();
        await page.setContent(voucherHtml, { waitUntil: 'networkidle0' });

        // توليد الـ PDF في الذاكرة (Buffer) بدلاً من حفظه في القرص الصلب
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });

        logger.info(`✅ PDF Buffer generated successfully for ${hcn}`);
        return pdfBuffer;

    } catch (error) {
        logger.error("❌ Error generating PDF with Puppeteer:", { error: error.message });
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// 2. 🚀 إرسال الإيميل الرسمي مع المرفقات
async function sendEmailConfirmation(customerEmail, guestName, hcn, pdfBuffer) {
    logger.info(`📧 Attempting to send official confirmation email to ${customerEmail}...`);

    try {
        const templatePath = path.join(__dirname, '../email-template.html');
        let emailHtml = '';

        // استخدام القالب الفاخر إذا كان موجوداً، وإلا استخدام قالب نصي بديل
        if (fs.existsSync(templatePath)) {
            emailHtml = fs.readFileSync(templatePath, 'utf8');
            emailHtml = emailHtml
                .replace('{{customerName}}', (guestName || '').split(' ')[0] || 'ضيفنا الكريم')
                .replace('{{hotelName}}', 'فندقك المختار')
                .replace(/{{bookingReference}}/g, hcn)
                .replace('{{checkInDate}}', 'حسب الطلب')
                .replace('{{price}}', ''); // السعر مسجل في القسيمة المرفقة
        } else {
            emailHtml = `
                <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; background: #f0f8ff; border: 2px solid #0077b6; border-radius: 10px;">
                    <h2 style="color: #0077b6;">مرحباً ${guestName}،</h2>
                    <p>نشكرك على اختيار <b>شركة الرمال الدولية</b> لحجز إقامتك.</p>
                    <p>تم تأكيد حجزك بنجاح. يرجى إبراز رقم التأكيد التالي عند الوصول لمكتب الاستقبال في الفندق:</p>
                    <h3 style="color: #d90429; background: #ffffff; padding: 10px; border-radius: 8px; width: fit-content;">رقم التأكيد (HCN): ${hcn}</h3>
                    <p>لقد أرفقنا قسيمة الحجز المعتمدة (Voucher) كملف PDF مع هذه الرسالة. يرجى تحميله والاحتفاظ به.</p>
                    <br>
                    <p>نتمنى لك إقامة سعيدة!</p>
                    <p><strong>فريق دعم Remalbookings</strong></p>
                </div>
            `;
        }

        let info = await transporter.sendMail({
            from: '"شركة الرمال الدولية" <management@remaltourismllc.com>',
            to: customerEmail,
            subject: `تأكيد حجزك الفندقي من الرمال | المرجع: ${hcn}`,
            html: emailHtml,
            attachments: [
                {
                    filename: `Rimal-Voucher-${hcn}.pdf`,
                    content: pdfBuffer, // تمرير الـ Buffer المولد من Puppeteer مباشرة
                    contentType: 'application/pdf'
                }
            ]
        });

        logger.info(`✅ Email sent successfully. Message ID: ${info.messageId}`);
        return true;
    } catch (error) {
        logger.error("❌ Email Dispatch Error", { error: error.message });
        return false;
    }
}

module.exports = {
    generateVoucher,
    sendEmailConfirmation
};
