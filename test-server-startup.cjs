const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const root = __dirname;
const serverPath = path.join(root, 'server.js');

function isolatedEnvironment(overrides = {}) {
    return {
        NODE_ENV: 'test',
        NODE_PATH: path.join(root, 'node_modules'),
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        SYSTEMROOT: process.env.SYSTEMROOT,
        WINDIR: process.env.WINDIR,
        COMSPEC: process.env.COMSPEC,
        PATHEXT: process.env.PATHEXT,
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
        PORT: '0',
        RIMAL_STARTUP_PROBE: 'true',
        ...overrides
    };
}

function startIsolatedServer(overrides = {}) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rimal-startup-probe-'));
    const child = spawn(process.execPath, [serverPath], {
        cwd,
        env: isolatedEnvironment(overrides),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    return {
        child,
        cwd,
        get output() { return { stdout, stderr }; },
        exit,
        async stop() {
            if (child.exitCode === null && child.signalCode === null) child.kill();
            let killTimer;
            await Promise.race([exit, new Promise(resolve => {
                killTimer = setTimeout(resolve, 5000);
                killTimer.unref?.();
            })]);
            if (killTimer) clearTimeout(killTimer);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    };
}

function waitForOutput(server, expression, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        let interval;
        const finish = (error, output) => {
            clearTimeout(timer);
            clearInterval(interval);
            if (error) reject(error);
            else resolve(output);
        };
        const check = () => {
            const output = server.output.stdout + server.output.stderr;
            if (expression.test(output)) finish(null, output);
            else if (server.child.exitCode !== null) {
                finish(new Error(`server_exited_before_expected_output:${server.child.exitCode}`));
            }
        };
        const timer = setTimeout(() => finish(new Error('server_startup_timeout')), timeoutMs);
        interval = setInterval(check, 25);
        server.child.once('exit', check);
        check();
    });
}

function getJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { timeout: 3000, headers }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }); }
                catch (error) { reject(error); }
            });
            response.on('error', reject);
        });
        request.once('timeout', () => request.destroy(new Error('health_request_timeout')));
        request.once('error', reject);
    });
}

test('server keeps local HTTP health available and reports blocked readiness when realm is missing', async () => {
    const server = startIsolatedServer({
        MONGO_URI: 'mongodb://127.0.0.1:1/rimal_startup_probe?serverSelectionTimeoutMS=500',
        RIMAL_INTERNAL_API_KEY: 'internal-readiness-test-fixture-not-real-32chars'
    });
    try {
        const output = await waitForOutput(server, /server-startup-probe-listening:/);
        const port = Number(output.match(/server-startup-probe-listening:(\d+)/)?.[1]);
        assert(Number.isInteger(port) && port > 0);
        const health = await getJson(`http://127.0.0.1:${port}/api/v1/health`);
        assert.equal(health.status, 200);

        const readinessUrl = `http://127.0.0.1:${port}/api/v1/internal/health/readiness`;
        const readiness = await getJson(readinessUrl, {
            'x-internal-api-key': 'internal-readiness-test-fixture-not-real-32chars'
        });
        assert.equal(readiness.status, 503);
        assert.equal(readiness.body.startup.status, 'blocked');
        assert.equal(readiness.headers['cache-control'], 'no-store');
        assert.equal(readiness.body.overallStatus, 'blocked');
        assert.equal(readiness.body.externalConnectivity, 'not_tested');
        assert.equal(JSON.stringify(readiness.body).includes('mongodb://127.0.0.1:1/'), false);

        const originRequest = await getJson(readinessUrl, {
            'x-internal-api-key': 'internal-readiness-test-fixture-not-real-32chars',
            Origin: 'https://browser.example'
        });
        assert.equal(originRequest.status, 403);
        assert.equal(originRequest.body.error, 'server_to_server_only');
        assert.equal(originRequest.headers['cache-control'], 'no-store');
    } finally {
        await server.stop();
    }
});

test('server opens HTTP locally with a valid realm while MongoDB is unavailable', async () => {
    const server = startIsolatedServer({
        RIMAL_AUTH_REALM: 'startup-fixture',
        MONGO_URI: 'mongodb://127.0.0.1:1/rimal_startup_probe?serverSelectionTimeoutMS=500',
        PAYMENT_BOOKING_ENCRYPTION_KEY: 'ab'.repeat(32),
        RIMAL_INTERNAL_API_KEY: 'internal-readiness-test-fixture-not-real-32chars'
    });
    try {
        const output = await waitForOutput(server, /server-startup-probe-listening:/);
        const port = Number(output.match(/server-startup-probe-listening:(\d+)/)?.[1]);
        assert(Number.isInteger(port) && port > 0);
        const health = await getJson(`http://127.0.0.1:${port}/api/v1/health`);
        assert.equal(health.status, 200);
        assert.equal(health.body.status, 'ok');
        assert.notEqual(health.body.database, 'connected');
        assert.equal(output.includes('mongodb://127.0.0.1:1/'), false);

        const readinessUrl = `http://127.0.0.1:${port}/api/v1/internal/health/readiness`;
        const unauthorized = await getJson(readinessUrl);
        assert.equal(unauthorized.status, 401);
        const readiness = await getJson(readinessUrl, {
            'x-internal-api-key': 'internal-readiness-test-fixture-not-real-32chars'
        });
        assert.equal(readiness.status, 503);
        assert.equal(readiness.body.overallStatus, 'application_ready');
        assert.equal(readiness.body.application.status, 'ready');
        assert.equal(readiness.body.hotelbeds.status, 'disabled');
        assert.equal(readiness.headers['cache-control'], 'no-store');
        assert.notEqual(readiness.body.runtime.database, 'connected');
        assert.equal(readiness.body.externalConnectivity, 'not_tested');
        assert.equal(readiness.body.certification, 'not_claimed');
        assert.equal(JSON.stringify(readiness.body).includes('internal-readiness-test-fixture-not-real-32chars'), false);
        assert.equal(JSON.stringify(readiness.body).includes('rimal_startup_probe'), false);
    } finally {
        await server.stop();
    }
});