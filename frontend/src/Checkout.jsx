import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, CreditCard, Info, MapPin, ShieldCheck } from 'lucide-react';
import GuestForm from './components/GuestForm';
import BookingAPI from './services/bookingApi';
import { CancellationPolicy } from './components/RoomCard';
import PriceDisplay from './components/PriceDisplay';
import { trackBookingEvent } from './services/analytics';
import { useLanguage } from './i18n';

const initialGuest = { firstName: '', lastName: '', email: '', phone: '', specialRequests: '' };
const pendingStatuses = new Set([
    'preparing',
    'intent_creating',
    'awaiting_payment',
    'payment_verified',
    'booking_pending',
    'booking_failed',
    'refund_creating',
    'refund_unknown',
    'refund_pending'
]);

function readStoredBooking(booking) {
    if (booking) return booking;
    try {
        const stored = sessionStorage.getItem('remal_checkout');
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

function BookingSummary({ booking, room, total, currency, displayCurrency, displayRates, canPay }) {
    const { t } = useLanguage();
    const localTaxes = (room.taxes || []).filter(tax => !tax.included_by_supplier);

    return (
        <aside aria-label={t('checkout.summary', 'ملخص الحجز والسعر')} className="order-1 h-fit lg:order-2 lg:sticky lg:top-28">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_42px_rgba(15,35,55,0.10)]">
                <div className="relative overflow-hidden bg-[var(--remal-navy)] p-6 text-white sm:p-7">
                    <div className="absolute inset-0 opacity-10 [background:radial-gradient(ellipse_at_top_right,_white,_transparent_65%)]" />
                    <div className="relative">
                        <p className="eyebrow text-cyan-200">{t('checkout.summary', 'ملخص الحجز')}</p>
                        <h2 className="mt-2 text-2xl font-black leading-tight">{booking.hotelName || 'Hotel'}</h2>
                        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><MapPin size={16} />{room.name || 'Room'}</p>
                    </div>
                </div>

                <div className="space-y-6 p-6 sm:p-7">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <p className="text-[11px] font-black text-slate-500">{t('checkout.checkin', 'تسجيل الوصول')}</p>
                            <p className="mt-2 flex items-center gap-1.5 text-sm font-black text-slate-900"><CalendarDays size={16} className="text-[var(--remal-blue)]" />{booking.checkin || '-'}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <p className="text-[11px] font-black text-slate-500">{t('checkout.checkout', 'تسجيل المغادرة')}</p>
                            <p className="mt-2 flex items-center gap-1.5 text-sm font-black text-slate-900"><CalendarDays size={16} className="text-[var(--remal-blue)]" />{booking.checkout || '-'}</p>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-end justify-between gap-4 border-b border-slate-100 pb-5">
                            <div>
                                <p className="text-sm font-black text-slate-900">{t('checkout.priceBreakdown', 'تفصيل السعر')}</p>
                                <p className="mt-1 text-xs font-medium text-slate-500">{t('checkout.originalCurrency', 'بالعملة الأصلية للعرض')}</p>
                            </div>
                            {currency && Number.isFinite(total) ? <PriceDisplay amount={total} currency={currency} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-[var(--remal-blue)]" /> : <span className="font-bold text-slate-400">غير متاح</span>}
                        </div>

                        {localTaxes.length > 0 && (
                            <div className="mt-4 space-y-2 rounded-2xl border border-orange-100 bg-orange-50 p-4">
                                <p className="border-b border-orange-200/70 pb-2 text-xs font-black text-orange-900">{t('checkout.localTaxes', 'رسوم محلية تُدفع في الفندق')}</p>
                                {localTaxes.map((tax, index) => <div key={index} className="flex justify-between gap-3 text-[11px] font-bold text-orange-800"><span>{tax.name}</span><span dir="ltr">{tax.amount} {tax.currency_code}</span></div>)}
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4" aria-live="polite" aria-atomic="true">
                        <p className="text-xs font-bold text-cyan-900">{t('checkout.finalTotal', 'الإجمالي النهائي')}</p>
                        {currency && Number.isFinite(total) ? <PriceDisplay amount={total} currency={currency} displayCurrency={displayCurrency} displayRates={displayRates} className="mt-1 text-3xl font-black text-[var(--remal-navy)]" /> : <p className="mt-1 font-black text-slate-500">العملة غير متاحة</p>}
                    </div>

                    <div className="space-y-3">
                        <p className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs font-bold leading-6 text-emerald-900"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" />{t('checkout.ziina', 'سيتم تحويلك إلى بوابة Ziina الآمنة بعد التحقق من السعر والتوفر.')}</p>
                        <p className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs font-bold leading-6 text-slate-700"><CreditCard size={18} className="mt-0.5 shrink-0 text-[var(--remal-blue)]" />{canPay ? t('checkout.offerCurrency', `عملة العرض: ${currency}. سيتم خصم هذا المبلغ عبر Ziina، وتظهر الرسوم المحلية غير المشمولة أعلاه.`, { currency }) : t('checkout.noOnlinePayment', `عملة العرض: ${currency || 'غير محددة'}. الدفع الإلكتروني لهذا العرض غير متاح حالياً.`, { currency: currency || 'غير محددة' })}</p>
                    </div>

                    <CancellationPolicy cancellation={room.cancellation} currency={currency} />
                </div>
            </div>
        </aside>
    );
}

export default function Checkout({ booking, onBack, displayCurrency, displayRates }) {
    const { t, direction } = useLanguage();
    const [selectedBooking] = useState(() => readStoredBooking(booking));
    const query = new URLSearchParams(window.location.search);
    const paymentReturn = query.get('payment');
    const paymentReference = query.get('ref');
    const [guest, setGuest] = useState(() => {
        try {
            const draft = JSON.parse(sessionStorage.getItem('remal_guest_draft') || 'null');
            if (draft?.hash === selectedBooking?.room?.book_hash) return draft.guest;
        } catch { /* Continue with a fresh draft. */ }
        return {
            ...initialGuest,
            rooms: (selectedBooking?.guests || [{ adults: 2, children: [] }]).map(room => ({
                guests: [
                    ...Array.from({ length: room.adults }, () => ({ firstName: '', lastName: '', is_child: false })),
                    ...room.children.map(age => ({ firstName: '', lastName: '', is_child: true, age }))
                ]
            }))
        };
    });
    const [paymentAvailable, setPaymentAvailable] = useState(false);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [checkoutStatus, setCheckoutStatus] = useState(null);
    const paymentFailureTracked = useRef(false);

    useEffect(() => {
        let active = true;
        if (!paymentReturn && selectedBooking) trackBookingEvent('checkout_started');
        BookingAPI.paymentAvailability().then(data => {
            if (active) setPaymentAvailable(data.enabled === true);
        }).catch(() => {});
        return () => { active = false; };
    }, [paymentReturn, selectedBooking]);

    useEffect(() => {
        if (!selectedBooking) return;
        try {
            sessionStorage.setItem('remal_guest_draft', JSON.stringify({ hash: selectedBooking.room.book_hash, guest }));
        } catch { /* Draft persistence is best effort. */ }
    }, [guest, selectedBooking]);

    useEffect(() => {
        if (!paymentReturn || !paymentReference) return undefined;
        let active = true;
        let timer;
        const read = async () => {
            let credentials;
            try { credentials = JSON.parse(sessionStorage.getItem('remal_payment_attempt') || 'null'); } catch { credentials = null; }
            if (credentials?.reference !== paymentReference || !credentials?.accessToken) {
                if (active) setCheckoutStatus({ status: 'unavailable' });
                return;
            }
            try {
                const current = await BookingAPI.getCheckoutStatus(credentials.reference, credentials.accessToken);
                if (!active) return;
                setCheckoutStatus(current);
                if (current.status === 'payment_failed' && !paymentFailureTracked.current) {
                    paymentFailureTracked.current = true;
                    trackBookingEvent('payment_failed');
                }
                if (pendingStatuses.has(current.status)) timer = window.setTimeout(read, 7000);
            } catch {
                if (!active) return;
                setCheckoutStatus({ status: 'unavailable' });
                timer = window.setTimeout(read, 15000);
            }
        };
        void read();
        return () => { active = false; window.clearTimeout(timer); };
    }, [paymentReturn, paymentReference]);

    if (paymentReturn) {
        const state = checkoutStatus?.status;
        const title = state === 'booking_confirmed' ? t('checkout.confirmed', 'تم تأكيد الحجز لدى المورد')
            : state === 'payment_failed' ? t('checkout.paymentFailed', 'لم يكتمل الدفع')
                : state === 'refund_completed' ? t('checkout.refundCompleted', 'تم تأكيد الاسترداد')
                    : state === 'refund_review' || state === 'manual_review' || state === 'intent_unknown' ? t('checkout.review', 'تحتاج العملية إلى مراجعة')
                        : t('checkout.pending', 'بانتظار التحقق من الدفع والحجز...');
        const details = state === 'booking_confirmed' ? t('checkout.supplierReference', `مرجع المورد: ${checkoutStatus.supplier_reference}`, { reference: checkoutStatus.supplier_reference })
            : state === 'refund_completed' ? t('checkout.refundMessage', 'أكدت بوابة الدفع اكتمال الاسترداد.')
                : t('checkout.returnDisclaimer', 'العودة من بوابة الدفع ليست تأكيداً نهائياً للدفع أو الحجز. يرجى الانتظار ولا تعاود الدفع قبل التحقق من حالة العملية مع فريقنا.');
        const iconColor = state === 'booking_confirmed' ? 'text-emerald-500 bg-emerald-50'
            : state === 'payment_failed' ? 'text-red-500 bg-red-50'
                : 'text-amber-500 bg-amber-50';

        return (
            <main dir={direction} className="mx-auto flex min-h-screen max-w-2xl items-center justify-center bg-[#F8FAFC] px-5 py-24">
                <div className="w-full rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl sm:p-10">
                    <div className={`mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full ${iconColor}`}><Info size={40} /></div>
                    <h1 className="text-3xl font-black text-slate-900">{title}</h1>
                    <p className="mx-auto mt-4 max-w-md text-sm font-medium leading-7 text-slate-600">{details}</p>
                    {paymentReference && <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-400">{t('checkout.followupReference', 'مرجع المتابعة')}</p><p className="mt-1 font-mono text-sm font-bold text-slate-700">{paymentReference}</p></div>}
                    <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <a className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800 sm:w-auto" href="mailto:management@remaltourismllc.com">{t('checkout.support', 'التواصل مع الدعم')}</a>
                        <a href="/" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 hover:text-[var(--remal-blue)] sm:w-auto">{t('checkout.home', 'العودة للرئيسية')}</a>
                    </div>
                </div>
            </main>
        );
    }

    if (!selectedBooking) {
        return (
            <main dir={direction} className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-5 py-12 lg:px-10">
                <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-10 text-center shadow-sm">
                    <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-slate-50 text-slate-400"><Info size={32} /></div>
                    <p className="text-xl font-black text-slate-900">{t('checkout.noRoom', 'لم يتم اختيار غرفة بعد')}</p>
                    <p className="mt-2 text-sm font-medium text-slate-500">{t('checkout.noRoomBody', 'الرجاء العودة وتحديد عرض إقامة للمتابعة.')}</p>
                    <button type="button" onClick={onBack} className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--remal-blue)] px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-cyan-700/20 transition hover:bg-[var(--remal-navy)]"><ArrowRight size={18} />{t('checkout.backSearch', 'العودة للبحث')}</button>
                </div>
            </main>
        );
    }

    const room = selectedBooking.room || {};
    const total = Number(room.price);
    const currency = room.currency || '';
    const canPay = paymentAvailable && ['AED', 'USD', 'SAR', 'EUR'].includes(currency)
        && room.paymentType === 'deposit' && room.book_hash && Number.isFinite(total) && total > 0;
    const isSubmitting = status === 'loading' || status === 'success';

    const submitPayment = async event => {
        event.preventDefault();
        if (!canPay || isSubmitting) return;
        trackBookingEvent('payment_started');
        setStatus('loading');
        setError('');
        try {
            let idempotencyKey = sessionStorage.getItem('remal_checkout_idempotency_key');
            if (!idempotencyKey) {
                idempotencyKey = window.crypto.randomUUID();
                sessionStorage.setItem('remal_checkout_idempotency_key', idempotencyKey);
            }
            const response = await BookingAPI.createZiinaIntent({
                total,
                currency,
                hid: selectedBooking.hid,
                book_hash: room.book_hash,
                hotelName: selectedBooking.hotelName,
                roomName: room.name,
                checkin: selectedBooking.checkin,
                checkout: selectedBooking.checkout,
                guests: selectedBooking.guests,
                guest,
                rooms: guest.rooms.map((roomGroup, index) => ({ guests: roomGroup.guests.map((traveler, position) => index === 0 && position === 0 ? { ...traveler, firstName: guest.firstName, lastName: guest.lastName } : traveler) }))
            }, idempotencyKey);
            if (!response.reference || !response.access_token) throw new Error('Missing checkout reference');
            sessionStorage.setItem('remal_payment_attempt', JSON.stringify({ reference: response.reference, accessToken: response.access_token }));
            if (!response.payment_url) {
                window.location.assign(`/checkout?payment=pending&ref=${encodeURIComponent(response.reference)}`);
                return;
            }
            setStatus('success');
            window.location.assign(response.payment_url);
        } catch (requestError) {
            trackBookingEvent('payment_failed');
            setStatus('error');
            setError(requestError.response?.data?.message || 'تعذر تجهيز الدفع، يرجى المحاولة مرة أخرى');
        }
    };

    return (
        <main dir={direction} className="min-h-screen bg-[#F8FAFC] px-5 py-8 pb-32 lg:px-10 lg:pb-16">
            <div className="mx-auto max-w-7xl">
                <button type="button" onClick={onBack} className="group mb-8 inline-flex min-h-12 items-center gap-2 text-sm font-bold text-slate-500 transition-colors hover:text-[var(--remal-blue)]"><ArrowRight size={18} className="transition-transform group-hover:-translate-x-1" />{t('checkout.backRoom', 'العودة لاختيار الغرفة')}</button>

                <header className="mb-10 max-w-3xl">
                    <div className="mb-3 flex items-center gap-2 text-[var(--remal-blue)]"><ShieldCheck size={20} /><span className="eyebrow">{t('checkout.secure', 'إتمام الحجز بأمان')}</span></div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">{t('checkout.title', 'بيانات الضيف والدفع')}</h1>
                    <p className="mt-3 text-base font-medium leading-7 text-slate-500">{t('checkout.subtitle', 'خطوتان واضحتان لتأكيد إقامتك: أدخل بيانات الضيوف، ثم راجع السعر وانتقل إلى بوابة الدفع الآمنة.')}</p>
                </header>

                {!canPay && <div role="status" className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800 shadow-sm"><Info size={24} className="mt-0.5 shrink-0 text-amber-500" /><div><p className="font-bold text-amber-900">{t('checkout.noPaymentTitle', 'الدفع الإلكتروني غير متاح لهذا العرض حالياً.')}</p><p className="mt-1 text-sm font-medium leading-6">{t('checkout.noPaymentBody', 'لم يتم إنشاء عملية دفع. يرجى اختيار عرض آخر أو التواصل مع فريق الحجوزات.')}</p></div></div>}

                <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
                    <div className="order-2 min-w-0 lg:order-1">
                        {error && <div role="alert" aria-live="assertive" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><Info size={20} className="mt-0.5 shrink-0" /><p className="text-sm font-bold leading-6">{error}</p></div>}
                        <GuestForm
                            guestDetails={guest}
                            onGuestDetailsChange={setGuest}
                            onSubmit={submitPayment}
                            isSubmitting={isSubmitting}
                            paymentAvailable={canPay}
                            total={total}
                            currency={currency}
                            displayCurrency={displayCurrency}
                            displayRates={displayRates}
                            onValidationError={setError}
                        />
                    </div>
                    <BookingSummary booking={selectedBooking} room={room} total={total} currency={currency} displayCurrency={displayCurrency} displayRates={displayRates} canPay={canPay} />
                </div>
            </div>
        </main>
    );
}