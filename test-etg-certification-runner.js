const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { selectRate, getComparablePrice, validatePaymentWithinCap, resolveEnvFile } = require('./etg-cert-sandbox-test');

const rate = (amount, extra = {}) => ({
    book_hash: `fixture-${amount}`,
    payment_options: { payment_types: [{ type: 'deposit', amount, currency_code: 'USD',
        is_need_credit_card_data: false, ...extra }] }
});

test('sandbox certification selects the cheapest actual ETG nested no-card payment', () => {
    const selected = rate('25.50');
    assert.equal(selectRate({ hotels: [{ hid: 10004834, rates: [rate('40.00'), selected,
        rate('1.00', { is_need_credit_card_data: true }), rate('2.00', { currency_code: 'EUR' })] }] }, 10004834).rate, selected);
    assert.deepEqual(getComparablePrice(selected), { amount: 25.5, currency: 'USD' });
    assert.throws(() => selectRate({ hotels: [{ hid: 2, rates: [selected] }] }, 10004834));
    assert.throws(() => validatePaymentWithinCap({ amount: '25.50', currency_code: 'USD' }, 25));
    assert.throws(() => validatePaymentWithinCap({ amount: '20.00', currency_code: 'EUR' }, 25));
});

test('sandbox certification accepts a project-local env file and rejects path escape', () => {
    assert.equal(resolveEnvFile(['--env-file=.env.sandbox']), path.resolve(__dirname, '.env.sandbox'));
    assert.throws(() => resolveEnvFile(['--env-file=../outside.env']), /inside the project directory/);
    assert.throws(() => resolveEnvFile(['--env-file=']), /Invalid --env-file/);
});
