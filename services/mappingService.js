// services/mappingService.js
const logger = require('./loggerService'); 

// ==========================================
// 💱 0. محرك تحويل العملات (Currency Engine) 
// ==========================================
// أسعار صرف تقريبية (يتم استخدام الدرهم كعملة أساسية للتسوية)
const exchangeRatesToAED = {
    'AED': 1.00,
    'USD': 3.67,
    'EUR': 4.05,
    'SAR': 0.98,
    'GBP': 4.85
};

function convertToAED(amount, currency) {
    if (!amount || !currency) return 0;
    const rate = exchangeRatesToAED[currency.toUpperCase()];
    if (!rate) {
        logger.warn(`⚠️ Unknown currency [${currency}] detected. Assuming 1:1 ratio for safety.`);
        return amount; 
    }
    return amount * rate;
}

// ==========================================
// 🧹 1. قواميس التنظيف والتوحيد (Normalization Dictionaries)
// ==========================================
function normalizeHotelName(name) {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '') 
        .replace(/(hotel|resort|spa|suites|apartments)/g, ''); 
}

function normalizeRoomName(roomName) {
    if (!roomName) return "standard";
    return roomName.toLowerCase()
        .replace(/(non-refundable|non refundable|ro|room only)/gi, '') 
        .replace(/dbl/gi, 'double') 
        .replace(/sngl/gi, 'single')
        .replace(/[^a-z0-9\s]/g, '') 
        .trim();
}

function normalizeMealType(mealString) {
    if (!mealString) return "RO"; 
    
    const meal = mealString.toLowerCase();
    
    if (meal.includes('all inclusive') && meal.includes('ultra')) return "UAI";
    if (meal.includes('all inclusive')) return "AI";
    if (meal.includes('full board') || (meal.includes('lunch') && meal.includes('dinner'))) return "FB";
    if (meal.includes('half board') || meal.match(/breakfast.*dinner|dinner.*breakfast/)) return "HB";
    if (meal.includes('breakfast') || meal.includes('buffet') || meal.includes('bb')) return "BB";
    
    return "RO"; 
}

// ==========================================
// 🔄 2. محول البيانات الشامل (Universal Data Adapter)
// ==========================================
function standardizeHotelData(rawHotel) {
    let standardHotel = {
        provider: "unknown",
        hotelId: "",
        name: "",
        city: rawHotel.city || rawHotel.destinationName || "دبي",
        stars: rawHotel.stars || rawHotel.star_rating || "",
        lat: rawHotel.lat || rawHotel.latitude || 25.2048,
        lng: rawHotel.lng || rawHotel.longitude || 55.2708,
        image: rawHotel.image || rawHotel.img || "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80",
        rooms: []
    };

    // 🟢 اكتشاف وتوحيد بيانات Dubai Link (Tripstick)
    if (rawHotel.hotel_code && rawHotel.groupRooms) {
        standardHotel.provider = "dubailink";
        standardHotel.hotelId = rawHotel.hotel_code;
        
        // 🚨 التعديل هنا: إضافة كود الفندق للاسم لمنع فلتر التكرار من دمج الفنادق المختلفة
        standardHotel.name = rawHotel.hotel || rawHotel.hotel_name || `Unknown Hotel (${rawHotel.hotel_code})`;
        
        rawHotel.groupRooms.forEach(group => {
            const amount = group.groupPrice?.amount || 0;
            const currency = group.groupPrice?.currency || 'AED';
            
            const firstRoom = (group.rooms && group.rooms[0]) || {};
            const roomAdults = parseInt(firstRoom.adults ?? firstRoom.adults_count, 10);
            const roomChildren = Array.isArray(firstRoom.children)
                ? firstRoom.children
                : (Array.isArray(firstRoom.children_ages) ? firstRoom.children_ages : []);
            standardHotel.rooms.push({
                roomId: group.group_id, // يستخدم لفحص السعر
                processKey: firstRoom.process_key || firstRoom.processKey || firstRoom.id || null,
                adults: Number.isFinite(roomAdults) && roomAdults > 0 ? roomAdults : undefined,
                childrenAges: roomChildren,
                name: group.name || firstRoom.room_name || "Standard Room",
                board: normalizeMealType(group.boardCode || group.boardName),
                price: convertToAED(amount, currency),
                currency: 'AED',
                isInstantConfirmation: true, // نتائج بحث Shopping API تعتبر فورية
                freeCancellation: group.refundable || false,
                formattedPolicy: group.refundable ? "إلغاء مجاني - شروط الفندق مطبقة" : "غير قابل للاسترداد",
                paymentType: "HOTEL",
                originalData: group 
            });
        });
        return standardHotel;
    }

    // 🔵 اكتشاف وتوحيد بيانات RateHawk 
    if (rawHotel.id && rawHotel.rates) {
        standardHotel.provider = "ratehawk";
        standardHotel.hotelId = rawHotel.id;
        standardHotel.name = rawHotel.name || "Unknown Hotel";
        
        rawHotel.rates.forEach(rate => {
            // استخراج السعر بأمان من هيكل RateHawk المعقد
            const amount = rate.payment_options?.payment_types?.[0]?.amount || rate.price || 0;
            const currencyCode = rate.payment_options?.payment_types?.[0]?.currency_code || rate.currency || 'AED';

            standardHotel.rooms.push({
                roomId: rate.book_hash || rate.match_hash, // RateKey (book_hash is required for prebook/booking)
                processKey: '', // RateHawk doesn't need processKey
                name: rate.room_name || rate.name || "Standard Room",
                board: normalizeMealType(rate.meal),
                price: convertToAED(amount, currencyCode),
                currency: 'AED',
                isInstantConfirmation: true, 
                freeCancellation: rate.payment_options?.payment_types?.[0]?.cancellation_penalties?.free_cancellation_before !== null,
                formattedPolicy: rate.payment_options?.payment_types?.[0]?.cancellation_penalties?.free_cancellation_before ? "إلغاء مجاني متاح" : "غير قابل للاسترداد",
                paymentType: rate.payment_options?.payment_types?.[0]?.tax_data?.taxes?.length > 0 ? "AT" : "HOTEL",
                originalData: rate
            });
        });
        return standardHotel;
    }

    // ⚪ هيكل افتراضي (في حال كانت البيانات موحدة مسبقاً)
    if (rawHotel.name && rawHotel.rooms) {
        standardHotel.provider = rawHotel.provider || "generic";
        standardHotel.hotelId = rawHotel.hotelId || rawHotel.id || "N/A";
        standardHotel.name = rawHotel.name;
        standardHotel.rooms = rawHotel.rooms.map(room => ({
            roomId: room.roomId || room.group_id || room.rateKey || "N/A",
            processKey: room.processKey || room.id || "",
            name: room.name || "Standard Room",
            board: room.board || room.mealType || "RO",
            price: convertToAED(room.price || room.amount || 0, room.currency || 'AED'),
            currency: 'AED',
            freeCancellation: room.freeCancellation || room.refundable || false,
            formattedPolicy: room.formattedPolicy || "تطبق شروط الإلغاء",
            paymentType: room.paymentType || "AT",
            isInstantConfirmation: room.isInstantConfirmation !== false
        }));
        return standardHotel;
    }

    return null; // تجاهل أي بيانات غير صالحة لا تتبع الهياكل المعروفة
}

