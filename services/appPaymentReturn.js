const crypto = require('node:crypto');

// Payments started in the Mkhadda app return to the app, not to the website.
// Only the app's own registered schemes are accepted: a caller can never choose
// an arbitrary redirect target. The return itself is never payment evidence;
// the app reconciles the attempt with the server after it is reopened.
const APP_SCHEMES = new Set(['mkhadda', 'mkhadda-preview']);
const RESULTS = new Set(['success', 'cancel', 'failed']);
const PATH = '/api/payment/app-return';
const SCRIPT = "location.replace(document.getElementById('back').href);";
const SCRIPT_HASH = crypto.createHash('sha256').update(SCRIPT).digest('base64');

function fail(code) {
    return Object.assign(new Error(code), { code, httpStatus: 400 });
}

function appReturnScheme(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !APP_SCHEMES.has(value)) throw fail('invalid_app_return');
    return value;
}

function returnPageUrl(frontendUrl, scheme, result) {
    if (!APP_SCHEMES.has(scheme) || !RESULTS.has(result)) throw fail('invalid_app_return');
    const url = new URL(PATH, frontendUrl);
    url.searchParams.set('app', scheme);
    url.searchParams.set('payment', result);
    return url.href;
}

function renderReturnPage(query = {}) {
    const scheme = typeof query.app === 'string' && APP_SCHEMES.has(query.app) ? query.app : null;
    if (!scheme) return null;
    const target = `${scheme}://checkout`;
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>مخدة | pillow stays</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F3EE;color:#14213D;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;text-align:center}
main{max-width:360px;padding:32px 24px}
h1{font-size:22px;margin:0 0 12px}
p{margin:0 0 24px;line-height:1.7;color:#4A5568}
a{display:block;padding:16px;border-radius:14px;background:#14213D;color:#fff;font-weight:700;text-decoration:none;font-size:17px}
small{display:block;margin-top:16px;color:#718096}
</style>
</head>
<body>
<main>
<h1>العودة إلى مخدة</h1>
<p>ستظهر حالة الحجز في التطبيق.<br>Your booking status will appear in the app.</p>
<a id="back" href="${target}">افتح التطبيق · Open the app</a>
<small>إذا لم يفتح التطبيق تلقائياً، اضغط الزر.</small>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
    return {
        html,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Robots-Tag': 'noindex',
            'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
        }
    };
}

module.exports = { APP_SCHEMES, PATH, appReturnScheme, returnPageUrl, renderReturnPage };
