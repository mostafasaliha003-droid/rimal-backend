const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sandboxDatabaseConfigured, sandboxMongoUri } = require('./services/sandboxDatabase');

test('sandbox URI preserves connection options and credentials while selecting a separate named database', () => {
    const value = sandboxMongoUri('mongodb+srv://fixture:secret@cluster.example.test/production?retryWrites=true', 'rimal_sandbox');
    const parsed = new URL(value);
    assert.equal(parsed.pathname, '/rimal_sandbox');
    assert.equal(parsed.searchParams.get('retryWrites'), 'true');
    assert.equal(parsed.username, 'fixture');
    assert.equal(parsed.password, 'secret');
    assert.equal(sandboxDatabaseConfigured({ MONGO_URI: value, PAYMENT_SANDBOX_DATABASE: 'rimal_sandbox' }), true);
    for (const name of ['production', '../sandbox', '', 'sandbox/production']) {
        assert.throws(() => sandboxMongoUri('mongodb://localhost/production', name));
    }
    assert.equal(sandboxDatabaseConfigured({ MONGO_URI: 'mongodb://localhost/production', PAYMENT_SANDBOX_DATABASE: 'rimal_sandbox' }), false);
});
