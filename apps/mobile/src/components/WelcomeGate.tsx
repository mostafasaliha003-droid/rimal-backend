import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { WELCOME_KEY, shouldShowWelcome } from './welcomeModel';

/** Decides once per launch, after the saved session has been checked, whether to open the welcome front. */
export default function WelcomeGate() {
  const { status, restorePending } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const ready = Boolean(useRootNavigationState()?.key);
  const decided = useRef(false);
  useEffect(() => {
    if (!ready || decided.current || status === 'loading') return;
    decided.current = true;
    if (status !== 'signedOut' || restorePending || pathname !== '/') return;
    let active = true;
    AsyncStorage.getItem(WELCOME_KEY).catch(() => null).then(exploredAt => {
      if (active && shouldShowWelcome({ status, restorePending, pathname, exploredAt, now: Date.now() })) router.push('/welcome');
    });
    return () => { active = false; };
  }, [ready, status, restorePending, pathname, router]);
  return null;
}
