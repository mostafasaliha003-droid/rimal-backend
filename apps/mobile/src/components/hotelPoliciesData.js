const copy = {
    en: { title: 'Hotel policies and important information', extra: 'Additional information', item: 'Policy', missing: 'Not specified', yes: 'Yes', no: 'No',
        deposit: 'Deposits', internet: 'Internet', meal: 'Meals', children: 'Children', children_meal: 'Children’s meals', cot: 'Cots', extra_bed: 'Extra beds', pets: 'Pets', parking: 'Parking', shuttle: 'Transfers', visa: 'Visa support', no_show: 'No-show policy', check_in_check_out: 'Check-in and check-out', add_fee: 'Additional fees',
        price: 'Price', amount: 'Quantity', currency: 'Currency', inclusion: 'Price inclusion', availability: 'Availability', type: 'Type', payment_type: 'Payment method', pricing_method: 'Calculation', age_start: 'Minimum age', age_end: 'Maximum age', time: 'Time (hotel local time)', check_in: 'Check-in', check_out: 'Check-out', visa_support: 'Visa support',
        deposit_type: 'Deposit type', internet_type: 'Connection', meal_type: 'Meal', price_unit: 'Price basis', work_area: 'Coverage', pets_type: 'Pet weight', territory_type: 'Location', destination_type: 'Destination', shuttle_type: 'Journey', fee_type: 'Service', check_in_check_out_type: 'Service', day_period: 'Time period', age_range: 'Children’s ages', years: 'years', currency_missing: 'Currency not specified' },
    ar: { title: 'سياسات الفندق ومعلومات مهمة', extra: 'معلومات إضافية', item: 'البند', missing: 'غير محدد', yes: 'نعم', no: 'لا',
        deposit: 'التأمينات', internet: 'الإنترنت', meal: 'الوجبات', children: 'الأطفال', children_meal: 'وجبات الأطفال', cot: 'أسرّة الأطفال', extra_bed: 'الأسرّة الإضافية', pets: 'الحيوانات الأليفة', parking: 'مواقف السيارات', shuttle: 'خدمات النقل', visa: 'دعم التأشيرة', no_show: 'سياسة عدم الحضور', check_in_check_out: 'تسجيل الوصول والمغادرة', add_fee: 'رسوم إضافية',
        price: 'السعر', amount: 'العدد', currency: 'العملة', inclusion: 'الشمول في السعر', availability: 'التوفر', type: 'النوع', payment_type: 'طريقة الدفع', pricing_method: 'طريقة الاحتساب', age_start: 'الحد الأدنى للعمر', age_end: 'الحد الأقصى للعمر', time: 'الوقت (بتوقيت الفندق المحلي)', check_in: 'تسجيل الوصول', check_out: 'تسجيل المغادرة', visa_support: 'دعم التأشيرة',
        deposit_type: 'نوع التأمين', internet_type: 'الاتصال', meal_type: 'الوجبة', price_unit: 'أساس السعر', work_area: 'نطاق التغطية', pets_type: 'وزن الحيوان الأليف', territory_type: 'الموقع', destination_type: 'الوجهة', shuttle_type: 'الرحلة', fee_type: 'الخدمة', check_in_check_out_type: 'الخدمة', day_period: 'الفترة', age_range: 'أعمار الأطفال', years: 'سنوات', currency_missing: 'العملة غير محددة' },
    es: { title: 'Políticas del hotel e información importante', extra: 'Información adicional', item: 'Punto', missing: 'Sin especificar', yes: 'Sí', no: 'No',
        deposit: 'Depósitos', internet: 'Internet', meal: 'Comidas', children: 'Niños', children_meal: 'Comidas para niños', cot: 'Cunas', extra_bed: 'Camas adicionales', pets: 'Mascotas', parking: 'Aparcamiento', shuttle: 'Traslados', visa: 'Asistencia para visados', no_show: 'No presentación', check_in_check_out: 'Entrada y salida', add_fee: 'Cargos adicionales',
        price: 'Precio', amount: 'Cantidad', currency: 'Moneda', inclusion: 'Inclusión en el precio', availability: 'Disponibilidad', type: 'Tipo', payment_type: 'Forma de pago', pricing_method: 'Cálculo', age_start: 'Edad mínima', age_end: 'Edad máxima', time: 'Hora (hora local del hotel)', check_in: 'Entrada', check_out: 'Salida', visa_support: 'Asistencia para visados',
        deposit_type: 'Tipo de depósito', internet_type: 'Conexión', meal_type: 'Comida', price_unit: 'Base del precio', work_area: 'Cobertura', pets_type: 'Peso de la mascota', territory_type: 'Ubicación', destination_type: 'Destino', shuttle_type: 'Trayecto', fee_type: 'Servicio', check_in_check_out_type: 'Servicio', day_period: 'Periodo', age_range: 'Edades de los niños', years: 'años', currency_missing: 'Moneda sin especificar' }
};

