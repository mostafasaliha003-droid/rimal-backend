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
    return [...new Set([hotel.normalizedSupplierName, ...aliases, ...translatedNames].filter(Boolean))];
}

function scoreHotel(query, hotel) {
    const names = candidateNames(hotel);
    const distance = Math.min(...names.map(name => {
        const words = name.split(' ');
        return query.split(' ').reduce((total, queryWord) => total + Math.min(...words.map(word => {
            if (word === queryWord) return 0;
            if (word.startsWith(queryWord)) return 0.1;
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

    const prefix = normalized.slice(0, Math.min(3, normalized.length));
    const tokens = hotelSearchTokens(normalized);
    const queryBranches = [
        { normalizedSupplierName: { $regex: `^${escapeRegex(prefix)}` } },
        { 'searchAliases.normalized': { $regex: `^${escapeRegex(prefix)}` }, 'searchAliases.reviewStatus': 'approved' },
        ...['ar', 'en', 'es'].map(code => ({
            [`translations.${code}.name`]: { $regex: `^${escapeRegex(prefix)}`, $options: 'i' },
            [`translations.${code}.reviewStatus`]: 'approved'
        }))
    ];
    if (tokens.length) {
        queryBranches.push(
            { searchTokens: { $in: tokens } },
            { translationSearchTokens: { $in: tokens } }
        );
    }

    const documents = await Hotel.find({
        provider: 'ratehawk',
        deleted: { $ne: true },
        'staticData.deleted': { $ne: true },
        $or: queryBranches
    }).select({ hid: 1, hotelId: 1, name: 1, city: 1, address: 1, translations: 1, searchAliases: 1, normalizedSupplierName: 1 })
        .limit(500).lean();

    return documents.map(hotel => ({ hotel, score: scoreHotel(normalized, hotel) }))
        .filter(entry => entry.score !== null)
        .sort((first, second) => first.score - second.score || String(first.hotel.name || '').localeCompare(String(second.hotel.name || '')))
        .slice(0, limit).map(({ hotel }) => {
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

module.exports = { normalizeHotelSearchText, hotelSearchTokens, editDistance, findHotelSuggestions, buildSearchAlias };