#!/usr/bin/env node
/* Local Windows staging build. No Expo account or cloud build is used. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const PROJECT = path.resolve(__dirname, '..');
const APPLICATION_ID = 'com.remalbookings.app.preview';
const ARCHITECTURES = ['arm64-v8a'];
const CMAKE_VERSION = '3.31.6';
const FORBIDDEN_PERMISSIONS = new Set([
  'CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION', 'READ_CONTACTS', 'WRITE_CONTACTS',
  'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES',
  'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'SYSTEM_ALERT_WINDOW',
].map((name) => `android.permission.${name}`));

function parseArgs(args) {
  const result = { output: path.join(PROJECT, '.test-output', 'android-preview'), windowsTrust: false };
  const values = new Map([['--sdk', 'sdk'], ['--jdk', 'jdk'], ['--gradle-cache', 'gradleCache'], ['--output', 'output'], ['--ninja', 'ninja'], ['--native-staging-root', 'nativeStagingRoot']]);
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--windows-trust') { result.windowsTrust = true; continue; }
    const key = values.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--native-staging-root' && !path.isAbsolute(value)) throw new Error('--native-staging-root must be an absolute directory path.');
    result[key] = path.resolve(value);
  }
  for (const key of ['sdk', 'jdk', 'gradleCache']) {
    if (!result[key]) throw new Error(`Required argument: ${[...values].find(([, value]) => value === key)[0]}`);
  }
  return result;
}

function runChecked(executable, args, options = {}) {
  const { capture = false, includeStderr = false, ...settings } = options;
  const result = spawnSync(executable, args, {
    cwd: PROJECT, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8', ...settings, shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) throw new Error(`Cannot launch ${path.basename(executable)}: ${result.error.message}`);
  if (result.signal || result.status !== 0) {
    const details = capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${path.basename(executable)} failed (${result.signal || result.status}).${details}`);
  }
  return capture ? `${result.stdout || ''}${includeStderr ? result.stderr || '' : ''}` : '';
}

function requireFile(filename, description) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error(`${description} not found: ${filename}`);
  return filename;
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function sourceState(env) {
  const git = process.platform === 'win32' ? 'git.exe' : 'git';
  const gitRun = (args) => runChecked(git, args, { env, capture: true });
  const commit = gitRun(['rev-parse', 'HEAD']).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Cannot record source revision.');
  const status = gitRun(['status', '--porcelain=v1', '-z', '--', '.']);
  const files = gitRun(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.']).split('\0').filter(Boolean).sort();
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    const absolute = path.resolve(PROJECT, relative);
    if (!absolute.startsWith(`${PROJECT}${path.sep}`)) throw new Error('Source path escapes the application directory.');
    hash.update(relative).update('\0');
    if (!fs.existsSync(absolute)) { hash.update('deleted\0'); continue; }
    const contents = fs.readFileSync(absolute);
    hash.update(String(contents.length)).update('\0').update(contents).update('\0');
  }
  return { commit, dirty: Boolean(status), treeSha256: hash.digest('hex'), fileCount: files.length };
}

function readTemplateDebugKey(templateArchive) {
  const tar = zlib.gunzipSync(fs.readFileSync(templateArchive));
  for (let position = 0; position + 512 <= tar.length;) {
    const name = tar.subarray(position, position + 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const size = Number.parseInt(tar.subarray(position + 124, position + 136).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || position + 512 + size > tar.length) throw new Error('Invalid installed Expo template archive.');
    if (name === 'package/android/app/debug.keystore') return tar.subarray(position + 512, position + 512 + size);
    position += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Installed Expo template contains no debug keystore.');
}

function verifyApkMetadata(badging, entriesText) {
  const packageLine = badging.match(/^package:.*$/m)?.[0] || '';
  const applicationId = packageLine.match(/\bname='([^']+)'/)?.[1];
  if (applicationId !== APPLICATION_ID) throw new Error('Unexpected APK application ID.');
  const minimumDeclarations = badging.split(/\r?\n/).filter((line) => /^[\t ]*(?:sdkVersion|minSdkVersion)\b/.test(line));
  if (minimumDeclarations.length !== 1) throw new Error('Expected exactly one minimum SDK declaration.');
  const minSdk = minimumDeclarations[0].match(/^(?:sdkVersion|minSdkVersion):'([0-9]+)'$/)?.[1];
  const targetSdk = badging.match(/^targetSdkVersion:'([^']+)'\r?$/m)?.[1];
  if (minSdk !== '24' || targetSdk !== '36') throw new Error('Unexpected APK SDK levels.');
  const compileSdk = packageLine.match(/\bcompileSdkVersion='([^']+)'/)?.[1];
  if (compileSdk && compileSdk !== '37') throw new Error('Unexpected APK compile SDK.');
  const permissions = [...badging.matchAll(/^uses-permission(?:-sdk-\d+)?: name='([^']+)'/gm)].map((match) => match[1]);
  const forbidden = permissions.filter((permission) => FORBIDDEN_PERMISSIONS.has(permission));
  if (forbidden.length) throw new Error(`Unexpected sensitive APK permissions: ${forbidden.join(', ')}`);
  if (!permissions.includes('android.permission.INTERNET')) throw new Error('The preview APK requires Internet permission.');
  const entries = entriesText.split(/\r?\n/).filter(Boolean);
  if (!entries.includes('assets/index.android.bundle')) throw new Error('APK contains no bundled JavaScript.');
  const architectures = [...new Set(entries.flatMap((entry) => entry.match(/^lib\/([^/]+)\/[^/]+\.so$/)?.[1] || []))].sort();
  if (JSON.stringify(architectures) !== JSON.stringify([...ARCHITECTURES].sort())) throw new Error(`Unexpected APK ABIs: ${architectures.join(', ')}`);
  return { applicationId, minSdk: Number(minSdk), targetSdk: Number(targetSdk), compileSdk: compileSdk ? Number(compileSdk) : null, permissions, architectures };
}

function verifySigner(apkSignature, keyDescription) {
  const expected = keyDescription.match(/^\s*SHA256:\s*([a-f0-9:]+)\s*$/im)?.[1]?.replaceAll(':', '').toLowerCase();
  const signers = [...apkSignature.matchAll(/^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]+)\s*$/gim)];
  if (!expected || expected.length !== 64 || signers.length !== 1 || signers[0][1] !== '1' || signers[0][2].toLowerCase() !== expected) {
    throw new Error('APK signer does not match the installed Expo template debug key.');
  }
  return expected;
}

function verifyNinjaVersion(output) {
  const version = output.trim();
  if (version !== '1.13.2') {
    throw new Error('This Windows preview requires the verified Ninja 1.13.2; use --ninja with its executable. Version 1.12.1 also failed the observed long-path probe.');
  }
  return version;
}

function buildPreview(options) {
  if (process.platform !== 'win32') throw new Error('This local preview procedure targets Windows SDK/JDK executables.');
  const java = requireFile(path.join(options.jdk, 'bin', 'java.exe'), 'JDK java.exe');
  const jar = requireFile(path.join(options.jdk, 'bin', 'jar.exe'), 'JDK jar.exe');
  const keytool = requireFile(path.join(options.jdk, 'bin', 'keytool.exe'), 'JDK keytool.exe');
  const tools = path.join(options.sdk, 'build-tools', '37.0.0');
  const aapt = requireFile(path.join(tools, 'aapt2.exe'), 'Android Build Tools 37.0.0');
  const apkSigner = requireFile(path.join(tools, 'lib', 'apksigner.jar'), 'APK signer JAR');
  requireFile(path.join(options.sdk, 'cmake', CMAKE_VERSION, 'bin', 'cmake.exe'), `CMake ${CMAKE_VERSION}`);
  const ninja = requireFile(options.ninja || path.join(options.sdk, 'cmake', CMAKE_VERSION, 'bin', 'ninja.exe'), 'Selected Ninja executable');
  const ndk = requireFile(path.join(options.sdk, 'ndk', '27.1.12297006', 'source.properties'), 'NDK 27.1.12297006');
  if (!/^Pkg\.Revision\s*=\s*27\.1\.12297006\s*$/m.test(fs.readFileSync(ndk, 'utf8'))) throw new Error('NDK revision does not match the application pin.');
  const expoDirectory = path.dirname(require.resolve('expo/package.json'));
  const expoCli = requireFile(path.join(expoDirectory, 'bin', 'cli'), 'Installed Expo CLI');
  const template = requireFile(path.join(expoDirectory, 'template.tgz'), 'Installed Expo CNG template');
  const env = { ...process.env };
  const previousPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  Object.assign(env, {
    JAVA_HOME: options.jdk, ANDROID_HOME: options.sdk, ANDROID_SDK_ROOT: options.sdk,
    GRADLE_USER_HOME: options.gradleCache, EXPO_PUBLIC_API_ENV: 'staging',
    EXPO_NO_TELEMETRY: '1', CI: '1', DEBUG: '', CMAKE_BUILD_PARALLEL_LEVEL: '1',
    MKHADDA_LOCAL_BUILD_MAX_WORKERS: '1',
    MKHADDA_LOCAL_NINJA: options.ninja ? ninja.replaceAll('\\', '/') : '',
    MKHADDA_NATIVE_STAGING_ROOT: options.nativeStagingRoot || '',
    NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --use-system-ca --max-old-space-size=1536`.trim(),
    Path: `${path.join(options.jdk, 'bin')};${path.join(options.sdk, 'platform-tools')};${previousPath}`,
  });
  const command = (executable, args, settings = {}) => runChecked(executable, args, { env, ...settings });
  const ninjaVersion = verifyNinjaVersion(command(ninja, ['--version'], { capture: true }));
  const ninjaSha256 = sha256(fs.readFileSync(ninja));
  const version = command(java, ['-version'], { capture: true, includeStderr: true });
  if (!/\bversion "17(?:\.|"|-)/.test(version)) throw new Error('This preview procedure requires the pinned JDK 17.');
  const before = sourceState(env);
  fs.mkdirSync(options.output, { recursive: true });
  const receiptPath = path.join(options.output, 'build-receipt.json');
  fs.rmSync(receiptPath, { force: true });
  const nativeDirectory = path.join(PROJECT, 'android');
  const apkPath = path.join(nativeDirectory, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const unverifiedApk = path.join(options.output, 'mkhadda-preview.unverified.apk');
  // Even --no-clean can regenerate a malformed project; retain any previous APK first.
  if (fs.existsSync(apkPath) && fs.statSync(apkPath).isFile()) fs.copyFileSync(apkPath, unverifiedApk);
  command(process.execPath, [expoCli, 'prebuild', '--platform', 'android', '--no-install', '--no-clean']);
  const gradleSource = fs.readFileSync(path.join(nativeDirectory, 'app', 'build.gradle'), 'utf8');
  if (!/applicationId\s+['"]com\.remalbookings\.app\.preview['"]/.test(gradleSource)) throw new Error('Only the staging preview application may be built.');
  const debugKey = requireFile(path.join(nativeDirectory, 'app', 'debug.keystore'), 'Generated template debug keystore');
  if (sha256(fs.readFileSync(debugKey)) !== sha256(readTemplateDebugKey(template))) throw new Error('Generated debug keystore differs from the installed Expo template.');
  const wrapper = requireFile(path.join(nativeDirectory, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'Generated Gradle wrapper');
  const wrapperProperties = fs.readFileSync(path.join(nativeDirectory, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
  if (!/^distributionUrl=.*\/gradle-9\.4\.1-bin\.zip\s*$/m.test(wrapperProperties)) throw new Error('Generated Gradle wrapper does not match the installed Gradle 9.4.1 pin.');
  const trust = options.windowsTrust ? ['-Djava.net.useSystemProxies=true', '-Djavax.net.ssl.trustStoreType=Windows-ROOT', '-Djavax.net.ssl.trustStore=NONE'] : [];
  command(java, [
    '-Xmx256m', ...trust, '-Dorg.gradle.appname=gradlew', '-classpath', wrapper, 'org.gradle.wrapper.GradleWrapperMain',
    ':app:assembleRelease', '--no-daemon', '--max-workers=1', '--console=plain', '-Dorg.gradle.parallel=false',
    `-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m${trust.length ? ` ${trust.join(' ')}` : ''}`,
    '-Pkotlin.compiler.execution.strategy=in-process', `-Pandroid.cmakeVersion=${CMAKE_VERSION}`,
    ...(options.nativeStagingRoot ? ['-Pexpo.android.cmakeObjectPathMax=240'] : []),
    '-Pandroid.enableMinifyInReleaseBuilds=false', '-PreactNativeArchitectures=arm64-v8a',
  ], { cwd: nativeDirectory });
  const apk = requireFile(apkPath, 'Built preview APK');
  fs.copyFileSync(apk, unverifiedApk);
  const entries = command(jar, ['tf', unverifiedApk], { capture: true });
  const badging = command(aapt, ['dump', 'badging', unverifiedApk], { capture: true });
  const metadata = verifyApkMetadata(badging, entries);
  const signature = command(java, ['-jar', apkSigner, 'verify', '--verbose', '--print-certs', unverifiedApk], { capture: true });
  const keyDescription = command(keytool, ['-J-Duser.language=en', '-J-Duser.country=US', '-list', '-v', '-keystore', debugKey, '-storepass', 'android', '-alias', 'androiddebugkey'], { capture: true });
  const signerSha256 = verifySigner(signature, keyDescription);
  const after = sourceState(env);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Application source changed during this build; no receipt will be issued.');
  const destination = path.join(options.output, 'mkhadda-preview.apk');
  fs.renameSync(unverifiedApk, destination);
  fs.writeFileSync(path.join(options.output, 'apk-badging.txt'), badging);
  fs.writeFileSync(path.join(options.output, 'apk-signature.txt'), signature);
  const receipt = {
    createdAt: new Date().toISOString(), ...metadata,
    sourceCommit: before.commit, sourceWorkingTreeDirty: before.dirty,
    sourceTreeSha256: before.treeSha256, sourceFileCount: before.fileCount,
    sourceStateUnchangedDuringBuild: true, environment: 'staging',
    toolchain: { jdk: 17, gradle: '9.4.1', buildTools: '37.0.0', ndk: '27.1.12297006', cmake: CMAKE_VERSION, ninjaVersion, ninjaSha256, externalNinja: Boolean(options.ninja) },
    nativeStagingRoot: options.nativeStagingRoot || null,
    requestedCmakeObjectPathMax: options.nativeStagingRoot ? 240 : null,
    signing: 'installed Expo template debug key; test-only, not a Play upload key',
    signerSha256, bundledJavaScript: true, signatureVerified: true,
    manifestIdentityAndPermissionsVerified: true, nativeAbisVerified: true,
    javaKotlinMinification: false, cloudBuildUsed: false, expoAccountRequired: false,
    sha256: sha256(fs.readFileSync(destination)), bytes: fs.statSync(destination).size,
    deviceRuntimeVerified: false, productionReleaseReady: false,
  };
  const temporaryReceipt = `${receiptPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryReceipt, receiptPath);
  console.log(`Local staging APK: ${destination}\nVerified build receipt: ${receiptPath}`);
  return receipt;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/build-android-preview.cjs --sdk <SDK> --jdk <JDK17> --gradle-cache <cache> [--ninja <Ninja1.13.2.exe>] [--native-staging-root <absolute-directory>] [--output <directory>] [--windows-trust]\nBuilds ARM64 staging only; template debug signature is test-only.');
    else buildPreview(options);
  } catch (error) {
    console.error(`Preview build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, runChecked, sourceState, readTemplateDebugKey, verifyApkMetadata, verifySigner, verifyNinjaVersion };
