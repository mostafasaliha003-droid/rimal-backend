import { useId, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, CreditCard, LoaderCircle, LockKeyhole, ShieldCheck, UserRound, UserPlus } from 'lucide-react';
import { useLanguage } from '../i18n';
import BookingAPI from '../services/bookingApi';
import {
    canStartPrepaidCheckout,
    acceptMockPaymentRedirect,
    checkoutIdempotencyStorageKey,
    formatAedPrice,
    normalizeCheckoutGuestDetails,
    privatePaymentStatusUrl,
    sessionStorageKey,
    validateCheckoutSessionResponse
} from '../services/nextGenCheckout';

function randomIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

export default function CheckoutFlow({ offer, bookingContext = {}, onBack }) {
    const { t, direction } = useLanguage();
    const id = useId();
    const eligible = offer?.mock === true && canStartPrepaidCheckout(offer);
    const [guest, setGuest] = useState({ firstName: '', lastName: '', email: '', phone: '' });
    const [additionalGuests, setAdditionalGuests] = useState(() => Array.from({
        length: Math.max(0, (offer?.occupancy?.adults || 1) - 1)
    }, () => ({ firstName: '', lastName: '' })));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [validation, setValidation] = useState('');
    const price = formatAedPrice(offer?.price?.amount, offer?.price?.currency);
    const stay = useMemo(() => offer?.stay || {}, [offer]);
    const labels = {
        heading: t('nextgen.checkoutHeading', 'إتمام الحجز'),
        description: t('nextgen.checkoutDescription', 'أدخل بيانات الضيف لإنشاء جلسة دفع آمنة.'),
        firstName: t('nextgen.firstName', 'الاسم الأول'),
        lastName: t('nextgen.lastName', 'اسم العائلة'),
        email: t('nextgen.email', 'البريد الإلكتروني'),
        phone: t('nextgen.phone', 'رقم الهاتف'),
        guest: t('nextgen.guest', 'الضيف {{number}}'),
        addGuest: t('nextgen.addGuest', 'إضافة ضيف بالغ'),
        stay: t('nextgen.stay', 'الإقامة'),
        total: t('nextgen.total', 'إجمالي الإقامة'),
        secure: t('nextgen.secure', 'بيانات الضيوف مشفرة عند حفظها، والسعر مثبت من الخادم.'),
        continue: t('nextgen.continuePayment', 'المتابعة إلى الدفع التجريبي'),
        preparing: t('nextgen.preparingPayment', 'جار تجهيز جلسة الدفع...'),
        unavailable: t('nextgen.paymentUnavailable', 'الدفع المسبق غير متاح لهذا العرض.'),
        fieldsRequired: t('nextgen.fieldsRequired', 'أكمل بيانات الضيف والبريد الإلكتروني الصحيح.'),
        genericError: t('nextgen.checkoutError', 'تعذر تجهيز جلسة الدفع. تحقق من اتصالك ثم أعد المحاولة.'),
        back: t('nextgen.backOffers', 'العودة للعروض'),
        payNow: t('nextgen.payNow', 'الدفع الآن')
    };

    const submit = async event => {
        event.preventDefault();
        setError('');
        setValidation('');
        const details = normalizeCheckoutGuestDetails({ ...guest, additionalGuests });
        if (!eligible || !details.firstName || !details.lastName
            || !/^\S+@\S+\.\S+$/.test(details.email)
            || details.phone.length > 40
            || details.rooms[0].guests.some(person => !person.firstName || !person.lastName)) {
            setValidation(labels.fieldsRequired);
            return;
        }

        setBusy(true);
        try {
            const idempotencyStorageKey = checkoutIdempotencyStorageKey(offer.publicOfferId);
            if (!idempotencyStorageKey) throw new Error('checkout_offer_id_invalid');
            let idempotencyKey;
            try {
                idempotencyKey = sessionStorage.getItem(idempotencyStorageKey);
                if (!idempotencyKey) {
                    idempotencyKey = randomIdempotencyKey();
                    sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
                }
            } catch {
                throw new Error('checkout_idempotency_storage_unavailable');
            }
            const response = await BookingAPI.createHotelCheckoutSession({
                publicOfferId: offer.publicOfferId,
                guestDetails: details
            }, idempotencyKey);
            const session = validateCheckoutSessionResponse(response);
            try { sessionStorage.removeItem(idempotencyStorageKey); } catch {}
            const storageKey = sessionStorageKey(session.sessionId);
            if (!storageKey) throw new Error('checkout_session_id_invalid');
            try {
                sessionStorage.setItem(storageKey, JSON.stringify({ accessToken: session.access_token }));
            } catch {
                throw new Error('checkout_session_storage_unavailable');
            }
            const statusUrl = privatePaymentStatusUrl(session.sessionId);
            window.location.assign(acceptMockPaymentRedirect(session.payment_url, statusUrl));
        } catch (requestError) {
            const code = requestError?.response?.data?.error;
            setError(code === 'checkout_payment_flow_unsupported' || code === 'checkout_offer_price_unavailable'
                ? labels.unavailable : labels.genericError);
        } finally {
            setBusy(false);
        }
    };

    const updateAdditionalGuest = (index, field, value) => setAdditionalGuests(current =>
        current.map((person, position) => position === index ? { ...person, [field]: value } : person));

    if (!offer) return null;

    return (
        <main dir={direction} className="min-h-[calc(100vh-72px)] bg-[radial-gradient(ellipse_at_top,_rgba(15,143,163,0.13),_transparent_55%),linear-gradient(180deg,#f7f9fc,#edf4f7)] px-4 py-8 sm:px-6 sm:py-12">
            <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
                <section className="glass-surface rounded-3xl border border-white/80 p-5 shadow-float backdrop-blur-2xl sm:p-8">
                    <div className="mb-7 flex items-center gap-4 border-b border-remal-navy/10 pb-6">
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-remal-blue/10 text-remal-blue"><UserRound size={24} /></span>
                        <div>
                            <p className="eyebrow">{labels.payNow}</p>
                            <h1 className="mt-1 text-2xl font-black text-remal-navy sm:text-3xl">{labels.heading}</h1>
                            <p className="mt-1 text-sm font-semibold text-slate-600">{labels.description}</p>
                        </div>
                    </div>

                    {!eligible && <div role="alert" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">{labels.unavailable}</div>}
                    {validation && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{validation}</p>}
                    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}

                    <form onSubmit={submit} className="space-y-5" noValidate>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field id={`${id}-first`} name="firstName" label={labels.firstName} autoComplete="given-name" value={guest.firstName} onChange={value => setGuest(current => ({ ...current, firstName: value }))} required />
                            <Field id={`${id}-last`} name="lastName" label={labels.lastName} autoComplete="family-name" value={guest.lastName} onChange={value => setGuest(current => ({ ...current, lastName: value }))} required />
                            <Field id={`${id}-email`} name="email" label={labels.email} type="email" autoComplete="email" value={guest.email} onChange={value => setGuest(current => ({ ...current, email: value }))} required />
                            <Field id={`${id}-phone`} name="phone" label={labels.phone} type="tel" autoComplete="tel" value={guest.phone} onChange={value => setGuest(current => ({ ...current, phone: value }))} />
                        </div>

                        {additionalGuests.map((person, index) => (
                            <fieldset key={index} className="grid gap-4 rounded-2xl border border-remal-navy/10 bg-white/55 p-4 sm:grid-cols-2">
                                <legend className="px-2 text-sm font-black text-remal-navy">{labels.guest.replace('{{number}}', String(index + 2))}</legend>
                                <Field id={`${id}-guest-${index}-first`} name={`additionalGuests.${index}.firstName`} label={labels.firstName} value={person.firstName} onChange={value => updateAdditionalGuest(index, 'firstName', value)} required />
                                <Field id={`${id}-guest-${index}-last`} name={`additionalGuests.${index}.lastName`} label={labels.lastName} value={person.lastName} onChange={value => updateAdditionalGuest(index, 'lastName', value)} required />
                            </fieldset>
                        ))}

                        {offer.occupancy.adults > 1 && additionalGuests.length < offer.occupancy.adults - 1 && (
                            <button type="button" onClick={() => setAdditionalGuests(current => [...current, { firstName: '', lastName: '' }])} className="glass-light inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-remal-blue/20 px-4 py-2.5 font-black text-remal-blue hover:bg-white/90 sm:w-auto">
                                <UserPlus size={17} />{labels.addGuest}
                            </button>
                        )}

                        <div className="flex items-start gap-3 rounded-2xl border border-remal-blue/15 bg-cyan-50/60 p-4 text-sm font-bold leading-6 text-remal-navy">
                            <LockKeyhole size={18} className="mt-1 shrink-0 text-remal-blue" />
                            <span>{labels.secure}</span>
                        </div>
                        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
                            {onBack && <button type="button" onClick={onBack} className="glass-light inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-remal-navy/10 px-5 py-3 font-black text-remal-navy"><ArrowLeft size={17} />{labels.back}</button>}
                            <button type="submit" disabled={!eligible || busy} className="cta-red inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 font-black text-white disabled:opacity-60">
                                {busy ? <LoaderCircle size={18} className="animate-spin" /> : <CreditCard size={18} />}
                                {busy ? labels.preparing : labels.continue}
                                {!busy && <ArrowRight size={17} />}
                            </button>
                        </div>
                    </form>
                </section>

                <aside className="glass-surface h-fit rounded-3xl border border-white/80 p-5 shadow-float backdrop-blur-2xl sm:p-6 lg:sticky lg:top-6">
                    <p className="eyebrow flex items-center gap-2"><ShieldCheck size={14} />{t('nextgen.summary', 'ملخص العرض')}</p>
                    <h2 className="mt-3 text-xl font-black text-remal-navy">{bookingContext.hotelName || offer.hotel?.name || t('nextgen.hotel', 'فندق')}</h2>
                    <p className="mt-2 text-sm font-semibold text-slate-600">{offer.room?.name || t('nextgen.room', 'غرفة')}</p>
                    <p className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-500"><CalendarDays size={15} />{stay.checkIn || '—'} — {stay.checkOut || '—'}</p>
                    <div className="mt-6 border-t border-remal-navy/10 pt-5">
                        <p className="text-xs font-bold text-slate-500">{labels.total}</p>
                        <p className="mt-1 text-3xl font-black tabular-nums text-remal-navy">{price || labels.unavailable}</p>
                        <p className="mt-2 text-xs font-semibold text-slate-500">{labels.secure}</p>
                    </div>
                </aside>
            </div>
        </main>
    );
}

function Field({ id, name, label, value, onChange, type = 'text', autoComplete, required = false }) {
    return (
        <label htmlFor={id} className="block min-w-0">
            <span className="mb-2 block text-sm font-black text-remal-navy">{label}{required && <span aria-hidden="true"> *</span>}</span>
            <input id={id} name={name} type={type} value={value} autoComplete={autoComplete} required={required} maxLength={type === 'email' ? 254 : 80} onChange={event => onChange(event.target.value)} className="min-h-12 w-full rounded-xl border border-remal-navy/10 bg-white/75 px-4 py-3 font-semibold text-remal-navy outline-none transition placeholder:text-slate-400 focus:border-remal-blue focus:ring-4 focus:ring-remal-blue/10" />
        </label>
    );
}