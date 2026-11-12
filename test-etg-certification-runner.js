const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
    selectRate, selectPrebookedRate, getComparablePrice, validatePaymentWithinCap, resolveEnvFile,
    requireSandboxConfiguration, makeFinishPayload, makePartnerOrderId, recordExpectedOutcome, resolveLogFile, summarizeResults, scenarios, errorScenarios
} = require('./etg-cert-sandbox-test');

const rate = (amount, extra = {}) => ({
    book_hash: `fixture-${amount}`,
    payment_options: { payment_types: [{ type: 'deposit', amount, currency_code: 'USD',
        is_need_credit_card_data: false, ...extra }] }
});

test('sandbox certification selects the cheapest actual ETG nested no-card payment', () => {
    const selected = rate('25.50');
    assert.equal(selectRate({ hotels: [{ hid: 10004834, rates: [rate('40.00'), selected,
        rate('1.00', { is_need_credit_card_data: true }), rate('2.00', { currency_code: 'EUR' })] }] }, 10004834).rate, selected);
    assert.deepEqual(getComparablePrice(selected), { amount: 25.5, currency: 'USD' });
    assert.throws(() => selectRate({ hotels: [{ hid: 2, rates: [selected] }] }, 10004834));
    assert.throws(() => validatePaymentWithinCap({ amount: '25.50', currency_code: 'USD' }, 25));
    assert.throws(() => validatePaymentWithinCap({ amount: '20.00', currency_code: 'EUR' }, 25));
});

test('sandbox certification accepts a project-local env file and rejects path escape', () => {
    assert.equal(resolveEnvFile(['--env-file=.env.sandbox']), path.resolve(__dirname, '.env.sandbox'));
    assert.throws(() => resolveEnvFile(['--env-file=../outside.env']), /inside the project directory/);
    assert.throws(() => resolveEnvFile(['--env-file=']), /Invalid --env-file/);
});

test('certification log paths are unique, confined to logs and never replace existing evidence', context => {
    const logRoot = path.join(__dirname, 'logs');
    fs.mkdirSync(logRoot, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(logRoot, 'cert-log-test-'));
    const existing = path.join(temporary, 'existing.json');
    fs.writeFileSync(existing, '{"preserve":true}');
    context.after(() => {
        assert.equal(path.dirname(temporary), logRoot);
        fs.unlinkSync(existing);
        fs.rmdirSync(temporary);
    });
    assert.notEqual(resolveLogFile([]), resolveLogFile([]));
    assert.equal(path.dirname(resolveLogFile([])), logRoot);
    const desired = path.relative(__dirname, path.join(temporary, 'new.json'));
    assert.equal(resolveLogFile([`--log-file=${desired}`]), path.join(temporary, 'new.json'));
    for (const target of ['', 'etg-certification-logs.json', '../outside.json', 'logs/../outside.json',
        'logs/../../outside.json', 'logs/..\\outside.json', 'C:\\outside.json', 'logs/not-json.txt']) {
        assert.throws(() => resolveLogFile([`--log-file=${target}`]), /--log-file/);
    }
    assert.throws(() => resolveLogFile([`--log-file=${path.relative(__dirname, existing)}`]), /already exists/);
    assert.equal(fs.readFileSync(existing, 'utf8'), '{"preserve":true}');
});

test('certification log paths reject symlink ancestors and tracked Git paths', context => {
    const originalStat = fs.lstatSync;
    const symlinkPath = path.join(__dirname, 'logs', 'symlink-escape');
    context.mock.method(fs, 'lstatSync', target => path.resolve(target) === symlinkPath
        ? { isSymbolicLink: () => true } : originalStat(target));
    assert.throws(() => resolveLogFile(['--log-file=logs/symlink-escape/new.json']), /symbolic link/);
    const originalExists = fs.existsSync;
    context.mock.method(fs, 'existsSync', target => path.resolve(target) === path.join(__dirname, '.git')
        || originalExists(target));
    context.mock.method(require('node:child_process'), 'spawnSync', () => ({ status: 0 }));
    assert.throws(() => resolveLogFile(['--log-file=logs/tracked-fixture.json']), /tracked Git path/);
});

