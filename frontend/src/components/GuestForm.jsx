import { useState } from 'react';
import { CheckCircle2, LockKeyhole, UserCircle } from 'lucide-react';
import PriceDisplay from './PriceDisplay';
import { useLanguage } from '../i18n';

const emptyErrors = {};

function validateGuest(guestDetails, acceptedTerms, t) {
    const errors = {};
    if (!guestDetails.firstName?.trim()) errors.firstName = t('checkout.firstNameRequired', 'أدخل الاسم الأول.');
    if (!guestDetails.lastName?.trim()) errors.lastName = t('checkout.lastNameRequired', 'أدخل اسم العائلة.');
    if (!guestDetails.email?.trim()) errors.email = t('checkout.emailRequired', 'أدخل البريد الإلكتروني.');
    else if (!/^\S+@\S+\.\S+$/.test(guestDetails.email.trim())) errors.email = t('checkout.emailInvalid', 'تحقق من صيغة البريد الإلكتروني.');
    if (!guestDetails.phone?.trim()) errors.phone = t('checkout.phoneRequired', 'أدخل رقم الهاتف مع رمز الدولة.');
    else if (guestDetails.phone.trim().length < 7) errors.phone = t('checkout.phoneInvalid', 'أدخل رقم هاتف صالحاً.');

    (guestDetails.rooms || []).forEach((room, roomIndex) => {
        room.guests.forEach((traveler, travelerIndex) => {
            if (roomIndex === 0 && travelerIndex === 0) return;
            if (!traveler.firstName?.trim()) errors[`traveler-${roomIndex}-${travelerIndex}-firstName`] = t('checkout.firstNameRequired', 'أدخل الاسم الأول.');
            if (!traveler.lastName?.trim()) errors[`traveler-${roomIndex}-${travelerIndex}-lastName`] = t('checkout.lastNameRequired', 'أدخل اسم العائلة.');
        });
    });

    if (!acceptedTerms) errors.terms = t('checkout.termsRequired', 'يرجى تأكيد مراجعة السعر والرسوم وشروط الإلغاء.');
    return errors;
}

function FieldError({ id, message }) {
    return message ? <p id={id} role="alert" className="mt-2 text-xs font-bold text-red-700">{message}</p> : null;
}

