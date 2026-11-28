'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { createAttempt, checkpointAttempt, verifyAndPublish } = require('../android-preview-attempt.cjs');

const TEMP_BASE = path.resolve(os.tmpdir());
const OWNED_PREFIX = 'mkhadda-preview-attempt-test-';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(TEMP_BASE, OWNED_PREFIX));
  t.after(() => {
    const absolute = path.resolve(directory);
    // Verify the exact owned child before any recursive removal, including on Windows.
    assert.equal(path.dirname(absolute), TEMP_BASE);
    assert.ok(path.basename(absolute).startsWith(OWNED_PREFIX));
    assert.ok(path.basename(absolute).length > OWNED_PREFIX.length);
    assert.ok(fs.lstatSync(absolute).isDirectory());
    assert.equal(fs.lstatSync(absolute).isSymbolicLink(), false);
    const relative = path.relative(fs.realpathSync(TEMP_BASE), fs.realpathSync(absolute));
    assert.equal(relative, path.basename(absolute));
    fs.rmSync(absolute, { recursive: true, maxRetries: 3, retryDelay: 100 });
  });

  const outputDirectory = path.join(directory, 'published');
  const projectDirectory = path.join(directory, 'project');
  fs.mkdirSync(outputDirectory);
  fs.mkdirSync(projectDirectory);
  const previousApk = Buffer.from('previous verified artifact');
  const previousReceipt = JSON.stringify({
    verificationKind: 'independent-post-build-verification',
    sourceCommit: '18163f977848983712085364e6d1ccdd511ad7d0',
    automaticSourceFingerprintGuardReached: false,
    sourceStateUnchangedDuringBuild: null,
  });
  fs.writeFileSync(path.join(outputDirectory, 'mkhadda-preview.apk'), previousApk);
  fs.writeFileSync(path.join(outputDirectory, 'build-receipt.json'), previousReceipt);
  const apkPath = path.join(directory, 'fixture-Gradle-output.apk');
  const candidate = Buffer.alloc(2048, 0x5a);
  fs.writeFileSync(apkPath, candidate);
  const source = { commit: 'a'.repeat(40), dirty: false, treeSha256: 'b'.repeat(64), fileCount: 12 };
  const template = { keySha256: sha256('fixture template bytes'), signerSha256: 'c'.repeat(64) };
  const attempt = createAttempt({ outputDirectory, projectDirectory, sourceBefore: source, toolchain: { fixtureOnly: true } });
  const checkpoint = (sourceAfter = source) => checkpointAttempt(attempt, {
    apkPath, readSourceAfter: () => ({ ...sourceAfter }), template,
    gradle: { exitCode: 0, task: ':app:assembleRelease' },
  });
  const verified = () => ({
    metadata: { applicationId: 'app.pillowstays.preview', architectures: ['arm64-v8a'] },
    signerSha256: template.signerSha256,
  });
  const publish = (verifyCandidate = verified) => verifyAndPublish(attempt.checkpointPath, {
    projectDirectory, templateKeySha256: template.keySha256, verifyCandidate, mode: 'verify-only',
  });
  const assertPrevious = () => {
    assert.deepEqual(fs.readFileSync(path.join(outputDirectory, 'mkhadda-preview.apk')), previousApk);
    assert.equal(fs.readFileSync(path.join(outputDirectory, 'build-receipt.json'), 'utf8'), previousReceipt);
  };
  return { outputDirectory, projectDirectory, previousReceipt, candidate, source, template, attempt, checkpoint, publish, verified, assertPrevious };
}

test('source changes preserve the candidate but make its checkpoint ineligible', (t) => {
  const f = fixture(t);
  assert.throws(() => f.checkpoint({ ...f.source, treeSha256: 'd'.repeat(64) }), /source changed/);
  assert.deepEqual(fs.readFileSync(f.attempt.candidatePath), f.candidate);
  assert.equal(JSON.parse(fs.readFileSync(f.attempt.checkpointPath)).eligible, false);
  let calls = 0;
  assert.throws(() => f.publish(() => { calls += 1; return f.verified(); }), /source-matched/);
  assert.equal(calls, 0);
  f.assertPrevious();
});

