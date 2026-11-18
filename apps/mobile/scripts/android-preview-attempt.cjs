'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');

const KIND = 'mkhadda-preview-build-checkpoint';
const SCHEMA = 1;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const isHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equalSource = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validateSource(source) {
  if (!source || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.commit) || !isHash(source.treeSha256) || typeof source.dirty !== 'boolean' || !Number.isSafeInteger(source.fileCount) || source.fileCount < 1) {
    throw new Error('Invalid source fingerprint in build attempt.');
  }
}

function atomicJson(filename, value) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try { fs.renameSync(temporary, filename); }
  catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
}

function seal(payload) {
  return { ...payload, integritySha256: sha256(JSON.stringify(payload)) };
}

function regularFile(filename) {
  if (!fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) throw new Error(`Required regular attempt file is missing: ${filename}`);
  return fs.readFileSync(filename);
}

function fileIdentity(filename) {
  if (!fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) throw new Error(`Required regular attempt file is missing: ${filename}`);
  const before = fs.statSync(filename);
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(filename, 'r');
  try { for (let bytes; (bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) digest.update(buffer.subarray(0, bytes)); }
  finally { fs.closeSync(fd); }
  const after = fs.statSync(filename);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Candidate changed while its identity was read.');
  return { bytes: after.size, sha256: digest.digest('hex') };
}

function createAttempt({ outputDirectory, projectDirectory, sourceBefore, toolchain, nativeStagingRoot, requestedCmakeObjectPathMax }) {
  validateSource(sourceBefore);
  const id = crypto.randomUUID();
  const directory = path.join(path.resolve(outputDirectory), 'attempts', id);
  fs.mkdirSync(directory, { recursive: true });
  const before = {
    schemaVersion: SCHEMA, kind: 'mkhadda-preview-source-before', id,
    projectDirectory: path.resolve(projectDirectory), createdAt: new Date().toISOString(),
    source: sourceBefore, environment: 'staging', toolchain,
    nativeStagingRoot: nativeStagingRoot || null,
    requestedCmakeObjectPathMax: requestedCmakeObjectPathMax || null,
  };
  const beforePath = path.join(directory, 'source-before.json');
  atomicJson(beforePath, before);
  return { id, directory, beforePath, checkpointPath: path.join(directory, 'checkpoint.json'), candidatePath: path.join(directory, 'candidate.unverified.apk') };
}

function checkpointAttempt(attempt, { apkPath, readSourceAfter, template, gradle }) {
  const beforeBytes = regularFile(attempt.beforePath);
  const before = JSON.parse(beforeBytes);
  if (before.id !== attempt.id || before.kind !== 'mkhadda-preview-source-before' || before.schemaVersion !== SCHEMA) throw new Error('Invalid initial attempt record.');
  validateSource(before.source);
  if (gradle?.exitCode !== 0 || !isHash(template?.keySha256) || !isHash(template?.signerSha256)) throw new Error('Successful Gradle/template evidence is required before checkpointing.');
  fs.copyFileSync(apkPath, attempt.candidatePath, fs.constants.COPYFILE_EXCL);
  const sourceAfter = readSourceAfter();
  validateSource(sourceAfter);
  const candidate = fileIdentity(attempt.candidatePath);
  if (candidate.bytes < 1024) throw new Error('Gradle candidate is empty or implausibly small.');
  const eligible = equalSource(before.source, sourceAfter);
  const checkpoint = seal({
    schemaVersion: SCHEMA, kind: KIND, id: attempt.id, createdAt: new Date().toISOString(),
    projectDirectory: before.projectDirectory, environment: 'staging',
    stage: eligible ? 'gradle-succeeded-source-matched' : 'gradle-succeeded-source-changed', eligible,
    sourceBeforeSha256: sha256(beforeBytes), sourceAfter,
    candidate: { filename: 'candidate.unverified.apk', ...candidate },
    template, gradle,
  });
  atomicJson(attempt.checkpointPath, checkpoint);
  if (!eligible) throw new Error(`Application source changed during the build; candidate retained but checkpoint is ineligible: ${attempt.checkpointPath}`);
  return attempt.checkpointPath;
}

function loadAttempt(checkpointPath, { projectDirectory, templateKeySha256 }) {
  const filename = path.resolve(checkpointPath);
  const directory = path.dirname(filename);
  if (path.basename(filename) !== 'checkpoint.json' || path.basename(path.dirname(directory)) !== 'attempts') throw new Error('Expected an immutable build-attempt checkpoint path.');
  const checkpoint = JSON.parse(regularFile(filename));
  const { integritySha256, ...payload } = checkpoint;
  if (!isHash(integritySha256) || sha256(JSON.stringify(payload)) !== integritySha256) throw new Error('Build checkpoint integrity check failed.');
  if (checkpoint.schemaVersion !== SCHEMA || checkpoint.kind !== KIND || checkpoint.id !== path.basename(directory) || checkpoint.projectDirectory !== path.resolve(projectDirectory) || checkpoint.environment !== 'staging') throw new Error('Checkpoint is not an eligible preview build record for this project.');
  if (checkpoint.eligible !== true || checkpoint.stage !== 'gradle-succeeded-source-matched' || checkpoint.gradle?.exitCode !== 0) throw new Error('Checkpoint has no successful source-matched Gradle build.');
  const beforePath = path.join(directory, 'source-before.json');
  const beforeBytes = regularFile(beforePath);
  if (sha256(beforeBytes) !== checkpoint.sourceBeforeSha256) throw new Error('Initial source record changed after checkpoint creation.');
  const before = JSON.parse(beforeBytes);
  if (before.id !== checkpoint.id || before.schemaVersion !== SCHEMA || before.kind !== 'mkhadda-preview-source-before' || before.projectDirectory !== checkpoint.projectDirectory || before.environment !== 'staging') throw new Error('Initial source record does not match the checkpoint.');
  validateSource(before.source);
  validateSource(checkpoint.sourceAfter);
  if (!equalSource(before.source, checkpoint.sourceAfter)) throw new Error('Checkpoint source fingerprints do not match.');
  if (!isHash(checkpoint.template?.signerSha256) || !isHash(templateKeySha256) || checkpoint.template?.keySha256 !== templateKeySha256) throw new Error('Checkpoint template key does not match the installed Expo template.');
  if (checkpoint.candidate?.filename !== 'candidate.unverified.apk' || !isHash(checkpoint.candidate.sha256) || !Number.isSafeInteger(checkpoint.candidate.bytes) || checkpoint.candidate.bytes < 1024) throw new Error('Invalid checkpoint candidate identity.');
  const candidatePath = path.join(directory, checkpoint.candidate.filename);
  const candidate = fileIdentity(candidatePath);
  if (candidate.bytes !== checkpoint.candidate.bytes || candidate.sha256 !== checkpoint.candidate.sha256) throw new Error('Candidate APK does not match its successful build checkpoint.');
  return { directory, checkpointPath: filename, candidatePath, checkpoint, before, outputDirectory: path.dirname(path.dirname(directory)) };
}

function publishPair(attempt, receipt) {
  const directory = attempt.outputDirectory;
  const apkPath = path.join(directory, 'mkhadda-preview.apk');
  const receiptPath = path.join(directory, 'build-receipt.json');
  const token = crypto.randomUUID();
  const apkBackup = path.join(attempt.directory, `previous-verified.${token}.apk`);
  const receiptBackup = path.join(attempt.directory, `previous-build-receipt.${token}.json`);
  const stagedApk = path.join(directory, `.mkhadda-preview.${token}.tmp`);
  const stagedReceipt = path.join(directory, `.build-receipt.${token}.tmp`);
  const hadApk = fs.existsSync(apkPath);
  const hadReceipt = fs.existsSync(receiptPath);
  if (hadApk) fs.copyFileSync(apkPath, apkBackup);
  if (hadReceipt) fs.copyFileSync(receiptPath, receiptBackup);
  let apkReplaced = false;
  let receiptReplaced = false;
  try {
    fs.copyFileSync(attempt.candidatePath, stagedApk, fs.constants.COPYFILE_EXCL);
    const stagedIdentity = fileIdentity(stagedApk);
    if (stagedIdentity.sha256 !== receipt.sha256 || stagedIdentity.bytes !== receipt.bytes) throw new Error('Staged APK differs from the verified candidate.');
    fs.writeFileSync(stagedReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(stagedApk, apkPath);
    apkReplaced = true;
    fs.renameSync(stagedReceipt, receiptPath);
    receiptReplaced = true;
  } catch (error) {
    try {
      if (apkReplaced) { if (hadApk) fs.copyFileSync(apkBackup, apkPath); else fs.rmSync(apkPath, { force: true }); }
      if (receiptReplaced) { if (hadReceipt) fs.copyFileSync(receiptBackup, receiptPath); else fs.rmSync(receiptPath, { force: true }); }
    } catch (rollbackError) {
      throw new Error(`Publication failed and restoration needs operator attention; prior files remain backed up in ${attempt.directory}: ${error.message}; ${rollbackError.message}`);
    }
    throw error;
  } finally {
    fs.rmSync(stagedApk, { force: true });
    fs.rmSync(stagedReceipt, { force: true });
  }
  return { apkPath, receiptPath };
}

function verifyAndPublish(checkpointPath, { projectDirectory, templateKeySha256, verifyCandidate, mode }) {
  if (!['build-and-verify', 'verify-only'].includes(mode)) throw new Error('Unknown preview verification mode.');
  const attempt = loadAttempt(checkpointPath, { projectDirectory, templateKeySha256 });
  const verificationDirectory = path.join(attempt.directory, `verification-${crypto.randomUUID()}`);
  fs.mkdirSync(verificationDirectory);
  const verified = verifyCandidate(attempt, verificationDirectory);
  if (verified.signerSha256 !== attempt.checkpoint.template.signerSha256) throw new Error('Verified signer differs from the checkpointed template signer.');
  // Check again after external tools, before publishing; never relabel a changed candidate.
  const checked = loadAttempt(checkpointPath, { projectDirectory, templateKeySha256 });
  if (checked.checkpoint.integritySha256 !== attempt.checkpoint.integritySha256) throw new Error('Checkpoint changed during verification.');
  const receipt = {
    schemaVersion: 2, verificationKind: 'source-checkpoint-backed-verification',
    verificationMode: mode, createdAt: new Date().toISOString(), ...verified.metadata,
    sourceCommit: attempt.before.source.commit, sourceWorkingTreeDirty: attempt.before.source.dirty,
    sourceTreeSha256: attempt.before.source.treeSha256, sourceFileCount: attempt.before.source.fileCount,
    automaticSourceFingerprintGuardReached: true, sourceStateUnchangedDuringBuild: true,
    sourceFingerprintBoundary: 'before prebuild / immediately after Gradle candidate preservation',
    attemptCheckpoint: path.relative(attempt.outputDirectory, attempt.checkpointPath),
    attemptCheckpointSha256: sha256(regularFile(attempt.checkpointPath)),
    verificationEvidence: path.relative(attempt.outputDirectory, verificationDirectory),
    candidateSha256: attempt.checkpoint.candidate.sha256,
    environment: 'staging', toolchain: attempt.before.toolchain,
    nativeStagingRoot: attempt.before.nativeStagingRoot,
    requestedCmakeObjectPathMax: attempt.before.requestedCmakeObjectPathMax,
    gradle: attempt.checkpoint.gradle,
    signing: 'installed Expo template debug key; test-only, not a Play upload key',
    signerSha256: verified.signerSha256, templateDebugKeyBytesMatched: true,
    templateDebugKeySha256: attempt.checkpoint.template.keySha256,
    bundledJavaScript: true, signatureVerified: true,
    manifestIdentityAndPermissionsVerified: true, nativeAbisVerified: true,
    javaKotlinMinification: false, cloudBuildUsed: false, expoAccountRequired: false,
    sha256: attempt.checkpoint.candidate.sha256, bytes: attempt.checkpoint.candidate.bytes,
    deviceRuntimeVerified: false, productionReleaseReady: false,
  };
  return { receipt, ...publishPair(attempt, receipt), checkpointPath: attempt.checkpointPath };
}

module.exports = { createAttempt, checkpointAttempt, loadAttempt, verifyAndPublish };
