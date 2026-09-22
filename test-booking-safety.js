const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveValidatedPayment } = require('./services/paymentService');

const expected = { hid: 123, total: 250, currency: 'AED' };
const result = () => ({ hotels: [{ hid: 123, rates: [{ book_hash: 'verified', payment_options: { payment_types: [{ type: 'deposit', amount: '250.00', currency_code: 'AED' }] } }] }] });

test('payment uses the supplier amount and refreshed hash', () => {
    assert.deepEqual(resolveValidatedPayment(result(), expected), { amount: 250, currency: 'AED', book_hash: 'verified' });
});

test('rejects tampered amounts, currencies, hotel IDs and unavailable rates', () => {
    for (const override of [{ total: 2 }, { total: NaN }, { currency: 'USD' }, { hid: 456 }]) {
        assert.throws(() => resolveValidatedPayment(result(), { ...expected, ...override }), /RATE_CHANGED/);
    }
    assert.throws(() => resolveValidatedPayment({}, expected), /RATE_CHANGED/);
    assert.throws(() => resolveValidatedPayment({ ...result(), changes: { price_changed: true } }, expected), /RATE_CHANGED/);
});

test('rejects pay-at-hotel rates and ambiguous supplier responses', () => {
    const response = result();
    response.hotels[0].rates[0].payment_options.payment_types[0].type = 'hotel';
    assert.throws(() => resolveValidatedPayment(response, expected), /RATE_CHANGED/);
    response.hotels[0].rates.push(response.hotels[0].rates[0]);
    assert.throws(() => resolveValidatedPayment(response, expected), /RATE_CHANGED/);
});

test('autocomplete falls back to English only for empty localized results', async context => {
    const client = require('./services/ratehawkClient');
    const { getAutocompleteSuggestions } = require('./services/ratehawkService');
    const empty = { hotels: [], regions: [] };
    const english = { hotels: [], regions: [{ id: 6053839, name: 'Dubai' }] };
    const localized = { hotels: [], regions: [{ id: 6053839, name: 'دبي' }] };
    const calls = [];
    let localResponse = empty;
    context.mock.method(client, 'suggestHotelAndRegion', async (query, language) => {
        calls.push({ query, language });
        return language === 'en' ? english : localResponse;
    });
    assert.deepEqual(await getAutocompleteSuggestions('DUBAI', 'ar'), english);
    assert.deepEqual(calls, [{ query: 'DUBAI', language: 'ar' }, { query: 'DUBAI', language: 'en' }]);
    calls.length = 0;
    localResponse = localized;
    assert.deepEqual(await getAutocompleteSuggestions('دبي', 'ar'), localized);
    assert.deepEqual(calls, [{ query: 'دبي', language: 'ar' }]);
    calls.length = 0;
    assert.deepEqual(await getAutocompleteSuggestions('Dubai', 'en'), english);
    assert.deepEqual(calls, [{ query: 'Dubai', language: 'en' }]);
});

test('autocomplete does not mask supplier errors or loop on empty English results', async context => {
    const client = require('./services/ratehawkClient');
    const { getAutocompleteSuggestions } = require('./services/ratehawkService');
    const failure = new Error('supplier unavailable');
    const suggest = context.mock.method(client, 'suggestHotelAndRegion', async () => { throw failure; });
    await assert.rejects(getAutocompleteSuggestions('Dubai', 'ar'), failure);
    assert.equal(suggest.mock.callCount(), 1);
    suggest.mock.mockImplementation(async () => ({ hotels: [], regions: [] }));
    assert.deepEqual(await getAutocompleteSuggestions('Unknown', 'ar'), { hotels: [], regions: [] });
    assert.equal(suggest.mock.callCount(), 3);
});

