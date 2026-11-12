// ETG cancellation timestamps without an offset are UTC, never browser-local.
export function parseRatehawkDateTime(value) {
    if (typeof value !== 'string') return null;
    const source = value.trim();
    const parts = source.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i);
    if (!parts) return null;
    const [year, month, day, hour, minute, second] = parts.slice(1).map(part => Number(part || 0));
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
        || hour > 23 || minute > 59 || second > 59) return null;
    const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(source) ? source : `${source}Z`;
    const date = new Date(timestamp.replace(' ', 'T'));
    return Number.isFinite(date.getTime()) ? date : null;
}

export function formatRatehawkDateTime(value, language = 'en') {
    const date = parseRatehawkDateTime(value);
    if (!date) return '';
    return `${new Intl.DateTimeFormat(language, {
        dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC'
    }).format(date)} UTC+0`;
}
