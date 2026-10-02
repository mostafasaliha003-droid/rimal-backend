const HOTEL_CODE_PATTERN = /^\d{1,10}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function hotelCode(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value !== 'string' || !HOTEL_CODE_PATTERN.test(value.trim())) return null;
    const code = Number(value.trim());
    return Number.isSafeInteger(code) && code > 0 ? String(code) : null;
}

function validDate(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeHotelbedsPilotList(response) {
    if (!response || typeof response !== 'object' || response.success !== true
        || response.environment !== 'test' || !Array.isArray(response.hotels)) {
        throw new Error('hotelbeds_pilot_list_invalid');
    }
    const hotels = response.hotels.map(item => {
        const providerHotelId = hotelCode(item?.providerHotelId);
        if (!providerHotelId) throw new Error('hotelbeds_pilot_list_invalid');
        return { providerHotelId, label: `Hotelbeds ID ${providerHotelId}` };
    });
    if (new Set(hotels.map(item => item.providerHotelId)).size !== hotels.length || hotels.length > 5) {
        throw new Error('hotelbeds_pilot_list_invalid');
    }
    if (response.configured !== (hotels.length > 0)) throw new Error('hotelbeds_pilot_list_invalid');
    return { configured: response.configured === true && hotels.length > 0, hotels };
}

export function buildHotelbedsPilotSearch({ hotelCode: selectedCode, checkIn, checkOut, adults, hotels, now = new Date() } = {}) {
    const code = hotelCode(selectedCode);
    const approvedCodes = new Set((Array.isArray(hotels) ? hotels : [])
        .map(item => hotelCode(item?.providerHotelId)).filter(Boolean));
    if (!code || !approvedCodes.has(code)) throw new Error('hotelbeds_pilot_hotel_not_allowed');
    const current = new Date(now);
    if (!validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn
        || !Number.isSafeInteger(current.getTime())
        || checkIn < `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`) {
        throw new Error('hotelbeds_pilot_dates_invalid');
    }
    const adultCount = Number(adults);
    if (!Number.isSafeInteger(adultCount) || adultCount < 1 || adultCount > 6) {
        throw new Error('hotelbeds_pilot_occupancy_invalid');
    }
    return {
        checkIn,
        checkOut,
        guests: [{ adults: adultCount, children: [] }],
        destination: {
            type: 'hotel',
            providerHotelIds: { hotelbeds: [code] },
            name: `Hotelbeds ID ${code}`
        }
    };
}

export function sanitizeHotelbedsPilotSearch(criteria, hotels, now = new Date()) {
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)
        || !criteria.destination || typeof criteria.destination !== 'object'
        || Array.isArray(criteria.destination)) throw new Error('hotelbeds_pilot_search_invalid');
    const ids = criteria.destination.providerHotelIds?.hotelbeds;
    if (!Array.isArray(ids) || ids.length !== 1) throw new Error('hotelbeds_pilot_hotel_not_allowed');
    const selected = buildHotelbedsPilotSearch({
        hotelCode: ids[0],
        checkIn: criteria.checkIn,
        checkOut: criteria.checkOut,
        adults: criteria.guests?.length === 1 ? criteria.guests[0]?.adults : NaN,
        hotels,
        now
    });
    return selected;
}