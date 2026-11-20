/**
 * Arabic names for RateHawk room names. ETG normalizes room names into one English
 * pattern: "[N Bedrooms] [class…] [occupancy] <type> [with …] (beds) (notes)".
 * A name is translated only when every part is understood, so guests never see a
 * half-translated mix; hotel brand words (e.g. "Avani") stay as written.
 * The supplier's English name remains the booking identity everywhere else.
 */
type Gender = 'm' | 'f';
type Word = string | { m: string; f: string };

const NOUNS: Readonly<Record<string, { ar: string; g: Gender }>> = {
  'studio room': { ar: 'استوديو', g: 'm' }, 'junior suite': { ar: 'جناح جونيور', g: 'm' }, 'room': { ar: 'غرفة', g: 'f' },
  'suite': { ar: 'جناح', g: 'm' }, 'studio': { ar: 'استوديو', g: 'm' }, 'apartment': { ar: 'شقة', g: 'f' },
  'apartments': { ar: 'شقة', g: 'f' }, 'villa': { ar: 'فيلا', g: 'f' }, 'bungalow': { ar: 'بنغالو', g: 'm' },
  'chalet': { ar: 'شاليه', g: 'm' }, 'cottage': { ar: 'كوخ', g: 'm' }, 'penthouse': { ar: 'بنتهاوس', g: 'm' },
  'loft': { ar: 'لوفت', g: 'm' }, 'duplex': { ar: 'دوبلكس', g: 'm' }, 'house': { ar: 'منزل', g: 'm' },
  'townhouse': { ar: 'تاون هاوس', g: 'm' }, 'cabin': { ar: 'كابينة', g: 'f' }, 'tent': { ar: 'خيمة', g: 'f' },
  'dormitory': { ar: 'مهجع', g: 'm' }, 'bed in dormitory': { ar: 'سرير في مهجع', g: 'm' }, 'capsule': { ar: 'كبسولة', g: 'f' },
};

const ADJECTIVES: Readonly<Record<string, Word>> = {
  standard: { m: 'قياسي', f: 'قياسية' }, double: { m: 'مزدوج', f: 'مزدوجة' }, single: { m: 'فردي', f: 'فردية' },
  triple: { m: 'ثلاثي', f: 'ثلاثية' }, quadruple: { m: 'رباعي', f: 'رباعية' }, family: { m: 'عائلي', f: 'عائلية' },
  classic: { m: 'كلاسيكي', f: 'كلاسيكية' }, economy: { m: 'اقتصادي', f: 'اقتصادية' }, executive: { m: 'تنفيذي', f: 'تنفيذية' },
  premium: { m: 'مميز', f: 'مميزة' }, luxury: { m: 'فاخر', f: 'فاخرة' }, panoramic: { m: 'بانورامي', f: 'بانورامية' },
  presidential: { m: 'رئاسي', f: 'رئاسية' }, royal: { m: 'ملكي', f: 'ملكية' }, basic: { m: 'أساسي', f: 'أساسية' },
  budget: { m: 'اقتصادي', f: 'اقتصادية' }, business: { m: 'لرجال الأعمال', f: 'لرجال الأعمال' }, 'non-smoking': { m: 'لغير المدخنين', f: 'لغير المدخنين' },
  deluxe: 'ديلوكس', superior: 'سوبيريور', junior: 'جونيور', premier: 'بريميير', club: 'كلوب', comfort: 'كومفورت',
  grand: 'جراند', twin: 'توأم', king: 'بسرير كينج', queen: 'بسرير كوين', elite: 'إيليت', signature: 'سيجنتشر',
};

const PLACES: Readonly<Record<string, string>> = {
  sea: 'البحر', river: 'النهر', city: 'المدينة', water: 'الماء', garden: 'الحديقة', pool: 'المسبح', mountain: 'الجبل',
  mountains: 'الجبال', lake: 'البحيرة', ocean: 'المحيط', park: 'المنتزه', marina: 'المرسى', courtyard: 'الفناء', creek: 'الخور',
  golf: 'ملعب الغولف', beach: 'الشاطئ', canal: 'القناة', harbour: 'الميناء', harbor: 'الميناء', skyline: 'أفق المدينة',
  'burj khalifa': 'برج خليفة', 'burj al arab': 'برج العرب', landmark: 'معلم شهير', fountain: 'النافورة', palm: 'النخلة',
};

