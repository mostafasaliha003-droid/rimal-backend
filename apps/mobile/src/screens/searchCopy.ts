const copy = {
  en: {
    tonight: 'Tonight · 1 night', tomorrow: 'Tomorrow · 1 night', nextWeek: 'In 7 days · 2 nights',
    recent: 'Pick up your search', showRecent: (count: number) => `View all searches (${count})`,
    clearRecent: 'Clear recent searches', recentHint: 'Restores the destination, dates and guests for editing.',
    nights: (value: number) => `${value} ${value === 1 ? 'night' : 'nights'}`,
    guests: (adults: number, children: number, rooms: number) => `${adults} ${adults === 1 ? 'adult' : 'adults'}${children ? ` · ${children} ${children === 1 ? 'child' : 'children'}` : ''} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`,
  },
  ar: {
    tonight: 'الليلة · ليلة واحدة', tomorrow: 'غداً · ليلة واحدة', nextWeek: 'بعد 7 أيام · ليلتان',
    recent: 'تابع بحثك', showRecent: (count: number) => `كل عمليات البحث (${count.toLocaleString('ar')})`,
    clearRecent: 'مسح عمليات البحث الأخيرة', recentHint: 'استعد الوجهة والتواريخ والضيوف لتعديل بحثك.',
    nights: (value: number) => value === 1 ? 'ليلة واحدة' : value === 2 ? 'ليلتان' : `${value} ${value <= 10 ? 'ليالٍ' : 'ليلة'}`,
    guests: (adults: number, children: number, rooms: number) => [
      adults === 1 ? 'بالغ واحد' : adults === 2 ? 'بالغان' : `${adults} ${adults <= 10 ? 'بالغين' : 'بالغاً'}`,
      children === 0 ? '' : children === 1 ? 'طفل واحد' : children === 2 ? 'طفلان' : `${children} ${children <= 10 ? 'أطفال' : 'طفلاً'}`,
      rooms === 1 ? 'غرفة واحدة' : rooms === 2 ? 'غرفتان' : `${rooms} غرف`,
    ].filter(Boolean).join(' · '),
  },
};

export const searchCopy = (language: string) => copy[language === 'ar' ? 'ar' : 'en'];