export default function GuestForm({
    guestDetails,
    onGuestDetailsChange,
    onSubmit,
    formId = 'checkout-form',
    isSubmitting = false,
    paymentAvailable = false,
    onValidationError,
    total,
    currency,
    displayCurrency,
    displayRates
}) {
    const { t } = useLanguage();
    const [errors, setErrors] = useState(emptyErrors);
    const [acceptedTerms, setAcceptedTerms] = useState(false);

    const updateGuest = patch => onGuestDetailsChange({ ...guestDetails, ...patch });
    const clearError = key => setErrors(current => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
    });
    const validateAndSubmit = event => {
        event.preventDefault();
        const nextErrors = validateGuest(guestDetails, acceptedTerms, t);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            onValidationError?.(t('checkout.reviewFields', 'يرجى مراجعة الحقول الموضحة قبل المتابعة.'));
            const firstError = Object.keys(nextErrors)[0];
            window.requestAnimationFrame(() => document.getElementById(`guest-error-${firstError}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            return;
        }
        onSubmit(event);
    };

    return (
        <form id={formId} onSubmit={validateAndSubmit} className="space-y-8" noValidate>
            <section aria-labelledby="guest-section-title" className="surface-card rounded-3xl p-6 sm:p-8">
                <div className="flex items-start gap-4 border-b border-slate-100 pb-6">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cyan-50 text-[var(--remal-blue)]"><UserCircle size={25} /></div>
                    <div>
                        <p className="eyebrow">{t('checkout.stepGuest', 'الخطوة 1 من 2')}</p>
                        <h2 id="guest-section-title" className="mt-1 text-2xl font-black text-slate-900">{t('checkout.guestTitle', 'بيانات الضيوف')}</h2>
                        <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{t('checkout.guestDescription', 'اكتب الأسماء كما تظهر في وثيقة السفر لتجنب أي تأخير عند تسجيل الوصول.')}</p>
                    </div>
                </div>

                <div className="mt-7 grid grid-cols-1 gap-6 md:grid-cols-2">
                    <label htmlFor="guest-first-name" className="block space-y-2 text-sm font-bold text-slate-700">{t('checkout.firstName', 'الاسم الأول كما في وثيقة السفر')}
                        <input id="guest-first-name" name="given-name" autoComplete="given-name" maxLength={80} required type="text" aria-required="true" aria-invalid={Boolean(errors.firstName)} aria-describedby={errors.firstName ? 'guest-error-firstName' : undefined} value={guestDetails.firstName} onChange={event => { updateGuest({ firstName: event.target.value }); clearError('firstName'); }} className={`min-h-12 w-full rounded-2xl border bg-slate-50 px-4 text-sm font-semibold outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100 ${errors.firstName ? 'border-red-400' : 'border-slate-200'}`} />
                        <FieldError id="guest-error-firstName" message={errors.firstName} />
                    </label>
                    <label htmlFor="guest-last-name" className="block space-y-2 text-sm font-bold text-slate-700">{t('checkout.lastName', 'اسم العائلة كما في وثيقة السفر')}
                        <input id="guest-last-name" name="family-name" autoComplete="family-name" maxLength={80} required type="text" aria-required="true" aria-invalid={Boolean(errors.lastName)} aria-describedby={errors.lastName ? 'guest-error-lastName' : undefined} value={guestDetails.lastName} onChange={event => { updateGuest({ lastName: event.target.value }); clearError('lastName'); }} className={`min-h-12 w-full rounded-2xl border bg-slate-50 px-4 text-sm font-semibold outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100 ${errors.lastName ? 'border-red-400' : 'border-slate-200'}`} />
                        <FieldError id="guest-error-lastName" message={errors.lastName} />
                    </label>
                    <label htmlFor="guest-email" className="block space-y-2 text-sm font-bold text-slate-700">{t('checkout.email', 'البريد الإلكتروني')}
                        <input id="guest-email" name="email" autoComplete="email" required type="email" maxLength={254} dir="ltr" aria-required="true" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'guest-error-email' : undefined} value={guestDetails.email} onChange={event => { updateGuest({ email: event.target.value }); clearError('email'); }} className={`min-h-12 w-full rounded-2xl border bg-slate-50 px-4 text-left text-sm font-semibold outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100 ${errors.email ? 'border-red-400' : 'border-slate-200'}`} />
                        <FieldError id="guest-error-email" message={errors.email} />
                    </label>
                    <label htmlFor="guest-phone" className="block space-y-2 text-sm font-bold text-slate-700">{t('checkout.phone', 'رقم الهاتف مع رمز الدولة')}
                        <input id="guest-phone" name="tel" autoComplete="tel" minLength={7} maxLength={25} required type="tel" dir="ltr" aria-required="true" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'guest-error-phone' : undefined} value={guestDetails.phone} onChange={event => { updateGuest({ phone: event.target.value }); clearError('phone'); }} className={`min-h-12 w-full rounded-2xl border bg-slate-50 px-4 text-left text-sm font-semibold outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100 ${errors.phone ? 'border-red-400' : 'border-slate-200'}`} />
                        <FieldError id="guest-error-phone" message={errors.phone} />
                    </label>
                </div>

                <div className="mt-8 space-y-6">
                    {(guestDetails.rooms || []).map((room, roomIndex) => (
                        <fieldset key={roomIndex} className="space-y-4 border-t border-slate-100 pt-6">
                            <legend className="text-base font-black text-slate-900">{t('checkout.roomTravelers', `مسافرو الغرفة ${roomIndex + 1}`, { number: roomIndex + 1 })}</legend>
                            {room.guests.map((traveler, travelerIndex) => roomIndex === 0 && travelerIndex === 0 ? null : (
                                <div key={travelerIndex} className="grid gap-4 sm:grid-cols-2">
                                    {['firstName', 'lastName'].map(field => {
                                        const errorKey = `traveler-${roomIndex}-${travelerIndex}-${field}`;
                                        return (
                                            <label key={field} className="block space-y-2 text-sm font-bold text-slate-700">
                                                {field === 'firstName' ? t('checkout.firstName', 'الاسم الأول') : t('checkout.lastName', 'اسم العائلة')} {travelerIndex + 1}{traveler.is_child ? ` (${t('checkout.child', `طفل، ${traveler.age} سنوات`, { age: traveler.age })})` : ''}
                                                <input required maxLength={80} autoComplete="off" aria-required="true" aria-invalid={Boolean(errors[errorKey])} aria-describedby={errors[errorKey] ? `guest-error-${errorKey}` : undefined} value={traveler[field]} onChange={event => { onGuestDetailsChange({ ...guestDetails, rooms: guestDetails.rooms.map((group, groupIndex) => groupIndex === roomIndex ? { ...group, guests: group.guests.map((person, personIndex) => personIndex === travelerIndex ? { ...person, [field]: event.target.value } : person) } : group) }); clearError(errorKey); }} className={`min-h-12 mt-1 w-full rounded-2xl border bg-slate-50 px-4 text-sm font-semibold outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100 ${errors[errorKey] ? 'border-red-400' : 'border-slate-200'}`} />
                                                <FieldError id={`guest-error-${errorKey}`} message={errors[errorKey]} />
                                            </label>
                                        );
                                    })}
                                </div>
                            ))}
                        </fieldset>
                    ))}
                </div>

                <label className="mt-8 block space-y-2 text-sm font-bold text-slate-700">{t('checkout.specialRequests', 'طلبات خاصة')} <span className="font-medium text-slate-400">({t('checkout.optionalNotGuaranteed', 'اختيارية وغير مضمونة')})</span>
                    <textarea value={guestDetails.specialRequests} maxLength={1000} onChange={event => updateGuest({ specialRequests: event.target.value })} className="min-h-24 mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100" rows={3} />
                </label>

                <div className="mt-7">
                    <label className={`flex min-h-12 items-start gap-3 rounded-2xl border p-4 text-sm font-bold leading-6 ${errors.terms ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                        <input type="checkbox" required aria-required="true" aria-invalid={Boolean(errors.terms)} checked={acceptedTerms} onChange={event => { setAcceptedTerms(event.target.checked); clearError('terms'); }} className="mt-1 h-5 w-5 shrink-0 accent-cyan-700" />
                        <span>{t('checkout.terms', 'راجعت إجمالي الإقامة والرسوم وشروط الإلغاء لهذا العرض.')}</span>
                    </label>
                    <FieldError id="guest-error-terms" message={errors.terms} />
                </div>
            </section>

            <section aria-labelledby="payment-section-title" className="surface-card rounded-3xl p-6 sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><LockKeyhole size={23} /></div>
                    <div>
                        <p className="eyebrow">{t('checkout.stepPayment', 'الخطوة 2 من 2')}</p>
                        <h2 id="payment-section-title" className="mt-1 text-2xl font-black text-slate-900">{t('checkout.paymentTitle', 'الدفع والتأكيد')}</h2>
                        <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{t('checkout.paymentDescription', 'سيتم التحقق من السعر والتوفر قبل تحويلك إلى بوابة الدفع.')}</p>
                    </div>
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><CheckCircle2 size={18} className="mb-2 text-emerald-600" />{t('checkout.encrypted', 'دفع مشفر عبر Ziina')}</div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700"><CheckCircle2 size={18} className="mb-2 text-[var(--remal-blue)]" />{t('checkout.noHiddenFees', 'لا رسوم مخفية من رمال')}</div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700"><CheckCircle2 size={18} className="mb-2 text-[var(--remal-blue)]" />{t('checkout.statusNotice', 'إشعار واضح بحالة العملية')}</div>
                </div>
                <p className="mt-5 flex items-start gap-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-xs font-bold leading-6 text-cyan-900"><LockKeyhole size={18} className="mt-0.5 shrink-0" />{t('checkout.paymentNotice', 'لن يتم إنشاء طلب دفع قبل اكتمال البيانات والتحقق من توفر الدفع لهذا العرض.')}</p>
                {!paymentAvailable && <p className="mt-4 text-sm font-bold text-amber-800">{t('checkout.paymentUnavailable', 'الدفع الإلكتروني غير متاح لهذا العرض حالياً.')}</p>}
            </section>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-10px_30px_rgba(15,35,55,0.12)] backdrop-blur md:static md:rounded-3xl md:border md:p-5 md:shadow-sm">
                <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 md:block">
                    <div className="min-w-0 flex-1 md:mb-4">
                        <p className="text-xs font-bold text-slate-500">{t('checkout.totalAtContinue', 'الإجمالي عند المتابعة')}</p>
                        {currency && Number.isFinite(total) ? <PriceDisplay amount={total} currency={currency} displayCurrency={displayCurrency} displayRates={displayRates} className="mt-1 text-lg font-black text-slate-900" /> : <p className="mt-1 text-lg font-black text-slate-900">{t('checkout.priceUnavailable', 'السعر غير متاح')}</p>}
                    </div>
                    <button type="submit" form={formId} disabled={isSubmitting || !paymentAvailable} aria-disabled={isSubmitting || !paymentAvailable} className="min-h-12 min-w-0 flex-[1_1_12rem] rounded-2xl bg-[var(--remal-navy)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-900/10 transition hover:bg-[var(--remal-blue)] focus:outline-none focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 md:w-full">
                        {isSubmitting ? <span className="inline-flex items-center justify-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" role="status" aria-label={t('checkout.processing', 'جار تجهيز الدفع')} />{t('checkout.processing', 'جار تجهيز الدفع...')}</span> : paymentAvailable ? t('checkout.confirm', 'تأكيد الحجز والمتابعة للدفع') : t('checkout.paymentUnavailable', 'الدفع غير متاح حالياً')}
                    </button>
                </div>
            </div>
        </form>
    );
}