const crypto = require('node:crypto');
const express = require('express');
const finance = require('./deskFinanceModel');

/*
 * Mkhadda Desk: the staff console.
 *   /api/v1/desk/login, /me, /logout   admin (configured) or customer-service agent (StaffAccount)
 *   /api/v1/desk/team                  admin: agents (create, disable, reset password)
 *   /api/v1/desk/finance/*             admin: sell, cost, payment fees and net per booking and hotel
 *   /api/v1/desk/suppliers             admin: supplier deposit / credit / unpaid orders
 *   /api/v1/desk/rates                 admin: live supplier net rates next to our sell price
 *   /api/v1/desk/care/bookings         admin + agent: booking lookup, status and policies (no costs for agents)
 * Agents never receive cost, fee or margin fields.
 */
const fail = (code, httpStatus = 400) => Object.assign(new Error(code), { code, httpStatus });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const REFERENCE = /^[A-Za-z0-9_-]{1,120}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function freeCancellationBefore(snapshot) {
    const policies = snapshot?.cancellation_info?.policies;
    if (!Array.isArray(policies)) return null;
    const free = policies.find(row => Number(row?.penalty?.amount ?? row?.amount_charge ?? 1) === 0 && row.end_at);
    return free ? free.end_at : null;
}

function policyView(booking, checkout) {
    const snapshot = checkout?.prebook_snapshot || null;
    const policies = Array.isArray(snapshot?.cancellation_info?.policies) ? snapshot.cancellation_info.policies.map(row => ({
        from: row.start_at || null, until: row.end_at || null,
        penalty: row.penalty && typeof row.penalty.amount === 'string' ? { amount: row.penalty.amount, currency: row.penalty.currency_code } : null
    })) : [];
    return { text: typeof booking?.cancellationPolicy === 'string' ? booking.cancellationPolicy : '', freeBefore: freeCancellationBefore(snapshot) || booking?.freeCancelDeadline || null,
        policies, meal: snapshot?.meal || booking?.boardType || null, room: snapshot?.room_name || booking?.roomType || null };
}

function rateRows(hotel, customerPrice) {
    return (Array.isArray(hotel?.rates) ? hotel.rates : []).flatMap(rate => {
        const payment = rate?.payment_options?.payment_types?.find(item => item.type === 'deposit');
        if (!payment || !/^\d+(?:\.\d+)?$/.test(String(payment.amount))) return [];
        let sell = null;
        try { sell = customerPrice(rate); } catch { sell = null; }
        const net = Number(payment.amount);
        const sameCurrency = sell && sell.currency === payment.currency_code;
        return [{ room: rate.room_name || rate.room_data_trans?.main_name || '', meal: rate.meal_data?.value || rate.meal || null,
            freeBefore: payment.cancellation_penalties?.free_cancellation_before || null,
            net: { amount: net, currency: payment.currency_code },
            sell: sell ? { amount: sell.amount, currency: sell.currency } : null,
            margin: sameCurrency ? Math.round((sell.amount - net) * 100) / 100 : null,
            allotment: Number.isInteger(rate.allotment) ? rate.allotment : null }];
    }).sort((a, b) => a.net.amount - b.net.amount);
}

