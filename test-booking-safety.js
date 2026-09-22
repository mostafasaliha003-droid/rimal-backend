const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveValidatedPayment } = require('./services/paymentService');

const expected = { hid: 123, total: 250, currency: 'AED' };
const result = () => ({ hotels: [{ hid: 123, rates: [{ book_hash: 'verified', payment_options: { payment_types: [{ type: 'deposit', amount: '250.00', currency_code: 'AED' }] } }] }] });

test('contract transports use private single-attempt GET requests without payload logging or redirects', async context => {
    const axios = require('axios');
    const logger = require('./services/loggerService');
    const modulePath = require.resolve('./services/ratehawkClient');
    const previousModule = require.cache[modulePath];
    const previousId = process.env.RATEHAWK_KEY_ID;
    const previousKey = process.env.RATEHAWK_API_KEY;
    context.after(() => {
        if (previousModule) require.cache[modulePath] = previousModule;
        else delete require.cache[modulePath];
        if (previousId === undefined) delete process.env.RATEHAWK_KEY_ID;
        else process.env.RATEHAWK_KEY_ID = previousId;
        if (previousKey === undefined) delete process.env.RATEHAWK_API_KEY;
        else process.env.RATEHAWK_API_KEY = previousKey;
    });
    let response;
    const request = context.mock.fn(async config => {
        assert.equal(config.method, 'get');
        assert.equal(config.data, undefined);
        assert.equal(config.params, undefined);
        assert.equal(config.maxRedirects, 0);
        assert.equal(config.auth.username, 'fixture-id');
        assert.equal(config.auth.password, 'fixture-key');
        if (response instanceof Error) throw response;
        return response;
    });
    context.mock.method(axios, 'create', () => ({ request, getUri: config => config.url }));
    const exchange = context.mock.method(logger, 'logEtgExchange', entry => {
        assert.equal(entry.requestPayload, null);
        assert.equal(entry.responsePayload, null);
        assert.doesNotMatch(JSON.stringify(entry), /private-/);
    });
    context.mock.method(logger, 'warn', (...args) => assert.doesNotMatch(JSON.stringify(args), /private-/));
    context.mock.method(logger, 'error', (...args) => assert.doesNotMatch(JSON.stringify(args), /private-/));
    process.env.RATEHAWK_KEY_ID = 'fixture-id';
    process.env.RATEHAWK_API_KEY = 'fixture-key';
    delete require.cache[modulePath];
    const client = require('./services/ratehawkClient');
    for (const [method, endpoint] of [
        ['contractInfo', '/api/b2b/v3/general/contract/data/info/'],
        ['financialInfo', '/api/b2b/v3/general/financial/info/']
    ]) {
        for (const value of [
            { status: 200, data: { status: 'ok', error: null, data: { contract_datas: [{ legal_entity: 'private-company' }], contract: 'private-balance' } } },
            { status: 429, data: { status: 'error', error: 'rate_limit' } },
            { status: 503, data: { status: 'error', error: 'unknown' } },
            { status: 200, data: { status: 'error', error: 'private-error', debug: { validation_error: 'private-debug' } } },
            Object.assign(new Error('private-timeout'), { code: 'ETIMEDOUT', config: { auth: 'private-credentials' }, response: { status: 503, data: 'private-response' } })
        ]) {
            response = value;
            const callsBefore = request.mock.callCount();
            if (response instanceof Error) await assert.rejects(client[method](), /private-timeout/);
            else assert.equal((await client[method]()).httpStatus, response.status);
            assert.equal(request.mock.callCount(), callsBefore + 1);
            assert.equal(request.mock.calls.at(-1).arguments[0].url, endpoint);
        }
    }
    assert.equal(exchange.mock.callCount(), request.mock.callCount());
});

