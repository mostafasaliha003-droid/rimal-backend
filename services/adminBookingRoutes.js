const express = require('express');

const BOOKING_FIELDS = [
    'bookingReference', 'supplierReference', 'hotelConfirmationNumber', 'supplierStatus', 'provider',
    'email', 'customerName', 'phone', 'hotelName', 'roomType', 'boardType', 'price', 'priceCurrency', 'paymentMethod',
    'supplierPaymentType', 'checkInDate', 'checkOutDate', 'status', 'cancellationPolicy', 'confirmedAt', 'createdAt'
].join(' ');

function createAdminBookingRouter({ BookingModel, requireAdmin } = {}) {
    if (!BookingModel || typeof BookingModel.countDocuments !== 'function' || typeof BookingModel.find !== 'function'
        || typeof requireAdmin !== 'function') throw new TypeError('admin_booking_routes_dependencies_invalid');
    const router = express.Router();

    const listBookings = async (req, res) => {
        res.set({ 'Cache-Control': 'no-store', Vary: 'Authorization' });
        const realm = req.auth?.realm;
        if (typeof realm !== 'string' || !/^[a-z0-9:_-]{1,100}$/i.test(realm)) {
            return res.status(503).json({ success: false, error: 'admin_data_unavailable' });
        }
        const filter = { realm };
        try {
            const [totalBookings, activeBookings, cancelledBookings, bookings] = await Promise.all([
                BookingModel.countDocuments(filter),
                BookingModel.countDocuments({ ...filter, status: 'active' }),
                BookingModel.countDocuments({ ...filter, status: { $in: ['cancelled', 'canceled'] } }),
                BookingModel.find(filter).sort({ createdAt: -1 }).limit(500).select(BOOKING_FIELDS).lean()
            ]);
            let totalRevenueAED = null;
            if (typeof BookingModel.aggregate === 'function') {
                const revenue = await BookingModel.aggregate([
                    { $match: { ...filter, status: 'active', priceCurrency: 'AED', price: { $type: 'number' } } },
                    { $group: { _id: null, total: { $sum: '$price' } } }
                ]);
                totalRevenueAED = Number.isFinite(revenue?.[0]?.total) ? revenue[0].total : 0;
            }
            return res.status(200).json({
                success: true,
                stats: {
                    totalBookings,
                    activeBookings,
                    cancelledBookings,
                    totalRevenueAED,
                },
                bookings
            });
        } catch {
            return res.status(503).json({ success: false, error: 'admin_data_unavailable' });
        }
    };

    router.get('/', requireAdmin, listBookings);
    router.get('/stats', requireAdmin, listBookings);

    return router;
}

module.exports = { BOOKING_FIELDS, createAdminBookingRouter };