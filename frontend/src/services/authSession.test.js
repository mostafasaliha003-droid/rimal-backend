import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearUserSession, readCurrentUser, saveUserSession, userAccessToken } from './authSession.js';

function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key) };
}

test('switching and signing out in one tab keeps the other authenticated owner and their checkout', () => {
    const localStorage = memoryStorage(), first = memoryStorage(), second = memoryStorage();
    const alice = { name: 'Guest One', email: 'one@example.test' }, bob = { name: 'Guest Two', email: 'two@example.test' };
    saveUserSession(alice, 'a'.repeat(64), { localStorage, sessionStorage: first });
    saveUserSession(alice, 'c'.repeat(64), { localStorage, sessionStorage: second });
    first.setItem('remal_payment_attempt', 'own-capability');
    second.setItem('remal_payment_attempt', 'previous-capability');
    saveUserSession(bob, 'b'.repeat(64), { localStorage, sessionStorage: second });
    assert.deepEqual(readCurrentUser(localStorage, first), alice);
    assert.equal(first.getItem('remal_payment_attempt'), 'own-capability');
    assert.deepEqual(readCurrentUser(localStorage, second), bob);
    assert.equal(second.getItem('remal_payment_attempt'), null);
    clearUserSession({ localStorage, sessionStorage: first });
    assert.equal(userAccessToken(first), null);
    assert.equal(first.getItem('remal_payment_attempt'), null);
    assert.deepEqual(readCurrentUser(localStorage, second), bob);
    assert.equal(userAccessToken(second), 'b'.repeat(64));
});

test('an existing session scopes its previous shared profile on first use', () => {
    const local = memoryStorage(), session = memoryStorage();
    local.setItem('rimal_current_user', JSON.stringify({ email: 'old@example.test', name: 'Existing guest' }));
    session.setItem('rimal_user_access_token', 'e'.repeat(64));
    assert.equal(readCurrentUser(local, session).email, 'old@example.test');
    local.setItem('rimal_current_user', JSON.stringify({ email: 'new@example.test', name: 'Another guest' }));
    assert.equal(readCurrentUser(local, session).email, 'old@example.test');
});