// Meanings are from the ETG Content API schema, not inferred from prices or
// room availability. Unknown values remain visible rather than being guessed.
// https://docs.emergingtravel.com/docs/content-api/retrieve-hotels-content-by-ids/
const propertyValues = {
    unspecified: ['Not specified', 'غير محدد', 'Sin especificar'],
    available: ['Available', 'متاح', 'Disponible'], unavailable: ['Unavailable', 'غير متاح', 'No disponible'],
    included: ['Included in the price', 'مشمول في السعر', 'Incluido en el precio'],
    not_included: ['Not included in the price', 'غير مشمول في السعر', 'No incluido en el precio'],
    cash: ['Cash', 'نقداً', 'Efectivo'], card: ['Card', 'بطاقة', 'Tarjeta'],
    fixed: ['Fixed amount', 'مبلغ ثابت', 'Importe fijo'], percent: ['Percentage', 'نسبة مئوية', 'Porcentaje'],
    pet: ['For pets', 'للحيوانات الأليفة', 'Para mascotas'], breakage: ['For damage', 'ضد الأضرار', 'Por daños'], keys: ['For keys', 'للمفاتيح', 'Para llaves'],
    damage: ['For damage', 'ضد الأضرار', 'Por daños'], per_stay: ['per stay', 'لكل إقامة', 'por estancia'],
    wireless: ['Wi-Fi', 'واي فاي', 'Wifi'], wired: ['Wired internet', 'إنترنت سلكي', 'Internet por cable'],
    hotel: ['Throughout the hotel', 'في جميع أنحاء الفندق', 'En todo el hotel'], room: ['In the room', 'داخل الغرفة', 'En la habitación'],
    whole_hotel: ['Throughout the hotel', 'في جميع أنحاء الفندق', 'En todo el hotel'],
    lt_5kg: ['Less than 5 kg', 'أقل من 5 كغ', 'Menos de 5 kg'], gt_5kg: ['More than 5 kg', 'أكثر من 5 كغ', 'Más de 5 kg'],
    on_side: ['On site', 'داخل الموقع', 'En el establecimiento'], off_side: ['Off site', 'خارج الموقع', 'Fuera del establecimiento'],
    airport: ['Airport', 'المطار', 'Aeropuerto'], train: ['Train station', 'محطة القطار', 'Estación de tren'], ship: ['Port', 'الميناء', 'Puerto'], airport_train: ['Airport / train station', 'المطار / محطة القطار', 'Aeropuerto / estación de tren'],
    one_way: ['One way', 'اتجاه واحد', 'Solo ida'], two_ways: ['Round trip', 'ذهاب وعودة', 'Ida y vuelta'],
    support_enable: ['Visa support available', 'دعم التأشيرة متاح', 'Asistencia para visados disponible'],
    before_midday: ['AM (before noon)', 'صباحاً (قبل الظهر)', 'AM (antes del mediodía)'], after_midday: ['PM (after noon)', 'مساءً (بعد الظهر)', 'PM (después del mediodía)'],
    early_checkin: ['Early check-in', 'تسجيل وصول مبكر', 'Entrada anticipada'], late_checkin: ['Late check-in', 'تسجيل وصول متأخر', 'Entrada tardía'], late_checkout: ['Late check-out', 'تسجيل مغادرة متأخر', 'Salida tardía'],
    holiday_checkin: ['Check-in on holidays', 'تسجيل الوصول في العطلات', 'Entrada en días festivos'], holiday_checkout: ['Check-out on holidays', 'تسجيل المغادرة في العطلات', 'Salida en días festivos'],
    per_guest_per_night: ['per guest per night', 'لكل ضيف لكل ليلة', 'por huésped y noche'], per_guest_per_stay: ['per guest per stay', 'لكل ضيف لكل إقامة', 'por huésped y estancia'],
    per_room_per_night: ['per room per night', 'لكل غرفة لكل ليلة', 'por habitación y noche'], per_room_per_stay: ['per room per stay', 'لكل غرفة لكل إقامة', 'por habitación y estancia'],
    per_car_per_night: ['per car per night', 'لكل سيارة لكل ليلة', 'por coche y noche'], per_car_per_stay: ['per car per stay', 'لكل سيارة لكل إقامة', 'por coche y estancia'],
    per_hour: ['per hour', 'لكل ساعة', 'por hora'], per_week: ['per week', 'لكل أسبوع', 'por semana'],
    television: ['Television', 'التلفاز', 'Televisión'], towels: ['Towels', 'المناشف', 'Toallas'], conditioning: ['Air conditioning', 'تكييف الهواء', 'Aire acondicionado'],
    housekeeping: ['Housekeeping', 'خدمة التنظيف', 'Limpieza'], heating: ['Heating', 'التدفئة', 'Calefacción'], refrigerator: ['Refrigerator', 'الثلاجة', 'Frigorífico'],
    utility: ['Utilities', 'المرافق', 'Suministros'], safe: ['Safe', 'الخزنة', 'Caja fuerte'], microwave: ['Microwave', 'الميكروويف', 'Microondas'],
    luggage_storage: ['Luggage storage', 'حفظ الأمتعة', 'Consigna de equipaje'], tour_guide: ['Tour guide', 'مرشد سياحي', 'Guía turístico'], bicycle_rental: ['Bicycle rental', 'تأجير الدراجات', 'Alquiler de bicicletas'],
    baby_highchair: ['Baby high chair', 'كرسي طعام للأطفال', 'Trona'], bed_linen: ['Bed linen', 'بياضات الأسرّة', 'Ropa de cama'], towels_only: ['Towels only', 'المناشف فقط', 'Solo toallas'],
    luggage_storage_apartment: ['Luggage storage at the apartment', 'حفظ الأمتعة في الشقة', 'Consigna en el apartamento'], luggage_storage_office: ['Luggage storage at the office', 'حفظ الأمتعة في المكتب', 'Consigna en la oficina'],
};
const meals = {
    'all-inclusive': ['All inclusive', 'شامل كلياً', 'Todo incluido'], breakfast: ['Breakfast', 'الإفطار', 'Desayuno'], 'breakfast-buffet': ['Breakfast buffet', 'بوفيه إفطار', 'Desayuno bufé'],
    'continental-breakfast': ['Continental breakfast', 'إفطار كونتيننتال', 'Desayuno continental'], dinner: ['Dinner', 'العشاء', 'Cena'], 'full-board': ['Full board', 'إقامة مع ثلاث وجبات', 'Pensión completa'],
    'half-board': ['Half board', 'إقامة مع وجبتين', 'Media pensión'], lunch: ['Lunch', 'الغداء', 'Almuerzo'], nomeal: ['No meals', 'بدون وجبات', 'Sin comidas'], 'some-meal': ['Some meals', 'بعض الوجبات', 'Algunas comidas'],
    'english-breakfast': ['English breakfast', 'إفطار إنجليزي', 'Desayuno inglés'], 'american-breakfast': ['American breakfast', 'إفطار أمريكي', 'Desayuno americano'],
    'asian-breakfast': ['Asian breakfast', 'إفطار آسيوي', 'Desayuno asiático'], 'chinese-breakfast': ['Chinese breakfast', 'إفطار صيني', 'Desayuno chino'],
    'israeli-breakfast': ['Israeli breakfast', 'إفطار إسرائيلي', 'Desayuno israelí'], 'japanese-breakfast': ['Japanese breakfast', 'إفطار ياباني', 'Desayuno japonés'],
    'scandinavian-breakfast': ['Scandinavian breakfast', 'إفطار إسكندنافي', 'Desayuno escandinavo'], 'scottish-breakfast': ['Scottish breakfast', 'إفطار اسكتلندي', 'Desayuno escocés'],
    'breakfast-for-1': ['Breakfast for 1', 'إفطار لشخص واحد', 'Desayuno para 1'], 'breakfast-for-2': ['Breakfast for 2', 'إفطار لشخصين', 'Desayuno para 2'],
    'super-all-inclusive': ['Super all inclusive', 'شامل كلياً سوبر', 'Súper todo incluido'], 'soft-all-inclusive': ['Soft all inclusive', 'شامل كلياً سوفت', 'Todo incluido soft'],
    'ultra-all-inclusive': ['Ultra all inclusive', 'شامل كلياً ألترا', 'Ultra todo incluido'], 'half-board-lunch': ['Half board with lunch', 'نصف إقامة مع الغداء', 'Media pensión con almuerzo'], 'half-board-dinner': ['Half board with dinner', 'نصف إقامة مع العشاء', 'Media pensión con cena']
};

