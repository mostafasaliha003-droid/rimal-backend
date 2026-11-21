const { customerPrice, decorateHotels } = require('./paymentService');

// Free cancellation as the card can state it: null when the supplier sent no terms, otherwise
// whether the deadline is still ahead. ETG sends the deadline in UTC without a zone suffix.
function freeCancellationOpen(rate, now) {
    const penalties = rate?.payment_options?.payment_types?.find(item => item.type === 'deposit')?.cancellation_penalties;
    if (!penalties || typeof penalties !== 'object' || !('free_cancellation_before' in penalties)) return null;
    const value = penalties.free_cancellation_before;
    if (typeof value !== 'string' || !value) return false;
    const time = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`);
    return Number.isFinite(time) && time > now;
}

function mobileHotelCard(hotel, currency, now = Date.now()) {
    let lowest, lowestRate, anyFree = false, known = false;
    for (const rate of hotel.rates || []) {
        const free = freeCancellationOpen(rate, now);
        if (free !== null) { known = true; anyFree ||= free; }
        let price;
        try { price = customerPrice(rate); } catch { continue; }
        if (price.currency === currency && price.amount > 0 && (!lowest || price.amount < lowest.amount)) {
            lowest = price; lowestRate = rate;
        }
    }
    // Two flags, so the card never claims free cancellation for a price that does not have it.
    const cancellation = known && lowest ? { free_cancellation: anyFree,
        lowest_free_cancellation: freeCancellationOpen(lowestRate, now) === true } : {};
    return {
        hid: hotel.hid, name: hotel.name, address: hotel.address,
        star_rating: hotel.star_rating ?? hotel.stars ?? hotel.starRating,
        latitude: hotel.latitude, longitude: hotel.longitude,
        images: (hotel.images || []).slice(0, 4),
        rates: lowest ? [{ customer_display_amount: lowest.amount, customer_display_currency: lowest.currency }] : [],
        ...cancellation
    };
}

// Room plans and the signed booking context are fetched on the hotel page.
// Full responses remain available to clients that consume room details at search time.
function rateSearchResponse(hotels, body, result) {
    const language = body.display_language || body.language || 'en';
    const resolved = [...new Set(hotels.map(hotel => hotel.resolvedLanguage).filter(Boolean))];
    const metadata = { requested_language: language,
        resolved_language: resolved.length > 1 ? 'mixed' : resolved[0] || body.language || 'en' };
    if (body.response_view === 'mobile_cards_v1') {
        return { success: true, response_view: 'mobile_cards_v1', ...metadata,
            hotels: hotels.map(hotel => mobileHotelCard(hotel, body.currency || 'USD')) };
    }
    return { success: true, ...(Array.isArray(result) ? {} : result),
        hotels: decorateHotels(hotels), ...metadata };
}

module.exports = { rateSearchResponse, mobileHotelCard };
