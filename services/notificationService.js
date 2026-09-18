const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer'); 
const logger = require('./loggerService'); // 🔴 تم دمج نظام المراقبة لسجلات النظام

// 1. توليد قسيمة الحجز (PDF Voucher)
async function generateVoucher(bookingDetails, hcn) {
    logger.info(`📄 Generating PDF Voucher for booking with HCN: ${hcn}...`);
    
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            
            const dir = path.join(__dirname, '../vouchers');
            if (!fs.existsSync(dir)){ fs.mkdirSync(dir); }
            
            const filePath = path.join(dir, `Voucher_${hcn}.pdf`);
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // تصميم القسيمة (بألوان وهوية شركة الرمال)
            doc.fontSize(25).fillColor('#00b4d8').text('Remalbookings Voucher', { align: 'center' });
            doc.moveDown();
            doc.fontSize(16).fillColor('#1f3a40').text(`Hotel Confirmation Number (HCN): ${hcn}`, { underline: true });
            doc.moveDown();
            doc.fontSize(14).fillColor('#000000');
            doc.text(`Guest Name: ${bookingDetails.guestName || 'Valued Guest'}`);
            doc.text(`Hotel: ${bookingDetails.hotelName || 'Remal Partner Hotel'}`);
            doc.text(`Check-in: ${bookingDetails.checkIn || 'N/A'}`);
            doc.text(`Check-out: ${bookingDetails.checkOut || 'N/A'}`);
            doc.moveDown(2);
            doc.fontSize(12).fillColor('gray').text('Thank you for choosing Remal International Company!', { align: 'center' });
            
            doc.end();

            stream.on('finish', () => {
                logger.info(`✅ PDF Voucher saved successfully at: ${filePath}`);
                resolve(filePath);
            });
        } catch (error) {
            logger.error("❌ Error generating PDF:", { error: error.message });
            reject(error);
        }
    });
}

// 2. 🚀 إرسال الإيميل الرسمي مع المرفقات
async function sendEmailConfirmation(customerEmail, guestName, hcn, pdfFilePath) {
    logger.info(`📧 Attempting to send official confirmation email to ${customerEmail}...`);

    try {
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;

        // التحقق من وجود بيانات الإيميل في ملف .env
        if (!smtpUser || !smtpPass) {
            logger.warn("⚠️ Email not sent: SMTP credentials missing in .env (Running in Mock Mode)");
            return false;
        }

        // إعدادات خادم الإيميل الديناميكية
        let transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.yourcompany.com", 
            port: process.env.SMTP_PORT || 465,
            secure: true,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        });

        // تصميم محتوى الإيميل
        let info = await transporter.sendMail({
            from: `"Remalbookings Support" <${smtpUser}>`,
            to: customerEmail,
            subject: `تأكيد حجزك الفندقي - رقم التأكيد: ${hcn} 🏨`,
            html: `
                <div style="direction: rtl; font-family: Arial, sans-serif; padding: 20px; color: #1f3a40;">
                    <h2>مرحباً ${guestName}،</h2>
                    <p>نشكرك على اختيار <b>شركة الرمال الدولية</b> لحجز إقامتك.</p>
                    <p>تم تأكيد حجزك بنجاح. يرجى إبراز رقم التأكيد التالي عند الوصول لمكتب الاستقبال في الفندق:</p>
                    <h3 style="color: #00b4d8; background: #f8f9fa; padding: 10px; border-radius: 8px; width: fit-content;">رقم التأكيد (HCN): ${hcn}</h3>
                    <p>لقد أرفقنا قسيمة الحجز (Voucher) كملف PDF مع هذه الرسالة. يرجى تحميله والاحتفاظ به.</p>
                    <br>
                    <p>نتمنى لك إقامة سعيدة!</p>
                    <p><strong>فريق دعم Remalbookings</strong></p>
                </div>
            `,
            attachments: [
                {
                    filename: `Remalbookings_Voucher_${hcn}.pdf`,
                    path: pdfFilePath // 🔴 إرفاق الـ PDF آلياً من السيرفر
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