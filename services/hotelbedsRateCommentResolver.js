function fail(code) {
    return Object.assign(new Error(code), { code, httpStatus: 400 });
}

function parseRateCommentsId(value) {
    if (typeof value !== 'string' || value.length > 300) return null;
    const parts = value.split('|');
    if (parts.length !== 3 || parts.some(part => !part.trim() || /[\u0000-\u001f]/.test(part))) return null;
    return { incoming: parts[0].trim(), code: parts[1].trim(), rateCodes: parts[2].trim().replace(/\s+/g, ' ') };
}

function validStayDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function resolveHotelbedsRateComments({ rateCommentsId, hotelCode, language, checkIn, records, now = new Date() } = {}) {
    const identity = parseRateCommentsId(rateCommentsId);
    if (!identity || !Number.isSafeInteger(Number(hotelCode)) || !language || !validStayDate(checkIn)
        || !Array.isArray(records)) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };
    const matching = records.filter(record => String(record?.hotelCode) === String(hotelCode)
        && String(record?.language || '').toUpperCase() === String(language).toUpperCase()
        && record?.source === 'hotelbeds_content_api'
        && String(record?.incoming).trim() === identity.incoming
        && String(record?.code).trim() === identity.code
        && String(record?.rateCodes).trim().replace(/\s+/g, ' ') === identity.rateCodes);
    if (matching.length !== 1) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };

    const record = matching[0];
    const nowMs = new Date(now).getTime();
    const syncedAtMs = new Date(record.syncedAt).getTime();
    if (!Number.isFinite(nowMs) || !Number.isFinite(syncedAtMs) || syncedAtMs > nowMs
        || nowMs - syncedAtMs > 7 * 24 * 60 * 60 * 1000) {
        return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };
    }
    const rateGroups = Array.isArray(record.commentsByRates) ? record.commentsByRates : [];
    const applicable = rateGroups.filter(group => String(group?.rateCodes || '').trim().replace(/\s+/g, ' ') === identity.rateCodes)
        .flatMap(group => Array.isArray(group.comments) ? group.comments : [])
        .filter(comment => validStayDate(comment?.dateStart) && validStayDate(comment?.dateEnd)
            && comment.dateStart <= checkIn && comment.dateEnd >= checkIn)
        .map(comment => ({
            dateStart: comment.dateStart,
            dateEnd: comment.dateEnd,
            description: typeof comment.description === 'string' ? comment.description.trim() : '',
            incoming: identity.incoming,
            code: identity.code,
            rateCodes: identity.rateCodes
        })).filter(comment => comment.description && comment.description.length <= 2000)
        .sort((left, right) => left.dateStart.localeCompare(right.dateStart)
            || left.dateEnd.localeCompare(right.dateEnd) || left.description.localeCompare(right.description));
    if (applicable.length === 0) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };

    const issues = (Array.isArray(record.issues) ? record.issues : [])
        .map(issue => typeof issue?.description === 'string' ? issue.description.trim() : '')
        .filter(Boolean).slice(0, 30);
    const mandatoryFacilities = (Array.isArray(record.facilities) ? record.facilities : [])
        .filter(facility => facility?.voucher === true)
        .map(facility => ({
            description: typeof facility.description === 'string' ? facility.description.trim() : '',
            fee: typeof facility.indFee === 'boolean' ? facility.indFee : null,
            amount: facility.indFee === true && Number.isFinite(Number(facility.amount)) ? String(facility.amount) : null,
            currency: facility.indFee === true && /^[A-Z]{3}$/.test(String(facility.currency || ''))
                ? facility.currency : null
        })).filter(facility => facility.description).slice(0, 100);
    return {
        resolved: true,
        comments: applicable.map(({ dateStart, dateEnd, description }) => ({ dateStart, dateEnd, description })),
        issues,
        mandatoryFacilities
    };
}

module.exports = { parseRateCommentsId, resolveHotelbedsRateComments };