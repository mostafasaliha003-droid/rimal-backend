import type { RoomOffer } from '../types';
import { presentTaxes } from './taxPresentationModel';
import { cancellationMoneyText, presentCancellation } from './cancellationPresentationModel';
import { roomMealLabel } from './roomChoiceModel';
import { cancellationTermsKey, canonicalDecimal, taxTermsKey } from './offerReviewModel';

const en = {
  price: 'Room total for all nights', meal: 'Meals', cancellation: 'Cancellation', payment: 'Payment', fees: 'At the property', bedding: 'Beds',
  roomOnly: 'Room only', unknown: 'Not specified', noPrice: 'Price unavailable', partnerPayment: 'Through Mkhadda',
  free: 'Free cancellation now', freeUntil: (deadline: string) => `Free until ${deadline}`,
  penalty: (amount: string) => `Fee now · ${amount}`, included: 'Listed taxes included', other: 'Other fees unspecified',
  feesUnknown: 'Fees not specified', unknownTotal: 'Total unspecified', terms: 'Full rate terms', compare: 'Compare',
  selected: 'Added', compareTitle: 'Compare offers', clear: 'Clear', close: 'Close', differences: 'Differences only',
  compareCount: (count: number) => `${count} of 2 selected`, selectAnother: 'Select another offer',
  filters: 'Filter & sort', choose: 'Review offer', overview: 'Hotel details',
  schedules: 'See cancellation schedules', taxDetails: 'See fee breakdowns',
  plans: (count: number) => count === 1 ? '1 offer' : `${count} offers`,
  dates: (a: string, b: string) => `${a} – ${b}`, same: 'These offers share the same listed terms.',
};
const ar: typeof en = {
  price: 'سعر الغرفة لكل الليالي', meal: 'الوجبات', cancellation: 'الإلغاء', payment: 'الدفع', fees: 'في الفندق', bedding: 'الأسرّة',
  roomOnly: 'بدون وجبات', unknown: 'غير محدد', noPrice: 'السعر غير متاح', partnerPayment: 'عبر مخدة',
  free: 'إلغاء مجاني الآن', freeUntil: deadline => `مجاني حتى ${deadline}`, penalty: amount => `رسوم الإلغاء الآن · ${amount}`,
  included: 'الضرائب المذكورة مشمولة', other: 'رسوم أخرى غير محددة', feesUnknown: 'الرسوم غير محددة', unknownTotal: 'الإجمالي غير محدد',
  terms: 'شروط العرض كاملة', compare: 'قارن', selected: 'مضاف', compareTitle: 'مقارنة العروض', clear: 'مسح', close: 'إغلاق',
  differences: 'الفروقات فقط', compareCount: count => `${count} من عرضين`, selectAnother: 'اختر عرضاً آخر',
  filters: 'التصفية والترتيب', choose: 'مراجعة العرض', overview: 'تفاصيل الفندق',
  schedules: 'تفاصيل فترات الإلغاء', taxDetails: 'تفاصيل الرسوم',
  plans: count => count === 1 ? 'عرض واحد' : `عدد العروض: ${count}`, dates: (a,b) => `${a} – ${b}`, same: 'الشروط المذكورة متطابقة في العرضين.',
};
export const rateCopy = (language: string) => language === 'ar' ? ar : en;

export function roomPaymentLabel(offer: RoomOffer, language: string) {
  const copy = rateCopy(language);
  // A deposit rate is settled by the booking partner. It gives no guest charge deadline.
  return offer.paymentType === 'deposit' ? copy.partnerPayment : copy.unknown;
}

function deadlineText(value: string, language: string) {
  const date = new Date(value);
  try {
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', calendar: 'gregory', year: 'numeric', month: 'short',
      day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    if (date.getUTCSeconds() || date.getUTCMilliseconds()) options.second = '2-digit';
    if (date.getUTCMilliseconds()) options.fractionalSecondDigits = 3;
    return `${new Intl.DateTimeFormat(language, options).format(date)} UTC`;
  } catch { return value; }
}

export function roomRateFacts(offer: RoomOffer, language: string, now: number) {
  const copy = rateCopy(language);
  const policy = presentCancellation(offer.cancellation, now);
  const taxes = presentTaxes(offer.taxes);
  const amounts = taxes.excludedGroups.map(group => group.subtotal && group.complete
    ? `${group.currency} ${group.subtotal.amount}` : `${group.currency} · ${copy.unknownTotal}`);
  if (taxes.unassignedExcluded.length) amounts.push(copy.unknownTotal);
  if (amounts.length && taxes.hasUnknown) amounts.push(copy.other);
  const fees = amounts.length ? amounts.join(' + ') : taxes.dataState === 'notSupplied' || taxes.hasUnknown ? copy.feesUnknown : copy.included;
  const fee = cancellationMoneyText(policy.fee);
  const activeEnd = policy.periods.find(period => period.active)?.endAt;
  const cancellation = policy.kind === 'free' ? activeEnd ? copy.freeUntil(deadlineText(activeEnd, language)) : copy.free
    : policy.kind === 'fee' && fee ? copy.penalty(fee) : copy.unknown;
  return { price: offer.price ? `${offer.price.currency} ${offer.price.amount}` : copy.noPrice,
    meal: roomMealLabel(offer.meal, copy.roomOnly, copy.unknown, language), cancellation,
    payment: roomPaymentLabel(offer, language), fees, bedding: offer.bedding || copy.unknown };
}

export function roomFactKeys(offer: RoomOffer) {
  return {
    price: offer.price ? JSON.stringify([offer.price.currency, canonicalDecimal(offer.price.amount)]) : null,
    bedding: offer.bedding ?? null, meal: offer.meal ?? null, payment: offer.paymentType ?? null,
    cancellation: cancellationTermsKey(offer.cancellation), fees: taxTermsKey(offer.taxes),
  };
}
