/** Emoji flag for an ISO 3166 country code ("ae" → 🇦🇪). Empty when the code is not two letters. */
export function flagEmoji(code: string): string {
  const letters = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(letters)) return '';
  return String.fromCodePoint(...[...letters].map(letter => 0x1F1E6 + letter.charCodeAt(0) - 65));
}

/** The region whose flag stands for a currency (EUR uses the EU flag). */
const CURRENCY_REGION: Readonly<Record<string, string>> = {
  USD: 'us', AED: 'ae', EUR: 'eu', GBP: 'gb', SAR: 'sa', KWD: 'kw', QAR: 'qa', BHD: 'bh', OMR: 'om', INR: 'in',
  EGP: 'eg', JOD: 'jo', TRY: 'tr', CHF: 'ch', JPY: 'jp', CNY: 'cn', CAD: 'ca', AUD: 'au', PKR: 'pk', MAD: 'ma',
};
export function currencyFlag(code: string): string { return flagEmoji(CURRENCY_REGION[code.toUpperCase()] || ''); }
