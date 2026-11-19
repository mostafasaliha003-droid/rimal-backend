import type { AppEnvironment } from '../types';
import { endpoints } from './config';
import { ApiError, aborted, invalidResponse } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface DocumentUpload { mime: 'image/jpeg' | 'image/png'; bytes: ArrayBuffer }
export interface RequestOptions { upload?: DocumentUpload; signal?: AbortSignal; query?: Record<string, string>; body?: unknown; token?: string | null; anonymous?: boolean; timeoutMs?: number; idempotencyKey?: string }
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
const checkoutStatusRoute = (path: string) => /^\/payment\/ziina\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/status$/i.test(path);
const NORMAL_RESPONSE_CHARS = 2_000_000;
// Older BFFs return full supplier rates for every search hit. Keep a separate
// ceiling on successful SERPs while the compact card response rolls out.
const LEGACY_SEARCH_RESPONSE_CHARS = 8 * 1024 * 1024;
function bareCheckoutRoute(method: string, path: string) {
  return method === 'GET' && (path === '/payment/availability' || checkoutStatusRoute(path))
    || method === 'POST' && ['/payment/quote', '/payment/ziina/intent', '/payment/ziina/recover'].includes(path);
}
export function allowedRoute(method: string, path: string) {
  if (method === 'GET' && (path === '/client-region' || path === '/display-rates')) return true;
  if (method === 'PUT') return path === '/membership/application' || /^\/membership\/application\/documents\/(passport|eid_front|eid_back)$/.test(path);
  if (method === 'GET') return ['/owned/notifications', '/membership/status', '/search/suggest', '/auth/session', '/auth/account-deletion', '/user/profile', '/payment/availability'].includes(path)
    || checkoutStatusRoute(path) || /^\/v1\/hotels\/[1-9]\d{0,9}$/.test(path);
  return method === 'POST' && ['/membership/application/submit', '/search/rates', '/search/rates/region', '/search/hotelpage', '/booking/prebook',
    '/payment/quote', '/payment/ziina/intent', '/payment/ziina/recover',
    '/auth/login', '/auth/register-send-code', '/auth/verify-and-register', '/auth/logout', '/auth/account-deletion'].includes(path);
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
  const request = async function request(method: 'GET' | 'POST' | 'PUT', path: string, options: RequestOptions = {}): Promise<unknown> {
    if (!allowedRoute(method, path)) throw new ApiError('configuration', 'endpoint_not_allowed');
    if (options.signal?.aborted) throw aborted();
    const documentPath = method === 'PUT' && path.startsWith('/membership/application/documents/');
    if (documentPath !== Boolean(options.upload) || options.upload && (options.body !== undefined ||
        !['image/jpeg', 'image/png'].includes(options.upload.mime) || options.upload.bytes.byteLength < 33 ||
        options.upload.bytes.byteLength > 5 * 1024 * 1024)) throw new ApiError('validation', 'invalid_document_image');
    const capabilityRequest = method === 'GET' && checkoutStatusRoute(path);
    const idempotentRequest = method === 'POST' && ['/payment/ziina/intent', '/payment/ziina/recover'].includes(path);
    if (capabilityRequest && (!validToken(options.token) || options.anonymous)) throw new ApiError('validation', 'invalid_checkout_capability');
    if (idempotentRequest && (typeof options.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(options.idempotencyKey))) throw new ApiError('validation', 'invalid_idempotency_key');
    if (options.idempotencyKey !== undefined && !idempotentRequest || bareCheckoutRoute(method, path) && Object.keys(options.query || {}).length)
      throw new ApiError('configuration', 'invalid_checkout_request');
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
        headers: { Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': options.upload?.mime || 'application/json' } : {}),
          ...(idempotentRequest ? { 'Idempotency-Key': options.idempotencyKey! } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(method !== 'GET' ? { body: options.upload?.bytes || JSON.stringify(options.body || {}) } : {}) }), controller.signal);
      if (controller.signal.aborted) throw timedOut ? new ApiError('timeout', 'request_timeout') : aborted();
      // Refuse a redirect even if a platform fetch implementation followed it.
      if (response.redirected || response.url && new URL(response.url).href !== url.href) throw invalidResponse();
      const text = await abortable(response.text(), controller.signal);
      if (controller.signal.aborted) throw timedOut ? new ApiError('timeout', 'request_timeout') : aborted();
      const searchResult = response.ok && method === 'POST' && (path === '/search/rates' || path === '/search/rates/region');
      if (text.length > (searchResult ? LEGACY_SEARCH_RESPONSE_CHARS : NORMAL_RESPONSE_CHARS)) {
        if (searchResult) throw new ApiError('invalid_response', 'search_result_too_large');
        throw invalidResponse();
      }
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
        if (response.status === 401 && token && !capabilityRequest) await abortable(onUnauthorized(token), controller.signal);
        throw new ApiError(membership ? 'membership' : response.status === 401 ? 'auth'
          : response.status === 429 ? 'rate_limit' : [400, 409].includes(response.status) ? 'validation' : 'server', code, response.status, retry);
      }
      if (data.success !== true && !bareCheckoutRoute(method, path) && path !== '/owned/notifications' && !path.startsWith('/membership/')) throw invalidResponse();
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
  // Composite authenticated operations may await public readiness before their
  // POST. Pin the starting credential so a later sign-in cannot attach a new
  // owner's session to an earlier owner's private payload.
  const captureSessionToken = async (signal?: AbortSignal): Promise<string> => {
    const controller = new AbortController(); const cancel = () => controller.abort();
    if (signal?.aborted) throw aborted();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 20000);
    try {
      const token = await abortable(getToken(), controller.signal);
      if (controller.signal.aborted) throw aborted();
      if (!validToken(token)) throw new ApiError('auth', 'unauthorized', 401);
      return token;
    } catch (error) {
      if (controller.signal.aborted) throw aborted();
      if (error instanceof ApiError) throw error;
      throw new ApiError('auth', 'authentication_unavailable');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  };
  return Object.assign(request, { captureSessionToken });
}
