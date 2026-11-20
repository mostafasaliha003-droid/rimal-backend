const { hotelSearchTokens } = require('./hotelSearchIndex');

const EDITOR = 'arabic-name-catalog';
const arabic = /\p{Script=Arabic}/u;

function text(value, max) {
    return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
}

/**
 * Researched Arabic hotel names kept in data/hotel-arabic-names.json, keyed by
 * RateHawk hid. Each entry must name its source so a reviewer can check it.
 */
function readCatalog(entries) {
    const catalog = new Map();
    for (const [hid, entry] of Object.entries(entries || {})) {
        const name = text(entry?.name, 200);
        if (!/^\d+$/.test(hid) || !name || !arabic.test(name) || !text(entry?.source, 300)) {
            throw new TypeError(`Invalid Arabic hotel name entry for ${hid}`);
        }
        const address = text(entry.address, 300);
        const city = text(entry.city, 120);
        catalog.set(hid, { name, ...(address ? { address } : {}), ...(city ? { city } : {}) });
    }
    return catalog;
}

/**
 * Stores catalog names as approved editorial translations so search results and
 * hotel pages show them. A name an editor set by hand is never replaced; names
 * from this catalog are updated when the catalog changes.
 */
async function applyArabicNameCatalog({ model, entries, now = () => new Date(), logger = console }) {
    const catalog = readCatalog(entries);
    const result = { applied: 0, unchanged: 0, kept: 0, missing: 0 };
    if (!catalog.size) return result;
    const hotels = await model.find({ provider: 'ratehawk', hid: { $in: [...catalog.keys()] } })
        .select({ hid: 1, translations: 1 }).lean();
    const found = new Set();
    const writes = [];
    for (const hotel of hotels) {
        const hid = String(hotel.hid);
        found.add(hid);
        const entry = catalog.get(hid);
        const translations = hotel.translations instanceof Map ? Object.fromEntries(hotel.translations) : hotel.translations || {};
        const current = translations.ar;
        if (current?.source === 'editorial' && current.reviewStatus === 'approved' && current.editor !== EDITOR) { result.kept += 1; continue; }
        if (current?.editor === EDITOR && current.name === entry.name && current.address === entry.address && current.city === entry.city) {
            result.unchanged += 1;
            continue;
        }
        const translation = { ...entry, source: 'editorial', reviewStatus: 'approved', editor: EDITOR, updatedAt: now() };
        const names = Object.entries({ ...translations, ar: translation })
            .filter(([, value]) => value?.name && value.reviewStatus === 'approved').map(([, value]) => value.name);
        writes.push({ updateOne: { filter: { _id: hotel._id }, update: { $set: {
            'translations.ar': translation,
            translationSearchTokens: [...new Set(names.flatMap(hotelSearchTokens))],
        } } } });
        result.applied += 1;
    }
    result.missing = catalog.size - found.size;
    if (writes.length) await model.bulkWrite(writes, { ordered: false });
    logger.info?.('Arabic hotel name catalog applied', result);
    return result;
}

/**
 * Lists hotels still shown with their English name, for editors to research.
 * Names and cities are public catalogue data; the list is capped.
 */
async function reportHotelsWithoutArabicNames({ model, limit = 1000, perLine = 40, print = console.log }) {
    const hotels = await model.find({ provider: 'ratehawk', deleted: { $ne: true }, 'translations.ar.reviewStatus': { $ne: 'approved' } })
        .select({ hid: 1, name: 1, city: 1 }).sort({ hid: 1 }).limit(limit).lean();
    for (let index = 0; index < hotels.length; index += perLine) {
        const rows = hotels.slice(index, index + perLine).map(hotel => [hotel.hid, hotel.name, hotel.city].map(value => String(value ?? '').replace(/[|\n]/g, ' ')).join('|'));
        print(`[arabic-name-report ${index + 1}-${index + rows.length}/${hotels.length}] ` + rows.join(' ;; '));
    }
    return hotels.length;
}

// Hotels with an Arabic name but no Arabic address, with the supplier address to translate.
async function reportHotelsWithoutArabicAddresses({ model, limit = 1000, perLine = 30, print = console.log }) {
    const hotels = await model.find({ provider: 'ratehawk', deleted: { $ne: true }, 'translations.ar.reviewStatus': 'approved',
        'translations.ar.address': { $exists: false }, address: { $nin: [null, ''] } })
        .select({ hid: 1, address: 1 }).sort({ hid: 1 }).limit(limit).lean();
    for (let index = 0; index < hotels.length; index += perLine) {
        const rows = hotels.slice(index, index + perLine).map(hotel => [hotel.hid, hotel.address].map(value => String(value ?? '').replace(/[|\n]/g, ' ')).join('|'));
        print(`[arabic-address-report ${index + 1}-${index + rows.length}/${hotels.length}] ` + rows.join(' ;; '));
    }
    return hotels.length;
}

module.exports = { EDITOR, readCatalog, applyArabicNameCatalog, reportHotelsWithoutArabicNames, reportHotelsWithoutArabicAddresses };