test('contract retrieval preserves agreement and legal entity data without treating termination as an error', async context => {
    const service = require('./services/ratehawkService');
    const contract = {
        active_from: '2018-07-02', agreement_date: '2018-06-29', agreement_number: 'B2B-FIXTURE',
        closing_documents_issuance_type: 'monthly', kind: 'agency',
        legal_entity: { address_actual: 'Fixture actual address', address_legal: 'Fixture legal address', name: 'Fixture Company', taxpayer_id: '00123' },
        terminated_at: null
    };
    const data = { contract_datas: [contract, { ...contract, agreement_number: 'B2B-ENDED', terminated_at: '2025-01-01' }] };
    let response = { ok: true, status: 'ok', error: null, httpStatus: 200, data, debug: { private: 'not returned' } };
    const retrieve = context.mock.method(service.client, 'contractInfo', async (...args) => { assert.equal(args.length, 0); return response; });
    assert.deepEqual(await service.retrieveContract(), { success: true, ...data });
    response.data = { contract_datas: [] };
    assert.deepEqual(await service.retrieveContract(), { success: true, contract_datas: [] });
    for (const invalid of [null, {}, { contract_datas: {} }, { contract_datas: [null] }, { contract_datas: [{ ...contract, legal_entity: null }] }]) {
        response.data = invalid;
        await assert.rejects(service.retrieveContract(), error => error.code === 'invalid_contract_response' && error.httpStatus === 502);
    }
    assert.equal(retrieve.mock.callCount(), 7);
});

test('financial details preserve decimal precision, numeric values, original currencies and per-agreement balances', async context => {
    const service = require('./services/ratehawkService');
    const data = {
        contract: { contract_overpay: '9007199254740993.98', credit_limit: '1451.00', deposit: '1000.00', max_booking_price: '0',
            overdue_debt: '7762.48', reporting_currency: 'EUR', unpaid_non_ref_orders_sum: '9454.93', unpaid_orders_sum: '9507.93', unpaid_ref_orders_sum: '53.00' },
        contract_datas: [{ agreement_number: 'B2B-FIXTURE', overdue_debt: '187.12', overpay: '-130.31',
            unpaid_non_ref_orders_sum: '187.12', unpaid_orders_sum: '204.12', unpaid_ref_orders_sum: '17.00' }]
    };
    let response = { ok: true, status: 'ok', error: null, httpStatus: 200, data, debug: { private: 'not returned' } };
    context.mock.method(service.client, 'financialInfo', async (...args) => { assert.equal(args.length, 0); return response; });
    assert.deepEqual(await service.retrieveFinancialDetails(), { success: true, ...data });
    const numeric = structuredClone(data);
    numeric.contract.deposit = 1000.25;
    numeric.contract.reporting_currency = 'USD';
    numeric.contract_datas[0].overpay = 0;
    response.data = numeric;
    assert.deepEqual(await service.retrieveFinancialDetails(), { success: true, ...numeric });
    for (const invalid of [
        null, {}, { ...data, contract: null }, { ...data, contract_datas: {} }, { ...data, contract_datas: [null] },
        { ...data, contract: { ...data.contract, deposit: undefined } },
        { ...data, contract: { ...data.contract, reporting_currency: '' } },
        { ...data, contract: { ...data.contract, credit_limit: Infinity } },
        { ...data, contract_datas: [{ ...data.contract_datas[0], overpay: 'NaN' }] }
    ]) {
        response.data = invalid;
        await assert.rejects(service.retrieveFinancialDetails(), error => error.code === 'invalid_financial_details_response' && error.httpStatus === 502);
    }
});

