import type { ApiClient } from '../api/client';
import type { RegistrationInput, TokenStorage, User } from '../types';
import { ApiError, aborted, asApiError } from '../api/errors';
import { validToken } from '../api/transport';

export interface AuthSnapshot { status: 'loading' | 'signedIn' | 'signedOut'; user: User | null; error: ApiError | null }
export function createSessionManager(network: ApiClient['auth'], storage: TokenStorage) {
  let snapshot: AuthSnapshot = { status: 'loading', user: null, error: null };
  let token: string | null | undefined;
  let revision = 0;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (value: AuthSnapshot) => { snapshot = value; listeners.forEach(listener => listener()); };
  function stored(operation: () => Promise<void>) {
    const task = writes.then(operation).catch(() => { throw new ApiError('storage', 'secure_storage_unavailable'); });
    writes = task.catch(() => {});
    return task;
  }
  async function getToken(): Promise<string | null> {
    if (token !== undefined) return token;
    const stamp = revision;
    await writes;
    let value: string | null;
    try { value = await storage.get(); } catch { throw new ApiError('storage', 'secure_storage_unavailable'); }
    if (stamp !== revision) return token || null;
    if (value !== null && !validToken(value)) {
      await stored(() => storage.clear()); value = null;
    }
    token = value;
    return token;
  }
  async function invalidate(expected: string) {
    if (token !== expected) return;
    revision += 1; token = null;
    publish({ status: 'signedOut', user: null, error: new ApiError('auth', 'session_expired', 401) });
    await stored(() => storage.clear());
  }
  async function restore(signal?: AbortSignal) {
    const stamp = ++revision;
    // A failed validation quarantines the cached credential. An explicit retry
    // may re-read SecureStore, but signed-out callers cannot keep using it.
    token = undefined;
    publish({ ...snapshot, status: 'loading', error: null });
    try {
      if (!await getToken()) {
        if (stamp === revision) publish({ status: 'signedOut', user: null, error: null });
        return;
      }
      if (stamp !== revision) return;
      const user = await network.session(signal);
      if (stamp === revision) publish({ status: 'signedIn', user, error: null });
    } catch (error) {
      if (stamp === revision) {
        token = null;
        publish({ status: 'signedOut', user: null, error: asApiError(error) });
      }
    }
  }
  async function authenticate(operation: () => ReturnType<ApiClient['auth']['login']>) {
    const stamp = ++revision;
    token = null;
    publish({ status: 'loading', user: null, error: null });
    let issued: string | null = null;
    try {
      await stored(() => storage.clear());
      if (stamp !== revision) throw aborted();
      const result = await operation();
      issued = result.token;
      if (stamp !== revision) throw aborted();
      await stored(async () => { if (stamp === revision) await storage.set(result.token); });
      if (stamp !== revision) throw aborted();
      token = result.token;
      publish({ status: 'signedIn', user: result.user, error: null });
      return result.user;
    } catch (error) {
      if (issued && token !== issued) void network.logout(issued).catch(() => {});
      const safe = asApiError(error);
      if (stamp === revision) publish({ status: 'signedOut', user: null, error: safe });
      throw safe;
    }
  }
  async function signOut(signal?: AbortSignal) {
    let previous = token;
    const stamp = ++revision; token = null;
    publish({ status: 'signedOut', user: null, error: null });
    let failure: ApiError | null = null;
    try { await stored(async () => {
      // Queue deletion before a newer sign-in can queue its credential write.
      if (previous === undefined || previous === null) { try { previous = await storage.get(); } catch { failure = new ApiError('storage', 'secure_storage_unavailable'); } }
      await storage.clear();
    }); } catch { failure = new ApiError('storage', 'secure_storage_unavailable'); }
    if (validToken(previous)) {
      try { await network.logout(previous, signal); }
      catch (error) { if (!(error instanceof ApiError && error.status === 401)) failure ||= asApiError(error); }
    }
    if (failure) { if (stamp === revision) publish({ status: 'signedOut', user: null, error: failure }); throw failure; }
  }
  return { getToken, invalidate, restore, signOut,
    getRevision: () => revision,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: (email: string, password: string, signal?: AbortSignal) => authenticate(() => network.login(email, password, signal)),
    requestRegistration: (input: RegistrationInput, signal?: AbortSignal) => network.requestRegistration(input, signal),
    verifyRegistration: (email: string, code: string, signal?: AbortSignal) => authenticate(() => network.verifyRegistration(email, code, signal))
  };
}
export type SessionManager = ReturnType<typeof createSessionManager>;
