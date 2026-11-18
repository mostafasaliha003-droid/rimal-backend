const copy = {
  en: {
    quickDates: 'A shorter stay, sooner', quickDatesBody: 'These shortcuts set dates only. Search when you are ready.',
    tonight: 'Tonight · 1 night', tomorrow: 'Tomorrow · 1 night', nextWeek: 'In 7 days · 2 nights',
    recent: 'Your recent searches', recentBody: 'Saved only for this app session. Select one to edit its details before searching.',
    clearRecent: 'Clear recent searches', recentHint: 'Restores the search form. Does not start a search.',
    nights: (value: number) => `${value} ${value === 1 ? 'night' : 'nights'}`,
    guests: (adults: number, children: number, rooms: number) => `${adults} ${adults === 1 ? 'adult' : 'adults'}${children ? ` · ${children} ${children === 1 ? 'child' : 'children'}` : ''} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`,
  },
  ar: {
    quickDates: 'إقامة قريبة بخطوة أسرع', quickDatesBody: 'تضبط هذه الخيارات التواريخ فقط. ابدأ البحث عندما تكون جاهزاً.',
    tonight: 'الليلة · ليلة واحدة', tomorrow: 'غداً · ليلة واحدة', nextWeek: 'بعد 7 أيام · ليلتان',
    recent: 'عمليات بحثك الأخيرة', recentBody: 'تُحفظ خلال جلسة التطبيق فقط. اختر بحثاً لتعديل تفاصيله قبل البحث مجدداً.',
    clearRecent: 'مسح عمليات البحث الأخيرة', recentHint: 'يستعيد حقول النموذج فقط ولا يبدأ البحث.',
    nights: (value: number) => `الليالي: ${value}`,
    guests: (adults: number, children: number, rooms: number) => `البالغون: ${adults}${children ? ` · الأطفال: ${children}` : ''} · الغرف: ${rooms}`,
  },
};

export const searchCopy = (language: string) => copy[language === 'ar' ? 'ar' : 'en'];
