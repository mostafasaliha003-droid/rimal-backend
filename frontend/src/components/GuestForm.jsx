export default function GuestForm({ guestDetails, onGuestDetailsChange, onSubmit, isSubmitting }) {
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgb(0,0,0,0.04)] border border-slate-100 p-8">
      {/* Secure Stepper Header */}
      <div className="flex items-center gap-4 mb-8 pb-6 border-b border-slate-100">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm">
          01
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">بيانات الضيف الرئيسي</h2>
          <p className="text-sm text-slate-500 mt-1">تُستخدم هذه البيانات لتأكيد الحجز والتواصل معك</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">الاسم الأول</label>
            <input required type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all text-sm" value={guestDetails.firstName} onChange={(e) => onGuestDetailsChange({ ...guestDetails, firstName: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">اسم العائلة</label>
            <input required type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all text-sm" value={guestDetails.lastName} onChange={(e) => onGuestDetailsChange({ ...guestDetails, lastName: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">البريد الإلكتروني</label>
            <input required type="email" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all text-sm text-left" dir="ltr" value={guestDetails.email} onChange={(e) => onGuestDetailsChange({ ...guestDetails, email: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">رقم الهاتف</label>
            <input required type="tel" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all text-sm text-left" dir="ltr" value={guestDetails.phone} onChange={(e) => onGuestDetailsChange({ ...guestDetails, phone: e.target.value })} />
          </div>
        </div>

        {/* Trust Signals & Button */}
        <div className="pt-6 mt-8 border-t border-slate-100">
          <div className="flex items-center justify-center gap-2 mb-4 text-slate-500 text-xs font-medium">
            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <span>دفع آمن ومشفر بواسطة بوابات Ziina</span>
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#0F172A] to-[#1E293B] hover:shadow-xl hover:-translate-y-0.5 text-white rounded-xl py-4 transition-all duration-300 font-bold text-base disabled:opacity-50">
            {isSubmitting ? 'جاري التحويل...' : 'المتابعة إلى الدفع'}
          </button>
        </div>
      </form>
    </div>
  );
}

