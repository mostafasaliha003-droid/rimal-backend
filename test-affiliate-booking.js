const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const keys = [
    'RATEHAWK_AFFILIATE_BASE_URL', 'RATEHAWK_AFFILIATE_KEY_ID', 'RATEHAWK_AFFILIATE_API_KEY',
    'RATEHAWK_BASE_URL', 'RATEHAWK_KEY_ID', 'RATEHAWK_API_KEY', 'RATEHAWK_AFFILIATE_ENABLED',
    'RATEHAWK_AFFILIATE_BOOKING_ENABLED', 'RATEHAWK_AFFILIATE_CURRENCY', 'RATEHAWK_AFFILIATE_RESIDENCY',
    'AFFILIATE_BOOKING_ENCRYPTION_KEY', 'AFFILIATE_BOOKING_TOKEN', 'PAYMENT_BOOKING_ENCRYPTION_KEY',
    'RATEHAWK_BOOKING_TOKEN', 'REMAL_SECURE_KEY', 'RIMAL_AUTH_REALM'
];

function configure(context) {
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    context.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
    process.env.RATEHAWK_AFFILIATE_BASE_URL = 'https://api-sandbox.ratehawk.com';
    process.env.RATEHAWK_AFFILIATE_KEY_ID = 'affiliate-fixture-id';
    process.env.RATEHAWK_AFFILIATE_API_KEY = 'affiliate-fixture-api-key';
    process.env.RATEHAWK_KEY_ID = 'b2b-fixture-id';
    process.env.RATEHAWK_API_KEY = 'b2b-fixture-api-key';
    process.env.RATEHAWK_AFFILIATE_ENABLED = 'true';
    process.env.RATEHAWK_AFFILIATE_BOOKING_ENABLED = 'true';
    process.env.RIMAL_AUTH_REALM = 'affiliate-fixture-realm';
    process.env.AFFILIATE_BOOKING_ENCRYPTION_KEY = 'ac'.repeat(32);
    process.env.AFFILIATE_BOOKING_TOKEN = 'affiliate-private-token-fixture-32-chars';
    process.env.REMAL_SECURE_KEY = 'public-browser-key';
    process.env.RATEHAWK_BOOKING_TOKEN = 'b2b-private-token-fixture-32-chars';
    process.env.PAYMENT_BOOKING_ENCRYPTION_KEY = 'de'.repeat(32);
}

const envelope = (data, status = 'ok', error = null) => ({
    ok: status === 'ok' && error === null, status, error, data, httpStatus: 200
});

const hotelRate = ({ amount = '75.00', currency = 'AED', shown = '100.00', shownCurrency = 'USD', bookHash = 'affiliate-hash' } = {}) => ({
    book_hash: bookHash,
    room_name: 'Fixture Double Room',
    meal: 'breakfast',
    payment_options: { payment_types: [{ type: 'hotel', amount, currency_code: currency,
        show_amount: shown, show_currency_code: shownCurrency, is_need_credit_card_data: false }] }
});

function details(token, overrides = {}) {
    return {
        hid: 7001, hotelName: 'Fixture Hotel', book_hash: 'affiliate-hash', roomName: 'Fixture Double Room',
        meal: 'breakfast', checkin: '2099-10-15', checkout: '2099-10-17', language: 'en',
        guests: [{ adults: 1, children: [5] }], expected_price: '100.00', expected_currency: 'USD',
        user: { email: 'guest@example.test', phone: '+971500000000' },
        rooms: [{ guests: [
            { firstName: 'Test', lastName: 'Adult', is_child: false },
            { firstName: 'Test', lastName: 'Child', is_child: true, age: 5 }
        ] }], affiliate_offer_token: token, ...overrides
    };
}

function signFixtureOffer(service, payload) {
    return service._test.signOffer(payload);
}

