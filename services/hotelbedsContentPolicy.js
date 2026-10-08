const MAX_PUBLIC_CONTENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_HOST = 'photos.hotelbeds.com';
const SAFE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_SIZES = new Set(['standard', 'small', 'medium', 'bigger', 'xl', 'xxl']);

function validContentDate(value, nowMs) {
    const date = new Date(value).getTime();
    return Number.isFinite(date) && date <= nowMs && nowMs - date <= MAX_PUBLIC_CONTENT_AGE_MS;
}

function isVerifiedHotelbedsContent(hotel, { hotelCode, language, now = new Date(), requireCategory = true } = {}) {
    const content = hotel?.content;
    const nowMs = new Date(now).getTime();
    const rowCode = String(hotel?.contentHotelCode ?? '');
    const sourceCode = String(hotel?.code ?? hotel?.hotelCode ?? '');
    const contentLanguage = String(hotel?.contentLanguage ?? '').toUpperCase();
    const expectedLanguage = String(language ?? hotel?.contentLanguage ?? '').toUpperCase();
    const name = typeof content?.name === 'string' ? content.name.trim() : '';
    const categoryName = typeof content?.category?.name === 'string' ? content.category.name.trim() : '';

    return hotel?.contentSource === 'hotelbeds_content_api'
        && Number.isSafeInteger(nowMs)
        && Boolean(rowCode) && rowCode === sourceCode
        && (hotelCode === undefined || rowCode === String(hotelCode))
        && Boolean(expectedLanguage) && contentLanguage === expectedLanguage
        && content?.contentStatus === 'complete'
        && Boolean(name) && (!requireCategory || Boolean(categoryName))
        && validContentDate(hotel.contentSyncedAt, nowMs);
}

function safeRelativeImagePath(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 500) return null;
    const path = value.trim();
    if (path.startsWith('/') || path.startsWith('\\') || path.includes('\\')
        || /[\u0000-\u001f\u007f]/.test(path) || /[?#]/.test(path)
        || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return null;
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return null; }
    if (decoded.includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(decoded)
        || decoded.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null;
    if (decoded.split('/').some(segment => /^mock(?:[-_]|$)/i.test(segment))) return null;
    const extension = decoded.slice(decoded.lastIndexOf('.')).toLowerCase();
    if (!SAFE_IMAGE_EXTENSIONS.has(extension)) return null;
    return path;
}

function safeCategoryName(value) {
    const name = boundedText(value, 100);
    if (!name || /\bstar(?:s)?\b/i.test(name)) return name;
    return name;
}

function hotelbedsImageUrl(value, size = 'standard') {
    const path = safeRelativeImagePath(value);
    if (!path || !IMAGE_SIZES.has(size)) return null;
    const sizePath = size === 'standard' ? '' : `${size}/`;
    return `https://${IMAGE_HOST}/giata/${sizePath}${path}`;
}

function publicImages(images, { roomCode, includeRoomSpecific = false, maxImages = 12, size = 'bigger' } = {}) {
    if (!Array.isArray(images) || !Number.isSafeInteger(maxImages) || maxImages < 1 || maxImages > 20
        || !IMAGE_SIZES.has(size)) return [];
    return images.filter(image => {
        const candidateRoom = typeof image?.roomCode === 'string' ? image.roomCode.trim() : '';
        return !candidateRoom || roomCode && candidateRoom === roomCode || includeRoomSpecific;
    }).map(image => {
        const url = hotelbedsImageUrl(image?.path, size);
        const order = image?.visualOrder ?? image?.order;
        if (!url || !Number.isSafeInteger(order) || order < 0 || order > 1000) return null;
        return { url, visualOrder: order, roomCode: image?.roomCode || null };
    }).filter(Boolean).sort((left, right) => left.visualOrder - right.visualOrder).slice(0, maxImages);
}

function boundedText(value, maxLength) {
    const text = typeof value === 'string' ? value.trim() : typeof value?.content === 'string' ? value.content.trim() : '';
    return text && text.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
        ? text : null;
}

function publicFacilities(facilities) {
    if (!Array.isArray(facilities)) return [];
    return facilities.slice(0, 100).flatMap(facility => {
        const description = boundedText(facility?.description, 300);
        if (!description || facility?.voucher !== true) return [];
        const fee = typeof facility.indFee === 'boolean' ? facility.indFee : null;
        const amount = Number.isFinite(Number(facility.amount)) && Number(facility.amount) >= 0
            ? String(facility.amount) : null;
        const currency = typeof facility.currency === 'string' && /^[A-Z]{3}$/.test(facility.currency)
            ? facility.currency : null;
        return [{ description, fee, amount: fee === true && currency ? amount : null,
            currency: fee === true ? currency : null, present: typeof facility.indYesOrNo === 'boolean' ? facility.indYesOrNo : null }];
    });
}

function issueApplies(issue, checkIn, checkOut) {
    const dateFrom = typeof issue?.dateFrom === 'string' ? issue.dateFrom.slice(0, 10) : null;
    const dateTo = typeof issue?.dateTo === 'string' ? issue.dateTo.slice(0, 10) : null;
    if (!dateFrom && !dateTo) return true;
    if (!checkIn || !checkOut) return false;
    return (!dateFrom || dateFrom <= checkOut) && (!dateTo || dateTo >= checkIn);
}

function projectVerifiedHotelContent(hotel, { hotelCode, language, now = new Date(), roomCode, checkIn, checkOut } = {}) {
    if (!isVerifiedHotelbedsContent(hotel, { hotelCode, language, now })) return null;
    const content = hotel.content;
    return {
        name: boundedText(content.name, 200),
        category: {
            code: boundedText(content.category?.code, 40),
            name: safeCategoryName(content.category?.name)
        },
        description: boundedText(content.description, 4000),
        images: publicImages(content.images).filter(image => !image.roomCode),
        roomImages: publicImages(content.images, { includeRoomSpecific: true }).filter(image => Boolean(image.roomCode)
            && (!roomCode || image.roomCode === roomCode)),
        facilities: publicFacilities(content.facilities),
        issues: Array.isArray(content.issues)
            ? content.issues.filter(issue => issueApplies(issue, checkIn, checkOut))
                .slice(0, 30).map(issue => boundedText(issue?.description ?? issue, 1000)).filter(Boolean)
            : []
    };
}

module.exports = {
    MAX_PUBLIC_CONTENT_AGE_MS,
    IMAGE_HOST,
    IMAGE_SIZES,
    isVerifiedHotelbedsContent,
    hotelbedsImageUrl,
    publicImages,
    publicFacilities,
    projectVerifiedHotelContent,
    issueApplies,
    safeRelativeImagePath,
    boundedText
};