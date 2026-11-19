const { customerPrice, decorateHotels } = require('./paymentService');

function mobileHotelCard(hotel, currency) {
    let lowest;
    for (const rate of hotel.rates || []) {
        let price;
        try { price = customerPrice(rate); } catch { continue; }
        if (price.currency === currency && price.amount > 0 && (!lowest || price.amount < lowest.amount)) {
            lowest = price;
        }
    }
    return {
        hid: hotel.hid, name: hotel.name, address: hotel.address,
        star_rating: hotel.star_rating ?? hotel.stars ?? hotel.starRating,
        latitude: hotel.latitude, longitude: hotel.longitude,
        images: (hotel.images || []).slice(0, 4),
        rates: lowest ? [{ customer_display_amount: lowest.amount, customer_display_currency: lowest.currency }] : []
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

module.exports = { rateSearchResponse };
