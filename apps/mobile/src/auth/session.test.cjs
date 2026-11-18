/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const full = path.resolve(__dirname, file);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} }; cache.set(full, module);
  const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', output)(name => name.startsWith('.') ? load(path.resolve(path.dirname(full), name + '.ts')) : require(name), module, module.exports);
  return module.exports;
}
const { createSessionManager } = load('./session.ts');
const { ApiError } = load('../api/errors.ts');
const user = { name: 'Fixture', email: 'fixture@example.test' };
const token = 'a'.repeat(64);
function setup(session) {
  let stored = token;
  const storage = { get: async () => stored, set: async value => { stored = value; }, clear: async () => { stored = null; } };
  const network = { session, login: async () => ({ user, token }), logout: async () => {}, requestRegistration: async () => {}, verifyRegistration: async () => ({ user, token }) };
  return { manager: createSessionManager(network, storage), network, stored: () => stored };
}
test('failed restoration cannot leave authenticated transport behind a signed-out UI; explicit retry revalidates encrypted credential', async () => {
  let fail = true;
  const f = setup(async () => { if (fail) throw new ApiError('timeout', 'request_timeout'); return user; });
  await f.manager.restore();
  assert.equal(f.manager.getSnapshot().status, 'signedOut');
  assert.equal(f.manager.getSnapshot().restorePending, true);
  assert.equal(await f.manager.getToken(), null);
  assert.equal(f.stored(), token);
  fail = false; await f.manager.restore();
  assert.equal(f.manager.getSnapshot().status, 'signedIn');
  assert.equal(f.manager.getSnapshot().restorePending, undefined);
  assert.equal(await f.manager.getToken(), token);
});
test('a failed older restore cannot quarantine a newer successful sign-in', async () => {
  let reject;
  const held = new Promise((_resolve, fail) => { reject = fail; });
  const f = setup(() => held);
  const restoring = f.manager.restore(); await new Promise(resolve => setImmediate(resolve));
  await f.manager.signIn('fixture@example.test', 'fixture-password');
  reject(new ApiError('network', 'network_unavailable')); await restoring;
  assert.equal(f.manager.getSnapshot().status, 'signedIn');
  assert.equal(await f.manager.getToken(), token);
});
test('explicit sign-out revokes the quarantined stored credential after restoration failed', async () => {
  const f = setup(async () => { throw new ApiError('network', 'network_unavailable'); });
  let revoked = null; f.network.logout = async value => { revoked = value; };
  await f.manager.restore(); assert.equal(await f.manager.getToken(), null);
  await f.manager.signOut(); assert.equal(revoked, token); assert.equal(f.stored(), null);
});

test('reopening restores validated identity from the saved session and sign-out prevents it from reappearing', async () => {
  let persisted = null;
  const storage = { get: async () => persisted, set: async value => { persisted = value; }, clear: async () => { persisted = null; } };
  const f = setup(async () => user);
  const original = createSessionManager(f.network, storage);
  await original.signIn('fixture@example.test', 'fixture-password');
  const reopened = createSessionManager(f.network, storage);
  assert.equal(reopened.getSnapshot().user, null);
  await reopened.restore();
  assert.deepEqual(reopened.getSnapshot(), { status: 'signedIn', user, error: null });
  await reopened.signOut();
  const signedOut = createSessionManager(f.network, storage);
  await signedOut.restore();
  assert.deepEqual(signedOut.getSnapshot(), { status: 'signedOut', user: null, error: null });
});

test('an expired session or a failed sign-in is not presented as a recoverable stored identity', async () => {
  const f = setup(async () => { throw new ApiError('auth', 'session_expired', 401); });
  await f.manager.restore();
  assert.equal(f.manager.getSnapshot().restorePending, undefined);
  f.network.login = async () => { throw new ApiError('network', 'network_unavailable'); };
  await assert.rejects(f.manager.signIn('fixture@example.test', 'fixture-password'));
  assert.equal(f.manager.getSnapshot().restorePending, undefined);
  assert.equal(f.manager.getSnapshot().user, null);
});
