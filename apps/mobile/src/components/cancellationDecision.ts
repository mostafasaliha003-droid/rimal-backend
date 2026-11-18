import { cancellationMoneyText, parseCancellationTimestamp, type CancellationPresentation } from './cancellationPresentationModel';
import { canonicalDecimal } from './offerReviewModel';
import type { Money } from '../types';

export function policyTime(raw: string | null, language: string, clock: 'utc' | 'device' = 'utc') {
  const stamp = parseCancellationTimestamp(raw);
  if (stamp === null) return null;
  const date = new Date(stamp);
  try {
    const ms = date.getUTCMilliseconds();
    const formatted = new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : language, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      ...(date.getUTCSeconds() || ms ? { second: '2-digit' } : {}), ...(ms ? { fractionalSecondDigits: 3 } : {}),
      calendar: 'gregory', ...(clock === 'utc' ? { timeZone: 'UTC' } : {}),
    }).format(date);
    if (clock === 'utc') return formatted + ' UTC';
    // Use the offset at the supplier cutoff, including any future daylight-saving change.
    const minutes = -date.getTimezoneOffset();
    const two = (value: number) => String(value).padStart(2, '0');
    const offset = minutes === 0 ? 'UTC' : 'UTC' + (minutes > 0 ? '+' : '−')
      + two(Math.floor(Math.abs(minutes) / 60)) + ':' + two(Math.abs(minutes) % 60);
    return formatted + (language === 'ar' ? ' بتوقيت جهازك (' : ' your time (') + offset + ')';
  } catch { return date.toISOString(); }
}

/** Describe only the current interval and the next contiguous change in a verified supplier schedule. */
export function cancellationDecision(model: CancellationPresentation, language: string, roomTotal?: Money | null) {
  const arabic = language === 'ar';
  const describeFee = (fee: Readonly<Money> | null) => {
    const text = cancellationMoneyText(fee);
    const isWholeStay = fee && roomTotal && fee.currency === roomTotal.currency
      && canonicalDecimal(fee.amount) === canonicalDecimal(roomTotal.amount) && canonicalDecimal(fee.amount) !== '0';
    return text && isWholeStay ? text + (arabic ? ' (كامل سعر الإقامة)' : ' (the full stay price)') : text;
  };
  const amount = describeFee(model.fee);
  const headline = model.kind === 'free' ? (arabic ? 'الإلغاء مجاني الآن' : 'Free to cancel now')
    : model.kind === 'fee' && amount ? (arabic ? `إذا ألغيت الآن ستدفع ${amount}` : `Cancel now for ${amount}`)
      : (arabic ? 'تكلفة الإلغاء الآن غير مؤكدة' : 'Cost to cancel now is unconfirmed');
  const decision = { kind: model.kind, headline, detail: '' };
  if (model.kind === 'unknown') return decision;
  const periods = [...model.periods].sort((a,b) => (a.startTime ?? -Infinity) - (b.startTime ?? -Infinity));
  let index = periods.findIndex(period => period.active);
  while (index >= 0 && periods[index].endAt) {
    const end = periods[index];
    const at = policyTime(end.endAt, language, 'device');
    if (!at) break;
    const next = periods[index + 1];
    if (!next?.fee || next.startTime !== end.endTime) {
      decision.detail = arabic ? `يسري هذا الشرط قبل ${at}. لم تُحدّد الرسوم بعد ذلك.`
        : `This applies before ${at}. The later fee is unconfirmed.`;
      break;
    }
    const nextAmount = canonicalDecimal(next.fee.amount);
    if (nextAmount !== canonicalDecimal(end.fee!.amount)) {
      if (nextAmount === '0') decision.detail = arabic ? `ابتداءً من ${at} يصبح الإلغاء مجانياً.` : `Free to cancel from ${at}.`;
      else decision.detail = arabic ? `ابتداءً من ${at} تدفع ${describeFee(next.fee)} عند الإلغاء.`
        : `From ${at}, cancelling costs ${describeFee(next.fee)}.`;
      break;
    }
    index++;
  }
  return decision;
}
