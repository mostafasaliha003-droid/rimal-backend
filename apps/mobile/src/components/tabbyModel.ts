/*
 * Tabby wording and arithmetic, kept in one place. The messages follow Tabby's integration
 * guidelines (their required meaning, in Arabic and English); the instalment is the AED total
 * split in four, rounded up to the fils so four instalments always cover the total.
 */
export type TabbyRejection = 'not_available' | 'order_amount_too_high' | 'order_amount_too_low';
export const TABBY_REJECTIONS: readonly TabbyRejection[] = ['not_available', 'order_amount_too_high', 'order_amount_too_low'];
export type TabbyOutcome = TabbyRejection | 'rejected' | 'expired' | 'closed' | 'unavailable';

export function tabbyName(language: string) {
  return language === 'ar' ? 'ادفع لاحقًا مع تابي' : 'Pay later with Tabby';
}

/*
 * Tabby's standard in-app promo, word for word (Tabby does not approve custom promo copy):
 *   "4 payments of XX.XX/mo or up to 12 months. Learn more"
 * where XX.XX = order total × 1.015 / 4 in the store currency (AED), and "Learn more" opens
 * Tabby's own pop-up. docs.tabby.ai/pay-in-4-custom-integration/mobile-apps/app-promo-messaging
 */
export function tabbyMonthly(amount: string, currency: string): string | null {
  if (currency !== 'AED' || typeof amount !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const fils = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(fils) || fils <= 0) return null;
  const monthly = Math.round(fils * 1.015 / 4);
  return `${Math.floor(monthly / 100).toLocaleString('en-US')}.${String(monthly % 100).padStart(2, '0')}`;
}

export function tabbyPromoText(monthly: string, language: string) {
  // The amount is kept left-to-right inside the Arabic sentence.
  const money = `\u2066AED ${monthly}\u2069`;
  return language === 'ar'
    ? { text: `4 دفعات بقيمة ${money} شهريًا أو حتى 12 شهرًا.`, learnMore: 'اعرف المزيد' }
    : { text: `4 payments of ${money}/mo or up to 12 months.`, learnMore: 'Learn more' };
}

export interface TabbyPromoSettings { merchantCode: string; publicKey: string }
/** Tabby's own "Learn more" pop-up for an AED amount (UAE), in the guest's language. */
export function tabbyLearnMoreUrl(price: string, language: string, settings: TabbyPromoSettings): string | null {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(price) || !/^[A-Za-z0-9_-]{1,64}$/.test(settings.merchantCode)
    || !/^pk_(?:test_)?[A-Za-z0-9-]{10,100}$/.test(settings.publicKey)) return null;
  const lang = language === 'ar' ? 'ar' : 'en';
  const [whole, fraction = ''] = price.split('.');
  const query = new URLSearchParams({ price: `${whole}.${fraction.padEnd(2, '0')}`, currency: 'AED', lang,
    merchant_code: settings.merchantCode, public_key: settings.publicKey });
  return `https://checkout.tabby.ai/promos/product-page/installments/${lang}/?${query.toString()}`;
}

export function paymentChoiceCopy(language: string) {
  const ar = language === 'ar';
  return {
    heading: ar ? 'كيف تحب تدفع؟' : 'How would you like to pay?',
    card: ar
      ? { tag: 'خلّصها وارتاح', title: 'ادفعها مرة وحدة', body: 'بطاقة أو محفظة رقمية. المبلغ كاملاً في صفحة دفع آمنة، وبعدها نوم بلا أرقام في راسك.' }
      : { tag: 'One tap, all done', title: 'Pay it all at once', body: 'Card or digital wallet. The full amount on a secure page, then sleep with no numbers in your head.' },
  };
}

/** "AED 450.75" -> "112.69": a quarter, rounded up to the fils. Null when it is not an AED amount. */
export function tabbyInstallment(amount: string, currency: string): string | null {
  if (currency !== 'AED' || typeof amount !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const fils = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(fils) || fils <= 0) return null;
  const quarter = Math.ceil(fils / 4);
  return `${Math.floor(quarter / 100)}.${String(quarter % 100).padStart(2, '0')}`;
}