test('contract and financial errors fail closed without exposing upstream credentials or debug data', async context => {
    const service = require('./services/ratehawkService');
    for (const [method, transport, kind] of [
        ['retrieveContract', 'contractInfo', 'contract'], ['retrieveFinancialDetails', 'financialInfo', 'financial_details']
    ]) {
        let response;
        const retrieve = context.mock.method(service.client, transport, async () => {
            if (response instanceof Error) throw response;
            return response;
        });
        for (const [value, code, status] of [
            [{ ok: false, status: 'error', error: 'unauthorized', httpStatus: 200 }, 'supplier_unauthorized', 502],
            [{ ok: false, status: 'error', error: 'unknown', httpStatus: 503 }, 'supplier_unknown', 502],
            [{ ok: false, httpStatus: 429, rateLimit: { secondsNumber: 120 } }, 'rate_limit', 429],
            [{ ok: true, status: 'ok', httpStatus: 500, data: {} }, `${kind}_unavailable`, 502],
            [{ ok: true, status: 'ok', httpStatus: 200, error: 'private-error', data: {} }, `${kind}_unavailable`, 502],
            [undefined, `${kind}_unavailable`, 502],
            [Object.assign(new Error('private-transport'), { config: { auth: 'private-key' }, code: 'ETIMEDOUT' }), `${kind}_unavailable`, 502],
            [Object.assign(new Error('private-credentials'), { ratehawkError: 'incorrect_credentials', httpStatus: 401 }), 'supplier_unauthorized', 502]
        ]) {
            response = value;
            await assert.rejects(service[method](), error => {
                assert.equal(error.code, code);
                assert.equal(error.httpStatus, status);
                assert.equal(error.config, undefined);
                assert.equal(error.cause, undefined);
                assert.doesNotMatch(error.message + JSON.stringify(error), /private-/);
                if (status === 429) assert.equal(error.retry_after_ms, 120000);
                return true;
            });
        }
        assert.equal(retrieve.mock.callCount(), 8);
    }
});

test('cancellation sends only the documented order ID and preserves supplier financial currencies', async context => {
    const service = require('./services/ratehawkService');
    const amounts = {
        amount_refunded: { amount: '50.00', currency_code: 'EUR' },
        amount_payable: { amount: '42.73', currency_code: 'EUR' },
        amount_sell: { amount: '92.73', currency_code: 'EUR' }
    };
    const cancel = context.mock.method(service.client, 'cancelOrder', async request => {
        assert.deepEqual(request, { partner_order_id: 'fixture-order' });
        return { ok: true, status: 'ok', httpStatus: 200, data: amounts };
    });
    const cancelled = await service.submitCancellation('fixture-order');
    assert.deepEqual(cancelled.amountRefunded, amounts.amount_refunded);
    assert.deepEqual(cancelled.amountPayable, amounts.amount_payable);
    assert.deepEqual(cancelled.amountSell, amounts.amount_sell);
    await assert.rejects(service.submitCancellation(undefined), /invalid_partner_order_id/);
    assert.equal(cancel.mock.callCount(), 1);
});

test('retrieving bookings validates documented filters and preserves pagination, policy and amounts', async context => {
    const service = require('./services/ratehawkService');
    const request = { ordering: { ordering_type: 'asc', ordering_by: 'modified_at' }, pagination: { page_number: 2, page_size: 50 }, language: 'pt_PT', search: {
        created_at: { from_date: '2026-09-01T00:00', to_date: '2026-09-30T23:59' },
        paid_at: { from_date: '2026-09-01' }, order_ids: [42], partner_order_ids: ['fixture-order'], status: 'completed', source: 'b2b-api'
    } };
    const order = { order_id: 42, partner_data: { order_id: 'fixture-order' }, status: 'completed', is_cancellable: true,
        amount_payable: { amount: '42.73', currency_code: 'EUR' }, cancellation_info: { free_cancellation_before: null, policies: [] }, upsells: [{ name: 'early_checkin' }] };
    const response = { ok: true, httpStatus: 200, data: { current_page_number: 2, total_orders: 300, total_pages: 6, found_orders: 51, found_pages: 2, orders: [order] } };
    const info = context.mock.method(service.client, 'orderInfo', async body => { assert.deepEqual(body, request); return response; });
    const result = await service.retrieveBookings(request);
    assert.deepEqual(result, { success: true, ...response.data });
    for (const invalid of [
        { ...request, pagination: { page_number: 0, page_size: 10 } },
        { ...request, pagination: { page_number: 1, page_size: 51 } },
        { ...request, ordering: { ordering_type: 'desc', ordering_by: 'order_id' } },
        { ...request, search: { status: 'confirmed' } },
        { ...request, search: { unsupported: true } },
        { ...request, search: { order_ids: ['42'] } },
        { ...request, search: { partner_order_ids: [] } },
        { ...request, search: { created_at: { from_date: '2026-02-30' } } },
        { ...request, search: { created_at: { from_date: '2026-09-30', to_date: '2026-09-01' } } }
    ]) await assert.rejects(service.retrieveBookings(invalid));
    assert.equal(info.mock.callCount(), 1);
    info.mock.mockImplementation(async () => ({ ok: false, httpStatus: 200, error: 'page_out_of_range' }));
    await assert.rejects(service.retrieveBookings(), error => error.code === 'page_out_of_range' && error.httpStatus === 400);
});

