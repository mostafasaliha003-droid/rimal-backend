const { test } = require('node:test');
const assert = require('node:assert/strict');
const contexts = require('./services/ratehawkOfferContext');
const ratehawk = require('./services/ratehawkService');

function fixture(context) {
    for (const [key, value] of Object.entries({ PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
        RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', RATEHAWK_KEY_ID: 'context-fixture',
        RATEHAWK_CONFIRMATION_EMAIL: 'corporate@remal.example.test' })) {
        const previous = process.env[key]; process.env[key] = value;
        context.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    }
    const criteria = { hid: 123, checkin: '2099-10-15', checkout: '2099-10-17', guests: [{ adults: 2, children: [] }],
        residency: 'ae', currency: 'USD', language: 'en' };
    const rate = { book_hash: 'h-fixture', room_name: 'Double room',
        payment_options: { payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } };
    return { criteria, hotels: [{ hid: 123, rates: [rate] }], rate };
}

test('hotelpage contexts bind exact rate, search criteria, expiry and supplier account', context => {
    const { criteria, hotels } = fixture(context);
    const [hotel] = contexts.attachHotelpage(hotels, criteria);
    const token = hotel.rates[0].offer_context;
    const info = contexts.read(token, 'h-fixture');
    const { hid, ...expected } = criteria;
    assert.deepEqual(info.original_request_params, expected);
});

test('contexts reject tampering, missing proof, expired offers, other hashes and other accounts', context => {
    const { criteria, hotels } = fixture(context);
    const token = contexts.attachHotelpage(hotels, criteria)[0].rates[0].offer_context;
    const info = contexts.read(token, 'h-fixture');
    for (const value of [undefined, '', token + 'x', token.replace(/^./, token[0] === 'A' ? 'B' : 'A')]) {
        assert.throws(() => contexts.read(value, 'h-fixture'), /offer_context_expired_or_changed/);
    }
    assert.throws(() => contexts.read(token, 'h-other'), /offer_context_expired_or_changed/);
    assert.throws(() => contexts.read(token, 'h-fixture', { now: info.context_expires_at }), /offer_context_expired_or_changed/);
    process.env.RATEHAWK_KEY_ID = 'other-account';
    assert.throws(() => contexts.read(token, 'h-fixture'), /offer_context_expired_or_changed/);
    process.env.RATEHAWK_KEY_ID = 'context-fixture';
    process.env.RATEHAWK_BASE_URL = 'https://api.ratehawk.com';
    assert.throws(() => contexts.read(token, 'h-fixture'), /offer_context_expired_or_changed/);
});

test('hotelpage to prebook preserves trusted identity without any lookuprate call', async context => {
    const { criteria, hotels, rate } = fixture(context);
    context.mock.method(ratehawk.client, 'getHotelPageRates', async () => ({ hotels }));
    context.mock.method(ratehawk.client, 'lookupRateInfo', () => { throw new Error('must_not_lookup'); });
    const page = await ratehawk.getHotelPageRates(criteria, { now: new Date('2099-10-01T00:00:00Z') });
    const source = page.hotels[0].rates[0].offer_context;
    const sourceInfo = contexts.read(source, 'h-fixture');
    const prebook = context.mock.method(ratehawk.client, 'prebookRate', async (hash, percent) => {
        assert.equal(hash, 'h-fixture'); assert.equal(percent, 10);
        return { hotels: [{ hid: 123, rates: [{ ...rate, book_hash: 'p-fixture' }] }] };
    });
    const result = await ratehawk.validatePrebookRate('h-fixture', 10, source);
    const verified = ratehawk.getCheckoutRateContext(result.prebook_context, 'p-fixture');
    assert.equal(verified.context_kind, 'prebook');
    assert.deepEqual(verified.original_request_params, sourceInfo.original_request_params);
    assert.equal(verified.context_expires_at, sourceInfo.context_expires_at);
    assert.equal(prebook.mock.callCount(), 1);
    await assert.rejects(ratehawk.validatePrebookRate('h-other', 10, source), /offer_context_expired_or_changed/);
    assert.equal(prebook.mock.callCount(), 1);
});

