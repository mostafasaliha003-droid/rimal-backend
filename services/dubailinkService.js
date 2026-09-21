const https = require('https');
const axios = require('axios');
const logger = require('./loggerService'); 

const SHOPPING_URL = process.env.DUBAILINK_SHOPPING_URL;
const BOOKING_URL = process.env.DUBAILINK_BOOKING_URL;

// 🔒 TLS bypass is scoped EXCLUSIVELY to Dubai Link (Tripstick) — their endpoints use
// a certificate Node rejects. This dedicated https.Agent is attached only to the
// Dubai Link axios client, so RateHawk / Ziina / Mongo / SMTP keep STRICT default TLS.
// (Replaces the dangerous global NODE_TLS_REJECT_UNAUTHORIZED=0.)
const dubaiLinkAgent = new https.Agent({ rejectUnauthorized: false });
const dubaiLinkClient = axios.create({
    httpsAgent: dubaiLinkAgent,
    timeout: 30000,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' }
});

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

    try {
        // 🔴 طباعة الرابط النهائي بدقة قبل إرسال الطلب لكشف أي أخطاء مطبعية
        logger.info(`🌐 Sending request to DubaiLink: ${url}`); 

        // Uses the Dubai-Link-only axios client (scoped TLS bypass via dubaiLinkAgent).
        const response = await dubaiLinkClient.request({
            url,
            method,
            headers: { 'Authorization': getAuthHeader() },
            data: body || undefined
        });
        const data = response.data;

        // معالجة أخطاء الـ API بناءً على رموز HTTP المذكورة في التوثيق
        if (response.status < 200 || response.status >= 300) {
            logger.error(`DubaiLink API Error [${response.status}] at ${endpoint}`, { details: data });
            throw new Error((data && (data.error || data.message)) || `API Error: ${response.status}`);
        }

        return data;
    } catch (error) {
        // 🔴 استخراج السبب الجذري للخطأ (الذي يخفيه Node.js عادة)
        const rootCause = error.cause ? error.cause.message : (error.response ? `HTTP ${error.response.status}` : 'Unknown cause');
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
            checkIn: checkInParam,
            checkOut: checkOutParam,
            adults = 2,
            children = 0,
            childrenAges = [], 
            hotelCodes = [],   
            nationality = 'AE', 
            currency = 'AED' 
        } = searchParams;

        const finalCheckIn = checkInDate || checkInParam || new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0];
        const finalCheckOut = checkOutDate || checkOutParam || new Date(Date.now() + 86400000 * 8).toISOString().split('T')[0];
        
        const finalHotelCodes = hotelCodes && hotelCodes.length > 0 ? hotelCodes : [38772617, 39619181, 15066967]; 

        const checkInDateObj = new Date(finalCheckIn);
        const checkOutDateObj = new Date(finalCheckOut);
        const nights = Math.round((checkOutDateObj - checkInDateObj) / (1000 * 60 * 60 * 24));

        // 🛡️ تطبيق قواعد Tripstick الصارمة للأطفال:
        let validAdultsCount = Math.max(1, parseInt(adults, 10) || 2);
        const validChildrenAges = [];
        const incomingAges = Array.isArray(childrenAges) ? [...childrenAges] : [];
        const requestedChildren = Math.max(0, parseInt(children, 10) || 0);
        while (incomingAges.length < requestedChildren) incomingAges.push(6);
        
        incomingAges.forEach(age => {
            const n = Number(age);
            if (n >= 0 && n <= 12) {
                validChildrenAges.push(n);
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
const normalizeChildrenAges = (childrenField) => {
    if (Array.isArray(childrenField)) {
        return childrenField.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 12);
    }
    const count = parseInt(childrenField, 10);
    if (Number.isFinite(count) && count > 0) return Array(count).fill(6);
    return [];
};

const occupancyFromGroup = (group) => {
    const room = (group && Array.isArray(group.rooms) && group.rooms[0]) || group || {};
    const adults = parseInt(room.adults ?? room.adults_count ?? group?.adults, 10);
    return {
        adults: Number.isFinite(adults) && adults > 0 ? adults : null,
        childrenAges: normalizeChildrenAges(room.children || room.children_ages || group?.children),
        processKey: room.process_key || room.processKey || room.id || null
    };
};

const buildTripstickPassengers = ({ holderFirstName, holderLastName, passengers, adults, childrenAges }) => {
    const incoming = Array.isArray(passengers) ? passengers : [];
    let adultCount = parseInt(adults, 10);
    if (!Number.isFinite(adultCount) || adultCount < 1) {
        const inferredAdults = incoming.filter((p) => (p.type === 'AD') || Number(p.age) >= 13).length;
        adultCount = Math.max(inferredAdults, 2);
    }

    const childAges = [];
    (Array.isArray(childrenAges) ? childrenAges : []).forEach((age) => {
        const n = Number(age);
        if (n >= 0 && n <= 12) childAges.push(n);
        else adultCount += 1;
    });

    const mapped = incoming.map((p) => {
        const age = Number(p.age);
        const isChild = p.type === 'CH' || (Number.isFinite(age) && age <= 12);
        return {
            type: isChild ? 'CH' : 'AD',
            title: p.title || (isChild ? 'Mstr.' : 'Mr.'),
            first_name: p.first_name || p.firstName || holderFirstName || 'Guest',
            last_name: p.last_name || p.lastName || holderLastName || 'Remal',
            age: isChild ? (Number.isFinite(age) ? age : 6) : (Number.isFinite(age) && age >= 13 ? age : 30)
        };
    });

    const adultPassengers = mapped.filter((p) => p.type === 'AD');
    while (adultPassengers.length < adultCount) {
        adultPassengers.push({
            type: 'AD',
            title: 'Mr.',
            first_name: adultPassengers[0]?.first_name || holderFirstName || 'Guest',
            last_name: holderLastName || 'Remal',
            age: 30
        });
    }

    const childPassengers = childAges.map((age, idx) => {
        const existing = mapped.filter((p) => p.type === 'CH')[idx];
        return existing ? { ...existing, age } : {
            type: 'CH',
            title: 'Mstr.',
            first_name: `Child${idx + 1}`,
            last_name: holderLastName || 'Remal',
            age
        };
    });

    return {
        adultCount,
        childAges,
        passengers: [...adultPassengers.slice(0, adultCount), ...childPassengers]
    };
};

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
            roomId,
            processKey, 
            passengers = [],
            adults,
            childrenAges = []
        } = bookingDetails;

        const finalGroupId = groupId || roomId;
        let liveProcessKey = processKey;
        let occupancyAdults = adults;
        let occupancyChildren = childrenAges;

        try {
            const rateCheck = await checkHotelRate(finalGroupId);
            const groups = rateCheck.group_rooms || rateCheck.groupRooms || rateCheck.response?.group_rooms || [];
            const liveOccupancy = occupancyFromGroup(groups[0]);
            if (liveOccupancy.processKey) liveProcessKey = liveOccupancy.processKey;
            if (liveOccupancy.adults) occupancyAdults = liveOccupancy.adults;
            if (groups[0]) occupancyChildren = liveOccupancy.childrenAges;
        } catch (rateErr) {
            logger.warn('Dubai Link rate check before book failed, using client occupancy', { error: rateErr.message });
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomId = Math.floor(10000 + Math.random() * 90000);
        const agentReference = `AGT-${dateStr}-${randomId}`;

        const built = buildTripstickPassengers({
            holderFirstName,
            holderLastName,
            passengers,
            adults: occupancyAdults,
            childrenAges: occupancyChildren
        });

        const payload = {
            holder: {
                title: holderTitle,
                firstname: holderFirstName,
                lastname: holderLastName,
                email: holderEmail,
                nationality: nationality,
                phone: holderPhone
            },
            agent_reference: agentReference, 
            hotel: [
                {
                    group_id: finalGroupId,
                    rooms: [
                        {
                            process_key: liveProcessKey,
                            passengers: built.passengers
                        }
                    ]
                }
            ]
        };

        logger.info(`Sending Booking Request to Dubai Link for agent_reference: ${agentReference}`, {
            adults: built.adultCount,
            children: built.childAges.length,
            processKey: liveProcessKey ? 'present' : 'missing'
        });

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
