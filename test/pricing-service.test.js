const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    EXCHANGE_RATES_TO_AED,
    DEFAULT_MARKUP_PERCENT,
    calculateDisplayPrice
} = require('../services/pricingService');

function offer(amount, currency) {
    return {
        provider: 'hotelbeds',
        price: {
            supplierAmount: { amount, currency, basis: 'supplier_net' },
            customerDisplay: null
        }
    };
}

test('converts EUR and USD net rates into AED with the default 10 percent markup', () => {
    assert.deepEqual(EXCHANGE_RATES_TO_AED, {
        AED: '1', EUR: '4.05', GBP: '4.85', SAR: '0.98', USD: '3.67'
    });
    assert.equal(DEFAULT_MARKUP_PERCENT, '10');
    assert.deepEqual(calculateDisplayPrice(offer('218.50', 'EUR')), {
        provider: 'hotelbeds',
        price: {
            supplierAmount: { amount: '218.50', currency: 'EUR', basis: 'supplier_net' },
            customerDisplay: null,
            display: { amount: '973.42', currency: 'AED' }
        }
    });
    assert.equal(calculateDisplayPrice(offer('100.00', 'USD')).price.display.amount, '403.70');
});

test('converts via AED base rates for other supported target currencies', () => {
    assert.equal(calculateDisplayPrice(offer('100.00', 'EUR'), 'USD')
        .price.display.amount, '121.39');
    assert.equal(calculateDisplayPrice(offer('100.00', 'EUR'), 'EUR')
        .price.display.amount, '110.00');
    assert.equal(calculateDisplayPrice(offer('100.00', 'AED'), 'SAR')
        .price.display.amount, '112.24');
});

test('applies explicit configurable markup and preserves the normalized offer immutably', () => {
    const original = offer('12.34', 'AED');
    const result = calculateDisplayPrice(original, 'AED', { markupPercent: '0' });
    assert.equal(result.price.display.amount, '12.34');
    assert.equal(result.price.display.currency, 'AED');
    assert.equal(result.price.supplierAmount.amount, '12.34');
    assert.equal(original.price.display, undefined);
    assert.notEqual(result, original);
    assert.notEqual(result.price, original.price);
    assert.equal(calculateDisplayPrice(offer('1.00', 'EUR'), 'AED', {
        markupPercent: '10.25'
    }).price.display.amount, '4.47');
});

test('uses exact decimal arithmetic and rounds half-cent values half-up to two places', () => {
    assert.equal(calculateDisplayPrice(offer('0.10', 'EUR'), 'AED', { markupPercent: '0' })
        .price.display.amount, '0.41');
    assert.equal(calculateDisplayPrice(offer('0.01', 'AED'), 'AED', { markupPercent: '50' })
        .price.display.amount, '0.02');
    assert.equal(calculateDisplayPrice(offer('0.30', 'AED'), 'AED', { markupPercent: '0' })
        .price.display.amount, '0.30');
    assert.equal(calculateDisplayPrice(offer(0.1 + 0.2, 'AED'), 'AED', {
        markupPercent: '0'
    }).price.display.amount, '0.30');
    assert.equal(calculateDisplayPrice(offer('1.005', 'AED'), 'AED', { markupPercent: '0' })
        .price.display.amount, '1.01');
    assert.equal(calculateDisplayPrice(offer('999999999999999999999.99', 'AED'), 'AED', {
        markupPercent: '0'
    }).price.display.amount, '999999999999999999999.99');
});

test('fails closed for invalid offers, amounts, currencies, and markup configuration', () => {
    assert.throws(() => calculateDisplayPrice(null), error => error.code === 'pricing_offer_invalid');
    assert.throws(() => calculateDisplayPrice({ price: {} }),
        error => error.code === 'pricing_supplier_amount_missing');
    for (const amount of ['', '0', '-1.00', '1e2', 'NaN', Infinity, null]) {
        assert.throws(() => calculateDisplayPrice(offer(amount, 'EUR')),
            error => error.code === 'pricing_supplier_amount_invalid');
    }
    assert.throws(() => calculateDisplayPrice(offer('10.00', 'XYZ')),
        error => error.code === 'pricing_currency_unsupported');
    assert.throws(() => calculateDisplayPrice(offer('10.00', 'EUR'), 'JPY'),
        error => error.code === 'pricing_currency_unsupported');
    for (const markupPercent of ['-1', '1000.01', 'Infinity', 'not-a-number']) {
        assert.throws(() => calculateDisplayPrice(offer('10.00', 'EUR'), 'AED', { markupPercent }),
            error => error.code === 'pricing_markup_invalid' || error.code === 'pricing_markup_out_of_range');
    }
});