/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, 'appUpdateModel.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module_ = { exports: {} };
new Function('require', 'module', 'exports', output)(require, module_, module_.exports);
const { normalizeRelease, updateDecision } = module_.exports;

const url = 'https://github.com/owner/repo/releases/download/app-preview-0.38.0/app.apk';
const answer = { android: { latestVersionCode: 38, latestVersion: '0.38.0', minimumVersionCode: 30, downloadUrl: url } };

test('a valid server answer becomes a release; anything else is ignored', () => {
  assert.deepEqual(normalizeRelease(answer), { latestVersionCode: 38, latestVersion: '0.38.0', minimumVersionCode: 30, downloadUrl: url });
  for (const bad of [null, {}, { android: null }, { android: { ...answer.android, latestVersionCode: '38' } },
    { android: { ...answer.android, latestVersion: 'new' } }, { android: { ...answer.android, downloadUrl: 'http://github.com/a.apk' } },
    { android: { ...answer.android, downloadUrl: 'https://evil.example/a.apk' } }, { android: { ...answer.android, downloadUrl: 'javascript:alert(1)' } }])
    assert.equal(normalizeRelease(bad), null);
  assert.equal(normalizeRelease({ android: { ...answer.android, minimumVersionCode: 99 } }).minimumVersionCode, 38);
});

test('older builds are offered the update, builds below the minimum must update, and Later hides that version only', () => {
  const release = normalizeRelease(answer);
  assert.equal(updateDecision(37, release), 'optional');
  assert.equal(updateDecision(29, release), 'required');
  assert.equal(updateDecision(29, release, 38), 'required', 'a required update cannot be set aside');
  assert.equal(updateDecision(37, release, 38), 'none');
  assert.equal(updateDecision(37, release, 37), 'optional', 'setting aside an older release does not hide a newer one');
  assert.equal(updateDecision(38, release), 'none');
  assert.equal(updateDecision(39, release), 'none');
  assert.equal(updateDecision(null, release), 'none');
  assert.equal(updateDecision(37, null), 'none');
});