const enumCopy = { ...propertyValues, ...meals };

export function translatedMeal(value, language) {
    const code = value.trim().toLowerCase().replace(/_/g, '-');
    if (!Object.hasOwn(meals, code)) return null;
    return meals[code][language === 'ar' ? 1 : language === 'es' ? 2 : 0];
}

export const hotelPolicyCopy = language => copy[language] || copy.en;

function readableLabel(value, language) {
    return hotelPolicyCopy(language)[value] || copy.en[value]
        || policyPlainText(value).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, initial => initial.toUpperCase());
}

// Preserve supplier wording as text. Never execute supplier HTML in a policy.
export function policyPlainText(value) {
    if (typeof value !== 'string') return '';
    const entities = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'" };
    return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<\s*br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|nbsp|quot|apos);/gi, (entity, key) => {
            if (key[0] !== '#') return entities[key.toLowerCase()] || entity;
            const code = Number.parseInt(key.slice(/^#x/i.test(key) ? 2 : 1), /^#x/i.test(key) ? 16 : 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
        }).trim();
}

function policyValue(value, language, translateEnum = false) {
    const labels = hotelPolicyCopy(language);
    if (value === null || value === undefined || value === '') return labels.missing;
    if (typeof value === 'boolean') return value ? labels.yes : labels.no;
    const text = policyPlainText(String(value));
    // A supplier may send a simple plural of a known value ('rooms' for 'room'); it reads the same.
    const known = Object.hasOwn(enumCopy, text) ? text : /s$/.test(text) && Object.hasOwn(enumCopy, text.slice(0, -1)) ? text.slice(0, -1) : null;
    if (translateEnum && known) return enumCopy[known][language === 'ar' ? 1 : language === 'es' ? 2 : 0];
    return /^[a-z]+(?:_[a-z0-9]+)+$/.test(text) ? text.replace(/_/g, ' ') : text;
}

