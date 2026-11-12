'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { certificationReport, readReport, resolveLogFile, OUTPUT_PREFIX } = require('./scripts/report-ratehawk-certification');

const PRIVATE = 'private_personal_sentinel';
const partnerOrderId = 'e127cc60-b799-4a3c-869c-c7d45e45a39a-unknown_soldout';
const timestamp = '2026-11-12T12:34:56.789Z';
const exchange = (route, error, status = 'error') => ({
    timestamp, method: 'POST',
    url: `https://${PRIVATE}:${PRIVATE}@api-sandbox.ratehawk.com/api/b2b/v3/${route}/?contact=${PRIVATE}#${PRIVATE}`,
    request_payload: { user: { email: `${PRIVATE}@example.test` }, rooms: [{ guests: [{ first_name: PRIVATE }] }], hash: PRIVATE },
    response_status_code: 200,
    response_payload: { status, error, data: { partner_order_id: partnerOrderId, debug: PRIVATE, hash: PRIVATE } },
    transport_error: { message: PRIVATE }, debug: PRIVATE
});

function fixture() {
    return {
        generated_at: timestamp, environment: 'ETG Sandbox', api_origin: PRIVATE,
        credentials: PRIVATE, user_ip: PRIVATE, private: PRIVATE,
        scenarios: [{
            id: 'unknown_then_soldout', status: 'failed', expectation_met: true, hid: 10004834,
            dates: { checkin: '2026-12-12', checkout: '2026-12-14', note: PRIVATE },
            partner_order_id: partnerOrderId, order_id: 12345678, final_error: 'soldout',
            description: PRIVATE, residency: PRIVATE, rooms: [{ guests: [{ first_name: PRIVATE }] }],
            initial_book_hash: PRIVATE, prebooked_book_hash: PRIVATE,
            original_rate_price: { amount: '20.00', currency_code: 'USD', book_hash: PRIVATE,
                payment_types: [{ type: 'deposit', amount: '20.00', currency_code: 'USD', debug: PRIVATE }] },
            prebooked_rate_price: { show_amount: '22.00', show_currency_code: 'USD', hash: PRIVATE,
                payment_types: [{ type: 'deposit', amount: '22.00', currency_code: 'USD', auth: PRIVATE }] },
            finish_request_payload: { user: { email: `${PRIVATE}@example.test`, phone: PRIVATE },
                payment_type: { type: 'deposit', amount: '22.00', currency_code: 'USD', hash: PRIVATE }, rooms: PRIVATE },
            finish_response: { http_status: 200, status: 'error', error: 'unknown', debug: PRIVATE },
            latest_status_response: { data: PRIVATE },
            exchanges: [exchange('hotel/order/booking/finish', 'unknown'),
                exchange('hotel/order/booking/finish/status', 'unknown'),
                exchange('hotel/order/booking/finish/status', 'soldout')]
        }]
    };
}

test('certification report retains useful financial and unknown-outcome evidence without any private payload fields', () => {
    const report = certificationReport(fixture());
    assert.deepEqual(Object.keys(report), ['generated_at', 'environment', 'scenarios']);
    assert.equal(report.generated_at, timestamp);
    assert.equal(report.environment, 'ETG Sandbox');
    const scenario = report.scenarios[0];
    assert.equal(scenario.partner_order_id, partnerOrderId);
    assert.equal(scenario.order_id, 12345678);
    assert.equal(scenario.hid, 10004834);
    assert.equal(scenario.checkin, '2026-12-12');
    assert.equal(scenario.checkout, '2026-12-14');
    assert.equal(scenario.expectation_met, true);
    assert.deepEqual(scenario.finish_response, { http_status: 200, status: 'error', error: 'unknown' });
    assert.equal(scenario.final_error, 'soldout');
    assert.equal(scenario.original_rate_price.amount, '20.00');
    assert.equal(scenario.prebooked_rate_price.show_amount, '22.00');
    assert.deepEqual(scenario.payment_summary, { type: 'deposit', amount: '22.00', currency_code: 'USD' });
    assert.deepEqual(scenario.exchanges.map(item => [item.endpoint, item.error]), [
        ['/api/b2b/v3/hotel/order/booking/finish/', 'unknown'],
        ['/api/b2b/v3/hotel/order/booking/finish/status/', 'unknown'],
        ['/api/b2b/v3/hotel/order/booking/finish/status/', 'soldout']
    ]);
    const serialized = JSON.stringify(report);
    for (const excluded of [PRIVATE, 'request_payload', 'response_payload', 'user_ip', 'book_hash', 'debug', 'https://', '@example.test']) {
        assert.equal(serialized.includes(excluded), false, excluded);
    }
});

