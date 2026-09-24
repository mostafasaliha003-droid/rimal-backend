export const SEARCH_CURRENCY = 'USD';
export const DISPLAY_CURRENCIES = ['USD', 'AED', 'SAR', 'EUR'];
import { roomImagesForRate } from './hotelImages.js';

export function displayAmount(amount, sourceCurrency, displayCurrency, usdRates) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return null;
    if (sourceCurrency === displayCurrency) return value;
    if (!DISPLAY_CURRENCIES.includes(sourceCurrency) || !DISPLAY_CURRENCIES.includes(displayCurrency)) return null;
    const sourceRate = sourceCurrency === SEARCH_CURRENCY ? 1 : Number(usdRates?.[sourceCurrency]);
    const targetRate = displayCurrency === SEARCH_CURRENCY ? 1 : Number(usdRates?.[displayCurrency]);
    return Number.isFinite(sourceRate) && sourceRate > 0 && Number.isFinite(targetRate) && targetRate > 0
        ? value / sourceRate * targetRate : null;
}

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
    const roomImages = roomImagesForRate(rate, hotel);
    const roomName = rate.room_name || rate.name || 'غرفة';
    const roomNameLower = String(roomName).toLowerCase();
    const textualBed = rate.room_info?.bed
        || rate.room_info?.bedding_type
        || rate.name_struct?.bedding_type
        || rate.bedding
        || rate.bed;
    const bed = textualBed || (
        roomNameLower.includes('king') ? 'King bed'
            : roomNameLower.includes('triple') ? 'Triple bed'
                : roomNameLower.includes('double') || roomNameLower.includes('dbl') ? 'Double bed'
                    : roomNameLower.includes('twin') ? 'Twin beds'
                        : roomNameLower.includes('single') ? 'Single bed'
                            : rate.rg_ext?.capacity === 3 ? 'Triple bed'
                                : rate.rg_ext?.capacity === 2 ? 'Double bed'
                                    : undefined
    );
    return {
        name: roomName,
        price: rateAmount(rate),
        currency: rateCurrency(rate),
        book_hash: rate.book_hash || rate.match_hash,
        bed,
        images: roomImages,
        amenities: rate.amenities || rate.room_amenities || rate.room_info?.amenities || [],
        rg_ext: rate.rg_ext,
        originalRate: rate,
        cancellation: payment?.cancellation_penalties,
        taxes: payment?.tax_data?.taxes || [],
        meal: rate.meal,
        paymentType: payment?.type,
        guests,
        hotel
    };
}