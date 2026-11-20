const { cleanTravelText, englishTravelQuery } = require('../shared/arabicTravelSearch');

const ARABIC_TO_LATIN = {
    ا: 'a', أ: 'a', إ: 'a', آ: 'a', ٱ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh',
    د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z',
    ع: '', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a',
    و: 'w', ؤ: 'w', ي: 'y', ى: 'a', ئ: 'y', ء: '', ـ: ''
};

function normalizeHotelSearchText(value) {
    if (typeof value !== 'string') return '';
    const withoutMarks = value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
    const transliterated = [...withoutMarks.toLowerCase()]
        .map(character => ARABIC_TO_LATIN[character] ?? character).join('');
    return transliterated.replace(/[y]/g, 'i').replace(/[wo]/g, 'u')
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function hotelSearchTokens(value) {
    const normalized = normalizeHotelSearchText(value).replace(/\s+/g, '');
    if (normalized.length < 3) return normalized ? [normalized] : [];
    return [...new Set(Array.from({ length: normalized.length - 2 }, (_, index) => normalized.slice(index, index + 3)))];
}

// Arabic spells foreign names by their consonants, so «أتلانتس ذا بالم» and
// "Atlantis The Palm" share one skeleton (tlnts t blm). Arabic queries are first
// romanized by englishTravelQuery; both sides then lose vowels, silent letters
// and the sound distinctions Arabic does not write (p/b, v/f, g/j, z/s, c/k).
function soundSkeletonWords(value) {
    if (typeof value !== 'string') return [];
    const latin = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return latin.split(' ').filter(Boolean).map(word => word
        .replace(/tsh|tch|sch|ch|sh/g, 's').replace(/ph/g, 'f').replace(/[td]h/g, 't').replace(/zh/g, 's')
        .replace(/kh|ck|qu/g, 'k').replace(/gh/g, 'j').replace(/x/g, 'ks')
        .replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/g/g, 'j').replace(/p/g, 'b')
        .replace(/v/g, 'f').replace(/z/g, 's').replace(/[aeiouyhw]/g, '').replace(/(.)\1+/g, '$1'))
        .filter(Boolean);
}

// One key per word start, so a guest may begin with any word of the name.
function hotelSoundKeys(name) {
    const words = soundSkeletonWords(name);
    const keys = words.map((_, index) => words.slice(index).join('').slice(0, 48)).filter(key => key.length >= 2);
    return [...new Set(keys)].slice(0, 8);
}

// Query words as skeletons. Arabic attaches the article (السيف = Al Seef, البرشاء =
// Al Barsha), so a word may match with or without its leading l.
function arabicSoundQuery(query) {
    const english = englishTravelQuery(query);
    const words = english ? soundSkeletonWords(english).slice(0, 8) : [];
    return words.some(word => word.length >= 3) ? words : null;
}

function soundLookup(words) {
    const starts = [...new Set(words.flatMap(word => word.startsWith('l') && word.length > 3 ? [word, word.slice(1)] : [word])
        .filter(word => word.length >= 3))];
    return starts.length ? { soundKeys: { $in: starts.map(word => new RegExp('^' + word)) } } : null;
}