test('candidate hash tampering fails before verification or publication', (t) => {
  const f = fixture(t);
  f.checkpoint();
  fs.writeFileSync(f.attempt.candidatePath, Buffer.alloc(f.candidate.length, 0x33));
  let calls = 0;
  assert.throws(() => f.publish(() => { calls += 1; return f.verified(); }), /does not match/);
  assert.equal(calls, 0);
  f.assertPrevious();
});

test('the initial source record cannot be changed after checkpoint creation', (t) => {
  const f = fixture(t);
  f.checkpoint();
  fs.appendFileSync(f.attempt.beforePath, '\n');
  assert.throws(f.publish, /source record changed/);
  f.assertPrevious();
});

test('checkpoint tampering fails its integrity check', (t) => {
  const f = fixture(t);
  f.checkpoint();
  const checkpoint = JSON.parse(fs.readFileSync(f.attempt.checkpointPath));
  checkpoint.sourceAfter.commit = 'e'.repeat(40);
  fs.writeFileSync(f.attempt.checkpointPath, JSON.stringify(checkpoint));
  assert.throws(f.publish, /integrity/);
  f.assertPrevious();
});

test('verifier failure preserves the prior pair and leaves a retryable candidate', (t) => {
  const f = fixture(t);
  f.checkpoint();
  const checkpointBefore = fs.readFileSync(f.attempt.checkpointPath);
  assert.throws(() => f.publish(() => { throw new Error('fixture verifier failure'); }), /fixture verifier/);
  f.assertPrevious();
  assert.deepEqual(fs.readFileSync(f.attempt.checkpointPath), checkpointBefore);
  assert.deepEqual(fs.readFileSync(f.attempt.candidatePath), f.candidate);
  const retry = f.publish();
  assert.equal(retry.receipt.sourceCommit, f.source.commit);
  assert.equal(retry.receipt.verificationMode, 'verify-only');
});

test('a candidate changed by a verifier cannot be promoted', (t) => {
  const f = fixture(t);
  f.checkpoint();
  assert.throws(() => f.publish(() => {
    fs.appendFileSync(f.attempt.candidatePath, 'changed during tool execution');
    return f.verified();
  }), /does not match/);
  f.assertPrevious();
});

test('successful publication preserves exact candidate bytes and checkpoint provenance', (t) => {
  const f = fixture(t);
  f.checkpoint();
  const checkpointBefore = fs.readFileSync(f.attempt.checkpointPath);
  const result = f.publish();
  assert.deepEqual(fs.readFileSync(result.apkPath), f.candidate);
  const receipt = JSON.parse(fs.readFileSync(result.receiptPath));
  assert.equal(receipt.sha256, sha256(f.candidate));
  assert.equal(receipt.bytes, f.candidate.length);
  assert.equal(receipt.sourceCommit, f.source.commit);
  assert.equal(receipt.sourceTreeSha256, f.source.treeSha256);
  assert.equal(receipt.automaticSourceFingerprintGuardReached, true);
  assert.deepEqual(fs.readFileSync(f.attempt.candidatePath), f.candidate);
  assert.deepEqual(fs.readFileSync(f.attempt.checkpointPath), checkpointBefore);
});

test('a historical independent receipt cannot be upgraded using a current source record', (t) => {
  const f = fixture(t);
  // A current before-source record exists, but no matching build checkpoint does.
  fs.writeFileSync(f.attempt.checkpointPath, f.previousReceipt);
  let calls = 0;
  assert.throws(() => f.publish(() => { calls += 1; return f.verified(); }), /integrity/);
  assert.equal(calls, 0);
  f.assertPrevious();
});
