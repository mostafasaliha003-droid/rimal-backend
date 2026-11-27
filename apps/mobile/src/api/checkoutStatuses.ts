import type { CheckoutStatus } from './checkout';

/** Where a confirmed booking goes when the guest cancels it (never a failed booking: that is never confirmed). */
export const AFTER_GUEST_CANCELLATION: ReadonlySet<CheckoutStatus> = new Set<CheckoutStatus>(['booking_cancelled',
  'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed', 'refund_review']);
