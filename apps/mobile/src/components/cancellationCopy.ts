import type { Language } from '../i18n';
import type { CancellationReason } from './cancellationPresentationModel';

interface CancellationCopy {
  title: string; historical: string; historicalNote: string;
  free: string; fee: string; unknown: string;
  deadline: string; previousDeadline: string; deadlinePassed: string; deadlineMissing: string; deadlineInvalid: string;
  timezone: string; from: string; before: string; startOpen: string; endOpen: string; timeInvalid: string;
  currentPeriod: string; amountMissing: string; currencyMissing: string; charge: string;
  periodIssue: string; reasons: Record<CancellationReason, string>;
  allCharges: (count: number) => string; period: (number: number) => string;
}
const en: CancellationCopy = {
  title: 'Cancellation conditions', historical: 'Previous cancellation conditions',
  historicalNote: 'For comparison only. These are not the current offer conditions.',
  free: 'No cancellation charge now', fee: 'Cancellation charge now', unknown: 'Current cancellation charge not confirmed',
  deadline: 'Supplier free-cancellation deadline', previousDeadline: 'Previous free-cancellation deadline',
  deadlinePassed: 'Free-cancellation deadline passed', deadlineMissing: 'Free-cancellation deadline not supplied.',
  deadlineInvalid: 'Free-cancellation deadline could not be verified.',
  timezone: 'All times are UTC+0.', from: 'From', before: 'Before', startOpen: 'No start boundary supplied', endOpen: 'No end boundary supplied',
  timeInvalid: 'Time could not be verified', currentPeriod: 'Includes the current time',
  amountMissing: 'Amount not supplied', currencyMissing: 'Currency not supplied', charge: 'Cancellation charge',
  periodIssue: 'This period could not be fully verified.',
  reasons: {
    missing: 'No cancellation charge schedule was supplied.', incomplete: 'The supplied cancellation details are incomplete.',
    invalid_period: 'Some cancellation periods could not be verified.', overlap: 'The supplied cancellation periods overlap.',
    currency_conflict: 'The supplied charges use conflicting currencies.', deadline_conflict: 'The supplied deadline and charge schedule do not agree.',
    gap: 'No supplied period covers the current time.', invalid_now: 'The current time could not be verified.',
    invalid_deadline: 'The supplied free-cancellation deadline could not be verified.',
  },
  allCharges: count => `All cancellation charges (${count})`, period: number => `Period ${number}`,
};
const ar: CancellationCopy = {
  title: 'شروط الإلغاء', historical: 'شروط الإلغاء السابقة',
  historicalNote: 'للمقارنة فقط. هذه ليست شروط العرض الحالي.',
  free: 'لا توجد رسوم إلغاء الآن', fee: 'رسوم الإلغاء الآن', unknown: 'رسوم الإلغاء الحالية غير مؤكّدة',
  deadline: 'موعد الإلغاء المجاني الوارد من المورّد', previousDeadline: 'موعد الإلغاء المجاني السابق',
  deadlinePassed: 'انقضى موعد الإلغاء المجاني', deadlineMissing: 'لم يُحدّد موعد للإلغاء المجاني.',
  deadlineInvalid: 'تعذّر التحقق من موعد الإلغاء المجاني.',
  timezone: 'جميع الأوقات بتوقيت UTC+0.', from: 'من', before: 'قبل', startOpen: 'لم يُحدّد حد للبداية', endOpen: 'لم يُحدّد حد للنهاية',
  timeInvalid: 'تعذّر التحقق من الوقت', currentPeriod: 'تشمل الوقت الحالي',
  amountMissing: 'المبلغ غير محدّد', currencyMissing: 'العملة غير محدّدة', charge: 'رسوم الإلغاء',
  periodIssue: 'تعذّر التحقق من تفاصيل هذه الفترة كاملة.',
  reasons: {
    missing: 'لم يرد جدول لرسوم الإلغاء.', incomplete: 'تفاصيل الإلغاء الواردة غير مكتملة.',
    invalid_period: 'تعذّر التحقق من بعض فترات الإلغاء.', overlap: 'فترات الإلغاء الواردة متداخلة.',
    currency_conflict: 'تستخدم الرسوم الواردة عملات متعارضة.', deadline_conflict: 'لا يتوافق الموعد الوارد مع جدول رسوم الإلغاء.',
    gap: 'لا توجد فترة واردة تشمل الوقت الحالي.', invalid_now: 'تعذّر التحقق من الوقت الحالي.',
    invalid_deadline: 'تعذّر التحقق من موعد الإلغاء المجاني الوارد.',
  },
  allCharges: count => `كل رسوم الإلغاء (${count})`, period: number => `الفترة ${number}`,
};
export const cancellationCopy = (language: Language): CancellationCopy => language === 'ar' ? ar : en;