test('single booking retrieval distinguishes delayed data from an unrelated or malformed order', async context => {
    const service = require('./services/ratehawkService');
    let response = { ok: true, httpStatus: 200, data: { current_page_number: 1, total_orders: 100, total_pages: 10, found_orders: 0, found_pages: 0, orders: [] } };
    context.mock.method(service.client, 'orderInfo', async request => {
        assert.deepEqual(request.search, { partner_order_ids: ['fixture-order'] });
        return response;
    });
    const pending = await service.getOrderInfo('fixture-order');
    assert.equal(pending.pending, true);
    assert.equal(pending.order, null);
    assert.equal(pending.retry_after_ms, 60000);
    response.data.orders = [{ partner_data: { order_id: 'other-order' }, status: 'completed' }];
    assert.equal((await service.getOrderInfo('fixture-order')).error, 'order_info_mismatch');
    response.data.orders[0].partner_data.order_id = 'fixture-order';
    response.data.found_orders = 1;
    const found = await service.getOrderInfo('fixture-order');
    assert.equal(found.pending, false);
    assert.equal(found.found, 1);
    assert.equal(found.status, 'completed');
    response = { ok: true, httpStatus: 200, data: null };
    assert.equal((await service.getOrderInfo('fixture-order')).success, false);
    response = { ok: false, httpStatus: 429 };
    assert.equal((await service.getOrderInfo('fixture-order')).error, 'rate_limit');
});

test('single booking retrieval syncs the documented hotel confirmation number without inventing one', async context => {
    const service = require('./services/ratehawkService');
    const mongoose = require('mongoose');
    let saves = 0;
    const booking = { save: async () => { saves += 1; } };
    context.mock.method(mongoose, 'model', name => {
        assert.equal(name, 'Booking');
        return { findOne: async filter => {
            assert.equal(filter.provider, 'ratehawk');
            assert.deepEqual(filter.$or, [{ supplierReference: 'fixture-order' }, { bookingReference: 'fixture-order' }]);
            return booking;
        } };
    });
    const order = { order_id: 42, partner_data: { order_id: 'fixture-order' }, hotel_data: { order_id: 'HOTEL-HCN-42' } };
    context.mock.method(service.client, 'orderInfo', async () => ({ ok: true, httpStatus: 200, data: {
        current_page_number: 1, total_orders: 10, total_pages: 1, found_orders: 1, found_pages: 1, orders: [order]
    } }));
    const found = await service.getOrderInfo('fixture-order');
    assert.equal(found.hotelConfirmationNumber, 'HOTEL-HCN-42');
    assert.equal(found.databaseUpdated, true);
    assert.equal(booking.hotelConfirmationNumber, 'HOTEL-HCN-42');
    order.hotel_data.order_id = null;
    assert.equal((await service.getOrderInfo('fixture-order')).hotelConfirmationNumber, null);
    assert.equal(saves, 1);
});

test('ambiguous cancellation results stay pending without retrying or claiming a refund', async context => {
    const service = require('./services/ratehawkService');
    let response;
    const cancel = context.mock.method(service.client, 'cancelOrder', async () => {
        if (response instanceof Error) throw response;
        return response;
    });
    for (const value of [
        { httpStatus: 503, status: 'error', error: 'unknown' }, { httpStatus: 429 },
        { httpStatus: 200, status: 'error', error: 'lock' }, { httpStatus: 200, status: 'ok', ok: true, data: {} },
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    ]) {
        response = value;
        assert.deepEqual(await service.submitCancellation('fixture-order'), { success: false, pending: true, status: 'cancel_pending' });
    }
    assert.equal(cancel.mock.callCount(), 5);
    for (const code of ['order_not_found', 'order_not_cancellable', 'sandbox_restriction']) {
        response = { httpStatus: 200, status: 'error', error: code };
        assert.deepEqual(await service.submitCancellation('fixture-order'), { success: false, pending: false, status: 'cancel_failed', error: code });
    }
});

