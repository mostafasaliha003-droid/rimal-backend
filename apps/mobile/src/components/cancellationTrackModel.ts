import type { CancellationTracking } from '../api/cancellation';
import type { Money } from '../types';
import { formatMoney } from './format';
import type { LivePaymentView, LiveStage } from './livePaymentModel';

/*
 * What the guest is told while a cancellation and its refund progress, derived only from the
 * server's status. "Cancelled" is said only when the hotel has confirmed it, and "refunded" only
 * when the payment provider has completed the refund.
 */
export const CANCELLATION_SLOW_AFTER_SECONDS = 180;
/** Card refunds usually reach the statement within this many business days (depends on the bank). */
export const REFUND_DAYS = { min: 5, max: 10 } as const;

/** Ask often while the hotel is confirming, less often while the refund is under way; stop after half an hour. */
export function cancellationPollDelay(tracking: CancellationTracking, elapsedMs: number): number | null {
  if (elapsedMs > 30 * 60_000) return null;
  if (tracking.pending) return elapsedMs < 60_000 ? 3_000 : elapsedMs < 5 * 60_000 ? 6_000 : 15_000;
  if (tracking.state === 'cancelled' && (tracking.refundStatus === 'pending' || tracking.refundStatus === 'not_processed')) {
    return elapsedMs < 2 * 60_000 ? 5_000 : elapsedMs < 10 * 60_000 ? 15_000 : null;
  }
  return null;
}

const amount = (money: Money | null) => formatMoney(money, { whole: true }) || '';