const enumFields = new Set(['availability', 'inclusion', 'deposit_type', 'payment_type', 'pricing_method', 'internet_type', 'meal_type', 'work_area', 'pets_type', 'territory_type', 'destination_type', 'shuttle_type', 'fee_type', 'check_in_check_out_type', 'extra_bed', 'visa_support', 'day_period', 'price_unit', 'type']);
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);

function policyRows(value, language, path = [], source = []) {
    if (Array.isArray(value)) return value.flatMap((entry, index) => policyRows(entry, language,
        [...path, `${hotelPolicyCopy(language).item} ${index + 1}`], [...source, index]));
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) =>
        policyRows(entry, language, [...path, readableLabel(key, language)], [...source, key]));
    return [{ label: path.join(' · '), value: policyValue(value, language, enumFields.has(source.at(-1))), fields: [source] }];
}

function entryRows(entry, language) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return policyRows(entry, language);
    const labels = hotelPolicyCopy(language);
    const consumed = new Set();
    const rows = [];
    const has = key => Object.hasOwn(entry, key) && scalar(entry[key]);
    // Keep the supplier's original numeric text. Do not convert currencies,
    // infer a fee, or turn an unspecified price/availability into "free".
    if (has('price')) {
        const fields = ['price', 'currency', 'price_unit', 'pricing_method'].filter(has);
        const price = policyValue(entry.price, language);
        const isPercent = entry.pricing_method === 'percent' && entry.price !== null && entry.price !== '' && /^\d+(?:\.\d+)?$/.test(String(entry.price));
        const parts = [isPercent ? `${price}%` : price];
        if (has('currency')) {
            const currency = policyValue(entry.currency, language);
            if (isPercent) parts.push(`${labels.currency}: ${currency}`);
            else if (entry.currency === null || entry.currency === '') parts.push(labels.currency_missing);
            else parts[0] += ` ${currency}`;
        }
        if (has('price_unit')) parts.push(policyValue(entry.price_unit, language, true));
        if (has('pricing_method') && !isPercent) parts.push(policyValue(entry.pricing_method, language, true));
        rows.push({ label: labels.price, value: parts.join(' · '), fields: fields.map(key => [key]), emphasis: true,
            segments: parts.map((text, index) => ({ text, direction: index === 0 && /^-?\d+(?:\.\d+)?$/.test(String(entry.price)) ? 'ltr' : 'auto' })), separator: ' · ' });
        fields.forEach(key => consumed.add(key));
    }
    if (has('age_start') && has('age_end') && entry.age_start !== null && entry.age_end !== null && entry.age_start !== '' && entry.age_end !== '') {
        const range = `${policyValue(entry.age_start, language)}–${policyValue(entry.age_end, language)}`;
        rows.push({ label: labels.age_range, value: `${range} ${labels.years}`, fields: [['age_start'], ['age_end']],
            segments: [{ text: range, direction: 'ltr' }, { text: labels.years, direction: 'auto' }], separator: ' ' });
        consumed.add('age_start'); consumed.add('age_end');
    }
    for (const [key, value] of Object.entries(entry)) {
        if (!consumed.has(key)) rows.push(...policyRows(value, language, [readableLabel(key, language)], [key]));
    }
    return rows;
}

export function hotelPolicySections(hotel = {}, language = 'en') {
    const source = [hotel.metapolicy_struct, hotel.staticData?.metapolicy_struct]
        .find(value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) || {};
    // Each supplier object is one readable entry. Unknown policy types and
    // nested leaves are still displayed; only genuinely empty containers omit.
    return Object.entries(source).map(([key, value]) => {
        const entries = (Array.isArray(value) ? value : [value]).map(entry => ({ rows: entryRows(entry, language) })).filter(entry => entry.rows.length);
        return { key, title: readableLabel(key, language), entries, rows: entries.flatMap(entry => entry.rows) };
    }).filter(section => section.entries.length);
}

export function hotelExtraInformation(hotel = {}) {
    return policyPlainText(hotel.metapolicy_extra_info || hotel.staticData?.metapolicy_extra_info || '');
}