test('prebook rejects a different hotel or room instead of minting trusted proof', async context => {
    const { criteria, hotels, rate } = fixture(context);
    const source = contexts.attachHotelpage(hotels, criteria)[0].rates[0].offer_context;
    for (const [hid, room_name] of [[456, rate.room_name], [123, 'Different room']]) {
        const stub = context.mock.method(ratehawk.client, 'prebookRate', async () => ({ hotels: [
            { hid, rates: [{ ...rate, book_hash: 'p-fixture', room_name }] }
        ] }));
        await assert.rejects(ratehawk.validatePrebookRate('h-fixture', 10, source), /offer_identity_mismatch/);
        stub.mock.restore();
    }
});

test('prebook tolerance is server configured with a normal default of two percent', context => {
    const previous = process.env.RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT;
    context.after(() => { if (previous === undefined) delete process.env.RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT;
        else process.env.RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT = previous; });
    delete process.env.RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT;
    assert.equal(ratehawk.prebookPriceIncreasePercent(), 2);
    process.env.RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT = '10';
    assert.equal(ratehawk.prebookPriceIncreasePercent(), 10);
    process.env.RATEHAWK_PREBOOK_PRICE_INCREASE_PERCENT = 'invalid';
    assert.throws(() => ratehawk.prebookPriceIncreasePercent(), /invalid_prebook_price_policy/);
});

test('customer currency quotes cannot outlive their verified offer context', async context => {
    const { criteria, hotels } = fixture(context);
    const now = Date.now();
    const expiry = now + 10000;
    const source = contexts.issue({ original_request_params: criteria, hotels }, 'hotelpage', { now, expiresAt: expiry });
    const quote = await require('./services/checkoutCurrencyService').createQuote({ ...criteria,
        book_hash: 'h-fixture', roomName: 'Double room', total: 107,
        payment_currency: 'USD', offer_context: source
    }, { role: 'user', subject: 'fixture-user', realm: 'fixture' }, { now,
        fetcher: () => { throw new Error('same_currency_must_not_fetch'); } });
    assert.equal(quote.expires_at, expiry);
});

test('post-booking history waits thirty seconds after final status and is never a status check', async context => {
    fixture(context);
    const mongoose = require('mongoose');
    const Model = require('./models/BookingProcess');
    const previous = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });
    context.after(() => { if (previous) Object.defineProperty(mongoose.connection, 'readyState', previous);
        else delete mongoose.connection.readyState; });
    let current = Date.now();
    const confirmedAt = current;
    context.mock.method(Date, 'now', () => current);
    let process = { state: 'processing' };
    context.mock.method(Model, 'findOne', () => ({ lean: async () => process }));
    const info = context.mock.method(ratehawk.client, 'orderInfo', async () => ({ ok: true, status: 'ok', httpStatus: 200,
        data: { orders: [{ partner_data: { order_id: 'fixture-partner' }, status: 'completed' }],
            current_page_number: 1, total_orders: 1, total_pages: 1, found_orders: 1, found_pages: 1 } }));
    assert.equal((await ratehawk.getOrderInfo('fixture-partner')).pending, true);
    process = { state: 'confirmed', confirmed_at: new Date(confirmedAt) };
    current += 29999;
    assert.equal((await ratehawk.getOrderInfo('fixture-partner')).pending, true);
    assert.equal(info.mock.callCount(), 0);
    current += 1;
    assert.equal((await ratehawk.getOrderInfo('fixture-partner')).status, 'completed');
    assert.equal(info.mock.callCount(), 1);
});

test('legacy hotel information uses synchronized local content without supplier requests', async context => {
    fixture(context);
    const Hotel = require('./models/Hotel');
    context.mock.method(ratehawk.client, 'getSingleHotelInfo', () => { throw new Error('must_not_fetch_static'); });
    context.mock.method(Hotel, 'findOne', filter => {
        assert.deepEqual(filter, { provider: 'ratehawk', hid: '123' });
        return { lean: async () => ({ hid: '123', hotelId: 'fixture-hotel', name: 'Local Hotel',
            staticData: { metapolicy_extra_info: 'Passport required' } }) };
    });
    const result = await ratehawk.getSingleHotelInfo(123);
    assert.equal(result.name, 'Local Hotel');
    assert.equal(result.metapolicy_extra_info, 'Passport required');
});
