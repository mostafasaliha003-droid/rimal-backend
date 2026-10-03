const defaultOfferCacheService = require('../services/offerCacheService');
const { createHotelbedsBookingService } = require('../services/hotelbedsBookingService');

function createBookingController({
    offerCacheService = defaultOfferCacheService.hotelbeds,
    hotelbedsBookingService = createHotelbedsBookingService()
} = {}) {
    if (!offerCacheService || typeof offerCacheService.getBookingOffer !== 'function'
        || !hotelbedsBookingService || typeof hotelbedsBookingService.confirmBooking !== 'function') {
        throw new TypeError('booking_controller_dependencies_invalid');
    }

    return async function bookingController(req, res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        try {
            const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
                ? req.body : {};
            const result = await hotelbedsBookingService.confirmBooking({
                publicOfferId: body.publicOfferId,
                guestDetails: body.guestDetails,
                offerCacheService
            });
            return res.status(200).json({
                success: true,
                bookingReference: result.bookingReference,
                status: result.status
            });
        } catch (error) {
            const status = [400, 404, 409, 429, 502, 503].includes(error?.httpStatus)
                ? error.httpStatus : 503;
            const code = /^[a-z][a-z0-9_]{0,79}$/.test(error?.code || '')
                ? error.code : 'hotelbeds_booking_unavailable';
            return res.status(status).json({ success: false, error: code });
        }
    };
}

module.exports = createBookingController;