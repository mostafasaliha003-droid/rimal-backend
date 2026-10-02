const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    currencyCode,
    decimalString,
    timestamp,
    normalizeBoard,
    normalizeHotelbedsHotel,
    normalizeRateHawkHotel,
    assessCustomerDisplayEligibility,
    toCustomerDisplayOffer
} = require('./services/offerNormalizationService');

function savedHotelbedsHotel() {
    const payloadPath = path.join(__dirname, 'test', 'fixtures', 'hotelbeds-normalization-payload.json');
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    return payload.hotels.find(hotel => hotel.code === 74) || null;
}

test('normalization primitives validate currency, decimal precision, board types, and timestamps', () => {
    assert.equal(currencyCode('eur'), 'EUR');
    assert.equal(currencyCode('EURO'), null);
    assert.equal(decimalString('001.20'), '001.20');
    assert.equal(decimalString('12.345'), '12.345');
    assert.equal(decimalString('-1'), null);
    assert.equal(decimalString('NaN'), null);
    assert.deepEqual(normalizeBoard('BB', 'BED AND BREAKFAST'), {
        supplierCode: 'BB', supplierName: 'BED AND BREAKFAST', normalizedCode: 'BB'
    });
    assert.equal(normalizeBoard('', 'Ultra All Inclusive').normalizedCode, 'UAI');
    assert.equal(timestamp('2026-10-23T23:59:00+02:00').utc, '2026-10-23T21:59:00.000Z');
    assert.deepEqual(timestamp('2026-10-29T00:00:00'), {
        source: '2026-10-29T00:00:00', utc: null, timezoneKnown: false
    });
    assert.deepEqual(timestamp('2026-02-30T12:00:00+02:00'), {
        source: '2026-02-30T12:00:00+02:00', utc: null, timezoneKnown: false
    });
});

test('saved Hotelbeds payload maps rates with parent currency, multiple cancellation deadlines, and no key leakage', () => {
    const hotel = savedHotelbedsHotel();
    assert.ok(hotel, 'fixture must contain Hotelbeds hotel 74');
    const offers = normalizeHotelbedsHotel(hotel, {
        stay: { checkIn: '2026-10-31', checkOut: '2026-11-02' }
    });
    const refundable = offers[0];

    assert.ok(refundable);
    assert.equal(refundable.provider, 'hotelbeds');
    assert.deepEqual(refundable.price.supplierAmount, {
        amount: '218.50', currency: 'EUR', basis: 'supplier_net'
    });
    assert.equal(refundable.price.customerDisplay, null);
    assert.equal(refundable.stay.checkIn, '2026-10-31');
    assert.deepEqual(refundable.board, {
        supplierCode: 'BB', supplierName: 'BED AND BREAKFAST', normalizedCode: 'BB'
    });
    assert.equal(refundable.cancellation.refundability, 'conditional');
    assert.equal(refundable.cancellation.schedule[0].penalty.amount, '126.73');
    assert.equal(refundable.cancellation.schedule[0].startsAt.timezoneKnown, true);
    assert.equal(refundable.taxes.status, 'not_provided');
    assert.equal(refundable.cancellation.schedule.length, 2);
    assert.equal(refundable.cancellation.schedule[1].startsAt.utc, '2026-10-28T22:59:00.000Z');

    const withOpaqueReference = structuredClone(hotel);
    withOpaqueReference.rooms[0].rates[0].rateKey = 'private-hotelbeds-rate-key';
    const normalizedWithReference = normalizeHotelbedsHotel(withOpaqueReference)[0];
    assert.equal(normalizedWithReference.booking.requiresOpaqueReference, true);
    assert.equal(normalizedWithReference.booking.opaqueToken, 'private-hotelbeds-rate-key');
    const publicProjection = toCustomerDisplayOffer({
        ...normalizedWithReference,
        price: { ...normalizedWithReference.price, customerDisplay: { amount: '218.50', currency: 'EUR' } }
    }, { displayPolicyApproved: true, displayCurrency: 'EUR' });
    assert.equal(publicProjection.eligible, true);
    assert.equal(JSON.stringify(publicProjection).includes('private-hotelbeds-rate-key'), false);
    assert.equal(JSON.stringify(publicProjection).includes('rateKey'), false);
});

