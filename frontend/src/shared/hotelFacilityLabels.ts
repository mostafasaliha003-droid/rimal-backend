// Shared with the Mkhadda app (apps/mobile/src/components/hotelFacilityLabels.ts on the app branch); keep both copies identical.
const arabicNames: Record<string, string> = {
  internet: 'الإنترنت', recreation: 'الترفيه', general: 'خدمات عامة', rooms: 'الغرف',
  meals: 'الوجبات', transfer: 'النقل', parking: 'مواقف السيارات', sports: 'الرياضة',
  wellness: 'العناية والاستجمام', 'beauty and wellness': 'العناية والاستجمام',
  'pool and beach': 'المسبح والشاطئ', 'services and amenities': 'الخدمات والتجهيزات',
  accessibility: 'سهولة الوصول', 'languages spoken': 'اللغات المتاحة', business: 'خدمات الأعمال',
  tourist: 'خدمات سياحية', 'tourist services': 'خدمات سياحية', kids: 'الأطفال', pets: 'الحيوانات الأليفة',
  'health and safety measures': 'تدابير الصحة والسلامة', 'winter sports': 'الرياضات الشتوية',
  'wi-fi': 'واي فاي', wifi: 'واي فاي', 'wireless internet': 'إنترنت لاسلكي', 'wired internet': 'إنترنت سلكي',
  'internet access': 'اتصال بالإنترنت', 'in-room internet': 'إنترنت داخل الغرفة', 'wi-fi in rooms': 'واي فاي داخل الغرف',
  'wi-fi in public areas': 'واي فاي في الأماكن العامة', 'wi-fi in common areas': 'واي فاي في المساحات المشتركة',
  pool: 'مسبح', 'swimming pool': 'مسبح', 'indoor pool': 'مسبح داخلي', 'outdoor pool': 'مسبح خارجي',
  spa: 'سبا', massage: 'تدليك', sauna: 'ساونا', gym: 'صالة رياضية', 'fitness facilities': 'مرافق اللياقة البدنية',
  'airport shuttle': 'خدمة النقل من وإلى المطار', 'airport transportation': 'النقل من وإلى المطار',
  'air conditioning': 'تكييف الهواء', terrace: 'تراس', garden: 'حديقة', elevator: 'مصعد',
  'elevator/lift': 'مصعد', laundry: 'غسيل الملابس', restaurant: 'مطعم', breakfast: 'إفطار',
  'luggage storage': 'تخزين الأمتعة', 'non-smoking rooms': 'غرف لغير المدخنين', 'smoke-free property': 'منشأة خالية من التدخين',
  '24-hour reception': 'استقبال على مدار الساعة', heating: 'تدفئة', 'washing machine': 'غسالة ملابس',
  dishwasher: 'غسالة صحون', 'outdoor furniture': 'أثاث خارجي', fridge: 'ثلاجة', 'family room': 'غرفة عائلية',
  'smoke detector': 'كاشف دخان', tv: 'تلفزيون', hairdryer: 'مجفف شعر', 'shower/bathtub': 'دش أو حوض استحمام',
  shower: 'دش', toiletries: 'مستلزمات استحمام', 'wheelchair accessible': 'مهيّأ للكراسي المتحركة',
  'iron and board': 'مكواة ولوح كي', 'coffee/tea for guests': 'قهوة أو شاي للضيوف', kitchen: 'مطبخ',
  'microwave oven': 'ميكروويف', 'parking nearby': 'مواقف سيارات قريبة', 'next to the beach': 'بجوار الشاطئ',
};

function facilityKey(name: string) {
  return name.trim().toLowerCase().replace(/_/g, ' ').replace(/[‑–]/g, '-');
}

const knownFacilityNames = new Set([...Object.keys(arabicNames), ...Object.values(arabicNames)]);
for (const fact of ['next to the beach', 'smoke-free property', 'wheelchair accessible']) {
  knownFacilityNames.delete(fact);
  knownFacilityNames.delete(arabicNames[fact]);
}

// A supplier may list restrictions such as “No elevator” or “Spa on request”.
// For unfamiliar wording, keep the original line without an unconditional availability label.
export function canShowFacilityAvailability(name: string) {
  return knownFacilityNames.has(facilityKey(name));
}

export function facilityLabel(name: string, ar: boolean) {
  const clean = name.replace(/_/g, ' ').trim();
  const key = facilityKey(name);
  return ar && Object.hasOwn(arabicNames, key) ? arabicNames[key] : clean;
}