const FEATURES: Readonly<Record<string, string>> = {
  balcony: 'شرفة', terrace: 'تراس', 'private pool': 'مسبح خاص', 'plunge pool': 'مسبح صغير خاص', kitchen: 'مطبخ',
  kitchenette: 'مطبخ صغير', jacuzzi: 'جاكوزي', 'hot tub': 'حوض استحمام ساخن', 'extra bed': 'سرير إضافي', 'sofa bed': 'أريكة سرير',
  fireplace: 'مدفأة', patio: 'فناء خاص', 'club access': 'دخول إلى صالة النادي', 'lounge access': 'دخول إلى الصالة',
  'beach access': 'دخول إلى الشاطئ', 'private beach access': 'دخول إلى شاطئ خاص', 'pool access': 'دخول مباشر إلى المسبح',
  'shared bathroom': 'حمام مشترك', 'private bathroom': 'حمام خاص', bathtub: 'حوض استحمام', 'sauna': 'ساونا', view: 'إطلالة',
};

const NOTES: Readonly<Record<string, string>> = {
  'full double bed': 'سرير مزدوج', 'double bed': 'سرير مزدوج', 'king size bed': 'سرير كينج', 'king bed': 'سرير كينج',
  'queen size bed': 'سرير كوين', 'queen bed': 'سرير كوين', 'single bed': 'سرير منفرد', 'twin beds': 'سريران منفردان',
  'sofa bed': 'أريكة سرير', 'bunk bed': 'سرير بطابقين', 'bunk beds': 'أسرّة بطابقين', 'extra bed': 'سرير إضافي',
  'shared bathroom': 'حمام مشترك', 'private bathroom': 'حمام خاص', smoking: 'للمدخنين', 'non-smoking': 'لغير المدخنين',
  'bed type is subject to availability': 'نوع السرير حسب التوفر', 'no window': 'بدون نافذة', 'no windows': 'بدون نوافذ',
  'window': 'مع نافذة', 'accessible': 'مجهزة لذوي الاحتياجات الخاصة', 'mobility accessible': 'مجهزة لذوي الاحتياجات الخاصة',
  'mixed dormitory': 'مهجع مختلط', 'female dormitory': 'مهجع للنساء', 'male dormitory': 'مهجع للرجال', 'room only': 'إقامة فقط',
};

const TRAILING: Readonly<Record<string, string>> = {
  beachfront: 'على الشاطئ', waterfront: 'على الواجهة المائية', oceanfront: 'على المحيط', seafront: 'على البحر',
  'sea view': 'مع إطلالة على البحر', 'city view': 'مع إطلالة على المدينة', 'pool view': 'مع إطلالة على المسبح',
  'garden view': 'مع إطلالة على الحديقة', 'river view': 'مع إطلالة على النهر', 'ocean view': 'مع إطلالة على المحيط',
  'partial sea view': 'مع إطلالة جزئية على البحر', 'marina view': 'مع إطلالة على المرسى', 'creek view': 'مع إطلالة على الخور',
  'burj khalifa view': 'مع إطلالة على برج خليفة', 'club access': 'مع دخول إلى صالة النادي', 'lake view': 'مع إطلالة على البحيرة', 'mountain view': 'مع إطلالة على الجبل',
};

function bedrooms(count: number) {
  if (count === 1) return 'بغرفة نوم واحدة';
  if (count === 2) return 'بغرفتي نوم';
  return count <= 10 ? `بـ${count} غرف نوم` : `بـ${count} غرفة نوم`;
}

function beds(count: number, kind: 'single' | 'double' | 'queen' | 'king') {
  const noun = { single: 'منفرد', double: 'مزدوج', queen: 'كوين', king: 'كينج' }[kind];
  if (count === 1) return `سرير ${noun}`;
  if (count === 2) return kind === 'single' || kind === 'double' ? `سريران ${noun === 'منفرد' ? 'منفردان' : 'مزدوجان'}` : `سريران ${noun}`;
  if (kind === 'single' || kind === 'double') return `${count} أسرّة ${kind === 'single' ? 'منفردة' : 'مزدوجة'}`;
  return `${count} أسرّة ${noun}`;
}

function view(phrase: string): string | null {
  const match = phrase.match(/^(partial |side |panoramic )?(.+?) views?$/);
  if (match) {
    const place = PLACES[match[2]];
    if (!place) return null;
    const kind = match[1]?.trim();
    return kind === 'partial' ? `إطلالة جزئية على ${place}` : kind === 'side' ? `إطلالة جانبية على ${place}`
      : kind === 'panoramic' ? `إطلالة بانورامية على ${place}` : `إطلالة على ${place}`;
  }
  return null;
}

