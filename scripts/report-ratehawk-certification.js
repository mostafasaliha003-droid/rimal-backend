'use strict';

// Print a deliberately small allowlisted report. Raw certification logs contain
// test guest data and must never be copied into job output or committed to Git.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PREFIX = 'APIR_CERTIFICATION_RESULT ';
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const SCENARIOS = new Set([
    'standard_booking', 'multiroom_mixed_children', 'child_age_edge_cases',
    'uzbekistan_citizenship', 'prebook_price_increase_10_percent',
    'unknown_then_success', 'unknown_then_soldout', 'unknown_then_book_limit'
]);
const SCENARIO_STATUSES = new Set([
    'running', 'pending', 'processing', 'confirmed', 'failed', 'failed_at_form',
    'failed_at_finish', 'error', 'timed_out', 'paused_price_change_requires_approval'
]);
const ENVELOPE_STATUSES = new Set(['ok', 'error', 'processing']);
const ERROR_CODES = new Set([
    'unknown', 'timeout', 'transport_error', 'request_failed', 'rate_limit', 'http_5xx',
    '3ds', 'block', 'book_limit', 'booking_finish_did_not_succeed', 'charge',
    'decoding_json', 'endpoint_exceeded_limit', 'endpoint_not_active',
    'endpoint_not_found', 'incorrect_credentials', 'invalid_auth_header',
    'invalid_params', 'lock', 'no_auth_header', 'not_allowed', 'not_allowed_host',
    'order_not_found', 'overdue_debt', 'provider', 'soldout', 'unexpected_method',
    'booking_status_order_mismatch', 'rate_not_found', 'prebook_rate_not_found',
    'prebook_increase_price'
]);
const ENDPOINTS = new Set([
    '/api/b2b/v3/search/hp/', '/api/b2b/v3/hotel/prebook/',
    '/api/b2b/v3/hotel/order/booking/form/',
    '/api/b2b/v3/hotel/order/booking/finish/',
    '/api/b2b/v3/hotel/order/booking/finish/status/'
]);
const UUID = '[a-f\\d]{8}-(?:[a-f\\d]{4}-){3}[a-f\\d]{12}';
const PARTNER_ORDER_ID = new RegExp(`^${UUID}(?:-(?:unknown_success|unknown_soldout|unknown_book_limit))?$`, 'i');
const ORDER_ID = new RegExp(`^(?:[1-9]\\d{0,31}|${UUID})$`, 'i');

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const member = (values, value) => typeof value === 'string' && values.has(value) ? value : null;
const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

function safeError(value) {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' && (ERROR_CODES.has(value) || /^http_[1-5]\d{2}$/.test(value))
        ? value : 'unrecognized_error';
}

function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stayDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function endpoint(value) {
    if (typeof value !== 'string') return null;
    try {
        // Even a pathname can contain personal data; retain only runner routes.
        return member(ENDPOINTS, new URL(value, 'https://api-sandbox.ratehawk.com').pathname);
    } catch { return null; }
}

function amount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value < 1e12 ? value : null;
    return typeof value === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value) ? value : null;
}

function currency(value) {
    return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
}

function paymentSummary(value) {
    const source = record(value);
    return {
        type: member(new Set(['deposit', 'hotel']), source.type),
        amount: amount(source.amount), currency_code: currency(source.currency_code)
    };
}

function priceSummary(value) {
    const source = record(value);
    return {
        amount: amount(source.amount), currency_code: currency(source.currency_code),
        show_amount: amount(source.show_amount), show_currency_code: currency(source.show_currency_code),
        payment_types: Array.isArray(source.payment_types) ? source.payment_types.map(paymentSummary) : []
    };
}

function exchangeSummary(value) {
    const source = record(value);
    const response = record(source.response_payload);
    return {
        endpoint: endpoint(source.url), method: member(new Set(['GET', 'POST']), source.method),
        http_status: httpStatus(source.response_status_code),
        status: member(ENVELOPE_STATUSES, response.status), error: safeError(response.error),
        timestamp: timestamp(source.timestamp)
    };
}

