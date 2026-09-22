import { Mail, Phone } from 'lucide-react';

export default function GuestForm({ guest, onChange, onSubmit, loading, error }) {
    const fieldClass = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none transition focus:border-remal-blue focus:ring-2 focus:ring-blue-500';
    return (
        <form onSubmit={onSubmit} className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-7 border-b border-slate-100 pb-5">
                <h2 className="font-black text-remal-dark">بيانات الضيف الرئيسي</h2>
                <p className="mt-1 text-xs font-bold text-slate-400">تُستخدم هذه البيانات لتأكيد الحجز والتواصل معك</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-black" htmlFor="guest-first-name">الاسم الأول<input id="guest-first-name" required name="firstName" value={guest.firstName} onChange={onChange} className={fieldClass} autoComplete="given-name" /></label>
                <label className="text-sm font-black" htmlFor="guest-last-name">اسم العائلة<input id="guest-last-name" required name="lastName" value={guest.lastName} onChange={onChange} className={fieldClass} autoComplete="family-name" /></label>
                <label className="text-sm font-black" htmlFor="guest-email"><span className="inline-flex items-center gap-2">البريد الإلكتروني <Mail size={14} className="text-remal-blue" /></span><input id="guest-email" required type="email" name="email" value={guest.email} onChange={onChange} className={fieldClass} autoComplete="email" /></label>
                <label className="text-sm font-black" htmlFor="guest-phone"><span className="inline-flex items-center gap-2">رقم الهاتف <Phone size={14} className="text-remal-blue" /></span><input id="guest-phone" required type="tel" name="phone" value={guest.phone} onChange={onChange} className={fieldClass} autoComplete="tel" /></label>
            </div>
            <label className="mt-5 block text-sm font-black" htmlFor="guest-requests">طلبات خاصة<textarea id="guest-requests" name="specialRequests" value={guest.specialRequests} onChange={onChange} rows="4" className={`${fieldClass} resize-none`} placeholder="مثال: سرير أطفال أو تسجيل وصول متأخر" /></label>
            {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-remal-red">{error}</p>}
            <button type="submit" disabled={loading} aria-busy={loading} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-remal-red px-5 py-4 text-sm font-black text-white transition hover:bg-[#a10b0b] disabled:cursor-not-allowed disabled:bg-slate-400">
                {loading ? 'جارٍ تجهيز الدفع...' : 'المتابعة إلى الدفع عبر Ziina'}
            </button>
        </form>
    );
}
