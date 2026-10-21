// Public marketing copy only. Never return supplier rates, inventory or proof files.
const campaigns = require('../config/membershipOffers.json');
const zonedDate = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
function activeMembershipOffers(rows = campaigns, now = Date.now()) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => row && row.approved === true
        && typeof row.evidenceReference === 'string' && row.evidenceReference.trim()
        && typeof row.id === 'string' && /^[a-z0-9-]{1,64}$/.test(row.id)
        && zonedDate(row.startsAt) && zonedDate(row.endsAt)
        && Date.parse(row.startsAt) <= now && now < Date.parse(row.endsAt)
        && ['ar', 'en'].every(locale => typeof row.title?.[locale] === 'string' && row.title[locale].trim()
            && typeof row.terms?.[locale] === 'string' && row.terms[locale].trim()))
        .slice(0, 6).map(row => ({
            id: row.id, startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString(),
            title: { ar: row.title.ar.slice(0, 120), en: row.title.en.slice(0, 120) },
            terms: { ar: row.terms.ar.slice(0, 360), en: row.terms.en.slice(0, 360) },
            ...(Number.isInteger(row.maxSavingPercent) && row.maxSavingPercent > 0 && row.maxSavingPercent <= 100
                && typeof row.comparisonBasis === 'string' && row.comparisonBasis.trim()
                ? { maxSavingPercent: row.maxSavingPercent } : {}),
        }));
}
module.exports = { activeMembershipOffers };