function offerPayload() {
    return {
        contract_identity: crypto.createHash('sha256').update('https://api-sandbox.ratehawk.com|affiliate-fixture-id').digest('hex'),
        hid: 7001, book_hash: 'affiliate-hash', room_name: 'Fixture Double Room', hotel_name: 'Fixture Hotel',
        meal: 'breakfast', checkin: '2099-10-15', checkout: '2099-10-17',
        guests: [{ adults: 1, children: [5] }], residency: 'ae', search_currency: 'USD', search_language: 'en',
        expected_price: '100.00', expected_currency: 'USD', expires_at: Date.now() + 60000
    };
}

test('Affiliate client requires independent account credentials and never falls back to B2B', context => {
    configure(context);
    const affiliate = require('./services/ratehawkAffiliateClient');
    assert.equal(affiliate.getConfiguration().configured, true);
    process.env.RATEHAWK_AFFILIATE_KEY_ID = process.env.RATEHAWK_KEY_ID;
    process.env.RATEHAWK_AFFILIATE_API_KEY = process.env.RATEHAWK_API_KEY;
    assert.equal(affiliate.getConfiguration().configured, false);
    assert.equal(affiliate.normalizeBaseUrl('http://api.ratehawk.com'), null);
    assert.equal(affiliate.normalizeBaseUrl('https://attacker.example'), null);
});

test('Affiliate ETG requests use only the Affiliate origin and credentials, redact private values and never retry finish', async context => {
    configure(context);
    const axios = require('axios');
    const logger = require('./services/loggerService');
    const affiliate = require('./services/ratehawkAffiliateClient');
    const calls = [];
    const logs = [];
    context.mock.method(logger, 'logEtgExchange', entry => logs.push(entry));
    context.mock.method(axios, 'post', async (url, body, config) => {
        calls.push({ url, body, config });
        return { status: 200, headers: {}, data: { status: 'ok', error: null, data: { accepted: true } } };
    });
    await affiliate.hotelPage({ hid: 7001 });
    await affiliate.prebook({ hash: 'affiliate-hash' });
    await affiliate.bookingForm({ book_hash: 'affiliate-hash', partner_order_id: 'private-aff-order' });
    await affiliate.bookingFinish({ partner: { partner_order_id: 'private-aff-order' }, user: { email: 'private@example.test' } });
    await affiliate.bookingFinishStatus({ partner_order_id: 'private-aff-order' });

    assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
        '/api/b2b/v3/search/hp/', '/api/b2b/v3/hotel/prebook/',
        '/api/b2b/v3/hotel/order/booking/form/', '/api/b2b/v3/hotel/order/booking/finish/',
        '/api/b2b/v3/hotel/order/booking/finish/status/'
    ]);
    for (const call of calls) {
        assert.equal(new URL(call.url).origin, 'https://api-sandbox.ratehawk.com');
        assert.deepEqual(call.config.auth, { username: 'affiliate-fixture-id', password: 'affiliate-fixture-api-key' });
        assert.equal(call.config.maxRedirects, 0);
    }
    assert.equal(JSON.stringify(logs).includes('private-aff-order'), false);
    assert.equal(JSON.stringify(logs).includes('private@example.test'), false);
    assert.deepEqual(affiliate._test.redactPersonalData({ rooms: [{ guests: [{ first_name: 'Secret' }] }] }),
        { rooms: [{ guests: [{ first_name: '[REDACTED]' }] }] });
});