// Query words must appear in order as the starts of name words (spanning words
// when Arabic joins them), then the city. Name words the guest leaves out are
// skipped. One longer query word may go unmatched (e.g. "St." written as سانت) when
// two others match, but never a short one such as a city (دبي): another city's
// hotel, or one missing the brand the guest typed, must not match.
function soundScore(words, hotel) {
    if (!words) return null;
    const nameWords = [...soundSkeletonWords(hotel.name), ...soundSkeletonWords(hotel.city)];
    // The name as one string; a query word starts at a word boundary or continues
    // where the previous one stopped (سيتي ماكس = Citymax).
    const joined = nameWords.join('');
    const boundaries = [];
    for (let index = 0, position = 0; index < nameWords.length; position += nameWords[index++].length) boundaries.push(position);
    let position = 0, unmatched = 0, skipped = 0, strong = 0, continued = false;
    for (const word of words) {
        const variants = word.startsWith('l') && word.length > 2 ? [word, word.slice(1)] : [word];
        let match = null;
        for (const variant of variants) {
            if (continued && joined.startsWith(variant, position)) { match = { start: position, variant }; break; }
        }
        for (const start of boundaries) {
            if (match || start < position) continue;
            const variant = variants.find(candidate => joined.startsWith(candidate, start));
            if (variant) match = { start, variant };
        }
        if (!match) {
            if (word.length < 3) return null;
            unmatched += 1;
            continue;
        }
        skipped += boundaries.filter(start => start >= position && start < match.start).length;
        position = match.start + match.variant.length;
        continued = !boundaries.includes(position) && position < joined.length;
        if (word.length >= 3) strong += 1;
    }
    if (!strong || unmatched > (strong >= 2 ? 1 : 0)) return null;
    // Ranks after exact spellings; fewer skipped and leftover words rank first.
    const leftover = boundaries.filter(start => start >= position).length;
    return 0.5 + unmatched * 0.2 + skipped * 0.02 + leftover * 0.005;
}

function editDistance(left, right) {
    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
        const current = [row];
        for (let column = 1; column <= right.length; column += 1) {
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
            );
        }
        previous = current;
    }
    return previous[right.length];
}

function candidateNames(hotel) {
    const aliases = (Array.isArray(hotel.searchAliases) ? hotel.searchAliases : [])
        .filter(alias => alias?.reviewStatus === 'approved')
        .map(alias => alias.normalized || normalizeHotelSearchText(alias.value));
    const translations = hotel.translations instanceof Map
        ? Object.fromEntries(hotel.translations)
        : hotel.translations || {};
    const translatedNames = Object.values(translations)
        .filter(translation => translation?.name && translation.reviewStatus === 'approved')
        .map(translation => normalizeHotelSearchText(translation.name));
    const name = hotel.normalizedSupplierName || normalizeHotelSearchText(hotel.name);
    const names = [name, ...aliases, ...translatedNames].filter(Boolean);
    if (name && hotel.city) names.push(name + ' ' + normalizeHotelSearchText(hotel.city));
    return [...new Set(names)];
}