test('RateHawk webhook signature fails closed and never returns the expected digest', () => {
    const crypto = require('node:crypto');
    const { verifyWebhookSignature, parseWebhook } = require('./services/ratehawkService');
    const previousKey = process.env.RATEHAWK_API_KEY;
    const signature = { timestamp: 1790100000, token: 'fixture-token' };
    try {
        process.env.RATEHAWK_API_KEY = 'fixture-only-key';
        signature.signature = crypto.createHmac('sha256', process.env.RATEHAWK_API_KEY)
            .update(`${signature.timestamp}${signature.token}`).digest('hex');
        assert.deepEqual(verifyWebhookSignature({ signature }), { verified: true });
        for (const invalid of [{}, { ...signature, signature: '0'.repeat(64) }, { ...signature, signature: 'x'.repeat(64) }, { ...signature, timestamp: '1790100000' }]) {
            const result = verifyWebhookSignature({ signature: invalid });
            assert.equal(result.verified, false);
            assert.equal(result.expected, undefined);
        }
        delete process.env.RATEHAWK_API_KEY;
        assert.equal(verifyWebhookSignature({ signature }).verified, false);
        assert.equal(parseWebhook({ data: { partner_order_id: 'fixture-order', status: 'completed' } }).confirmed, true);
        assert.equal(parseWebhook({ data: { partner_order_id: 'fixture-order', status: 'failed' } }).failed, true);
        assert.equal(parseWebhook({ data: { partner_order_id: 'fixture-order', status: 'processing' } }).confirmed, false);
        assert.equal(parseWebhook({ partner_order_id: 'fixture-order', status: 'success' }).confirmed, false);
    } finally {
        if (previousKey === undefined) delete process.env.RATEHAWK_API_KEY;
        else process.env.RATEHAWK_API_KEY = previousKey;
    }
});

test('booking form retries use fresh persisted IDs and stop after ten calls', async context => {
    const service = require('./services/ratehawkService');
    const recorded = [];
    const form = context.mock.method(service.client, 'bookingForm', async request => {
        assert.equal(recorded.at(-1), request.partner_order_id);
        return { ok: false, httpStatus: 503, error: 'unknown' };
    });
    await assert.rejects(service.createBookingProcess({ book_hash: 'p-fixture', user_ip: '192.0.2.1' }, {
        beforeAttempt: async orderId => recorded.push(orderId)
    }));
    assert.equal(form.mock.callCount(), 10);
    assert.equal(new Set(recorded).size, 10);
    form.mock.mockImplementation(async request => ({ ok: true, httpStatus: 200, data: {
        partner_order_id: request.partner_order_id, order_id: 42, item_id: 99,
        payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }]
    } }));
    const result = await service.createBookingProcess({ book_hash: 'p-fixture', user_ip: '192.0.2.1' });
    assert.equal(result.item_id, 99);
    assert.equal(result.payment_types[0].currency_code, 'USD');
    await assert.rejects(service.createBookingProcess({ book_hash: 'p-fixture' }), /invalid_user_ip/);
});

test('booking finish uses supplier payment values and never retries after an ambiguous response', async context => {
    const service = require('./services/ratehawkService');
    const form = { partner_order_id: 'fixture-order', payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] };
    const details = { user: { email: 'fixture@example.com', phone: '+971500000000' }, rooms: [{ guests: [
        { first_name: 'Test', last_name: 'Guest' }, { firstName: 'Test', lastName: 'Child', is_child: true, age: 5 }
    ] }] };
    const finish = context.mock.method(service.client, 'bookingFinish', async request => {
        assert.deepEqual(request.payment_type, { type: 'deposit', amount: '100.00', currency_code: 'USD' });
        assert.equal(request.rooms[0].guests[1].age, 5);
        throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    });
    assert.equal((await service.startBookingProcess(details, form)).status, 'processing');
    assert.equal(finish.mock.callCount(), 1);
    await assert.rejects(service.startBookingProcess({ ...details, payment_type: { type: 'deposit', amount: '1', currency_code: 'USD' } }, form), /incorrect_chosen_payment_type/);
    assert.throws(() => service.buildBookingFinish({ ...details, rooms: [{ guests: [{}] }] }, form), /invalid_guest_first_name/);
    assert.throws(() => service.buildBookingFinish(details, { ...form, payment_types: [{ ...form.payment_types[0], is_need_credit_card_data: true }] }), /credit_card_required/);
    assert.equal(finish.mock.callCount(), 1);
});

