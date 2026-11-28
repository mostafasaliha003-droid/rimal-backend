// The licensed company, exactly as on the licence. Shown in the site footer, Terms and
// Privacy Policy only; customer-facing brand text says Pillow Stays (مخدة).
export const COMPANY = Object.freeze({
    name: 'REMAL GROUP L.L.C-FZ',
    nameAr: 'مجموعة ريمال ش.ذ.م.م-منطقة حرة',
    licence: '2312342.01',
    address: 'Meydan Grandstand, 6th floor, Meydan Road, Nad Al Sheba, Dubai, UAE',
    mapQuery: 'Meydan Grandstand, Meydan Road, Nad Al Sheba, Dubai, UAE',
});

export const companyName = language => (language === 'ar' ? COMPANY.nameAr : COMPANY.name);

// "Pillow Stays · REMAL GROUP L.L.C-FZ · Licence 2312342.01 · Meydan Grandstand, …"
export function companyLine(language) {
    const licence = { ar: 'رخصة', es: 'Licencia' }[language] || 'Licence';
    return [language === 'ar' ? 'Pillow Stays | مخدة' : 'Pillow Stays', companyName(language), `${licence} ${COMPANY.licence}`, COMPANY.address].join(' · ');
}
