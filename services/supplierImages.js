const SUPPLIER_IMAGE_SIZE = '1920x1080';
const SUPPLIER_IMAGE_HOST = 'https://cdn.worldota.net';

const PLACEHOLDER_IMAGE_PATTERNS = [
    /images\.unsplash\.com/i,
    /photo-1566073771259-6a8506099945/i,
    /33036666\.jpg/i,
    /35165972\.jpg/i
];

function rawImageValue(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return value.url || value.src || value.image || value.photo || '';
}

function isPlaceholderImage(value) {
    const raw = rawImageValue(value).trim();
    return !raw || PLACEHOLDER_IMAGE_PATTERNS.some(pattern => pattern.test(raw));
}

function normalizeSupplierImage(value) {
    const raw = rawImageValue(value).trim();
    if (!raw || isPlaceholderImage(raw)) return '';

    let image = raw.replace(/\{size\}/gi, SUPPLIER_IMAGE_SIZE);
    if (image.startsWith('//')) image = `https:${image}`;

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

    if (/^t\/\d+x\d+\//i.test(image)) return `${SUPPLIER_IMAGE_HOST}/${image.replace(/^\/+/, '')}`;
    const imagePath = image.replace(/^\/+/, '');
    return `${SUPPLIER_IMAGE_HOST}/${imagePath}`;
}

function collectSupplierImages(...values) {
    const images = [];
    const visit = value => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (value && typeof value === 'object' && !rawImageValue(value).trim()) {
            Object.values(value).forEach(visit);
            return;
        }
        const image = normalizeSupplierImage(value);
        if (image && !images.includes(image)) images.push(image);
    };
    values.forEach(visit);
    return images;
}

module.exports = {
    SUPPLIER_IMAGE_SIZE,
    collectSupplierImages,
    isPlaceholderImage,
    normalizeSupplierImage
};