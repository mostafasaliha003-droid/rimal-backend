import type { CheckoutStatus } from '../api/checkout';
import { checkoutStatusCopy } from '../screens/checkoutCopy';
import type { IconName } from './Icon';

/*
 * What the guest is told after paying, derived only from the server's checkout status.
 * Payment verification and hotel confirmation are separate stages, and a browser return
 * is never success: until the server reports `booking_confirmed`, the booking is "being
 * confirmed", never "confirmed".
 */
export type StageState = 'done' | 'active' | 'failed' | 'waiting';
export interface LiveStage { key: 'request' | 'payment' | 'hotel' | 'voucher'; title: string; detail: string; state: StageState }
export interface LivePaymentView {
  tone: 'working' | 'success' | 'attention'; icon: IconName; title: string; body: string; stages: LiveStage[];
  /** Whether the page should keep asking the server for news. */
  live: boolean; expectation: string; guidance: string; slow: boolean;
}

/** Statuses that change on their own (payment provider or hotel), so the page keeps polling. */
export const LIVE_STATUSES: readonly CheckoutStatus[] = Object.freeze(['preparing', 'intent_creating', 'intent_unknown', 'awaiting_payment',
  'payment_verified', 'booking_pending', 'refund_creating', 'refund_unknown', 'refund_pending']);
/** After this long the waiting copy says it is taking longer than usual, and what happens next. */
export const SLOW_AFTER_SECONDS = 180;

/** Poll quickly while an answer usually arrives, then back off; stop after half an hour. */
export function livePollDelay(status: CheckoutStatus, elapsedMs: number): number | null {
  if (!LIVE_STATUSES.includes(status) || elapsedMs > 30 * 60_000) return null;
  if (status === 'awaiting_payment') return elapsedMs < 10 * 60_000 ? 5_000 : 15_000;
  return elapsedMs < 60_000 ? 3_000 : elapsedMs < 5 * 60_000 ? 6_000 : 15_000;
}

type Stages = [StageState, StageState, StageState, StageState];
function stageStates(status: CheckoutStatus): Stages {
  switch (status) {
    case 'preparing': case 'intent_creating': return ['done', 'active', 'waiting', 'waiting'];
    case 'preflight_failed': return ['failed', 'waiting', 'waiting', 'waiting'];
    case 'intent_unknown': case 'awaiting_payment': return ['done', 'active', 'waiting', 'waiting'];
    case 'payment_failed': return ['done', 'failed', 'waiting', 'waiting'];
    case 'payment_verified': case 'booking_pending': return ['done', 'done', 'active', 'waiting'];
    case 'booking_confirmed': return ['done', 'done', 'done', 'done'];
    case 'manual_review': return ['done', 'done', 'active', 'waiting'];
    default: return ['done', 'done', 'failed', 'waiting']; // cancelled, failed and every refund state
  }
}