test('durable cancellation requires the current penalty, claims once and recovers unknown outcomes by reading only', async context => {
    const store = require('./models/BookingCancellation');
    const processes = require('./models/BookingProcess');
    const service = require('./services/ratehawkService');
    const postBooking = require('./services/postBookingService');
    const previous = process.env.RATEHAWK_CANCELLATION_ENABLED;
    let record;
    let time = Date.parse('2026-09-23T12:00:00Z');
    context.mock.method(Date, 'now', () => time);
    context.mock.method(store, 'findById', () => ({ lean: async () => record && structuredClone(record) }));
    const create = context.mock.method(store, 'create', async value => {
        if (record) throw Object.assign(new Error('duplicate'), { code: 11000 });
        record = structuredClone(value);
    });
    context.mock.method(store, 'findOneAndUpdate', (filter, update) => ({ lean: async () => {
        if (filter.state.$in ? !filter.state.$in.includes(record.state) : filter.state !== record.state) return null;
        if (filter.check_lease_id && filter.check_lease_id !== record.check_lease_id) return null;
        if (update.$set.check_lease_id && (Number(record.next_check_at) > time || Number(record.check_lease_until) > time)) return null;
        Object.assign(record, update.$set);
        for (const key of Object.keys(update.$unset || {})) delete record[key];
        return structuredClone(record);
    } }));
    const synced = context.mock.method(processes, 'updateOne', async (filter, update) => {
        assert.equal(filter.partner_order_id, 'fixture-order');
        assert.equal(update.$set.state, 'cancelled');
    });
    let info = { success: true, pending: false, status: 'completed', isCancellable: true, upsells: [], order: { cancellation_info: { policies: [
        { start_at: null, end_at: '2026-09-23T12:00:00', penalty: { amount: '0.00', currency_code: 'EUR' } },
        { start_at: '2026-09-23T12:00:00', end_at: null, penalty: { amount: '42.73', currency_code: 'EUR' } }
    ] } } };
    context.mock.method(service, 'getOrderInfo', async () => info);
    const submit = context.mock.method(service, 'submitCancellation', async () => {
        assert.equal(record.state, 'cancelling');
        return { success: false, pending: true, status: 'cancel_pending' };
    });
    const options = { confirm_cancellation: true, expected_penalty: { amount: '42.73', currency_code: 'EUR' } };
    try {
        delete process.env.RATEHAWK_CANCELLATION_ENABLED;
        await assert.rejects(postBooking.cancelBooking('fixture-order', options), /cancellation_disabled/);
        process.env.RATEHAWK_CANCELLATION_ENABLED = 'true';
        await assert.rejects(postBooking.cancelBooking('fixture-order', { ...options, confirm_cancellation: false }), /cancellation_confirmation_required/);
        await assert.rejects(postBooking.cancelBooking('fixture-order', { ...options, expected_penalty: { amount: '0.00', currency_code: 'EUR' } }), /cancellation_penalty_changed/);
        await assert.rejects(postBooking.cancelBooking('fixture-order', { ...options, expected_penalty: { amount: '42.73', currency_code: 'USD' } }), /cancellation_penalty_changed/);
        info.upsells = [{ name: 'early_checkin' }];
        await assert.rejects(postBooking.cancelBooking('fixture-order', options), /upsells_acknowledgement_required/);
        assert.equal(submit.mock.callCount(), 0);
        options.acknowledge_upsells = true;
        const results = await Promise.all([postBooking.cancelBooking('fixture-order', options), postBooking.cancelBooking('fixture-order', options)]);
        assert.ok(results.every(result => result.pending && !result.success));
        assert.equal(submit.mock.callCount(), 1);
        assert.equal(synced.mock.callCount(), 0);
        delete process.env.RATEHAWK_CANCELLATION_ENABLED;
        assert.equal((await postBooking.cancelBooking('fixture-order', options)).status, 'cancel_pending');
        time = Number(record.next_check_at);
        const due = context.mock.method(store, 'find', filter => {
            assert.deepEqual(filter.state.$in, ['cancelling', 'cancel_pending']);
            return { select: () => ({ sort: () => ({ limit: limit => {
                assert.equal(limit, 10);
                return { lean: async () => [{ _id: 'fixture-order' }] };
            } }) }) };
        });
        assert.deepEqual(await postBooking.reconcilePendingCancellations(), { checked: 1, failed: 0 });
        assert.equal(due.mock.callCount(), 1);
        assert.equal(record.state, 'cancel_pending');
        assert.equal(submit.mock.callCount(), 1);
        time = Number(record.next_check_at);
        info = { ...info, status: 'cancelled', amountRefunded: { amount: '50.00', currency_code: 'EUR' }, amountPayable: { amount: '42.73', currency_code: 'EUR' }, amountSell: { amount: '92.73', currency_code: 'EUR' } };
        const recovered = await postBooking.checkCancellation('fixture-order');
        assert.equal(recovered.status, 'cancelled');
        assert.equal(recovered.customer_refund_status, 'not_processed');
        assert.equal(recovered.upsells_require_manual_cancellation, true);
        assert.deepEqual(recovered.amountRefunded, info.amountRefunded);
        assert.equal(submit.mock.callCount(), 1);
        assert.equal(synced.mock.callCount(), 1);
        assert.equal((await postBooking.cancelBooking('fixture-order', options)).success, true);
        assert.equal(submit.mock.callCount(), 1);
        record = undefined;
        info.status = 'completed';
        process.env.RATEHAWK_CANCELLATION_ENABLED = 'true';
        create.mock.mockImplementation(async () => { throw new Error('database unavailable'); });
        await assert.rejects(postBooking.cancelBooking('fixture-order', options), /database unavailable/);
        assert.equal(submit.mock.callCount(), 1);
        const boundary = time + 1;
        info.order.cancellation_info.policies = [
            { start_at: null, end_at: new Date(boundary).toISOString(), penalty: options.expected_penalty },
            { start_at: new Date(boundary).toISOString(), end_at: null, penalty: { amount: '50.00', currency_code: 'EUR' } }
        ];
        create.mock.mockImplementation(async value => { record = structuredClone(value); time = boundary; });
        const changed = await postBooking.cancelBooking('fixture-order', options);
        assert.equal(changed.success, false);
        assert.equal(changed.status, 'cancel_failed');
        assert.equal(changed.error, 'cancellation_penalty_changed');
        assert.equal(submit.mock.callCount(), 1);
    } finally {
        if (previous === undefined) delete process.env.RATEHAWK_CANCELLATION_ENABLED;
        else process.env.RATEHAWK_CANCELLATION_ENABLED = previous;
    }
});

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
        writeUnavailable = false;
        receipt = undefined;
        supplierStatus = 'cancelled';
        assert.equal((await invoke(payload)).statusCode, 200);
        assert.equal(receipt.outcome, 'cancelled');
        assert.equal(receipt.action_required, 'review_customer_refund_and_upsells');
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
        responsePayload: { status: '3ds', data: {
            data_3ds: { action_url: 'https://bank.example?token=private-3ds', data: { PaReq: 'private-pareq' } },
            orders: [{
                user_data: { email: 'private-retrieved-email', user_comment: 'private-user-comment' },
                rooms_data: [{ guest_data: { guests: [{ first_name: 'private-retrieved-name' }] } }],
                partner_data: { order_id: 'fixture-order', order_comment: 'private-order-comment' },
                meta_data: { voucher_order_comment: 'private-voucher-comment' }
            }]
        }, debug: { request: 'private-echo' } },
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
    record.state = 'cancelled';
    const cancelled = await booking.checkProcess(processId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.success, false);
    assert.equal(cancelled.timed_out, false);
    assert.equal(checks.mock.callCount(), count);
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

