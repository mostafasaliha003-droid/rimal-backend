const mongoose = require('mongoose');
const BookingProcess = require('../models/BookingProcess');

const ACTIVE = ['creating', 'form_ready', 'card_pending', 'card_ready', 'card_unknown', 'finishing', 'processing', '3ds'];

async function pendingHistory(search = {}) {
    if (mongoose.connection.readyState !== 1) {
        throw Object.assign(new Error('order_history_unavailable'), { code: 'order_history_unavailable', httpStatus: 503 });
    }
    const now = Date.now();
    const filter = { $or: [
        { state: { $in: ACTIVE } },
        { confirmed_at: { $gt: new Date(now - 30000) } },
        // A legacy confirmed record without a trustworthy confirmation time
        // cannot establish the supplier's minimum history-sync delay.
        { state: 'confirmed', confirmed_at: { $exists: false } },
        { state: 'confirmed', confirmed_at: null }
    ] };
    const identity = [];
    if (search.partner_order_ids) identity.push({ partner_order_id: { $in: search.partner_order_ids } });
    if (search.order_ids) identity.push({ 'form.order_id': { $in: search.order_ids } });
    if (identity.length) filter.$and = identity;
    const process = await BookingProcess.findOne(filter).lean();
    if (!process) return null;
    const confirmedAt = process.confirmed_at && new Date(process.confirmed_at).getTime();
    if (!ACTIVE.includes(process.state) && !(Number.isFinite(confirmedAt) && now < confirmedAt + 30000)
        && !(process.state === 'confirmed' && !Number.isFinite(confirmedAt))) return null;
    return { retry_after_ms: Number.isFinite(confirmedAt)
        ? Math.max(1000, confirmedAt + 30000 - now) : 30000 };
}

module.exports = { pendingHistory };
