import { invalidResponse, ApiError } from './errors';
import { object, utcTimestamp } from './adapters';
import type { createTransport } from './transport';

export interface AccountDeletionRequest {
  reference: string; status: 'requested'; requestedAt: string;
}
export interface AccountDeletionResponse { request: AccountDeletionRequest | null; dataDeleted: false }

export function normalizeAccountDeletion(value: unknown, requestRequired = false): AccountDeletionResponse {
  const data = object(value);
  // This version supports intake only. Never reinterpret a queued request or a
  // future/unknown backend state as a completed account/data deletion.
  if (data.success !== true || data.data_deleted !== false) throw invalidResponse();
  if (data.request === null && !requestRequired) return { request: null, dataDeleted: false };
  const request = object(data.request), requestedAt = utcTimestamp(request.requested_at);
  if (typeof request.reference !== 'string' || !/^del_[a-f0-9]{32}$/.test(request.reference)
    || request.status !== 'requested' || !requestedAt) throw invalidResponse();
  return { request: { reference: request.reference, status: 'requested', requestedAt }, dataDeleted: false };
}

export async function getAccountDeletionRequest(request: ReturnType<typeof createTransport>, signal?: AbortSignal) {
  return normalizeAccountDeletion(await request('GET', '/auth/account-deletion', { signal, timeoutMs: 20000 }));
}
export async function requestAccountDeletion(request: ReturnType<typeof createTransport>, password: string, signal?: AbortSignal) {
  if (typeof password !== 'string' || !password || password.length > 256) throw new ApiError('validation', 'invalid_password');
  return normalizeAccountDeletion(await request('POST', '/auth/account-deletion', { signal, timeoutMs: 30000,
    body: { password, confirm_account_deletion: true } }), true);
}
