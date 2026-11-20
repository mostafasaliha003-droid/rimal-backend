import { ApiError } from './errors';
import type { CheckoutReview } from './checkout';

// Minor units and increment accepted by the payment gateway.
// Keep these values aligned with shared/paymentCurrencies.json on the booking server.
export const paymentCurrencyUnits: Readonly<Record<string, { decimals: number; step: number }>> = Object.freeze({
  AED: { decimals: 2, step: 1 }, SAR: { decimals: 2, step: 1 }, KWD: { decimals: 3, step: 10 },
  BHD: { decimals: 3, step: 10 }, OMR: { decimals: 3, step: 10 }, QAR: { decimals: 2, step: 1 },
  USD: { decimals: 2, step: 1 }, EUR: { decimals: 2, step: 1 }, GBP: { decimals: 2, step: 1 }, INR: { decimals: 2, step: 1 },
});

/** The guest's chosen payment currency, or the supplier currency when none was chosen. */
export function chargeCurrency(review: CheckoutReview): string {
  const chosen = review.paymentCurrency;
  if (chosen === undefined) {
    if (!review.offer.price) throw new ApiError('validation', 'fresh_checkout_review_required');
    return review.offer.price.currency;
  }
  if (typeof chosen !== 'string' || !paymentCurrencyUnits[chosen]) throw new ApiError('validation', 'unsupported_payment_currency');
  return chosen;
}
