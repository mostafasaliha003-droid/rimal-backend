import type { Money, RoomOffer } from '../types';
import type { Language } from '../i18n';
import { presentTaxes } from './taxPresentationModel';
import { presentCancellation } from './cancellationPresentationModel';
import { cancellationDecision, type DisplayMoney } from './cancellationDecision';
import { roomMealLabel, type RoomChoiceEntry } from './roomChoiceModel';
import { compareStayPrices } from './offerChangeSummary';
import { padStayPriceDifference } from './offerChangesCopy';
import { cancellationTermsKey, canonicalDecimal, taxTermsKey } from './offerReviewModel';
import { exactAmount } from './format';

const en = {
  price: 'Room total for all nights', meal: 'Meals', cancellation: 'Cancellation', payment: 'Payment', fees: 'At the property', bedding: 'Beds',
  unknown: 'Not specified', noPrice: 'Price unavailable', partnerPayment: 'Through Mkhadda',
  included: 'Listed taxes included', other: 'Other fees unspecified',
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
  unknown: 'غير محدد', noPrice: 'السعر غير متاح', partnerPayment: 'عبر مخدة',
  included: 'الضرائب المذكورة مشمولة', other: 'رسوم أخرى غير محددة', feesUnknown: 'الرسوم غير محددة', unknownTotal: 'الإجمالي غير محدد',
  terms: 'شروط العرض كاملة', compare: 'قارن', selected: 'مضاف', compareTitle: 'مقارنة العروض', clear: 'مسح', close: 'إغلاق',
  differences: 'الفروقات فقط', compareCount: count => `${count} من عرضين`, selectAnother: 'اختر عرضاً آخر',
  filters: 'التصفية والترتيب', choose: 'مراجعة العرض', overview: 'تفاصيل الفندق',
  schedules: 'تفاصيل فترات الإلغاء', taxDetails: 'تفاصيل الرسوم',
  plans: count => count === 0 ? '0 عروض' : count === 1 ? 'عرض واحد' : count === 2 ? 'عرضان' : `${count} ${count <= 10 ? 'عروض' : 'عرضاً'}`, dates: (a,b) => `${a} – ${b}`, same: 'الشروط المذكورة متطابقة في العرضين.',
};
export const rateCopy = (language: string) => language === 'ar' ? ar : en;

export function roomPaymentLabel(offer: RoomOffer, language: string) {
  const copy = rateCopy(language);
  // A deposit rate is settled by the booking partner. It gives no guest charge deadline.
  return offer.paymentType === 'deposit' ? copy.partnerPayment : copy.unknown;
}

export function roomRateFacts(offer: RoomOffer, language: string, now: number, display?: DisplayMoney) {
  const copy = rateCopy(language);
  const policy = presentCancellation(offer.cancellation, now);
  const taxes = presentTaxes(offer.taxes);
  const amounts = taxes.excludedGroups.map(group => group.subtotal && group.complete
    ? `${group.currency} ${exactAmount(group.subtotal.amount, group.currency) ?? group.subtotal.amount}` : `${group.currency} · ${copy.unknownTotal}`);
  if (taxes.unassignedExcluded.length) amounts.push(copy.unknownTotal);
  if (amounts.length && taxes.hasUnknown) amounts.push(copy.other);
  const fees = amounts.length ? amounts.join(' + ') : taxes.dataState === 'notSupplied' || taxes.hasUnknown ? copy.feesUnknown : copy.included;
  const decision = cancellationDecision(policy, language, offer.price, display);
  const shown = offer.price && display ? display(offer.price) : offer.price;
  const cancellation = [decision.headline, decision.detail].filter(Boolean).join('\n');
  return { price: shown ? `${shown.currency} ${shown.amount}` : copy.noPrice,
    meal: mealDescription(offer, language), cancellation, decision,
    payment: roomPaymentLabel(offer, language), fees, bedding: offer.bedding || copy.unknown };
}

