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

test('existing search consumers still receive full decorated offers and original ID-search metadata', () => {
    const result = rateSearchResponse([property], { language: 'en' }, { next: 'cursor' });
    assert.equal(result.next, 'cursor');
    assert.equal(result.hotels[0].rates.length, 3);
    assert.equal(result.hotels[0].rates[0].book_hash, 'private-offer');
    assert.deepEqual(result.hotels[0].images, property.images);
    assert.equal(result.hotels[0].rates[1].customer_display_amount, customerPrice(property.rates[1]).amount);
    assert.equal(rateSearchResponse([], {response_view:'mobile_cards_v1'}).resolved_language, 'en');
});
