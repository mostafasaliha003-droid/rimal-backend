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
        variants: [[480, 270], [768, 432], [1200, 675], [1920, 1080]]
    },
    room: {
        sizes: '(max-width: 1023px) 100vw, 25vw',
        variants: [[480, 270], [768, 432], [1200, 675], [1920, 1080]]
    },
    gallery: {
        sizes: '(max-width: 767px) 100vw, 50vw',
        variants: [[768, 432], [1200, 675], [1920, 1080]]
    }
};

function rawImageValue(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return value.url || value.src || value.image || value.photo || '';
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
                url.pathname = url.pathname
                    .replace(/\/t\/\d+x\d+(?=\/)/i, `/t/${SUPPLIER_IMAGE_SIZE}`)
                    .replace(/\/\d+x\d+(?=\/)/i, `/${SUPPLIER_IMAGE_SIZE}`);
                return url.toString();
            }
        } catch {
            return '';
        }
        return image;
    }

    const path = image.replace(/^\/+/, '').replace(/^t\/\d+x\d+\//i, '');
    return `https://cdn.worldota.net/t/${SUPPLIER_IMAGE_SIZE}/${path}`;
}

function resizeSupplierImage(url, width, height) {
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
    const dimensions = preset.variants[preset.variants.length - 1];
    const isResizableSupplierImage = (() => {
        try {
            const parsed = new URL(src);
            return parsed.hostname === SUPPLIER_IMAGE_HOST && /\/t\/\d+x\d+\//i.test(parsed.pathname);
        } catch {
            return false;
        }
    })();

    return {
        src: isResizableSupplierImage ? resizeSupplierImage(src, dimensions[0], dimensions[1]) : src,
        srcSet: isResizableSupplierImage
            ? preset.variants.map(([width, height]) => `${resizeSupplierImage(src, width, height)} ${width}w`).join(', ')
            : undefined,
        sizes: isResizableSupplierImage ? preset.sizes : undefined,
        width: dimensions[0],
        height: dimensions[1]
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

function roomGroupMatches(rate, group) {
    if (!rate || !group) return false;

    const rateGroupId = rate.room_group_id || rate.room_group?.room_group_id || rate.room_group?.id;
    if (rateGroupId !== undefined && rateGroupId !== null) {
        return String(rateGroupId) === String(group.room_group_id || group.id);
    }

    const rateName = String(rate.room_name || rate.name || '').trim().toLowerCase();
    const groupName = String(group.name || group.name_struct?.main_name || '').trim().toLowerCase();
    if (rateName && groupName && (rateName === groupName || rateName.includes(groupName) || groupName.includes(rateName))) {
        return true;
    }

    const rateRgExt = rate.rg_ext || rate.room_info?.rg_ext;
    const groupRgExt = group.rg_ext;
    if (!rateRgExt || !groupRgExt) return false;

    const comparableKeys = ['bathroom', 'bedding', 'bedrooms', 'capacity', 'class', 'quality', 'view', 'balcony'];
    const keys = comparableKeys.filter(key => Number(rateRgExt[key]) > 0 && Number(groupRgExt[key]) > 0);
    return keys.length > 0 && keys.every(key => Number(rateRgExt[key]) === Number(groupRgExt[key]));
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