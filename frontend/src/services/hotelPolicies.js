const copy = {
    en: { title: 'Hotel policies and important information', extra: 'Additional information', item: 'Item', missing: 'Not specified', yes: 'Yes', no: 'No',
        deposit: 'Deposits', internet: 'Internet', meal: 'Meals', children: 'Children', children_meal: 'Children’s meals', cot: 'Cots', extra_bed: 'Extra beds', pets: 'Pets', parking: 'Parking', shuttle: 'Transfers', visa: 'Visa support', no_show: 'No-show policy', check_in_check_out: 'Check-in and check-out', add_fee: 'Additional fees',
        price: 'Price', amount: 'Amount', currency: 'Currency', inclusion: 'Included in the price', availability: 'Availability', type: 'Type', payment_type: 'Payment method', pricing_method: 'Pricing method', age_start: 'Minimum age', age_end: 'Maximum age', time: 'Time', check_in: 'Check-in', check_out: 'Check-out', visa_support: 'Visa support' },
    ar: { title: 'سياسات الفندق ومعلومات مهمة', extra: 'معلومات إضافية', item: 'البند', missing: 'غير محدد', yes: 'نعم', no: 'لا',
        deposit: 'التأمينات', internet: 'الإنترنت', meal: 'الوجبات', children: 'الأطفال', children_meal: 'وجبات الأطفال', cot: 'أسرّة الأطفال', extra_bed: 'الأسرّة الإضافية', pets: 'الحيوانات الأليفة', parking: 'مواقف السيارات', shuttle: 'خدمات النقل', visa: 'دعم التأشيرة', no_show: 'سياسة عدم الحضور', check_in_check_out: 'تسجيل الوصول والمغادرة', add_fee: 'رسوم إضافية',
        price: 'السعر', amount: 'المبلغ', currency: 'العملة', inclusion: 'مشمول في السعر', availability: 'التوفر', type: 'النوع', payment_type: 'طريقة الدفع', pricing_method: 'طريقة التسعير', age_start: 'الحد الأدنى للعمر', age_end: 'الحد الأقصى للعمر', time: 'الوقت', check_in: 'تسجيل الوصول', check_out: 'تسجيل المغادرة', visa_support: 'دعم التأشيرة' },
    es: { title: 'Políticas del hotel e información importante', extra: 'Información adicional', item: 'Punto', missing: 'Sin especificar', yes: 'Sí', no: 'No',
        deposit: 'Depósitos', internet: 'Internet', meal: 'Comidas', children: 'Niños', children_meal: 'Comidas para niños', cot: 'Cunas', extra_bed: 'Camas adicionales', pets: 'Mascotas', parking: 'Aparcamiento', shuttle: 'Traslados', visa: 'Asistencia para visados', no_show: 'No presentación', check_in_check_out: 'Entrada y salida', add_fee: 'Cargos adicionales',
        price: 'Precio', amount: 'Importe', currency: 'Moneda', inclusion: 'Incluido en el precio', availability: 'Disponibilidad', type: 'Tipo', payment_type: 'Forma de pago', pricing_method: 'Método de cálculo', age_start: 'Edad mínima', age_end: 'Edad máxima', time: 'Hora', check_in: 'Entrada', check_out: 'Salida', visa_support: 'Asistencia para visados' }
};

export const hotelPolicyCopy = language => copy[language] || copy.en;

function readableLabel(value, language) {
    return hotelPolicyCopy(language)[value] || copy.en[value]
        || value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, initial => initial.toUpperCase());
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

function policyValue(value, language) {
    const labels = hotelPolicyCopy(language);
    if (value === null || value === undefined || value === '') return labels.missing;
    if (typeof value === 'boolean') return value ? labels.yes : labels.no;
    const text = policyPlainText(String(value));
    return /^[a-z]+(?:_[a-z0-9]+)+$/.test(text) ? text.replace(/_/g, ' ') : text;
}

function policyRows(value, language, path = []) {
    if (Array.isArray(value) && value.length) return value.flatMap((entry, index) => policyRows(entry, language,
        [...path, `${hotelPolicyCopy(language).item} ${index + 1}`]));
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
        return Object.entries(value).flatMap(([key, entry]) => policyRows(entry, language, [...path, readableLabel(key, language)]));
    }
    return [{ label: path.join(' · '), value: policyValue(value && typeof value === 'object' ? null : value, language) }];
}

export function hotelPolicySections(hotel = {}, language = 'en') {
    const source = [hotel.metapolicy_struct, hotel.staticData?.metapolicy_struct]
        .find(value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) || {};
    // Walk all supplied fields, including future policy types and nested fields.
    return Object.entries(source).map(([key, value]) => ({
        key, title: readableLabel(key, language), rows: policyRows(value, language)
    }));
}

export function hotelExtraInformation(hotel = {}) {
    return policyPlainText(hotel.metapolicy_extra_info || hotel.staticData?.metapolicy_extra_info || '');
}
