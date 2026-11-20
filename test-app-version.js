const { test } = require('node:test');
const assert = require('node:assert/strict');
const { androidRelease, appVersionHandler } = require('./services/appVersion');
const { publicApi } = require('./services/membershipAccessGate');

const env = { APP_ANDROID_LATEST_VERSION_CODE: '38', APP_ANDROID_LATEST_VERSION: '0.38.0', APP_ANDROID_MIN_VERSION_CODE: '30',
    APP_ANDROID_DOWNLOAD_URL: 'https://github.com/owner/repo/releases/download/app-preview-0.38.0/app.apk' };

test('reports the configured Android release and clamps the minimum', () => {
    assert.deepEqual(androidRelease(env), { latestVersionCode: 38, latestVersion: '0.38.0', minimumVersionCode: 30, downloadUrl: env.APP_ANDROID_DOWNLOAD_URL });
    assert.equal(androidRelease({ ...env, APP_ANDROID_MIN_VERSION_CODE: '99' }).minimumVersionCode, 0);
    assert.equal(androidRelease({ ...env, APP_ANDROID_MIN_VERSION_CODE: undefined }).minimumVersionCode, 0);
});

test('reports nothing unless fully and safely configured', () => {
    assert.equal(androidRelease({}), null);
    for (const bad of [{ APP_ANDROID_LATEST_VERSION_CODE: 'x' }, { APP_ANDROID_LATEST_VERSION: 'latest' },
        { APP_ANDROID_DOWNLOAD_URL: 'http://github.com/a.apk' }, { APP_ANDROID_DOWNLOAD_URL: 'https://evil.example/a.apk' },
        { APP_ANDROID_DOWNLOAD_URL: 'https://user:pw@github.com/a.apk' }]) assert.equal(androidRelease({ ...env, ...bad }), null);
});

test('the endpoint is public, cacheable and returns the release', () => {
    const sent = {}; const res = { set: (k, v) => { sent[k] = v; }, json: body => { sent.body = body; } };
    appVersionHandler({ env })({}, res);
    assert.equal(sent.body.android.latestVersionCode, 38); assert.match(sent['Cache-Control'], /max-age=300/);
    assert.equal(publicApi({ path: '/api/app/version', method: 'GET', query: {} }), true);
});
