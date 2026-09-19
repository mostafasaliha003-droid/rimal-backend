// services/dubailinkService.js

const logger = require('./loggerService'); 

const SHOPPING_URL = process.env.DUBAILINK_SHOPPING_URL;
const BOOKING_URL = process.env.DUBAILINK_BOOKING_URL;

/**
 * 🔐 توليد ترويسة المصادقة بنظام Base64 كما هو مطلوب في توثيق Tripstick
 */
const getAuthHeader = () => {
    const user = process.env.DUBAILINK_USER;
    const pass = process.env.DUBAILINK_PASS;
    const base64Credentials = Buffer.from(`${user}:${pass}`).toString('base64');
    return `Basic ${base64Credentials}`;
};

/**
 * 🚀 دالة مركزية لإرسال الطلبات إلى Dubai Link API
 */
const fetchFromDubaiLink = async (endpoint, method = 'POST', body = null, isBookingApi = false) => {
    const baseUrl = isBookingApi ? BOOKING_URL : SHOPPING_URL;
    const url = `${baseUrl}${endpoint}`;
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader()
    };

    const options = {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
    };

    try {
        // 🔴 طباعة الرابط النهائي بدقة قبل إرسال الطلب لكشف أي أخطاء مطبعية
        logger.info(`🌐 Sending request to DubaiLink: ${url}`); 
        
        const response = await fetch(url, options);
        const data = await response.json();

        // معالجة أخطاء الـ API بناءً على رموز HTTP المذكورة في التوثيق
        if (!response.ok) {
            logger.error(`DubaiLink API Error [${response.status}] at ${endpoint}`, { details: data });
            throw new Error(data.error || data.message || `API Error: ${response.status}`);
        }

        return data;
    } catch (error) {
        // 🔴 استخراج السبب الجذري للخطأ (الذي يخفيه Node.js عادة)
        const rootCause = error.cause ? error.cause.message : 'Unknown cause';
        logger.error(`DubaiLink Connection Error at ${endpoint}`, { 
            message: error.message, 
            cause: rootCause,
            failedUrl: url 
        });
        throw error;
    }
};

/**
 * 🏨 1. البحث عن توافر الفنادق (Shopping API - Availability)
 */
const searchAvailability = async (searchParams) => {
    try {
        const { 
            checkInDate, 
            checkOutDate, 
            adults = 2, 
            childrenAges = [], 
            hotelCodes = [],   
            nationality = 'AE', 
            currency = 'AED' 
        } = searchParams;

        // 🛠️ رقعة التجربة: حقن بيانات افتراضية إذا كانت الواجهة الأمامية ترسل بيانات فارغة أو ناقصة
        const finalCheckIn = checkInDate || new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0]; // بعد 7 أيام
        const finalCheckOut = checkOutDate || new Date(Date.now() + 86400000 * 8).toISOString().split('T')[0]; // ليلة واحدة
        
        // استخدام أكواد فنادق دبي من توثيق Tripstick في حال كانت المصفوفة فارغة
        const finalHotelCodes = hotelCodes && hotelCodes.length > 0 ? hotelCodes : [38772617, 39619181, 15066967]; 

        const checkIn = new Date(finalCheckIn);
        const checkOut = new Date(finalCheckOut);
        const nights = Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24));

        // 🛡️ تطبيق قواعد Tripstick الصارمة للأطفال:
        let validAdultsCount = adults;
        const validChildrenAges = [];
        
        childrenAges.forEach(age => {
            if (age >= 0 && age <= 12) {
                validChildrenAges.push(age);
            } else {
                validAdultsCount += 1; // تحويل الطفل الأكبر من 12 لبالغ لتجنب رفض الطلب
            }
        });

        const payload = {
            hotel_codes: finalHotelCodes,
            preferences: {
                nationality: nationality,
                checkin: finalCheckIn, 
                currency: currency,
                nights: nights > 0 ? nights : 1,
                timeout: 15 
            },
            rooms: [
                {
                    adults: validAdultsCount,
                    children: validChildrenAges
                }
            ]
        };

        logger.info("Sending Availability Request to Dubai Link...");

        const response = await fetchFromDubaiLink('/availability', 'POST', payload, false);
        
        logger.info(`Dubai Link Search Success. Found ${response.response?.hotelCount || 0} hotels.`);
        return response.response; 

    } catch (error) {
        logger.error("Dubai Link Availability Search Failed", { error: error.message });
        throw error;
    }
};

