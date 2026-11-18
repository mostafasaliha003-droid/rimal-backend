import type { Language } from '../i18n';
import type { Money } from '../types';
import type { OfferChangeKind, StayPriceChangeStatus } from './offerChangeSummary';

const en = {
  before: 'Previously shown', after: 'Updated offer',
  previousTotal: 'Previous full-stay total', updatedTotal: 'Updated full-stay total',
  priceMissing: 'Price not supplied',
  priceStatus: {
    increase: 'Full-stay price increased by', decrease: 'Full-stay price decreased by', unchanged: 'Full-stay price unchanged',
    differentCurrency: 'The price currency changed', unavailable: 'The price difference is not confirmed',
  } as Record<StayPriceChangeStatus, string>,
  differentCurrency: 'Totals are shown in their supplied currencies.',
  unavailable: 'A complete price and currency were not supplied for both offers.',
  updatedOnly: 'The supplier returned an updated offer. Review its current details before accepting.',
  kind: { price: 'Price', room: 'Room', bedding: 'Beds', meal: 'Meal plan', payment: 'Payment', taxes: 'Taxes & fees', cancellation: 'Cancellation conditions' } satisfies Record<OfferChangeKind, string>,
  roomDetailsChanged: 'Supplier room details changed.', roomDetailsSupplied: 'Supplier room details supplied.',
  roomDetailsMissing: 'Supplier room details are no longer supplied.',
  taxesChanged: 'Taxes or their inclusion changed.', cancellationChanged: 'Cancellation charges, periods or deadlines changed.',
  details: 'View changed conditions',
};
const ar: typeof en = {
  before: 'المعروض سابقاً', after: 'العرض المحدّث',
  previousTotal: 'إجمالي الإقامة السابق', updatedTotal: 'إجمالي الإقامة المحدّث',
  priceMissing: 'السعر غير محدّد',
  priceStatus: {
    increase: 'ارتفع إجمالي الإقامة بمقدار', decrease: 'انخفض إجمالي الإقامة بمقدار', unchanged: 'لم يتغيّر إجمالي الإقامة',
    differentCurrency: 'تغيّرت عملة السعر', unavailable: 'فرق السعر غير مؤكّد',
  },
  differentCurrency: 'تُعرض الإجماليات بعملاتها الواردة.',
  unavailable: 'لم يرد سعر وعملة كاملان لكلا العرضين.',
  updatedOnly: 'أعاد المورّد عرضاً محدّثاً. راجع تفاصيله الحالية قبل الموافقة.',
  kind: { price: 'السعر', room: 'الغرفة', bedding: 'الأسرّة', meal: 'الوجبات', payment: 'الدفع', taxes: 'الضرائب والرسوم', cancellation: 'شروط الإلغاء' },
  roomDetailsChanged: 'تغيّرت تفاصيل الغرفة لدى المورّد.', roomDetailsSupplied: 'وردت تفاصيل الغرفة من المورّد.',
  roomDetailsMissing: 'لم تعد تفاصيل الغرفة واردة من المورّد.',
  taxesChanged: 'تغيّرت الرسوم أو شمولها في السعر.', cancellationChanged: 'تغيّرت رسوم الإلغاء أو فتراته أو مواعيده.',
  details: 'عرض الشروط المتغيّرة',
};
export const offerChangesCopy = (language: Language) => language === 'ar' ? ar : en;

/** Pad only a validated derived difference. Never round or alter source totals. */
export function padStayPriceDifference(money: Readonly<Money>, language: Language): Readonly<Money> {
  let minimum = 0;
  try {
    const digits = new Intl.NumberFormat(language, { style: 'currency', currency: money.currency }).resolvedOptions().minimumFractionDigits;
    if (typeof digits === 'number' && Number.isInteger(digits) && digits >= 0 && digits <= 100) minimum = digits;
  }
  catch { /* Exact canonical text remains usable without currency metadata. */ }
  const [whole, fraction = ''] = money.amount.split('.');
  return { currency: money.currency, amount: fraction.length >= minimum ? money.amount : `${whole}.${fraction.padEnd(minimum, '0')}` };
}