export function cancellationTrackModel(tracking: CancellationTracking, language: string, elapsedSeconds: number): LivePaymentView {
  const ar = language === 'ar';
  const refund = amount(tracking.refund), slow = elapsedSeconds >= CANCELLATION_SLOW_AFTER_SECONDS;
  const days = ar ? `${REFUND_DAYS.min} إلى ${REFUND_DAYS.max} أيام عمل` : `${REFUND_DAYS.min} to ${REFUND_DAYS.max} business days`;
  const stage = (key: string, title: string, detail: string, state: LiveStage['state']) => ({ key, title, detail, state }) as LiveStage;
  const request = stage('request', ar ? 'استلام طلب الإلغاء' : 'Cancellation request received', ar ? 'سجّلنا طلبك بالرسوم المعروضة' : 'Recorded at the quoted fee', 'done');
  const hotel = (state: LiveStage['state'], detail: string) => stage('hotel', ar ? 'تأكيد الإلغاء مع الفندق' : 'Hotel confirms the cancellation', detail, state);
  const money = (state: LiveStage['state'], detail: string) => stage('refund', ar ? 'رد المبلغ إلى بطاقتك' : 'Refund to your card', detail, state);
  const finished = (state: LiveStage['state']) => stage('done', ar ? 'اكتمال الإلغاء' : 'Cancellation complete', '', state);
  const refundLine = refund ? (ar ? `المبلغ المسترد: ${refund}` : `Refund: ${refund}`) : '';

  if (tracking.state === 'cancel_failed') return {
    tone: 'attention', icon: 'alertCircle', live: false, slow: false,
    title: ar ? 'تعذّر إلغاء الحجز تلقائياً' : 'The booking could not be cancelled automatically',
    body: ar ? 'لم يؤكد الفندق الإلغاء، وحجزك ما زال قائماً كما هو. تواصل مع الدعم بمرجع الحجز وسنتابع الإلغاء معك.' : 'The hotel did not confirm the cancellation and your booking stands as it is. Contact support with the booking reference and we will follow it up with you.',
    stages: [request, hotel('failed', ar ? 'لم يتم الإلغاء' : 'Not cancelled'), money('waiting', ''), finished('waiting')],
    expectation: '', guidance: '' };

  if (tracking.pending) return {
    tone: 'working', icon: 'hourglass', live: true, slow,
    title: ar ? 'جارٍ إلغاء حجزك مع الفندق' : 'Cancelling your booking with the hotel',
    body: ar ? 'أرسلنا طلب الإلغاء إلى الفندق وننتظر تأكيده. لا حاجة لأي إجراء منك.' : 'We sent the cancellation to the hotel and are waiting for its confirmation. Nothing is needed from you.',
    stages: [request, hotel('active', ar ? 'بانتظار رد الفندق' : 'Waiting for the hotel'), money('waiting', refundLine), finished('waiting')],
    expectation: slow ? (ar ? 'يستغرق تأكيد الإلغاء وقتاً أطول من المعتاد. نتابعه تلقائياً، وستجد الحالة دائماً في «رحلاتي».' : 'Confirmation is taking longer than usual. We keep checking, and the status is always in My trips.')
      : (ar ? 'يتأكد الإلغاء عادةً خلال دقائق، وقد يستغرق حتى ساعة لدى بعض الفنادق.' : 'Cancellations are usually confirmed within minutes; some hotels take up to an hour.'),
    guidance: ar ? 'لا تحجز التواريخ نفسها مرة أخرى قبل تأكيد الإلغاء.' : 'Please do not rebook the same dates until the cancellation is confirmed.' };

  // Cancelled by the hotel: what remains is the refund.
  if (tracking.refundStatus === 'not_due') return {
    tone: 'success', icon: 'check', live: false, slow: false,
    title: ar ? 'تم إلغاء حجزك' : 'Your booking is cancelled',
    body: ar ? 'أكّد الفندق الإلغاء. وفق شروط الإلغاء لا يوجد مبلغ مسترد لهذا الحجز.' : 'The hotel confirmed the cancellation. Under the cancellation terms there is no refund for this booking.',
    stages: [request, hotel('done', ar ? 'أكّد الفندق الإلغاء' : 'Confirmed by the hotel'), money('done', ar ? 'لا يوجد مبلغ للاسترداد' : 'No refund due'), finished('done')],
    expectation: '', guidance: '' };
  if (tracking.refundStatus === 'completed') return {
    tone: 'success', icon: 'check', live: false, slow: false,
    title: ar ? 'اكتمل الإلغاء ورد المبلغ' : 'Cancelled and refunded',
    body: ar ? `أعدنا ${refund || 'المبلغ'} إلى وسيلة الدفع التي استخدمتها. قد يستغرق ظهوره في كشف حسابك بضعة أيام حسب البنك.` : `We returned ${refund || 'the amount'} to the payment method you used. It may take a few days to appear on your statement, depending on your bank.`,
    stages: [request, hotel('done', ar ? 'أكّد الفندق الإلغاء' : 'Confirmed by the hotel'), money('done', refundLine || (ar ? 'تم الرد' : 'Refunded')), finished('done')],
    expectation: '', guidance: '' };
  if (tracking.refundStatus === 'review') return {
    tone: 'attention', icon: 'alert', live: false, slow: false,
    title: ar ? 'تم إلغاء حجزك — رد المبلغ قيد المراجعة' : 'Cancelled — refund under review',
    body: ar ? 'أكّد الفندق الإلغاء، ويراجع فريقنا رد المبلغ يدوياً. سنتواصل معك عبر البريد، ويمكنك مراسلة الدعم بمرجع الإلغاء.' : 'The hotel confirmed the cancellation and our team is reviewing the refund by hand. We will email you, and you can contact support with the cancellation reference.',
    stages: [request, hotel('done', ar ? 'أكّد الفندق الإلغاء' : 'Confirmed by the hotel'), money('active', ar ? 'قيد المراجعة' : 'Under review'), finished('waiting')],
    expectation: '', guidance: '' };
  return {
    tone: 'working', icon: 'wallet', live: true, slow: false,
    title: ar ? 'تم إلغاء حجزك — جارٍ رد المبلغ' : 'Cancelled — refund on its way',
    body: ar ? `أكّد الفندق الإلغاء، وبدأنا رد ${refund || 'المبلغ'} إلى وسيلة الدفع التي استخدمتها.` : `The hotel confirmed the cancellation and we started returning ${refund || 'the amount'} to the payment method you used.`,
    stages: [request, hotel('done', ar ? 'أكّد الفندق الإلغاء' : 'Confirmed by the hotel'), money('active', refundLine || (ar ? 'جارٍ الرد' : 'In progress')), finished('waiting')],
    expectation: ar ? `يظهر المبلغ في حسابك عادةً خلال ${days} حسب البنك المصدر للبطاقة.` : `It usually reaches your account within ${days}, depending on the bank that issued your card.`,
    guidance: ar ? 'لا حاجة لأي إجراء منك. ستصلك رسالة عند اكتمال الرد، وتجد الحالة في «رحلاتي».' : 'Nothing is needed from you. We will email you when the refund completes; the status is also in My trips.' };
}
