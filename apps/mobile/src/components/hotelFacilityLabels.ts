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
};

export function facilityLabel(name: string, ar: boolean) {
  const clean = name.replace(/_/g, ' ').trim();
  return (ar && arabicNames[clean.toLowerCase().replace(/[‑–]/g, '-')]) || clean;
}
