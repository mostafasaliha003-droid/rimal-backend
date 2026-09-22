import { useEffect, useState } from 'react';
import { ArrowRight, CreditCard, ShieldCheck } from 'lucide-react';
import BookingAPI from './services/bookingApi';
import BookingSuccess from './components/BookingSuccess';
import BookingSummary from './components/BookingSummary';
import GuestForm from './components/GuestForm';

const initialGuest = { firstName: '', lastName: '', email: '', phone: '', specialRequests: '' };

function readStoredBooking(booking) {
    if (booking) return booking;
    try {
        const stored = localStorage.getItem('remal_checkout_pending') || localStorage.getItem('remal_checkout') || sessionStorage.getItem('remal_checkout');
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

    if (paymentComplete && selectedBooking) return <BookingSuccess booking={selectedBooking} onBack={onBack} />;

    if (!selectedBooking) {
        return <main className="min-h-screen bg-remal-bg px-5 py-12 lg:px-10"><div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm"><p className="font-black text-remal-dark">لم يتم اختيار غرفة بعد</p><button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-sm font-black text-white focus:ring-2 focus:ring-blue-500"><ArrowRight size={16} /> العودة للبحث</button></div></main>;
    }

    const room = selectedBooking.room || {};
    const total = Number(room.price);
    const currency = room.currency || 'AED';
    const updateGuest = (event) => setGuest((current) => ({ ...current, [event.target.name]: event.target.value }));
    const submitPayment = async (event) => {
        event.preventDefault();
        setStatus('loading');
        setError('');
        try {
            const response = await BookingAPI.createZiinaIntent({ total, currency, hid: selectedBooking.hid, book_hash: room.book_hash, hotelName: selectedBooking.hotelName, roomName: room.name, checkin: selectedBooking.checkin, checkout: selectedBooking.checkout, guest });
            if (!response.payment_url) throw new Error('Missing payment URL');
            const pendingBooking = { ...selectedBooking, guest };
            localStorage.setItem('remal_checkout_pending', JSON.stringify(pendingBooking));
            localStorage.setItem('remal_checkout', JSON.stringify(pendingBooking));
            localStorage.setItem('pending_reservation', JSON.stringify({ provider: 'ratehawk', hotelId: selectedBooking.hid, hid: selectedBooking.hid, book_hash: room.book_hash, roomId: room.roomId || room.book_hash, hotelName: selectedBooking.hotelName, roomName: room.name, price: total, currency, checkin: selectedBooking.checkin, checkout: selectedBooking.checkout, guestName: `${guest.firstName} ${guest.lastName}`.trim(), email: guest.email, phone: guest.phone, specialRequests: guest.specialRequests, paymentMethod: 'visa' }));
            setStatus('success');
            window.location.assign(response.payment_url);
        } catch (requestError) {
            setStatus('error');
            setError(requestError.response?.data?.message || 'تعذر تجهيز الدفع، يرجى المحاولة مرة أخرى');
        }
    };

    return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
            <button type="button" onClick={onBack} className="mb-7 inline-flex items-center gap-2 text-sm font-black text-remal-blue focus:ring-2 focus:ring-blue-500"><ArrowRight size={17} /> العودة لاختيار الغرفة</button>
            <div className="mb-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-remal-blue">إتمام الحجز</p><h1 className="mt-2 text-3xl font-black text-remal-dark">بيانات الضيف والدفع</h1><p className="mt-2 text-sm font-bold text-slate-400">أدخل بيانات الضيف لإتمام الدفع الآمن عبر Ziina</p></div>
            <div className="grid gap-7 lg:grid-cols-[1fr_22rem]">
                <div className="order-2 lg:order-1"><div className="mb-5 flex items-center gap-3 rounded-2xl border border-remal-blue/20 bg-remal-blue/5 p-4"><CreditCard size={19} className="text-remal-blue" /><div><p className="font-black">دفع آمن</p><p className="text-xs font-bold text-slate-500">لن نطلب بيانات بطاقتك داخل الموقع</p></div></div><GuestForm guest={guest} onChange={updateGuest} onSubmit={submitPayment} loading={status === 'loading'} error={error} /><p className="mt-4 flex items-center justify-center gap-2 text-center text-xs font-bold text-slate-400"><ShieldCheck size={15} className="text-emerald-600" /> بياناتك محمية عبر بوابة Ziina</p></div>
                <div className="order-1 lg:order-2"><BookingSummary booking={selectedBooking} /></div>
            </div>
        </div>
    </main>;
}