test('booking status preserves pending and 3DS states and only confirms a final ok', async context => {
    const service = require('./services/ratehawkService');
    let response = { status: 'processing', httpStatus: 200 };
    const status = context.mock.method(service.client, 'bookingFinishStatus', async () => response);
    assert.deepEqual(await service.checkBookingProcess('fixture-order'), { success: false, status: 'processing', retry_after_ms: 5000 });
    response = { httpStatus: 200, status: '3ds', data: { partner_order_id: 'fixture-order', data_3ds: { action_url: 'https://bank.example/acs', method: 'post', data: { MD: 'fixture', PaReq: 'fixture' } } } };
    const challenge = await service.checkBookingProcess('fixture-order');
    assert.equal(challenge.success, false);
    assert.equal(challenge.status, '3ds');
    assert.equal(challenge.data_3ds.method, 'post');
    response = { status: 'error', error: 'soldout', httpStatus: 200 };
    assert.deepEqual(await service.checkBookingProcess('fixture-order'), { success: false, status: 'failed', error: 'soldout' });
    response = { status: 'ok', httpStatus: 200, data: { partner_order_id: 'fixture-order' } };
    assert.deepEqual(await service.checkBookingProcess('fixture-order'), { success: true, status: 'confirmed' });
    response.data.partner_order_id = 'different-order';
    await assert.rejects(service.checkBookingProcess('fixture-order'), /booking_status_order_mismatch/);
    status.mock.mockImplementation(async () => { throw Object.assign(new Error('network'), { code: 'ECONNRESET' }); });
    assert.equal((await service.checkBookingProcess('fixture-order')).status, 'processing');
});

test('status polling uses five seconds and performs a last-second check without claiming success on timeout', async context => {
    const service = require('./services/ratehawkService');
    let time = 0;
    const times = [];
    context.mock.method(service.client, 'bookingFinishStatus', async () => {
        times.push(time);
        return { status: 'processing', httpStatus: 200 };
    });
    const result = await service.waitForBookingStatus('fixture-order', { maxWaitMs: 12000, now: () => time, sleep: async delay => { time += delay; } });
    assert.deepEqual(times, [0, 5000, 10000, 11000]);
    assert.equal(result.success, false);
    assert.equal(result.status, 'processing');
    assert.equal(result.timed_out, true);
});

test('card tokenization uses item_id, new UUIDs and supplier CVC requirements behind a disabled-by-default gate', async context => {
    const service = require('./services/ratehawkService');
    const previous = process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED;
    const form = { item_id: 99, payment_types: [{ type: 'now', amount: '100.00', currency_code: 'USD', is_need_credit_card_data: true, is_need_cvc: true }] };
    const details = { user_first_name: 'Test', user_last_name: 'Guest', cvc: '123', credit_card_data_core: {
        card_number: '4111111111111111', month: '12', year: '30', card_holder: 'TEST GUEST'
    } };
    const tokenCall = context.mock.method(service.client, 'createCreditCardToken', async request => {
        assert.equal(request.object_id, '99');
        assert.equal(request.is_cvc_required, true);
        assert.equal(request.cvc, '123');
        assert.match(request.init_uuid, /^[a-f\d-]{36}$/);
        assert.match(request.pay_uuid, /^[a-f\d-]{36}$/);
    });
    try {
        delete process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED;
        await assert.rejects(service.createBookingCardToken(details, form), /card_tokenization_disabled/);
        assert.equal(tokenCall.mock.callCount(), 0);
        process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED = 'true';
        await assert.rejects(service.createBookingCardToken({ ...details, cvc: undefined }, form), /invalid_cvc/);
        const first = await service.createBookingCardToken(details, form);
        const second = await service.createBookingCardToken(details, form);
        assert.notEqual(first.init_uuid, second.init_uuid);
        assert.notEqual(first.pay_uuid, second.pay_uuid);
        assert.deepEqual(Object.keys(first).sort(), ['init_uuid', 'pay_uuid']);
    } finally {
        if (previous === undefined) delete process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED;
        else process.env.RATEHAWK_CARD_TOKENIZATION_ENABLED = previous;
    }
});

