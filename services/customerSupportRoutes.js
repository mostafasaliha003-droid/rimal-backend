const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const topics = ['booking', 'payment', 'voucher', 'cancellation', 'refund', 'other'];
const statuses = ['open', 'waiting', 'resolved'];
const hash = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const error = (code, httpStatus = 400) => Object.assign(new Error(code), { code, httpStatus });
const ref = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value.trim() : null;
const messageView = row => ({ id: row._id, body: row.body, role: row.senderRole, kind: row.kind, createdAt: row.createdAt });
const conversationView = (row, staff) => ({ id: row._id, reference: row.reference, customerName: row.customerName,
    hotelName: row.hotelName, topic: row.topic, status: row.status, priority: row.priority,
    lastMessage: row.lastMessage, updatedAt: row.updatedAt,
    unread: !!(staff ? row.lastCustomerAt && (!row.staffReadAt || row.lastCustomerAt > row.staffReadAt)
        : row.lastStaffAt && (!row.customerReadAt || row.lastStaffAt > row.customerReadAt)),
    ...(staff ? { assignedTo: row.assignedTo || null } : {}) });

function createCustomerSupportRouters({ BookingModel, CheckoutModel = require('../models/CheckoutAttempt'),
    UserModel = require('mongoose').models.User,
    Conversation = require('../models/SupportConversation'), Message = require('../models/SupportMessage'),
    requireUser, requireAdmin, env = process.env, readLimiter, writeLimiter } = {}) {
    const customer = express.Router(), staff = express.Router();
    const scopedLimit = max => rateLimit({ windowMs: 60000, max, standardHeaders: true, legacyHeaders: false,
        keyGenerator: req => `${req.auth.realm}:${req.auth.role}:${req.auth.subject}`, message: { error: 'support_rate_limited' } });
    readLimiter ||= scopedLimit(90); writeLimiter ||= scopedLimit(30);
    const wrap = fn => async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
        try {
            if (!req.auth?.subject || typeof req.auth.realm !== 'string' || req.auth.realm !== env.RIMAL_AUTH_REALM) throw error('unauthorized', 401);
            res.json(await fn(req));
        } catch (failure) { res.status([400, 401, 404, 409, 429].includes(failure.httpStatus) ? failure.httpStatus : 503)
            .json({ error: failure.httpStatus ? failure.code : 'support_unavailable' }); }
    };
    customer.use(requireUser); staff.use(requireAdmin);
    const owner = req => ({ ownerSubject: req.auth.subject, realm: req.auth.realm });
    // A typed reference or unpaid intent is never an entitlement. Match a real
    // owned booking or a payment verified by the server against the gateway.
    async function eligible(req, reference, isStaff = false) {
        if (!ref(reference)) throw error('support_reference_not_found', 404);
        const booking = await BookingModel.findOne({ ...owner(req), bookingReference: reference }).lean();
        const payment = await CheckoutModel.findOne({ ...owner(req), reference,
            ziina_intent_id: { $type: 'string' }, payment_verified_at: { $type: 'date' } }).lean();
        if (!booking && !payment) throw error('support_reference_not_found', 404);
        const profile = isStaff && UserModel ? await UserModel.findOne({ _id: req.auth.subject }).select('name email phone').lean() : null;
        const provider = booking?.provider || (payment ? 'ratehawk' : null);
        const voucherAvailable = booking?.status === 'active' && ['CONFIRMED', 'COMPLETED'].includes(String(booking.supplierStatus).toUpperCase());
        return { reference, hotelName: booking?.hotelName || '', customerName: booking?.customerName || '',
            bookingStatus: booking?.status || null, paymentStatus: payment?.state || null,
            paid: !!payment?.payment_verified_at, amount: payment?.amount_minor != null
                ? require('./ziinaClient').formatAmountMinor(payment.amount_minor, payment.currency) : booking?.price,
            currency: payment?.currency || booking?.priceCurrency,
            checkIn: booking?.checkInDate || null, checkOut: booking?.checkOutDate || null,
            refundStatus: payment?.refund_status || null, voucherStatus: payment?.notification_status || null,
            documents: { voucher: !!voucherAvailable,
                cancellation: !!(payment?.cancellation_request_hash && booking?.status === 'cancelled') },
            ...(isStaff ? { customer: profile ? { name: profile.name || null, email: profile.email || null, phone: profile.phone || null, source: 'account' }
                : { name: booking?.customerName || null, email: booking?.email || null, phone: booking?.phone || null, source: 'booking' },
                bookingContact: { name: booking?.customerName || null, email: booking?.email || null, phone: booking?.phone || null },
                provider, supplierReference: booking?.supplierReference || payment?.partner_order_id || null } : {}) };
    }
    async function caseFor(req, isStaff) {
        if (!/^[a-f\d]{64}$/.test(req.params.id || '')) throw error('support_not_found', 404);
        const row = await Conversation.findOne({ _id: req.params.id, realm: req.auth.realm,
            ...(!isStaff ? { ownerSubject: req.auth.subject } : {}) }).lean();
        if (!row) throw error('support_not_found', 404);
        return row;
    }
    customer.get('/eligibility', readLimiter, wrap(async req => {
        const [bookings, payments] = await Promise.all([
            BookingModel.find(owner(req)).sort({ createdAt: -1 }).limit(100).select('bookingReference hotelName status').lean(),
            CheckoutModel.find({ ...owner(req), ziina_intent_id: { $type: 'string' }, payment_verified_at: { $type: 'date' } })
                .sort({ createdAt: -1 }).limit(100).select('reference state').lean()
        ]);
        const references = new Map(bookings.map(b => [b.bookingReference, { reference: b.bookingReference,
            hotelName: b.hotelName, status: b.status, type: 'booking' }]));
        for (const p of payments) if (!references.has(p.reference)) references.set(p.reference,
            { reference: p.reference, status: p.state, type: 'payment' });
        return { references: [...references.values()] };
    }));
    customer.get('/conversations', readLimiter, wrap(async req => ({ conversations:
        (await Conversation.find(owner(req)).sort({ updatedAt: -1 }).limit(100).lean()).map(row => conversationView(row, false)) })));
    customer.post('/conversations', writeLimiter, wrap(async req => {
        const context = await eligible(req, req.body?.reference);
        const topic = req.body?.topic || 'booking';
        if (!topics.includes(topic)) throw error('support_invalid_topic');
        const id = hash(req.auth.realm, req.auth.subject, context.reference);
        const document = { _id: id, ...owner(req), reference: context.reference,
            customerName: context.customerName || req.auth.email || '', hotelName: context.hotelName, topic };
        try { await Conversation.updateOne({ _id: id, ...owner(req) }, { $setOnInsert: document }, { upsert: true }); }
        catch (failure) { if (failure.code !== 11000) throw failure; }
        const row = await Conversation.findOne({ _id: id, ...owner(req) }).lean();
        if (!row) throw error('support_not_found', 404);
        return { conversation: conversationView(row, false), context };
    }));
    staff.get('/conversations', readLimiter, wrap(async req => {
        const filter = { realm: req.auth.realm };
        const unreadFilter = { realm: req.auth.realm, $expr: { $gt: ['$lastCustomerAt', { $ifNull: ['$staffReadAt', new Date(0)] }] } };
        let contactMatchesLimited = false;
        if (req.query.inbox && !['all', 'mine', 'unassigned', 'unread'].includes(req.query.inbox)) throw error('support_invalid_inbox');
        if (req.query.inbox === 'mine') filter.assignedTo = req.auth.subject;
        if (req.query.inbox === 'unassigned') filter.assignedTo = { $in: [null, ''] };
        if (req.query.inbox === 'unread') filter.$expr = unreadFilter.$expr;
        if (req.query.status && req.query.status !== 'all') {
            if (!statuses.includes(req.query.status)) throw error('support_invalid_status');
            filter.status = req.query.status;
        }
        if (req.query.q) {
            if (typeof req.query.q !== 'string' || req.query.q.length > 100) throw error('support_invalid_search');
            const query = req.query.q.trim();
            const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const digits = query.replace(/\D/g, '');
            const phonePattern = digits.length >= 5 && /^[+()\d\s-]+$/.test(query) ? digits.split('').join('[^0-9]*') : pattern;
            filter.$or = ['reference', 'hotelName', 'customerName'].map(field => ({ [field]: { $regex: pattern, $options: 'i' } }));
            const contactFilter = [{ email: { $regex: pattern, $options: 'i' } }, { phone: { $regex: phonePattern, $options: 'i' } }];
            const [profiles, bookings] = await Promise.all([
                UserModel ? UserModel.find({ $or: [...contactFilter, { name: { $regex: pattern, $options: 'i' } }] })
                    .limit(500).select('_id').lean() : [],
                BookingModel.find({ realm: req.auth.realm, $or: contactFilter }).limit(500).select('bookingReference').lean()
            ]);
            if (profiles.length) filter.$or.push({ ownerSubject: { $in: profiles.map(profile => String(profile._id)) } });
            if (bookings.length) filter.$or.push({ reference: { $in: bookings.map(booking => booking.bookingReference) } });
            contactMatchesLimited = profiles.length === 500 || bookings.length === 500;
        }
        const [rows, counts] = await Promise.all([
            Conversation.find(filter).sort({ priority: 1, updatedAt: -1 }).limit(101).lean(),
            Promise.all([...statuses.map(status => Conversation.countDocuments({ realm: req.auth.realm, status })), Conversation.countDocuments(unreadFilter)])
        ]);
        return { conversations: rows.slice(0, 100).map(row => conversationView(row, true)), hasMore: rows.length > 100 || contactMatchesLimited,
            counts: { ...Object.fromEntries(statuses.map((s, i) => [s, counts[i]])), unread: counts[3] } };
    }));
    for (const [router, isStaff] of [[customer, false], [staff, true]]) {
        router.get('/conversations/:id', readLimiter, wrap(async req => {
            const row = await caseFor(req, isStaff);
            const snapshot = new Date();
            const filter = { conversation: row._id, realm: req.auth.realm, ...(!isStaff ? { kind: 'message' } : {}) };
            if (req.query.before) {
                if (typeof req.query.before !== 'string' || !/^[a-f\d-]{36,64}$/i.test(req.query.before)) throw error('support_invalid_cursor');
                const cursor = await Message.findOne({ ...filter, _id: req.query.before }).lean();
                if (!cursor) throw error('support_invalid_cursor');
                filter.$or = [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor._id } }];
            }
            const messages = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(101).lean();
            if (!req.query.before && req.query.read !== '0') await Conversation.updateOne({ _id: row._id, realm: req.auth.realm },
                { $max: { [isStaff ? 'staffReadAt' : 'customerReadAt']: snapshot } }, { timestamps: false });
            const context = await eligible({ auth: { ...req.auth, subject: row.ownerSubject } }, row.reference, isStaff);
            return { conversation: conversationView(row, isStaff), context,
                messages: messages.slice(0, 100).reverse().map(messageView), hasMore: messages.length > 100 };
        }));
        router.post('/conversations/:id/messages', writeLimiter, wrap(async req => {
            const row = await caseFor(req, isStaff);
            if (!isStaff) await eligible(req, row.reference);
            const body = text(req.body?.body), clientId = req.body?.clientId;
            const kind = isStaff && req.body?.kind === 'note' ? 'note' : 'message';
            if (!body || !/^[a-f\d-]{36}$/i.test(clientId || '')) throw error('support_invalid_message');
            const id = hash(row._id, req.auth.role, req.auth.subject, clientId);
            let message;
            try { message = await Message.create({ _id: id, conversation: row._id, realm: req.auth.realm,
                senderSubject: req.auth.subject, senderRole: isStaff ? 'admin' : 'user', kind, body }); }
            catch (failure) {
                if (failure.code !== 11000) throw failure;
                message = await Message.findOne({ _id: id, conversation: row._id, realm: req.auth.realm }).lean();
                if (!message || message.body !== body || message.kind !== kind) throw error('support_message_conflict', 409);
            }
            if (kind === 'message') {
                await Conversation.updateOne({ _id: row._id, realm: req.auth.realm },
                    { $max: { [isStaff ? 'lastStaffAt' : 'lastCustomerAt']: message.createdAt } }, { timestamps: false });
                await Conversation.updateOne({ _id: row._id, realm: req.auth.realm, $or: [
                    { lastMessageAt: { $lt: message.createdAt } },
                    { lastMessageAt: message.createdAt, lastMessageId: { $lt: id } }
                ] }, { $set: { lastMessage: body.slice(0, 160), lastMessageId: id,
                    lastMessageAt: message.createdAt, status: isStaff ? 'waiting' : 'open' } });
            }
            return { message: messageView(message) };
        }));
    }
    staff.get('/conversations/:id/cancellation-receipt', readLimiter, async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' });
        try {
            if (!req.auth?.subject || req.auth.realm !== env.RIMAL_AUTH_REALM) throw error('unauthorized', 401);
            const row = await caseFor(req, true);
            const booking = await BookingModel.findOne({ bookingReference: row.reference,
                ownerSubject: row.ownerSubject, realm: row.realm }).lean();
            if (!booking || booking.provider !== 'ratehawk' || booking.status !== 'cancelled' || !booking.supplierReference) throw error('support_document_unavailable', 404);
            const { details, buffer } = await require('./cancellationReceiptService').generateReceipt(booking.supplierReference);
            if (details.reference !== row.reference || details.owner !== row.ownerSubject || details.realm !== row.realm) throw error('support_document_unavailable', 404);
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Remal-Cancellation-${row.reference}.pdf"` });
            res.send(buffer);
        } catch (failure) { res.status([401, 404].includes(failure.httpStatus) ? failure.httpStatus : 503).json({ error: 'support_document_unavailable' }); }
    });
    staff.patch('/conversations/:id', writeLimiter, wrap(async req => {
        const row = await caseFor(req, true), changes = {};
        if (req.body?.status !== undefined) { if (!statuses.includes(req.body.status)) throw error('support_invalid_status'); changes.status = req.body.status; }
        if (req.body?.priority !== undefined) { if (!['normal', 'high'].includes(req.body.priority)) throw error('support_invalid_priority'); changes.priority = req.body.priority; }
        if (req.body?.assignToMe === true) changes.assignedTo = req.auth.subject;
        if (!Object.keys(changes).length) throw error('support_invalid_update');
        await Message.create({ _id: crypto.randomUUID(), conversation: row._id, realm: req.auth.realm,
            senderSubject: req.auth.subject, senderRole: 'admin', kind: 'event', body: JSON.stringify(changes) });
        await Conversation.updateOne({ _id: row._id, realm: req.auth.realm }, { $set: changes });
        return { conversation: conversationView({ ...row, ...changes }, true) };
    }));
    return { customer, staff };
}
module.exports = { createCustomerSupportRouters };