test('contract HTTP routes require private server authentication and preserve no-store and rate-limit responses', async context => {
    const express = require('express');
    const { createContractRouter } = require('./services/bookingRoutes');
    const service = require('./services/ratehawkService');
    const previous = Object.fromEntries(['RATEHAWK_BOOKING_TOKEN', 'REMAL_SECURE_KEY', 'RATEHAWK_BOOKING_ENABLED', 'RATEHAWK_CANCELLATION_ENABLED'].map(key => [key, process.env[key]]));
    context.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
    const token = 'fixture-private-contract-token-32-characters';
    const contracts = { success: true, contract_datas: [{ agreement_number: 'B2B-FIXTURE', terminated_at: null }] };
    const financials = { success: true, contract: { reporting_currency: 'EUR', deposit: '1234.56' }, contract_datas: [] };
    const retrieve = context.mock.method(service, 'retrieveContract', async (...args) => { assert.equal(args.length, 0); return contracts; });
    const financial = context.mock.method(service, 'retrieveFinancialDetails', async (...args) => { assert.equal(args.length, 0); return financials; });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/contracts', createContractRouter());
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => server.close(resolve)));
    const send = (route = '', headers = {}, method = 'GET') => fetch(`http://127.0.0.1:${server.address().port}/api/v1/contracts${route}`, { method, headers });
    process.env.REMAL_SECURE_KEY = 'public-fixture-key';
    delete process.env.RATEHAWK_BOOKING_ENABLED;
    delete process.env.RATEHAWK_CANCELLATION_ENABLED;
    for (const route of ['', '/financial-details']) {
        delete process.env.RATEHAWK_BOOKING_TOKEN;
        const unconfigured = await send(route);
        assert.equal(unconfigured.status, 503);
        assert.equal(unconfigured.headers.get('cache-control'), 'no-store');
        for (const invalid of ['short', 'public-fixture-key'.repeat(3)]) {
            process.env.RATEHAWK_BOOKING_TOKEN = invalid;
            process.env.REMAL_SECURE_KEY = invalid;
            assert.equal((await send(route, { Authorization: `Bearer ${invalid}` })).status, 503);
        }
        process.env.REMAL_SECURE_KEY = 'public-fixture-key';
        process.env.RATEHAWK_BOOKING_TOKEN = token;
        for (const headers of [{}, { 'x-api-key': process.env.REMAL_SECURE_KEY }, { Authorization: 'Bearer wrong-token' }]) {
            const denied = await send(route, headers);
            assert.equal(denied.status, 401);
            assert.equal(denied.headers.get('cache-control'), 'no-store');
        }
        assert.equal((await send(route, { Authorization: `Bearer ${token}`, Origin: 'https://remalbookings.com' })).status, 403);
        assert.equal((await send(`${route}?contract_id=42`, { Authorization: `Bearer ${token}` })).status, 400);
    }
    assert.equal(retrieve.mock.callCount(), 0);
    assert.equal(financial.mock.callCount(), 0);
    const authorization = { Authorization: `Bearer ${token}` };
    for (const [route, expected] of [['', contracts], ['/financial-details', financials]]) {
        const response = await send(route, authorization);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), expected);
        assert.equal((await send(route, authorization, 'POST')).status, 404);
    }
    assert.equal(retrieve.mock.callCount(), 1);
    assert.equal(financial.mock.callCount(), 1);
    financial.mock.mockImplementation(async () => { throw Object.assign(new Error('rate_limit'), { code: 'rate_limit', httpStatus: 429, retry_after_ms: 120001 }); });
    const limited = await send('/financial-details', authorization);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '121');
    assert.equal(limited.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await limited.json(), { success: false, error: 'rate_limit' });
    retrieve.mock.mockImplementation(async () => { throw Object.assign(new Error('private upstream error'), { config: { auth: 'private-key' } }); });
    const failure = await send('', authorization);
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { success: false, error: 'contract_service_unavailable' });
    retrieve.mock.mockImplementation(async () => { throw Object.assign(new Error('private supplier auth'), { code: 'supplier_unauthorized', httpStatus: 502 }); });
    const supplierAuth = await send('', authorization);
    assert.equal(supplierAuth.status, 502);
    assert.deepEqual(await supplierAuth.json(), { success: false, error: 'supplier_unauthorized' });
});

