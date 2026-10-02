const crypto = require('node:crypto');
const { isIP } = require('node:net');
const mongoose = require('mongoose');
const AffiliateBookingProcess = require('../models/AffiliateBookingProcess');
const AffiliateBookingRecord = require('../models/AffiliateBookingRecord');
const client = require('./ratehawkAffiliateClient');
const logger = require('./loggerService');

const ACTIVE_STATES = ['finishing', 'processing'];
const FINAL_ERRORS = new Set([
    '3ds', 'block', 'book_limit', 'booking_finish_did_not_succeed', 'charge', 'decoding_json',
    'endpoint_exceeded_limit', 'endpoint_not_active', 'endpoint_not_found', 'incorrect_credentials',
    'invalid_auth_header', 'invalid_params', 'lock', 'no_auth_header', 'not_allowed',
    'not_allowed_host', 'order_not_found', 'overdue_debt', 'provider', 'soldout', 'unexpected_method'
]);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function enabled() {
    return process.env.RATEHAWK_AFFILIATE_BOOKING_ENABLED === 'true';
}

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function encryptionKey() {
    const raw = process.env.AFFILIATE_BOOKING_ENCRYPTION_KEY || '';
    if (!/^[a-f\d]{64}$/i.test(raw) || raw === process.env.PAYMENT_BOOKING_ENCRYPTION_KEY
        || raw === process.env.RATEHAWK_BOOKING_TOKEN || raw === process.env.AFFILIATE_BOOKING_TOKEN) {
        throw fail('affiliate_booking_encryption_unavailable', 503);
    }
    return Buffer.from(raw, 'hex');
}

function contractIdentity() {
    const config = client.getConfiguration();
    if (!config.configured) throw fail('affiliate_supplier_credentials_unavailable', 503);
    return sha256(`${config.baseUrl}|${config.keyId}`);
}

function requireSearchEnabled() {
    if (process.env.RATEHAWK_AFFILIATE_ENABLED !== 'true') throw fail('affiliate_search_disabled', 503);
    encryptionKey();
    return contractIdentity();
}

function requireBookingEnabled() {
    if (process.env.RATEHAWK_AFFILIATE_BOOKING_ENABLED !== 'true') throw fail('affiliate_booking_disabled', 503);
    encryptionKey();
    return contractIdentity();
}

function requireConfigured() {
    encryptionKey();
    return contractIdentity();
}

function requireExistingProcessAccess() {
    return requireConfigured();
}

function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') };
}

function decrypt(value) {
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(value.tag, 'hex'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    } catch {
        throw fail('affiliate_booking_data_unavailable', 503);
    }
}

function canonicalAmount(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
    const normalizedFraction = fraction.replace(/0+$/, '');
    return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function requiredText(value, field, max = 256) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`invalid_${field}`);
    return value.trim();
}

function normalizeOccupancy(guests) {
    if (!Array.isArray(guests) || !guests.length || guests.length > 9) throw fail('invalid_occupancy');
    return guests.map(room => {
        if (!room || !Number.isInteger(room.adults) || room.adults < 1 || room.adults > 6
            || !Array.isArray(room.children) || room.children.length > 4
            || room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) throw fail('invalid_occupancy');
        return { adults: room.adults, children: [...room.children].sort((a, b) => a - b) };
    });
}

function normalizeRooms(occupancy, rooms) {
    if (!Array.isArray(rooms) || rooms.length !== occupancy.length) throw fail('invalid_travelers');
    return rooms.map((room, index) => {
        const expected = occupancy[index];
        if (!Array.isArray(room?.guests) || room.guests.length !== expected.adults + expected.children.length) {
            throw fail('invalid_travelers');
        }
        const guests = room.guests.map(person => {
            if (!person || typeof person !== 'object' || typeof person.is_child !== 'boolean') throw fail('invalid_traveler');
            const guest = {
                first_name: requiredText(person.first_name || person.firstName, 'guest_first_name', 100),
                last_name: requiredText(person.last_name || person.lastName, 'guest_last_name', 100),
                is_child: person.is_child
            };
            if (person.is_child) {
                if (!Number.isInteger(person.age) || person.age < 0 || person.age > 17) throw fail('invalid_child_age');
                guest.age = person.age;
            }
            if (person.gender !== undefined) {
                if (!['male', 'female'].includes(person.gender)) throw fail('invalid_gender');
                guest.gender = person.gender;
            }
            return guest;
        });
        const adults = guests.filter(person => !person.is_child).length;
        const children = guests.filter(person => person.is_child).map(person => person.age).sort((a, b) => a - b);
        if (adults !== expected.adults || JSON.stringify(children) !== JSON.stringify(expected.children)) throw fail('invalid_travelers');
        return { guests };
    });
}

