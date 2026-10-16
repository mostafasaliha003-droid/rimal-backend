const { getReleaseReadiness } = require('../services/releaseReadiness');

async function checkRemote(origin, { fetcher = fetch } = {}) {
    const parsed = new URL(origin);
    if (!['https://rimal-api-staging.onrender.com', 'https://rimal-api.onrender.com'].includes(parsed.origin)
        || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw new Error('readiness_origin_not_allowlisted');
    }
    const get = async pathname => {
        const response = await fetcher(`${parsed.origin}${pathname}`, {
            redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`readiness_http_${response.status}`);
        return response.json();
    };
    const [health, payment] = await Promise.all([get('/api/v1/health'), get('/api/payment/availability')]);
    const page = await fetcher(parsed.origin, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!page.ok) throw new Error(`readiness_frontend_http_${page.status}`);
    const html = await page.text();
    const frontendRevision = /<meta\s+name="remal-revision"\s+content="([a-f\d]{40})"/i.exec(html)?.[1] || null;
    return {
        origin: parsed.origin,
        databaseConnected: health.databaseState === 1,
        checkoutEnabled: payment.enabled === true,
        backendRevision: /^[a-f\d]{40}$/i.test(health.revision || '') ? health.revision : null,
        frontendRevision,
        matchingRevision: Boolean(frontendRevision && frontendRevision === health.revision)
    };
}

async function main(argv = process.argv.slice(2)) {
    const envFile = argv.find(value => value.startsWith('--env-file='));
    require('dotenv').config(envFile ? { path: envFile.slice('--env-file='.length) } : {});
    const remoteArgument = argv.find(value => value.startsWith('--remote='));
    const report = { local: getReleaseReadiness() };
    if (remoteArgument) report.remote = await checkRemote(remoteArgument.slice('--remote='.length));
    console.log(JSON.stringify(report, null, 2));
    if (!report.local.configurationReady || report.remote && (!report.remote.databaseConnected
        || !report.remote.checkoutEnabled || !report.remote.matchingRevision)) process.exitCode = 1;
}

if (require.main === module) main().catch(() => {
    console.error('Readiness verification unavailable; no deployment or payment changes were made.');
    process.exitCode = 1;
});

module.exports = { checkRemote };
