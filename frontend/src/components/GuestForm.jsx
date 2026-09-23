export default function GuestForm({ guestDetails, onGuestDetailsChange, onSubmit, isSubmitting, paymentAvailable = false }) {
  return (
    <div className="min-w-0 bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
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
            <label htmlFor="guest-first-name" className="block text-sm font-semibold text-slate-700 mb-2">الاسم الأول كما في وثيقة السفر</label>
            <input id="guest-first-name" name="given-name" autoComplete="given-name" maxLength={80} required type="text" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition-all focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10" value={guestDetails.firstName} onChange={(event) => onGuestDetailsChange({ ...guestDetails, firstName: event.target.value })} />
          </div>
          <div>
            <label htmlFor="guest-last-name" className="block text-sm font-semibold text-slate-700 mb-2">اسم العائلة كما في وثيقة السفر</label>
            <input id="guest-last-name" name="family-name" autoComplete="family-name" maxLength={80} required type="text" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition-all focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10" value={guestDetails.lastName} onChange={(event) => onGuestDetailsChange({ ...guestDetails, lastName: event.target.value })} />
          </div>
          <div>
            <label htmlFor="guest-email" className="block text-sm font-semibold text-slate-700 mb-2">البريد الإلكتروني</label>
            <input id="guest-email" name="email" autoComplete="email" required type="email" maxLength={254} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition-all focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10" dir="ltr" value={guestDetails.email} onChange={(event) => onGuestDetailsChange({ ...guestDetails, email: event.target.value })} />
          </div>
          <div>
            <label htmlFor="guest-phone" className="block text-sm font-semibold text-slate-700 mb-2">رقم الهاتف مع رمز الدولة</label>
            <input id="guest-phone" name="tel" autoComplete="tel" minLength={7} maxLength={25} required type="tel" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm transition-all focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10" dir="ltr" value={guestDetails.phone} onChange={(event) => onGuestDetailsChange({ ...guestDetails, phone: event.target.value })} />
          </div>
        </div>

        {(guestDetails.rooms || []).map((room, roomIndex) => <fieldset key={roomIndex} className="space-y-4 border-t border-slate-200 pt-4"><legend className="text-sm font-bold">مسافرو الغرفة {roomIndex + 1}</legend>{room.guests.map((traveler, travelerIndex) => roomIndex === 0 && travelerIndex === 0 ? null : <div key={travelerIndex} className="grid gap-3 sm:grid-cols-2">{['firstName', 'lastName'].map(field => <label key={field} className="text-sm text-slate-700">{field === 'firstName' ? 'الاسم الأول' : 'اسم العائلة'} للضيف {travelerIndex + 1}{traveler.is_child ? ` (طفل، ${traveler.age} سنوات)` : ''}<input required maxLength={80} autoComplete="off" value={traveler[field]} onChange={event => onGuestDetailsChange({ ...guestDetails, rooms: guestDetails.rooms.map((group, groupIndex) => groupIndex === roomIndex ? { ...group, guests: group.guests.map((person, personIndex) => personIndex === travelerIndex ? { ...person, [field]: event.target.value } : person) } : group) })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition-all focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10" /></label>)}</div>)}</fieldset>)}
        <label className="block text-sm text-slate-700">طلبات خاصة (اختيارية وغير مضمونة)<textarea value={guestDetails.specialRequests} maxLength={1000} onChange={event => onGuestDetailsChange({ ...guestDetails, specialRequests: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition-all focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10" rows={3} /></label>
        <label className="flex items-start gap-3 text-sm leading-7"><input type="checkbox" required className="mt-2 h-4 w-4 shrink-0" />راجعت إجمالي الإقامة والرسوم وشروط الإلغاء لهذا العرض.</label>
        <div className="pt-6 mt-8 border-t border-slate-100">
          <div className="flex items-center justify-center gap-2 mb-4 text-slate-500 text-xs font-medium">
            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <span>دفع آمن ومشفر بواسطة بوابات Ziina</span>
          </div>

          <button type="submit" disabled={isSubmitting || !paymentAvailable} className="w-full flex items-center justify-center gap-2 bg-remal-dark text-white rounded-lg py-4 font-bold text-base disabled:opacity-50">
            {isSubmitting ? 'جار التحقق والتحويل...' : paymentAvailable ? 'التحقق من السعر والمتابعة للدفع' : 'الدفع غير متاح حالياً'}
          </button>
        </div>
      </form>
    </div>
  );
}

