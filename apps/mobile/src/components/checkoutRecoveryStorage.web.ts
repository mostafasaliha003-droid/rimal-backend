import { createRecoveryStorage } from './checkoutRecoveryStorage.types';

// Preview authentication/recovery remains RAM-only. Never use browser storage.
const records = new Map<string, string>();
export function createCheckoutRecoveryStorage() {
  return createRecoveryStorage({
    get: async key => records.get(key) ?? null,
    set: async (key, value) => { records.set(key, value); },
    remove: async key => { records.delete(key); }
  });
}
