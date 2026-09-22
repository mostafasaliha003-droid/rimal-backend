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