test('Payota transport never logs cards, follows redirects, retries or exposes Axios errors', async context => {
    const client = require('./services/ratehawkClient');
    const axios = require('axios');
    const logger = require('./services/loggerService');
    const previousId = process.env.RATEHAWK_KEY_ID;
    const previousKey = process.env.RATEHAWK_API_KEY;
    const log = context.mock.method(logger, 'logEtgExchange', () => assert.fail('Card request was logged'));
    const sensitive = { cvc: '123', credit_card_data_core: { card_number: '4111111111111111' } };
    const post = context.mock.method(axios, 'post', async (url, payload, config) => {
        assert.equal(url, 'https://api.payota.net/api/public/v1/manage/init_partners');
        assert.equal(payload, sensitive);
        assert.equal(config.maxRedirects, 0);
        throw Object.assign(new Error('sensitive transport failure'), { config: { data: sensitive } });
    });
    try {
        process.env.RATEHAWK_KEY_ID = 'fixture-id';
        process.env.RATEHAWK_API_KEY = 'fixture-key';
        await assert.rejects(client.createCreditCardToken(sensitive), error => {
            assert.equal(error.code, 'card_tokenization_unknown');
            assert.equal(error.config, undefined);
            assert.equal(error.cause, undefined);
            assert.equal(error.message.includes('4111111111111111'), false);
            return true;
        });
        assert.equal(post.mock.callCount(), 1);
        assert.equal(log.mock.callCount(), 0);
        post.mock.mockImplementation(async () => ({ status: 200, data: { status: 'ok' } }));
        assert.equal(await client.createCreditCardToken(sensitive), undefined);
    } finally {
        if (previousId === undefined) delete process.env.RATEHAWK_KEY_ID;
        else process.env.RATEHAWK_KEY_ID = previousId;
        if (previousKey === undefined) delete process.env.RATEHAWK_API_KEY;
        else process.env.RATEHAWK_API_KEY = previousKey;
    }
});

test('durable form state deduplicates requests and refuses a changed idempotency payload', async context => {
    const store = require('./models/BookingProcess');
    const booking = require('./services/bookingProcessService');
    const service = require('./services/ratehawkService');
    const previous = process.env.RATEHAWK_BOOKING_ENABLED;
    let record;
    context.mock.method(store, 'findById', () => ({ lean: async () => record && structuredClone(record) }));
    context.mock.method(store, 'create', async value => { record = structuredClone(value); });
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        assert.equal(filter.state, 'creating');
        Object.assign(record, update.$set);
        if (update.$push) record.attempt_order_ids = [...(record.attempt_order_ids || []), update.$push.attempt_order_ids];
        return structuredClone(record);
    } }));
    const form = context.mock.method(service, 'createBookingProcess', async (request, options) => {
        assert.equal(record.state, 'creating');
        await options.beforeAttempt('fixture-order');
        assert.equal(record.partner_order_id, 'fixture-order');
        return { partner_order_id: 'fixture-order', order_id: 42, payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] };
    });
    const details = { book_hash: 'p-fixture', user_ip: '192.0.2.1', guests: [{ adults: 1, children: [5] }] };
    try {
        delete process.env.RATEHAWK_BOOKING_ENABLED;
        await assert.rejects(booking.createProcess(details, 'fixture-idempotency-key'), /booking_disabled/);
        process.env.RATEHAWK_BOOKING_ENABLED = 'true';
        const first = await booking.createProcess(details, 'fixture-idempotency-key');
        const repeat = await booking.createProcess(details, 'fixture-idempotency-key');
        assert.equal(first.process_id, repeat.process_id);
        assert.equal(repeat.status, 'form_ready');
        assert.equal(repeat.success, false);
        assert.equal(form.mock.callCount(), 1);
        assert.equal(JSON.stringify(record).includes('p-fixture'), false);
        await assert.rejects(booking.createProcess({ ...details, book_hash: 'p-different' }, 'fixture-idempotency-key'), /idempotency_conflict/);
    } finally {
        if (previous === undefined) delete process.env.RATEHAWK_BOOKING_ENABLED;
        else process.env.RATEHAWK_BOOKING_ENABLED = previous;
    }
});

