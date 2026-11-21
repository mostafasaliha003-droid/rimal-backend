const test = require('node:test');
const assert = require('node:assert/strict');
const { rateSearchResponse } = require('../services/rateSearchResponse');
const { customerPrice } = require('../services/paymentService');

const rate = (amount, currency_code) => ({ book_hash: 'private-offer', payment_options: {
    payment_types: [{ type: 'deposit', amount, currency_code }]
} });
const property = { hid: 10, name: 'City Hotel', address: 'Waterfront', latitude: 25, longitude: 55,
    stars: 4, images: ['a','b','c','d','e'], rates: [rate('80','USD'), rate('40','USD'), rate('10','EUR')],
    resolvedLanguage: 'ar', staticData: { room_groups: ['private-room-data'] } };

test('compact cards retain every property, order and lowest valid customer stay total in the requested currency', () => {
    const unpriced = { ...property, hid: 11, resolvedLanguage: 'en', rates: [
        rate('10','EUR'), { customer_display_amount: 0.01, customer_display_currency: 'USD' }
    ] };
    const result = rateSearchResponse([unpriced, property], { response_view: 'mobile_cards_v1', currency: 'USD', display_language: 'ar' },
        { data: { hotels: [property] }, debug: 'supplier-metadata' });
    const expected = customerPrice(property.rates[1]);
    assert.equal(result.resolved_language, 'mixed');
    assert.equal(result.requested_language, 'ar');
    assert.equal(result.response_view, 'mobile_cards_v1');
    assert.deepEqual(result.hotels.map(card => card.hid), [11,10]);
    assert.deepEqual(result.hotels[0].rates, []);
    assert.deepEqual(result.hotels[1], { hid:10, name:'City Hotel', address:'Waterfront', latitude:25, longitude:55,
        star_rating:4, images:['a','b','c','d'], rates:[{customer_display_amount:expected.amount,customer_display_currency:'USD'}] });
    assert.doesNotMatch(JSON.stringify(result), /book_hash|private-room-data|supplier-metadata|payment_options/);
});

test('compact cards state free cancellation for the shown price separately from other rates, never after the deadline', () => {
    const { mobileHotelCard } = require('../services/rateSearchResponse');
    const now = Date.parse('2099-01-01T00:00:00Z');
    const terms = (amount, before) => { const value = rate(amount, 'USD'); value.payment_options.payment_types[0].cancellation_penalties = { free_cancellation_before: before, policies: [] }; return value; };
    const card = rates => mobileHotelCard({ ...property, rates }, 'USD', now);
    assert.deepEqual([card([terms('40', '2099-02-01T12:00:00'), terms('80', null)])].map(c => [c.free_cancellation, c.lowest_free_cancellation]), [[true, true]]);
    assert.deepEqual([card([terms('40', null), terms('80', '2099-02-01T12:00:00')])].map(c => [c.free_cancellation, c.lowest_free_cancellation]), [[true, false]]);
    assert.deepEqual([card([terms('40', '2098-12-01T12:00:00')])].map(c => [c.free_cancellation, c.lowest_free_cancellation]), [[false, false]]);
    const unknown = card([rate('40', 'USD')]);
    assert.equal('free_cancellation' in unknown, false);
    assert.doesNotMatch(JSON.stringify(card([terms('40', '2099-02-01T12:00:00')])), /payment_options|cancellation_penalties|book_hash/);
});

test('existing search consumers still receive full decorated offers and original ID-search metadata', () => {
    const result = rateSearchResponse([property], { language: 'en' }, { next: 'cursor' });
    assert.equal(result.next, 'cursor');
    assert.equal(result.hotels[0].rates.length, 3);
    assert.equal(result.hotels[0].rates[0].book_hash, 'private-offer');
    assert.deepEqual(result.hotels[0].images, property.images);
    assert.equal(result.hotels[0].rates[1].customer_display_amount, customerPrice(property.rates[1]).amount);
    assert.equal(rateSearchResponse([], {response_view:'mobile_cards_v1'}).resolved_language, 'en');
});

test('all ten checkout currencies keep the same marked-up customer amount from search through prebook, intent and confirmed receipt', () => {
    const { resolveValidatedPayment } = require('../services/paymentService');
    const { minorUnits,validateIntent } = require('../services/ziinaClient');
    const { confirmationDetails } = require('../services/reservationConfirmationService');
    const currencies = require('../shared/paymentCurrencies.json');
    assert.deepEqual(Object.keys(currencies).sort(), ['AED','BHD','EUR','GBP','INR','KWD','OMR','QAR','SAR','USD']);
    for (const [currency, spec] of Object.entries(currencies)) {
        const offer = rate('123.45', currency);
        const expected = { hid:10, total:132.09, currency, roomName:'Suite' };
        assert.deepEqual(customerPrice(offer), { amount:132.09,currency });
        const search = rateSearchResponse([{ ...property,rates:[offer] }], {response_view:'mobile_cards_v1',currency});
        assert.deepEqual(search.hotels[0].rates, [{customer_display_amount:132.09,customer_display_currency:currency}]);
        const validated = resolveValidatedPayment({hotels:[{hid:10,rates:[offer]}]},expected);
        assert.equal(validated.customerAmount,132.09);assert.equal(validated.customerCurrency,currency);
        assert.equal(validated.amount,123.45);assert.equal(validated.currency,currency);
        const customerMinor = minorUnits(validated.customerAmount,currency);
        assert.equal(customerMinor, spec.decimals === 3 ? 132090 : 13209);
        const intent = {id:'fixture-intent',account_id:'fixture-account',operation_id:'fixture-operation',
            status:'completed',amount:customerMinor,currency_code:currency,tip_amount:0,test:true};
        assert.equal(validateIntent(intent,{amount:customerMinor,currency,test:true}), intent);
        assert.throws(()=>validateIntent({...intent, currency_code:currency==='USD'?'EUR':'USD'},{amount:customerMinor,currency}));
        assert.throws(()=>validateIntent({...intent, amount:customerMinor+spec.step},{amount:customerMinor,currency}));
        const booking = {provider:'ratehawk',status:'active',supplierStatus:'CONFIRMED',bookingReference:'fixture-booking',
            supplierReference:'fixture-supplier',email:'guest@example.test',customerName:'Guest',hotelName:'Hotel',roomType:'Suite',
            checkInDate:'2027-01-01',checkOutDate:'2027-01-02',price:validated.customerAmount,priceCurrency:currency};
        const input = {reference:booking.bookingReference,supplierReference:booking.supplierReference,
            email:booking.email, sandbox:true, amountMinor:customerMinor, currency};
        assert.equal(confirmationDetails(booking,input).amount, spec.decimals === 3 ? '132.090':'132.09');
        assert.throws(()=>confirmationDetails(booking,{...input,amountMinor:customerMinor+spec.step}));
        assert.throws(()=>resolveValidatedPayment({hotels:[{hid:10,rates:[offer]}]}, {...expected,total:132.10}),/RATE_CHANGED/);
        assert.throws(()=>resolveValidatedPayment({hotels:[{hid:10,rates:[rate('123.451',currency)]}]},expected),/RATE_CHANGED/);
    }
    assert.throws(()=>customerPrice(rate('125','JPY')), /RATE_CHANGED/);
});
