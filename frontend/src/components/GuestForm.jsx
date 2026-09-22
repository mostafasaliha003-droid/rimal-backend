import { Mail, Phone } from 'lucide-react';

export default function GuestForm({ guest, onChange, onSubmit, loading, error }) {
    const fieldClass = 'peer w-full rounded-xl border border-slate-200 bg-white px-4 pb-2 pt-6 text-sm font-bold text-slate-900 shadow-sm outline-none transition placeholder:text-transparent hover:border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600 focus:ring-offset-1';
    return (
        <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-7 flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
                <div className="text-right">
                    <p className="text-xs font-black tracking-wide text-blue-700">الخطوة 1 من 2</p>
                    <h2 className="mt-1 text-xl font-black text-slate-900">بيانات الضيف الرئيسي</h2>
                    <p className="mt-1 text-xs font-semibold text-slate-500">تُستخدم هذه البيانات لتأكيد الحجز والتواصل معك</p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-sm font-black text-blue-700">01</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
                <div className="relative"><input id="guest-first-name" required name="firstName" value={guest.firstName} onChange={onChange} className={fieldClass} placeholder="الاسم الأول" autoComplete="given-name" /><label htmlFor="guest-first-name" className="pointer-events-none absolute right-4 top-2 text-xs font-bold text-slate-500 transition peer-focus:text-blue-700">الاسم الأول</label></div>
                <div className="relative"><input id="guest-last-name" required name="lastName" value={guest.lastName} onChange={onChange} className={fieldClass} placeholder="اسم العائلة" autoComplete="family-name" /><label htmlFor="guest-last-name" className="pointer-events-none absolute right-4 top-2 text-xs font-bold text-slate-500 transition peer-focus:text-blue-700">اسم العائلة</label></div>
                <div className="relative"><Mail aria-hidden="true" size={16} className="pointer-events-none absolute left-4 top-5 text-slate-400 peer-focus:text-blue-700" /><input id="guest-email" required type="email" name="email" value={guest.email} onChange={onChange} className={`${fieldClass} pl-11`} placeholder="البريد الإلكتروني" autoComplete="email" /><label htmlFor="guest-email" className="pointer-events-none absolute right-4 top-2 text-xs font-bold text-slate-500 transition peer-focus:text-blue-700">البريد الإلكتروني</label></div>
                <div className="relative"><Phone aria-hidden="true" size={16} className="pointer-events-none absolute left-4 top-5 text-slate-400" /><input id="guest-phone" required type="tel" name="phone" value={guest.phone} onChange={onChange} className={`${fieldClass} pl-11`} placeholder="رقم الهاتف" autoComplete="tel" /><label htmlFor="guest-phone" className="pointer-events-none absolute right-4 top-2 text-xs font-bold text-slate-500 transition peer-focus:text-blue-700">رقم الهاتف</label></div>
            </div>
            <div className="relative mt-5"><textarea id="guest-requests" name="specialRequests" value={guest.specialRequests} onChange={onChange} rows="4" className={`${fieldClass} resize-none`} placeholder="طلبات خاصة" /><label htmlFor="guest-requests" className="pointer-events-none absolute right-4 top-2 text-xs font-bold text-slate-500">طلبات خاصة <span className="font-medium">(اختياري)</span></label><p className="mt-2 text-xs font-medium text-slate-500">مثال: سرير أطفال أو تسجيل وصول متأخر</p></div>
            {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</p>}
            <button type="submit" disabled={loading} aria-busy={loading} className="mt-7 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-sm transition duration-200 hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-500">
                {loading ? <span className="animate-pulse">جارٍ تجهيز الدفع الآمن...</span> : 'المتابعة إلى الدفع عبر Ziina'}
            </button>
        </form>
    );
}
