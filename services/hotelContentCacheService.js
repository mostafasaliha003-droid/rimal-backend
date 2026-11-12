const { collectSupplierImages } = require('./supplierImages');

function hotelContentNeedsRefresh(hotel, liveHotel) {
    if (!hotel) return true;
    if (!require('./hotelPresentationService').resolveHotelName(hotel.name, hotel.staticData?.name)) return true;
    return ![hotel, liveHotel].some(row => row && collectSupplierImages(
        row.images, row.images_ext, row.image,
        row.staticData?.images, row.staticData?.images_ext, row.staticData?.image
    ).length);
}

// Customer requests may enrich availability only from the synchronized database.
// Missing content stays missing until the offline Content sync updates it; a
// search or hotel-page request must never start a supplier Content API request,
// including a background request after the HTTP response has completed.
async function hydrateHotelContent(values, { HotelModel = require('../models/Hotel') } = {}) {
    const ids = [...new Set((Array.isArray(values) ? values : []).map(String)
        .filter(value => /^\d{1,10}$/.test(value)))].slice(0, 500);
    if (!ids.length) return [];
    const hotels = await HotelModel.find({ provider: 'ratehawk', hid: { $in: ids } }).lean();
    const requested = new Set(ids);
    return (Array.isArray(hotels) ? hotels : []).filter(hotel =>
        requested.has(String(hotel.hid)) && hotel.provider === 'ratehawk'
        && !hotel.staticData?.deleted && !hotel.staticData?.is_closed);
}

module.exports = { hydrateHotelContent, hotelContentNeedsRefresh };