test('durable finish claims before sending and suppresses concurrent and restarted retries', async context => {
    const store = require('./models/BookingProcess');
    const booking = require('./services/bookingProcessService');
    const service = require('./services/ratehawkService');
    const previous = process.env.RATEHAWK_BOOKING_ENABLED;
    const processId = 'a'.repeat(64);
    const record = { _id: processId, state: 'form_ready', language: 'en', guests: [{ adults: 1, children: [5] }], form_expires_at: new Date(Date.now() + 60000),
        form: { partner_order_id: 'fixture-order', order_id: 42, payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } };
    context.mock.method(store, 'findById', () => ({ lean: async () => structuredClone(record) }));
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter.state !== record.state || record.finish_hash) return null;
        Object.assign(record, update.$set);
        return structuredClone(record);
    } }));
    context.mock.method(store, 'updateOne', async (filter, update) => {
        if (filter.state === record.state) Object.assign(record, update.$set);
    });
    const finish = context.mock.method(service, 'startBookingProcess', async () => {
        assert.equal(record.state, 'finishing');
        assert.ok(record.finish_sent_at);
        assert.match(record.finish_hash, /^[a-f\d]{64}$/);
        throw new Error('connection lost after sending');
    });
    const details = { user: { email: 'fixture@example.com', phone: '+971500000000' }, rooms: [{ guests: [
        { first_name: 'Test', last_name: 'Guest' }, { first_name: 'Test', last_name: 'Child', is_child: true, age: 5 }
    ] }] };
    try {
        process.env.RATEHAWK_BOOKING_ENABLED = 'true';
        await assert.rejects(booking.finishProcess(processId, { ...details, rooms: [{ guests: [details.rooms[0].guests[0]] }] }), /guest_occupancy_mismatch/);
        assert.equal(finish.mock.callCount(), 0);
        const results = await Promise.all([booking.finishProcess(processId, details), booking.finishProcess(processId, details)]);
        assert.ok(results.every(result => !result.success));
        const restarted = await booking.finishProcess(processId, details);
        assert.equal(restarted.status, 'processing');
        assert.equal(finish.mock.callCount(), 1);
        assert.equal(JSON.stringify(record).includes('fixture@example.com'), false);
        await assert.rejects(booking.finishProcess(processId, { ...details, user: { ...details.user, phone: '+971511111111' } }), /idempotency_conflict/);
    } finally {
        if (previous === undefined) delete process.env.RATEHAWK_BOOKING_ENABLED;
        else process.env.RATEHAWK_BOOKING_ENABLED = previous;
    }
});

