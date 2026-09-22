export const SEARCH_CURRENCY = 'USD';

export const paymentFor = (rate) => rate?.payment_options?.payment_types?.find(payment => payment.type === 'deposit')
    || rate?.payment_options?.payment_types?.[0];

export function rateAmount(rate) {
    const amount = Number(paymentFor(rate)?.amount ?? rate?.price);
    return Number.isFinite(amount) && amount > 0 ? amount : Infinity;
}

export const rateCurrency = (rate) => paymentFor(rate)?.currency_code || rate?.currency || '';

export function cheapestRate(rates = [], currency = SEARCH_CURRENCY) {
    return rates.filter(rate => rateCurrency(rate) === currency && Number.isFinite(rateAmount(rate)))
        .reduce((best, rate) => !best || rateAmount(rate) < rateAmount(best) ? rate : best, null);
}

export function formatMoney(amount, currency = 'AED') {
    if (!Number.isFinite(Number(amount))) return 'السعر غير متاح';
    return new Intl.NumberFormat('ar-AE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
}

export function normalizeRoom(rate, hotel, guests) {
    const payment = paymentFor(rate);
    return {
        name: rate.room_name || rate.name || 'غرفة',
        price: rateAmount(rate),
        currency: rateCurrency(rate),
        book_hash: rate.book_hash || rate.match_hash,
        bed: rate.room_info?.bed || rate.bedding || rate.bed,
        cancellation: payment?.cancellation_penalties,
        taxes: payment?.tax_data?.taxes || [],
        meal: rate.meal,
        paymentType: payment?.type,
        guests,
        hotel
    };
}