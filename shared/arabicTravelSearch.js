// Search-only spellings. Property names and IDs displayed to guests always come from inventory.
const arabicScript = /\p{Script=Arabic}/u;

function cleanTravelText(text) {
    return text.normalize('NFKC').replace(/[\u0640\p{M}]/gu, '').replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي').replace(/ک/g, 'ك').replace(/ی/g, 'ي')
        .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) % 16));
}

// Conventional English spellings for common loanwords and place names.
// Unlisted proper names retain all their letters through transliteration.
const spellings = new Map();
for (const [english, ...variants] of [
    ['Dubai','دبي'], ['Abu Dhabi','أبو ظبي','أبوظبي'], ['Ras Al Khaimah','رأس الخيمة'],
    ['Sharjah','الشارقة'], ['Ajman','عجمان'], ['Fujairah','الفجيرة'], ['Doha','الدوحة'],
    ['Riyadh','الرياض'], ['Jeddah','جدة','جده'], ['Makkah','مكة','مكه','مكة المكرمة'], ['Medina','المدينة المنورة'],
    ['Manama','المنامة'], ['Muscat','مسقط'], ['Kuwait','الكويت'], ['Cairo','القاهرة'], ['Alexandria','الإسكندرية'],
    ['Sharm El Sheikh','شرم الشيخ'], ['Hurghada','الغردقة'], ['Beirut','بيروت'],
    ['Marrakech','مراكش'], ['Casablanca','الدار البيضاء'], ['Tunis','تونس'],
    ['Istanbul','إسطنبول','إستانبول','اسطنبول','إستنبول'], ['Antalya','أنطاليا'], ['Bodrum','بودروم'],
    ['Paris','باريس'], ['London','لندن'], ['Berlin','برلين'], ['Munich','ميونخ'], ['Rome','روما'], ['Milan','ميلانو'],
    ['Madrid','مدريد'], ['Barcelona','برشلونة'], ['Vienna','فيينا'], ['Amsterdam','أمستردام'], ['Geneva','جنيف'],
    ['Athens','أثينا'], ['Prague','براغ'], ['Moscow','موسكو'], ['New York','نيويورك','نيو يورك'],
    ['Los Angeles','لوس أنجلوس'], ['Miami','ميامي'], ['Singapore','سنغافورة'], ['Bangkok','بانكوك'],
    ['Phuket','بوكيت'], ['Bali','بالي'], ['Kuala Lumpur','كوالالمبور','كوالا لمبور'], ['Tokyo','طوكيو'],
    ['Hong Kong','هونغ كونغ','هونج كونج'], ['Mumbai','مومباي'], ['Maldives','المالديف'],
    ['Burj Al Arab','برج العرب'], ['Ibn Battuta','ابن بطوطة'], ['Burj Khalifa','برج خليفة'], ['Jumeirah','جميرا','جميرة'], ['Palm','بالم','النخلة','نخلة'],
    // Arabic words for the English words that appear in property names.
    ['Creek','الخور'], ['Beach','شاطئ','الشاطئ'], ['Island','جزيرة'],
    ['Atlantis','أتلانتس','أتلانتيس','اتلانتس'], ['Hilton','هيلتون','هلتون'], ['Marriott','ماريوت','ماريوط'],
    ['Sheraton','شيراتون','شرتون'], ['Hyatt','حياة','حياه','هايات'], ['Grand','جراند','غراند'],
    ['Rotana','روتانا'], ['Radisson','راديسون','راديسن'], ['Blu','بلو'], ['Four Seasons','فور سيزونز','فورسيزونز','فور سيزون'],
    ['Holiday Inn','هوليداي إن','هوليدي إن'], ['Ritz Carlton','ريتز كارلتون','ريتز كارلتن'], ['Carlton','كارلتون'],
    ['InterContinental','إنتركونتيننتال','إنتركونتننتال','إنتر كونتيننتال'], ['Crowne Plaza','كراون بلازا'],
    ['Novotel','نوفوتيل'], ['Ibis','إيبيس','إبيس'], ['Sofitel','سوفيتيل'], ['Pullman','بولمان'],
    ['Fairmont','فيرمونت'], ['Raffles','رافلز'], ['Mövenpick','موفنبيك','موفينبيك'],
    ['Ramada','رامادا'], ['Wyndham','ويندام','ويندهام'], ['Westin','ويستن'], ['Kempinski','كمبينسكي'],
    ['Mandarin Oriental','ماندارين أورينتال'], ['Shangri La','شانغريلا','شانغري لا'], ['Luxury','لاكشري'],
    ['Suites','سويتس'], ['Resort','ريزورت'], ['Palace','بالاس'], ['Beach','بيتش'],
    ['Marina','مارينا'], ['Creek','كريك'], ['Downtown','داون تاون','داونتاون'], ['Plaza','بلازا'],
    ['Park','بارك'], ['Inn','إن'], ['City','سيتي'], ['Bay','باي'], ['Residence','ريزيدنس'],
]) {
    for (const name of variants) spellings.set(cleanTravelText(name), english);
}

const roman = {
    ا:'a', ب:'b', ت:'t', ث:'th', ج:'j', ح:'h', خ:'kh', د:'d', ذ:'dh', ر:'r', ز:'z',
    س:'s', ش:'sh', ص:'s', ض:'d', ط:'t', ظ:'z', ع:'a', غ:'gh', ف:'f', ق:'q', ك:'k',
    ل:'l', م:'m', ن:'n', ه:'h', ة:'a', و:'o', ي:'i', ؤ:'o', ئ:'i', ء:'', پ:'p', چ:'ch', ژ:'zh', گ:'g', ڤ:'v',
};

function englishTravelQuery(query) {
    if (typeof query !== 'string' || query.length > 160 || !arabicScript.test(query)) return null;
    let words = cleanTravelText(query).match(/[\p{L}\p{N}]+/gu) || [];
    // These words introduce the search. Keep equivalent words inside proper names.
    if (words.length > 1 && ['فندق','فنادق','الفنادق','منتجع','منتجعات','شقق','هوتيل'].includes(words[0])) words = words.slice(1);
    if (words.length > 1 && ['في','بمدينة','بمنطقة'].includes(words[0])) words = words.slice(1);
    const result = [];
    for (let i = 0; i < words.length;) {
        const phrase = words.slice(i,i+2).join(' ');
        if (i + 1 < words.length && spellings.has(phrase)) {
            result.push(spellings.get(phrase)); i += 2;
        } else {
            const word = words[i++];
            result.push(spellings.get(word) || [...word].map(letter => roman[letter] ?? letter).join(''));
        }
    }
    const search = result.join(' ').trim();
    return search.length >= 2 && search.length <= 160 && !arabicScript.test(search) ? search : null;
}
module.exports = { cleanTravelText, englishTravelQuery };
