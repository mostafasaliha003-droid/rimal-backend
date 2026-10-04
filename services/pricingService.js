const EXCHANGE_RATES_TO_AED = Object.freeze({
    AED: '1',
    EUR: '4.05',
    GBP: '4.85',
    SAR: '0.98',
    USD: '3.67'
});

const DEFAULT_MARKUP_PERCENT = '10';
const MAX_MARKUP_PERCENT = '1000';

function fail(code) {
    return Object.assign(new Error(code), { code });
}

function decimalParts(value, code, { allowZero = true } = {}) {
    const raw = typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : typeof value === 'string' ? value.trim() : '';
    if (!raw || raw.length > 80) throw fail(code);
    const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
    if (!match) throw fail(code);

    const fraction = match[2] || '';
    if (fraction.length > 18) throw fail(code);
    const coefficient = BigInt(`${match[1]}${fraction}`);
    if (!allowZero && coefficient === 0n) throw fail(code);
    return { coefficient, scale: fraction.length };
}

function decimalPower(scale) {
    return 10n ** BigInt(scale);
}

function markupFrom(options) {
    const configured = options.markupPercent
        ?? process.env.B2C_MARKUP_PERCENT
        ?? DEFAULT_MARKUP_PERCENT;
    const markup = decimalParts(configured, 'pricing_markup_invalid');
    const max = decimalParts(MAX_MARKUP_PERCENT, 'pricing_configuration_invalid');
    if (markup.coefficient * decimalPower(max.scale) > max.coefficient * decimalPower(markup.scale)) {
        throw fail('pricing_markup_out_of_range');
    }
    return markup;
}

function currencyFrom(value, errorCode, exchangeRatesToAED = EXCHANGE_RATES_TO_AED) {
    if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) throw fail(errorCode);
    const currency = value.trim().toUpperCase();
    if (!Object.hasOwn(exchangeRatesToAED, currency)) throw fail('pricing_currency_unsupported');
    return currency;
}

function roundedAmount({ amount, sourceCurrency, targetCurrency, markup, exchangeRatesToAED }) {
    const sourceRate = decimalParts(exchangeRatesToAED[sourceCurrency], 'pricing_exchange_rate_invalid', {
        allowZero: false
    });
    const targetRate = decimalParts(exchangeRatesToAED[targetCurrency], 'pricing_exchange_rate_invalid', {
        allowZero: false
    });

    // amount * source-AED-rate / target-AED-rate * (100 + markup) / 100.
    // Keep this as an exact rational until final cent rounding; no binary float
    // arithmetic is used in the pricing calculation.
    const markupDenominator = 100n * decimalPower(markup.scale);
    const markupNumerator = markupDenominator + markup.coefficient;
    const numerator = amount.coefficient
        * sourceRate.coefficient
        * decimalPower(targetRate.scale)
        * markupNumerator;
    const denominator = decimalPower(amount.scale)
        * decimalPower(sourceRate.scale)
        * targetRate.coefficient
        * markupDenominator;

    const centsNumerator = numerator * 100n;
    let cents = centsNumerator / denominator;
    const remainder = centsNumerator % denominator;
    if (remainder * 2n >= denominator) cents += 1n;

    const whole = cents / 100n;
    const fraction = String(cents % 100n).padStart(2, '0');
    return `${whole}.${fraction}`;
}

/**
 * Calculate a display amount from a normalized supplier amount.
 *
 * Static rates are quoted as units of AED for one unit of currency and are
 * intentionally local fallbacks for this TDD phase; this service makes no
 * network requests. The returned amount is a two-decimal string to preserve
 * its exact monetary representation.
 */
function calculateDisplayPrice(normalizedOffer, targetCurrency = 'AED', options = {}) {
    if (!normalizedOffer || typeof normalizedOffer !== 'object' || Array.isArray(normalizedOffer)) {
        throw fail('pricing_offer_invalid');
    }
    const price = normalizedOffer.price;
    const supplierAmount = price?.supplierAmount;
    if (!supplierAmount || typeof supplierAmount !== 'object' || Array.isArray(supplierAmount)) {
        throw fail('pricing_supplier_amount_missing');
    }

    const amount = decimalParts(supplierAmount.amount, 'pricing_supplier_amount_invalid', { allowZero: false });
    const exchangeRatesToAED = options.exchangeRatesToAED || EXCHANGE_RATES_TO_AED;
    if (!exchangeRatesToAED || typeof exchangeRatesToAED !== 'object' || Array.isArray(exchangeRatesToAED)) {
        throw fail('pricing_exchange_rates_invalid');
    }
    const sourceCurrency = currencyFrom(supplierAmount.currency, 'pricing_source_currency_invalid', exchangeRatesToAED);
    const normalizedTargetCurrency = currencyFrom(targetCurrency, 'pricing_target_currency_invalid', exchangeRatesToAED);
    const markup = markupFrom(options);
    const display = {
        amount: roundedAmount({
            amount,
            sourceCurrency,
            targetCurrency: normalizedTargetCurrency,
            markup,
            exchangeRatesToAED
        }),
        currency: normalizedTargetCurrency
    };

    return {
        ...normalizedOffer,
        price: {
            ...price,
            display
        }
    };
}

function createLivePricingService({ fxService, pricing = calculateDisplayPrice } = {}) {
    if (!fxService || typeof fxService.getRate !== 'function' || typeof pricing !== 'function') {
        throw new TypeError('live_pricing_dependencies_invalid');
    }

    return async function calculateLiveDisplayPrice(normalizedOffer, targetCurrency = 'AED', options = {}) {
        const rawSourceCurrency = normalizedOffer?.price?.supplierAmount?.currency;
        if (typeof rawSourceCurrency !== 'string' || !/^[A-Za-z]{3}$/.test(rawSourceCurrency.trim())) {
            throw fail('pricing_source_currency_invalid');
        }
        const sourceCurrency = rawSourceCurrency.trim().toUpperCase();
        const normalizedTargetCurrency = typeof targetCurrency === 'string' ? targetCurrency.trim().toUpperCase() : '';
        if (!/^[A-Z]{3}$/.test(normalizedTargetCurrency)) throw fail('pricing_target_currency_invalid');

        const [sourceQuote, targetQuote] = await Promise.all([
            fxService.getRate(sourceCurrency, 'AED'),
            fxService.getRate(normalizedTargetCurrency, 'AED')
        ]);
        if (sourceQuote?.baseCurrency !== sourceCurrency || sourceQuote?.quoteCurrency !== 'AED'
            || targetQuote?.baseCurrency !== normalizedTargetCurrency || targetQuote?.quoteCurrency !== 'AED'
            || sourceQuote?.stale === true || targetQuote?.stale === true) {
            throw fail('pricing_exchange_rates_invalid');
        }

        const exchangeRatesToAED = {
            [sourceCurrency]: sourceQuote.rate,
            [normalizedTargetCurrency]: targetQuote.rate
        };
        if (sourceCurrency === 'AED' || normalizedTargetCurrency === 'AED') {
            exchangeRatesToAED.AED = '1';
        }
        return pricing(normalizedOffer, normalizedTargetCurrency, { ...options, exchangeRatesToAED });
    };
}

module.exports = {
    EXCHANGE_RATES_TO_AED,
    DEFAULT_MARKUP_PERCENT,
    calculateDisplayPrice,
    createLivePricingService,
    _test: { decimalParts, roundedAmount, markupFrom }
};