const PLACEHOLDER_IMAGE_PATTERNS = [
    /images\.unsplash\.com/i,
    /photo-1566073771259-6a8506099945/i,
    /33036666\.jpg/i,
    /35165972\.jpg/i
];
const SUPPLIER_IMAGE_SIZE = '1920x1080';
const SUPPLIER_IMAGE_HOST = 'cdn.worldota.net';
const IMAGE_PRESETS = {
    card: {
        sizes: '(max-width: 767px) 88vw, (max-width: 1279px) 25vw, 360px',
        fallbackDimensions: [640, 480]
    },
    room: {
        sizes: '(max-width: 1023px) 100vw, 25vw',
        fallbackDimensions: [640, 480]
    },
    gallery: {
        sizes: '(max-width: 767px) 100vw, 50vw',
        fallbackDimensions: [1280, 720]
    }
};

function rawImageValue(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return value.url || value.src || value.image || value.photo || value.source || '';
}

function imageRecord(value) {
    if (typeof value === 'string') return { url: value };
    if (!value || typeof value !== 'object') return { url: '' };
    return value;
}

export function isPlaceholderImage(value) {
    const raw = rawImageValue(value).trim();
    return !raw || PLACEHOLDER_IMAGE_PATTERNS.some(pattern => pattern.test(raw));
}

export function normalizeImageUrl(value) {
    const raw = rawImageValue(value).trim();
    if (!raw || isPlaceholderImage(raw)) return '';

    let image = raw.replace(/\{size\}/gi, SUPPLIER_IMAGE_SIZE);
    if (image.startsWith('//')) return `https:${image}`;
    if (/^https?:\/\//i.test(image)) {
        try {
            const url = new URL(image);
            if (/\.(?:worldota|ratehawk)\.net$/i.test(url.hostname)) {
                url.hostname = 'cdn.worldota.net';
                return url.toString();
            }
        } catch {
            return '';
        }
        return image;
    }

    if (/^t\/\d+x\d+\//i.test(image)) return `https://${SUPPLIER_IMAGE_HOST}/${image.replace(/^\/+/, '')}`;
    const path = image.replace(/^\/+/, '');
    return `https://${SUPPLIER_IMAGE_HOST}/${path}`;
}

function dimensionsFromUrl(url) {
    const match = String(url).match(/(?:\/t\/|\/)(\d+)x(\d+)(?=\/|\?|$)/i);
    return match ? [Number(match[1]), Number(match[2])] : null;
}

function dimensionsFor(value, url, fallback) {
    const record = imageRecord(value);
    const width = Number(record.width ?? record.w);
    const height = Number(record.height ?? record.h);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) return [width, height];
    return dimensionsFromUrl(url) || fallback;
}

function variantValues(value) {
    const record = imageRecord(value);
    const variants = record.srcSet || record.srcset || record.variants || record.sources || [];
    if (Array.isArray(variants)) return variants;
    if (variants && typeof variants === 'object') return Object.values(variants);
    return [];
}

function formatPictureSources(value) {
    const record = imageRecord(value);
    return ['avif', 'webp'].flatMap(format => {
        const candidate = record[format] || record[`${format}Url`];
        const src = normalizeImageUrl(candidate);
        return src ? [{ type: `image/${format}`, srcSet: src }] : [];
    });
}

function normalizeVariant(value) {
    const url = normalizeImageUrl(value);
    if (!url) return null;
    const [width, height] = dimensionsFor(value, url, [0, 0]);
    return width > 0 && height > 0 ? { url, width, height } : null;
}

function resizeSupplierImage(url, width, height) {
    // Kept private for backwards-compatible imports in generated bundles; responsive
    // variants are no longer synthesized from a single source URL.
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== SUPPLIER_IMAGE_HOST) return url;
        parsed.pathname = parsed.pathname.replace(/\/t\/\d+x\d+(?=\/)/i, `/t/${width}x${height}`);
        return parsed.toString();
    } catch {
        return url;
    }
}

