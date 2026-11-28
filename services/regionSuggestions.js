const { cleanTravelText, englishTravelQuery } = require('../shared/arabicTravelSearch');

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const label = value => typeof value === 'string' ? value.trim() : '';
const normalized = text => cleanTravelText(text).trim().toLowerCase();

// Match the Region documents ingested by the existing environment's ETG dump job.
// Use case-sensitive anchored prefixes so Mongo can use the supplier-name indexes.
async function findArabicRegionSuggestions(query, { Region, language, limit = 5 }) {
    const raw = query.normalize('NFKC').trim();
    const clean = cleanTravelText(raw);
    // A Latin query ("Dubai") is matched against the English names, so an Arabic page can still
    // show the region's Arabic name; an Arabic query is matched both ways.
    const latinQuery = /^[\p{Script=Latin}\d\s'’.,-]+$/u.test(raw) && raw.length >= 2;
    const english = englishTravelQuery(raw) || (latinQuery ? raw.replace(/\s+/g, ' ') : null);
    const bare = clean.replace(/^(?:فنادق|فندق|منتجعات|منتجع)\s+(?:في\s+)?/u, '');
    const arabic = latinQuery ? [] : [...new Set([raw, clean, bare].flatMap(name => name.startsWith('ا')
        ? [name,'أ'+name.slice(1),'إ'+name.slice(1),'آ'+name.slice(1)] : [name]))].filter(name => name.length >= 2);
    const latin = english ? [...new Set([english, english.replace(/\b\w/g,ch=>ch.toUpperCase())])] : [];
    const prefixes = [
        ...arabic.map(name=>({ 'name.ar': { $regex: '^'+escape(name) } })),
        ...latin.map(name=>({ 'name.en': { $regex: '^'+escape(name) } })),
    ];
    if (!prefixes.length) return [];
    const rows = await Region.find({ $or: prefixes }).select({ id: 1, name: 1, country_code: 1, type: 1 })
        .limit(35).maxTimeMS(1000).lean();
    const needles = [...arabic,...latin].map(normalized);
    const exact = row => [row.name?.ar,row.name?.en].some(name => name && needles.includes(normalized(name)));
    return rows.filter(row => Number.isSafeInteger(row.id) && row.id > 0 && (label(row.name?.en) || label(row.name?.ar)))
        .sort((a,b)=>Number(exact(b))-Number(exact(a)) || Number(b.type==='City')-Number(a.type==='City') || a.id-b.id)
        .slice(0,limit).map(row => {
            const resolved = [language,'en','ar'].find(code=>label(row.name?.[code]));
            return { id: row.id, name: row.name[resolved], type: row.type, country: label(row.country_code), resolvedLanguage: resolved };
        });
}

module.exports = { findArabicRegionSuggestions };
