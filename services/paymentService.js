const axios = require('axios');
const logger = require('./loggerService'); // 🔴 تم إضافة نظام المراقبة لتوثيق العمليات المالية

// 1. بوابة التحقق من السعر (Recheck Validation Gate)
async function validatePrice(oldPriceAED, newPriceAED) {
    logger.info(`🔍 Rechecking prices: Old (AED ${oldPriceAED}) vs New (AED ${newPriceAED})`);
    
    // حساب نسبة التغير
    const variancePercentage = ((newPriceAED - oldPriceAED) / oldPriceAED) * 100;
    
    // 🔴 تطبيق قاعدة الـ 2% لحماية العميل من أي تلاعب
    if (variancePercentage > 2.0) {
        logger.warn(`❌ Price rejected! Variance is ${variancePercentage.toFixed(2)}% (Max allowed is 2%)`);
        return { 
            success: false, 
            error: "PRICE_CHANGED", 
            message: "تغير سعر الفندق بنسبة تتجاوز الحد المسموح. يرجى تحديث البحث.",
            variance: variancePercentage
        };
    }

    logger.info(`✅ Price validated successfully. Variance: ${variancePercentage.toFixed(2)}%`);
    return { success: true, finalPrice: newPriceAED, variance: variancePercentage };
}

// 2. تجهيز رابط الدفع عبر Ziina
async function createZiinaCheckout(bookingDetails, finalPrice) {
    logger.info(`💳 Preparing Ziina checkout session for AED ${finalPrice}...`);
    
    try {
        // سحب مفتاح Ziina من الملف السري لحماية بيانات الشركة
        const ziinaApiKey = process.env.ZIINA_API_KEY;

        if (ziinaApiKey && ziinaApiKey !== '') {
            // ==========================================
            // 🔴 الربط الفعلي مع Ziina API (Live Mode)
            // ==========================================
            logger.info("Initiating Live Transaction with Ziina API...");
            const response = await axios.post('https://api.ziina.com/v1/payment_intents', {
                amount: Math.round(finalPrice * 100), // Ziina تتعامل بالعملات الصغرى (فلس)
                currency: 'AED',
                success_url: 'https://remalbookings.com/success',
                cancel_url: 'https://remalbookings.com/cancel'
            }, { 
                headers: { 
                    'Authorization': `Bearer ${ziinaApiKey}`,
                    'Content-Type': 'application/json'
                } 
            });
            
            logger.info("Live Ziina Payment URL generated successfully.");
            return response.data.payment_url;
            
        } else {
            // ==========================================
            // 🟡 وضع المحاكاة (Sandbox/Mock Mode)
            // يعمل فقط إذا كان المفتاح السري فارغاً
            // ==========================================
            logger.warn("ZIINA_API_KEY is missing in .env! Operating in Mock/Sandbox mode.");
            const mockZiinaUrl = `https://pay.ziina.com/remal-test-checkout?amount=${finalPrice}&session=${Date.now()}`;
            return mockZiinaUrl;
        }

    } catch (error) {
        logger.error("❌ Ziina Checkout Error", { error: error.message });
        throw new Error("فشل في تهيئة بوابة الدفع");
    }
}

module.exports = {
    validatePrice,
    createZiinaCheckout
};