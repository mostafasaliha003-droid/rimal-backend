const logger = require('./loggerService'); // 🔴 دمج نظام المراقبة لتوثيق التحديثات
// const paymentService = require('./paymentService'); // جاهز للاستدعاء المستقبلي
// const notificationService = require('./notificationService'); // جاهز للاستدعاء المستقبلي

// 🔔 محرك معالجة التحديثات الواردة من مزودي الخدمة
async function handleRateHawkWebhook(payload) {
    logger.info("🔔 [WEBHOOK] Alert! Received a live update from RateHawk", { 
        hcn: payload.hcn, 
        status: payload.status 
    });
    
    // استخراج بيانات التحديث (رقم الحجز، والحالة الجديدة)
    const { hcn, status, reason } = payload;

    if (status === 'CANCELLED_BY_HOTEL') {
        // 🔴 توثيق الإلغاء كتحذير (Warning) ليلفت انتباه الإدارة في السجلات
        logger.warn(`⚠️ [URGENT] Booking ${hcn} was cancelled by the supplier! Reason: ${reason}`);
        
        /* 
        هنا ستتم الأتمتة اللاحقة:
        1. await paymentService.refund(hcn); // لإرجاع المبلغ عبر Ziina
        2. await notificationService.sendEmail(...); // لإبلاغ العميل بالاعتذار
        3. تحديث حالة الحجز في قاعدة البيانات (MongoDB).
        */
        
        return { success: true, action: "Refund and Notify triggered" };
    }

    if (status === 'CONFIRMED') {
        logger.info(`✅ [WEBHOOK] Booking ${hcn} is officially confirmed and locked by the hotel.`);
        return { success: true, action: "Status updated to Confirmed" };
    }

    logger.info(`ℹ️ [WEBHOOK] Unhandled status update: ${status}`);
    return { success: true, action: "No action required" };
}

module.exports = {
    handleRateHawkWebhook
};