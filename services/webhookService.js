// services/webhookService.js

const logger = require('./loggerService'); 
const mongoose = require('mongoose');

// جاهزة للاستدعاء المستقبلي عند تفعيل الأتمتة الكاملة للرسائل واسترجاع الأموال
// const paymentService = require('./paymentService'); 
// const notificationService = require('./notificationService'); 

// 🔔 محرك معالجة التحديثات الواردة من مزودي الخدمة
async function handleRateHawkWebhook(payload) {
    logger.info("🔔 [WEBHOOK] Alert! Received a live update from RateHawk", { 
        hcn: payload.hcn, 
        status: payload.status 
    });
    
    // استخراج بيانات التحديث (رقم الحجز، والحالة الجديدة)
    const { hcn, status, reason } = payload;

    // 🔴 استدعاء نموذج الحجز من قاعدة البيانات (تم تعريفه في server.js)
    const Booking = mongoose.models.Booking;

    if (status === 'CANCELLED_BY_HOTEL') {
        // توثيق الإلغاء كتحذير (Warning) ليلفت انتباه الإدارة في السجلات
        logger.warn(`⚠️ [URGENT] Booking ${hcn} was cancelled by the supplier! Reason: ${reason}`);
        
        // 🔄 التحديث التلقائي في قاعدة بيانات MongoDB
        if (Booking) {
            try {
                await Booking.findOneAndUpdate(
                    { supplierReference: hcn },
                    { status: 'cancelled', supplierStatus: 'CANCELLED_BY_HOTEL' }
                );
                logger.info(`✅ [DB] Booking ${hcn} marked as cancelled in the database.`);
            } catch (dbErr) {
                logger.error(`❌ [DB Error] Failed to update booking ${hcn}`, { error: dbErr.message });
            }
        }
        
        /* 
        هنا ستتم الأتمتة اللاحقة في التحديثات القادمة:
        1. await paymentService.refund(hcn); // لإرجاع المبلغ عبر Ziina
        2. await notificationService.sendEmail(...); // لإبلاغ العميل بالاعتذار
        */
        
        return { success: true, action: "Refund and Notify triggered, DB Updated" };
    }

    if (status === 'CONFIRMED') {
        logger.info(`✅ [WEBHOOK] Booking ${hcn} is officially confirmed and locked by the hotel.`);
        
        // 🔄 تأكيد الحجز في قاعدة البيانات
        if (Booking) {
            try {
                await Booking.findOneAndUpdate(
                    { supplierReference: hcn },
                    { supplierStatus: 'CONFIRMED_LIVE' }
                );
                logger.info(`✅ [DB] Booking ${hcn} marked as CONFIRMED_LIVE in the database.`);
            } catch (dbErr) {
                logger.error(`❌ [DB Error] Failed to confirm booking ${hcn}`, { error: dbErr.message });
            }
        }

        return { success: true, action: "Status updated to Confirmed" };
    }

    logger.info(`ℹ️ [WEBHOOK] Unhandled status update: ${status}`);
    return { success: true, action: "No action required" };
}

module.exports = {
    handleRateHawkWebhook
};
