import currencies from '../../../shared/paymentCurrencies.json' with { type: 'json' };
export const PAYMENT_CURRENCIES = Object.keys(currencies);
export function paymentCurrencyForCountry(country) {
    return Object.entries(currencies).find(([, value]) => value.countries.includes(String(country || '').toLowerCase()))?.[0] || 'USD';
}
