const labels = require('../shared/hotelLabels.json');
const generic = new Set(labels.genericNames);
function resolveHotelName(...values) {
    return values.find(value => typeof value === 'string' && value.trim()
        && !generic.has(value.trim().toLowerCase()))?.trim() || '';
}
async function enrichBookingNames(bookings, HotelModel) {
    if (!HotelModel || typeof HotelModel.find !== 'function') return bookings;
    const ids = [...new Set(bookings.filter(b => b.provider === 'ratehawk' && !resolveHotelName(b.hotelName)
        && /^\d{1,10}$/.test(b.providerHotelCode || '')).map(b => String(b.providerHotelCode)))];
    if (!ids.length) return bookings;
    const hotels = await HotelModel.find({ hid: { $in: ids } }).select('hid name staticData.name').lean();
    const names = new Map(hotels.map(hotel => [String(hotel.hid), resolveHotelName(hotel.name, hotel.staticData?.name)]));
    return bookings.map(booking => !resolveHotelName(booking.hotelName) && booking.provider === 'ratehawk'
        && names.get(String(booking.providerHotelCode)) ? { ...booking, hotelName: names.get(String(booking.providerHotelCode)) } : booking);
}
module.exports = { resolveHotelName, enrichBookingNames };