test('booking HTTP endpoints reject browser keys, fail closed and allow private status checks after disabling new bookings', async context => {
    const express = require('express');
    const booking = require('./services/bookingProcessService');
    const createBookingRouter = require('./services/bookingRoutes');
    const previous = Object.fromEntries(['RATEHAWK_BOOKING_TOKEN', 'RATEHAWK_BOOKING_ENABLED', 'REMAL_SECURE_KEY'].map(key => [key, process.env[key]]));
    const token = 'fixture-private-server-token-32-characters';
    const created = { process_id: 'a'.repeat(64), status: 'form_ready', success: false };
    const create = context.mock.method(booking, 'createProcess', async (body, key) => {
        assert.equal(key, 'fixture-idempotency-key');
        assert.equal(body.user_ip, '192.0.2.1');
        return created;
    });
    context.mock.method(booking, 'checkProcess', async () => ({ ...created, status: 'processing' }));
    const app = express();
    app.use(express.json());
    app.use('/api/booking', createBookingRouter());
    app.post('/api/booking/prebook', (req, res) => res.json({ public_prebook: true }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => server.close(resolve)));
    const send = (route, headers = {}, body = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/booking/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    try {
        process.env.REMAL_SECURE_KEY = 'public-fixture-key';
        delete process.env.RATEHAWK_BOOKING_TOKEN;
        assert.equal((await send('form')).status, 503);
        process.env.RATEHAWK_BOOKING_TOKEN = token;
        for (const route of ['form', 'card-token', 'finish', 'status']) {
            assert.equal((await send(route, { 'x-api-key': process.env.REMAL_SECURE_KEY })).status, 401);
        }
        assert.equal((await send('form', { Authorization: `Bearer ${token}`, Origin: 'https://remalbookings.com' })).status, 403);
        delete process.env.RATEHAWK_BOOKING_ENABLED;
        assert.equal((await send('form', { Authorization: `Bearer ${token}` })).status, 503);
        assert.equal(create.mock.callCount(), 0);
        const status = await send('status', { Authorization: `Bearer ${token}` }, { process_id: created.process_id });
        assert.equal(status.status, 202);
        assert.equal(status.headers.get('cache-control'), 'no-store');
        assert.equal((await status.json()).success, false);
        process.env.RATEHAWK_BOOKING_ENABLED = 'true';
        const result = await send('form', { Authorization: `Bearer ${token}`, 'Idempotency-Key': 'fixture-idempotency-key' }, { user_ip: '192.0.2.1' });
        assert.equal(result.status, 200);
        assert.deepEqual(await result.json(), created);
        create.mock.mockImplementation(async () => { throw Object.assign(new Error('private error and card data'), { config: { data: 'private' } }); });
        const failure = await send('form', { Authorization: `Bearer ${token}` });
        assert.equal(failure.status, 503);
        assert.deepEqual(await failure.json(), { success: false, error: 'booking_service_unavailable' });
        assert.deepEqual(await (await send('prebook')).json(), { public_prebook: true });
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test('webhooks authenticate before storage, recheck supplier status, persist before acknowledgement and reject altered replays', async context => {
    const crypto = require('node:crypto');
    const receipts = require('./models/BookingWebhook');
    const store = require('./models/BookingProcess');
    const booking = require('./services/bookingProcessService');
    const webhook = require('./services/webhookService');
    const previous = process.env.RATEHAWK_API_KEY;
    let receipt;
    let databaseUnavailable = false;
    let writeUnavailable = false;
    let supplierStatus = 'processing';
    const reads = context.mock.method(receipts, 'findById', () => ({ lean: async () => {
        if (databaseUnavailable) throw new Error('private database connection data');
        return receipt && structuredClone(receipt);
    } }));
    context.mock.method(receipts, 'create', async value => { receipt = structuredClone(value); return receipt; });
    context.mock.method(receipts, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (receipt.lease_id || receipt.state === 'processed') return null;
        Object.assign(receipt, update.$set);
        return structuredClone(receipt);
    } }));
    context.mock.method(receipts, 'updateOne', async (filter, update) => {
        if (writeUnavailable) throw new Error('write unavailable');
        if (receipt.lease_id !== filter.lease_id) return { matchedCount: 0 };
        Object.assign(receipt, update.$set);
        for (const key of Object.keys(update.$unset || {})) delete receipt[key];
        return { matchedCount: 1 };
    });
    context.mock.method(store, 'findOne', () => ({ lean: async () => ({ _id: 'a'.repeat(64) }) }));
    const check = context.mock.method(booking, 'checkProcess', async () => ({ status: supplierStatus, success: supplierStatus === 'confirmed' }));
    const invoke = async payload => {
        const response = { headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
        await webhook.receiveRateHawkWebhook({ body: payload }, response);
        return response;
    };
    try {
        process.env.RATEHAWK_API_KEY = 'fixture-only-key';
        const payload = { data: { partner_order_id: 'fixture-order', status: 'completed' }, signature: { timestamp: Math.floor(Date.now() / 1000) - 3 * 86400, token: 'fixture-retry-token' } };
        payload.signature.signature = crypto.createHmac('sha256', process.env.RATEHAWK_API_KEY)
            .update(`${payload.signature.timestamp}${payload.signature.token}`).digest('hex');
        assert.equal((await invoke({ ...payload, signature: { ...payload.signature, signature: '0'.repeat(64) } })).statusCode, 401);
        assert.equal(reads.mock.callCount(), 0);
        assert.equal(check.mock.callCount(), 0);
        const pending = await invoke(payload);
        assert.equal(pending.statusCode, 503);
        assert.equal(receipt.state, 'received');
        assert.equal(pending.headers['Retry-After'], '30');
        supplierStatus = 'failed';
        const processed = await invoke(payload);
        assert.equal(processed.statusCode, 200);
        assert.equal(receipt.state, 'processed');
        assert.equal(receipt.outcome, 'failed');
        assert.equal(receipt.action_required, 'review_payment_and_refund');
        const calls = check.mock.callCount();
        assert.equal((await invoke(payload)).body.duplicate, true);
        assert.equal(check.mock.callCount(), calls);
        assert.equal((await invoke({ ...payload, data: { ...payload.data, partner_order_id: 'other-order' } })).statusCode, 409);
        databaseUnavailable = true;
        const unavailable = await invoke(payload);
        assert.equal(unavailable.statusCode, 503);
        assert.deepEqual(unavailable.body, { success: false, error: 'webhook_service_unavailable' });
        databaseUnavailable = false;
        receipt = undefined;
        writeUnavailable = true;
        assert.equal((await invoke(payload)).statusCode, 503);
        assert.notEqual(receipt.state, 'processed');
    } finally {
        if (previous === undefined) delete process.env.RATEHAWK_API_KEY;
        else process.env.RATEHAWK_API_KEY = previous;
    }
});

test('supplier exchange logs redact guest, card, challenge and echoed debug data', context => {
    const fs = require('node:fs');
    const logger = require('./services/loggerService');
    let entry;
    context.mock.method(fs, 'mkdirSync', () => {});
    context.mock.method(fs, 'existsSync', () => false);
    context.mock.method(fs, 'appendFileSync', (file, line) => { entry = JSON.parse(line); });
    logger.logEtgExchange({
        method: 'post', url: 'https://api.example/hotel/order/booking/finish/?token=private-query',
        headers: { Authorization: 'private-auth', Cookie: 'private-cookie' },
        requestPayload: {
            partner: { partner_order_id: 'fixture-order' },
            user: { email: 'private-email', phone: 'private-phone', comment: 'private-comment' },
            rooms: [{ guests: [{ first_name: 'private-first', last_name: 'private-last', is_child: false }] }],
            payment_type: { type: 'now', amount: '100.00', currency_code: 'USD', init_uuid: 'private-init', pay_uuid: 'private-pay' },
            credit_card_data_core: { card_number: '4111111111111111' }, cvc: '123'
        },
        responsePayload: { status: '3ds', data: { data_3ds: { action_url: 'https://bank.example?token=private-3ds', data: { PaReq: 'private-pareq' } } }, debug: { request: 'private-echo' } },
        error: { code: 'ETIMEDOUT', message: 'private-transport', config: { data: 'private-config' } },
        statusCode: 200, latencyMs: 10
    });
    assert.doesNotMatch(JSON.stringify(entry), /private-|4111111111111111|"123"/);
    assert.equal(entry.partnerOrderId, 'fixture-order');
    assert.equal(entry.requestPayload.payment_type.amount, '100.00');
    assert.equal(entry.responsePayload.status, '3ds');
    assert.equal(entry.error.code, 'ETIMEDOUT');
});

test('durable status checks serialize polling, preserve 3DS and recover due processes without resubmitting finish', async context => {
    const store = require('./models/BookingProcess');
    const booking = require('./services/bookingProcessService');
    const service = require('./services/ratehawkService');
    let time = 0;
    context.mock.method(Date, 'now', () => time);
    const processId = 'b'.repeat(64);
    const record = { _id: processId, partner_order_id: 'fixture-order', state: 'processing',
        booking_deadline_at: new Date(12000), next_check_at: new Date(0) };
    context.mock.method(store, 'findById', () => ({ lean: async () => structuredClone(record) }));
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (!filter.state.$in.includes(record.state) || Number(record.next_check_at) > time
            || Number(record.check_lease_until) > time) return null;
        Object.assign(record, update.$set);
        return structuredClone(record);
    } }));
    context.mock.method(store, 'updateOne', async (filter, update) => {
        if (record.check_lease_id !== filter.check_lease_id || !filter.state.$in.includes(record.state)) return { matchedCount: 0 };
        Object.assign(record, update.$set);
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return { matchedCount: 1 };
    });
    let response = { success: false, status: 'processing', retry_after_ms: 5000 };
    const checks = context.mock.method(service, 'checkBookingProcess', async () => response);
    const finish = context.mock.method(service, 'startBookingProcess', async () => assert.fail('Recovery must not resend finish'));
    await Promise.all([booking.checkProcess(processId), booking.checkProcess(processId)]);
    assert.equal(checks.mock.callCount(), 1);
    assert.equal(Number(record.next_check_at), 5000);
    time = 5000;
    response = { success: false, status: '3ds', data_3ds: { action_url: 'https://bank.example/acs', method: 'post', data: { PaReq: 'fixture' } } };
    const challenge = await booking.checkProcess(processId);
    assert.equal(challenge.status, '3ds');
    assert.equal(challenge.success, false);
    assert.deepEqual(challenge.data_3ds, response.data_3ds);
    time = 10000;
    response = { success: false, status: 'processing', retry_after_ms: 5000 };
    await booking.checkProcess(processId);
    assert.equal(record.data_3ds, undefined);
    assert.equal(Number(record.next_check_at), 11000);
    time = 11000;
    await booking.checkProcess(processId);
    time = Number(record.next_check_at);
    const overdue = await booking.checkProcess(processId);
    assert.equal(overdue.timed_out, true);
    assert.equal(overdue.success, false);
    assert.equal(Number(record.next_check_at), time + 60000);
    const due = context.mock.method(store, 'find', filter => {
        assert.deepEqual(filter.state.$in, ['finishing', 'processing', '3ds']);
        return { select: () => ({ sort: () => ({ limit: limit => {
            assert.equal(limit, 10);
            return { lean: async () => [{ _id: processId }] };
        } }) }) };
    });
    time = Number(record.next_check_at);
    response = { success: true, status: 'confirmed' };
    assert.deepEqual(await booking.reconcilePendingProcesses(), { checked: 1, failed: 0 });
    assert.equal(due.mock.callCount(), 1);
    assert.equal(record.state, 'confirmed');
    const count = checks.mock.callCount();
    assert.equal((await booking.checkProcess(processId)).success, true);
    assert.equal(checks.mock.callCount(), count);
    assert.equal(finish.mock.callCount(), 0);
});