function normalizeDetails(input = {}) {
    const hid = Number(input.hid);
    if (!Number.isSafeInteger(hid) || hid < 1) throw fail('invalid_hotel');
    const book_hash = requiredText(input.book_hash, 'book_hash', 1024);
    const roomName = requiredText(input.roomName, 'room_name', 256);
    const checkin = requiredText(input.checkin, 'checkin', 10);
    const checkout = requiredText(input.checkout, 'checkout', 10);
    const start = Date.parse(`${checkin}T00:00:00Z`);
    const end = Date.parse(`${checkout}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)
        || !Number.isFinite(start) || !Number.isFinite(end)
        || new Date(start).toISOString().slice(0, 10) !== checkin
        || new Date(end).toISOString().slice(0, 10) !== checkout
        || start < Date.parse(new Date().toISOString().slice(0, 10)) || end <= start) throw fail('invalid_dates');
    const email = requiredText(input.user?.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('invalid_email');
    const phone = requiredText(input.user?.phone, 'phone', 40);
    const comment = input.user?.comment ? requiredText(input.user.comment, 'comment', 1000) : undefined;
    const expected = { amount: canonicalAmount(input.expected_price), currency: String(input.expected_currency || '') };
    if (!expected.amount || !/^[A-Z]{3}$/.test(expected.currency)) throw fail('invalid_expected_price');
    const guests = normalizeOccupancy(input.guests);
    const rooms = normalizeRooms(guests, input.rooms);
    return {
        hid, book_hash, roomName, checkin, checkout, guests, rooms, expected,
        hotelName: requiredText(input.hotelName, 'hotel_name', 200),
        meal: typeof input.meal === 'string' ? input.meal.slice(0, 100) : '',
        language: ['ar', 'en', 'es'].includes(input.language) ? input.language : 'en',
        user: { email, phone, ...(comment ? { comment } : {}) }
    };
}

function paymentForHotel(rate) {
    return rate?.payment_options?.payment_types?.find(payment => payment?.type === 'hotel') || null;
}

function showQuote(payment) {
    const amount = canonicalAmount(payment?.show_amount ?? payment?.amount);
    const currency = payment?.show_currency_code ?? payment?.currency_code;
    return amount && /^[A-Z]{3}$/.test(String(currency || '')) ? { amount, currency: String(currency) } : null;
}

function signOffer(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', encryptionKey()).update(`affiliate-offer-v1:${encoded}`).digest('base64url');
    return `${encoded}.${signature}`;
}

function verifyOffer(token, details, identity) {
    if (typeof token !== 'string' || token.length > 8192) throw fail('invalid_affiliate_offer', 409);
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) throw fail('invalid_affiliate_offer', 409);
    const expectedSignature = crypto.createHmac('sha256', encryptionKey()).update(`affiliate-offer-v1:${encoded}`).digest();
    const suppliedSignature = Buffer.from(signature, 'base64url');
    if (suppliedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) {
        throw fail('invalid_affiliate_offer', 409);
    }
    let offer;
    try { offer = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
    catch { throw fail('invalid_affiliate_offer', 409); }
    if (!offer || offer.contract_identity !== identity || !Number.isFinite(offer.expires_at) || Date.now() >= offer.expires_at
        || offer.hid !== details.hid || offer.book_hash !== details.book_hash || offer.room_name !== details.roomName
        || offer.meal !== details.meal || offer.checkin !== details.checkin || offer.checkout !== details.checkout
        || canonicalAmount(offer.expected_price) !== details.expected.amount || offer.expected_currency !== details.expected.currency
        || JSON.stringify(offer.guests) !== JSON.stringify(details.guests)) throw fail('invalid_affiliate_offer', 409);
    return offer;
}

function statusToken(record) {
    return crypto.createHmac('sha256', encryptionKey())
        .update(`affiliate-booking-v1:${record.reference}:${record.request_hash}`).digest('hex');
}

function tokenMatches(record, token) {
    if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) return false;
    return crypto.timingSafeEqual(Buffer.from(statusToken(record), 'hex'), Buffer.from(token, 'hex'));
}

function publicView(record, includeToken = false) {
    return {
        process_id: record._id,
        reference: record.reference,
        status: record.state,
        confirmed: record.state === 'confirmed',
        ...(record.state === 'confirmed' ? { supplier_reference: record.partner_order_id } : {}),
        ...(record.error ? { error: record.error } : {}),
        ...(record.state === 'processing' && record.booking_deadline_at
            ? { timed_out: Date.now() >= new Date(record.booking_deadline_at).getTime() } : {}),
        ...(includeToken ? { access_token: statusToken(record) } : {})
    };
}

function transient(result, error) {
    return result?.httpStatus >= 500 || ['timeout', 'unknown'].includes(result?.error)
        || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code);
}

function dataOf(result) {
    return result?.data?.data !== undefined ? result.data.data : result?.data;
}

function buildFinish(details, form) {
    if (form.is_gender_specification_required && details.rooms.some(room => room.guests.some(guest => !guest.gender))) {
        throw fail('gender_required');
    }
    const payment = form.payment_types?.find(item => item.type === 'hotel' && item.is_need_credit_card_data !== true);
    if (!payment) throw fail('affiliate_payment_unavailable', 409);
    return {
        language: details.language,
        partner: { partner_order_id: form.partner_order_id },
        user: { email: details.user.email, phone: details.user.phone, ...(details.user.comment ? { comment: details.user.comment } : {}) },
        rooms: details.rooms,
        payment_type: { type: payment.type, amount: payment.amount, currency_code: payment.currency_code }
    };
}

async function processForm(processId) {
    const now = new Date();
    const leaseId = crypto.randomUUID();
    const record = await AffiliateBookingProcess.findOneAndUpdate({ _id: processId, state: 'creating',
        $or: [{ lease_until: { $exists: false } }, { lease_until: { $lte: now } }] },
    { $set: { lease_id: leaseId, lease_until: new Date(now.getTime() + 120000) } }, { new: true }).lean();
    if (!record) {
        const current = await AffiliateBookingProcess.findById(processId).lean();
        if (!current) throw fail('affiliate_booking_not_found', 404);
        return publicView(current, true);
    }
    try {
        if (contractIdentity() !== record.contract_identity) throw fail('affiliate_contract_changed', 503);
        const details = decrypt(record.encrypted_details);
        const hp = await client.hotelPage({ hid: details.hid, checkin: details.checkin, checkout: details.checkout,
            residency: details.residency, language: details.search_language, currency: details.search_currency, guests: details.guests });
        if (!hp.ok) throw fail(hp.error || 'affiliate_hotelpage_unavailable', 502);
        const hotel = dataOf(hp)?.hotels?.find(item => Number(item.hid) === details.hid);
        const rate = hotel?.rates?.find(item => item.book_hash === details.book_hash && item.room_name === details.roomName
            && (item.meal || '') === details.meal);
        const hpPayment = paymentForHotel(rate);
        if (!rate || !hpPayment || hpPayment.is_need_credit_card_data === true
            || !samePrice(showQuote(hpPayment), details.expected)) throw fail('affiliate_price_changed', 409);

        const prebook = await client.prebook({ hash: details.book_hash, price_increase_percent: 0 });
        if (!prebook.ok) {
            const retryable = transient(prebook) || prebook.httpStatus >= 500;
            throw fail(prebook.error || 'affiliate_prebook_unavailable', retryable ? 502 : 409);
        }
        const prebookHotel = dataOf(prebook)?.hotels?.find(item => Number(item.hid) === details.hid);
        const matchingRates = (prebookHotel?.rates || []).filter(item =>
            item.room_name === details.roomName && (item.meal || '') === details.meal);
        const matchingHashRates = rate.match_hash
            ? matchingRates.filter(item => item.match_hash === rate.match_hash) : [];
        const currentRate = matchingHashRates.length === 1 ? matchingHashRates[0]
            : matchingRates.length === 1 ? matchingRates[0] : null;
        const currentPayment = paymentForHotel(currentRate);
        const quote = showQuote(currentPayment);
        if (!currentRate || !currentPayment || currentPayment.is_need_credit_card_data === true
            || !samePrice(quote, details.expected)) throw fail('affiliate_price_changed', 409);

        let form;
        const attemptedIds = Array.isArray(record.attempt_order_ids) ? record.attempt_order_ids.length : 0;
        const remainingAttempts = Math.max(0, 10 - attemptedIds);
        for (let attempt = 0; attempt < remainingAttempts; attempt += 1) {
            const partnerOrderId = crypto.randomUUID();
            const claimed = await AffiliateBookingProcess.findOneAndUpdate({ _id: processId, state: 'creating', lease_id: leaseId }, {
                $set: { partner_order_id: partnerOrderId, hotel: {
                    hid: details.hid, name: details.hotelName, room_name: details.roomName, meal: details.meal,
                    expected_price: details.expected.amount, expected_currency: details.expected.currency,
                    supplier_price: canonicalAmount(currentPayment.amount), supplier_currency: currentPayment.currency_code
                }, book_hash: currentRate.book_hash }, $push: { attempt_order_ids: partnerOrderId }
            }, { new: true }).lean();
            if (!claimed) throw fail('affiliate_booking_conflict', 409);
            let result;
            try {
                result = await client.bookingForm({ book_hash: currentRate.book_hash, partner_order_id: partnerOrderId,
                    language: details.search_language, user_ip: details.user_ip });
            } catch (error) {
                if (!transient(null, error) || attempt === remainingAttempts - 1) throw error;
                continue;
            }
            if (result.ok && result.httpStatus < 300) {
                const data = dataOf(result);
                if (!data?.order_id || data.partner_order_id !== partnerOrderId || !Array.isArray(data.payment_types)) {
                    throw fail('invalid_affiliate_booking_form', 502);
                }
                if (!data.payment_types.some(payment => payment.type === 'hotel' && payment.is_need_credit_card_data !== true
                    && payment.currency_code === currentPayment.currency_code
                    && canonicalAmount(payment.amount) === canonicalAmount(currentPayment.amount))) {
                    throw fail('affiliate_payment_unavailable', 409);
                }
                form = {
                    partner_order_id: partnerOrderId, order_id: data.order_id, item_id: data.item_id,
                    payment_types: data.payment_types, is_gender_specification_required: data.is_gender_specification_required === true,
                    upsell_data: Array.isArray(data.upsell_data) ? data.upsell_data : []
                };
                if (form.is_gender_specification_required) throw fail('gender_required', 409);
                break;
            }
            if (!(transient(result) || ['double_booking_form', 'duplicate_reservation'].includes(result.error))
                || attempt === remainingAttempts - 1) {
                throw fail(result.error || 'affiliate_booking_form_unavailable', result.httpStatus === 429 ? 429 : 502);
            }
        }
        if (!form) throw fail('affiliate_booking_form_unavailable', 502);
        const updated = await AffiliateBookingProcess.findOneAndUpdate({ _id: processId, state: 'creating', lease_id: leaseId }, {
            $set: { state: 'form_ready', form, form_expires_at: new Date(Date.now() + 60 * 60 * 1000), next_check_at: null },
            $unset: { lease_id: '', lease_until: '', error: '' }
        }, { new: true }).lean();
        if (!updated) throw fail('affiliate_booking_conflict', 409);
        return publicView(updated, true);
    } catch (error) {
        const code = /^[a-z][a-z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'affiliate_booking_unavailable';
        const latest = await AffiliateBookingProcess.findById(processId).lean();
        const terminal = [400, 409, 429].includes(error.httpStatus) || code === 'affiliate_contract_changed'
            || (latest?.attempt_order_ids?.length || 0) >= 10;
        await AffiliateBookingProcess.updateOne({ _id: processId, state: 'creating', lease_id: leaseId }, {
            $set: { state: terminal ? (code.includes('price') ? 'price_changed' : 'failed') : 'creating', error: code,
                next_check_at: terminal ? null : new Date(Date.now() + 5000) },
            $unset: { lease_id: '', lease_until: '', ...(terminal ? { encrypted_details: '' } : {}) }
        });
        throw fail(code, error.httpStatus || 502);
    }
}

async function createProcess(input, idempotencyKey, userIp) {
    const identity = requireBookingEnabled();
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw fail('invalid_idempotency_key');
    if (typeof userIp !== 'string' || !isIP(userIp)) throw fail('invalid_user_ip');
    const details = normalizeDetails(input);
    details.user_ip = userIp;
    const offer = verifyOffer(input.affiliate_offer_token, details, identity);
    details.hotelName = requiredText(offer.hotel_name, 'hotel_name', 200);
    if (!/^[a-z]{2}$/.test(offer.residency) || !/^[A-Z]{3}$/.test(offer.search_currency)
        || !['ar', 'en'].includes(offer.search_language)) throw fail('invalid_affiliate_offer', 409);
    details.residency = offer.residency;
    details.search_language = offer.search_language;
    details.search_currency = offer.search_currency;
    const requestIdentity = { ...details, contract_identity: identity };
    delete requestIdentity.user_ip;
    const requestHash = crypto.createHmac('sha256', encryptionKey())
        .update(JSON.stringify(requestIdentity)).digest('hex');
    const processId = sha256(`affiliate-v1:${idempotencyKey}`);
    let record = await AffiliateBookingProcess.findById(processId).lean();
    if (record) {
        if (record.request_hash !== requestHash || record.contract_identity !== identity) throw fail('idempotency_conflict', 409);
        if (record.state === 'creating') return processForm(processId);
        return publicView(record, true);
    }
    try {
        await AffiliateBookingProcess.create({
            _id: processId, reference: crypto.randomUUID(), request_hash: requestHash, contract_identity: identity,
            book_hash: details.book_hash, state: 'creating', hotel: {
                hid: details.hid, name: details.hotelName, room_name: details.roomName,
                expected_price: details.expected.amount, expected_currency: details.expected.currency
            }, expected_price: details.expected.amount, expected_currency: details.expected.currency,
            encrypted_details: encrypt(details), attempt_order_ids: [], next_check_at: new Date()
        });
    } catch (error) {
        if (error.code !== 11000) throw error;
        record = await AffiliateBookingProcess.findById(processId).lean();
        if (!record || record.request_hash !== requestHash) throw fail('idempotency_conflict', 409);
    }
    return processForm(processId);
}

function finishPayload(details, form) {
    if (form.is_gender_specification_required && details.rooms.some(room => room.guests.some(guest => !guest.gender))) {
        throw fail('gender_required');
    }
    const payment = form.payment_types?.find(item => item.type === 'hotel' && item.is_need_credit_card_data !== true);
    if (!payment) throw fail('affiliate_payment_unavailable', 409);
    return {
        language: details.search_language,
        partner: { partner_order_id: form.partner_order_id },
        user: { email: details.user.email, phone: details.user.phone,
            ...(details.user.comment ? { comment: details.user.comment } : {}) },
        rooms: details.rooms,
        payment_type: { type: payment.type, amount: payment.amount, currency_code: payment.currency_code }
    };
}

async function finishProcess(processId, token) {
    requireConfigured();
    const record = typeof processId === 'string' && /^[a-f\d]{64}$/.test(processId)
        ? await AffiliateBookingProcess.findById(processId).lean() : null;
    if (!record || !tokenMatches(record, token)) throw fail('affiliate_booking_not_found', 404);
    if (record.state !== 'form_ready') return publicView(record);
    if (!record.form_expires_at || Date.now() >= new Date(record.form_expires_at).getTime()) {
        await AffiliateBookingProcess.updateOne({ _id: processId, state: 'form_ready' }, {
            $set: { state: 'expired', error: 'booking_form_expired' }, $unset: { encrypted_details: '' }
        });
        throw fail('booking_form_expired', 409);
    }
    if (contractIdentity() !== record.contract_identity) throw fail('affiliate_contract_changed', 503);
    const details = decrypt(record.encrypted_details);
    const payload = finishPayload(details, record.form);
    const finishHash = sha256(JSON.stringify(payload));
    const leaseId = crypto.randomUUID();
    const deadline = Date.now() + Math.min(15 * 60 * 1000, Math.max(5000, Number(process.env.RATEHAWK_AFFILIATE_BOOK_WAIT_MS) || 90000));
    const claimed = await AffiliateBookingProcess.findOneAndUpdate({ _id: processId, state: 'form_ready', finish_hash: { $exists: false } }, {
        $set: { state: 'finishing', finish_hash: finishHash, finish_sent_at: new Date(), booking_deadline_at: new Date(deadline),
            next_check_at: new Date(Date.now() + 5000), lease_id: leaseId, lease_until: new Date(Date.now() + 90000) }
    }, { new: true }).lean();
    if (!claimed) return publicView(await AffiliateBookingProcess.findById(processId).lean());
    let result;
    try { result = await client.bookingFinish(payload); }
    catch (error) {
        if (!transient(null, error)) {
            await AffiliateBookingProcess.updateOne({ _id: processId, state: 'finishing', lease_id: leaseId }, {
                $set: { state: 'failed', error: 'affiliate_booking_finish_failed', next_check_at: null },
                $unset: { lease_id: '', lease_until: '', encrypted_details: '' }
            });
            throw fail('affiliate_booking_finish_failed', 502);
        }
        result = { status: 'processing', error: 'timeout' };
    }
    const finalFailure = FINAL_ERRORS.has(result.error) && result.error !== '3ds';
    const ambiguous = result.ok || transient(result) || result.error === 'double_booking_finish'
        || result.httpStatus === 429 || result.httpStatus >= 500 || result.status === '3ds';
    const state = finalFailure ? 'failed' : ambiguous ? 'processing' : 'failed';
    const error = finalFailure ? result.error : state === 'failed' ? 'affiliate_booking_finish_failed' : undefined;
    await AffiliateBookingProcess.updateOne({ _id: processId, state: 'finishing', lease_id: leaseId }, {
        $set: { state, ...(error ? { error } : {}), next_check_at: state === 'processing' ? new Date(Date.now() + 5000) : null },
        $unset: { lease_id: '', lease_until: '', ...(state === 'failed' ? { encrypted_details: '' } : {}) }
    });
    return publicView(await AffiliateBookingProcess.findById(processId).lean());
}

async function recordBooking(record) {
    if (record.booking_recorded) return;
    const details = decrypt(record.encrypted_details);
    const guestData = encrypt({ user: details.user, rooms: details.rooms });
    await AffiliateBookingRecord.updateOne({ process_id: record._id }, { $setOnInsert: {
        contract_identity: record.contract_identity, process_id: record._id, reference: record.reference,
        partner_order_id: record.partner_order_id, hotel: record.hotel, checkin: details.checkin,
        checkout: details.checkout, guests: details.guests, encrypted_details: guestData,
        status: 'confirmed', confirmed_at: new Date()
    } }, { upsert: true });
    await AffiliateBookingProcess.updateOne({ _id: record._id, state: 'confirmed' }, {
        $set: { booking_recorded: true }, $unset: { encrypted_details: '', form: '', attempt_order_ids: '' }
    });
}

async function checkStatus(processId, token) {
    requireExistingProcessAccess();
    const record = typeof processId === 'string' && /^[a-f\d]{64}$/.test(processId)
        ? await AffiliateBookingProcess.findById(processId).lean() : null;
    if (!record || !tokenMatches(record, token)) throw fail('affiliate_booking_not_found', 404);
    if (!ACTIVE_STATES.includes(record.state)) {
        if (record.state === 'confirmed' && !record.booking_recorded && record.encrypted_details) await recordBooking(record);
        return publicView(await AffiliateBookingProcess.findById(processId).lean());
    }
    if (contractIdentity() !== record.contract_identity) throw fail('affiliate_contract_changed', 503);
    const now = new Date();
    const leaseId = crypto.randomUUID();
    const claimed = await AffiliateBookingProcess.findOneAndUpdate({ _id: processId, state: { $in: ACTIVE_STATES },
        $and: [{ $or: [{ next_check_at: { $lte: now } }, { next_check_at: { $exists: false } }] },
            { $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }] }] },
    { $set: { check_lease_id: leaseId, check_lease_until: new Date(now.getTime() + 35000) } }, { new: true }).lean();
    if (!claimed) return publicView(record);
    let result;
    try { result = await client.bookingFinishStatus({ partner_order_id: claimed.partner_order_id }, { timeout: 30000 }); }
    catch { result = { status: 'processing', error: 'timeout', httpStatus: 503 }; }
    if (result.data?.partner_order_id && result.data.partner_order_id !== claimed.partner_order_id) {
        await AffiliateBookingProcess.updateOne({ _id: processId, state: { $in: ACTIVE_STATES }, check_lease_id: leaseId }, {
            $set: { state: 'failed', error: 'booking_status_order_mismatch', next_check_at: null },
            $unset: { check_lease_id: '', check_lease_until: '', encrypted_details: '' }
        });
        throw fail('booking_status_order_mismatch', 502);
    }
    let state = 'processing';
    let error;
    if (result.ok && result.status === 'ok' && result.httpStatus >= 200 && result.httpStatus < 300) state = 'confirmed';
    else if (result.status === '3ds') { state = 'action_required'; error = 'supplier_action_required'; }
    else if (FINAL_ERRORS.has(result.error)) { state = 'failed'; error = result.error; }
    const deadline = new Date(claimed.booking_deadline_at).getTime();
    if (state === 'processing' && Number.isFinite(deadline) && Date.now() >= deadline) {
        state = 'failed'; error = 'affiliate_booking_timeout';
    }
    await AffiliateBookingProcess.updateOne({ _id: processId, state: { $in: ACTIVE_STATES }, check_lease_id: leaseId }, {
        $set: { state, ...(error ? { error } : {}), next_check_at: state === 'processing' ? new Date(Date.now() + 5000) : null },
        $unset: { check_lease_id: '', check_lease_until: '', ...(error ? {} : { error: '' }) }
    });
    const updated = await AffiliateBookingProcess.findById(processId).lean();
    if (updated.state === 'confirmed') await recordBooking({ ...updated, encrypted_details: record.encrypted_details });
    else if (['failed', 'action_required'].includes(updated.state)) {
        await AffiliateBookingProcess.updateOne({ _id: processId, state: updated.state }, { $unset: { encrypted_details: '' } });
    }
    return publicView(await AffiliateBookingProcess.findById(processId).lean());
}

async function reconcilePendingProcesses() {
    if (mongoose.connection.readyState !== 1) return { checked: 0, failed: 0 };
    const now = new Date();
    const records = await AffiliateBookingProcess.find({
        $and: [
            { $or: [
                { state: { $in: ACTIVE_STATES }, next_check_at: { $lte: now } },
                { state: 'confirmed', booking_recorded: { $ne: true } }
            ] },
            { $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }] }
        ]
    })
        .select('_id').sort({ next_check_at: 1 }).limit(10).lean();
    const results = await Promise.allSettled(records.map(async item => {
        const record = await AffiliateBookingProcess.findById(item._id).lean();
        if (record) return checkStatus(record._id, statusToken(record));
    }));
    return { checked: records.length, failed: results.filter(item => item.status === 'rejected').length };
}

function startStatusWorker() {
    let running = false;
    const timer = setInterval(async () => {
        if (running || mongoose.connection.readyState !== 1) return;
        running = true;
        try { await reconcilePendingProcesses(); }
        catch { logger.error('Affiliate booking reconciliation unavailable'); }
        finally { running = false; }
    }, 5000);
    timer.unref();
    return () => clearInterval(timer);
}

function samePrice(left, right) {
    return Boolean(left && right && left.amount === right.amount && left.currency === right.currency);
}

async function getHotelPageRates(params = {}) {
    const identity = requireSearchEnabled();
    const hid = Number(params.hid);
    if (!Number.isSafeInteger(hid) || hid < 1 || typeof params.checkin !== 'string' || typeof params.checkout !== 'string') {
        throw fail('invalid_hotelpage_criteria');
    }
    const checkinTime = Date.parse(`${params.checkin}T00:00:00Z`);
    const checkoutTime = Date.parse(`${params.checkout}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(params.checkout)
        || !Number.isFinite(checkinTime) || !Number.isFinite(checkoutTime)
        || new Date(checkinTime).toISOString().slice(0, 10) !== params.checkin
        || new Date(checkoutTime).toISOString().slice(0, 10) !== params.checkout || checkoutTime <= checkinTime) {
        throw fail('invalid_hotelpage_criteria');
    }
    const guests = normalizeOccupancy(params.guests);
    const residency = String(params.residency || process.env.RATEHAWK_AFFILIATE_RESIDENCY || 'ae').toLowerCase();
    if (!/^[a-z]{2}$/.test(residency)) throw fail('invalid_residency');
    const language = ['ar', 'en'].includes(params.language) ? params.language : 'en';
    const currency = /^[A-Z]{3}$/.test(params.currency || '') ? params.currency : 'USD';
    const response = await client.hotelPage({ hid, checkin: params.checkin, checkout: params.checkout,
        residency, language, currency, guests });
    if (!response.ok) throw fail(response.error || 'affiliate_hotelpage_unavailable', 502);
    const hotel = dataOf(response)?.hotels?.find(item => Number(item.hid) === hid) || null;
    if (!hotel) return { success: true, hotel: null, rates: [] };
    const hotelName = requiredText(hotel.name, 'hotel_name', 200);
    const hotelId = typeof hotel.id === 'string' ? hotel.id : '';
    const bookingAvailable = enabled() && mongoose.connection.readyState === 1;
    const expiresAt = Date.now() + 25 * 60 * 1000;
    const rates = (hotel.rates || []).flatMap(rate => {
        const payment = paymentForHotel(rate);
        const quote = showQuote(payment);
        if (!rate.book_hash || !rate.room_name || !payment || payment.is_need_credit_card_data === true || !quote) return [];
        const offer = signOffer({
            contract_identity: identity, hid, book_hash: rate.book_hash, room_name: rate.room_name,
            hotel_name: hotelName, hotel_id: hotelId, meal: rate.meal || '', checkin: params.checkin, checkout: params.checkout,
            guests, residency, search_currency: currency, search_language: language,
            expected_price: quote.amount, expected_currency: quote.currency, expires_at: expiresAt
        });
        return [{ ...rate, contract_source: 'affiliate', display_amount: quote.amount,
            display_currency: quote.currency, affiliate_offer_token: offer,
            affiliate_booking_enabled: bookingAvailable }];
    });
    return { success: true, hotel: { ...hotel, rates }, rates };
}

module.exports = {
    enabled,
    requireConfigured,
    getAvailability() {
        const credentials = client.getConfiguration().configured;
        const key = (() => { try { encryptionKey(); return true; } catch { return false; } })();
        const search = process.env.RATEHAWK_AFFILIATE_ENABLED === 'true' && credentials && key;
        const booking = search && enabled() && mongoose.connection.readyState === 1;
        return { search, booking };
    },
    getHotelPageRates,
    createProcess,
    finishProcess,
    checkStatus,
    reconcilePendingProcesses,
    startStatusWorker,
    _test: { canonicalAmount, normalizeOccupancy, normalizeRooms, normalizeDetails, paymentForHotel, showQuote,
        signOffer, verifyOffer, buildFinish, samePrice }
};