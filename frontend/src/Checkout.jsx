import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Info, ShieldCheck, MapPin, CreditCard, UserCircle } from 'lucide-react';
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
        const title = state === 'booking_confirmed' ? 'تم تأكيد الحجز بنجاح'
            : state === 'payment_failed' ? 'لم يكتمل الدفع'
                : state === 'refund_completed' ? 'تم تأكيد الاسترداد'
                    : state === 'refund_review' || state === 'manual_review' || state === 'intent_unknown' ? 'تحتاج العملية إلى مراجعة'
                        : 'جاري التحقق من الدفع والحجز...';
        
        const details = state === 'booking_confirmed' ? `مرجع المورد: ${checkoutStatus.supplier_reference}`
            : state === 'refund_completed' ? 'أكدت بوابة الدفع اكتمال الاسترداد.'
                : 'العودة من بوابة الدفع ليست تأكيداً نهائياً للدفع أو الحجز. يرجى الانتظار ولا تعاود الدفع قبل التحقق من حالة العملية مع فريقنا.';
        
        const iconColor = state === 'booking_confirmed' ? 'text-emerald-500 bg-emerald-50' 
            : state === 'payment_failed' ? 'text-red-500 bg-red-50' 
            : 'text-amber-500 bg-amber-50';

        return (
            <main className="mx-auto min-h-screen max-w-2xl px-5 py-24 flex items-center justify-center bg-[#F8FAFC]">
                <div className="bg-white rounded-3xl p-10 shadow-xl border border-slate-100 text-center w-full">
                    <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-6 ${iconColor}`}>
                        <Info size={40} />
                    </div>
                    <h1 className="text-3xl font-black text-slate-900">{title}</h1>
                    <p className="mt-4 text-slate-600 font-medium leading-relaxed max-w-md mx-auto">{details}</p>
                    
                    {paymentReference && (
                        <div className="mt-8 bg-slate-50 rounded-xl p-4 border border-slate-100">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">مرجع المتابعة</p>
                            <p className="font-mono text-sm font-bold text-slate-700">{paymentReference}</p>
                        </div>
                    )}
                    
                    <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                        <a className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800" href="mailto:management@remaltourismllc.com">
                            التواصل مع الدعم
                        </a>
                        <a href="/" className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-white border border-slate-200 px-6 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 hover:text-blue-600">
                            العودة للرئيسية
                        </a>
                    </div>
                </div>
            </main>
        );
    }

    if (!selectedBooking) {
        return (
            <main className="min-h-screen bg-[#F8FAFC] px-5 py-12 lg:px-10 flex items-center justify-center">
                <div className="w-full max-w-md rounded-3xl bg-white p-10 text-center shadow-sm border border-slate-100">
                    <div className="mx-auto w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mb-6 text-slate-400">
                        <Info size={32} />
                    </div>
                    <p className="text-xl font-black text-slate-900">لم يتم اختيار غرفة بعد</p>
                    <p className="mt-2 text-sm text-slate-500 font-medium">الرجاء العودة وتحديد عرض إقامة للمتابعة.</p>
                    <button type="button" onClick={onBack} className="mt-8 inline-flex w-full justify-center items-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white transition hover:bg-blue-700 shadow-lg shadow-blue-600/20">
                        <ArrowRight size={18} /> العودة للبحث
                    </button>
                </div>
            </main>
        );
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

    return (
        <main className="min-h-screen bg-[#F8FAFC] px-5 py-8 lg:px-10 pb-24">
            <div className="mx-auto max-w-7xl">
                
                {/* Header */}
                <button type="button" onClick={onBack} className="group mb-8 inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-blue-600 transition-colors">
                    <ArrowRight size={18} className="transition-transform group-hover:-translate-x-1" /> العودة لاختيار الغرفة
                </button>
                
                <div className="mb-10">
                    <div className="flex items-center gap-2 text-blue-600 mb-3">
                        <ShieldCheck size={20} />
                        <span className="text-xs font-black uppercase tracking-widest">إتمام الحجز بأمان</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-900 tracking-tight">بيانات الضيف والدفع</h1>
                    <p className="mt-3 text-base font-medium text-slate-500">الخطوة الأخيرة لتأكيد إقامتك عبر بوابة Ziina الآمنة.</p>
                </div>

                {!canPay && (
                    <div className="mb-8 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-800 shadow-sm">
                        <Info size={24} className="shrink-0 mt-0.5 text-amber-500" />
                        <div>
                            <p className="font-bold text-amber-900">عذراً، الدفع الإلكتروني غير متاح لهذا العرض حالياً.</p>
                            <p className="mt-1 text-sm font-medium opacity-90">لم يتم إنشاء عملية دفع. يرجى اختيار عرض آخر أو <a className="underline font-bold hover:text-amber-900" href="mailto:management@remaltourismllc.com">التواصل مع فريق الحجوزات</a>.</p>
                        </div>
                    </div>
                )}

                <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
                    
                    {/* Left Column (Forms) */}
                    <div className="order-2 lg:order-1 space-y-8">
                        {error && (
                            <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-5 text-red-600 border border-red-100 animate-in fade-in slide-in-from-top-2">
                                <Info size={20} className="shrink-0" />
                                <p className="text-sm font-bold">{error}</p>
                            </div>
                        )}
                        
                        <div className="rounded-3xl bg-white p-6 sm:p-8 shadow-sm border border-slate-100 relative overflow-hidden">
                            {/* Decorative element */}
                            <div className="absolute top-0 right-0 w-2 h-full bg-blue-600" />
                            
                            <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-100">
                                <div className="bg-blue-50 p-2 rounded-xl text-blue-600"><UserCircle size={24} /></div>
                                <div>
                                    <h2 className="text-xl font-black text-slate-900">بيانات الضيوف</h2>
                                    <p className="text-sm font-medium text-slate-500">تُستخدم هذه البيانات لتأكيد الحجز والتواصل معك</p>
                                </div>
                            </div>
                            
                            <GuestForm
                                guestDetails={guest}
                                onGuestDetailsChange={setGuest}
                                onSubmit={submitPayment}
                                isSubmitting={status === 'loading' || status === 'success'}
                                paymentAvailable={canPay}
                            />
                        </div>
                    </div>

                    {/* Right Column (Invoice Summary - Masterstroke) */}
                    <aside className="order-1 lg:order-2">
                        <div className="sticky top-28 rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/40 overflow-hidden">
                            
                            {/* Hotel Header in Sidebar */}
                            <div className="bg-slate-900 p-6 sm:p-8 text-white relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-full h-full opacity-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
                                <div className="relative z-10">
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">ملخص الحجز</p>
                                    <h2 className="text-2xl font-black leading-tight">{selectedBooking.hotelName || 'Hotel'}</h2>
                                    <p className="mt-3 text-sm font-semibold text-slate-300 flex items-center gap-1.5"><MapPin size={16}/> {room.name || 'Room'}</p>
                                </div>
                            </div>

                            <div className="p-6 sm:p-8">
                                {/* Dates Grid */}
                                <div className="grid grid-cols-2 gap-4 mb-8">
                                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">تسجيل الوصول</p>
                                        <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><CalendarDays size={16} className="text-blue-600" /> {selectedBooking.checkin || '-'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2">تسجيل المغادرة</p>
                                        <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><CalendarDays size={16} className="text-blue-600" /> {selectedBooking.checkout || '-'}</p>
                                    </div>
                                </div>

                                {/* Price Breakdown */}
                                <div className="space-y-4 mb-6 pb-6 border-b border-slate-100">
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <p className="text-sm font-black text-slate-900">الإجمالي النهائي</p>
                                            <p className="text-xs text-slate-500 font-medium mt-1">شامل الضرائب الأساسية</p>
                                        </div>
                                        <div className="text-left">
                                            {currency ? (
                                                <PriceDisplay amount={total} currency={currency} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black text-blue-600 tracking-tight" />
                                            ) : (
                                                <span className="font-bold text-slate-400">العملة غير متاحة</span>
                                            )}
                                        </div>
                                    </div>

                                    {(room.taxes || []).filter(tax => !tax.included_by_supplier).length > 0 && (
                                        <div className="mt-4 rounded-xl bg-orange-50 p-3 border border-orange-100 space-y-1.5">
                                            <p className="text-xs font-bold text-orange-900 mb-2 border-b border-orange-200/50 pb-1.5">رسوم محلية تُدفع في الفندق (غير مشمولة):</p>
                                            {(room.taxes || []).filter(tax => !tax.included_by_supplier).map((tax, index) => (
                                                <div key={index} className="flex justify-between text-[11px] font-bold text-orange-800">
                                                    <span>{tax.name}</span>
                                                    <span dir="ltr">{tax.amount} {tax.currency_code}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Payment Info */}
                                <div className="mb-6 flex items-start gap-3 text-xs font-medium text-slate-500 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
                                    <CreditCard size={20} className="shrink-0 text-slate-400 mt-0.5" />
                                    <p>
                                        {canPay ? (
                                            <>سيتم خصم المبلغ بعملة <strong>{currency}</strong> عبر بوابة Ziina الآمنة. قد يطبق البنك المصدر لبطاقتك رسوم تحويل إضافية.</>
                                        ) : (
                                            <>عملة العرض: {currency || 'غير محددة'}. الدفع الإلكتروني لهذا العرض غير متاح حالياً.</>
                                        )}
                                    </p>
                                </div>

                                {/* Cancellation Policy Component */}
                                <div className="mt-2">
                                    <CancellationPolicy cancellation={room.cancellation} currency={currency} />
                                </div>
                            </div>
                        </div>
                    </aside>

                </div>
            </div>
        </main>
    );
}