const copy = {
  ar: {
    stages: { request: 'استلام طلب الحجز', payment: 'التحقق من الدفع', hotel: 'تأكيد الحجز مع الفندق', voucher: 'إصدار قسيمة الحجز' },
    detail: {
      received: 'استلمنا بيانات الضيوف والغرفة', preparingPay: 'نجهّز صفحة الدفع الآمن', awaiting: 'بانتظار إتمامك للدفع في صفحة زينا الآمنة',
      verifying: 'نتأكد من العملية مع مزوّد الدفع', paid: 'تم استلام دفعتك بنجاح', payFailed: 'لم يُؤكَّد الدفع',
      hotelWorking: 'أرسلنا حجزك إلى الفندق وننتظر رده', hotelDone: 'أكّد الفندق حجزك', hotelFailed: 'لم يؤكّد الفندق الحجز',
      voucherDone: 'القسيمة جاهزة للتنزيل', review: 'يراجع فريقنا الطلب',
    },
    working: {
      preparing: ['نجهّز الدفع الآمن', 'لحظات ونفتح لك صفحة الدفع الآمن.'],
      awaiting_payment: ['بانتظار إتمام الدفع', 'أكمل الدفع في صفحة زينا الآمنة. بمجرد إتمامه يظهر التأكيد هنا تلقائياً.'],
      intent_unknown: ['نتحقق من عملية الدفع', 'نراجع حالة الدفع مع مزوّد الدفع. يرجى الانتظار وعدم تكرار الدفع.'],
      payment_verified: ['تم استلام دفعتك بنجاح', 'نؤكد حجزك الآن مع الفندق. يرجى الانتظار قليلاً.'],
      booking_pending: ['جارٍ تأكيد حجزك مع الفندق', 'تم استلام دفعتك، وننتظر التأكيد النهائي من الفندق.'],
    },
    confirmed: ['تم تأكيد حجزك', 'حجزك مؤكَّد من الفندق. قسيمة الحجز جاهزة أدناه، وتصلك أيضاً على بريدك الإلكتروني.'],
    usual: 'تستغرق هذه الخطوة عادةً أقل من دقيقة، وقد تمتد حتى 5 دقائق.',
    slow: 'يستغرق التأكيد وقتاً أطول من المعتاد. نواصل المتابعة تلقائياً، وسنرسل القسيمة إلى بريدك فور التأكيد، ويمكنك متابعة الحالة من «رحلاتي».',
    stay: 'لا تغلق التطبيق ولا تكرر الدفع؛ هذه الصفحة تتحدّث تلقائياً.',
    reopen: 'إن أغلقت صفحة الدفع قبل إتمامه، اضغط «فتح الدفع الآمن» للعودة إليها. لا تبدأ حجزاً جديداً لنفس الإقامة.',
  },
  en: {
    stages: { request: 'Booking request received', payment: 'Payment verification', hotel: 'Confirmation from the hotel', voucher: 'Booking voucher' },
    detail: {
      received: 'Guest and room details received', preparingPay: 'Preparing the secure payment page', awaiting: 'Waiting for you to complete payment on Ziina’s secure page',
      verifying: 'Confirming the transaction with the payment provider', paid: 'Your payment was received', payFailed: 'The payment was not confirmed',
      hotelWorking: 'Your booking was sent to the hotel; awaiting its reply', hotelDone: 'The hotel confirmed your booking', hotelFailed: 'The hotel did not confirm the booking',
      voucherDone: 'Your voucher is ready to download', review: 'Our team is reviewing the request',
    },
    working: {
      preparing: ['Preparing secure payment', 'Your secure payment page opens in a moment.'],
      awaiting_payment: ['Waiting for your payment', 'Complete the payment on Ziina’s secure page. Once it is done, the confirmation appears here automatically.'],
      intent_unknown: ['Checking your payment', 'We are confirming the payment status with the provider. Please wait and do not pay again.'],
      payment_verified: ['Payment received', 'We are now confirming your booking with the hotel. This will only take a moment.'],
      booking_pending: ['Confirming with the hotel', 'Your payment was received; we are waiting for the hotel’s final confirmation.'],
    },
    confirmed: ['Your booking is confirmed', 'The hotel has confirmed your stay. Your voucher is ready below and is also sent to your email.'],
    usual: 'This step usually takes under a minute and can take up to 5 minutes.',
    slow: 'This is taking longer than usual. We keep checking automatically, will email your voucher as soon as it is confirmed, and you can follow it in Trips.',
    stay: 'Keep the app open and do not pay again; this page updates itself.',
    reopen: 'If you closed the payment page before finishing, tap “Open secure payment” to return to it. Do not start a new booking for the same stay.',
  },
} as const;

export function livePaymentModel(status: CheckoutStatus, language: string, elapsedSeconds: number): LivePaymentView {
  const c = language === 'ar' ? copy.ar : copy.en;
  const states = stageStates(status);
  const live = LIVE_STATUSES.includes(status);
  const payDetail = status === 'preparing' || status === 'intent_creating' ? c.detail.preparingPay : status === 'awaiting_payment' ? c.detail.awaiting
    : status === 'intent_unknown' ? c.detail.verifying : states[1] === 'failed' ? c.detail.payFailed : states[1] === 'done' ? c.detail.paid : '';
  const hotelDetail = status === 'manual_review' ? c.detail.review : states[2] === 'active' ? c.detail.hotelWorking : states[2] === 'done' ? c.detail.hotelDone
    : states[2] === 'failed' ? c.detail.hotelFailed : '';
  const stages: LiveStage[] = [
    { key: 'request', title: c.stages.request, detail: states[0] === 'done' ? c.detail.received : '', state: states[0] },
    { key: 'payment', title: c.stages.payment, detail: payDetail, state: states[1] },
    { key: 'hotel', title: c.stages.hotel, detail: hotelDetail, state: states[2] },
    { key: 'voucher', title: c.stages.voucher, detail: states[3] === 'done' ? c.detail.voucherDone : '', state: states[3] },
  ];
  const workingKey = status === 'intent_creating' ? 'preparing' : status;
  const working = (c.working as Record<string, readonly [string, string]>)[workingKey];
  const verifying = status === 'intent_unknown' || status === 'payment_verified' || status === 'booking_pending';
  const slow = verifying && elapsedSeconds >= SLOW_AFTER_SECONDS;
  if (status === 'booking_confirmed') return { tone: 'success', icon: 'check', title: c.confirmed[0], body: c.confirmed[1], stages, live, expectation: '', guidance: '', slow: false };
  if (working) return { tone: 'working', icon: status === 'awaiting_payment' || workingKey === 'preparing' ? 'card' : status === 'intent_unknown' ? 'shield' : 'hotel',
    title: working[0], body: working[1], stages, live, slow,
    expectation: verifying ? (slow ? c.slow : c.usual) : '', guidance: status === 'awaiting_payment' ? c.reopen : verifying ? c.stay : '' };
  const [title, body] = checkoutStatusCopy(language, status);
  return { tone: live ? 'working' : 'attention', icon: live ? 'hourglass' : 'alert', title, body, stages, live, expectation: '', guidance: '', slow: false };
}
