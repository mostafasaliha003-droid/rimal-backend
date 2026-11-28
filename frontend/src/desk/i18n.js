import { createContext, useContext } from 'react';

export const DeskLanguage = createContext({ lang: 'ar', t: key => key });
export const useT = () => useContext(DeskLanguage);

const ar = {
    brand: 'مخدة', desk: 'Desk', console: 'غرفة العمليات',
    signInTitle: 'أهلاً بك في غرفة العمليات', signInBody: 'المالية والموردون والأسعار الصافية وخدمة العملاء، في مكان واحد ومباشر.',
    email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'دخول', signingIn: 'جارٍ الدخول…', signOut: 'خروج',
    badCredentials: 'البريد أو كلمة المرور غير صحيحة.', tooMany: 'محاولات كثيرة. انتظر دقيقة ثم حاول.', offline: 'تعذّر الاتصال بالسيرفر.',
    secureNote: 'الجلسة تنتهي عند إغلاق النافذة، ولا يُحفظ أي رقم مالي على الجهاز.',
    finance: 'المالية', suppliers: 'الموردون', fees: 'رسوم الدفع', rates: 'الأسعار الصافية', care: 'خدمة العملاء', bookings: 'الحجوزات', team: 'الفريق',
    admin: 'المدير', agent: 'خدمة العملاء', live: 'مباشر', updated: 'آخر تحديث', refresh: 'تحديث', retry: 'إعادة المحاولة', loading: 'جارٍ التحميل…',
    days: { 7: '7 أيام', 30: '30 يوماً', 90: '90 يوماً', 365: 'سنة' },
    revenue: 'الإيراد المحتفظ به', revenueHint: 'المدفوع ناقص المسترد', supplierCost: 'تكلفة المورد', paymentFees: 'رسوم الدفع', net: 'صافي الربح', margin: 'هامش الربح',
    bookingsCount: 'الحجوزات', confirmed: 'مؤكد', cancelled: 'ملغى', failed: 'فشل', pending: 'قيد التنفيذ', refund: 'استرداد',
    salesVsNet: 'المبيعات مقابل الصافي', whereMoneyGoes: 'أين يذهب كل درهم', byProvider: 'حسب مزوّد الدفع', topHotels: 'الفنادق الأعلى ربحاً', latest: 'أحدث الحجوزات',
    hotel: 'الفندق', guest: 'الضيف', status: 'الحالة', provider: 'الدفع', sell: 'سعر البيع', cost: 'التكلفة', fee: 'الرسوم', refunded: 'المسترد', reference: 'المرجع', count: 'العدد',
    feesMissing: 'رسوم الدفع غير مضبوطة لـ', feesMissingBody: 'الصافي المعروض لا يشمل رسوم هذه الجهات حتى تُدخل نسبها.', setFees: 'اضبط الرسوم',
    costUnknown: 'تكلفة المورد غير معروفة لبعض الحجوزات', penaltyUnknown: 'غرامة المورد بعد الإلغاء غير معروفة لبعض الحجوزات', fxMissing: 'سعر صرف غير متوفر لبعض العملات',
    test: 'تجريبي', rateBooking: 'بسعر صرف الحجز', rateLive: 'بسعر الصرف الحالي', empty: 'لا توجد حجوزات مدفوعة في هذه الفترة.',
    supplierTitle: 'رصيدنا لدى الموردين', available: 'متاح لحجوزات جديدة', deposit: 'الإيداع', creditLimit: 'الحد الائتماني', unpaid: 'حجوزات غير مسددة',
    unpaidRef: 'قابلة للاسترداد', unpaidNonRef: 'غير قابلة للاسترداد', overdue: 'متأخرات', overpay: 'دفعات زائدة', notConnected: 'غير متصل بعد', checked: 'آخر قراءة',
    agreement: 'الاتفاقية', supplierError: 'تعذّر قراءة الرصيد من المورد الآن.',
    feesTitle: 'رسوم مزوّدي الدفع', feesBody: 'أدخل النسب المتفق عليها في عقودك. تُحسب على كل حجز وتظهر في الصافي فوراً.',
    percent: 'النسبة %', fixed: 'رسم ثابت', vat: 'ضريبة على الرسوم %', example: 'على حجز بقيمة 1,000 درهم', save: 'حفظ', saved: 'تم الحفظ',
    card: 'بطاقات ومحافظ', bnpl: 'اشترِ الآن وادفع لاحقاً', comingSoon: 'قريباً', notConfigured: 'غير مضبوطة', invalidFees: 'قيمة غير صالحة. استخدم أرقاماً فقط.',
    ratesTitle: 'الأسعار الصافية', ratesBody: 'أسعار المورد الصافية مباشرة، مع سعر البيع والهامش. للإدارة فقط.', destination: 'فندق أو مدينة', checkin: 'الوصول', checkout: 'المغادرة',
    adults: 'البالغون', residency: 'جنسية الضيف', search: 'ابحث', searching: 'نجلب الأسعار من المورد…', noRates: 'لا توجد أسعار متاحة لهذه المعايير.',
    room: 'الغرفة', meal: 'الوجبات', cancellation: 'الإلغاء', freeUntil: 'مجاني حتى', nonRefundable: 'غير مسترد', marginAbs: 'الهامش', pickDestination: 'اختر فندقاً أو مدينة من القائمة.',
    inbox: 'المحادثات', all: 'الكل', unread: 'غير مقروءة', mine: 'المسندة لي', unassigned: 'غير مسندة', open: 'مفتوحة', waiting: 'بانتظار العميل', resolved: 'محلولة',
    searchChats: 'ابحث بالمرجع أو الاسم أو الهاتف', noChats: 'لا توجد محادثات هنا.', pickChat: 'اختر محادثة من القائمة.',
    reply: 'رد للعميل', note: 'ملاحظة داخلية', send: 'إرسال', assignMe: 'أسند لي', resolve: 'تم الحل', reopen: 'إعادة فتح', priority: 'أولوية عالية',
    customer: 'العميل', team: 'الفريق', internal: 'داخلية', typeReply: 'اكتب ردك…', typeNote: 'ملاحظة لا يراها العميل…',
    quick: ['شكراً لتواصلك مع مخدة. أراجع حجزك الآن وأوافيك هنا.', 'تواصلنا مع الفندق وننتظر ردهم، وسنحدّثك فور وصوله.', 'تم! أكّد الفندق طلبك.'],
    bookingPanel: 'الحجز', liveStatus: 'الحالة المباشرة', policy: 'سياسة الإلغاء', timeline: 'المسار', contact: 'التواصل', stay: 'الإقامة',
    cancellable: 'قابل للإلغاء الآن', notCancellable: 'غير قابل للإلغاء تلقائياً', penaltyNow: 'غرامة الإلغاء الآن', free: 'مجاني', unavailable: 'غير متاح',
    events: { created: 'إنشاء الحجز', paid: 'تم الدفع', confirmed: 'أكّد الفندق', voucher_sent: 'أُرسلت القسيمة', cancellation_requested: 'طلب إلغاء', cancelled: 'أُلغي', refunded: 'تم الاسترداد' },
    lookup: 'ابحث عن حجز: المرجع، اسم الضيف، البريد، أو الفندق', noBookings: 'لا نتائج.', openChat: 'افتح المحادثة', noChat: 'لا محادثة لهذا الحجز بعد.',
    economics: 'اقتصاديات الحجز', teamTitle: 'فريق خدمة العملاء', teamBody: 'أضف موظفي خدمة العملاء. يرون المحادثات والحجوزات فقط، ولا يرون أي تكلفة أو هامش.',
    name: 'الاسم', add: 'إضافة', active: 'نشط', disabled: 'موقوف', disable: 'إيقاف', enable: 'تفعيل', resetPassword: 'كلمة مرور جديدة', lastLogin: 'آخر دخول', never: 'لم يدخل بعد',
    weakPassword: 'كلمة المرور 12 حرفاً على الأقل.', exists: 'هذا البريد مسجّل.', invalidEmail: 'بريد غير صالح.', added: 'تمت الإضافة',
    language: 'English', error: 'حدث خطأ. حاول مجدداً.', expires: 'تنتهي الجلسة', now: 'الآن',
    errors: 'أعطال التطبيق', errorsBody: 'أعطال تصلنا من هواتف العملاء، بلا أي بيانات شخصية. مجمّعة حسب النوع والنسخة وتُحذف بعد 30 يوماً.', noErrors: 'لا أعطال مسجّلة. ممتاز!', fatal: 'إغلاق مفاجئ'
};

