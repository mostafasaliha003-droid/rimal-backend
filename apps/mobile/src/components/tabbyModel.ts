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
