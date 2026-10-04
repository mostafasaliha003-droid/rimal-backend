'use strict';

/**
 * Standalone ETG / RateHawk B2B API v3 sandbox certification runner.
 *
 * This script is intentionally inert unless invoked with --execute,
 * --finish-bookings, and --acknowledge-sandbox-bookings. It refuses every host
 * except api-sandbox.ratehawk.com and never logs HTTP auth headers. Only the
 * requested HIDs are allowed; test-key
 * hotel 8473727 is blocked because ETG warns its bookings can carry real
 * financial responsibility.
 *
 * Usage:
 *   node etg-cert-sandbox-test.js --execute --finish-bookings --acknowledge-sandbox-bookings --scenario=standard_booking --max-approved-price=1000.00
 *   node etg-cert-sandbox-test.js --execute --finish-bookings --acknowledge-sandbox-bookings --scenario=standard_booking --max-approved-price=1000.00
 *   node etg-cert-sandbox-test.js --execute --finish-bookings --acknowledge-sandbox-bookings --scenario=prebook_price_increase_10_percent --max-approved-price=150.00
 *
 * Required .env values:
 *   RATEHAWK_BASE_URL=https://api-sandbox.ratehawk.com
 *   RATEHAWK_KEY_ID=...
 *   RATEHAWK_API_KEY=...
 *   ETG_CERT_USER_IP=<valid IP used for the test booking>
 *   ETG_CERT_GUEST_EMAIL=<dedicated sandbox test contact email>
 *   ETG_CERT_GUEST_PHONE=<dedicated sandbox test contact phone>
 *   ETG_CERT_GUESTS_JSON=<approved sandbox test guests grouped by scenario/room>
 *   ETG_CERT_SANDBOX_TEST_DATA_CONFIRMED=true
 *
 * Optional .env values:
 *   ETG_CERT_BOOK_TIMEOUT_SECONDS=600
 *   ETG_CERT_POLL_INTERVAL_MS=5000
 *
 * ETG_CERT_GUESTS_JSON must map each scenario ID to per-room guest arrays with
 * approved sandbox test data. Children need is_child:true and the exact age.
 * Never put payment-card data in this file or in the logs.
 *
 * ETG's sandbox error cases below use documented partner_order_id suffixes.
 * The JSON log contains supplier exchanges and test guest data and is
 * git-ignored; protect it and share it only through an approved secure channel.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');
const dotenv = require('dotenv');
const axios = require('axios');

const ROOT = __dirname;
const LOG_PATH = path.join(ROOT, 'etg-certification-logs.json');
dotenv.config({ path: path.join(ROOT, '.env') });

const SANDBOX_ORIGIN = 'https://api-sandbox.ratehawk.com';
const API_PREFIX = '/api/b2b/v3';
const LANGUAGE = 'en';
// ETG Sandbox's hotelpage response currency is always USD.
const CURRENCY = 'USD';
const DEFAULT_RESIDENCY = 'ae';
const DEFAULT_NIGHTS = 2;
const MAX_BOOKING_TIMEOUT_SECONDS = 600;
const APPROVED_SANDBOX_BOOKING_HIDS = new Set([10004834, 8819557]);
const TRANSIENT_ERRORS = new Set(['unknown', 'timeout']);
const FINAL_BOOKING_ERRORS = new Set([
    '3ds', 'block', 'book_limit', 'booking_finish_did_not_succeed', 'charge',
    'decoding_json', 'endpoint_exceeded_limit', 'endpoint_not_active',
    'endpoint_not_found', 'incorrect_credentials', 'invalid_auth_header',
    'invalid_params', 'lock', 'no_auth_header', 'not_allowed', 'not_allowed_host',
    'order_not_found', 'overdue_debt', 'provider', 'soldout', 'unexpected_method'
]);

const scenarios = [
    {
        id: 'standard_booking',
        description: 'Standard booking: HID 10004834, one room, two adults',
        hid: 10004834,
        residency: DEFAULT_RESIDENCY,
        rooms: [{ adults: 2, children: [] }],
        priceIncreasePercent: 0
    },
    {
        id: 'multiroom_mixed_children',
        description: 'Multi-room: 2 adults + child age 3; 2 adults + children ages 1, 5, 17',
        hid: 10004834,
        residency: DEFAULT_RESIDENCY,
        rooms: [
            { adults: 2, children: [3] },
            { adults: 2, children: [1, 5, 17] }
        ],
        priceIncreasePercent: 0
    },
    {
        id: 'child_age_edge_cases',
        description: 'Child age edge cases: HID 10004834, two adults + children ages 0 and 17',
        hid: 10004834,
        residency: 'mc',
        rooms: [{ adults: 2, children: [0, 17] }],
        priceIncreasePercent: 0
    },
    {
        id: 'uzbekistan_citizenship',
        description: 'Uzbekistan citizenship/residency: HID 10004834, two adults',
        hid: 10004834,
        residency: 'uz',
        rooms: [{ adults: 2, children: [] }],
        priceIncreasePercent: 0
    },
    {
        id: 'prebook_price_increase_10_percent',
        description: 'Prebook price increase: HID 8819557, request 10 percent',
        hid: 8819557,
        residency: DEFAULT_RESIDENCY,
        rooms: [{ adults: 2, children: [] }],
        priceIncreasePercent: 10
    }
];

// These partner_order_id endings are documented by ETG's Sandbox guide and
// must be set before the Create booking process (/booking/form/) request.
const errorScenarios = [
    {
        id: 'unknown_then_success',
        description: 'Unknown at finish and status, eventually confirmed',
        partnerOrderSuffix: 'unknown_success',
        expectedFinalStatus: 'confirmed'
    },
    {
        id: 'unknown_then_soldout',
        description: 'Unknown at finish/status, eventually soldout',
        partnerOrderSuffix: 'unknown_soldout',
        expectedFinalError: 'soldout'
    },
    {
        id: 'unknown_then_book_limit',
        description: 'Unknown at finish/status, eventually book_limit',
        partnerOrderSuffix: 'unknown_book_limit',
        expectedFinalError: 'book_limit'
    }
];

const logs = {
    generated_at: new Date().toISOString(),
    environment: 'ETG Sandbox',
    api_origin: SANDBOX_ORIGIN,
    scenarios: []
};

function cliOptions(argv) {
    const selectedScenario = argv.find(argument => argument.startsWith('--scenario='));
    const maximumPriceArgument = argv.find(argument => argument.startsWith('--max-approved-price='));
    return {
        execute: argv.includes('--execute'),
        finishBookings: argv.includes('--finish-bookings'),
        acknowledgeSandboxBookings: argv.includes('--acknowledge-sandbox-bookings'),
        includeErrors: argv.includes('--include-errors'),
        maxApprovedPrice: maximumPriceArgument ? maximumPriceArgument.slice('--max-approved-price='.length) : null,
        scenarioId: selectedScenario ? selectedScenario.slice('--scenario='.length) : null,
        help: argv.includes('--help') || argv.includes('-h')
    };
}

function printHelp() {
    console.log([
        'ETG Sandbox certification runner (no requests without explicit execution/booking acknowledgments)',
        '',
        'Usage:',
        '  node etg-cert-sandbox-test.js --execute --finish-bookings --acknowledge-sandbox-bookings --scenario=prebook_price_increase_10_percent --max-approved-price=150.00',
        '  node etg-cert-sandbox-test.js --execute --finish-bookings --acknowledge-sandbox-bookings --include-errors --max-approved-price=1000.00',
        '',
        'Required .env: sandbox credentials, ETG_CERT_USER_IP, test contacts/guests, ETG_CERT_SANDBOX_TEST_DATA_CONFIRMED=true',
        'HID 8473727 is blocked: ETG warns it may cause a real financial booking obligation.',
        'Output: etg-certification-logs.json'
    ].join('\n'));
}

function requireSandboxConfiguration() {
    const keyId = process.env.RATEHAWK_KEY_ID;
    const apiKey = process.env.RATEHAWK_API_KEY;
    if (!keyId || !apiKey) {
        throw new Error('Missing RATEHAWK_KEY_ID or RATEHAWK_API_KEY in the local .env file.');
    }

    const configuredUrl = process.env.RATEHAWK_BASE_URL || SANDBOX_ORIGIN;
    let parsed;
    try {
        parsed = new URL(configuredUrl);
    } catch {
        throw new Error('RATEHAWK_BASE_URL is not a valid URL.');
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api-sandbox.ratehawk.com'
        || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('Safety stop: RATEHAWK_BASE_URL must be the official HTTPS ETG Sandbox host.');
    }

    const userIp = process.env.ETG_CERT_USER_IP;
    if (!userIp || !isIP(userIp)) {
        throw new Error('Set ETG_CERT_USER_IP in .env to the valid IP for this booking test.');
    }

    const pollIntervalMs = Number(process.env.ETG_CERT_POLL_INTERVAL_MS || 5000);
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1000 || pollIntervalMs > 60000) {
        throw new Error('ETG_CERT_POLL_INTERVAL_MS must be an integer from 1000 to 60000.');
    }

    const bookingTimeoutSeconds = Number(process.env.ETG_CERT_BOOK_TIMEOUT_SECONDS || MAX_BOOKING_TIMEOUT_SECONDS);
    if (!Number.isInteger(bookingTimeoutSeconds) || bookingTimeoutSeconds < 10
        || bookingTimeoutSeconds > MAX_BOOKING_TIMEOUT_SECONDS) {
        throw new Error('ETG_CERT_BOOK_TIMEOUT_SECONDS must be an integer from 10 to 600.');
    }

    if (process.env.ETG_CERT_SANDBOX_TEST_DATA_CONFIRMED !== 'true') {
        throw new Error('Set ETG_CERT_SANDBOX_TEST_DATA_CONFIRMED=true only after confirming these are approved sandbox test values.');
    }
    let guestRoomsByScenario;
    try {
        guestRoomsByScenario = JSON.parse(process.env.ETG_CERT_GUESTS_JSON || '');
    } catch {
        throw new Error('ETG_CERT_GUESTS_JSON must be valid JSON containing sandbox test guest details grouped by scenario and room.');
    }
    if (!guestRoomsByScenario || typeof guestRoomsByScenario !== 'object' || Array.isArray(guestRoomsByScenario)) {
        throw new Error('ETG_CERT_GUESTS_JSON must be an object keyed by scenario ID.');
    }
    for (const scenario of scenarios) validateGuestRooms(scenario, guestRoomsByScenario[scenario.id]);

    const guestFields = ['ETG_CERT_GUEST_EMAIL', 'ETG_CERT_GUEST_PHONE'];
    if (guestFields.some(name => !process.env[name])) {
        throw new Error(`Set dedicated sandbox test contact details in .env: ${guestFields.join(', ')}.`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ETG_CERT_GUEST_EMAIL)) {
        throw new Error('ETG_CERT_GUEST_EMAIL must be a valid authorized test contact email.');
    }
    if (!/^\+?[0-9 ()-]{7,40}$/.test(process.env.ETG_CERT_GUEST_PHONE)) {
        throw new Error('ETG_CERT_GUEST_PHONE must be a valid authorized test contact phone number.');
    }

    return {
        keyId,
        apiKey,
        userIp,
        pollIntervalMs,
        bookingTimeoutSeconds,
        guestEmail: process.env.ETG_CERT_GUEST_EMAIL,
        guestPhone: process.env.ETG_CERT_GUEST_PHONE,
        guestRoomsByScenario
    };
}

function datesForStay(nights = DEFAULT_NIGHTS) {
    const today = new Date();
    const checkin = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
    const checkout = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate() + nights);
    const formatLocalDate = date => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
    return {
        checkin: formatLocalDate(checkin),
        checkout: formatLocalDate(checkout)
    };
}

function writeLogs() {
    fs.writeFileSync(LOG_PATH, `${JSON.stringify(logs, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function appendScenario(scenario) {
    logs.scenarios.push(scenario);
    writeLogs();
}

function validateGuestRooms(scenario, guestRooms) {
    if (!Array.isArray(guestRooms) || guestRooms.length !== scenario.rooms.length) {
        throw new Error(`ETG_CERT_GUESTS_JSON.${scenario.id} must contain guest arrays matching its room count.`);
    }
    guestRooms.forEach((guests, roomIndex) => {
        const occupancy = scenario.rooms[roomIndex];
        const expectedCount = occupancy.adults + occupancy.children.length;
        if (!Array.isArray(guests) || guests.length !== expectedCount) {
            throw new Error(`ETG_CERT_GUESTS_JSON.${scenario.id}[${roomIndex}] must contain ${expectedCount} guests.`);
        }
        guests.forEach((guest, guestIndex) => {
            if (!guest || typeof guest !== 'object' || Array.isArray(guest)
                || typeof guest.first_name !== 'string' || !guest.first_name.trim()
                || typeof guest.last_name !== 'string' || !guest.last_name.trim()
                || guest.first_name.length > 50 || guest.last_name.length > 50
                || !/^[\p{L}\p{M} '\u2019.,-]+$/u.test(guest.first_name)
                || !/^[\p{L}\p{M} '\u2019.,-]+$/u.test(guest.last_name)) {
                throw new Error(`Each guest in ${scenario.id} requires a valid test first_name and last_name.`);
            }
            if (Object.keys(guest).some(key => !['first_name', 'last_name', 'is_child', 'age', 'gender'].includes(key))) {
                throw new Error(`Unsupported guest field in ${scenario.id}.`);
            }
            const isChild = guestIndex >= occupancy.adults;
            if (isChild) {
                const expectedAge = occupancy.children[guestIndex - occupancy.adults];
                if (guest.is_child !== true || guest.age !== expectedAge) {
                    throw new Error(`Child in ${scenario.id}, room ${roomIndex + 1} must be marked as age ${expectedAge}.`);
                }
            } else if (guest.is_child === true || guest.age !== undefined) {
                throw new Error(`Adult in ${scenario.id}, room ${roomIndex + 1} cannot have child fields.`);
            }
            if (guest.gender !== undefined && !['male', 'female'].includes(guest.gender)) {
                throw new Error(`Gender in ${scenario.id} must be male or female when provided.`);
            }
        });
    });
}

function getEnvelope(response) {
    const body = response && response.data && typeof response.data === 'object' ? response.data : {};
    return {
        status: body.status || null,
        error: body.error || null,
        data: body.data === undefined ? null : body.data
    };
}

async function postEtg(scenarioLog, endpoint, requestPayload, config) {
    const url = `${SANDBOX_ORIGIN}${API_PREFIX}${endpoint}`;
    const startedAt = Date.now();
    const exchange = {
        timestamp: new Date(startedAt).toISOString(),
        method: 'POST',
        url,
        request_payload: requestPayload,
        response_status_code: null,
        response_payload: null,
        latency_ms: null,
        transport_error: null
    };

    try {
        const response = await axios.post(url, requestPayload, {
            auth: { username: config.keyId, password: config.apiKey },
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 120000,
            maxRedirects: 0,
            validateStatus: () => true
        });
        exchange.response_status_code = response.status;
        exchange.response_payload = response.data;
        exchange.latency_ms = Date.now() - startedAt;
        scenarioLog.exchanges.push(exchange);
        writeLogs();
        return { httpStatus: response.status, body: response.data, envelope: getEnvelope(response) };
    } catch (error) {
        exchange.response_status_code = error.response?.status || null;
        exchange.response_payload = error.response?.data ?? null;
        exchange.latency_ms = Date.now() - startedAt;
        exchange.transport_error = {
            code: typeof error.code === 'string' ? error.code : 'request_failed',
            message: error.response ? 'ETG returned an unsuccessful HTTP response.' : 'ETG request failed before a response was received.'
        };
        scenarioLog.exchanges.push(exchange);
        writeLogs();
        return {
            httpStatus: exchange.response_status_code,
            body: exchange.response_payload,
            envelope: {
                status: null,
                error: 'transport_error',
                data: null
            },
            transportError: exchange.transport_error
        };
    }
}

function apiSucceeded(result) {
    return result.httpStatus >= 200 && result.httpStatus < 300
        && result.envelope.status === 'ok' && result.envelope.error === null;
}

function apiError(result) {
    if (result.transportError) return 'transport_error';
    const code = result.envelope.error;
    if (typeof code === 'string' && code) return code;
    if (result.httpStatus >= 500) return 'http_5xx';
    if (result.httpStatus === 429) return 'rate_limit';
    return `http_${result.httpStatus}`;
}

function selectRate(hotelpageData, expectedHid) {
    const hotel = Array.isArray(hotelpageData?.hotels) ? hotelpageData.hotels[0] : null;
    if (!hotel || Number(hotel.hid) !== Number(expectedHid)) {
        throw new Error(`Hotelpage response does not match requested HID ${expectedHid}.`);
    }
    const rates = Array.isArray(hotel?.rates) ? hotel.rates : [];
    const candidates = rates.filter(rate => typeof rate?.book_hash === 'string'
        && rate.book_hash.length > 0
        && Array.isArray(rate.payment_options?.payment_types)
        && rate.payment_options.payment_types.some(payment => ['deposit', 'hotel'].includes(payment?.type)
            && payment.is_need_credit_card_data !== true)
        && getComparablePrice(rate)?.currency === CURRENCY);
    candidates.sort((left, right) => getComparablePrice(left).amount - getComparablePrice(right).amount);
    if (!candidates.length) {
        throw new Error(`HID ${expectedHid} has no USD rate with a no-card deposit/hotel payment option.`);
    }
    return { hotel, rate: candidates[0] };
}

function selectPrebookedRate(prebookData, originalRate, expectedHid) {
    const hotel = Array.isArray(prebookData?.hotels) ? prebookData.hotels[0] : null;
    if (!hotel || Number(hotel.hid) !== Number(expectedHid)) {
        throw new Error(`Prebook response does not match requested HID ${expectedHid}.`);
    }
    const rates = Array.isArray(hotel?.rates) ? hotel.rates : [];
    const validRates = rates.filter(item => typeof item?.book_hash === 'string' && item.book_hash.length > 0);
    const sameMatch = validRates.find(item => originalRate?.match_hash && item.match_hash === originalRate.match_hash);
    const originalMeal = originalRate?.meal_data?.value ?? originalRate?.meal;
    const sameRoomAndMeal = validRates.filter(item => item.room_name === originalRate?.room_name
        && (item.meal_data?.value ?? item.meal) === originalMeal);
    const rate = sameMatch || (sameRoomAndMeal.length === 1 ? sameRoomAndMeal[0]
        : validRates.length === 1 ? validRates[0] : null);
    if (!rate) throw new Error('Prebook response did not contain an unambiguous matching rate/book_hash.');
    return rate;
}

function ratePriceMap(rate) {
    const prices = {};
    for (const field of ['show_amount', 'amount']) {
        if (rate?.[field] !== undefined && rate?.[field] !== null) prices[field] = String(rate[field]);
    }
    if (Array.isArray(rate?.daily_prices)) prices.daily_prices = JSON.stringify(rate.daily_prices);
    const paymentTypes = rate?.payment_options?.payment_types;
    if (Array.isArray(paymentTypes)) {
        paymentTypes.forEach((payment, index) => {
            if (payment?.amount === undefined || payment?.amount === null) return;
            const key = `${payment.type || index}:${payment.currency_code || ''}`;
            prices[`payment:${key}`] = String(payment.amount);
        });
    }
    return prices;
}

function ratePriceSummary(rate) {
    const summary = {};
    for (const field of ['show_amount', 'show_currency_code', 'amount', 'currency_code']) {
        if (rate?.[field] !== undefined) summary[field] = rate[field];
    }
    const paymentTypes = rate?.payment_options?.payment_types;
    if (Array.isArray(paymentTypes)) {
        summary.payment_types = paymentTypes.map(item => ({
            type: item?.type,
            amount: item?.amount,
            currency_code: item?.currency_code,
            is_need_credit_card_data: item?.is_need_credit_card_data === true
        }));
    }
    return summary;
}

function getComparablePrice(rate) {
    const amount = rate?.show_amount ?? rate?.amount;
    const currency = rate?.show_currency_code ?? rate?.currency_code;
    if (amount === undefined || amount === null || typeof currency !== 'string') return null;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return null;
    return { amount: numericAmount, currency };
}

function hasApprovedPrice(rate, maximumPrice) {
    if (maximumPrice === null || maximumPrice === undefined) return false;
    const comparable = getComparablePrice(rate);
    if (!comparable || comparable.currency !== CURRENCY) return false;
    return comparable.amount <= maximumPrice;
}

function didPriceChange(originalRate, prebookData, prebookedRate) {
    if (prebookData?.changes?.price_changed === true) return true;
    const before = ratePriceMap(originalRate);
    const after = ratePriceMap(prebookedRate);
    const sharedPriceFields = Object.keys(before).filter(field => Object.hasOwn(after, field));
    return sharedPriceFields.length > 0
        ? sharedPriceFields.some(field => before[field] !== after[field])
        : null;
}

function choosePaymentType(paymentTypes) {
    if (!Array.isArray(paymentTypes) || paymentTypes.length === 0) {
        throw new Error('Booking form response did not contain payment_types.');
    }
    const payment = ['deposit', 'hotel']
        .map(type => paymentTypes.find(item => item && item.type === type && item.is_need_credit_card_data !== true))
        .find(Boolean);
    if (!payment) {
        throw new Error('Sandbox booking requires card data; this script never handles or sends card details.');
    }
    for (const field of ['type', 'amount', 'currency_code']) {
        if (payment[field] === undefined || payment[field] === null) {
            throw new Error(`Selected sandbox payment option is missing ${field}.`);
        }
    }
    return {
        type: payment.type,
        amount: payment.amount,
        currency_code: payment.currency_code
    };
}

function validatePaymentWithinCap(paymentType, maximumPrice) {
    if (paymentType.currency_code !== CURRENCY) {
        throw new Error(`Selected payment currency ${paymentType.currency_code} is not USD; refusing to finish without an explicit currency-aware approval.`);
    }
    const amount = Number(paymentType.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > maximumPrice) {
        throw new Error('Selected payment amount is invalid or exceeds --max-approved-price.');
    }
}

function makePartnerOrderId(suffix = '') {
    const uuid = crypto.randomUUID();
    return suffix ? `${uuid}-${suffix}` : uuid;
}

function formatGuestRooms(guestRooms) {
    return guestRooms.map(guests => ({
        guests: guests.map(guest => ({
            first_name: guest.first_name,
            last_name: guest.last_name,
            is_child: guest.is_child === true,
            ...(guest.is_child === true ? { age: guest.age } : {}),
            ...(guest.gender ? { gender: guest.gender } : {})
        }))
    }));
}

function makeBookingFormPayload({ partnerOrderId, bookHash, config }) {
    return {
        partner_order_id: partnerOrderId,
        book_hash: bookHash,
        language: LANGUAGE,
        user_ip: config.userIp
    };
}

function makeFinishPayload({ partnerOrderId, paymentType, guestRooms, config }) {
    const payload = {
        language: LANGUAGE,
        partner: { partner_order_id: partnerOrderId },
        user: {
            email: config.guestEmail,
            phone: config.guestPhone,
            comment: 'ETG Sandbox certification test booking'
        },
        rooms: formatGuestRooms(guestRooms),
        payment_type: paymentType
    };
    return payload;
}

function statusFromResult(result, expectedPartnerOrderId) {
    if (result.transportError) return { kind: 'transient', error: 'transport_error' };
    if (result.httpStatus === 429) return { kind: 'transient', error: 'rate_limit' };
    if (result.httpStatus >= 200 && result.httpStatus < 300
        && result.envelope.status === 'ok' && result.envelope.error === null) {
        const returnedPartnerOrderId = result.envelope.data?.partner_order_id;
        if (returnedPartnerOrderId && returnedPartnerOrderId !== expectedPartnerOrderId) {
            return { kind: 'failed', error: 'booking_status_order_mismatch' };
        }
        return { kind: 'confirmed', error: null };
    }
    if (result.envelope.status === 'processing') return { kind: 'processing', error: null };
    const error = apiError(result);
    if (TRANSIENT_ERRORS.has(error) || result.httpStatus >= 500) {
        return { kind: 'transient', error };
    }
    if (FINAL_BOOKING_ERRORS.has(error)) return { kind: 'failed', error };
    if (result.envelope.status === 'error' && error) return { kind: 'failed', error };
    return { kind: 'processing', error: null };
}

function validateScenarioArguments(scenario, { partnerOrderId, paymentType, rooms }) {
    if (typeof partnerOrderId !== 'string' || !partnerOrderId.trim()) {
        throw new Error('ETG partner_order_id is required.');
    }
    for (const [roomIndex, room] of rooms.entries()) {
        if (!Number.isInteger(room.adults) || room.adults < 1 || room.adults > 6
            || !Array.isArray(room.children) || room.children.length > 4
            || room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) {
            throw new Error(`Invalid occupancy in room ${roomIndex + 1}.`);
        }
    }
    if (paymentType.is_need_credit_card_data === true) {
        throw new Error('The selected payment type requires card data; no card fields are supported by this script.');
    }
    if (scenario.priceIncreasePercent < 0 || scenario.priceIncreasePercent > 100) {
        throw new Error('Requested price increase must be from 0 to 100 percent.');
    }
}

function buildFinishPayloadForForm({ partnerOrderId, paymentType, guestRooms, config, formData }) {
    const payload = makeFinishPayload({ partnerOrderId, paymentType, guestRooms, config });
    if (formData.is_gender_specification_required === true
        && payload.rooms.some(room => room.guests.some(guest => !guest.gender))) {
        throw new Error('ETG form requires gender for each guest; provide real gender values in ETG_CERT_GUESTS_JSON.');
    }
    if (formData.supplier_data_required === true) {
        throw new Error('ETG form requires supplier_data. This harness intentionally stops without the contract-approved supplier data.');
    }
    return payload;
}

function recordExpectedOutcome(scenarioLog, errorDefinition, status, error) {
    if (!errorDefinition) return;
    const expectedStatus = errorDefinition.expectedFinishError ? 'failed_at_finish'
        : errorDefinition.expectedFinalStatus || 'failed';
    scenarioLog.expected_final_status = expectedStatus;
    scenarioLog.expected_final_error = errorDefinition.expectedFinishError || errorDefinition.expectedFinalError || null;
    scenarioLog.expectation_met = errorDefinition.expectedFinishError
        ? status === 'failed_at_finish' && error === errorDefinition.expectedFinishError
        : expectedStatus === 'confirmed'
            ? status === 'confirmed'
            : status === 'failed' && error === errorDefinition.expectedFinalError;
}

async function pollBookingStatus(scenarioLog, partnerOrderId, config) {
    const deadline = Date.now() + config.bookingTimeoutSeconds * 1000;
    let lastStatus = 'processing';
    let lastError = null;
    while (Date.now() < deadline) {
        const result = await postEtg(scenarioLog, '/hotel/order/booking/finish/status/', {
            partner_order_id: partnerOrderId
        }, config);
        scenarioLog.latest_status_response = result.body;
        writeLogs();
        const status = statusFromResult(result, partnerOrderId);
        lastStatus = status.kind;
        lastError = status.error;
        if (status.kind === 'confirmed' || status.kind === 'failed') return status;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(config.pollIntervalMs, remainingMs)));
    }
    return { kind: 'timed_out', error: lastError, lastStatus };
}

async function runBookingScenario(definition, config, options, errorDefinition = null) {
    if (!APPROVED_SANDBOX_BOOKING_HIDS.has(Number(definition.hid))) {
        throw new Error(`Safety stop: HID ${definition.hid} is not on this certification script's sandbox allowlist.`);
    }
    const dates = datesForStay();
    const partnerOrderId = makePartnerOrderId(errorDefinition?.partnerOrderSuffix || '');
    const scenarioLog = {
        id: definition.id,
        description: definition.description,
        test_case: errorDefinition ? 'documented_sandbox_error_trigger' : 'booking',
        status: 'running',
        hid: definition.hid,
        dates,
        residency: definition.residency,
        rooms: definition.rooms,
        requested_price_increase_percent: definition.priceIncreasePercent,
        partner_order_id: partnerOrderId,
        exchanges: []
    };
    appendScenario(scenarioLog);

    try {
        const hotelpagePayload = {
            checkin: dates.checkin,
            checkout: dates.checkout,
            residency: definition.residency,
            language: LANGUAGE,
            guests: definition.rooms,
            hid: definition.hid,
            currency: CURRENCY
        };
        scenarioLog.hotelpage_request_payload = hotelpagePayload;
        const hotelpage = await postEtg(scenarioLog, '/search/hp/', hotelpagePayload, config);
        if (!apiSucceeded(hotelpage)) throw new Error(`Hotelpage failed: ${apiError(hotelpage)}`);
        scenarioLog.hotelpage_response_payload = hotelpage.body;
        const { rate: originalRate } = selectRate(hotelpage.envelope.data, definition.hid);
        scenarioLog.initial_book_hash = originalRate.book_hash;

        const prebookPayload = {
            hash: originalRate.book_hash,
            price_increase_percent: definition.priceIncreasePercent
        };
        scenarioLog.prebook_request_payload = prebookPayload;
        const prebook = await postEtg(scenarioLog, '/hotel/prebook/', prebookPayload, config);
        if (!apiSucceeded(prebook)) throw new Error(`Prebook failed: ${apiError(prebook)}`);
        scenarioLog.prebook_response_payload = prebook.body;
        const prebookedRate = selectPrebookedRate(prebook.envelope.data, originalRate, definition.hid);
        scenarioLog.prebooked_book_hash = prebookedRate.book_hash;
        scenarioLog.price_changed = didPriceChange(originalRate, prebook.envelope.data, prebookedRate);
        scenarioLog.original_rate_price = ratePriceSummary(originalRate);
        scenarioLog.prebooked_rate_price = ratePriceSummary(prebookedRate);
        scenarioLog.prebook_response_changes = prebook.envelope.data?.changes || null;

        const approvedPrebookPrice = hasApprovedPrice(prebookedRate, options.maxApprovedPrice);
        if (!approvedPrebookPrice) {
            scenarioLog.status = 'paused_price_change_requires_approval';
            scenarioLog.note = 'The prebook total is not covered by --max-approved-price in USD. Review this log and rerun only after setting an acceptable cap; the current prebook hash will expire.';
            writeLogs();
            return scenarioLog;
        }
        scenarioLog.approved_price_cap = options.maxApprovedPrice;
        scenarioLog.prebook_price_within_cap = approvedPrebookPrice;

        const formPayload = makeBookingFormPayload({
            partnerOrderId,
            bookHash: prebookedRate.book_hash,
            config
        });
        scenarioLog.booking_form_request_payload = formPayload;
        const form = await postEtg(scenarioLog, '/hotel/order/booking/form/', formPayload, config);
        if (!apiSucceeded(form)) {
            const formError = apiError(form);
            scenarioLog.status = 'failed_at_form';
            scenarioLog.error = formError;
            recordExpectedOutcome(scenarioLog, errorDefinition, 'failed_at_form', formError);
            writeLogs();
            return scenarioLog;
        }
        scenarioLog.booking_form_response_payload = form.body;
        const formData = form.envelope.data;
        if (!formData || !formData.order_id || (formData.partner_order_id && formData.partner_order_id !== partnerOrderId)) {
            throw new Error('Booking form response is missing order_id or has a partner_order_id mismatch.');
        }
        scenarioLog.order_id = formData.order_id;

        const paymentType = choosePaymentType(formData.payment_types);
        validatePaymentWithinCap(paymentType, options.maxApprovedPrice);
        const guestRooms = config.guestRoomsByScenario[definition.id]
            || config.guestRoomsByScenario.standard_booking;
        validateScenarioArguments(definition, { partnerOrderId, paymentType, rooms: definition.rooms });
        const finishPayload = buildFinishPayloadForForm({
            partnerOrderId,
            paymentType,
            guestRooms,
            config,
            formData
        });
        scenarioLog.finish_request_payload = finishPayload;
        const finish = await postEtg(scenarioLog, '/hotel/order/booking/finish/', finishPayload, config);
        scenarioLog.finish_response_payload = finish.body;
        scenarioLog.finish_response = {
            http_status: finish.httpStatus,
            status: finish.envelope.status,
            error: finish.envelope.error
        };

        // A successful finish response is not final confirmation. For the
        // documented unknown_* Sandbox cases, status polling is required too.
        const finishError = apiError(finish);
        const finishIsTransient = TRANSIENT_ERRORS.has(finishError) || finish.httpStatus === 429 || finish.httpStatus >= 500
            || finish.envelope.status === 'ok' || finish.envelope.status === 'processing';
        if (!finishIsTransient && finish.envelope.status === 'error') {
            scenarioLog.status = 'failed';
            scenarioLog.error = finishError;
            recordExpectedOutcome(scenarioLog, errorDefinition,
                errorDefinition?.expectedFinishError ? 'failed_at_finish' : 'failed', finishError);
            writeLogs();
            return scenarioLog;
        }

        const final = await pollBookingStatus(scenarioLog, partnerOrderId, config);
        scenarioLog.status = final.kind;
        if (final.kind === 'confirmed') {
            scenarioLog.partner_order_id = partnerOrderId;
            scenarioLog.final_error = null;
            scenarioLog.confirmed_at = new Date().toISOString();
        } else {
            scenarioLog.final_error = final.error;
        }

        recordExpectedOutcome(scenarioLog, errorDefinition, final.kind, final.error);
        writeLogs();
        return scenarioLog;
    } catch (error) {
        scenarioLog.status = 'error';
        scenarioLog.error = error.message;
        recordExpectedOutcome(scenarioLog, errorDefinition, 'error', error.message);
        writeLogs();
        return scenarioLog;
    }
}

async function main() {
    const options = cliOptions(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    if (!options.execute || !options.finishBookings || !options.acknowledgeSandboxBookings) {
        console.log('\nNo API calls were made. --execute, --finish-bookings, and --acknowledge-sandbox-bookings are all required; this flow can create sandbox bookings.');
        return;
    }

    const config = requireSandboxConfiguration();
    if (options.maxApprovedPrice !== null) {
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(options.maxApprovedPrice)) {
            throw new Error('--max-approved-price must be a non-negative decimal with at most two fractional digits.');
        }
        options.maxApprovedPrice = Number(options.maxApprovedPrice);
        if (!Number.isFinite(options.maxApprovedPrice)) throw new Error('--max-approved-price is invalid.');
    }
    if (options.maxApprovedPrice === null) {
        throw new Error('Set --max-approved-price=<USD amount> to cap every prebook total before any booking finish request.');
    }
    if (options.scenarioId && !scenarios.some(scenario => scenario.id === options.scenarioId)
        && !errorScenarios.some(scenario => scenario.id === options.scenarioId)) {
        throw new Error(`Unknown scenario ID: ${options.scenarioId}`);
    }
    logs.generated_at = new Date().toISOString();
    logs.checkin_rule = 'Check-in is 30 calendar days after the execution date; checkout is two nights later.';
    logs.error_scenarios_included = options.includeErrors;
    logs.max_approved_price_usd = options.maxApprovedPrice;
    writeLogs();

    console.log(`ETG Sandbox certification run. Logs: ${LOG_PATH}`);
    const selectedScenarios = options.scenarioId
        ? scenarios.filter(scenario => scenario.id === options.scenarioId)
        : scenarios;
    const selectedErrorScenarios = options.scenarioId
        ? errorScenarios.filter(scenario => scenario.id === options.scenarioId)
        : options.includeErrors ? errorScenarios : [];
    const results = [];
    for (const scenario of selectedScenarios) {
        console.log(`Running ${scenario.id}...`);
        results.push(await runBookingScenario(scenario, config, options));
    }

    if (selectedErrorScenarios.length) {
        const errorBase = scenarios[0];
        for (const errorScenario of selectedErrorScenarios) {
            const definition = {
                ...errorBase,
                id: errorScenario.id,
                description: errorScenario.description,
                priceIncreasePercent: 0
            };
            console.log(`Running documented Sandbox error case ${errorScenario.id}...`);
            results.push(await runBookingScenario(definition, config, options, errorScenario));
        }
    }

    writeLogs();
    const successful = results.filter(result => result.status === 'confirmed').length;
    const failed = results.filter(result => result.status === 'failed').length;
    const other = results.length - successful - failed;
    const unmetExpectations = results.filter(result => result.expectation_met === false).length;
    console.log(`Finished: ${successful} confirmed, ${failed} failed, ${other} pending/paused/error, ${unmetExpectations} unmet expectation(s). See ${LOG_PATH}`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`ETG certification runner stopped safely: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    datesForStay,
    didPriceChange,
    makeFinishPayload,
    buildFinishPayloadForForm,
    validatePaymentWithinCap,
    makePartnerOrderId,
    selectRate,
    selectPrebookedRate,
    getComparablePrice,
    statusFromResult,
    validateScenarioArguments,
    validateGuestRooms,
    scenarios,
    errorScenarios
};