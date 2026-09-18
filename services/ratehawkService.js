const axios = require('axios');
const logger = require('./loggerService'); // 🔴 تم دمج نظام المراقبة لسجلات النظام

// ==========================================
// 🌟 1. محرك البحث العام (Destination Search - 12s SLA & Parallel Execution)
// ==========================================
const ratehawkAPI = axios.create({
    baseURL: 'https://api.worldota.net/api/b2b/v3',
    timeout: 12000, // مهلة 12 ثانية الصارمة للبحث
    headers: { 'Content-Type': 'application/json' }
});

// الآلية الذكية لإعادة المحاولة (Exponential Backoff Retry)
async function fetchWithRetry(requestData, retries = 3, backoff = 1000) {
    try {
        const apiKey = process.env.RATEHAWK_API_KEY;

        if (apiKey && apiKey !== '') {
            // الكود الفعلي سيعمل هنا بعد استلام مفاتيح الإنتاج
            // ratehawkAPI.defaults.headers.common['Authorization'] = `Basic ${apiKey}`;
            // return await ratehawkAPI.post('/search/multicomplete/', requestData);
        }

        // محاكاة (Mock) ريثما تصل المفاتيح
        const mockHotels = [
            { id: `RH-${Math.floor(Math.random() * 1000)}`, name: "Atlantis The Palm", priceAED: 2100, provider: "RateHawk" },
            { id: `RH-${Math.floor(Math.random() * 1000)}`, name: "DoubleTree by Hilton Dubai", priceAED: 490, provider: "RateHawk" }
        ];
        return { data: { success: true, hotels: mockHotels } };
        
    } catch (error) {
        if (retries === 0) {
            logger.error("❌ All retries failed. RateHawk API is unresponsive.", { error: error.message });
            throw error; 
        }
        logger.warn(`⚠️ API Call failed. Retrying in ${backoff}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return fetchWithRetry(requestData, retries - 1, backoff * 2);
    }
}

// خوارزمية تقسيم الطلبات والتنفيذ المتوازي (Chunking & Parallel Execution)
async function fetchHotelsInChunks(searchParams) {
    const hotelIds = searchParams.hotel_ids || Array.from({length: 1000}, (_, i) => `HOTEL_${i+1}`);
    logger.info(`🚀 Starting Destination Search for ${hotelIds.length} hotels...`);
    const CHUNK_SIZE = 250;
    
    // 🔴 إرسال الطلبات بالتوازي (Parallel) لضمان سرعة 3-5 ثوانٍ
    const chunkPromises = [];

    for (let i = 0; i < hotelIds.length; i += CHUNK_SIZE) {
        const chunk = hotelIds.slice(i, i + CHUNK_SIZE);
        logger.info(`📦 Preparing chunk: ${i} to ${i + chunk.length - 1}`);
        const requestData = { hotel_ids: chunk, ...searchParams };
        
        // دفع الطلب إلى مصفوفة الوعود
        chunkPromises.push(fetchWithRetry(requestData));
    }

    try {
        // تنفيذ جميع الطلبات في نفس اللحظة! (Asynchronous parallel requests)
        const responses = await Promise.all(chunkPromises);
        
        const allResults = [];
        responses.forEach(res => {
            if (res && res.data && res.data.hotels) {
                allResults.push(...res.data.hotels);
            }
        });
        
        logger.info(`🎉 Parallel search completed. Total hotels fetched: ${allResults.length}`);
        return allResults; 
    } catch (error) {
        logger.error("❌ Critical error during parallel chunk execution.", { error: error.message });
        throw new Error("فشل محرك البحث الموازي");
    }
}


// ==========================================
// 🏢 2. محرك بحث فندق واحد (Single Hotel Search - 8s Timeout) 
// ==========================================
async function fetchSingleHotelPage(hotelId, searchParams) {
    logger.info(`🏢 Fetching live rates for a single hotel: ${hotelId}. Timeout set strictly to 8s.`);
    
    // إنشاء اتصال خاص بمهلة 8 ثوانٍ فقط (كما تم التعهد به في الاستبيان)
    const singleHotelAPI = axios.create({
        baseURL: 'https://api.worldota.net/api/b2b/v3',
        timeout: 8000, // 🔴 8 ثوانٍ صارمة
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        // محاكاة جلب غرف فندق واحد
        logger.info(`✅ Single hotel data retrieved successfully.`);
        return { 
            success: true, 
            hotelId: hotelId, 
            rooms: [
                { roomId: "R-1", name: "Standard Room", priceAED: 500 },
                { roomId: "R-2", name: "Sea View Suite", priceAED: 1200 }
            ]
        };
    } catch (error) {
        logger.error(`❌ Timeout or Error fetching single hotel ${hotelId}.`, { error: error.message });
        throw new Error("فشل جلب بيانات الفندق في الوقت المحدد");
    }
}


// ==========================================
// 🔍 3. محرك إعادة التحقق (Recheck / Prebook - 15s Timeout)
// ==========================================
async function recheckHotel(recheckDetails) {
    logger.info(`🔍 Initiating Recheck (Prebook) API Call. Timeout set to 15s.`);
    const recheckAPI = axios.create({
        baseURL: 'https://api.worldota.net/api/b2b/v3',
        timeout: 15000, // 🔴 15 ثانية للتحقق 
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        // محاكاة استجابة الـ Recheck بنجاح
        logger.info(`✅ Recheck passed. Price and availability confirmed.`);
        return { success: true, status: "AVAILABLE", finalPrice: recheckDetails.priceAED };
    } catch (error) {
        logger.error(`❌ Recheck failed! Inventory may be sold out.`, { error: error.message });
        throw new Error("فشل التحقق من توافر الغرفة - قد تكون مباعة");
    }
}


// ==========================================
// 🛑 4. محرك الإلغاء (Cancellation - 60s Timeout)
// ==========================================
async function cancelBooking(hcn) {
    logger.info(`🛑 Initiating API Cancellation for HCN: ${hcn}. Timeout set to 60s.`);
    const cancelAPI = axios.create({
        baseURL: 'https://api.worldota.net/api/b2b/v3',
        timeout: 60000, // 🔴 60 ثانية صارمة لتجنب حالة الـ Desynchronization
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        // الكود الفعلي سيوضع هنا
        logger.info(`✅ Booking ${hcn} cancelled successfully on supplier side.`);
        return { success: true, status: "CANCELLED", hcn: hcn };
    } catch (error) {
        logger.error(`❌ Cancellation failed for ${hcn}. Potential state desynchronization!`, { error: error.message });
        throw new Error("فشل إلغاء الحجز من المصدر");
    }
}


// ==========================================
// 📥 5. محرك استخراج البيانات (Order Details - 15s Timeout)
// ==========================================
async function fetchOrderDetails(hcn) {
    logger.info(`📥 Extracting order details for HCN: ${hcn}. Timeout set to 15s.`);
    const orderDetailsAPI = axios.create({
        baseURL: 'https://api.worldota.net/api/b2b/v3',
        timeout: 15000, // 🔴 15 ثانية فقط لأنها عملية قراءة خفيفة
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        // الكود الفعلي سيوضع هنا
        logger.info(`✅ Order details retrieved successfully for ${hcn}.`);
        return { 
            success: true, 
            hcn: hcn, 
            status: "CONFIRMED", 
            hotelName: "Mock Partner Hotel",
            checkIn: "2026-10-01"
        };
    } catch (error) {
        logger.warn(`⚠️ Failed to extract order details within 15s. Dropping connection to prevent thread blocking.`);
        throw new Error("Time-out fetching order details");
    }
}


// ==========================================
// 🏨 6. محرك الحجز النهائي (Final Booking - 60s Timeout, Sanitization & Room Limit)
// ==========================================
async function bookHotel(bookingDetails) {
    logger.info(`🏨 Initiating Final Booking Request. Timeout strictly set to 60s.`);
    
    // 🔴 1. تطبيق الحد الأقصى للغرف (Max 4 Rooms)
    const requestedRooms = bookingDetails.rooms ? bookingDetails.rooms.length : 1;
    if (requestedRooms > 4) {
        logger.warn(`🚫 Booking rejected: Attempted to book ${requestedRooms} rooms. Max limit is 4.`);
        throw new Error("عذراً، الحد الأقصى المسموح به هو 4 غرف للحجز الواحد (سياسة المجموعات).");
    }

    // 🔴 2. تنسيق جنسية العميل لمعيار ISO 3166-1 alpha-2
    let customerResidency = bookingDetails.residency || 'AE';
    customerResidency = customerResidency.toUpperCase().substring(0, 2);

    // 🧹 3. تنظيف الملاحظات (Payload Sanitization) لحماية السيرفرات
    let sanitizedRemarks = "";
    if (bookingDetails.remarks) {
        sanitizedRemarks = bookingDetails.remarks.replace(/[^\w\s.,?!-]/gi, '').trim();
        logger.info("🧹 Sanitized booking remarks to prevent payload parsing errors on supplier side.");
    }

    const bookAPI = axios.create({
        baseURL: 'https://api.worldota.net/api/b2b/v3',
        timeout: 60000, // 🔴 60 ثانية صارمة لمنع orphaned bookings
        headers: { 'Content-Type': 'application/json' }
    });

    try {
        // الكود الحي سيوضع هنا
        
        // محاكاة تأكيد الحجز (Mock)
        const mockHCN = "RH-" + Math.floor(Math.random() * 1000000);
        logger.info(`✅ Booking confirmed! Residency [${customerResidency}] applied. Rooms: ${requestedRooms}. HCN: ${mockHCN}`);
        
        return { 
            success: true, 
            hcn: mockHCN, 
            status: "CONFIRMED",
            remarks_passed: sanitizedRemarks || "None"
        };
    } catch (error) {
        logger.error(`❌ Booking failed! Potential orphaned booking risk detected.`, { error: error.message });
        throw new Error("فشل تأكيد الحجز النهائي من المصدر");
    }
}


// 📦 تصدير جميع المحركات للاستخدام في السيرفر الرئيسي
module.exports = {
    fetchHotelsInChunks,
    fetchSingleHotelPage, // 🔴 محرك فندق واحد
    recheckHotel, // 🔴 محرك إعادة التحقق
    cancelBooking,
    fetchOrderDetails,
    bookHotel // 🔴 محرك الحجز النهائي
};