/** The server's payment_error for a Tabby attempt ("tabby_expired" ...) as an outcome, or null. */
export function tabbyOutcome(code: string | undefined | null): TabbyOutcome | null {
  if (!code || !code.startsWith('tabby_')) return null;
  const value = code.slice(6);
  return (TABBY_REJECTIONS as readonly string[]).includes(value) || ['rejected', 'expired', 'closed', 'unavailable'].includes(value)
    ? value as TabbyOutcome : 'unavailable';
}

export function tabbyMessage(outcome: TabbyOutcome, language: string): { title: string; body: string } {
  const ar = language === 'ar';
  switch (outcome) {
    case 'order_amount_too_high': return ar
      ? { title: 'المبلغ أعلى من حدّك مع تابي', body: 'قيمة هذا الحجز أعلى من حدّ الإنفاق المتاح لك حالياً مع تابي. جرّب حجزاً أقل قيمة أو استخدم طريقة دفع أخرى.' }
      : { title: 'Above your Tabby limit', body: 'This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method.' };
    case 'order_amount_too_low': return ar
      ? { title: 'المبلغ أقل من الحد الأدنى لتابي', body: 'قيمة هذا الحجز أقل من الحد الأدنى المطلوب لاستخدام تابي. استخدم طريقة دفع أخرى.' }
      : { title: 'Below the Tabby minimum', body: 'The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method.' };
    case 'expired': case 'closed': return ar
      ? { title: 'لم يكتمل الدفع مع تابي', body: 'لقد ألغيت الدفع. يرجى إعادة المحاولة أو اختيار طريقة دفع أخرى. لم يُخصم أي مبلغ.' }
      : { title: 'Tabby payment not completed', body: 'You aborted the payment. Please retry or choose another payment method. Nothing was charged.' };
    case 'unavailable': return ar
      ? { title: 'تعذّر بدء الدفع مع تابي', body: 'لم نتمكن من فتح تابي الآن. أعد المحاولة بعد قليل أو اختر طريقة دفع أخرى. لم يُخصم أي مبلغ.' }
      : { title: 'Tabby could not start', body: 'We could not open Tabby right now. Try again shortly or choose another payment method. Nothing was charged.' };
    default: return ar
      ? { title: 'لم توافق تابي على هذه العملية', body: 'عذراً، لا تستطيع تابي الموافقة على هذه العملية. يرجى استخدام طريقة دفع أخرى لإتمام حجزك.' }
      : { title: 'Tabby could not approve this purchase', body: 'Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order.' };
  }
}

/*
 * Tabby's home screen banner, from Tabby's Merchant guidelines (Marketing Toolkit, 27 Nov 2026):
 * - UAE core message for purchases of AED 100 and over (and for travel): lead "Pay over time",
 *   supporting line "4 interest-free payments or up to 12 months." (slides 7–8);
 * - any communication referencing Tabby's financial terms carries the UAE disclaimer (slide 11).
 * Arabic uses Tabby's own Arabic wording from its widget ("ادفع على راحتك", "4 دفعات بدون فوائد",
 * "أو حتى 12 شهرًا"). The disclaimer stays in Tabby's exact English legal wording in both languages.
 * Never "instalments", "free", "no credit checks" or "affordable" (slide 10).
 */
export const TABBY_UAE_DISCLAIMER = 'Pay Later (Short Term Credit) is provided by Tabby LLC. Terms and conditions apply. For more information or to contact us, visit tabby.ai.';

export function tabbyBannerCopy(language: string) {
  return language === 'ar'
    ? { lead: 'ادفع على راحتك', support: '4 دفعات بدون فوائد أو حتى 12 شهرًا.', disclaimer: TABBY_UAE_DISCLAIMER }
    : { lead: 'Pay over time', support: '4 interest-free payments or up to 12 months.', disclaimer: TABBY_UAE_DISCLAIMER };
}
