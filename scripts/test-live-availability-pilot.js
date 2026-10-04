const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');

function clearHotelbedsProcessEnvironment() {
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('HOTELBEDS_') || key === 'REMAL_SECURE_KEY') delete process.env[key];
    }
}

function clearHotelbedsRequireCache() {
    const prefixes = [
        path.join(projectRoot, 'services', 'hotelbeds'),
        path.join(projectRoot, 'models', 'Hotelbeds')
    ];
    for (const filename of Object.keys(require.cache)) {
        const normalized = path.resolve(filename);
        if (prefixes.some(prefix => normalized.startsWith(prefix))) delete require.cache[filename];
    }
}

function output(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function pilotDates(now = new Date()) {
    const checkIn = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    checkIn.setDate(checkIn.getDate() + 30);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 2);
    return { checkIn: formatDate(checkIn), checkOut: formatDate(checkOut) };
}

function missingPilotSettings(env = process.env) {
    const missing = [];
    const exactValues = [
        ['HOTELBEDS_ENABLED', 'true'],
        ['HOTELBEDS_ENV', 'test'],
        ['HOTELBEDS_AVAILABILITY_PILOT_ENABLED', 'true'],
        ['HOTELBEDS_PILOT_APPROVED', 'true'],
        ['HOTELBEDS_PILOT_PRICE_POLICY', 'supplier-raw-internal-only']
    ];
    for (const [key, expected] of exactValues) {
        if (String(env[key] || '').trim() !== expected) missing.push(key);
    }
    for (const key of ['HOTELBEDS_PILOT_HOTEL_CODES', 'HOTELBEDS_PILOT_LANGUAGE']) {
        if (!String(env[key] || '').trim()) missing.push(key);
    }
    if (String(env.HOTELBEDS_PILOT_OPERATOR_KEY || '').length < 32) {
        missing.push('HOTELBEDS_PILOT_OPERATOR_KEY');
    }
    if (!String(env.REMAL_SECURE_KEY || '').trim()) missing.push('REMAL_SECURE_KEY');

    const rawBudgets = String(env.HOTELBEDS_DAILY_BUDGETS || '').trim();
    try {
        const budgets = rawBudgets ? JSON.parse(rawBudgets) : null;
        if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)
            || !Object.keys(budgets).some(key => key.toLowerCase() === 'availability')) {
            missing.push('HOTELBEDS_DAILY_BUDGETS.availability');
        }
    } catch {
        missing.push('HOTELBEDS_DAILY_BUDGETS');
    }
    return [...new Set(missing)];
}

async function invokeServiceDirectly({ dates, pilot }) {
    if (String(process.env.HOTELBEDS_RUN_LIVE_PILOT || '') !== 'true') {
        return {
            ok: true,
            stage: 'preflight',
            liveRequestMade: false,
            databaseConnectionOpened: false,
            message: 'Set HOTELBEDS_RUN_LIVE_PILOT=true only after operator approval; this invocation is network-free.'
        };
    }
    return {
        ok: false,
        stage: 'preflight',
        liveRequestMade: false,
        databaseConnectionOpened: false,
        error: 'live_pilot_runner_disabled_until_isolation_review'
    };
}

async function main() {
    const dates = pilotDates();
    if (!fs.existsSync(envPath)) {
        output({ ok: false, stage: 'preflight', error: '.env file not found', ...dates });
        process.exitCode = 2;
        return;
    }

    // Remove inherited/stale values and cached integration modules first, then
    // load only the saved project .env. This script intentionally does not echo
    // any credential or operator-secret value.
    clearHotelbedsProcessEnvironment();
    clearHotelbedsRequireCache();
    const dotenv = require(path.join(projectRoot, 'node_modules', 'dotenv'));
    const loaded = dotenv.config({ path: envPath, override: true });
    if (loaded.error) {
        output({ ok: false, stage: 'preflight', error: 'dotenv_load_failed', detail: loaded.error.message, ...dates });
        process.exitCode = 2;
        return;
    }

    try {
        if (String(process.env.HOTELBEDS_MOCK_DATABASE_ENABLED || '') !== 'true') {
            throw Object.assign(new Error('hotelbeds_mock_database_disabled'), { code: 'hotelbeds_mock_database_disabled' });
        }
        const { mockMongoUriFrom } = require('./seed-mock-hotelbeds-content');
        mockMongoUriFrom(process.env);
        if (!process.env.REMAL_SECURE_KEY) throw new Error('api_key_server_configuration_missing');
        const { credentialsFrom, configurationFrom } = require(path.join(projectRoot, 'services', 'hotelbedsClient'));
        credentialsFrom(process.env);
        configurationFrom(process.env);
    } catch (error) {
        output({
            ok: false,
            stage: 'preflight',
            error: error.code || error.message || 'pilot_configuration_invalid',
            missingSettings: missingPilotSettings(process.env),
            checkIn: dates.checkIn,
            checkOut: dates.checkOut
        });
        process.exitCode = 2;
        return;
    }

    try {
        // This pilot runner must use the explicitly isolated mock DB and invoke
        // the service directly; never let an application HTTP server redirect it.
        const response = await invokeServiceDirectly({ dates });
        output({
            ...response,
            request: {
                checkIn: dates.checkIn,
                checkOut: dates.checkOut,
                rooms: 1,
                adults: 2,
                children: 0,
                path: 'network-free-preflight'
            }
        });
        if (response.ok === false || response.success === false) process.exitCode = 1;
    } catch (error) {
        output({
            ok: false,
            stage: 'availability',
            error: error.code || error.message || 'availability_pilot_failed',
            checkIn: dates.checkIn,
            checkOut: dates.checkOut
        });
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(error => {
        output({ ok: false, stage: 'script', error: error.code || 'pilot_script_failed' });
        process.exitCode = 1;
    });
}

module.exports = { missingPilotSettings, invokeServiceDirectly, main };