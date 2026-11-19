// Minor units and increment accepted by the payment gateway.
// Keep these values aligned with shared/paymentCurrencies.json on the booking server.
export const paymentCurrencyUnits: Readonly<Record<string, { decimals: number; step: number }>> = Object.freeze({
  AED: { decimals: 2, step: 1 }, SAR: { decimals: 2, step: 1 }, KWD: { decimals: 3, step: 10 },
  BHD: { decimals: 3, step: 10 }, OMR: { decimals: 3, step: 10 }, QAR: { decimals: 2, step: 1 },
  USD: { decimals: 2, step: 1 }, EUR: { decimals: 2, step: 1 }, GBP: { decimals: 2, step: 1 }, INR: { decimals: 2, step: 1 },
});