test('unknown finish/status exchanges survive for successful, soldout and book_limit scenarios', () => {
    const input = fixture();
    input.scenarios = ['success', 'soldout', 'book_limit'].map(outcome => ({
        ...fixture().scenarios[0], id: `unknown_then_${outcome}`, status: outcome === 'success' ? 'confirmed' : 'failed',
        final_error: outcome === 'success' ? null : outcome,
        exchanges: [exchange('hotel/order/booking/finish', 'unknown'), exchange('hotel/order/booking/finish/status', 'unknown'),
            exchange('hotel/order/booking/finish/status', outcome === 'success' ? null : outcome, outcome === 'success' ? 'ok' : 'error')]
    }));
    for (const scenario of certificationReport(input).scenarios) {
        assert.equal(scenario.finish_response.error, 'unknown');
        assert.equal(scenario.exchanges[0].error, 'unknown');
        assert.equal(scenario.exchanges[1].error, 'unknown');
        assert.equal(scenario.exchanges[2].error, scenario.final_error);
        assert.equal(scenario.exchanges[2].status, scenario.status === 'confirmed' ? 'ok' : 'error');
    }
});

test('unrecognized errors, identifiers, timestamps, amounts and URL paths cannot smuggle private text', () => {
    const input = fixture();
    input.generated_at = PRIVATE;
    input.environment = PRIVATE;
    const scenario = input.scenarios[0];
    Object.assign(scenario, { id: PRIVATE, status: PRIVATE, expectation_met: PRIVATE,
        partner_order_id: PRIVATE, order_id: PRIVATE, final_error: PRIVATE,
        finish_response: { http_status: PRIVATE, status: PRIVATE, error: PRIVATE },
        prebooked_rate_price: { amount: PRIVATE, currency_code: PRIVATE, payment_types: [{ type: PRIVATE, amount: PRIVATE, currency_code: PRIVATE }] }
    });
    scenario.exchanges.push({ ...exchange(PRIVATE, PRIVATE, PRIVATE), method: PRIVATE, timestamp: PRIVATE });
    const report = certificationReport(input);
    assert.equal(JSON.stringify(report).includes(PRIVATE), false);
    assert.equal(report.scenarios[0].final_error, 'unrecognized_error');
    assert.equal(report.scenarios[0].finish_response.error, 'unrecognized_error');
    assert.equal(report.scenarios[0].exchanges.at(-1).endpoint, null);
    assert.equal(report.scenarios[0].prebooked_rate_price.amount, null);
});

test('report CLI reads only confined logs, emits one JSON line even for unmet outcomes, and keeps parse errors generic', context => {
    const logRoot = path.join(__dirname, 'logs');
    fs.mkdirSync(logRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(logRoot, 'cert-report-test-'));
    const file = path.join(directory, 'report.json');
    context.after(() => {
        assert.equal(path.dirname(directory), logRoot);
        fs.unlinkSync(file);
        fs.rmdirSync(directory);
    });
    const input = fixture();
    input.scenarios[0].expectation_met = false;
    fs.writeFileSync(file, JSON.stringify(input));
    const argument = `--log-file=${path.relative(__dirname, file)}`;
    assert.equal(resolveLogFile([argument]), file);
    assert.equal(readReport([argument]).scenarios[0].expectation_met, false);
    const command = path.join(__dirname, 'scripts', 'report-ratehawk-certification.js');
    const result = spawnSync(process.execPath, [command, argument], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trimEnd().split('\n').length, 1);
    assert.ok(result.stdout.startsWith(OUTPUT_PREFIX));
    assert.equal(JSON.parse(result.stdout.slice(OUTPUT_PREFIX.length)).scenarios[0].expectation_met, false);
    assert.equal(result.stdout.includes(PRIVATE), false);
    for (const invalid of ['', '../outside.json', 'logs/../outside.json', 'logs/..\\outside.json',
        'logs/not-json.txt', 'C:\\outside.json', 'logs//file.json']) {
        assert.throws(() => resolveLogFile([`--log-file=${invalid}`]), /invalid_log_path/);
    }
    assert.throws(() => resolveLogFile([]), /invalid_log_argument/);
    fs.writeFileSync(file, `{${PRIVATE}`);
    const malformed = spawnSync(process.execPath, [command, argument], { encoding: 'utf8', windowsHide: true });
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, '');
    assert.equal(malformed.stderr, 'APIR_CERTIFICATION_REPORT_ERROR invalid_log_json\n');
    assert.equal(malformed.stderr.includes(PRIVATE), false);
});

test('report paths reject symbolic links and junction ancestors', context => {
    const originalStat = fs.lstatSync;
    const junction = path.join(__dirname, 'logs', 'report-junction');
    context.mock.method(fs, 'lstatSync', target => path.resolve(target) === junction
        ? { isSymbolicLink: () => true } : originalStat(target));
    assert.throws(() => resolveLogFile(['--log-file=logs/report-junction/outside.json']), /invalid_log_path/);
});
