import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, AppState as NativeAppState, Image, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { api, authSession } from '../api';
import type { MemberStatus } from '../api/membership';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, layout, space } from '../theme';
import { StatePanel } from './Primitives';
import { accessFor, accessRedirect, memberOnly, returnPath, type Access } from './accessModel';

/*
 * The members-only door. One membership answer per signed-in session, shared by every screen:
 * the gate reads it to keep visitors on the welcome front and applicants on their membership
 * page, and screens that fetch the membership status themselves report what they saw.
 * The last answer per account is remembered on the device so an approved member is not held
 * at a cover on every launch; the server still refuses member rates to anyone not approved.
 */
const CACHE_KEY = 'mkhadda.member.access.v1';
type Answer = { revision: number; value: boolean | 'error' } | null;
let answer: Answer = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => answer;
function publish(revision: number, value: boolean | 'error') {
  if (answer?.revision === revision && answer.value === value) return;
  answer = { revision, value };
  listeners.forEach(listener => listener());
}
const owner = () => authSession.getSnapshot().user?.email?.trim().toLowerCase() || '';
async function remember(value: boolean) {
  const email = owner();
  if (email) await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ email, value })).catch(() => {});
}
async function recall(): Promise<boolean | null> {
  try {
    const row = JSON.parse(await AsyncStorage.getItem(CACHE_KEY) || 'null') as { email?: unknown; value?: unknown } | null;
    return row && row.email === owner() && typeof row.value === 'boolean' ? row.value : null;
  } catch { return null; }
}

/** Screens that read the membership status themselves pass it on, so the whole app follows at once. */
export function reportMembership(status: MemberStatus) {
  if (authSession.getSnapshot().status !== 'signedIn' || !status.authenticated) return;
  publish(authSession.getRevision(), status.canAccess);
  void remember(status.canAccess);
}

const Context = createContext<{ access: Access; refresh: () => void }>({ access: 'checking', refresh: () => {} });
export const useMemberAccess = () => useContext(Context);

export function MemberAccessProvider({ children }: { children: ReactNode }) {
  const { status, restorePending, sessionRevision, refresh: restoreSession } = useAuth();
  const stored = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [attempt, setAttempt] = useState(0);
  const membership = status === 'signedIn' && stored?.revision === sessionRevision ? stored.value : null;
  const access = accessFor({ authStatus: status, restorePending, membership });

  useEffect(() => {
    if (status !== 'signedIn') return;
    const controller = new AbortController();
    const revision = sessionRevision;
    // The remembered answer shows at once; the live one replaces it.
    void recall().then(value => { if (!controller.signal.aborted && value !== null && answer?.revision !== revision) publish(revision, value); });
    api.getMembershipStatus(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      publish(revision, result.canAccess);
      void remember(result.canAccess);
    }).catch(() => {
      if (controller.signal.aborted) return;
      void recall().then(value => { if (!controller.signal.aborted && answer?.revision !== revision) publish(revision, value ?? 'error'); });
    });
    return () => controller.abort();
  }, [status, sessionRevision, attempt]);

  const refresh = useCallback(() => {
    if (authSession.getSnapshot().status === 'signedOut' && authSession.getSnapshot().restorePending) void restoreSession();
    else setAttempt(value => value + 1);
  }, [restoreSession]);
  // Coming back to the app re-checks: an approval (or a suspension) shows without a restart.
  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', next => { if (next === 'active') refresh(); });
    return () => subscription.remove();
  }, [refresh]);
  // While an application is open, look for the decision every minute.
  useEffect(() => {
    if (access !== 'applicant' && access !== 'offline') return;
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [access, refresh]);

  return <Context.Provider value={{ access, refresh }}>{children}</Context.Provider>;
}

/** Sends each visitor to the one place they may be, and covers member screens until access is known. */
export function AccessGate() {
  const { access, refresh } = useMemberAccess();
  const { language } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const ready = Boolean(useRootNavigationState()?.key);
  const target = accessRedirect(access, pathname);
  const sent = useRef('');
  useEffect(() => {
    if (!ready || !target) { sent.current = ''; return; }
    const key = target + '|' + pathname;
    if (sent.current === key) return;
    sent.current = key;
    const next = target === '/welcome' ? returnPath(pathname) : undefined;
    router.replace(next ? { pathname: '/welcome', params: { next } } : target);
  }, [ready, target, pathname, router]);

  const covered = Boolean(target) || (access === 'checking' || access === 'offline') && memberOnly(pathname);
  if (!covered) return null;
  const ar = language === 'ar';
  return <View testID="access-cover" style={styles.cover} accessibilityViewIsModal>
    {access === 'offline' ? <View style={styles.panel}>
      <StatePanel icon="offline" title={ar ? 'لا يمكننا التحقق من عضويتك الآن' : 'We can’t check your membership right now'}
        body={ar ? 'مخدة للأعضاء فقط، ونحتاج اتصالاً بالإنترنت للتأكد من عضويتك. تحقق من الاتصال ثم أعد المحاولة.'
          : 'Pillow Stays is for members only, and we need a connection to confirm your membership. Check your connection and try again.'} retry={refresh}/>
    </View> : <>
      <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={styles.symbol}/>
      <ActivityIndicator color={color.interactive} accessibilityLabel={ar ? 'جارٍ التحميل' : 'Loading'}/>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, backgroundColor: color.bgCanvas, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.lg },
  panel: { width: '100%', maxWidth: layout.maxReading },
  symbol: { width: 72, height: 54, opacity: 0.9 },
});
