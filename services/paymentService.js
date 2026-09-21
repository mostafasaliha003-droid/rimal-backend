// services/paymentService.js

const logger = require('./loggerService'); 

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
            message: "تغير سعر الفندق بنسبة تتجاوز الحد المسموح. يرجى إعادة البحث لتحديث السعر.",
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
        
        // جلب رقم المرجع لربطه بالبوابة المالية
        const bookingReference = bookingDetails.bookingReference || `RML-${Date.now()}`;
        
        // 🔴 Ziina تتعامل بالعملات الصغرى (فلس)
        const amountInFils = Math.round(finalPrice * 100);

        if (amountInFils < 200) {
            throw new Error('الحد الأدنى للمعاملة هو 2 درهم.');
        }

        if (ziinaApiKey && ziinaApiKey !== '') {
            // ==========================================
            // 🔴 الربط الفعلي مع Ziina API (Live Mode)
            // ==========================================
            logger.info("Initiating Live Transaction with Ziina API...");
            
            const response = await fetch('https://api-v2.ziina.com/api/payment_intent', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ziinaApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: amountInFils,
                    currency_code: 'AED',
                    // تم التعديل هنا: توجيه العميل بعد الدفع لواجهة الموقع الأمامية
                    success_url: `https://remalbookings.com/index.html?payment=success&ref=${bookingReference}`,
                    cancel_url: `https://remalbookings.com/payment-cancel?ref=${bookingReference}`
                })
            });
            
            const data = await response.json();

            if (data.redirect_url) {
                logger.info("Live Ziina Payment URL generated successfully.");
                return data.redirect_url;
            } else {
                logger.error("Ziina Error Details:", data);
                throw new Error("فشل في توليد رابط الدفع من Ziina.");
            }
            
        } else {
            // ==========================================
            // 🟡 وضع المحاكاة (Sandbox/Mock Mode)
            // ==========================================
            logger.warn("ZIINA_API_KEY is missing in .env! Operating in Mock/Sandbox mode.");
            const mockZiinaUrl = `https://pay.ziina.com/remal-test-checkout?amount=${finalPrice}&session=${Date.now()}&ref=${bookingReference}`;
            return mockZiinaUrl;
        }

    } catch (error) {
        logger.error("❌ Ziina Checkout Error", { error: error.message });
        throw new Error("فشل في تهيئة بوابة الدفع: " + error.message);
    }
}

module.exports = {
    validatePrice,
    createZiinaCheckout
};
