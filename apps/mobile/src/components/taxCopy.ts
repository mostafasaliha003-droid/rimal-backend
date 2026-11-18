import type { Language } from '../i18n';

const en = {
  title: 'Taxes & fees',
  payable: 'Payable at the property',
  excludedNote: 'These charges are not included in the stay price.',
  includedOnly: 'The supplied charges are included in the price.',
  inclusionUnknown: 'Inclusion in the price is not specified for some charges.',
  informationMissing: 'Tax and fee information was not supplied.',
  detailsMissing: 'Some charge amounts or currencies are not supplied.',
  totalUnknown: 'Total not confirmed',
  currencyUnknown: 'Currency not supplied',
  amountUnknown: 'Amount not supplied',
  nameUnknown: 'Charge name not supplied',
  included: 'Included in the price',
  excluded: 'Not included · Payable at the property',
  unknown: 'Inclusion not supplied',
  historical: 'According to the previous offer',
  updated: 'According to the updated offer',
  originalCurrencies: 'Amounts are shown in their supplied currencies.',
  breakdown: (count: number) => `Charge breakdown (${count})`,
};

const ar: typeof en = {
  title: 'الضرائب والرسوم',
  payable: 'رسوم تُدفع في الفندق',
  excludedNote: 'هذه الرسوم غير مشمولة في سعر الإقامة.',
  includedOnly: 'الرسوم الواردة مشمولة في السعر.',
  inclusionUnknown: 'شمول بعض الرسوم في السعر غير محدّد.',
  informationMissing: 'لم ترد معلومات عن الضرائب والرسوم.',
  detailsMissing: 'بعض مبالغ الرسوم أو عملاتها غير محدّدة.',
  totalUnknown: 'الإجمالي غير مؤكّد',
  currencyUnknown: 'العملة غير محدّدة',
  amountUnknown: 'المبلغ غير محدّد',
  nameUnknown: 'اسم الرسم غير محدّد',
  included: 'مشمول في السعر',
  excluded: 'غير مشمول · يُدفع في الفندق',
  unknown: 'الشمول في السعر غير محدّد',
  historical: 'وفقاً للعرض السابق',
  updated: 'وفقاً للعرض المحدّث',
  originalCurrencies: 'تُعرض المبالغ بعملاتها الواردة.',
  breakdown: (count: number) => `تفاصيل الرسوم (${count})`,
};

// Translate only known supplier identifiers. An unfamiliar name stays visible.
const names: Record<string, readonly [string, string]> = {
  city_tax: ['City tax', 'ضريبة المدينة'],
  resort_fee: ['Resort fee', 'رسوم المنتجع'],
  vat: ['VAT', 'ضريبة القيمة المضافة'],
  tourism_fee: ['Tourism fee', 'رسوم السياحة'],
  tourism_tax: ['Tourism tax', 'ضريبة السياحة'],
  occupancy_tax: ['Occupancy tax', 'ضريبة الإشغال'],
  service_fee: ['Service fee', 'رسوم الخدمة'],
  service_tax: ['Service tax', 'ضريبة الخدمة'],
};

export const taxCopy = (language: Language) => language === 'ar' ? ar : en;

export function taxName(name: string | null | undefined, language: Language): string {
  if (typeof name !== 'string' || !name.trim()) return taxCopy(language).nameUnknown;
  const source = name.trim();
  const key = source.toLowerCase().replace(/[\s-]+/g, '_');
  if (Object.hasOwn(names, key)) return names[key][language === 'ar' ? 1 : 0];
  return source.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}
