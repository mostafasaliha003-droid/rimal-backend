const crypto = require('node:crypto');
const { isIP } = require('node:net');
const mongoose = require('mongoose');
const BookingProcess = require('../models/BookingProcess');
const ratehawk = require('./ratehawkService');
const logger = require('./loggerService');

const IN_FLIGHT = ['finishing', 'processing', '3ds'];
const READY = ['form_ready', 'card_ready'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function fail(code, httpStatus = 400) {
    return Object.assign(new Error(code), { code, httpStatus });
}

function requireEnabled() {
    if (process.env.RATEHAWK_BOOKING_ENABLED !== 'true') throw fail('booking_disabled', 503);
}

function fingerprint(value) {
    const normalize = item => {
        if (Array.isArray(item)) return item.map(normalize);
        if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort()
            .filter(key => item[key] !== undefined).map(key => [key, normalize(item[key])]));
        return item;
    };
    return hash(JSON.stringify(normalize(value)));
}

function safeCode(error, fallback) {
    const code = error?.ratehawkError || error?.code;
    return typeof code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : fallback;
}

function view(record) {
    const final = ['confirmed', 'failed'].includes(record.state);
    return {
        process_id: record._id,
        partner_order_id: record.partner_order_id,
        order_id: record.form?.order_id,
        status: record.state,
        success: record.state === 'confirmed',
        ...(record.form ? { payment_types: record.form.payment_types, is_gender_specification_required: record.form.is_gender_specification_required } : {}),
        ...(record.error ? { error: record.error } : {}),
        ...(record.state === '3ds' ? { data_3ds: record.data_3ds } : {}),
        ...(record.form_expires_at ? { form_expires_at: record.form_expires_at } : {}),
        ...(record.booking_deadline_at ? { booking_deadline_at: record.booking_deadline_at, timed_out: !final && Date.now() >= new Date(record.booking_deadline_at).getTime() } : {}),
        ...(record.next_check_at && !final ? { next_check_at: record.next_check_at } : {})
    };
}

async function load(processId) {
    if (typeof processId !== 'string' || !/^[a-f\d]{64}$/.test(processId)) throw fail('invalid_process_id');
    const record = await BookingProcess.findById(processId).lean();
    if (!record) throw fail('booking_process_not_found', 404);
    return record;
}

function validateOccupancy(guests) {
    if (!Array.isArray(guests) || !guests.length || guests.length > 9) throw fail('invalid_occupancy');
    return guests.map(room => {
        if (!room || !Number.isInteger(room.adults) || room.adults < 1 || room.adults > 6
            || !Array.isArray(room.children) || room.children.length > 4
            || room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) throw fail('invalid_occupancy');
        return { adults: room.adults, children: [...room.children].sort((left, right) => left - right) };
    });
}

async function createProcess(details = {}, idempotencyKey) {
    requireEnabled();
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw fail('invalid_idempotency_key');
    if (typeof details.book_hash !== 'string' || !details.book_hash.trim() || details.book_hash.length > 1024) throw fail('invalid_book_hash');
    if (typeof details.user_ip !== 'string' || !isIP(details.user_ip)) throw fail('invalid_user_ip');
    const language = details.language || 'en';
    if (typeof language !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language)) throw fail('invalid_language');
    const guests = validateOccupancy(details.guests);
    const request = { book_hash: details.book_hash.trim(), user_ip: details.user_ip, language };
    const processId = hash(idempotencyKey);
    const requestHash = fingerprint({ ...request, guests });
    const existing = await BookingProcess.findById(processId).lean();
    if (existing) {
        if (existing.request_hash !== requestHash) throw fail('idempotency_conflict', 409);
        return view(existing);
    }
    try {
        await BookingProcess.create({ _id: processId, request_hash: requestHash, language, guests, state: 'creating', form_expires_at: new Date(Date.now() + 60 * 60 * 1000) });
    } catch (error) {
        if (error.code !== 11000) throw error;
        const duplicate = await load(processId);
        if (duplicate.request_hash !== requestHash) throw fail('idempotency_conflict', 409);
        return view(duplicate);
    }
    let form;
    try {
        form = await ratehawk.createBookingProcess(request, { beforeAttempt: async partnerOrderId => {
            const updated = await BookingProcess.findOneAndUpdate({ _id: processId, state: 'creating' }, {
                $set: { partner_order_id: partnerOrderId }, $push: { attempt_order_ids: partnerOrderId }
            }, { new: true }).lean();
            if (!updated) throw fail('booking_process_conflict', 409);
        } });
    } catch (error) {
        await BookingProcess.updateOne({ _id: processId, state: 'creating' }, { $set: { state: 'form_failed', error: safeCode(error, 'booking_form_unavailable') } });
        throw fail(safeCode(error, 'booking_form_unavailable'), error.httpStatus === 429 ? 429 : 502);
    }
    const updated = await BookingProcess.findOneAndUpdate({ _id: processId, state: 'creating' }, { $set: { form, state: 'form_ready' } }, { new: true }).lean();
    if (!updated) throw fail('booking_process_conflict', 409);
    return view(updated);
}