test('unknown finish responses stay pending and rate limits are respected', async context => {
    const service = require('./services/ratehawkService');
    const form = { partner_order_id: 'fixture-order', payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] };
    const details = { user: { email: 'fixture@example.com', phone: '+971500000000' }, rooms: [{ guests: [{ first_name: 'Test', last_name: 'Guest' }] }] };
    let response = { httpStatus: 200 };
    const finish = context.mock.method(service.client, 'bookingFinish', async () => response);
    for (const value of [{ httpStatus: 200 }, { httpStatus: 200, status: 'processing' }, { httpStatus: 503, status: 'error', error: 'unknown' }, { httpStatus: 200, status: 'error', error: 'double_booking_finish' }]) {
        response = value;
        assert.equal((await service.startBookingProcess(details, form)).status, 'processing');
    }
    assert.equal(finish.mock.callCount(), 4);
    response = { httpStatus: 200, status: 'error', error: 'soldout' };
    assert.equal((await service.startBookingProcess(details, form)).status, 'failed');
    const time = 1790100000000;
    context.mock.method(Date, 'now', () => time);
    context.mock.method(service.client, 'bookingFinishStatus', async () => ({ httpStatus: 429, rateLimit: { secondsNumber: 5, reset: String(time / 1000 + 120) } }));
    const limited = await service.checkBookingProcess('fixture-order');
    assert.equal(limited.success, false);
    assert.equal(limited.retry_after_ms, 120000);
});

