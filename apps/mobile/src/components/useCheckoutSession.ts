import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { api, APP_ENV, authSession } from '../api';
import { useAuth } from '../auth';
import { ApiError } from '../api/errors';
import { createCheckoutRecoveryStorage } from './checkoutRecoveryStorage';
import { createCheckoutSession, type CheckoutOwner, type CheckoutSelection } from './checkoutSessionModel';

export interface UseCheckoutSessionOptions {
  // Pass stable imperative getters. They must resolve current proof/config at
  // invocation, rather than returning a rendered offer from an old handler.
  getReview: () => CheckoutSelection | null;
  canCreate?: () => boolean;
}
const buildPolicy = () => api.checkout.creationEnabled;
function createIdentityCache() {
  let value: { owner: CheckoutOwner; subject: string } | null = null;
  return { get: () => value, set: (next: typeof value) => { value = next; } };
}
export function useCheckoutSession({ getReview, canCreate = buildPolicy }: UseCheckoutSessionOptions) {
  const { status, user, sessionRevision } = useAuth();
  const [identity] = useState(createIdentityCache);
  const [identityError, setIdentityError] = useState<ApiError | null>(null);
  const [storage] = useState(createCheckoutRecoveryStorage);
  const getOwner = useCallback(() => {
    const current = authSession.getSnapshot(), saved = identity.get();
    return saved && current.status === 'signedIn' && authSession.getRevision() === saved.owner.revision
      && current.user?.email.trim().toLowerCase() === saved.subject ? saved.owner : null;
  }, [identity]);
  const session = useMemo(() => createCheckoutSession({ api: api.checkout, storage, getOwner, getReview, canCreate,
    randomUUID: () => Crypto.randomUUID() }), [storage, getOwner, getReview, canCreate]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    let active = true;
    identity.set(null); session.sync();
    const subject = user?.email.trim().toLowerCase();
    if (status === 'signedIn' && subject) {
      void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
        JSON.stringify(['mkhadda.checkout.owner.v1', APP_ENV, subject])).then(ownerDigest => {
        if (!active || authSession.getRevision() !== sessionRevision || authSession.getSnapshot().status !== 'signedIn'
          || authSession.getSnapshot().user?.email.trim().toLowerCase() !== subject) return;
        if (!/^[a-f\d]{64}$/.test(ownerDigest)) throw new Error('invalid_owner_digest');
        identity.set({ owner: { environment: APP_ENV, ownerDigest, revision: sessionRevision }, subject });
        setIdentityError(null); session.sync();
        void session.recover(); void session.loadAvailability();
      }).catch(() => {
        if (!active) return;
        identity.set(null); session.sync(); setIdentityError(new ApiError('storage', 'checkout_identity_unavailable'));
      });
    }
    return () => { active = false; identity.set(null); };
  }, [identity, session, status, sessionRevision, user?.email]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    const deadline = session.getDeadline();
    if (deadline === null) return;
    const timer = setTimeout(() => session.sync(), Math.max(0, deadline - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [session, snapshot]);
  useEffect(() => {
    // A browser return/foreground event only reconciles existing state. It must
    // never manufacture payment success or automatically repeat a create POST.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        session.sync();
        if (session.presentation().hasRecovery) void session.recover();
      }
    });
    return () => subscription.remove();
  }, [session]);
  return { ...session.presentation(), error: snapshot.error || identityError,
    loadAvailability: session.loadAvailability, requestQuote: session.quote, submit: session.submit, recover: session.recover,
    refreshStatus: session.refreshStatus, getPaymentHandoff: session.getPaymentHandoff, canOpenWebsite: session.canOpenWebsite,
    clearCompleted: session.clearCompleted };
}