export function roomFactKeys(offer: RoomOffer) {
  return {
    price: offer.price ? JSON.stringify([offer.price.currency, canonicalDecimal(offer.price.amount)]) : null,
    bedding: offer.bedding ?? null, meal: JSON.stringify([offer.meal ?? null, offer.noChildMeal === true]), payment: offer.paymentType ?? null,
    cancellation: cancellationTermsKey(offer.cancellation), fees: taxTermsKey(offer.taxes),
  };
}

export function mealPlanTitle(value: string | undefined, language: string) {
  const ar = language === 'ar';
  const plan = value?.trim().toLowerCase().replace(/_/g, '-');
  switch (plan) {
    case 'nomeal': return ar ? 'غرفة فقط' : 'Room only';
    case 'breakfast': return ar ? 'يشمل الإفطار' : 'Breakfast included';
    case 'half-board': return ar ? 'وجبتان مشمولتان' : 'Two meals included';
    case 'full-board': return ar ? 'ثلاث وجبات مشمولة' : 'Three meals included';
    case 'half-board-lunch': return ar ? 'وجبتان تشملان الغداء' : 'Two meals including lunch';
    case 'half-board-dinner': return ar ? 'وجبتان تشملان العشاء' : 'Two meals including dinner';
    default: return roomMealLabel(value, ar ? 'غرفة فقط' : 'Room only', ar ? 'الوجبات غير محددة' : 'Meals unspecified', language);
  }
}

export function mealDescription(offer: Pick<RoomOffer, 'meal' | 'noChildMeal'>, language: string, showMissingChildTerm = false) {
  const title = mealPlanTitle(offer.meal, language);
  if (offer.noChildMeal && offer.meal?.trim().toLowerCase() !== 'nomeal')
    return title + (language === 'ar' ? ' · وجبات الأطفال غير مشمولة' : ' · Children’s meals excluded');
  if (showMissingChildTerm && !offer.noChildMeal)
    return title + (language === 'ar' ? ' · تغطية وجبات الأطفال غير محددة' : ' · Children’s meal coverage unspecified');
  return title;
}

export function roomPriceDifference(lowest: Money | null, current: Money | null, language: Language) {
  const change = compareStayPrices(lowest, current);
  if (change.status !== 'increase' || !change.difference) return null;
  const delta = padStayPriceDifference(change.difference, language);
  const amount = `\u2066${delta.currency}\u00a0${delta.amount}\u2069`;
  return language === 'ar' ? `أعلى من أقل سعر للغرفة بـ ${amount}` : `${amount} above lowest room price`;
}

/** Label both choices with the first visible fact that distinguishes them. */
export function comparedPlanNames(entries: readonly RoomChoiceEntry[], language: Language, now: number) {
  const names = entries.map(({ offer }) => mealPlanTitle(offer.meal, language));
  if (entries.length !== 2 || names[0] !== names[1]) return names;
  const offers = entries.map(entry => entry.offer);
  if (offers[0].noChildMeal !== offers[1].noChildMeal && offers.every(offer => offer.meal?.toLowerCase() !== 'nomeal'))
    return offers.map(offer => mealDescription(offer, language, true));
  const facts = offers.map(offer => roomRateFacts(offer, language, now));
  const prices = compareStayPrices(offers[0].price, offers[1].price);
  const qualifiers = [
    offers.map(offer => offer.name),
    ...(prices.status === 'unchanged' ? [] : [facts.map(fact => fact.price)]),
    facts.map(fact => fact.decision.headline),
    facts.map(fact => fact.bedding),
    facts.map(fact => fact.fees),
  ];
  const distinction = qualifiers.find(([a,b]) => a !== b) ?? entries.map(entry =>
    language === 'ar' ? `خيار ${entry.index + 1}` : `Option ${entry.index + 1}`);
  return names.map((name, index) => `${name} · ${distinction[index]}`);
}