async function requireUnexpired(record) {
    const expiresAt = new Date(record.form_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        await BookingProcess.updateOne({ _id: record._id, state: { $in: [...READY, 'card_failed'] } }, { $set: { state: 'expired' } });
        throw fail('booking_form_expired', 409);
    }
}

function paymentIdentity(payment) {
    return { type: payment.type, amount: payment.amount, currency_code: payment.currency_code };
}

async function tokenizeCard(processId, details = {}) {
    requireEnabled();
    if (process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED !== 'true') throw fail('card_tokenization_disabled', 503);
    const record = await load(processId);
    if (!record.form) throw fail('booking_form_not_ready', 409);
    const payment = paymentIdentity(ratehawk.selectBookingPayment(record.form, details.payment_type));
    if (record.state === 'card_ready') {
        if (fingerprint(payment) !== fingerprint(record.card_payment)) throw fail('card_payment_conflict', 409);
        return view(record);
    }
    if (!['form_ready', 'card_failed'].includes(record.state)) throw fail('card_tokenization_unavailable', 409);
    await requireUnexpired(record);
    const tokens = { init_uuid: crypto.randomUUID(), pay_uuid: crypto.randomUUID() };
    const claimed = await BookingProcess.findOneAndUpdate({ _id: processId, state: record.state }, {
        $set: { state: 'card_pending', card_token: tokens, card_payment: payment }, $unset: { error: '' }
    }, { new: true }).lean();
    if (!claimed) throw fail('booking_process_conflict', 409);
    try {
        await ratehawk.createBookingCardToken(details, record.form, tokens);
    } catch (error) {
        const code = safeCode(error, 'card_tokenization_unknown');
        const unknown = code === 'card_tokenization_unknown';
        await BookingProcess.updateOne({ _id: processId, state: 'card_pending' }, {
            $set: { state: unknown ? 'card_unknown' : 'card_failed', error: code }, $unset: { card_token: '' }
        });
        throw fail(code, unknown ? 502 : 400);
    }
    const updated = await BookingProcess.findOneAndUpdate({ _id: processId, state: 'card_pending' }, { $set: { state: 'card_ready' } }, { new: true }).lean();
    if (!updated) throw fail('booking_process_conflict', 409);
    return view(updated);
}

function verifyGuestCounts(rooms, occupancy) {
    const supplied = rooms.map(room => ({
        adults: room.guests.filter(guest => !guest.is_child).length,
        children: room.guests.filter(guest => guest.is_child).map(guest => guest.age).sort((left, right) => left - right)
    }));
    if (fingerprint(supplied) !== fingerprint(occupancy)) throw fail('guest_occupancy_mismatch');
}

async function finishProcess(processId, details = {}) {
    requireEnabled();
    const record = await load(processId);
    if (!record.form) throw fail('booking_form_not_ready', 409);
    const payment = ratehawk.selectBookingPayment(record.form, details.payment_type);
    if (payment.is_need_credit_card_data && (!record.card_token?.init_uuid
        || fingerprint(paymentIdentity(payment)) !== fingerprint(record.card_payment))) throw fail('credit_card_required');
    const validatedDetails = { ...details, language: record.language, card_token: record.card_token };
    const request = ratehawk.buildBookingFinish(validatedDetails, record.form);
    verifyGuestCounts(request.rooms, record.guests);
    const finishHash = fingerprint(request);
    if (record.finish_hash) {
        if (record.finish_hash !== finishHash) throw fail('idempotency_conflict', 409);
        return view(record);
    }
    if (!READY.includes(record.state)) throw fail('booking_form_not_ready', 409);
    await requireUnexpired(record);
    const now = Date.now();
    const configuredWait = Number(process.env.RATEHAWK_BOOK_WAIT_MS) || 90000;
    const waitMs = Math.max(5000, Math.min(15 * 60 * 1000, configuredWait));
    const claimed = await BookingProcess.findOneAndUpdate({ _id: processId, state: record.state, finish_hash: { $exists: false } }, {
        $set: { state: 'finishing', finish_hash: finishHash, finish_sent_at: new Date(now), booking_deadline_at: new Date(now + waitMs), next_check_at: new Date(now + 60000) },
        $unset: { error: '' }
    }, { new: true }).lean();
    if (!claimed) {
        const duplicate = await load(processId);
        if (duplicate.finish_hash !== finishHash) throw fail('idempotency_conflict', 409);
        return view(duplicate);
    }
    let result;
    try {
        result = await ratehawk.startBookingProcess(validatedDetails, record.form);
    } catch (error) {
        result = error.ratehawkError
            ? { status: 'failed', error: safeCode(error, 'booking_finish_failed') }
            : { status: 'processing', error: 'booking_outcome_unknown' };
    }
    await BookingProcess.updateOne({ _id: processId, state: 'finishing' }, {
        $set: { state: result.status, error: result.error, next_check_at: new Date(Date.now() + (result.retry_after_ms || 5000)) }
    });
    return view(await load(processId));
}

