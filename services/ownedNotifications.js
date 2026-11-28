const { createHash } = require('node:crypto');
const membershipEvents = ['submitted', 'under_review', 'needs_information', 'approved', 'rejected', 'suspended'];
const pageSize = 50;

function recent(Model, filter, timestamp, fields = '') {
    return Model.find(filter).sort({ [timestamp]: -1, _id: -1 }).limit(pageSize).select(`_id ${timestamp} ${fields}`).lean();
}

function notification(row, kind, event, timestamp, reference) {
    const time = row[timestamp] && new Date(row[timestamp]);
    if (!time || !Number.isFinite(time.getTime())) return [];
    const id = createHash('sha256').update(`notification:${kind}:${event}:${row._id}`).digest('hex');
    return [{ id, kind, event, at: time.toISOString(), ...(typeof reference==='string' && reference.length<=128 ? {reference} : {}) }];
}

function createOwnedNotificationsHandler({ Booking, Notice, Checkout }) {
    return async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
        if (req.auth?.role !== 'user' || !req.auth.subject || !req.auth.realm) return res.sendStatus(401);
        const scope = { ownerSubject: req.auth.subject, realm: req.auth.realm };
        try {
            const [membership, bookings, cancellations, refunds] = await Promise.all([
                recent(Notice, { ...scope, event: { $in: membershipEvents } }, 'createdAt', 'event'),
                recent(Booking, { ...scope, confirmedAt: { $type: 'date' } }, 'confirmedAt', 'bookingReference'),
                recent(Booking, { ...scope, cancelledAt: { $type: 'date' } }, 'cancelledAt', 'bookingReference'),
                recent(Checkout, { ...scope, state: 'refund_completed', refund_verified_at: { $type: 'date' } }, 'refund_verified_at', 'reference')
            ]);
            const notifications = [
                ...membership.flatMap(row => notification(row, 'membership', row.event, 'createdAt')),
                ...bookings.flatMap(row => notification(row, 'booking', 'confirmed', 'confirmedAt', row.bookingReference)),
                ...cancellations.flatMap(row => notification(row, 'booking', 'cancelled', 'cancelledAt', row.bookingReference)),
                ...refunds.flatMap(row => notification(row, 'booking', 'refunded', 'refund_verified_at', row.reference))
            ].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, pageSize);
            return res.json({ notifications });
        } catch { return res.status(503).json({ error: 'notifications_unavailable' }); }
    };
}
module.exports = { createOwnedNotificationsHandler };
