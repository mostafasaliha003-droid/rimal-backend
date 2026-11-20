const { test } = require('node:test');
const assert = require('node:assert/strict');
const { provisionReviewAccount } = require('./services/reviewAccount');

const HASH = '$2b$12$' + 'a'.repeat(53);
function models() {
    const users = [], apps = [], audits = [];
    const UserModel = { findOneAndUpdate: (filter, update) => ({ lean: async () => {
        let user = users.find(u => u.email === filter.email);
        if (!user) { user = { _id: 'user-' + (users.length + 1), ...update.$setOnInsert }; users.push(user); }
        Object.assign(user, update.$set); return { ...user };
    } }) };
    const Application = {
        findOne: scope => ({ lean: async () => apps.find(a => a.ownerSubject === scope.ownerSubject && a.realm === scope.realm) || null }),
        create: async value => { const row = { _id: 'app-' + (apps.length + 1), ...value }; apps.push(row); return { toObject: () => ({ ...row }) }; },
        findOneAndUpdate: (filter, update) => ({ lean: async () => {
            const row = apps.find(a => a._id === filter._id && a.revision === filter.revision); if (!row) return null;
            Object.assign(row, update.$set); row.revision += update.$inc.revision; return { ...row };
        } })
    };
    const Audit = { create: async entry => { audits.push(entry); return entry; } };
    return { users, apps, audits, UserModel, Application, Audit };
}
const env = { REVIEW_ACCOUNT_EMAIL: ' Reviewer@Example.com ', REVIEW_ACCOUNT_PASSWORD_HASH: HASH, ZIINA_TEST_MODE: 'true', RIMAL_AUTH_REALM: 'staging' };

test('creates the reviewer with a bcrypt hash and an approved membership, idempotently', async () => {
    const m = models(), log = () => {};
    assert.equal((await provisionReviewAccount({ ...m, env, log })).status, 'ready');
    assert.equal(m.users.length, 1); assert.equal(m.users[0].email, 'reviewer@example.com'); assert.equal(m.users[0].password, HASH);
    assert.equal(m.apps[0].status, 'approved'); assert.equal(m.apps[0].ownerSubject, 'user-1'); assert.equal(m.apps[0].realm, 'staging');
    assert.equal(m.audits.length, 1);
    await provisionReviewAccount({ ...m, env, log });
    assert.equal(m.users.length, 1); assert.equal(m.apps.length, 1); assert.equal(m.audits.length, 1);
});

test('a reviewer whose membership was suspended is approved again; nothing runs unless configured', async () => {
    const m = models(), log = () => {};
    await provisionReviewAccount({ ...m, env, log }); m.apps[0].status = 'suspended';
    await provisionReviewAccount({ ...m, env, log });
    assert.equal(m.apps[0].status, 'approved'); assert.equal(m.apps[0].revision, 1);
    assert.equal((await provisionReviewAccount({ ...models(), env: { ZIINA_TEST_MODE: 'true' }, log })).status, 'not_configured');
});

test('refuses live payments, plain-text passwords and malformed emails', async () => {
    const log = () => {};
    assert.equal((await provisionReviewAccount({ ...models(), env: { ...env, ZIINA_TEST_MODE: 'false' }, log })).status, 'refused_live_payments');
    for (const bad of [{ REVIEW_ACCOUNT_PASSWORD_HASH: 'plain-password' }, { REVIEW_ACCOUNT_EMAIL: 'not-an-email' }, { RIMAL_AUTH_REALM: '' }]) {
        const m = models();
        assert.equal((await provisionReviewAccount({ ...m, env: { ...env, ...bad }, log })).status, 'invalid_configuration');
        assert.equal(m.users.length, 0);
    }
});
