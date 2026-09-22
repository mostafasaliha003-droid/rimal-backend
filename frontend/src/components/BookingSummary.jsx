import { CalendarDays, ShieldCheck } from 'lucide-react';

export default function BookingSummary({ booking }) {
    const room = booking?.room || {};
    return (
        <aside className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-6">
            <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-right text-white">
                <p className="text-xs font-bold text-slate-300">ملخص الحجز</p>
                <h2 className="mt-2 text-lg font-black leading-7">{booking?.hotelName || 'Hotel'}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-300">{room.name || 'Room'}</p>
            </div>
            <div className="p-5 text-right">
                <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-900">
                    <p className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-slate-500"><CalendarDays size={16} className="text-blue-700" /> الوصول</span><span>{booking?.checkin || '-'}</span></p>
                    <p className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-slate-500"><CalendarDays size={16} className="text-blue-700" /> المغادرة</span><span>{booking?.checkout || '-'}</span></p>
                </div>
                <div aria-live="polite" className="mt-5 flex items-end justify-between border-t border-slate-200 pt-5"><span className="text-sm font-bold text-slate-500">الإجمالي</span><span className="text-3xl font-black tracking-normal text-slate-900">{Number(room.price).toFixed(2)} <small className="text-xs font-bold text-slate-500">{room.currency || 'AED'}</small></span></div>
                <p className="mt-5 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-xs font-bold leading-5 text-emerald-800"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-700" /> تثبيت السعر ثم دفع آمن عبر Ziina</p>
            </div>
        </aside>
    );
}