test('Affiliate offer signatures bind contract, dates, occupancy, room and displayed quote', context => {
    configure(context);
    const service = require('./services/affiliateBookingService');
    const token = signFixtureOffer(service, offerPayload());
    const detail = details(token);
    const normalized = service._test.normalizeDetails(detail);
    const identity = offerPayload().contract_identity;
    assert.equal(service._test.verifyOffer(token, normalized, identity).expected_price, '100.00');
    assert.throws(() => service._test.verifyOffer(token, { ...normalized, checkout: '2099-10-18' }, identity), /invalid_affiliate_offer/);
    assert.throws(() => service._test.verifyOffer(token, { ...normalized, expected: { amount: '101.00', currency: 'USD' } }, identity), /invalid_affiliate_offer/);
    assert.throws(() => service._test.verifyOffer(token, normalized, '0'.repeat(64)), /invalid_affiliate_offer/);
    assert.equal(service._test.showQuote({ amount: '75.00', currency_code: 'AED', show_amount: '100.00', show_currency_code: 'USD' }).amount, '100');
    assert.equal(service._test.canonicalAmount('75.000'), '75');
});

test('Affiliate hotelpage marks its own contract, exposes shown amount and signs only eligible no-card hotel rates', async context => {
    configure(context);
    const service = require('./services/affiliateBookingService');
    const client = require('./services/ratehawkAffiliateClient');
    const rates = [hotelRate(), { ...hotelRate({ bookHash: 'card-rate' }), payment_options: {
        payment_types: [{ type: 'hotel', amount: '80.00', currency_code: 'AED', is_need_credit_card_data: true }]
    } }];
    const request = context.mock.method(client, 'hotelPage', async body => {
        assert.equal(body.hid, 7001);
        assert.equal(body.currency, 'USD');
        assert.equal(body.guests[0].children[0], 5);
        return envelope({ hotels: [{ hid: 7001, id: 'fixture-hotel', name: 'Fixture Hotel', rates }] });
    });
    const result = await service.getHotelPageRates({ hid: 7001, checkin: '2099-10-15', checkout: '2099-10-17',
        guests: [{ adults: 1, children: [5] }], currency: 'USD', residency: 'ae', language: 'en' });
    assert.equal(request.mock.callCount(), 1);
    assert.equal(result.rates.length, 1);
    assert.equal(result.rates[0].contract_source, 'affiliate');
    assert.equal(result.rates[0].display_amount, '100');
    assert.equal(result.rates[0].display_currency, 'USD');
    assert.match(result.rates[0].affiliate_offer_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('B2B hotelpage pricing always refreshes live rates instead of reusing an in-process price cache', async context => {
    const service = require('./services/ratehawkService');
    const mappingService = require('./services/mappingService');
    const mongoose = require('mongoose');
    const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', new mongoose.Schema({ hotelId: String }));
    const request = context.mock.method(service.client, 'hotelPage', async body => {
        assert.equal(body.hid, 7001);
        return { ok: true, data: { hotels: [{ id: 'fixture-hotel', hid: 7001, name: 'Fixture Hotel', rates: [] }] } };
    });
    context.mock.method(Hotel, 'findOne', () => ({ lean: async () => null }));
    context.mock.method(mappingService, 'deduplicateHotels', hotels => hotels);
    const criteria = { checkin: '2099-10-15', checkout: '2099-10-17', guests: [{ adults: 1, children: [] }] };
    await service.getHotelPricing(7001, criteria);
    await service.getHotelPricing(7001, criteria);
    assert.equal(request.mock.callCount(), 2);
});

test('Affiliate booking persists one idempotent form and never resends finish after an ambiguous result', async context => {
    configure(context);
    const service = require('./services/affiliateBookingService');
    const client = require('./services/ratehawkAffiliateClient');
    const store = require('./models/AffiliateBookingProcess');
    const bookingRecords = require('./models/AffiliateBookingRecord');
    const descriptor = Object.getOwnPropertyDescriptor(require('mongoose').connection, 'readyState');
    Object.defineProperty(require('mongoose').connection, 'readyState', { configurable: true, get: () => 1 });
    context.after(() => {
        if (descriptor) Object.defineProperty(require('mongoose').connection, 'readyState', descriptor);
        else delete require('mongoose').connection.readyState;
    });

    let record = null;
    const copy = value => value && structuredClone(value);
    const apply = (target, update) => {
        Object.assign(target, update.$set || {});
        for (const [key, value] of Object.entries(update.$push || {})) target[key] = [...(target[key] || []), value];
        for (const key of Object.keys(update.$unset || {})) delete target[key];
    };
    context.mock.method(store, 'findOne', filter => ({ lean: async () =>
        record && record._id === filter._id && record.realm === filter.realm
            && record.owner_subject === filter.owner_subject ? copy(record) : null }));
    context.mock.method(store, 'create', async value => { record = copy(value); });
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        const stateMatches = !filter.state || filter.state === record?.state
            || Array.isArray(filter.state.$in) && filter.state.$in.includes(record?.state);
        if (!record || record._id !== filter._id || record.realm !== filter.realm
            || record.owner_subject !== filter.owner_subject || !stateMatches) return null;
        if (filter.lease_id && record.lease_id !== filter.lease_id) return null;
        if (filter.finish_hash?.$exists === false && record.finish_hash) return null;
        if (filter.state?.$in && !filter.state.$in.includes(record.state)) return null;
        apply(record, update);
        return copy(record);
    } }));
    context.mock.method(store, 'updateOne', async (filter, update) => {
        const stateMatches = !filter.state || filter.state === record?.state
            || Array.isArray(filter.state.$in) && filter.state.$in.includes(record?.state);
        if (record && record.realm === filter.realm && record.owner_subject === filter.owner_subject && stateMatches
            && (!filter.lease_id || record.lease_id === filter.lease_id)) apply(record, update);
        return { matchedCount: record ? 1 : 0 };
    });
    context.mock.method(bookingRecords, 'updateOne', async () => ({ matchedCount: 1 }));

    const hotel = { hid: 7001, id: 'fixture-hotel', name: 'Fixture Hotel', rates: [hotelRate()] };
    context.mock.method(client, 'hotelPage', async body => {
        assert.equal(body.hid, 7001);
        return envelope({ hotels: [hotel] });
    });
    context.mock.method(client, 'prebook', async body => {
        assert.deepEqual(body, { hash: 'affiliate-hash', price_increase_percent: 0 });
        return envelope({ hotels: [hotel] });
    });
    context.mock.method(client, 'bookingForm', async body => {
        assert.equal(record.partner_order_id, body.partner_order_id);
        return envelope({ partner_order_id: body.partner_order_id, order_id: 44, item_id: 55,
            payment_types: [{ type: 'hotel', amount: '75.00', currency_code: 'AED', is_need_credit_card_data: false }] });
    });
    let statusResponse = envelope({ partner_order_id: 'fixture-order' });
    context.mock.method(client, 'bookingFinish', async payload => {
        assert.deepEqual(payload.payment_type, { type: 'hotel', amount: '75.00', currency_code: 'AED' });
        assert.equal(payload.partner.partner_order_id, record.partner_order_id);
        return { ok: false, status: 'error', error: 'unknown', httpStatus: 503 };
    });
    context.mock.method(client, 'bookingFinishStatus', async () => statusResponse);

    const rawOffer = offerPayload();
    const token = signFixtureOffer(service, rawOffer);
    const input = details(token);
    const owner = { ownerSubject: 'affiliate-fixture-owner' };
    const first = await service.createProcess(input, 'fixture-affiliate-idempotency-key', '192.0.2.8', owner);
    assert.equal(first.status, 'form_ready');
    assert.equal(first.confirmed, false);
    assert.match(first.access_token, /^[a-f\d]{64}$/);
    assert.equal(JSON.stringify(record).includes('guest@example.test'), false);
    assert.equal(record.contract_identity, rawOffer.contract_identity);
    assert.equal(record.owner_subject, owner.ownerSubject);
    assert.equal(record.realm, process.env.RIMAL_AUTH_REALM);

    const second = await service.createProcess(input, 'fixture-affiliate-idempotency-key', '192.0.2.8', owner);
    assert.equal(second.process_id, first.process_id);
    assert.equal(client.bookingForm.mock.callCount(), 1);
    await assert.rejects(service.createProcess({ ...input, expected_price: '101.00' }, 'fixture-affiliate-idempotency-key', '192.0.2.8', owner), /invalid_affiliate_offer/);

    await assert.rejects(service.finishProcess(first.process_id, first.access_token, { ownerSubject: 'another-owner' }), /affiliate_booking_not_found/);
    const pending = await service.finishProcess(first.process_id, first.access_token, owner);
    assert.equal(pending.status, 'processing');
    assert.equal(client.bookingFinish.mock.callCount(), 1);
    const repeat = await service.finishProcess(first.process_id, first.access_token, owner);
    assert.equal(repeat.status, 'processing');
    assert.equal(client.bookingFinish.mock.callCount(), 1);

    record.next_check_at = new Date(0);
    statusResponse = { ok: true, status: 'ok', error: null, httpStatus: 200, data: { partner_order_id: record.partner_order_id } };
    const confirmed = await service.checkStatus(first.process_id, first.access_token, owner);
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.confirmed, true);
    assert.equal(client.bookingFinish.mock.callCount(), 1);
    assert.equal(client.bookingFinishStatus.mock.callCount(), 1);
    assert.equal(record.booking_recorded, true);
});