test('certification requires a separate company confirmation mailbox before any request', context => {
    const values = {
        RATEHAWK_KEY_ID: 'fixture-id', RATEHAWK_API_KEY: 'fixture-key',
        RATEHAWK_BASE_URL: 'https://api-sandbox.ratehawk.com', ETG_CERT_USER_IP: '192.0.2.1',
        RATEHAWK_CONFIRMATION_EMAIL: 'bookings@remal.example.test',
        ETG_CERT_GUEST_EMAIL: 'guest@example.test', ETG_CERT_GUEST_PHONE: '+971500000000',
        ETG_CERT_SANDBOX_TEST_DATA_CONFIRMED: 'true',
        ETG_CERT_GUESTS_JSON: JSON.stringify(Object.fromEntries(scenarios.map(scenario => [scenario.id,
            scenario.rooms.map(room => [
                ...Array.from({ length: room.adults }, () => ({ first_name: 'Test', last_name: 'Adult' })),
                ...room.children.map(age => ({ first_name: 'Test', last_name: 'Child', is_child: true, age }))
            ])
        ]))),
        ETG_CERT_BOOK_TIMEOUT_SECONDS: '', ETG_CERT_POLL_INTERVAL_MS: ''
    };
    const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
    context.after(() => {
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });
    Object.assign(process.env, values);
    context.mock.method(require('axios'), 'post', () => assert.fail('Configuration validation must not call ETG'));
    const config = requireSandboxConfiguration();
    assert.equal(config.confirmationEmail, values.RATEHAWK_CONFIRMATION_EMAIL);
    assert.equal(config.guestEmail, values.ETG_CERT_GUEST_EMAIL);
    assert.equal(config.bookingTimeoutSeconds, 180);
    const input = { config, partnerOrderId: 'fixture-order',
        paymentType: { type: 'deposit', amount: '25.50', currency_code: 'USD' },
        guestRooms: [[{ first_name: 'Test', last_name: 'Adult' }]] };
    assert.equal(makeFinishPayload(input).user.email, values.RATEHAWK_CONFIRMATION_EMAIL);
    assert.notEqual(makeFinishPayload(input).user.email, values.ETG_CERT_GUEST_EMAIL);
    for (const invalid of ['', 'invalid']) {
        process.env.RATEHAWK_CONFIRMATION_EMAIL = invalid;
        assert.throws(() => requireSandboxConfiguration(), /RATEHAWK_CONFIRMATION_EMAIL/);
        assert.throws(() => makeFinishPayload({ ...input, config: { ...config, confirmationEmail: invalid } }), /RATEHAWK_CONFIRMATION_EMAIL/);
    }
});

test('certification prebook requests use ten percent and ignore match_hash during rate selection', () => {
    assert(scenarios.every(scenario => scenario.priceIncreasePercent === 10));
    const original = { ...rate('20.00'), room_name: 'Original room', meal: 'nomeal', match_hash: 'obsolete' };
    const incorrectMatch = { ...rate('25.00'), room_name: 'Different room', meal: 'breakfast', match_hash: 'obsolete' };
    const actualRoom = { ...rate('22.00'), room_name: 'Original room', meal: 'nomeal', match_hash: 'different' };
    assert.equal(selectPrebookedRate({ hotels: [{ hid: 10004834, rates: [incorrectMatch, actualRoom] }] }, original, 10004834), actualRoom);
});

test('unknown suffix scenarios require recorded unknown responses at both finish and status', () => {
    for (const definition of errorScenarios) {
        const id = makePartnerOrderId(definition.partnerOrderSuffix);
        assert(id.endsWith(`-${definition.partnerOrderSuffix}`));
        assert.match(id.slice(0, 36), /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
        const log = { exchanges: [] };
        const finalStatus = definition.expectedFinalStatus || 'failed';
        recordExpectedOutcome(log, definition, finalStatus, definition.expectedFinalError || null);
        assert.equal(log.expectation_met, false);
        log.exchanges.push({ url: 'https://api-sandbox.ratehawk.com/api/b2b/v3/hotel/order/booking/finish/',
            response_payload: { status: 'error', error: 'unknown' } });
        recordExpectedOutcome(log, definition, finalStatus, definition.expectedFinalError || null);
        assert.equal(log.observed_unknown_at_finish, true);
        assert.equal(log.expectation_met, false);
        log.exchanges.push({ url: 'https://api-sandbox.ratehawk.com/api/b2b/v3/hotel/order/booking/finish/status/',
            response_payload: { status: 'error', error: 'unknown' } });
        recordExpectedOutcome(log, definition, finalStatus, definition.expectedFinalError || null);
        assert.equal(log.observed_unknown_at_status, true);
        assert.equal(log.expectation_met, true);
        recordExpectedOutcome(log, definition, 'timed_out', null);
        assert.equal(log.expectation_met, false);
    }
});

test('executed certification jobs fail for pending, paused, error or unmet outcomes', () => {
    assert.deepEqual(summarizeResults([
        { status: 'confirmed' }, { status: 'confirmed', expectation_met: true },
        { status: 'failed', expectation_met: true }
    ]), { successful: 2, failed: 1, other: 0, unmetExpectations: 0, hasUnexpectedResults: false });
    assert.equal(summarizeResults([]).hasUnexpectedResults, true);
    for (const result of [
        { status: 'failed' }, { status: 'failed', expectation_met: false },
        { status: 'confirmed', expectation_met: false }, { status: 'error' },
        { status: 'pending' }, { status: 'processing' }, { status: 'timed_out' },
        { status: 'paused_price_change_requires_approval' }
    ]) assert.equal(summarizeResults([result]).hasUnexpectedResults, true, JSON.stringify(result));
});