function scoreHotel(query, hotel) {
    const names = candidateNames(hotel);
    const distance = Math.min(...names.map(name => {
        const words = name.split(' ');
        return query.split(' ').reduce((total, queryWord) => total + Math.min(...words.map(word => {
            if (word === queryWord) return 0;
            if (word.startsWith(queryWord)) return 0.1;
            if (queryWord.length <= 2) return Infinity;
            return editDistance(queryWord, word);
        })), 0);
    }), Infinity);
    return distance <= (query.length < 5 ? 1 : 2) ? distance : null;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findHotelSuggestions(query, { Hotel, language = 'en', limit = 5 } = {}) {
    const normalized = normalizeHotelSearchText(query);
    if (normalized.length < 2 || normalized.length > 160 || !Hotel || typeof Hotel.find !== 'function') return [];

    const english = englishTravelQuery(query);
    const queries = [...new Set([normalized, normalizeHotelSearchText(english)].filter(Boolean))];
    const tokens = [...new Set(queries.flatMap(hotelSearchTokens))];
    const firstWord = english?.split(' ')[0];
    const rawNames = [...new Set([query.trim(), cleanTravelText(query.trim()), english,
        firstWord?.length >= 3 ? firstWord : null].filter(Boolean))];
    const prefixes = queries.flatMap(value => [
        { normalizedSupplierName: { $regex: '^'+escapeRegex(value) } },
        { searchAliases: { $elemMatch: { normalized: { $regex: '^'+escapeRegex(value) }, reviewStatus: 'approved' } } },
    ]);
    for (const raw of rawNames) {
        const regex = { $regex: '^'+escapeRegex(raw) };
        prefixes.push({name: regex}, {'translations.ar.name': regex, 'translations.ar.reviewStatus': 'approved'});
    }
    const soundWords = arabicSoundQuery(query);
    const soundBranch = soundWords && soundLookup(soundWords);
    if (soundBranch) prefixes.push(soundBranch);
    // Exact prefixes and localized names get a separate candidate window: common
    // trigrams in a large inventory must not crowd out the property actually typed.
    const find = branches => Hotel.find({
        provider: 'ratehawk',
        deleted: { $ne: true },
        'staticData.deleted': { $ne: true },
        $or: branches
    }).select({ hid: 1, hotelId: 1, name: 1, city: 1, address: 1, translations: 1, searchAliases: 1, normalizedSupplierName: 1, soundKeys: 1 })
        .limit(500).maxTimeMS(1200).lean();
    let direct;
    try {
        direct = await find(prefixes);
    } catch (error) {
        // A collection still building its prefix indexes can use the existing trigram indexes.
        if (error.code !== 50) throw error;
        direct = [];
    }
    const ranked = documents => documents.map(hotel => {
        const scores = [...queries.map(value => scoreHotel(value, hotel)), soundScore(soundWords, hotel)]
            .filter(score => score !== null);
        return { hotel, score: scores.length ? Math.min(...scores) : null };
    })
        .filter(entry => entry.score !== null)
        .sort((a,b) => a.score - b.score || String(a.hotel.name || '').localeCompare(String(b.hotel.name || '')));
    const directMatches = ranked(direct);
    let fuzzy = [];
    if (directMatches.length < limit && tokens.length) {
        try {
            fuzzy = ranked(await find([{ searchTokens: { $in: tokens } }, { translationSearchTokens: { $in: tokens } }]));
        } catch (error) {
            if (!directMatches.length || error.code !== 50) throw error;
        }
    }
    const ordered = [...directMatches,...fuzzy];
    const seen = new Set();
    return ordered.filter(({ hotel }) => {
        const hid = String(hotel.hid || '');
        if (!/^\d+$/.test(hid) || seen.has(hid)) return false;
        seen.add(hid);
        return true;
    }).slice(0, limit).map(({ hotel }) => {
            const translations = hotel.translations instanceof Map
                ? Object.fromEntries(hotel.translations)
                : hotel.translations || {};
            const translation = translations[language];
            const approved = translation?.reviewStatus === 'approved' ? translation : null;
            return {
                id: hotel.hotelId || hotel.hid,
                hid: hotel.hid,
                hotel_id: hotel.hid,
                name: approved?.name || hotel.name,
                city: approved?.city || hotel.city || '',
                address: approved?.address || hotel.address || '',
                type: 'hotel',
                source: 'local',
                resolvedLanguage: approved?.name ? language : 'en'
            };
        }).filter(hotel => typeof hotel.name === 'string' && hotel.name.trim());
}

function buildSearchAlias(value, { language = 'en', source = 'editorial', reviewStatus = 'pending', reviewedAt, editor } = {}) {
    const normalized = normalizeHotelSearchText(value);
    if (typeof value !== 'string' || !value.trim() || !normalized) throw new TypeError('A non-empty searchable alias is required');
    if (!['ar', 'en', 'es'].includes(language)) throw new TypeError('Unsupported search alias language');
    if (!['editorial', 'machine'].includes(source)) throw new TypeError('Unsupported search alias source');
    if (!['pending', 'approved', 'rejected'].includes(reviewStatus)) throw new TypeError('Unsupported search alias review status');
    return {
        value: value.trim(), normalized, language, source, reviewStatus,
        ...(reviewedAt ? { reviewedAt } : {}),
        ...(editor ? { editor } : {})
    };
}

module.exports = { normalizeHotelSearchText, hotelSearchTokens, hotelSoundKeys, arabicSoundQuery, soundScore, editDistance, findHotelSuggestions, buildSearchAlias };
