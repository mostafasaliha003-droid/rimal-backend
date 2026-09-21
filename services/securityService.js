const rateLimit = require('express-rate-limit');
const logger = require('./loggerService'); // لتسجيل أي محاولات هجوم

// ==========================================
// 🛡️ 1. جدار حماية البحث (Search API Limiter)
// ==========================================
// الهدف: منع المنافسين من إغراق النظام بطلبات بحث وهمية لضرب الـ Look-to-Book ratio
const searchLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // الإطار الزمني: دقيقة واحدة
    max: 15, // الحد الأقصى: 15 عملية بحث لكل IP في الدقيقة (رقم مستحيل لبشر طبيعي)
    message: {
        success: false,
        error: "تم اكتشاف نشاط غير عادي. يرجى الانتظار قليلاً قبل البحث مجدداً."
    },
    standardHeaders: true, // إرجاع معلومات الحد في ترويسة الطلب (RateLimit-*)
    legacyHeaders: false, // تعطيل ترويسات X-RateLimit-* القديمة
    handler: (req, res, next, options) => {
        logger.warn(`🚨 SECURITY ALERT: Search API Rate Limit Exceeded by IP: ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});


// ==========================================
// 💳 2. جدار حماية الدفع والحجز (Booking/Checkout Limiter)
// ==========================================
// الهدف: منع عصابات الاحتيال من تجربة البطاقات الائتمانية المسروقة (Card Testing) وتجنب الحجوزات الوهمية
const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // الإطار الزمني: 15 دقيقة
    max: 5, // الحد الأقصى: 5 محاولات حجز لكل IP في ربع ساعة
    message: {
        success: false,
        error: "لقد تجاوزت الحد المسموح به لمحاولات الحجز. لحمايتك، يرجى المحاولة بعد 15 دقيقة."
    },
    handler: (req, res, next, options) => {
        logger.error(`🚨 CRITICAL SECURITY: Booking/Payment spam detected from IP: ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});


// ==========================================
// 🌍 3. جدار الحماية العام (Global Limiter)
// ==========================================
// الهدف: حماية السيرفر ككل من هجمات الـ DDoS الخفيفة (Denial of Service)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // الإطار الزمني: 15 دقيقة
    max: 200, // الحد الأقصى: 200 طلب من أي نوع لكل IP
    message: {
        success: false,
        error: "Too many requests from this IP, please try again later."
    },
    handler: (req, res, next, options) => {
        logger.warn(`⚠️ GLOBAL LIMIT: High traffic volume from IP: ${req.ip}`);
        res.status(options.statusCode).send(options.message);
    }
});

// 📦 التصدير لاستخدامها في السيرفر الرئيسي (server.js)
module.exports = {
    searchLimiter,
    bookingLimiter,
    globalLimiter
};