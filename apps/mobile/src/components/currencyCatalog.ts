import data from './currencyData.json';
import { paymentCurrencyUnits } from '../api/paymentCurrencies';

// www.unicode.org/cldr, release 49.0.0. Active tender entries as of 2026-11-19 from
// cldr-core/supplemental/currencyData.json; EN/AR displayName from cldr-numbers-full.
// The first active tender listed by CLDR for each region is its automatic default.
// See currencyData.LICENSE.txt. Older Android ICU versions may lack these names.
const catalog: Readonly<Record<string, { en: string; ar: string; regions: readonly string[] }>> = data;
export const DISPLAY_CURRENCIES: readonly string[] = Object.freeze(Object.keys(catalog));
const byRegion = new Map<string, string>();
for (const code of DISPLAY_CURRENCIES) {
  for (const region of catalog[code].regions) byRegion.set(region, code);
}

export function isDisplayCurrency(code: unknown): code is string {
  return typeof code === 'string' && Object.hasOwn(catalog, code);
}

/** Local currency requires an actual country; a language on its own is ambiguous. */
export function currencyForCountry(country: unknown): string | null {
  if (typeof country !== 'string') return null;
  return byRegion.get(country.trim().toUpperCase()) ?? null;
}

/** Keep display-only currencies out of supplier, prebook, and payment requests. */
export function bookingCurrency(code: unknown, environment: 'staging' | 'production' = 'production'): string {
  // The staging supplier rejects AED searches. Keep its verified USD rates bookable
  // and use the selected local currency for dated display estimates.
  if (environment === 'staging') return 'USD';
  return isDisplayCurrency(code) && Object.hasOwn(paymentCurrencyUnits, code) ? code : 'USD';
}

export function currencyName(code: string, language: string): string {
  return isDisplayCurrency(code) ? catalog[code][language === 'ar' ? 'ar' : 'en'] : code;
}

function searchWords(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[\p{M}\u0640]/gu, '')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/(^| )ال(?=\p{Script=Arabic})/gu, '$1').trim();
}

const searchIndex = new Map(DISPLAY_CURRENCIES.map(code =>
  [code, searchWords([code, catalog[code].ar, catalog[code].en].join(' '))]));

export function findCurrencies(query: string, language: string): string[] {
  const terms = searchWords(query).split(/\s+/u).filter(Boolean);
  const exact = query.trim().toUpperCase();
  return DISPLAY_CURRENCIES.filter(code => terms.every(term => searchIndex.get(code)!.includes(term)))
    .sort((a, b) => Number(b === exact) - Number(a === exact)
      || (terms.length > 0 ? Number(b === 'USD' || b === 'AED') - Number(a === 'USD' || a === 'AED') : 0)
      || currencyName(a, language).localeCompare(currencyName(b, language), language));
}
