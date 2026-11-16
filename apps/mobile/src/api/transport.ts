import type { AppEnvironment } from '../types';
import { endpoints } from './config';
import { ApiError, aborted, invalidResponse } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface RequestOptions { signal?: AbortSignal; query?: Record<string, string>; body?: unknown; token?: string | null; anonymous?: boolean; timeoutMs?: number }
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
export function allowedRoute(method: string, path: string) {
  if (method === 'GET') return ['/search/suggest', '/auth/session'].includes(path) || /^\/v1\/hotels\/[1-9]\d{0,9}$/.test(path);
  return method === 'POST' && ['/search/rates', '/search/rates/region', '/search/hotelpage', '/booking/prebook',
    '/auth/login', '/auth/register-send-code', '/auth/verify-and-register', '/auth/logout'].includes(path);
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    if (signal.aborted) { operation.catch(() => {}); cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

export function createTransport({ environment, fetcher = globalThis.fetch, getToken = async () => null,
  onUnauthorized = async (_token: string) => {}, timeoutMs = 75000 }: {
    environment: AppEnvironment; fetcher?: FetchLike; getToken?: () => Promise<string | null>;
    onUnauthorized?: (token: string) => Promise<void>; timeoutMs?: number;
  }) {
  const base = endpoints(environment).api;
  return async function request(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<unknown> {
    if (!allowedRoute(method, path)) throw new ApiError('configuration', 'endpoint_not_allowed');
    if (options.signal?.aborted) throw aborted();
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const requestedBudget = options.timeoutMs ?? timeoutMs;
    const budget = Number.isFinite(requestedBudget) ? Math.max(1, Math.min(90000, requestedBudget)) : 75000;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, budget);
    try {
      const token = options.anonymous ? null : options.token === undefined ? await abortable(getToken(), controller.signal) : options.token;
      if (token !== null && !validToken(token)) throw new ApiError('auth', 'invalid_session');
      if (controller.signal.aborted) throw aborted();
      const response = await abortable(fetcher(url.href, { method, signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(options.body || {}) } : {}) }), controller.signal);
      if (controller.signal.aborted) throw timedOut ? new ApiError('timeout', 'request_timeout') : aborted();
      // Refuse a redirect even if a platform fetch implementation followed it.
      if (response.redirected || response.url && new URL(response.url).href !== url.href) throw invalidResponse();
      const text = await abortable(response.text(), controller.signal);
      if (controller.signal.aborted) throw timedOut ? new ApiError('timeout', 'request_timeout') : aborted();
      if (text.length > 2_000_000) throw invalidResponse();
      let payload: unknown;
      try { payload = JSON.parse(text); } catch { if (response.ok) throw invalidResponse(); payload = {}; }
      const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
      if (!data) throw invalidResponse();
      if (!response.ok || data.success === false) {
        const code = typeof data.error === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(data.error)
          ? data.error : response.status === 429 ? 'rate_limited' : 'request_failed';
        const rawRetry = response.headers.get('retry-after');
        const retry = rawRetry && /^\d+$/.test(rawRetry) ? Math.min(86400, Math.max(1, Number(rawRetry))) : undefined;
        const membership = code === 'membership_authentication_required' || code === 'membership_approval_required';
        // The membership gate also emits 401 when a supplied session has
        // expired. Approval denial is 403 and must retain the valid identity.
        if (response.status === 401 && token) await abortable(onUnauthorized(token), controller.signal);
        throw new ApiError(membership ? 'membership' : response.status === 401 ? 'auth'
          : response.status === 429 ? 'rate_limit' : [400, 409].includes(response.status) ? 'validation' : 'server', code, response.status, retry);
      }
      if (data.success !== true) throw invalidResponse();
      return data;
    } catch (error) {
      if (options.signal?.aborted) throw aborted();
      if (timedOut) throw new ApiError('timeout', 'request_timeout');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', 'network_unavailable');
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
    }
  };
}