function note(text: string): string | null {
  const phrase = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!phrase) return null;
  if (NOTES[phrase]) return NOTES[phrase];
  const counted = phrase.match(/^(\d{1,2}) (single|double|queen size|queen|king size|king) beds?$/);
  if (counted) return beds(Number(counted[1]), counted[2].split(' ')[0] as 'single' | 'double' | 'queen' | 'king');
  const viewed = view(phrase);
  if (viewed) return viewed;
  if (phrase.includes(' or ')) {
    const parts = phrase.split(' or ').map(note);
    return parts.every(Boolean) ? parts.join(' أو ') : null;
  }
  if (phrase.includes(' and ')) {
    const parts = phrase.split(' and ').map(note);
    return parts.every(Boolean) ? parts.join(' و') : null;
  }
  return null;
}

function feature(text: string): string | null {
  const phrase = text.trim().toLowerCase().replace(/^with /, '').replace(/\s+/g, ' ');
  return FEATURES[phrase] ?? view(phrase) ?? null;
}

const cache = new Map<string, string | null>();

/** Arabic room name, or null when any part of the supplier name is not understood. */
export function arabicRoomName(name: string): string | null {
  if (typeof name !== 'string' || !name.trim() || name.length > 200) return null;
  if (cache.has(name)) return cache.get(name)!;
  const result = translate(name.trim());
  if (cache.size > 500) cache.clear();
  cache.set(name, result);
  return result;
}

function translate(name: string): string | null {
  if (/\p{Script=Arabic}/u.test(name)) return name;
  const notes: string[] = [];
  let main = name.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    for (const part of inner.split(',')) {
      const translated = note(part);
      if (!translated) { notes.push('\u0000'); continue; }
      notes.push(translated);
    }
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  if (notes.includes('\u0000') || /[()]/.test(main)) return null;

  const withParts = main.split(/ with /i);
  main = withParts.shift()!.trim();
  const features: string[] = [];
  for (const clause of withParts.length ? withParts.join(' with ').split(/ and with | and /i) : []) {
    const translated = feature(clause);
    if (!translated) return null;
    features.push(translated);
  }

  let lower = main.toLowerCase();
  let rooms = '';
  const prefix = lower.match(/^(\d{1,2}) bedrooms? /);
  if (prefix) { rooms = bedrooms(Number(prefix[1])); lower = lower.slice(prefix[0].length); main = main.slice(prefix[0].length); }
  const trailing: string[] = [];
  for (const [english, arabic] of Object.entries(TRAILING).sort((a, b) => b[0].length - a[0].length)) {
    const at = lower.indexOf(english);
    if (at >= 0 && (at === 0 || lower[at - 1] === ' ') && (at + english.length === lower.length || lower[at + english.length] === ' ')) {
      trailing.push(arabic);
      lower = (lower.slice(0, at) + lower.slice(at + english.length)).replace(/\s+/g, ' ').trim();
      main = (main.slice(0, at) + main.slice(at + english.length)).replace(/\s+/g, ' ').trim();
    }
  }

  // The room type is the last noun phrase; everything before it describes it.
  const nounKeys = Object.keys(NOUNS).sort((a, b) => b.length - a.length);
  let noun: { ar: string; g: Gender } | null = null, nounAt = -1, nounLength = 0;
  for (const key of nounKeys) {
    const at = lower.lastIndexOf(key);
    if (at >= 0 && (at === 0 || lower[at - 1] === ' ') && at + key.length === lower.length) { noun = NOUNS[key]; nounAt = at; nounLength = key.length; break; }
  }
  if (!noun) {
    // "Double room" is sometimes written without the noun, e.g. "Deluxe Double".
    if (!lower) return null;
    noun = NOUNS.room; nounAt = lower.length; nounLength = 0;
  }
  const after = main.slice(nounAt + nounLength).trim();
  if (after) return null;
  const words = main.slice(0, nounAt).trim().split(/\s+/).filter(Boolean);
  const adjectives: string[] = [], brands: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    const adjective = ADJECTIVES[key];
    if (adjective) { adjectives.push(typeof adjective === 'string' ? adjective : adjective[noun.g]); continue; }
    if (/^[A-Z][A-Za-z'’-]{1,24}$/.test(word) && brands.length < 2) { brands.push(word); continue; }
    return null;
  }
  const head = [noun.ar, ...brands, ...adjectives, rooms, ...trailing].filter(Boolean).join(' ');
  const body = [head, ...features.map((value, index) => (index === 0 ? 'مع ' : 'و') + value)].join(' ');
  return notes.length ? `${body} (${notes.join('، ')})` : body;
}

/** Room name for display in the interface language. */
export function localizedRoomName(name: string, language: string): string {
  return language === 'ar' ? arabicRoomName(name) ?? name : name;
}
