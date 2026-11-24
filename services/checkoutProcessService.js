const crypto = require('node:crypto');
const mongoose = require('mongoose');
const CheckoutAttempt = require('../models/CheckoutAttempt');
const booking = require('./bookingProcessService');
const ratehawk = require('./ratehawkService');
const payment = require('./paymentService');
const ziina = require('./ziinaClient');
const tabby = require('./tabbyClient');

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function encryptionKey() {
    const raw = process.env.PAYMENT_BOOKING_ENCRYPTION_KEY || '';
    if (!/^[a-f\d]{64}$/i.test(raw)) throw fail('checkout_encryption_unavailable', 503);
    return Buffer.from(raw, 'hex');
}

function encryptDetails(details) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') };
}

function decryptDetails(record) {
    const { iv, tag, ciphertext } = record.encrypted_details || {};
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

function text(value, name, max = 100) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`invalid_${name}`);
    return value.trim();
}

// RateHawk accepts 1-50 unicode letters, spaces and ' - , . ’ in guest names (no digits or symbols).
// Names are sent to RateHawk after payment, so they are checked here, before any charge.
const GUEST_NAME = /^\p{L}[\p{L} '\-,.\u2019]*$/u;
function guestName(value, name) {
    const result = text(value, name, 50);
    if (!GUEST_NAME.test(result)) throw fail(`invalid_${name}`);
    return result;
}

function normalizedCheckout(input = {}) {
    const hid = Number(input.hid);
    if (!Number.isSafeInteger(hid) || hid < 1) throw fail('invalid_hotel');
    const bookHash = text(input.book_hash, 'book_hash', 1024);
    const roomName = text(input.roomName, 'room_name', 256);
    const checkin = text(input.checkin, 'checkin', 10);
    const checkout = text(input.checkout, 'checkout', 10);
    const start = Date.parse(`${checkin}T00:00:00Z`);
    const end = Date.parse(`${checkout}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)
        || !Number.isFinite(start) || !Number.isFinite(end)
        || new Date(start).toISOString().slice(0, 10) !== checkin
        || new Date(end).toISOString().slice(0, 10) !== checkout
        || start < Date.parse(new Date().toISOString().slice(0, 10)) || end <= start) throw fail('invalid_dates');
    if (!ziina.SUPPORTED_CURRENCIES.has(input.currency)) throw fail('unsupported_currency');
    const amountMinor = ziina.minorUnits(input.total, input.currency);
    const occupancy = input.guests;
    const rooms = input.rooms;
    if (!Array.isArray(occupancy) || !Array.isArray(rooms) || occupancy.length === 0
        || occupancy.length !== rooms.length || occupancy.length > 9) throw fail('invalid_occupancy');
    const guests = occupancy.map((group, index) => {
        if (!group || !Number.isInteger(group.adults) || group.adults < 1 || group.adults > 6
            || !Array.isArray(group.children) || group.children.length > 4
            || group.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) throw fail('invalid_occupancy');
        const travelers = rooms[index]?.guests;
        if (!Array.isArray(travelers) || travelers.length !== group.adults + group.children.length) throw fail('invalid_travelers');
        const adults = travelers.filter(person => person?.is_child !== true);
        const children = travelers.filter(person => person?.is_child === true).map(person => person.age).sort((a, b) => a - b);
        if (adults.length !== group.adults || JSON.stringify(children) !== JSON.stringify([...group.children].sort((a, b) => a - b))) throw fail('invalid_travelers');
        return { adults: group.adults, children: [...group.children].sort((a, b) => a - b) };
    });
    const holder = input.guest || {};
    const firstName = guestName(holder.firstName, 'first_name');
    const lastName = guestName(holder.lastName, 'last_name');
    const email = text(holder.email, 'email', 254);
    const phone = text(holder.phone, 'phone', 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+[1-9]\d{6,19}$/.test(phone)) throw fail('invalid_contact');
    const bookingRooms = rooms.map((room, roomIndex) => ({ guests: room.guests.map((person, personIndex) => ({
        first_name: guestName(roomIndex === 0 && personIndex === 0 ? firstName : person.firstName, 'first_name'),
        last_name: guestName(roomIndex === 0 && personIndex === 0 ? lastName : person.lastName, 'last_name'),
        is_child: person.is_child === true,
        ...(person.is_child === true ? { age: person.age } : {}),
        ...(person.gender ? { gender: person.gender } : {})
    })) }));
    return { hid, book_hash: bookHash, roomName, hotelName: text(input.hotelName || 'Hotel', 'hotel_name', 256), checkin, checkout, currency: input.currency, amount_minor: amountMinor,
        guests, user: { email, phone, ...(holder.specialRequests ? { comment: text(holder.specialRequests, 'comment', 1000) } : {}) }, rooms: bookingRooms };
}

// Card and wallets go through Ziina; "tabby" pays in four with Tabby (AED only).
function paymentMethod(value) {
    if (value === undefined || value === null || value === '' || value === 'ziina' || value === 'card') return 'ziina';
    if (value === 'tabby') return 'tabby';
    throw fail('invalid_payment_method');
}

// The hotel's own address stands in for Tabby's shipping address (nothing is shipped).
async function hotelForTabby(details) {
    try {
        const Hotel = require('../models/Hotel');
        const hotel = await Hotel.findOne({ provider: 'ratehawk', hid: String(details.hid) }).select('name address city countryCode').lean();
        return { hid: details.hid, name: hotel?.name || details.hotelName, address: hotel?.address, city: hotel?.city, countryCode: hotel?.countryCode };
    } catch {
        return { hid: details.hid, name: details.hotelName };
    }
}

async function registeredSince(identity) {
    try {
        const User = mongoose.models.User;
        if (User && mongoose.isValidObjectId(identity.subject)) {
            const user = await User.findById(identity.subject).select('createdAt').lean();
            if (user?.createdAt && Number.isFinite(new Date(user.createdAt).getTime())) return new Date(user.createdAt).toISOString();
        }
    } catch { /* Fall back to now: the account is at least this old. */ }
    return new Date().toISOString();
}

/*
 * Tabby session for a prepared booking. No money can move until the guest completes Tabby's own
 * checkout on the link returned here, so a failed or rejected session simply ends this attempt
 * (payment_failed) and the guest may pay another way.
 */
async function createTabbyPayment(record, details, identity, language) {
    let session;
    try {
        const [hotel, since] = await Promise.all([hotelForTabby(details), registeredSince(identity)]);
        const returnUrls = Object.fromEntries([['success', 'success'], ['cancel', 'cancel'], ['failure', 'failed']]
            .map(([key, result]) => [key, ziina.returnUrl(process.env.FRONTEND_URL, result, record.reference, record.app_return || null)]));
        const guest = details.rooms[0].guests[0];
        session = await tabby.createSession({ reference: record.reference, amount: record.amount_minor, language,
            buyer: { name: `${guest.first_name} ${guest.last_name}`, email: details.user.email, phone: details.user.phone },
            registeredSince: since, hotel, roomName: details.roomName,
            stay: { checkin: details.checkin, checkout: details.checkout, rooms: details.rooms.length },
            passengers: details.rooms.flatMap(room => room.guests).filter(person => !person.is_child), returnUrls });
        if (session.status === 'created' && session.test !== record.tabby_test) throw new Error('tabby_environment_mismatch');
    } catch {
        await CheckoutAttempt.updateOne({ _id: record._id, state: 'intent_creating' }, {
            $set: { state: 'payment_failed', error: 'tabby_unavailable', next_check_at: null }, $unset: { encrypted_details: '' } });
        const current = await CheckoutAttempt.findById(record._id).lean();
        if (!current) throw fail('checkout_unavailable', 503);
        return checkoutResponse(current);
    }
    const fields = session.status === 'rejected'
        ? { $set: { state: 'payment_failed', error: `tabby_${session.rejectionReason}`, tabby_session_id: session.sessionId,
            tabby_payment_id: session.paymentId, next_check_at: null }, $unset: { encrypted_details: '' } }
        : { $set: { state: 'awaiting_payment', tabby_session_id: session.sessionId, tabby_payment_id: session.paymentId,
            redirect_url: session.webUrl, next_check_at: new Date(Date.now() + 5000) } };
    const updated = await CheckoutAttempt.findOneAndUpdate({ _id: record._id, state: 'intent_creating' }, fields, { new: true }).lean();
    if (!updated) throw fail('checkout_state_conflict', 409);
    return checkoutResponse(updated);
}

function verifyRateIdentity(info, details) {
    const original = info?.original_request_params;
    const hotels = info?.hotels;
    if (!original || original.checkin !== details.checkin || original.checkout !== details.checkout
        || !Array.isArray(original.guests) || original.guests.length !== details.guests.length
        || original.guests.some((room, index) => room.adults !== details.guests[index].adults
            || !Array.isArray(room.children)
            || JSON.stringify([...room.children].sort((left, right) => left - right)) !== JSON.stringify(details.guests[index].children))
        || !Array.isArray(hotels) || hotels.length !== 1 || Number(hotels[0].hid) !== details.hid
        || !Array.isArray(hotels[0].rates) || hotels[0].rates.length !== 1
        || hotels[0].rates[0].book_hash !== details.book_hash
        || hotels[0].rates[0].room_name !== details.roomName) throw fail('offer_identity_mismatch', 409);
    payment.resolveValidatedPayment(info, {
        hid: details.hid, total: ziina.majorUnits(details.amount_minor, details.currency), currency: details.currency, roomName: details.roomName
    });
}

function publicView(record) {
    return {
        reference: record.reference,
        status: record.state,
        confirmed: record.state === 'booking_confirmed',
        ...(record.payment_verified_at ? { payment_verified: true } : {}),
        ...(record.state === 'booking_confirmed' ? {
            voucher_delivery: record.notification_status === 'sent' ? 'sent'
                : ['review', 'unknown'].includes(record.notification_status) ? 'review' : 'pending'
        } : {}),
        ...(record.state === 'booking_confirmed' ? { supplier_reference: record.partner_order_id } : {}),
        ...(record.action_required ? { action_required: record.action_required } : {}),
        ...(record.payment_provider === 'tabby' ? { payment_method: 'tabby' } : {}),
        ...(record.state === 'payment_failed' && /^tabby_[a-z_]{1,60}$/.test(record.error || '') ? { payment_error: record.error } : {})
    };
}

function accessToken(record) {
    return crypto.createHmac('sha256', encryptionKey())
        .update(`checkout-access-v1:${record.reference}:${record.request_hash}`).digest('hex');
}

function checkoutResponse(record, { recovery = false } = {}) {
    if (!recovery && record.state === 'preflight_failed') {
        throw fail(record.error === 'rate_changed' ? 'rate_changed' : 'supplier_preflight_failed', 409);
    }
    return {
        ...publicView(record), access_token: accessToken(record),
        ...(record.state === 'awaiting_payment' && record.redirect_url
            && (!recovery || new Date(record.payment_expires_at).getTime() > Date.now())
            ? { payment_url: record.redirect_url } : {})
    };
}

function requireIdentity(identity) {
    if (!identity || identity.role !== 'user' || typeof identity.subject !== 'string' || !identity.subject
        || identity.subject.length > 254 || !/^[a-z0-9:_-]{1,100}$/i.test(identity.realm || '')
        || process.env.RIMAL_AUTH_REALM && identity.realm !== process.env.RIMAL_AUTH_REALM) throw fail('unauthorized', 401);
}

async function recoverCheckout(idempotencyKey, identity) {
    requireIdentity(identity);
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw fail('invalid_idempotency_key');
    if (mongoose.connection.readyState !== 1) throw fail('checkout_unavailable', 503);
    const processId = crypto.createHmac('sha256', encryptionKey()).update(idempotencyKey).digest('hex');
    // Read-only recovery must never create a form or intent, or require the
    // original guest details to be stored on the device. Scope the database
    // lookup itself so another owner/realm is indistinguishable from absence.
    const record = await CheckoutAttempt.findOne({ _id: processId,
        ownerSubject: identity.subject, realm: identity.realm }).lean();
    if (!record) return { found: false };
    return { found: true, ...checkoutResponse(record, { recovery: true }) };
}

async function getCheckout(reference, token) {
    if (typeof reference !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(reference)
        || typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) throw fail('checkout_not_found', 404);
    if (mongoose.connection.readyState !== 1) throw fail('checkout_unavailable', 503);
    const record = await CheckoutAttempt.findOne({ reference }).lean();
    if (!record || !crypto.timingSafeEqual(Buffer.from(accessToken(record), 'hex'), Buffer.from(token, 'hex'))) {
        throw fail('checkout_not_found', 404);
    }
    return { ...publicView(record),
        ...(record.state === 'awaiting_payment' && record.redirect_url
            && new Date(record.payment_expires_at).getTime() > Date.now()
            ? { payment_url: record.redirect_url } : {}) };
}

async function createCheckout(input, idempotencyKey, userIp, identity) {
    if (!payment.isCheckoutReady() || mongoose.connection.readyState !== 1) throw fail('checkout_unavailable', 503);
    requireIdentity(identity);
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw fail('invalid_idempotency_key');
    const details = normalizedCheckout(input);
    const method = paymentMethod(input.payment_method);
    const appReturn = require('./appPaymentReturn').appReturnScheme(input.app_return);
    const hash = value => crypto.createHmac('sha256', encryptionKey()).update(value).digest('hex');
    const processId = hash(idempotencyKey);
    const requestHash = hash(JSON.stringify({ details, ownerSubject: identity.subject, realm: identity.realm,
        ...(input.payment_quote ? { payment_quote: input.payment_quote } : {}), ...(appReturn ? { app_return: appReturn } : {}),
        ...(method === 'tabby' ? { payment_method: 'tabby' } : {}) }));
    let record = await CheckoutAttempt.findById(processId).lean();
    if (record) {
        if (record.request_hash !== requestHash) throw fail('checkout_conflict', 409);
        return checkoutResponse(record);
    }
    const charge = input.payment_quote
        ? require('./checkoutCurrencyService').readQuote(input.payment_quote, details, identity)
        : { amount_minor: details.amount_minor, currency: details.currency };
    if (method === 'tabby') {
        if (!tabby.isTabbyReady()) throw fail('tabby_unavailable', 503);
        if (charge.currency !== 'AED') throw fail('tabby_requires_aed', 409);
    }
    const reference = crypto.randomUUID();
    try {
        record = await CheckoutAttempt.create({ _id: processId, reference, request_hash: requestHash,
            ownerSubject: identity.subject, realm: identity.realm, ...(appReturn ? { app_return: appReturn } : {}),
            payment_provider: method, ...(method === 'tabby' ? { tabby_test: tabby.settings().test } : {}),
            encrypted_details: encryptDetails(details), state: 'preparing', next_check_at: new Date(Date.now() + 30000) });
    } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicate = await CheckoutAttempt.findById(processId).lean();
        if (duplicate?.request_hash === requestHash) return checkoutResponse(duplicate);
        throw fail('checkout_conflict', 409);
    }
    try {
        const rateInfo = ratehawk.getCheckoutRateContext(input.prebook_context || input.offer_context, details.book_hash);
        verifyRateIdentity(rateInfo, details);
        // Hotel prebook exchanges an h- hash for a p- hash. The latter is
        // already ready for booking/form and cannot be prebooked again.
        if (details.book_hash.startsWith('p-') && rateInfo.context_kind !== 'prebook') throw fail('invalid_offer_context', 409);
        const prebook = rateInfo.context_kind === 'prebook'
            ? rateInfo : await ratehawk.validatePrebookRate(details.book_hash);
        const validated = payment.resolveValidatedPayment(prebook, {
            hid: details.hid, total: ziina.majorUnits(details.amount_minor, details.currency), currency: details.currency, roomName: details.roomName
        });
        const form = await booking.createProcess({ book_hash: validated.book_hash, language: 'en', user_ip: userIp, guests: details.guests }, reference);
        if (form.status !== 'form_ready') throw fail('booking_form_unavailable', 409);
        const selected = (form.payment_types || []).find(option => {
            if (option.type !== 'deposit' || option.currency_code !== validated.currency
                || option.is_need_credit_card_data !== false) return false;
            try { return ziina.minorUnits(option.amount, option.currency_code) === ziina.minorUnits(validated.amount, validated.currency); } catch { return false; }
        });
        if (!selected) throw fail('unsupported_supplier_payment', 409);
        const paymentType = { type: selected.type, amount: selected.amount, currency_code: selected.currency_code };
        const prebookSnapshot = require('./ratehawkBookingSnapshot').createSnapshot(prebook, details, paymentType);
        ratehawk.buildBookingFinish({ user: details.user, rooms: details.rooms, payment_type: paymentType }, {
            partner_order_id: form.partner_order_id, payment_types: form.payment_types,
            is_gender_specification_required: form.is_gender_specification_required
        });
        if (new Date(form.form_expires_at).getTime() <= Date.now() + 25 * 60 * 1000) throw fail('booking_form_expired', 409);
        if (input.payment_quote && charge.expires_at <= Date.now()) throw fail('checkout_quote_expired_or_changed', 409);
        record = await CheckoutAttempt.findOneAndUpdate({ _id: processId, state: 'preparing' }, { $set: {
            state: 'intent_creating', amount_minor: charge.amount_minor, currency: charge.currency,
            ...(input.payment_quote ? { payment_quote: charge } : {}),
            ziina_test: process.env.ZIINA_TEST_MODE === 'true', booking_process_id: form.process_id,
            partner_order_id: form.partner_order_id,
            supplier_identity: payment.supplierIdentity(),
            supplier_payment: paymentType, prebook_snapshot: prebookSnapshot, form_expires_at: form.form_expires_at,
            payment_expires_at: new Date(Date.now() + 20 * 60 * 1000)
        } }, { new: true }).lean();
        if (!record) throw fail('checkout_state_conflict', 409);
    } catch (error) {
        const code = ['RATE_CHANGED', 'rate_not_found', 'rate_changed'].includes(error.code || error.message)
            ? 'rate_changed' : 'supplier_preflight_failed';
        await CheckoutAttempt.updateOne({ _id: processId, state: 'preparing' }, {
            $set: { state: 'preflight_failed', error: code, next_check_at: null }, $unset: { encrypted_details: '' }
        });
        throw fail(['RATE_CHANGED', 'rate_not_found'].includes(error.message) ? 'rate_changed' : error.code || 'supplier_preflight_failed', 409);
    }
    if (record.payment_provider === 'tabby') return createTabbyPayment(record, details, identity, input.language === 'en' ? 'en' : 'ar');
    try {
        const intent = await ziina.createIntent({ amount: ziina.majorUnits(record.amount_minor, record.currency), currency: record.currency, reference,
            test: record.ziina_test, frontendUrl: process.env.FRONTEND_URL, accountId: process.env.ZIINA_ACCOUNT_ID, appReturn: record.app_return || null });
        const updated = await CheckoutAttempt.findOneAndUpdate({ _id: processId, state: 'intent_creating' }, { $set: {
            ziina_intent_id: intent.id, ziina_account_id: intent.accountId, ziina_operation_id: intent.operationId,
            redirect_url: intent.redirectUrl, state: 'awaiting_payment',
            next_check_at: new Date(Date.now() + 5000)
        } }, { new: true }).lean();
        if (!updated) throw fail('checkout_state_conflict', 409);
        return checkoutResponse(updated);
    } catch {
        await CheckoutAttempt.updateOne({ _id: processId, state: 'intent_creating' }, { $set: {
            state: 'intent_unknown', error: 'ziina_intent_unknown', action_required: 'reconcile_payment_intent', next_check_at: null
        } });
        const current = await CheckoutAttempt.findById(processId).lean();
        if (!current) throw fail('checkout_unavailable', 503);
        return checkoutResponse(current);
    }
}

module.exports = { createCheckout, recoverCheckout, getCheckout, normalizedCheckout, verifyRateIdentity, publicView, encryptDetails, decryptDetails };
