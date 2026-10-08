const MAX_RATE_COMMENT_LENGTH = 2000;
const MAX_RATE_COMMENT_COUNT = 50;
const MAX_RATE_COMMENTS_BYTES = 24 * 1024;

function normalizeHotelbedsRateComments(value) {
    if (value === undefined || value === null) return [];
    const source = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(source) || source.length > MAX_RATE_COMMENT_COUNT) return null;
    const comments = [];
    for (const item of source) {
        const comment = typeof item === 'string' ? item : item?.description;
        if (typeof comment !== 'string' || !comment.trim()
            || comment.trim().length > MAX_RATE_COMMENT_LENGTH
            || /[\u0000-\u001f\u007f]/.test(comment)) return null;
        comments.push(comment.trim());
    }
    return Buffer.byteLength(JSON.stringify(comments), 'utf8') <= MAX_RATE_COMMENTS_BYTES
        ? comments : null;
}

module.exports = {
    MAX_RATE_COMMENT_LENGTH,
    MAX_RATE_COMMENT_COUNT,
    MAX_RATE_COMMENTS_BYTES,
    normalizeHotelbedsRateComments
};