test('saved Hotelbeds non-refundable rate preserves separate tax currency and past penalty boundary', () => {
    const payloadPath = path.join(__dirname, 'test', 'fixtures', 'hotelbeds-normalization-payload.json');
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const hotel = payload.hotels.find(item => item.code === 1070);
    const offers = normalizeHotelbedsHotel(hotel, { stay: payload.request });
    const nonRefundable = offers.find(offer => offer.availability.rateClass === 'NRF'
        && offer.taxes.status === 'provided');

    assert.ok(nonRefundable);
    assert.equal(nonRefundable.price.supplierAmount.amount, '225.87');
    assert.equal(nonRefundable.cancellation.refundability, 'non_refundable');
    assert.equal(nonRefundable.cancellation.schedule[0].startsAt.source, '2026-09-30T23:59:00+02:00');
    assert.equal(nonRefundable.taxes.allIncluded, false);
    assert.deepEqual(nonRefundable.taxes.items[0], {
        included: false,
        amount: '13.20',
        currency: 'EUR',
        clientAmount: '13.20',
        clientCurrency: 'EUR',
        type: 'TAX',
        subType: 'City Tax'
    });
});

test('RateHawk adapter maps B2B amount/currency, board, tax inclusion and local cancellation timestamps', () => {
    const offers = normalizeRateHawkHotel({
        id: 'rh-property-1',
        name: 'RateHawk Fixture',
        rates: [{
            room_name: 'Double Standard',
            room_group_id: 'room-1',
            meal: { code: 'HB', name: 'Half Board' },
            payment_options: { payment_types: [{
                type: 'deposit',
                amount: '312.40',
                currency_code: 'USD',
                cancellation_penalties: {
                    free_cancellation_before: '2026-10-29T00:00:00',
                    policies: [{ start_at: '2026-10-29T00:00:00', end_at: null, amount_charge: '312.40' }]
                },
                tax_data: { taxes: [
                    { name: 'city_tax', amount: '10.00', currency_code: 'USD', included_by_supplier: false },
                    { name: 'resort_fee', amount: '4.00', currency_code: 'USD', included_by_supplier: true }
                ] }
            }] }
        }]
    }, { stay: { checkIn: '2026-10-31', checkOut: '2026-11-02' } });

    assert.equal(offers.length, 1);
    assert.equal(offers[0].provider, 'ratehawk');
    assert.equal(offers[0].price.supplierAmount.amount, '312.40');
    assert.equal(offers[0].price.supplierAmount.currency, 'USD');
    assert.equal(offers[0].board.normalizedCode, 'HB');
    assert.equal(offers[0].taxes.allIncluded, false);
    assert.equal(offers[0].taxes.items[0].included, false);
    assert.equal(offers[0].cancellation.freeCancellationBefore.timezoneKnown, false);
});

test('customer display eligibility fails closed without approved policy and computed display amount', () => {
    const offer = {
        price: { supplierAmount: { amount: '100.00', currency: 'EUR' }, customerDisplay: null }
    };
    const blocked = assessCustomerDisplayEligibility(offer, {
        displayPolicyApproved: false, displayCurrency: 'EUR'
    });
    assert.equal(blocked.eligible, false);
    assert.ok(blocked.reasons.includes('display_policy_not_approved'));
    assert.ok(blocked.reasons.includes('display_price_not_computed'));
    assert.equal(assessCustomerDisplayEligibility({
        price: {
            supplierAmount: { amount: '100.00', currency: 'EUR' },
            customerDisplay: { amount: '100.00', currency: 'EUR' }
        }
    }, { displayPolicyApproved: true, displayCurrency: 'EUR' }).eligible, true);
    assert.equal(assessCustomerDisplayEligibility({
        price: {
            supplierAmount: { amount: '100.00', currency: null },
            customerDisplay: { amount: '100.00', currency: 'EUR' }
        }
    }, { displayPolicyApproved: true, displayCurrency: 'EUR' }).eligible, false);

    const internalOffer = normalizeHotelbedsHotel(savedHotelbedsHotel())[0];
    const blockedForPilot = toCustomerDisplayOffer(internalOffer, {
        displayPolicyApproved: true,
        displayCurrency: 'EUR'
    });
    assert.equal(blockedForPilot.eligible, false);
    assert.ok(blockedForPilot.reasons.includes('display_price_not_computed'));

    const approved = toCustomerDisplayOffer({
        ...internalOffer,
        hotel: { ...internalOffer.hotel, canonicalId: 'canonical-hotel-1' },
        price: {
            ...internalOffer.price,
            customerDisplay: { amount: '218.50', currency: 'EUR' }
        }
    }, { displayPolicyApproved: true, displayCurrency: 'EUR' });
    assert.equal(approved.eligible, true);
    assert.equal(approved.offer.price.amount, '218.50');
    assert.equal('supplierAmount' in approved.offer.price, false);
    assert.equal('providerHotelId' in approved.offer, false);
    assert.equal('booking' in approved.offer, false);
});