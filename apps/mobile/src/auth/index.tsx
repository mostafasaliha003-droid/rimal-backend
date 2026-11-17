import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { authSession } from '../api';
import type { SessionManager } from './session';

const AuthContext = createContext<SessionManager | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => { void authSession.restore(); }, []);
  return <AuthContext.Provider value={authSession}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const manager = useContext(AuthContext);
  if (!manager) throw new Error('AuthProvider is required');
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  return { ...snapshot, sessionRevision: manager.getRevision(), signIn: manager.signIn, requestRegistration: manager.requestRegistration,
    verifyRegistration: manager.verifyRegistration, signOut: manager.signOut, refresh: manager.restore };
}
