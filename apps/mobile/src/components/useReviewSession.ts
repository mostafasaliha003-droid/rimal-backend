import { useEffect, useState, useSyncExternalStore } from 'react';
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
    const deadline = Math.min(reviewDraft.createdAt + REVIEW_SELECTION_LIFETIME_MS, snapshot.expiresAt ?? Infinity);
    const timer = setTimeout(() => session.sync(), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [session, reviewDraft, snapshot.expiresAt, snapshot.status]);
  return { ...session.presentation(), recheck: session.recheck, acceptChanges: session.acceptChanges,
    clear: session.clear, getHandoff: session.getHandoff };
}