// ==========================================
// 🎯 3. خوارزمية التطابق والفلترة الذكية (Deduplication & Quality Filter)
// ==========================================
function deduplicateHotels(hotelsList) {
    logger.info(`🧩 Deduplication & Quality Filter Started: Analyzing ${hotelsList.length} raw hotels from multiple providers...`);
    const uniqueHotels = new Map();

    hotelsList.forEach(rawHotel => {
        // 🔄 توحيد هيكل البيانات أولاً ليفهمه المحرك بغض النظر عن المورد
        const hotel = standardizeHotelData(rawHotel);

        // 🔴 فلترة الجودة 1: تجاهل الفندق إذا كانت بياناته ناقصة أو هيكله غير مدعوم
        if (!hotel || !hotel.name || !hotel.rooms || hotel.rooms.length === 0) {
            return; 
        }

        const normalizedHash = normalizeHotelName(hotel.name);
        let validRooms = [];

        // تنظيف الغرف وفلترتها
        hotel.rooms.forEach(room => {
            // 🔴 فلترة الجودة 2: حجب الحجوزات غير الفورية (On Request)
            if (room.isInstantConfirmation === false || room.status === 'ON_REQUEST') {
                return;
            }

            // 🔴 فلترة الجودة 3: حجب الغرف التي لا تحتوي على سعر واضح
            if (!room.price || room.price <= 0) {
                return;
            }

            validRooms.push({
                ...room,
                masterRoomName: normalizeRoomName(room.name),
                masterMealCode: normalizeMealType(room.board)
            });
        });

        // إذا بعد الفلترة لم يتبق أي غرفة صالحة، نتجاهل الفندق
        if (validRooms.length === 0) return;

        hotel.rooms = validRooms;
        // 🔴 تحديث المسمى ليطابق ما تتوقعه الواجهة الأمامية (priceAED بدلاً من startingPriceAED)
        hotel.priceAED = Math.min(...validRooms.map(r => r.price));

        if (uniqueHotels.has(normalizedHash)) {
            const existingHotel = uniqueHotels.get(normalizedHash);
            
            // مقارنة السعر الموحد بالدرهم لاختيار المورد الأرخص للعميل
            if (hotel.priceAED < existingHotel.priceAED) {
                logger.info(`📉 Found cheaper price for [${existingHotel.name}] via ${hotel.provider}. Updating best offer...`);
                uniqueHotels.set(normalizedHash, hotel); 
            } else if (hotel.priceAED === existingHotel.priceAED) {
                // دمج الغرف لإعطاء خيارات أكثر للعميل في حال تطابق سعر الفندق
                existingHotel.rooms = [...existingHotel.rooms, ...hotel.rooms];
                uniqueHotels.set(normalizedHash, existingHotel);
            }
        } else {
            uniqueHotels.set(normalizedHash, hotel);
        }
    });

    const finalList = Array.from(uniqueHotels.values());
    logger.info(`✅ Processing Complete: Filtered down to ${finalList.length} unique, cheapest hotels across all API partners.`);
    
    return finalList;
}

module.exports = {
    deduplicateHotels,
    convertToAED,
    normalizeHotelName,
    normalizeRoomName, 
    normalizeMealType  
};
