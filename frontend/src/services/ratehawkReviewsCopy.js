const strings = {
    ar: {
        title:'تقييمات النزلاء', eyebrow:'تجارب تساعدك على الاختيار', source:'المصدر: RateHawk', intro:'آراء النزلاء التي يوفّرها مورد الإقامة لهذا الفندق.',
        loading:'نحمّل تقييمات النزلاء…', checking:'ننتظر استجابة المورد. يمكنك متابعة استعراض الغرف.',
        empty:'لم يوفّر المورد مراجعات لهذا الفندق حتى الآن.', emptyHint:'يمكنك الاطلاع على تفاصيل الغرف والمرافق وشروط الإقامة قبل اختيار عرضك.',
        unavailable:'تعذّر تحميل المراجعات حاليًا. يمكنك متابعة استعراض عروض الإقامة.', retry:'إعادة المحاولة', more:'عرض المزيد من المراجعات',
        outOf:'من 10', average:'متوسط المراجعات المتاحة', count:'مراجعة متاحة', numeric:'المتوسط محسوب من {{count}} تقييم رقمي متاح.',
        positive:'ما أعجب النزيل', negative:'ما يمكن تحسينه', author:'نزيل', nights:'عدد الليالي', excerpt:'مقتطف من المراجعة',
        notice:'نعرض المراجعات التي أرسلها المورد، بدءًا بالأحدث. لا تعني المراجعة حجزًا عبر رمال.',
        sandbox:'بيئة الاختبار', sandboxHint:'قد يختلف توفر المراجعات ومحتواها في البيئة الفعلية.', language:'لغة المراجعات: الإنجليزية',
        capped:'يعرض هذا القسم أحدث 200 مراجعة متاحة من المورد.', expand:'قراءة المزيد', collapse:'عرض أقل', google:'مصدر إضافي: Google Maps',
        cleanness:'النظافة', location:'الموقع', price:'القيمة مقابل السعر', services:'الخدمة', room:'الغرفة', meal:'الوجبات'
    },
    en: {
        title:'Guest reviews', eyebrow:'Experiences to help you choose', source:'Source: RateHawk', intro:'Guest feedback supplied by the accommodation provider for this hotel.',
        loading:'Loading guest reviews…', checking:'Waiting for the provider. You can keep exploring room offers.',
        empty:'The provider has not supplied reviews for this hotel yet.', emptyHint:'Explore room details, facilities and stay conditions before choosing your offer.',
        unavailable:'Reviews could not be loaded right now. You can keep exploring room offers.', retry:'Try again', more:'Show more reviews',
        outOf:'out of 10', average:'Average of available reviews', count:'available reviews', numeric:'Average calculated from {{count}} available numeric ratings.',
        positive:'What the guest liked', negative:'What could be improved', author:'Guest', nights:'Nights', excerpt:'Review excerpt',
        notice:'Reviews are supplied by the provider and shown newest first. They do not imply a booking through Remal.',
        sandbox:'Sandbox', sandboxHint:'Review availability and content may differ in the live environment.', language:'Review language: English',
        capped:'This section shows the latest 200 available provider reviews.', expand:'Read more', collapse:'Show less', google:'Additional source: Google Maps',
        cleanness:'Cleanliness', location:'Location', price:'Value for money', services:'Service', room:'Room', meal:'Meals'
    },
    es: {
        title:'Opiniones de huéspedes', eyebrow:'Experiencias para ayudarte a elegir', source:'Fuente: RateHawk', intro:'Opiniones sobre este hotel facilitadas por el proveedor del alojamiento.',
        loading:'Cargando opiniones…', checking:'Esperando al proveedor. Puedes seguir consultando las habitaciones.',
        empty:'El proveedor todavía no ha facilitado opiniones sobre este hotel.', emptyHint:'Consulta las habitaciones, instalaciones y condiciones antes de elegir.',
        unavailable:'No se pudieron cargar las opiniones. Puedes seguir consultando las ofertas.', retry:'Reintentar', more:'Ver más opiniones',
        outOf:'de 10', average:'Promedio de opiniones disponibles', count:'opiniones disponibles', numeric:'Promedio de {{count}} puntuaciones numéricas disponibles.',
        positive:'Lo que gustó al huésped', negative:'Aspectos mejorables', author:'Huésped', nights:'Noches', excerpt:'Extracto de la opinión',
        notice:'Opiniones facilitadas por el proveedor, de más reciente a más antigua. No implican una reserva a través de Remal.',
        sandbox:'Entorno de pruebas', sandboxHint:'La disponibilidad y el contenido pueden variar en producción.', language:'Idioma de las opiniones: inglés',
        capped:'Se muestran las últimas 200 opiniones disponibles del proveedor.', expand:'Leer más', collapse:'Ver menos', google:'Fuente adicional: Google Maps',
        cleanness:'Limpieza', location:'Ubicación', price:'Relación calidad-precio', services:'Servicio', room:'Habitación', meal:'Comidas'
    }
};
export const ratehawkReviewsCopy = language => strings[language] || strings.en;
