/*
 * Latest Android build of the app, so installed copies can offer the update.
 * Configured per environment with Render variables, so publishing a build needs no deploy:
 *   APP_ANDROID_LATEST_VERSION_CODE  integer versionCode of the newest build
 *   APP_ANDROID_LATEST_VERSION       its version name, e.g. 0.38.0
 *   APP_ANDROID_MIN_VERSION_CODE     builds below this must update before use (optional)
 *   APP_ANDROID_DOWNLOAD_URL         https link to the APK
 * With no latest version configured the endpoint reports none and the app shows nothing.
 */
const DOWNLOAD_HOSTS = new Set(['github.com', 'play.google.com']);

function code(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function androidRelease(env = process.env) {
    const latestVersionCode = code(env.APP_ANDROID_LATEST_VERSION_CODE);
    const latestVersion = String(env.APP_ANDROID_LATEST_VERSION || '').trim();
    let downloadUrl = null;
    try {
        const url = new URL(String(env.APP_ANDROID_DOWNLOAD_URL || ''));
        if (url.protocol === 'https:' && DOWNLOAD_HOSTS.has(url.hostname) && !url.username && !url.password) downloadUrl = url.href;
    } catch { downloadUrl = null; }
    if (!latestVersionCode || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(latestVersion) || !downloadUrl) return null;
    const minimum = code(env.APP_ANDROID_MIN_VERSION_CODE);
    return { latestVersionCode, latestVersion, minimumVersionCode: minimum && minimum <= latestVersionCode ? minimum : 0, downloadUrl };
}

function appVersionHandler({ env = process.env } = {}) {
    return (_req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        return res.json({ android: androidRelease(env) });
    };
}

module.exports = { androidRelease, appVersionHandler, DOWNLOAD_HOSTS };
