import { readCurrentUser } from './authSession.js';

const legacyKey = 'remal_checkout_idempotency_key';
const terminal = new Set(['preflight_failed', 'payment_failed', 'booking_confirmed', 'refund_completed']);
export const paymentSettled = status => terminal.has(status);

// An opaque key survives browser restarts. The transaction serializes key
// allocation across tabs. A capability, price or guest record never enters this DB.
async function updatePointer(change) {
    const email = readCurrentUser()?.email.trim().toLowerCase();
    if (!email) throw new Error('payment_owner_unavailable');
    const owner = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
    const database = await new Promise((resolve, reject) => {
        const open = indexedDB.open('pillow-checkout', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('attempts');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction('attempts', 'readwrite');
            const store = transaction.objectStore('attempts');
            const read = store.get(owner);
            let result;
            read.onsuccess = () => {
                const previous = read.result;
                result = change(previous);
                if (result === previous) return;
                if (result) store.put(result, owner);
                else store.delete(owner);
            };
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(transaction.error || new Error('payment_storage_unavailable'));
        });
    } finally { database.close(); }
}

export async function pendingPayment(create = false) {
    const legacy = sessionStorage.getItem(legacyKey);
    const pointer = await updatePointer(previous => previous || legacy || (create ? crypto.randomUUID() : undefined));
    if (legacy) sessionStorage.removeItem(legacyKey);
    return pointer;
}

export const settlePayment = key => updatePointer(previous => previous === key ? undefined : previous);

export function paymentRedirect(value) {
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
            /^(?:[a-z0-9-]+\.)*ziina\.com$/i.test(url.hostname)) return url.href;
    } catch { /* An unknown destination is handled by the local status page. */ }
    return null;
}
