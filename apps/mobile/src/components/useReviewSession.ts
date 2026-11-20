import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api } from '../api';
import { useAppState } from './AppState';
import { createOfferReviewSession, REVIEW_SELECTION_LIFETIME_MS } from './offerReviewModel';

export function useReviewSession() {
  const { reviewDraft, getReviewDraft, clearReviewDraft } = useAppState();
  const [session] = useState(() => createOfferReviewSession({ getDraft: getReviewDraft,
    clearDraft: clearReviewDraft, prebook: api.prebook }));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { session.sync(); }, [session, reviewDraft?.id]);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (!reviewDraft || snapshot.status === 'expired') return;
    const deadline = snapshot.expiresAt ?? reviewDraft.createdAt + REVIEW_SELECTION_LIFETIME_MS;
    const timer = setTimeout(() => session.sync(), Math.max(0, deadline - Date.now()));
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') session.sync(); });
    return () => { clearTimeout(timer); foreground.remove(); };
  }, [session, reviewDraft, snapshot.expiresAt, snapshot.status]);
  const view = session.presentation();
  return { ...view, recheck: session.recheck, acceptChanges: () => session.acceptChanges(view.confirmationRevision),
    clear: session.clear, getHandoff: session.getHandoff, getCheckoutReview: session.getCheckoutReview };
}
