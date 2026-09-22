import { CalendarDays, ShieldCheck } from 'lucide-react';

export default function BookingSummary({ booking }) {
    const room = booking?.room || {};
    return (
        <aside className="h-fit rounded-2xl bg-remal-dark p-6 text-white shadow-sm lg:sticky lg:top-6">
            <p className="text-xs font-bold text-white/60">ملخص الحجز</p>
            <h2 className="mt-3 text-xl font-black">{booking?.hotelName || 'Hotel'}</h2>
            <p className="mt-2 text-sm font-bold text-white/60">{room.name || 'Room'}</p>
            <div className="my-6 space-y-3 border-y border-white/10 py-5 text-sm font-bold">
                <p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-white/60"><CalendarDays size={15} /> الوصول</span><span>{booking?.checkin || '-'}</span></p>
                <p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-white/60"><CalendarDays size={15} /> المغادرة</span><span>{booking?.checkout || '-'}</span></p>
            </div>
            <div aria-live="polite" className="flex items-end justify-between"><span className="text-sm font-bold text-white/60">الإجمالي</span><span className="text-3xl font-black">{Number(room.price).toFixed(2)} <small className="text-xs">{room.currency || 'AED'}</small></span></div>
            <p className="mt-5 flex items-center gap-2 text-xs font-bold text-emerald-300"><ShieldCheck size={16} /> تثبيت السعر ثم دفع آمن عبر Ziina</p>
        </aside>
    );
}