test('Affiliate status requires per-process token and final non-success statuses remain unconfirmed', async context => {
    configure(context);
    const service = require('./services/affiliateBookingService');
    const store = require('./models/AffiliateBookingProcess');
    const client = require('./services/ratehawkAffiliateClient');
    const owner = { ownerSubject: 'affiliate-fixture-owner' };
    const record = { _id: 'a'.repeat(64), realm: process.env.RIMAL_AUTH_REALM, owner_subject: owner.ownerSubject,
        reference: 'fixture-reference', request_hash: 'f'.repeat(64),
        contract_identity: crypto.createHash('sha256').update('https://api-sandbox.ratehawk.com|affiliate-fixture-id').digest('hex'),
        state: 'processing', partner_order_id: 'fixture-order', next_check_at: new Date(0), booking_deadline_at: new Date(Date.now() + 60000) };
    const copy = value => structuredClone(value);
    context.mock.method(store, 'findOne', filter => ({ lean: async () =>
        record._id === filter._id && record.realm === filter.realm && record.owner_subject === filter.owner_subject
            ? copy(record) : null }));
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter._id !== record._id || filter.realm !== record.realm || filter.owner_subject !== record.owner_subject
            || !filter.state.$in.includes(record.state)) return null;
        Object.assign(record, update.$set);
        return copy(record);
    } }));
    context.mock.method(store, 'updateOne', async (filter, update) => {
        if (filter.realm !== record.realm || filter.owner_subject !== record.owner_subject
            || filter.check_lease_id !== record.check_lease_id) return { matchedCount: 0 };
        Object.assign(record, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return { matchedCount: 1 };
    });
    const status = context.mock.method(client, 'bookingFinishStatus', async () => ({
        ok: false, status: '3ds', error: '3ds', httpStatus: 200, data: { data_3ds: { secret: 'never-forward' } }
    }));
    await assert.rejects(service.checkStatus(record._id, '0'.repeat(64), owner), /affiliate_booking_not_found/);
    const token = crypto.createHmac('sha256', Buffer.from(process.env.AFFILIATE_BOOKING_ENCRYPTION_KEY, 'hex'))
        .update(`affiliate-booking-v2:${record.realm}:${record.owner_subject}:${record.reference}:${record.request_hash}`).digest('hex');
    const action = await service.checkStatus(record._id, token, owner);
    assert.equal(action.status, 'action_required');
    assert.equal(action.confirmed, false);
    assert.equal(action.error, 'supplier_action_required');
    assert.equal(JSON.stringify(action).includes('never-forward'), false);
    assert.equal(status.mock.callCount(), 1);
});