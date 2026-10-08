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

function rateCodeSetIncludes(rateCodes, rateCode) {
    if (typeof rateCodes !== 'string' || typeof rateCode !== 'string') return false;
    return rateCodes.trim().split(/\s+/).includes(rateCode);
}

function resolveHotelbedsRateComments({ rateCommentsId, hotelCode, language, checkIn, records,
    now = new Date() } = {}) {
    const identity = parseRateCommentsId(rateCommentsId);
    if (!identity || !Number.isSafeInteger(Number(hotelCode)) || !language || !validStayDate(checkIn)
        || !Array.isArray(records)) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };
    const matching = records.filter(record => String(record?.hotelCode) === String(hotelCode)
        && String(record?.language || '').toUpperCase() === String(language).toUpperCase()
        && record?.source === 'hotelbeds_content_api'
        && String(record?.incoming).trim() === identity.incoming
        && String(record?.code).trim() === identity.code);
    if (matching.length === 0) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };

    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(nowMs)) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };
    const freshMatching = matching.filter(record => {
        const syncedAtMs = new Date(record.syncedAt).getTime();
        return Number.isFinite(syncedAtMs) && syncedAtMs <= nowMs
            && nowMs - syncedAtMs <= 7 * 24 * 60 * 60 * 1000;
    });
    if (freshMatching.length === 0) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };

    const latestSyncedAtMs = Math.max(...freshMatching.map(record => new Date(record.syncedAt).getTime()));
    const currentMatching = freshMatching.filter(record => {
        const syncedAtMs = new Date(record.syncedAt).getTime();
        return syncedAtMs === latestSyncedAtMs;
    });
    if (currentMatching.length === 0) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };

    const matchingRateGroups = currentMatching.flatMap(record =>
        (Array.isArray(record.commentsByRates) ? record.commentsByRates : [])
            .filter(group => rateCodeSetIncludes(group?.rateCodes, identity.rateCodes))
            .map(group => ({ record, group })));
    if (matchingRateGroups.length === 0) {
        return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };
    }
    const applicable = matchingRateGroups.flatMap(({ group }) => Array.isArray(group.comments) ? group.comments : [])
        .filter(comment => validStayDate(comment?.dateStart) && validStayDate(comment?.dateEnd)
            && comment.dateStart <= checkIn && comment.dateEnd >= checkIn)
        .map(comment => ({ dateStart: comment.dateStart, dateEnd: comment.dateEnd,
            description: typeof comment.description === 'string' ? comment.description.trim() : '' }))
        .filter(comment => comment.description && comment.description.length <= 2000);
    const uniqueApplicable = [...new Map(applicable.map(comment =>
        [`${comment.dateStart}|${comment.dateEnd}|${comment.description}`, comment])).values()]
        .sort((left, right) => left.dateStart.localeCompare(right.dateStart)
            || left.dateEnd.localeCompare(right.dateEnd) || left.description.localeCompare(right.description));
    if (uniqueApplicable.length === 0) return { resolved: false, comments: [], issues: [], mandatoryFacilities: [] };

    return {
        resolved: true,
        comments: uniqueApplicable,
        issues: [],
        mandatoryFacilities: []
    };
}

module.exports = { parseRateCommentsId, resolveHotelbedsRateComments };