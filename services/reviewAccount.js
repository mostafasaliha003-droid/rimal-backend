const crypto = require('node:crypto');

/*
 * A sign-in for partner reviewers (for example a payment provider checking the app) on the
 * staging environment. The account is defined only by environment variables:
 *   REVIEW_ACCOUNT_EMAIL          the sign-in email
 *   REVIEW_ACCOUNT_PASSWORD_HASH  a bcrypt hash; the plain password never reaches the server
 *   REVIEW_ACCOUNT_NAME           optional display name
 * It runs only while Ziina is in test mode, so a reviewer can never make a real charge, and it
 * gives the account an approved membership so the reviewer can search and book in the sandbox.
 * Removing the variables stops provisioning; it does not delete the account.
 */
const EDITOR = 'review-account';
const BCRYPT = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

async function provisionReviewAccount({ UserModel, Application = require('../models/MembershipApplication'),
    Audit = require('../models/MembershipAudit'), env = process.env, log = console.log } = {}) {
    const email = String(env.REVIEW_ACCOUNT_EMAIL || '').trim().toLowerCase();
    const hash = String(env.REVIEW_ACCOUNT_PASSWORD_HASH || '').trim();
    if (!email && !hash) return { status: 'not_configured' };
    if (env.ZIINA_TEST_MODE !== 'true') {
        log('[review-account] skipped: only available while Ziina is in test mode');
        return { status: 'refused_live_payments' };
    }
    const realm = env.RIMAL_AUTH_REALM;
    if (!EMAIL.test(email) || email.length > 254 || !BCRYPT.test(hash) || typeof realm !== 'string' || !realm) {
        log('[review-account] skipped: invalid configuration');
        return { status: 'invalid_configuration' };
    }
    const name = String(env.REVIEW_ACCOUNT_NAME || 'App reviewer').trim().slice(0, 160) || 'App reviewer';
    const user = await UserModel.findOneAndUpdate({ email },
        { $set: { password: hash, name }, $setOnInsert: { email, phone: '', points: 0 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    const scope = { ownerSubject: String(user._id), realm };
    const existing = await Application.findOne(scope).lean();
    let application = existing;
    if (!existing) {
        application = (await Application.create({ ...scope, reference: crypto.randomUUID(), status: 'approved', revision: 0,
            grandfathered: true, reviewer: EDITOR, reviewedAt: new Date(), publicNote: '' })).toObject();
    } else if (existing.status !== 'approved') {
        application = await Application.findOneAndUpdate({ _id: existing._id, revision: existing.revision },
            { $set: { status: 'approved', reviewer: EDITOR, reviewedAt: new Date() }, $inc: { revision: 1 } }, { new: true }).lean();
    }
    if (application && (!existing || existing.status !== 'approved')) {
        await Audit.create({ applicationId: String(application._id), realm, actor: EDITOR, role: 'system',
            event: 'approved', kind: 'review_account', revision: application.revision });
    }
    log(`[review-account] ready: membership=${application?.status || 'unknown'}`);
    return { status: 'ready', membership: application?.status };
}

module.exports = { provisionReviewAccount };
