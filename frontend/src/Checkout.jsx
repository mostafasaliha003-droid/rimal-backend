import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check } from 'lucide-react';
import GuestForm from './components/GuestForm';
import BookingAPI from './services/bookingApi';

const initialGuest = { firstName: '', lastName: '', email: '', phone: '', specialRequests: '' };

function readStoredBooking(booking) {
    if (booking) return booking;
    try {
        const stored = localStorage.getItem('remal_checkout_pending')
            || localStorage.getItem('remal_checkout')
            || sessionStorage.getItem('remal_checkout');
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

export default function Checkout({ booking, onBack }) {
    const selectedBooking = readStoredBooking(booking);
    const paymentComplete = new URLSearchParams(window.location.search).get('payment') === 'success';
    const [guest, setGuest] = useState(initialGuest);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!paymentComplete || !selectedBooking) return;
        localStorage.removeItem('remal_checkout_pending');
        localStorage.removeItem('remal_checkout');
        sessionStorage.removeItem('remal_checkout');
        window.history.replaceState({}, document.title, window.location.pathname);
    }, [paymentComplete, selectedBooking]);

    if (paymentComplete && selectedBooking) {
        const completedRoom = selectedBooking.room || {};
        return <main className="min-h-screen bg-remal-bg px-5 py-12 lg:px-10"><div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check size={30} /></div><p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-emerald-600">تم الدفع بنجاح</p><h1 className="mt-2 text-3xl font-black text-remal-dark">تم تأكيد طلب الدفع</h1><p className="mt-3 text-sm font-bold leading-7 text-slate-500">سيتم إرسال تفاصيل الحجز إلى بريدك الإلكتروني بعد تأكيد المورد.</p><div className="mt-8 space-y-3 rounded-2xl bg-remal-bg p-5 text-right text-sm font-bold"><p className="flex justify-between gap-4"><span className="text-slate-400">الفندق</span><span>{selectedBooking.hotelName || 'Hotel'}</span></p><p className="flex justify-between gap-4"><span className="text-slate-400">الغرفة</span><span>{completedRoom.name || 'Room'}</span></p><p className="flex justify-between gap-4"><span className="text-slate-400">الإجمالي</span><span>{Number(completedRoom.price).toFixed(2)} {completedRoom.currency || 'AED'}</span></p></div><button type="button" onClick={onBack} className="mt-7 rounded-xl bg-remal-red px-6 py-3 text-sm font-black text-white">العودة للرئيسية</button></div></main>;
    }

    if (!selectedBooking) {
        return <main className="min-h-screen bg-remal-bg px-5 py-12 lg:px-10"><div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm"><p className="font-black text-remal-dark">لم يتم اختيار غرفة بعد</p><button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-sm font-black text-white"><ArrowRight size={16} /> العودة للبحث</button></div></main>;
    }

    const room = selectedBooking.room || {};
    const total = Number(room.price);
    const currency = room.currency || 'AED';
    const submitPayment = async (event) => {
        event.preventDefault();
        setStatus('loading');
        setError('');
        try {
            const response = await BookingAPI.createZiinaIntent({
                total,
                currency,
                hid: selectedBooking.hid,
                book_hash: room.book_hash,
                hotelName: selectedBooking.hotelName,
                roomName: room.name,
                checkin: selectedBooking.checkin,
                checkout: selectedBooking.checkout,
                guest
            });
            if (!response.payment_url) throw new Error('Missing payment URL');
            const pendingBooking = { ...selectedBooking, guest };
            localStorage.setItem('remal_checkout_pending', JSON.stringify(pendingBooking));
            localStorage.setItem('remal_checkout', JSON.stringify(pendingBooking));
            localStorage.setItem('pending_reservation', JSON.stringify({
                provider: 'ratehawk',
                hotelId: selectedBooking.hid,
                hid: selectedBooking.hid,
                book_hash: room.book_hash,
                roomId: room.roomId || room.book_hash,
                hotelName: selectedBooking.hotelName,
                roomName: room.name,
                price: total,
                currency,
                checkin: selectedBooking.checkin,
                checkout: selectedBooking.checkout,
                guestName: `${guest.firstName} ${guest.lastName}`.trim(),
                email: guest.email,
                phone: guest.phone,
                specialRequests: guest.specialRequests,
                paymentMethod: 'visa'
            }));
            setStatus('success');
            window.location.assign(response.payment_url);
        } catch (requestError) {
            setStatus('error');
            setError(requestError.response?.data?.message || 'تعذر تجهيز الدفع، يرجى المحاولة مرة أخرى');
        }
    };

    return <main className="min-h-screen bg-slate-50 px-5 py-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
            <button type="button" onClick={onBack} className="mb-7 inline-flex items-center gap-2 text-sm font-black text-remal-blue"><ArrowRight size={17} /> العودة لاختيار الغرفة</button>
            <div className="mb-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-remal-blue">إتمام الحجز</p><h1 className="mt-2 text-3xl font-black text-remal-dark">بيانات الضيف والدفع</h1><p className="mt-2 text-sm font-bold text-slate-400">أدخل بيانات الضيف لإتمام الدفع الآمن عبر Ziina</p></div>
            <div className="grid gap-7 lg:grid-cols-[1fr_22rem]">
                <div className="order-2 lg:order-1">
                    {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-remal-red">{error}</p>}
                    <GuestForm
                        guestDetails={guest}
                        onGuestDetailsChange={setGuest}
                        onSubmit={submitPayment}
                        isSubmitting={status === 'loading' || status === 'success'}
                    />
                </div>
                <aside className="order-1 h-fit rounded-2xl bg-remal-dark p-6 text-white shadow-sm lg:order-2 lg:sticky lg:top-6">
                    <p className="text-xs font-bold text-white/60">ملخص الحجز</p><h2 className="mt-3 text-xl font-black">{selectedBooking.hotelName || 'Hotel'}</h2><p className="mt-2 text-sm font-bold text-white/60">{room.name || 'Room'}</p>
                    <div className="my-6 space-y-3 border-y border-white/10 py-5 text-sm font-bold"><p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-white/60"><CalendarDays size={15} /> الوصول</span><span>{selectedBooking.checkin || '-'}</span></p><p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-white/60"><CalendarDays size={15} /> المغادرة</span><span>{selectedBooking.checkout || '-'}</span></p></div>
                    <div className="flex items-end justify-between"><span className="text-sm font-bold text-white/60">الإجمالي</span><span className="text-3xl font-black">{Number.isFinite(total) ? total.toFixed(2) : '-'} <small className="text-xs">{currency}</small></span></div>
                </aside>
            </div>
        </div>
    </main>;
}
