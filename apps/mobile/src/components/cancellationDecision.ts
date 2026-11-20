import { cancellationMoneyText, parseCancellationTimestamp, type CancellationPresentation } from './cancellationPresentationModel';
import { canonicalDecimal } from './offerReviewModel';
import type { Money } from '../types';

/**
 * A supplier cancellation time. `compact` is the one-line form for summaries: device time,
 * no weekday, the year only when it is not this year, and a short "your time" label. The
 * full schedule keeps the long form with the exact UTC offset.
 */
export function policyTime(raw: string | null, language: string, clock: 'utc' | 'device' = 'utc', options: { weekday?: boolean; compact?: boolean; now?: number } = {}) {
  const stamp = parseCancellationTimestamp(raw);
  if (stamp === null) return null;
  const date = new Date(stamp);
  try {
    const ms = date.getUTCMilliseconds();
    const formatted = new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE-u-nu-latn' : language === 'en' ? 'en-GB' : language, {
      ...(options.weekday && !options.compact ? { weekday: 'short' as const } : {}),
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      ...(!options.compact || date.getFullYear() !== new Date(options.now ?? Date.now()).getFullYear() ? { year: 'numeric' as const } : {}),
      ...(date.getUTCSeconds() || ms ? { second: '2-digit' } : {}), ...(ms ? { fractionalSecondDigits: 3 } : {}),
      calendar: 'gregory', ...(clock === 'utc' ? { timeZone: 'UTC' } : {}),
    }).format(date);
    if (clock === 'utc') return formatted + ' UTC';
    if (options.compact) return formatted + (language === 'ar' ? ' بتوقيتك' : ' your time');
    // Use the offset at the supplier cutoff, including any future daylight-saving change.
    const minutes = -date.getTimezoneOffset();
    const two = (value: number) => String(value).padStart(2, '0');
    const offset = minutes === 0 ? 'UTC' : 'UTC' + (minutes > 0 ? '+' : '−')
      + two(Math.floor(Math.abs(minutes) / 60)) + ':' + two(Math.abs(minutes) % 60);
    return formatted + (language === 'ar' ? ' بتوقيت جهازك (' : ' your time (') + offset + ')';
  } catch { return date.toISOString(); }
}

export function isFullStayCharge(fee: Readonly<Money> | null, roomTotal?: Money | null) {
  return Boolean(fee && roomTotal && fee.currency === roomTotal.currency
    && canonicalDecimal(fee.amount) === canonicalDecimal(roomTotal.amount) && canonicalDecimal(fee.amount) !== '0');
}

export interface CancellationDecision {
  kind: CancellationPresentation['kind'];
  /** The answer to "until when can I cancel, and at what cost?" in one line. */
  headline: string;
  detail: string;
  /** Local-time deadline of the current free period when a fee follows it. */
  freeUntil: string | null;
  nonRefundable: boolean;
}

/** Describe only the current interval and the next contiguous change in a verified supplier schedule. */
/** `display` converts amounts for text only (payment currency); policy logic keeps supplier amounts. */
export type DisplayMoney = (money: Readonly<Money>) => Readonly<Money>;
export function cancellationDecision(model: CancellationPresentation, language: string, roomTotal?: Money | null, display?: DisplayMoney): CancellationDecision {
  const arabic = language === 'ar';
  const describeFee = (fee: Readonly<Money> | null) => {
    const text = cancellationMoneyText(fee && display ? display(fee) : fee);
    return text && isFullStayCharge(fee, roomTotal) ? text + (arabic ? ' (كامل سعر الإقامة)' : ' (the full stay price)') : text;
  };
  const amount = describeFee(model.fee);
  const headline = model.kind === 'free' ? (arabic ? 'الإلغاء مجاني الآن' : 'Free to cancel now')
    : model.kind === 'fee' && amount ? (arabic ? `إذا ألغيت الآن ستدفع ${amount}` : `Cancel now for ${amount}`)
      : (arabic ? 'تكلفة الإلغاء الآن غير مؤكدة' : 'Cost to cancel now is unconfirmed');
  const decision: CancellationDecision = { kind: model.kind, headline, detail: '', freeUntil: null, nonRefundable: false };
  if (model.kind === 'unknown') return decision;
  const periods = [...model.periods].sort((a,b) => (a.startTime ?? -Infinity) - (b.startTime ?? -Infinity));
  let index = periods.findIndex(period => period.active);
  // A full-price charge that runs until check-in with no later change is a non-refundable rate.
  if (model.kind === 'fee' && index >= 0 && !periods[index].endAt && isFullStayCharge(model.fee, roomTotal)) {
    decision.nonRefundable = true;
    decision.headline = arabic ? 'غير قابل للاسترداد' : 'Non-refundable';
    decision.detail = arabic ? `الإلغاء في أي وقت يكلّف ${amount}.` : `Cancelling at any time costs ${amount}.`;
    return decision;
  }
  while (index >= 0 && periods[index].endAt) {
    const end = periods[index];
    const at = policyTime(end.endAt, language, 'device', { compact: true });
    if (!at) break;
    const next = periods[index + 1];
    if (!next?.fee || next.startTime !== end.endTime) {
      if (model.kind === 'free') {
        decision.headline = arabic ? `إلغاء مجاني حتى ${at}` : `Free cancellation until ${at}`;
        decision.freeUntil = at;
        decision.detail = arabic ? 'لم يحدّد المورّد رسوم الإلغاء بعد هذا الموعد.' : 'The supplier did not state the charge after this time.';
      } else {
        decision.detail = arabic ? `يسري هذا الشرط قبل ${at}. لم تُحدّد الرسوم بعد ذلك.` : `This applies before ${at}. The later fee is unconfirmed.`;
      }
      break;
    }
    const nextAmount = canonicalDecimal(next.fee.amount);
    if (nextAmount !== canonicalDecimal(end.fee!.amount)) {
      if (nextAmount === '0') decision.detail = arabic ? `ابتداءً من ${at} يصبح الإلغاء مجانياً.` : `Free to cancel from ${at}.`;
      else if (model.kind === 'free') {
        decision.headline = arabic ? `إلغاء مجاني حتى ${at}` : `Free cancellation until ${at}`;
        decision.freeUntil = at;
        decision.detail = arabic ? `بعد ذلك يكلّف الإلغاء ${describeFee(next.fee)}.` : `After that, cancelling costs ${describeFee(next.fee)}.`;
      } else decision.detail = arabic ? `ابتداءً من ${at} تدفع ${describeFee(next.fee)} عند الإلغاء.`
        : `From ${at}, cancelling costs ${describeFee(next.fee)}.`;
      break;
    }
    index++;
  }
  return decision;
}
