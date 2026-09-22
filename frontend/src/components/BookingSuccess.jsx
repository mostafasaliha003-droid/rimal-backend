import { CalendarDays, Check, ReceiptText, Sparkles } from 'lucide-react';

export default function BookingSuccess({ booking, onBack }) {
    const room = booking?.room || {};
    return (
        <main className="min-h-screen bg-slate-50 px-5 py-12 lg:px-10">
            <div role="status" aria-live="polite" className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white text-center shadow-md">
                <div className="relative overflow-hidden bg-slate-950 px-6 pb-14 pt-12 text-white">
                    <div className="absolute left-6 top-6 text-amber-300"><Sparkles size={20} /></div>
                    <div className="absolute right-6 top-8 text-amber-300"><Sparkles size={15} /></div>
                    <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-4 border-emerald-200 bg-emerald-500 text-white shadow-lg"><Check size={38} strokeWidth={3} /></div>
                    <p className="mt-6 text-xs font-black tracking-[0.18em] text-emerald-300">تم الدفع بنجاح</p>
                    <h1 className="mt-2 text-3xl font-black">تم تأكيد طلب الدفع</h1>
                </div>
                <div className="p-6 sm:p-9">
                    <p className="mx-auto max-w-md text-sm font-semibold leading-7 text-slate-600">سيتم إرسال تفاصيل الحجز إلى بريدك الإلكتروني بعد تأكيد المورد.</p>
                    <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 text-right text-sm">
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3"><span className="inline-flex items-center gap-2 font-bold text-slate-500"><ReceiptText size={16} className="text-blue-700" /> تفاصيل الحجز</span><span className="text-xs font-bold text-emerald-700">قيد التأكيد</span></div>
                        <div className="space-y-4 p-4 font-bold text-slate-900">
                            <p className="flex justify-between gap-4"><span className="text-slate-500">الفندق</span><span>{booking?.hotelName || 'Hotel'}</span></p>
                            <p className="flex justify-between gap-4"><span className="text-slate-500">الغرفة</span><span>{room.name || 'Room'}</span></p>
                            <p className="flex justify-between gap-4"><span className="inline-flex items-center gap-1.5 text-slate-500"><CalendarDays size={15} /> الإقامة</span><span>{booking?.checkin || '-'} - {booking?.checkout || '-'}</span></p>
                            <p className="flex justify-between gap-4 border-t border-slate-200 pt-4 text-base"><span className="text-slate-500">الإجمالي المدفوع</span><span>{Number(room.price).toFixed(2)} {room.currency || 'AED'}</span></p>
                        </div>
                    </div>
                    <button type="button" onClick={onBack} className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-900 px-7 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">العودة للرئيسية</button>
                </div>
            </div>
        </main>
    );
}
