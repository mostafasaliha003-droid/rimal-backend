const labels = require('../shared/hotelLabels.json');
const generic = new Set(labels.genericNames);
function resolveHotelName(...values) {
    return values.find(value => typeof value === 'string' && value.trim()
        && !generic.has(value.trim().toLowerCase()))?.trim() || '';
}
/**
 * Read-only names for a customer's bookings. A generic stored name ("Hotel") is replaced by the
 * catalogue's canonical name, and every RateHawk booking also gets the supplier's approved Arabic
 * name (`hotelNameAr`), so the app shows the same name the guest saw while searching in Arabic.
 * Only the exact supplier hotel id is used; stored records are never changed.
 */
async function enrichBookingNames(bookings, HotelModel) {
    if (!HotelModel || typeof HotelModel.find !== 'function') return bookings;
    const ids = [...new Set(bookings.filter(b => b.provider === 'ratehawk' && /^\d{1,10}$/.test(b.providerHotelCode || ''))
        .map(b => String(b.providerHotelCode)))];
    if (!ids.length) return bookings;
    const hotels = await HotelModel.find({ hid: { $in: ids } }).select('hid name staticData.name translations.ar').lean();
    const names = new Map(hotels.map(hotel => [String(hotel.hid), {
        name: resolveHotelName(hotel.name, hotel.staticData?.name), arabic: approvedArabicName(hotel.translations)
    }]));
    return bookings.map(booking => {
        const found = booking.provider === 'ratehawk' ? names.get(String(booking.providerHotelCode)) : null;
        if (!found) return booking;
        const hotelName = !resolveHotelName(booking.hotelName) && found.name ? found.name : booking.hotelName;
        return { ...booking, hotelName, ...(found.arabic ? { hotelNameAr: found.arabic } : {}) };
    });
}
function approvedArabicName(translations) {
    const ar = translations instanceof Map ? translations.get('ar') : translations?.ar;
    const name = typeof ar?.name === 'string' ? ar.name.trim() : '';
    return ar?.reviewStatus === 'approved' && name.length <= 256 && /\p{Script=Arabic}/u.test(name) ? name : '';
}
module.exports = { resolveHotelName, enrichBookingNames };