test('post-booking HTTP routes protect order data and cancellation from browser keys and retire unauthenticated cancellation', async context => {
    const express = require('express');
    const { createPostBookingRouter } = require('./services/bookingRoutes');
    const service = require('./services/ratehawkService');
    const postBooking = require('./services/postBookingService');
    const previous = Object.fromEntries(['RATEHAWK_BOOKING_TOKEN', 'REMAL_SECURE_KEY', 'RATEHAWK_BOOKING_ENABLED', 'RATEHAWK_CANCELLATION_ENABLED'].map(key => [key, process.env[key]]));
    const token = 'fixture-private-post-booking-token-32-characters';
    const retrieve = context.mock.method(service, 'retrieveBookings', async body => ({ success: true, orders: [], ...body }));
    const info = context.mock.method(postBooking, 'getBookingInfo', async orderId => ({ success: true, pending: true, partner_order_id: orderId, order: null }));
    const cancel = context.mock.method(postBooking, 'cancelBooking', async orderId => ({ success: false, pending: true, status: 'cancel_pending', partner_order_id: orderId }));
    context.mock.method(postBooking, 'checkCancellation', async orderId => ({ success: true, pending: false, status: 'cancelled', partner_order_id: orderId, customer_refund_status: 'not_processed' }));
    const app = express();
    app.use(express.json());
    app.use('/api/v1/bookings', createPostBookingRouter());
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    context.after(() => new Promise(resolve => server.close(resolve)));
    const send = (method, route, headers = {}, body = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/v1/bookings/${route}`, {
        method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
    });
    try {
        process.env.RATEHAWK_BOOKING_TOKEN = token;
        process.env.REMAL_SECURE_KEY = 'public-fixture-key';
        delete process.env.RATEHAWK_BOOKING_ENABLED;
        delete process.env.RATEHAWK_CANCELLATION_ENABLED;
        for (const [method, route] of [['POST', 'retrieve'], ['GET', 'fixture-order/info'], ['POST', 'fixture-order/cancel'], ['GET', 'fixture-order/cancel/status'], ['POST', 'cancel']]) {
            assert.equal((await send(method, route)).status, 401);
            assert.equal((await send(method, route, { 'x-api-key': process.env.REMAL_SECURE_KEY })).status, 401);
            assert.equal((await send(method, route, { Authorization: `Bearer ${token}`, Origin: 'https://remalbookings.com' })).status, 403);
        }
        assert.equal(retrieve.mock.callCount(), 0);
        assert.equal(info.mock.callCount(), 0);
        assert.equal(cancel.mock.callCount(), 0);
        const authorization = { Authorization: `Bearer ${token}` };
        const list = await send('POST', 'retrieve', authorization);
        assert.equal(list.status, 200);
        assert.equal(list.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await list.json(), { success: true, orders: [] });
        assert.equal((await send('GET', 'fixture-order/info', authorization)).status, 202);
        assert.equal((await send('POST', 'fixture-order/cancel', authorization)).status, 202);
        assert.equal((await send('GET', 'fixture-order/cancel/status', authorization)).status, 200);
        assert.equal((await send('POST', 'cancel', authorization)).status, 410);
        assert.equal(cancel.mock.callCount(), 1);
        cancel.mock.mockImplementation(async () => ({ success: false, pending: false, status: 'cancel_failed', error: 'order_not_cancellable' }));
        assert.equal((await send('POST', 'fixture-order/cancel', authorization)).status, 409);
        retrieve.mock.mockImplementation(async () => { throw Object.assign(new Error('private transport body'), { config: { auth: 'private' } }); });
        assert.deepEqual(await (await send('POST', 'retrieve', authorization)).json(), { success: false, error: 'booking_service_unavailable' });
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});