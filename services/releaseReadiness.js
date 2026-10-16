const { getCheckoutReadiness } = require('./paymentService');

function releaseRevision(env = process.env) {
    const value = env.RENDER_GIT_COMMIT || env.GITHUB_SHA || '';
    return /^[a-f\d]{40}$/i.test(value) ? value : null;
}

function getReleaseReadiness({ env = process.env, databaseState } = {}) {
    const checkout = getCheckoutReadiness(env);
    const blockers = [...checkout.blockers];
    if (!/^[a-z0-9:_-]{1,100}$/i.test(env.RIMAL_AUTH_REALM || '')) blockers.push('RIMAL_AUTH_REALM');
    // Sandbox checkout may exercise payments before mail is configured, but a
    // complete customer lifecycle also requires voucher/refund email delivery.
    if (!env.SMTP_USER) blockers.push('SMTP_USER');
    if (!env.SMTP_PASSWORD) blockers.push('SMTP_PASSWORD');
    if (databaseState !== undefined && databaseState !== 1) blockers.push('DATABASE_CONNECTION');
    return {
        configurationReady: blockers.length === 0,
        checkout,
        database: databaseState === undefined ? 'not_checked' : databaseState === 1 ? 'connected' : 'unavailable',
        revision: releaseRevision(env),
        blockers: [...new Set(blockers)],
        // Configuration checks do not attest supplier certification or a real
        // end-to-end test. Keep those claims separate and explicit.
        certification: 'requires_external_verification'
    };
}

module.exports = { getReleaseReadiness, releaseRevision };
