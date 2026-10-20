const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveHotelName, enrichBookingNames } = require('./services/hotelPresentationService');

test('hotel labels never mask a canonical hotel name in either frontend or backend', async () => {
    const frontend = await import('./frontend/src/services/hotelPresentation.js');
    for (const resolve of [resolveHotelName, frontend.resolveHotelName]) {
        assert.equal(resolve('Hotel', ' R&H Park Island '), 'R&H Park Island');
        assert.equal(resolve('الفندق', 'Hyatt Place Dubai Jumeirah Residences'), 'Hyatt Place Dubai Jumeirah Residences');
        assert.equal(resolve('Hotel 101', 'Other Hotel'), 'Hotel 101');
        assert.equal(resolve(null, {}, ' N/A '), '');
    }
});
test('booking name enrichment uses only the exact supplier hotel id and leaves meaningful names intact', async () => {
    const records = [
        { provider: 'ratehawk', providerHotelCode: '123', hotelName: 'Hotel', bookingReference: 'owned-a' },
        { provider: 'ratehawk', providerHotelCode: '999', hotelName: 'Hotel', bookingReference: 'owned-b' },
        { provider: 'ratehawk', providerHotelCode: '123', hotelName: 'Existing Hotel', bookingReference: 'owned-c' },
        { provider: 'hotelbeds', providerHotelCode: '123', hotelName: 'Hotel', bookingReference: 'owned-d' }
    ];
    const HotelModel = { find(query) {
        assert.deepEqual(query, { hid: { $in: ['123', '999'] } });
        return { select: () => ({ lean: async () => [{ hid: '123', name: 'Hotel', staticData: { name: 'Supplier Canonical Hotel' } }] }) };
    } };
    const result = await enrichBookingNames(records, HotelModel);
    assert.equal(result[0].hotelName, 'Supplier Canonical Hotel');
    assert.equal(result[1].hotelName, 'Hotel');
    assert.equal(result[2].hotelName, 'Existing Hotel');
    assert.equal(result[3].hotelName, 'Hotel');
    assert.equal(records[0].hotelName, 'Hotel', 'Read-only presentation never mutates stored records');
    assert.equal(require('./services/userAuthRoutes').publicBooking(result[0]).providerHotelCode, undefined);
});
