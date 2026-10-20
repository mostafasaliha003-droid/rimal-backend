import { useLanguage } from '../i18n';

const content = {
    ar: {
        privacy: 'سياسة الخصوصية', terms: 'شروط الاستخدام', home: 'العودة للرئيسية', contact: 'للاستفسارات وطلبات الخصوصية',
        dataTitle: 'بيانات الحجز والتواصل', data: 'نعالج بيانات الحساب وبيانات النزلاء والتواصل اللازمة لإدارة الحجز والدعم. تُشارك بيانات الحجز اللازمة مع مورد الإقامة، وتعالج بوابة الدفع بيانات الدفع اللازمة لإتمام العملية.',
        googleTitle: 'تقييمات Google Maps', google: 'عند طلب عرض التقييمات، يتصل خادم رمال بخدمة Google Places API باستخدام اسم الفندق وموقعه ومُعرّفه. لا نرسل اسم صاحب الحجز أو بريده أو تفاصيل حجزه ضمن طلب التقييمات. تُحفظ مُعرّفات الأماكن لربط الفنادق؛ لا نحفظ نصوص مراجعات Google أو درجاتها في قاعدة بياناتنا.',
        external: 'قد يتلقى Google عنوان IP وبيانات المتصفح عند تحميل صورة كاتب المراجعة أو فتح رابط Google. يُطبّق على استخدام خدمات Google أيضًا سياسة خصوصية Google وشروط خدماتها.',
        bookingTitle: 'العروض والحجوزات', booking: 'تخضع الأسعار والتوفر للتحقق قبل إتمام الحجز. تُعرض شروط الوجبات والإلغاء والرسوم لكل عرض، وتُراجع قبل الموافقة والدفع. لا تؤكد العودة من بوابة الدفع وحدها تأكيد الحجز.',
        reviewsTitle: 'محتوى مراجعات النزلاء', reviews: 'تقييمات Google محتوى من مصدر خارجي. تعرض الخدمة عينة تختارها Google حسب الصلة، وقد تترجمها إلى لغة العرض. لا تُعد المراجعة إثباتًا لإقامة أو حجز عبر رمال، ولا تمثل وعدًا بجودة إقامة محددة.',
        googleTerms: 'باستخدام ميزات Google Maps على هذا الموقع، تسري أيضًا شروط خدمة Google Maps / Google Earth وسياسة خصوصية Google.',
        privacyLink: 'سياسة خصوصية Google', termsLink: 'شروط خدمة Google Maps / Google Earth'
    },
    en: {
        privacy: 'Privacy policy', terms: 'Terms of use', home: 'Back to home', contact: 'Questions and privacy requests',
        dataTitle: 'Booking and contact information', data: 'We process account, guest and contact information needed to manage bookings and customer support. Necessary booking information is shared with the accommodation supplier. The payment gateway processes payment information needed to complete the transaction.',
        googleTitle: 'Google Maps reviews', google: 'When you request reviews, Remal’s server contacts Google Places API using the hotel name, location and place identifier. We do not send the booking customer’s name, email or booking details with review requests. Place identifiers are stored to link hotels; Google review text and ratings are not stored in our database.',
        external: 'Google may receive your IP address and browser information when a review author’s image loads or you open a Google link. Google’s Privacy Policy and terms also apply to the use of Google services.',
        bookingTitle: 'Offers and reservations', booking: 'Prices and availability are rechecked before booking. Meal, cancellation and fee conditions are displayed for each offer and reviewed before consent and payment. Returning from a payment gateway alone does not confirm a reservation.',
        reviewsTitle: 'Guest review content', reviews: 'Google reviews are third-party content. The service displays a selection chosen by Google in relevance order and may translate it into the display language. A review does not verify a stay or booking through Remal and does not guarantee a particular stay experience.',
        googleTerms: 'Your use of Google Maps features on this website is also subject to the Google Maps / Google Earth Additional Terms of Service and the Google Privacy Policy.',
        privacyLink: 'Google Privacy Policy', termsLink: 'Google Maps / Google Earth Terms'
    },
    es: {
        privacy: 'Política de privacidad', terms: 'Condiciones de uso', home: 'Volver al inicio', contact: 'Consultas y solicitudes de privacidad',
        dataTitle: 'Información de reservas y contacto', data: 'Tratamos la información de cuenta, huéspedes y contacto necesaria para gestionar reservas y asistencia. Compartimos los datos necesarios con el proveedor del alojamiento. La pasarela procesa la información necesaria para completar el pago.',
        googleTitle: 'Reseñas de Google Maps', google: 'Al solicitar reseñas, el servidor de Remal consulta Google Places API con el nombre, ubicación e identificador del hotel. No enviamos el nombre, correo ni detalles de reserva del cliente en estas consultas. Guardamos identificadores de lugares para vincular hoteles, pero no textos ni puntuaciones de Google en nuestra base de datos.',
        external: 'Google puede recibir tu dirección IP e información del navegador al cargar la imagen de un autor o abrir un enlace a Google. También se aplican la Política de Privacidad y las condiciones de Google.',
        bookingTitle: 'Ofertas y reservas', booking: 'Se verifican precios y disponibilidad antes de reservar. Las condiciones de comidas, cancelación y cargos se muestran en cada oferta para revisarlas antes de aceptar y pagar. Volver de la pasarela de pago no confirma por sí solo la reserva.',
        reviewsTitle: 'Contenido de las reseñas', reviews: 'Las reseñas de Google son contenido de terceros. Google selecciona una muestra por relevancia y puede traducirla al idioma mostrado. Una reseña no acredita una estancia o reserva a través de Remal ni garantiza una experiencia concreta.',
        googleTerms: 'El uso de las funciones de Google Maps de este sitio también está sujeto a las Condiciones adicionales de Google Maps / Google Earth y a la Política de Privacidad de Google.',
        privacyLink: 'Política de Privacidad de Google', termsLink: 'Condiciones de Google Maps / Google Earth'
    }
};

export default function LegalPage({ kind }) {
    const { language, direction } = useLanguage();
    const copy = content[language] || content.en;
    const privacy = kind === 'privacy';
    return <main dir={direction} className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <a href={`/?lang=${language}`} className="text-sm font-bold text-blue-700 hover:underline">{copy.home}</a>
        <article className="mt-8 space-y-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <h1 className="text-3xl font-black text-slate-900">{copy[kind]}</h1>
            {[[privacy ? copy.dataTitle : copy.bookingTitle, privacy ? copy.data : copy.booking], [privacy ? copy.googleTitle : copy.reviewsTitle, privacy ? copy.google : copy.reviews]].map(([title, text]) => <section key={title}><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="mt-3 text-sm leading-8 text-slate-600">{text}</p></section>)}
            <section className="space-y-4 border-t border-slate-200 pt-6"><p className="text-sm leading-8 text-slate-600">{privacy ? copy.external : copy.googleTerms}</p><ul className="space-y-3 text-sm font-bold text-blue-700"><li><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">{copy.privacyLink}</a></li><li><a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer" className="underline">{copy.termsLink}</a></li></ul></section>
            <p className="break-words text-sm leading-8 text-slate-600">{copy.contact}: <a href="mailto:management@remaltourismllc.com" className="font-bold text-blue-700 underline">management@remaltourismllc.com</a></p>
        </article>
    </main>;
}