/**
 * 🏨 2. فحص السعر اللحظي (Booking API - Check Hotel Rate)
 */
const checkHotelRate = async (groupId) => {
    try {
        if (!groupId) {
            throw new Error("group_id is required for checking rate");
        }

        const payload = { group_id: groupId };
        
        logger.info(`Sending Rate Check Request to Dubai Link for group_id: ${groupId}`);

        const response = await fetchFromDubaiLink('/checkHotelRate', 'POST', payload, true);
        
        logger.info(`Dubai Link Rate Check Status: ${response.response}`);
        
        return response; 

    } catch (error) {
        logger.error("Dubai Link Rate Check Failed", { error: error.message });
        throw error;
    }
};

/**
 * 🏨 3. تأكيد الحجز (Booking API - Confirm Booking)
 */
const bookHotel = async (bookingDetails) => {
    try {
        const { 
            holderTitle = "Mr.",
            holderFirstName = "Guest",
            holderLastName = "Remal",
            holderEmail,
            holderPhone,
            nationality = 'AE',
            groupId, 
            roomId, // 🔴 التقاط roomId القادم من الواجهة
            processKey, 
            passengers = [] 
        } = bookingDetails;

        // 🔴 توحيد المتغيرات: استخدام groupId إذا توفر، أو roomId كبديل
        const finalGroupId = groupId || roomId;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomId = Math.floor(10000 + Math.random() * 90000);
        const agentReference = `AGT-${dateStr}-${randomId}`;

        // 🛡️ درع الحماية: ضمان وجود مسافرين اثنين على الأقل لتطابق تسعيرة الغرفة المزدوجة الافتراضية
        let safePassengers = passengers;
        if (!safePassengers || safePassengers.length === 0) {
            safePassengers = [
                { type: "AD", title: holderTitle, firstName: holderFirstName, lastName: holderLastName, age: 30 },
                { type: "AD", title: "Mr.", firstName: "Companion", lastName: holderLastName, age: 30 } // مسافر افتراضي ثاني
            ];
        } else if (safePassengers.length === 1) {
            // إضافة مرافق افتراضي لتجنب خطأ "Invalid number of adults" في الغرف المزدوجة
            safePassengers.push({ type: "AD", title: "Mr.", firstName: "Companion", lastName: safePassengers[0].lastName || holderLastName, age: 30 });
        }

        const payload = {
            holder: {
                title: holderTitle,
                firstname: holderFirstName,
                lastname: holderLastName,
                name: holderFirstName,     // توفير كلا المفتاحين لتوافقية أعلى مع API
                surname: holderLastName,   // توفير كلا المفتاحين لتوافقية أعلى مع API
                email: holderEmail || 'booking@remalbookings.com',
                nationality: nationality,
                phone: holderPhone || '00971500000000'
            },
            agent_reference: agentReference, 
            hotel: [
                {
                    group_id: finalGroupId,
                    rooms: [
                        {
                            process_key: processKey,
                            passengers: safePassengers.map(p => ({
                                type: (p.age && p.age < 12) || p.type === 'CH' ? "CH" : "AD",
                                title: p.title || "Mr.",
                                first_name: p.firstName || p.first_name || holderFirstName,
                                last_name: p.lastName || p.last_name || holderLastName,
                                name: p.firstName || p.first_name || holderFirstName,   // توفير كلا المفتاحين
                                surname: p.lastName || p.last_name || holderLastName,   // توفير كلا المفتاحين
                                age: p.age || 30
                            }))
                        }
                    ]
                }
            ]
        };

        logger.info(`Sending Booking Request to Dubai Link for agent_reference: ${agentReference}`);

        const response = await fetchFromDubaiLink('/book', 'POST', payload, true);
        
        logger.info(`Dubai Link Booking Success. Booking Ref: ${response.response?.booking_reference || agentReference}`);
        
        return response.response;

    } catch (error) {
        logger.error("Dubai Link Booking Failed", { error: error.message });
        throw error;
    }
};

module.exports = {
    fetchFromDubaiLink,
    searchAvailability,
    checkHotelRate,
    bookHotel
};
