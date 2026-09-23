import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Info } from 'lucide-react';
import GuestForm from './components/GuestForm';
import BookingAPI from './services/bookingApi';
import { CancellationPolicy } from './components/RoomCard';
import PriceDisplay from './components/PriceDisplay';
import { trackBookingEvent } from './services/analytics';

const initialGuest = { firstName: '', lastName: '', email: '', phone: '', specialRequests: '' };
const pendingStatuses = new Set(['preparing', 'intent_creating', 'awaiting_payment', 'payment_verified', 'booking_pending',
    'booking_failed', 'refund_creating', 'refund_unknown', 'refund_pending']);

function readStoredBooking(booking) {
    if (booking) return booking;
    try {
        const stored = sessionStorage.getItem('remal_checkout');
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

export default function Checkout({ booking, onBack, displayCurrency, displayRates }) {
    const [selectedBooking] = useState(() => readStoredBooking(booking));
    const query = new URLSearchParams(window.location.search);
    const paymentReturn = query.get('payment');
    const paymentReference = query.get('ref');
    const [guest, setGuest] = useState(() => {
        try { const draft = JSON.parse(sessionStorage.getItem('remal_guest_draft') || 'null'); if (draft?.hash === selectedBooking?.room?.book_hash) return draft.guest; } catch {}
        return { ...initialGuest, rooms: (selectedBooking?.guests || [{ adults: 2, children: [] }]).map(room => ({ guests: [...Array.from({ length: room.adults }, () => ({ firstName: '', lastName: '', is_child: false })), ...room.children.map(age => ({ firstName: '', lastName: '', is_child: true, age }))] })) };
    });
    const [paymentAvailable, setPaymentAvailable] = useState(false);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [checkoutStatus, setCheckoutStatus] = useState(null);

    useEffect(() => {
        let active = true;
        if (!paymentReturn && selectedBooking) trackBookingEvent('checkout_started');
        BookingAPI.paymentAvailability().then(data => { if (active) setPaymentAvailable(data.enabled === true); }).catch(() => {});
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!selectedBooking) return;
        try { sessionStorage.setItem('remal_guest_draft', JSON.stringify({ hash: selectedBooking.room.book_hash, guest })); } catch {}
    }, [guest, selectedBooking]);

    useEffect(() => {
        if (!paymentReturn || !paymentReference) return undefined;
        let active = true;
        let timer;
        const read = async () => {
            let credentials;
            try { credentials = JSON.parse(sessionStorage.getItem('remal_payment_attempt') || 'null'); } catch {}
            if (credentials?.reference !== paymentReference || !credentials?.accessToken) {
                if (active) setCheckoutStatus({ status: 'unavailable' });
                return;
            }
            try {
                const current = await BookingAPI.getCheckoutStatus(credentials.reference, credentials.accessToken);
                if (!active) return;
                setCheckoutStatus(current);
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
        const title = state === 'booking_confirmed' ? 'تم تأكيد الحجز لدى المورد'
            : state === 'payment_failed' ? 'لم يكتمل الدفع'
                : state === 'refund_completed' ? 'تم تأكيد الاسترداد'
                    : state === 'refund_review' || state === 'manual_review' || state === 'intent_unknown' ? 'تحتاج العملية إلى مراجعة'
                        : 'بانتظار التحقق من الدفع والحجز';
        const details = state === 'booking_confirmed' ? `مرجع المورد: ${checkoutStatus.supplier_reference}`
            : state === 'refund_completed' ? 'أكدت بوابة الدفع اكتمال الاسترداد.'
                : 'العودة من بوابة الدفع ليست تأكيداً للدفع أو الحجز. لا تعاود الدفع قبل التحقق من حالة العملية مع فريق الحجوزات.';
        return <main className="mx-auto min-h-screen max-w-2xl px-5 py-12"><Info size={32} className="text-amber-700" /><h1 className="mt-5 text-2xl font-bold">{title}</h1><p className="mt-4 leading-8">{details}</p>{paymentReference && <p className="mt-3 break-all text-sm text-slate-600">مرجع المتابعة: {paymentReference}</p>}<a className="mt-6 inline-block text-remal-blue underline" href="mailto:management@remaltourismllc.com">التواصل مع فريق الحجوزات</a><a href="/" className="mx-4 inline-block underline">العودة للرئيسية</a></main>;
    }

    if (!selectedBooking) {
        return <main className="min-h-screen bg-remal-bg px-5 py-12 lg:px-10"><div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm"><p className="font-black text-remal-dark">لم يتم اختيار غرفة بعد</p><button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-sm font-black text-white"><ArrowRight size={16} /> العودة للبحث</button></div></main>;
    }

    const room = selectedBooking.room || {};
    const total = Number(room.price);
    const currency = room.currency || '';
    const canPay = paymentAvailable && ['AED', 'USD', 'SAR', 'EUR'].includes(currency)
        && room.paymentType === 'deposit' && room.book_hash && Number.isFinite(total) && total > 0;
    const submitPayment = async (event) => {
        event.preventDefault();
        if (!canPay) return;
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
                rooms: guest.rooms.map((room, index) => ({ guests: room.guests.map((traveler, position) => index === 0 && position === 0 ? { ...traveler, firstName: guest.firstName, lastName: guest.lastName } : traveler) }))
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

    return <main className="min-h-screen bg-slate-50 px-5 py-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
            <button type="button" onClick={onBack} className="mb-7 inline-flex items-center gap-2 text-sm font-black text-remal-blue"><ArrowRight size={17} /> العودة لاختيار الغرفة</button>
            <div className="mb-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-remal-blue">إتمام الحجز</p><h1 className="mt-2 text-3xl font-black text-remal-dark">بيانات الضيف والدفع</h1><p className="mt-2 text-sm font-bold text-slate-400">أدخل بيانات الضيف لإتمام الدفع الآمن عبر Ziina</p></div>
            {!canPay && <p role="status" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 leading-7 text-amber-950">الدفع الإلكتروني غير متاح لهذا العرض حالياً. لم يتم إنشاء عملية دفع. <a className="underline" href="mailto:management@remaltourismllc.com">تواصل مع فريق الحجوزات</a></p>}
            <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="order-2 lg:order-1">
                    {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-remal-red">{error}</p>}
                    <GuestForm
                        guestDetails={guest}
                        onGuestDetailsChange={setGuest}
                        onSubmit={submitPayment}
                        isSubmitting={status === 'loading' || status === 'success'}
                        paymentAvailable={canPay}
                    />
                </div>
                <aside className="order-1 h-fit rounded-2xl bg-remal-dark p-6 text-white shadow-sm lg:order-2 lg:sticky lg:top-6">
                    <p className="text-xs font-bold text-white/60">ملخص الحجز</p><h2 className="mt-3 text-xl font-black">{selectedBooking.hotelName || 'Hotel'}</h2><p className="mt-2 text-sm font-bold text-white/60">{room.name || 'Room'}</p>
                    <div className="my-6 space-y-3 border-y border-white/10 py-5 text-sm font-bold"><p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-white/60"><CalendarDays size={15} /> الوصول</span><span>{selectedBooking.checkin || '-'}</span></p><p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-white/60"><CalendarDays size={15} /> المغادرة</span><span>{selectedBooking.checkout || '-'}</span></p></div>
                    <div className="flex flex-wrap items-end justify-between gap-3"><span className="text-sm text-white/80">الإجمالي</span><span className="text-end text-2xl font-bold">{currency ? <PriceDisplay amount={total} currency={currency} displayCurrency={displayCurrency} displayRates={displayRates} /> : 'العملة غير متاحة'}</span></div>
                    <p className="mt-3 text-sm leading-7">{canPay ? `عملة الدفع: ${currency}، بسعر المورد الأصلي.` : `عملة العرض: ${currency || 'غير محددة'}. الدفع الإلكتروني لهذا العرض غير متاح.`} قد تُطبق رسوم محلية غير مشمولة.</p>
                    {(room.taxes || []).filter(tax => !tax.included_by_supplier).map((tax, index) => <p key={index} className="mt-2 text-sm">{tax.name}: {tax.amount} {tax.currency_code}</p>)}
                    <div className="mt-5 rounded-lg bg-white p-3 text-slate-900"><CancellationPolicy cancellation={room.cancellation} currency={currency} /></div>
                </aside>
            </div>
        </div>
    </main>;
}
