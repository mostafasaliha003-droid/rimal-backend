const copy = {
    ar: {
        title: 'تجارب النزلاء على Google', eyebrow: 'نظرة أقرب إلى إقامتك', intro: 'اقرأ تجارب المسافرين عن هذا الفندق من مصدرها على Google Maps.',
        load: 'عرض تقييمات Google', loading: 'نحمّل تجارب النزلاء من Google…', outOf: 'من 5', count: 'تقييم',
        all: 'عرض جميع التقييمات على Google Maps', selected: 'تعرض Google ما يصل إلى خمس مراجعات، مرتبة حسب الصلة. هذه عينة وليست جميع المراجعات.',
        disclaimer: 'هذه مراجعات منشورة على Google، ولا تعني أن أصحابها حجزوا عبر رمال.',
        unavailable: 'تقييمات Google غير متاحة لهذا الفندق حاليًا.', unmatched: 'لم نتمكن من مطابقة هذا الفندق بدقة مع صفحته على Google.',
        limited: 'تعذر تحميل التقييمات الآن. يرجى المحاولة لاحقًا.', retry: 'حاول مجددًا', search: 'البحث عن الفندق على Google Maps',
        original: 'عرض النص الأصلي', translated: 'عرض الترجمة', translation: 'مترجم بواسطة Google', more: 'قراءة المزيد', less: 'عرض أقل',
        source: 'عرض المراجعة على Google Maps', visit: 'تاريخ الزيارة', none: 'لا توجد مراجعات متاحة للعرض حاليًا.',
        privacy: 'الخصوصية', terms: 'شروط الاستخدام', unknownAuthor: 'صاحب المراجعة على Google'
    },
    en: {
        title: 'Guest experiences on Google', eyebrow: 'A closer look at your stay', intro: 'Explore travellers’ experiences of this hotel, directly from Google Maps.',
        load: 'Show Google reviews', loading: 'Loading guest experiences from Google…', outOf: 'out of 5', count: 'ratings',
        all: 'See all reviews on Google Maps', selected: 'Google provides up to five reviews, ordered by relevance. This is a selection, not every review.',
        disclaimer: 'These reviews were published on Google. They do not indicate a booking through Remal.',
        unavailable: 'Google reviews are currently unavailable for this hotel.', unmatched: 'We could not confidently match this hotel to its Google listing.',
        limited: 'Reviews cannot be loaded right now. Please try again later.', retry: 'Try again', search: 'Find the hotel on Google Maps',
        original: 'Show original', translated: 'Show translation', translation: 'Translated by Google', more: 'Read more', less: 'Show less',
        source: 'View review on Google Maps', visit: 'Visit date', none: 'No reviews are currently available to display.',
        privacy: 'Privacy', terms: 'Terms of use', unknownAuthor: 'Google reviewer'
    },
    es: {
        title: 'Experiencias de huéspedes en Google', eyebrow: 'Conoce mejor tu alojamiento', intro: 'Lee las experiencias de viajeros sobre este hotel directamente desde Google Maps.',
        load: 'Ver reseñas de Google', loading: 'Cargando experiencias de Google…', outOf: 'de 5', count: 'valoraciones',
        all: 'Ver todas las reseñas en Google Maps', selected: 'Google proporciona hasta cinco reseñas ordenadas por relevancia. Es una selección, no todas las reseñas.',
        disclaimer: 'Estas reseñas se publicaron en Google y no implican una reserva a través de Remal.',
        unavailable: 'Las reseñas de Google no están disponibles para este hotel.', unmatched: 'No pudimos identificar con seguridad este hotel en Google.',
        limited: 'No se pueden cargar las reseñas ahora. Inténtalo más tarde.', retry: 'Reintentar', search: 'Buscar el hotel en Google Maps',
        original: 'Ver original', translated: 'Ver traducción', translation: 'Traducido por Google', more: 'Leer más', less: 'Ver menos',
        source: 'Ver reseña en Google Maps', visit: 'Fecha de visita', none: 'No hay reseñas disponibles para mostrar.',
        privacy: 'Privacidad', terms: 'Condiciones de uso', unknownAuthor: 'Autor de Google'
    }
};
export const googleReviewsCopy = language => copy[language] || copy.en;