async function checkProcess(processId) {
    const record = await load(processId);
    if (!IN_FLIGHT.includes(record.state)) return view(record);
    const now = Date.now();
    if (record.next_check_at && now < new Date(record.next_check_at).getTime()) return view(record);
    const leaseId = crypto.randomUUID();
    const claimed = await BookingProcess.findOneAndUpdate({
        _id: processId, state: { $in: IN_FLIGHT }, next_check_at: { $lte: new Date(now) },
        $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: new Date(now) } }]
    }, { $set: { check_lease_id: leaseId, check_lease_until: new Date(now + 35000) } }, { new: true }).lean();
    if (!claimed) return view(await load(processId));
    let result;
    try {
        const finalCheckAt = new Date(record.booking_deadline_at).getTime() - 1000;
        const timeout = now < finalCheckAt ? Math.min(30000, finalCheckAt - now) : now < finalCheckAt + 1000 ? 1000 : 30000;
        result = await ratehawk.checkBookingProcess(record.partner_order_id, { timeout: Math.max(1, timeout) });
        const afterRequest = Date.now();
        if (result.status === 'processing' && (result.retry_after_ms || 5000) <= 5000 && now < finalCheckAt
            && afterRequest >= finalCheckAt && afterRequest < finalCheckAt + 1000) {
            result = await ratehawk.checkBookingProcess(record.partner_order_id, { timeout: Math.max(1, finalCheckAt + 1000 - afterRequest) });
        }
    } catch {
        result = { success: false, status: 'processing', error: 'booking_status_unavailable', retry_after_ms: 5000 };
    }
    const checkedAt = Date.now();
    const finalCheckAt = new Date(record.booking_deadline_at).getTime() - 1000;
    const delay = Math.max(checkedAt >= finalCheckAt + 1000 ? 60000 : 5000, result.retry_after_ms || 0);
    const nextCheck = finalCheckAt > checkedAt && delay === 5000 ? Math.min(checkedAt + delay, finalCheckAt) : checkedAt + delay;
    const update = {
        $set: { state: result.status, next_check_at: new Date(nextCheck) },
        $unset: { check_lease_id: '', check_lease_until: '' }
    };
    if (result.error) update.$set.error = result.error;
    else update.$unset.error = '';
    if (result.status === '3ds') update.$set.data_3ds = result.data_3ds;
    else update.$unset.data_3ds = '';
    await BookingProcess.updateOne({ _id: processId, state: { $in: IN_FLIGHT }, check_lease_id: leaseId }, update);
    return view(await load(processId));
}

async function reconcilePendingProcesses() {
    const now = new Date(Date.now());
    const records = await BookingProcess.find({
        state: { $in: IN_FLIGHT }, next_check_at: { $lte: now },
        $or: [{ check_lease_until: { $exists: false } }, { check_lease_until: { $lte: now } }]
    }).select('_id').sort({ next_check_at: 1 }).limit(10).lean();
    const results = await Promise.allSettled(records.map(record => checkProcess(record._id)));
    return { checked: records.length, failed: results.filter(result => result.status === 'rejected').length };
}

function startBookingStatusWorker() {
    let running = false;
    const tick = async () => {
        if (running || mongoose.connection.readyState !== 1) return;
        running = true;
        try {
            const result = await reconcilePendingProcesses();
            if (result.failed) logger.warn('RateHawk booking status reconciliation needs retry', { failed: result.failed });
        } catch {
            logger.error('RateHawk booking status reconciliation unavailable');
        } finally {
            running = false;
        }
    };
    const timer = setInterval(tick, 1000);
    timer.unref();
    void tick();
    return () => clearInterval(timer);
}

module.exports = { createProcess, tokenizeCard, finishProcess, checkProcess, reconcilePendingProcesses, startBookingStatusWorker };