import { Check } from 'lucide-react';

export default function BookingSuccess({ booking, onBack }) {
    const room = booking?.room || {};
    return (
        <main className="min-h-screen bg-remal-bg px-5 py-12 lg:px-10">
            <div role="status" aria-live="polite" className="mx-auto max-w-2xl rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check size={30} /></div>
                <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-emerald-600">تم الدفع بنجاح</p>
                <h1 className="mt-2 text-3xl font-black text-remal-dark">تم تأكيد طلب الدفع</h1>
                <p className="mt-3 text-sm font-bold leading-7 text-slate-500">سيتم إرسال تفاصيل الحجز إلى بريدك الإلكتروني بعد تأكيد المورد.</p>
                <div className="mt-8 space-y-3 rounded-2xl bg-remal-bg p-5 text-right text-sm font-bold">
                    <p className="flex justify-between gap-4"><span className="text-slate-400">الفندق</span><span>{booking?.hotelName || 'Hotel'}</span></p>
                    <p className="flex justify-between gap-4"><span className="text-slate-400">الغرفة</span><span>{room.name || 'Room'}</span></p>
                    <p className="flex justify-between gap-4"><span className="text-slate-400">الإجمالي</span><span>{Number(room.price).toFixed(2)} {room.currency || 'AED'}</span></p>
                </div>
                <button type="button" onClick={onBack} className="mt-7 rounded-xl bg-remal-red px-6 py-3 text-sm font-black text-white transition hover:bg-[#a10b0b] focus:ring-2 focus:ring-blue-500">العودة للرئيسية</button>
            </div>
        </main>
    );
}