test('slow status calls still leave time for a final request', async context => {
    const service = require('./services/ratehawkService');
    let time = 0;
    const checks = context.mock.method(service.client, 'bookingFinishStatus', async (request, options) => {
        if (time === 0) {
            assert.equal(options.timeout, 11000);
            time = 11000;
            throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        }
        assert.equal(options.timeout, 1000);
        return { status: 'ok', httpStatus: 200 };
    });
    const result = await service.waitForBookingStatus('fixture-order', { maxWaitMs: 12000, now: () => time, sleep: async delay => { time += delay; } });
    assert.equal(result.success, true);
    assert.equal(checks.mock.callCount(), 2);
});

test('expired or missing form expiry blocks finish before any supplier call', async context => {
    const store = require('./models/BookingProcess');
    const booking = require('./services/bookingProcessService');
    const service = require('./services/ratehawkService');
    const previous = process.env.RATEHAWK_BOOKING_ENABLED;
    const processId = 'c'.repeat(64);
    const record = { _id: processId, state: 'form_ready', language: 'en', guests: [{ adults: 1, children: [] }],
        form: { partner_order_id: 'fixture-order', payment_types: [{ type: 'deposit', amount: '100.00', currency_code: 'USD' }] } };
    context.mock.method(store, 'findById', () => ({ lean: async () => structuredClone(record) }));
    const updates = context.mock.method(store, 'updateOne', async (filter, update) => assert.equal(update.$set.state, 'expired'));
    const finish = context.mock.method(service, 'startBookingProcess', () => assert.fail('Expired form sent to supplier'));
    const details = { user: { email: 'fixture@example.com', phone: '+971500000000' }, rooms: [{ guests: [{ first_name: 'Test', last_name: 'Guest' }] }] };
    try {
        process.env.RATEHAWK_BOOKING_ENABLED = 'true';
        for (const expiry of [undefined, new Date(Date.now() - 1)]) {
            record.form_expires_at = expiry;
            await assert.rejects(booking.finishProcess(processId, details), /booking_form_expired/);
        }
        assert.equal(updates.mock.callCount(), 2);
        assert.equal(finish.mock.callCount(), 0);
    } finally {
        if (previous === undefined) delete process.env.RATEHAWK_BOOKING_ENABLED;
        else process.env.RATEHAWK_BOOKING_ENABLED = previous;
    }
});