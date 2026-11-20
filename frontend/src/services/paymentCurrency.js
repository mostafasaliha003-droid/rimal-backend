import currencies from '../../../shared/paymentCurrencies.json' with { type: 'json' };
export const PAYMENT_CURRENCIES = Object.keys(currencies);
const REQUESTED_KEY = 'pillow.paymentCurrency';

// The mobile app hands guests over with ?currency=AED so checkout opens in the
// currency whose prices they were shown. Remember it for this browser session.
if (typeof window !== 'undefined') {
    try {
        const requested = new URLSearchParams(window.location.search).get('currency');
        if (requested && PAYMENT_CURRENCIES.includes(requested)) window.sessionStorage.setItem(REQUESTED_KEY, requested);
    } catch { /* Storage can be unavailable in private browsing. */ }
}

export function preferredPaymentCurrency(country) {
    try {
        const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(REQUESTED_KEY) : null;
        if (stored && PAYMENT_CURRENCIES.includes(stored)) return stored;
    } catch { /* Fall back to the residency country. */ }
    return paymentCurrencyForCountry(country);
}
export function paymentCurrencyForCountry(country) {
    return Object.entries(currencies).find(([, value]) => value.countries.includes(String(country || '').toLowerCase()))?.[0] || 'USD';
}
