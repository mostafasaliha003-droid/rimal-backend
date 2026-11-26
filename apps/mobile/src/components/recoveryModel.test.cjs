/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const crash = load(path.resolve(__dirname, './crashReportModel.ts'));
const transport = load(path.resolve(__dirname, '../api/transport.ts'));
const { createApiClient } = load(path.resolve(__dirname, '../api/client.ts'));

test('password recovery: only the two reset routes are reachable, both as POST', () => {
  assert.equal(transport.allowedRoute('POST', '/auth/password/forgot'), true);
  assert.equal(transport.allowedRoute('POST', '/auth/password/reset'), true);
  assert.equal(transport.allowedRoute('GET', '/auth/password/forgot'), false);
  assert.equal(transport.allowedRoute('POST', '/auth/password'), false);
});

test('password recovery: the client sends a clean e-mail, checks code and length, and signs in with the answer', async () => {
  const calls = [];
  const token = 'c'.repeat(64);
  const request = async (method, route, options) => { calls.push({ method, route, options });
    return route === '/auth/password/reset' ? { success: true, access_token: token, user: { id: 'u1', name: 'Layla', email: 'layla@example.test' } } : { success: true }; };
  const { auth } = createApiClient(request);
  await auth.requestPasswordReset(' Layla@Example.test ');
  assert.deepEqual(calls[0].options.body, { email: 'layla@example.test' });
  assert.equal(calls[0].options.anonymous, true);
  await assert.rejects(auth.requestPasswordReset('not-an-email'), /invalid_email/);
  await assert.rejects(auth.resetPassword('layla@example.test', '12345', 'a-long-password'), /invalid_reset_code/);
  await assert.rejects(auth.resetPassword('layla@example.test', '123456', 'short'), /invalid_password/);
  const signedIn = await auth.resetPassword('layla@example.test', '123456', 'a-long-password');
  assert.equal(signedIn.token, token);
  assert.deepEqual(calls.at(-1).options.body, { email: 'layla@example.test', code: '123456', password: 'a-long-password' });
});

test('crash reports carry no guest details and name screens, not references', () => {
  const error = new TypeError('Cannot read booking for layla@example.test, phone +971 50 123 4567, token ' + 'ab'.repeat(16));
  error.stack = 'TypeError: x\n    at BookingCard (bundle.js:10:5)\n    at layla@example.test';
  const report = crash.buildCrashReport(error, { fatal: true, version: '0.60.0', platform: 'android', route: '/care/7de781a0b2c4d6e8' });
  assert.equal(report.fatal, true); assert.equal(report.version, '0.60.0'); assert.equal(report.platform, 'android');
  assert.equal(report.route, '/care/[id]');
  assert.match(report.message, /^TypeError: Cannot read booking for \[email\], phone \[number\], token \[token\]$/);
  assert.doesNotMatch(report.stack, /layla/);
  assert.equal(crash.buildCrashReport('boom', { fatal: false, version: 'dev', platform: 'tv', route: 'nope' }).version, 'unknown');
  assert.equal(crash.reportRoute('/hotel/123'), '/hotel/123');
  assert.equal(crash.reportRoute('https://evil.example'), '');
});

test('the same failure is reported once per session, eight distinct failures at most, and sending never throws', async () => {
  const sent = [];
  const report = crash.createCrashReporter({ context: () => ({ version: '0.60.0', platform: 'android', route: '/' }),
    send: async value => { sent.push(value); throw new Error('offline'); } });
  const same = () => new Error('same');
  assert.equal(report(same()), true);
  assert.equal(report(same()), false, 'the same error from the same place');
  for (let i = 0; i < 20; i++) report(new Error(`distinct ${String.fromCharCode(97 + i)}`));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 8);
  const throwing = crash.createCrashReporter({ context: () => ({ version: '1.0.0', platform: 'web', route: '' }), send: () => { throw new Error('sync'); } });
  assert.doesNotThrow(() => throwing(new Error('x')));
});
