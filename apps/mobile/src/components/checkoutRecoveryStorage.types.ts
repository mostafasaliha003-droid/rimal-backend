import type { AppEnvironment } from '../types';
import { ApiError } from '../api/errors';

export interface CheckoutRecoveryOwner { environment: AppEnvironment; ownerDigest: string }
export interface CheckoutRecoveryRecord extends CheckoutRecoveryOwner {
  version: 1; idempotencyKey: string; createdAt: number;
}
export interface CheckoutRecoveryStorage {
  read(owner: CheckoutRecoveryOwner): Promise<CheckoutRecoveryRecord | null>;
  write(record: CheckoutRecoveryRecord): Promise<void>;
  remove(record: CheckoutRecoveryRecord): Promise<boolean>;
}
interface Backend { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
const queues = new Map<string, Promise<unknown>>();
export const recoveryUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export function validRecoveryOwner(value: CheckoutRecoveryOwner): boolean {
  return Boolean(value && ['staging', 'production'].includes(value.environment) && /^[a-f\d]{64}$/.test(value.ownerDigest));
}
export function validateRecoveryRecord(value: unknown): CheckoutRecoveryRecord {
  const row = value as CheckoutRecoveryRecord;
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 5
    || !['version', 'environment', 'ownerDigest', 'idempotencyKey', 'createdAt'].every(key => Object.hasOwn(row, key))
    || row.version !== 1 || !validRecoveryOwner(row) || !recoveryUuid(row.idempotencyKey)
    || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw new ApiError('storage', 'checkout_recovery_corrupt');
  return { version: 1, environment: row.environment, ownerDigest: row.ownerDigest,
    idempotencyKey: row.idempotencyKey, createdAt: row.createdAt };
}
export function recoveryStorageKey(owner: CheckoutRecoveryOwner): string {
  if (!validRecoveryOwner(owner)) throw new ApiError('storage', 'checkout_recovery_owner_invalid');
  return `mkhadda.checkout.recovery.${owner.environment}.${owner.ownerDigest}.v1`;
}
const sameRecord = (a: CheckoutRecoveryRecord, b: CheckoutRecoveryRecord) => a.environment === b.environment
  && a.ownerDigest === b.ownerDigest && a.idempotencyKey === b.idempotencyKey && a.createdAt === b.createdAt;

// Serializes all instances in this JS runtime. Compare-and-remove prevents an
// old completion from erasing a newer attempt. Native errors never fall back.
export function createRecoveryStorage(backend: Backend): CheckoutRecoveryStorage {
  async function queued<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    queues.set(key, task);
    try { return await task; }
    catch (error) { throw error instanceof ApiError ? error : new ApiError('storage', 'checkout_recovery_unavailable'); }
    finally { if (queues.get(key) === task) queues.delete(key); }
  }
  async function read(key: string, owner: CheckoutRecoveryOwner) {
    const raw = await backend.get(key);
    if (raw === null) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new ApiError('storage', 'checkout_recovery_corrupt'); }
    const record = validateRecoveryRecord(parsed);
    if (record.environment !== owner.environment || record.ownerDigest !== owner.ownerDigest)
      throw new ApiError('storage', 'checkout_recovery_corrupt');
    return record;
  }
  return {
    read(owner) { const key = recoveryStorageKey(owner); return queued(key, () => read(key, owner)); },
    write(value) {
      const record = validateRecoveryRecord(value), key = recoveryStorageKey(record);
      return queued(key, async () => {
        const previous = await read(key, record);
        if (previous && !sameRecord(previous, record)) throw new ApiError('storage', 'checkout_recovery_pending');
        await backend.set(key, JSON.stringify(record));
      });
    },
    remove(value) {
      const record = validateRecoveryRecord(value), key = recoveryStorageKey(record);
      return queued(key, async () => {
        const previous = await read(key, record);
        if (!previous || !sameRecord(previous, record)) return false;
        await backend.remove(key); return true;
      });
    }
  };
}
