'use strict';

const countries = new Set(require('../shared/ratehawkResidencies.json'));

function networkCountry(headers, env) {
    // Public requests to this Render hostname pass through Cloudflare. Its
    // country hint is only used for presentation, never residency or billing.
    const host = typeof headers.host === 'string' ? headers.host.toLowerCase().replace(/:443$/, '') : '';
    if (env.RENDER !== 'true' || !host || host !== env.RENDER_EXTERNAL_HOSTNAME
        || typeof headers['cf-ray'] !== 'string' || !/^[0-9a-f]{16,32}(?:-[a-z]{3})?$/i.test(headers['cf-ray'])) return null;
    const country = headers['cf-ipcountry'];
    return typeof country === 'string' && countries.has(country.toLowerCase()) ? country.toUpperCase() : null;
}

function clientRegion(req, res) {
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, country: networkCountry(req.headers, process.env) });
}

module.exports = { clientRegion, networkCountry };