function scenarioSummary(value) {
    const source = record(value);
    const dates = record(source.dates);
    const exchanges = Array.isArray(source.exchanges) ? source.exchanges.map(exchangeSummary) : [];
    const finishExchange = exchanges.findLast(exchange => exchange.endpoint === '/api/b2b/v3/hotel/order/booking/finish/');
    const finish = record(source.finish_response);
    return {
        id: member(SCENARIOS, source.id), status: member(SCENARIO_STATUSES, source.status),
        expectation_met: typeof source.expectation_met === 'boolean' ? source.expectation_met : null,
        hid: Number.isSafeInteger(source.hid) && source.hid > 0 ? source.hid : null,
        checkin: stayDate(dates.checkin), checkout: stayDate(dates.checkout),
        partner_order_id: typeof source.partner_order_id === 'string' && PARTNER_ORDER_ID.test(source.partner_order_id) ? source.partner_order_id : null,
        order_id: (typeof source.order_id === 'string' && ORDER_ID.test(source.order_id))
            || (Number.isSafeInteger(source.order_id) && source.order_id > 0) ? source.order_id : null,
        finish_response: {
            http_status: httpStatus(finish.http_status) ?? finishExchange?.http_status ?? null,
            status: member(ENVELOPE_STATUSES, finish.status) ?? finishExchange?.status ?? null,
            error: safeError(finish.error) ?? finishExchange?.error ?? null
        },
        final_error: safeError(source.final_error ?? source.error),
        original_rate_price: priceSummary(source.original_rate_price),
        prebooked_rate_price: priceSummary(source.prebooked_rate_price),
        payment_summary: paymentSummary(record(source.finish_request_payload).payment_type),
        exchanges
    };
}

function certificationReport(value) {
    const source = record(value);
    if (!Array.isArray(source.scenarios)) throw new Error('invalid_log_schema');
    return {
        generated_at: timestamp(source.generated_at),
        environment: member(new Set(['ETG Sandbox', 'ETG Production', 'sandbox', 'production']), source.environment),
        scenarios: source.scenarios.map(scenarioSummary)
    };
}

function resolveLogFile(argv, root = ROOT) {
    if (!Array.isArray(argv) || argv.length !== 1 || typeof argv[0] !== 'string' || !argv[0].startsWith('--log-file=')) {
        throw new Error('invalid_log_argument');
    }
    const portable = argv[0].slice('--log-file='.length).replace(/\\/g, '/');
    if (!portable.startsWith('logs/') || !portable.endsWith('.json')
        || portable.split('/').some(part => !part || part === '.' || part === '..')
        || /[<>:"|?*\x00-\x1f]/.test(portable)) throw new Error('invalid_log_path');
    const target = path.resolve(root, portable);
    const logDirectory = path.resolve(root, 'logs');
    const relative = path.relative(logDirectory, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('invalid_log_path');
    let current = path.resolve(root);
    for (const part of path.relative(root, target).split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('invalid_log_path');
    }
    const actualRelative = path.relative(fs.realpathSync(logDirectory), fs.realpathSync(target));
    if (!actualRelative || actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) throw new Error('invalid_log_path');
    if (!fs.statSync(target).isFile()) throw new Error('invalid_log_path');
    return target;
}

function readReport(argv, root = ROOT) {
    const target = resolveLogFile(argv, root);
    if (fs.statSync(target).size > MAX_LOG_BYTES) throw new Error('log_too_large');
    let value;
    try { value = JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch { throw new Error('invalid_log_json'); }
    return certificationReport(value);
}

if (require.main === module) {
    try { process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify(readReport(process.argv.slice(2)))}\n`); }
    catch (error) {
        const known = new Set(['invalid_log_argument', 'invalid_log_path', 'log_too_large', 'invalid_log_json', 'invalid_log_schema']);
        process.stderr.write(`APIR_CERTIFICATION_REPORT_ERROR ${known.has(error.message) ? error.message : 'log_unavailable'}\n`);
        process.exitCode = 1;
    }
}

module.exports = { certificationReport, readReport, resolveLogFile, OUTPUT_PREFIX };