export function responsiveImageSources(value, purpose = 'card') {
    const src = normalizeImageUrl(value);
    if (!src) return null;

    const preset = IMAGE_PRESETS[purpose] || IMAGE_PRESETS.card;
    const dimensions = dimensionsFor(value, src, preset.fallbackDimensions);
    const variants = variantValues(value).map(normalizeVariant).filter(Boolean);
    const uniqueVariants = [...new Map(variants.map(variant => [`${variant.url}|${variant.width}`, variant])).values()]
        .filter(variant => variant.url !== src)
        .sort((first, second) => first.width - second.width);

    return {
        src,
        srcSet: uniqueVariants.length ? uniqueVariants.map(variant => `${variant.url} ${variant.width}w`).join(', ') : undefined,
        sizes: uniqueVariants.length ? preset.sizes : undefined,
        width: dimensions[0],
        height: dimensions[1],
        sources: formatPictureSources(value)
    };
}

function collectImageValues(value, result) {
    if (Array.isArray(value)) {
        value.forEach(item => collectImageValues(item, result));
        return;
    }
    if (value && typeof value === 'object' && !rawImageValue(value).trim()) {
        Object.values(value).forEach(item => collectImageValues(item, result));
        return;
    }
    const image = normalizeImageUrl(value);
    if (image) result.push(image);
}

export function collectImages(...values) {
    const images = [];
    values.forEach(value => collectImageValues(value, images));
    return [...new Set(images)];
}

export function roomCardImages(roomImages = [], propertyPhotoImages = []) {
    const supplierImages = Array.isArray(roomImages) ? roomImages : [];
    const propertyImages = Array.isArray(propertyPhotoImages) ? propertyPhotoImages : [];
    const propertyFallbackImages = propertyImages.filter(image => !supplierImages.includes(image));
    return [
        ...supplierImages.map(url => ({ url, isPropertyPhoto: false })),
        ...propertyFallbackImages.map(url => ({ url, isPropertyPhoto: true }))
    ];
}

function roomGroupId(value) {
    const id = [value?.room_group_id, value?.id]
        .find(candidate => candidate !== undefined && candidate !== null && String(candidate).trim() !== '');
    return id === undefined ? null : String(id);
}

function roomGroupMatches(rate, group) {
    if (!rate || !group) return false;

    const rateId = roomGroupId(rate.room_group) ?? roomGroupId(rate);
    const groupId = roomGroupId(group);
    return rateId !== null && groupId !== null && rateId === groupId;
}

export function roomImagesForRate(rate = {}, hotel = {}) {
    const directImages = collectImages(
        rate.images,
        rate.images_ext,
        rate.room_images,
        rate.room_data?.images,
        rate.room_data?.images_ext,
        rate.room?.images,
        rate.room?.images_ext,
        rate.room_info?.images,
        rate.room_info?.images_ext,
        rate.room_group?.images,
        rate.room_group?.images_ext,
        rate.room_group_data?.images,
        rate.room_group_data?.images_ext
    );
    if (directImages.length) return directImages;

    const staticData = hotel.staticData || {};
    const roomGroupValues = [
        ...(Array.isArray(hotel.room_groups) ? hotel.room_groups : []),
        ...(Array.isArray(hotel.rooms) ? hotel.rooms : []),
        ...(Array.isArray(staticData.room_groups) ? staticData.room_groups : []),
        ...(Array.isArray(staticData.rooms) ? staticData.rooms : [])
    ];
    const roomGroups = roomGroupValues.length
        ? roomGroupValues
        : Object.values(hotel.room_groups || staticData.room_groups || {}).filter(Boolean);
    const group = roomGroups.find(candidate => roomGroupMatches(rate, candidate));
    return group ? collectImages(group.images, group.images_ext) : [];
}

export function hotelImages(hotel = {}) {
    const staticData = hotel.staticData || {};
    return collectImages(
        hotel.images,
        hotel.images_ext,
        hotel.image,
        staticData.images,
        staticData.images_ext,
        staticData.image
    );
}