function createDeskRouter({ sessions, auth, adminEmail, adminPasswordHash, comparePassword, hashPassword,
    Staff, Booking, Checkout, Cancellation, Conversation, FinanceSetting,
    ratehawk, enrichHotels = async hotels => hotels, customerPrice, liveRates = async () => ({ rates: {} }),
    bookingInfo = null, loginLimiter = (_req, _res, next) => next(), now = Date.now }) {
    const router = express.Router();
    const staff = auth.requireRole(['admin', 'agent']);
    const admin = auth.requireRole('admin');
    const handle = fn => async (req, res) => {
        res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Robots-Tag': 'noindex' });
        try { res.json({ success: true, ...(await fn(req)) }); }
        catch (error) {
            const known = /^[a-z][a-z0-9_]{0,79}$/.test(error.code || '') && [400, 401, 403, 404, 409, 429, 502].includes(error.httpStatus);
            res.status(known ? error.httpStatus : 503).json({ success: false, error: known ? error.code : 'desk_unavailable' });
        }
    };

    // Sign-in: the configured administrator first, then active agents. Same failure for both.
    // An unknown e-mail still costs one bcrypt comparison, so timing does not reveal who has an account.
    let dummyHash = null;
    const decoy = async () => (dummyHash ||= await hashPassword(crypto.randomBytes(18).toString('hex')));
    router.post('/login', loginLimiter, handle(async req => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!EMAIL.test(email) || !password || password.length > 256) throw fail('invalid_credentials', 401);
        const configured = String(adminEmail || '').trim().toLowerCase();
        const adminHash = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(adminPasswordHash || '') ? adminPasswordHash : null;
        const a = Buffer.from(email), b = Buffer.from(configured);
        if (configured && adminHash && a.length === b.length && crypto.timingSafeEqual(a, b)) {
            if (!(await comparePassword(password, adminHash))) throw fail('invalid_credentials', 401);
            const session = await sessions.create({ subject: email, email, role: 'admin' });
            return { token: session.token, expiresAt: session.expiresAt.toISOString(), role: 'admin', email, name: 'Admin' };
        }
        const account = await Staff.findOne({ _id: email, active: true }).select('+passwordHash').lean();
        const ok = await comparePassword(password, account?.passwordHash || await decoy());
        if (!account || !ok) throw fail('invalid_credentials', 401);
        await Staff.updateOne({ _id: email }, { $set: { lastLoginAt: new Date(now()) } });
        const session = await sessions.create({ subject: email, email, role: 'agent' });
        return { token: session.token, expiresAt: session.expiresAt.toISOString(), role: 'agent', email, name: account.name };
    }));
    router.get('/me', staff, handle(async req => {
        if (req.auth.role === 'admin') return { role: 'admin', email: req.auth.email, name: 'Admin', expiresAt: req.auth.expiresAt };
        const account = await Staff.findOne({ _id: req.auth.subject, active: true }).lean();
        if (!account) throw fail('unauthorized', 401);
        return { role: 'agent', email: account._id, name: account.name, expiresAt: req.auth.expiresAt };
    }));
    router.post('/logout', staff, handle(async req => { await sessions.revoke(req.authToken); return {}; }));

    // Team: customer-service agents.
    const teamView = row => ({ email: row._id, name: row.name, role: row.role, active: row.active !== false, lastLoginAt: row.lastLoginAt || null, createdAt: row.createdAt || null });
    router.get('/team', admin, handle(async () => ({ team: (await Staff.find({}).sort({ createdAt: -1 }).limit(200).lean()).map(teamView) })));
    router.post('/team', admin, handle(async req => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!EMAIL.test(email) || email === String(adminEmail || '').trim().toLowerCase()) throw fail('desk_invalid_email');
        if (!name || name.length > 80) throw fail('desk_invalid_name');
        if (password.length < 12 || password.length > 128) throw fail('desk_weak_password');
        try { await Staff.create({ _id: email, name, role: 'agent', passwordHash: await hashPassword(password), active: true, createdBy: req.auth.email }); }
        catch (error) { if (error.code === 11000) throw fail('desk_agent_exists', 409); throw error; }
        return { member: teamView({ _id: email, name, role: 'agent', active: true, createdAt: new Date(now()) }) };
    }));
    router.patch('/team/:email', admin, handle(async req => {
        const email = String(req.params.email || '').toLowerCase();
        if (!EMAIL.test(email)) throw fail('desk_agent_not_found', 404);
        const changes = {};
        if (typeof req.body?.active === 'boolean') changes.active = req.body.active;
        if (typeof req.body?.name === 'string' && req.body.name.trim() && req.body.name.length <= 80) changes.name = req.body.name.trim();
        if (req.body?.password !== undefined) {
            if (typeof req.body.password !== 'string' || req.body.password.length < 12 || req.body.password.length > 128) throw fail('desk_weak_password');
            changes.passwordHash = await hashPassword(req.body.password);
        }
        if (!Object.keys(changes).length) throw fail('desk_invalid_update');
        const row = await Staff.findOneAndUpdate({ _id: email }, { $set: changes }, { new: true }).lean();
        if (!row) throw fail('desk_agent_not_found', 404);
        return { member: teamView(row) };
    }));

    // Finance.
    async function schedules() {
        const row = await FinanceSetting.findById('payment-fees').lean();
        return Object.fromEntries(Object.keys(finance.PROVIDERS).map(key => [key, finance.normalizeSchedule(row?.providers?.[key])]));
    }
    async function rows({ from, to, limit = 2000 }) {
        const filter = { state: { $in: finance.PAID }, payment_verified_at: { $type: 'date' } };
        if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
        const checkouts = await Checkout.find(filter).sort({ createdAt: -1 }).limit(limit)
            .select('reference state amount_minor currency payment_quote payment_provider supplier_payment prebook_snapshot partner_order_id cancellation_request_hash refund_amount_minor ziina_test createdAt')
            .lean();
        const references = checkouts.map(row => row.reference), orders = checkouts.map(row => row.partner_order_id).filter(Boolean);
        const [bookings, cancellations, fees, table] = await Promise.all([
            Booking.find({ bookingReference: { $in: references } }).select('bookingReference hotelName providerHotelCode customerName roomType checkInDate checkOutDate status').lean(),
            orders.length ? Cancellation.find({ _id: { $in: orders } }).select('amount_payable amount_refunded state').lean() : [],
            schedules(), liveRates().catch(() => ({ rates: {} }))
        ]);
        const byRef = new Map(bookings.map(row => [row.bookingReference, row])), byOrder = new Map(cancellations.map(row => [row._id, row]));
        return { list: checkouts.map(checkout => finance.economics({ checkout, booking: byRef.get(checkout.reference), cancellation: byOrder.get(checkout.partner_order_id),
            schedules: fees, liveRates: table.rates || {} })), fees, fxDate: table.date || null };
    }
    router.get('/finance/overview', admin, handle(async req => {
        const days = Math.min(365, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
        const from = new Date(now() - days * 86400000);
        const { list, fees } = await rows({ from });
        const summary = finance.summarize(list, { days, now: now() });
        const warnings = [...new Set(list.flatMap(row => row.issues))];
        return { generatedAt: new Date(now()).toISOString(), days, ...summary, bookings: list.slice(0, 150), warnings,
            providers: summary.providers, fees: Object.fromEntries(Object.entries(fees).map(([key, value]) => [key, { ...value, ...finance.PROVIDERS[key] }])) };
    }));
    router.get('/finance/providers', admin, handle(async () => ({ providers: Object.fromEntries(Object.entries(await schedules())
        .map(([key, value]) => [key, { ...value, ...finance.PROVIDERS[key] }])) })));
    router.put('/finance/providers', admin, handle(async req => {
        const next = finance.validateProviders(req.body?.providers);
        const current = await schedules();
        const providers = { ...current, ...next };
        await FinanceSetting.updateOne({ _id: 'payment-fees' }, { $set: { providers, updatedBy: req.auth.email } }, { upsert: true });
        return { providers: Object.fromEntries(Object.entries(providers).map(([key, value]) => [key, { ...value, ...finance.PROVIDERS[key] }])) };
    }));

    // Supplier balances (RateHawk financial details), cached for a minute.
    let balance = null;
    router.get('/suppliers', admin, handle(async req => {
        if (!balance || balance.at < now() - 60000 || req.query.refresh === '1') {
            try { balance = { at: now(), value: finance.supplierBalance(await ratehawk.retrieveFinancialDetails()) }; }
            catch { if (!balance) throw fail('supplier_balance_unavailable', 502); }
        }
        return { checkedAt: new Date(balance.at).toISOString(), suppliers: [balance.value,
            { supplier: 'Hotelbeds', connected: false }] };
    }));

    // Cost portal: live supplier net rates, our sell price and the margin, for management only.
    router.post('/rates', admin, handle(async req => {
        const body = req.body || {};
        if (!DAY.test(body.checkin || '') || !DAY.test(body.checkout || '') || body.checkout <= body.checkin) throw fail('desk_invalid_dates');
        const adults = Math.min(6, Math.max(1, Number.parseInt(body.adults, 10) || 2));
        const children = (Array.isArray(body.children) ? body.children : []).slice(0, 4).map(Number).filter(age => Number.isInteger(age) && age >= 0 && age <= 17);
        const residency = typeof body.residency === 'string' && /^[a-z]{2}$/.test(body.residency) ? body.residency : 'ae';
        const criteria = { checkin: body.checkin, checkout: body.checkout, residency, language: 'en', currency: 'USD', guests: [{ adults, children }] };
        let hotels;
        if (body.hid !== undefined) {
            const hid = Number(body.hid);
            if (!Number.isSafeInteger(hid) || hid <= 0) throw fail('desk_invalid_hotel');
            const result = await ratehawk.getHotelPageRates({ ...criteria, hid });
            hotels = Array.isArray(result) ? result : result?.hotels || [];
        } else {
            const region = Number(body.region_id);
            if (!Number.isInteger(region) || region <= 0) throw fail('desk_invalid_region');
            const result = await ratehawk.searchLiveRatesByRegion({ ...criteria, region_id: region });
            hotels = (Array.isArray(result) ? result : result?.hotels || []).slice(0, 40);
        }
        const enriched = await enrichHotels(hotels);
        return { searchedAt: new Date(now()).toISOString(), markupPercent: 7, criteria: { ...criteria, guests: undefined, adults, children },
            hotels: enriched.map(hotel => ({ hid: hotel.hid || hotel.id || null, name: hotel.name || hotel.hotelName || hotel.static?.name || String(hotel.hid || hotel.id || ''),
                stars: hotel.star_rating || hotel.stars || null, city: hotel.city || hotel.address?.city || null, rates: rateRows(hotel, customerPrice) }))
                .filter(hotel => hotel.rates.length) };
    }));

    // Care: booking lookup and the live picture of one booking.
    const caseView = (booking, checkout) => ({
        reference: booking.bookingReference, hotel: booking.hotelName || '', hid: booking.providerHotelCode || null,
        guest: booking.customerName || '', email: booking.email || '', phone: booking.phone || '',
        checkin: booking.checkInDate || null, checkout: booking.checkOutDate || null, status: booking.status || null,
        supplierStatus: booking.supplierStatus || null, confirmedAt: booking.confirmedAt || null, createdAt: booking.createdAt || null,
        provider: booking.provider || null, paymentProvider: checkout ? (checkout.payment_provider === 'tabby' ? 'tabby' : 'ziina') : null,
        paymentState: checkout?.state || null, refundStatus: checkout?.refund_status || null,
        price: booking.price != null ? { amount: String(booking.price), currency: booking.priceCurrency || null } : null
    });
    router.get('/care/bookings', staff, handle(async req => {
        const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
        const filter = {};
        if (q) {
            const pattern = escapeRegex(q);
            filter.$or = ['bookingReference', 'supplierReference', 'hotelConfirmationNumber', 'customerName', 'email', 'hotelName']
                .map(field => ({ [field]: { $regex: pattern, $options: 'i' } }));
        }
        const bookings = await Booking.find(filter).sort({ createdAt: -1 }).limit(40)
            .select('bookingReference hotelName providerHotelCode customerName email phone checkInDate checkOutDate status supplierStatus confirmedAt createdAt provider price priceCurrency').lean();
        const checkouts = await Checkout.find({ reference: { $in: bookings.map(row => row.bookingReference) } }).select('reference state payment_provider refund_status').lean();
        const byRef = new Map(checkouts.map(row => [row.reference, row]));
        return { bookings: bookings.map(row => caseView(row, byRef.get(row.bookingReference))) };
    }));
    router.get('/care/bookings/:reference', staff, handle(async req => {
        if (!REFERENCE.test(req.params.reference || '')) throw fail('desk_booking_not_found', 404);
        const booking = await Booking.findOne({ bookingReference: req.params.reference }).lean();
        if (!booking) throw fail('desk_booking_not_found', 404);
        const checkout = await Checkout.findOne({ reference: booking.bookingReference }).lean();
        const [cancellation, conversation] = await Promise.all([
            checkout?.partner_order_id ? Cancellation.findById(checkout.partner_order_id).lean() : null,
            Conversation.findOne({ reference: booking.bookingReference, realm: req.auth.realm }).lean()
        ]);
        let live = null;
        if (bookingInfo && booking.provider === 'ratehawk' && booking.supplierReference) {
            try {
                const info = await bookingInfo(booking.supplierReference);
                live = { checkedAt: new Date(now()).toISOString(), status: info.status || null, pending: Boolean(info.pending), cancellable: info.isCancellable === true,
                    currentPenalty: info.current_penalty ? { amount: info.current_penalty.amount, currency: info.current_penalty.currency_code } : null };
            } catch { live = { checkedAt: new Date(now()).toISOString(), unavailable: true }; }
        }
        const timeline = [
            booking.createdAt && { at: booking.createdAt, event: 'created' },
            checkout?.payment_verified_at && { at: checkout.payment_verified_at, event: 'paid', provider: checkout.payment_provider === 'tabby' ? 'tabby' : 'ziina' },
            booking.confirmedAt && { at: booking.confirmedAt, event: 'confirmed' },
            checkout?.notification_sent_at && { at: checkout.notification_sent_at, event: 'voucher_sent' },
            cancellation?.createdAt && { at: cancellation.createdAt, event: 'cancellation_requested' },
            cancellation?.state === 'cancelled' && { at: cancellation.updatedAt, event: 'cancelled' },
            checkout?.refund_verified_at && { at: checkout.refund_verified_at, event: 'refunded' }
        ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
        const result = { booking: { ...caseView(booking, checkout), supplierReference: booking.supplierReference || null, hotelConfirmationNumber: booking.hotelConfirmationNumber || null,
            room: booking.roomType || null, companions: Array.isArray(booking.companions) ? booking.companions.length : 0 },
        policy: policyView(booking, checkout), live, timeline,
        cancellation: cancellation ? { state: cancellation.state, reference: cancellation.cancellation_reference || null, customerRefund: checkout?.refund_amount_minor ?? null } : null,
        conversation: conversation ? { id: conversation._id, status: conversation.status, lastMessage: conversation.lastMessage || '', updatedAt: conversation.updatedAt } : null };
        // Money detail is for the administrator only.
        if (req.auth.role === 'admin' && checkout && finance.PAID.includes(checkout.state)) {
            const table = await liveRates().catch(() => ({ rates: {} }));
            result.economics = finance.economics({ checkout, booking, cancellation, schedules: await schedules(), liveRates: table.rates || {} });
        }
        return result;
    }));
    return router;
}

module.exports = { createDeskRouter, rateRows, policyView };
