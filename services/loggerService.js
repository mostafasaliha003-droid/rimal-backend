// services/loggerService.js

/**
 * 🚀 خدمة السجلات السحابية المتوافقة مع Render
 * تعتمد على طباعة السجلات لتلتقطها لوحة تحكم Render تلقائياً دون استهلاك مساحة التخزين المؤقتة.
 */

const fs = require('fs');
const path = require('path');

const ETG_LOG_DIR = path.join(__dirname, '..', 'logs');
const ETG_LOG_FILE = path.join(ETG_LOG_DIR, 'etg-requests.log');
const ETG_LOG_MAX_BYTES = parseInt(process.env.ETG_LOG_MAX_BYTES || `${10 * 1024 * 1024}`, 10);
const ETG_LOG_BACKUPS = parseInt(process.env.ETG_LOG_BACKUPS || '5', 10);

function rotateEtgLogIfNeeded(nextEntryBytes) {
    fs.mkdirSync(ETG_LOG_DIR, { recursive: true });
    if (!fs.existsSync(ETG_LOG_FILE)) return;

    const currentSize = fs.statSync(ETG_LOG_FILE).size;
    if (currentSize + nextEntryBytes <= ETG_LOG_MAX_BYTES) return;

    for (let index = ETG_LOG_BACKUPS - 1; index >= 1; index -= 1) {
        const source = `${ETG_LOG_FILE}.${index}`;
        const destination = `${ETG_LOG_FILE}.${index + 1}`;
        if (fs.existsSync(source)) fs.renameSync(source, destination);
    }
    fs.renameSync(ETG_LOG_FILE, `${ETG_LOG_FILE}.1`);
}

function redactHeaderValue(name, value) {
    if (/authorization|api[-_]?key|token|secret|password/i.test(name)) return '[REDACTED]';
    return value;
}

function sanitizeHeaders(headers = {}, auth) {
    const plainHeaders = typeof headers.toJSON === 'function' ? headers.toJSON() : headers;
    const sanitized = {};
    Object.entries(plainHeaders || {}).forEach(([name, value]) => {
        sanitized[name] = redactHeaderValue(name, value);
    });
    if (auth) sanitized.authorization = '[REDACTED]';
    return sanitized;
}

function findPartnerOrderId(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findPartnerOrderId(item);
            if (found) return found;
        }
        return null;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key === 'partner_order_id' || key === 'partnerOrderId') return String(child);
        const found = findPartnerOrderId(child);
        if (found) return found;
    }
    return null;
}

function appendEtgRequestLog(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    rotateEtgLogIfNeeded(bytes);
    fs.appendFileSync(ETG_LOG_FILE, line, 'utf8');
}

function readEtgLogsForPartnerOrderId(partnerOrderId) {
    if (!partnerOrderId) return [];
    const logFiles = [ETG_LOG_FILE];
    for (let index = 1; index <= ETG_LOG_BACKUPS; index += 1) {
        logFiles.push(`${ETG_LOG_FILE}.${index}`);
    }
    return logFiles
        .filter(file => fs.existsSync(file))
        .flatMap(file => fs.readFileSync(file, 'utf8').split('\n'))
        .filter(Boolean)
        .map(line => {
            try { return JSON.parse(line); } catch (_) { return null; }
        })
        .filter(entry => entry && entry.partnerOrderId === String(partnerOrderId))
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

const formatMessage = (level, icon, message, data) => {
    const timestamp = new Date().toISOString();
    const dataString = Object.keys(data).length ? `\n   📦 Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] ${icon} ${message}${dataString}`;
};

module.exports = {
    info: (message, data = {}) => {
        console.log(formatMessage('INFO', 'ℹ️', message, data));
    },
    
    error: (message, data = {}) => {
        console.error(formatMessage('ERROR', '❌', message, data));
    },
    
    warn: (message, data = {}) => {
        console.warn(formatMessage('WARN', '⚠️', message, data));
    },

    logEtgExchange: ({ method, url, headers, auth, requestPayload, responsePayload, statusCode, latencyMs, error }) => {
        const entry = {
            timestamp: new Date().toISOString(),
            endpoint: { url, method: String(method || 'GET').toUpperCase() },
            requestPayload: requestPayload === undefined ? null : requestPayload,
            requestHeaders: sanitizeHeaders(headers, auth),
            responsePayload: responsePayload === undefined ? null : responsePayload,
            statusCode: statusCode === undefined ? null : statusCode,
            latencyMs: Math.max(0, Math.round(latencyMs)),
            partnerOrderId: findPartnerOrderId(requestPayload) || findPartnerOrderId(responsePayload)
        };
        if (error) entry.error = { code: error.code || null, message: error.message || String(error) };
        appendEtgRequestLog(entry);
    },

    readEtgLogsForPartnerOrderId
};
