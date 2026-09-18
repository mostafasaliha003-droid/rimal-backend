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
        const response = await fetch(url, options);
        const data = await response.json();

        // معالجة أخطاء الـ API بناءً على رموز HTTP المذكورة في التوثيق
        if (!response.ok) {
            logger.error(`DubaiLink API Error [${response.status}] at ${endpoint}`, { details: data });
            throw new Error(data.error || data.message || `API Error: ${response.status}`);
        }

        return data;
    } catch (error) {
        logger.error(`DubaiLink Connection Error at ${endpoint}`, { message: error.message });
        throw error;
    }
};

/**
 * 🏨 1. البحث عن توافر الفنادق (Shopping API - Availability)
 * بناءً على توثيق TripstickConnect الإصدار 3.5
 */
const searchAvailability = async (searchParams) => {
    try {
        const { 
            checkInDate, 
            checkOutDate, 
            adults = 2, 
            childrenAges = [], // مصفوفة بأعمار الأطفال
            hotelCodes = [],   // مصفوفة بأكواد الفنادق
            nationality = 'AE', 
            currency = 'AED' 
        } = searchParams;

        // حساب عدد الليالي بناءً على تواريخ الدخول والخروج
        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);
        const nights = Math.round((checkOut - checkIn) / (1000 * 60 * 60 * 24));

        // 🛡️ تطبيق قواعد Tripstick الصارمة للأطفال:
        // الأعمار من 0 إلى 12 فقط. 13 فما فوق يُحتسب كبالغ.
        let validAdultsCount = adults;
        const validChildrenAges = [];
        
        childrenAges.forEach(age => {
            if (age >= 0 && age <= 12) {
                validChildrenAges.push(age);
            } else {
                validAdultsCount += 1; // تحويل الطفل الأكبر من 12 لبالغ لتجنب رفض الطلب
            }
        });

        // بناء هيكل الطلب (Payload) كما يطلبه المورد
        const payload = {
            hotel_codes: hotelCodes,
            preferences: {
                nationality: nationality,
                checkin: checkInDate, // صيغة YYYY-MM-DD
                currency: currency,
                nights: nights > 0 ? nights : 1,
                timeout: 15 // مهلة البحث بالثواني
            },
            rooms: [
                {
                    adults: validAdultsCount,
                    children: validChildrenAges
                }
            ]
        };

        logger.info("Sending Availability Request to Dubai Link...");

        // إرسال الطلب (false تعني استخدام SHOPPING_URL)
        const response = await fetchFromDubaiLink('/availability', 'POST', payload, false);
        
        logger.info(`Dubai Link Search Success. Found ${response.response?.hotelCount || 0} hotels.`);
        return response.response; // إرجاع كائن response الداخلي مباشرة

    } catch (error) {
        logger.error("Dubai Link Availability Search Failed", { error: error.message });
        throw error;
    }
};

/**
 * 🏨 2. فحص السعر اللحظي (Booking API - Check Hotel Rate)
 * خطوة إلزامية قبل الحجز للتأكد من توافر الغرفة وعدم تغير السعر
 */
const checkHotelRate = async (groupId) => {
    try {
        if (!groupId) {
            throw new Error("group_id is required for checking rate");
        }

        const payload = { group_id: groupId };
        
        logger.info(`Sending Rate Check Request to Dubai Link for group_id: ${groupId}`);

        // إرسال الطلب (true تعني استخدام BOOKING_URL المخصص لمسارات الحجز)
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
 * ملاحظة هامة: agent_reference أصبح إجبارياً في الإصدار v3.5
 */
const bookHotel = async (bookingDetails) => {
    try {
        const { 
            holderTitle = "Mr.",
            holderFirstName,
            holderLastName,
            holderEmail,
            holderPhone,
            nationality = 'AE',
            groupId, 
            processKey, 
            passengers = [] 
        } = bookingDetails;

        // توليد agent_reference فريد (متطلب إلزامي في v3.5)
        // الصيغة المقترحة: AGT-YYYYMMDD-Random
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomId = Math.floor(10000 + Math.random() * 90000);
        const agentReference = `AGT-${dateStr}-${randomId}`;

        const payload = {
            holder: {
                title: holderTitle,
                firstname: holderFirstName,
                lastname: holderLastName,
                email: holderEmail,
                nationality: nationality,
                phone: holderPhone
            },
            agent_reference: agentReference, // 🔴 متطلب إلزامي
            hotel: [
                {
                    group_id: groupId,
                    rooms: [
                        {
                            process_key: processKey,
                            passengers: passengers.map(p => ({
                                type: p.age >= 13 ? "AD" : "CH",
                                title: p.title || "Mr.",
                                first_name: p.firstName,
                                last_name: p.lastName,
                                age: p.age
                            }))
                        }
                    ]
                }
            ]
        };

        logger.info(`Sending Booking Request to Dubai Link for agent_reference: ${agentReference}`);

        // إرسال الطلب (true تعني استخدام BOOKING_URL)
        const response = await fetchFromDubaiLink('/book', 'POST', payload, true);
        
        logger.info(`Dubai Link Booking Success. Booking Ref: ${response.response?.booking_reference}`);
        
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