const en = {
    brand: 'Pillow Stays', desk: 'Desk', console: 'Operations room',
    signInTitle: 'Welcome to the operations room', signInBody: 'Finance, suppliers, net rates and customer care, live and in one place.',
    email: 'Email', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…', signOut: 'Sign out',
    badCredentials: 'Wrong email or password.', tooMany: 'Too many attempts. Wait a minute and try again.', offline: 'Could not reach the server.',
    secureNote: 'The session ends when this window closes, and no financial figure is stored on the device.',
    finance: 'Finance', suppliers: 'Suppliers', fees: 'Payment fees', rates: 'Net rates', care: 'Customer care', bookings: 'Bookings', team: 'Team',
    admin: 'Admin', agent: 'Customer care', live: 'Live', updated: 'Updated', refresh: 'Refresh', retry: 'Retry', loading: 'Loading…',
    days: { 7: '7 days', 30: '30 days', 90: '90 days', 365: '1 year' },
    revenue: 'Revenue kept', revenueHint: 'Paid minus refunded', supplierCost: 'Supplier cost', paymentFees: 'Payment fees', net: 'Net profit', margin: 'Margin',
    bookingsCount: 'Bookings', confirmed: 'Confirmed', cancelled: 'Cancelled', failed: 'Failed', pending: 'In progress', refund: 'Refund',
    salesVsNet: 'Sales vs net', whereMoneyGoes: 'Where each dirham goes', byProvider: 'By payment provider', topHotels: 'Most profitable hotels', latest: 'Latest bookings',
    hotel: 'Hotel', guest: 'Guest', status: 'Status', provider: 'Payment', sell: 'Sell', cost: 'Cost', fee: 'Fee', refunded: 'Refunded', reference: 'Reference', count: 'Count',
    feesMissing: 'Payment fees not set for', feesMissingBody: 'Net excludes their fees until you enter the rates.', setFees: 'Set fees',
    costUnknown: 'Supplier cost unknown for some bookings', penaltyUnknown: 'Supplier penalty after cancellation unknown for some bookings', fxMissing: 'Exchange rate missing for some currencies',
    test: 'Test', rateBooking: 'at the booking’s rate', rateLive: 'at today’s rate', empty: 'No paid bookings in this period.',
    supplierTitle: 'Our balance with suppliers', available: 'Available for new bookings', deposit: 'Deposit', creditLimit: 'Credit limit', unpaid: 'Unpaid bookings',
    unpaidRef: 'Refundable', unpaidNonRef: 'Non-refundable', overdue: 'Overdue', overpay: 'Overpaid', notConnected: 'Not connected yet', checked: 'Read at',
    agreement: 'Agreement', supplierError: 'Could not read the balance from the supplier right now.',
    feesTitle: 'Payment provider fees', feesBody: 'Enter the rates in your contracts. They apply to every booking and show in net at once.',
    percent: 'Rate %', fixed: 'Fixed fee', vat: 'VAT on fees %', example: 'On a AED 1,000 booking', save: 'Save', saved: 'Saved',
    card: 'Cards & wallets', bnpl: 'Buy now, pay later', comingSoon: 'Coming soon', notConfigured: 'Not set', invalidFees: 'Invalid value. Numbers only.',
    ratesTitle: 'Net rates', ratesBody: 'Live supplier net rates with our sell price and margin. Management only.', destination: 'Hotel or city', checkin: 'Check-in', checkout: 'Check-out',
    adults: 'Adults', residency: 'Guest nationality', search: 'Search', searching: 'Fetching rates from the supplier…', noRates: 'No rates for these criteria.',
    room: 'Room', meal: 'Meals', cancellation: 'Cancellation', freeUntil: 'Free until', nonRefundable: 'Non-refundable', marginAbs: 'Margin', pickDestination: 'Pick a hotel or city from the list.',
    inbox: 'Conversations', all: 'All', unread: 'Unread', mine: 'Mine', unassigned: 'Unassigned', open: 'Open', waiting: 'Waiting', resolved: 'Resolved',
    searchChats: 'Search reference, name or phone', noChats: 'No conversations here.', pickChat: 'Pick a conversation.',
    reply: 'Reply', note: 'Internal note', send: 'Send', assignMe: 'Assign to me', resolve: 'Resolve', reopen: 'Reopen', priority: 'High priority',
    customer: 'Customer', team: 'Team', internal: 'Internal', typeReply: 'Write your reply…', typeNote: 'A note the customer never sees…',
    quick: ['Thank you for contacting Pillow Stays. I am reviewing your booking and will update you here.', 'We have contacted the hotel and will update you as soon as they reply.', 'Done! The hotel confirmed your request.'],
    bookingPanel: 'Booking', liveStatus: 'Live status', policy: 'Cancellation policy', timeline: 'Timeline', contact: 'Contact', stay: 'Stay',
    cancellable: 'Cancellable now', notCancellable: 'Not cancellable automatically', penaltyNow: 'Penalty now', free: 'Free', unavailable: 'Unavailable',
    events: { created: 'Booking created', paid: 'Paid', confirmed: 'Hotel confirmed', voucher_sent: 'Voucher sent', cancellation_requested: 'Cancellation requested', cancelled: 'Cancelled', refunded: 'Refunded' },
    lookup: 'Find a booking: reference, guest, email or hotel', noBookings: 'No results.', openChat: 'Open conversation', noChat: 'No conversation for this booking yet.',
    economics: 'Booking economics', teamTitle: 'Customer care team', teamBody: 'Add customer-care staff. They see conversations and bookings only, never costs or margins.',
    name: 'Name', add: 'Add', active: 'Active', disabled: 'Disabled', disable: 'Disable', enable: 'Enable', resetPassword: 'New password', lastLogin: 'Last sign-in', never: 'Never',
    weakPassword: 'At least 12 characters.', exists: 'This email is already on the team.', invalidEmail: 'Invalid email.', added: 'Added',
    language: 'العربية', error: 'Something went wrong. Try again.', expires: 'Session ends', now: 'now',
    errors: 'App errors', errorsBody: 'Errors reported by guests’ phones, with no personal data. Grouped by type and version, deleted after 30 days.', noErrors: 'No errors reported. Great!', fatal: 'Crash'
};

export const dictionaries = { ar, en };

const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const fmt = (value, currency = 'AED', digits = 2) => value === null || value === undefined || Number.isNaN(Number(value)) ? '—'
    : `${currency ? currency + ' ' : ''}${digits === 0 ? whole.format(value) : number.format(value)}`;
// Isolated left-to-right so "20.49%" never flips to "%20.49" inside Arabic text.
export const pct = value => value === null || value === undefined ? '—' : `\u2066${number.format(value)}%\u2069`;
export const day = (value, lang) => value ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(value)) : '—';
export const dateTime = (value, lang) => value ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
export const clock = (value, lang) => value ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value) : '';
