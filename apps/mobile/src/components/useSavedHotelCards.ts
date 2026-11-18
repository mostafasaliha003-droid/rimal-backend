import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, authSession } from '../api';
import type { Language } from '../types';
import { loadSavedHotelCards, type SavedHotelCard } from './savedHotelCards';

export type { SavedHotelCard } from './savedHotelCards';
interface Cache {
  scope: string;
  cards: Map<number, SavedHotelCard>;
  failed: Set<number>;
}

function empty(scope: string): Cache {
  return { scope, cards: new Map(), failed: new Set() };
}

export function useSavedHotelCards(ids: readonly number[], language: Language, authStatus: string, sessionRevision: number) {
  const scope = JSON.stringify([language, authStatus, sessionRevision]);
  const cache = useRef<Cache>(empty(scope));
  const [snapshot, setSnapshot] = useState<Cache>(() => empty(scope));
  const revision = useRef(0);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(useCallback(() => {
    if (authStatus === 'loading') return;
    if (cache.current.scope !== scope) cache.current = empty(scope);
    const data = cache.current;
    // Prune removed IDs and keep only the explicitly displayed pages in memory.
    const visible = new Set(ids);
    for (const id of data.cards.keys()) if (!visible.has(id)) data.cards.delete(id);
    for (const id of data.failed) if (!visible.has(id)) data.failed.delete(id);
    const controller = new AbortController();
    const active = () => revision.current === attempt && !controller.signal.aborted && cache.current === data
      && authSession.getRevision() === sessionRevision && authSession.getSnapshot().status === authStatus;
    const publish = () => setSnapshot({ scope, cards: new Map(data.cards), failed: new Set(data.failed) });
    publish();
    const missing = ids.filter(id => !data.cards.has(id) && !data.failed.has(id));
    void loadSavedHotelCards(missing, id => api.getHotelStatic(id, language, controller.signal), active, (id, card) => {
      if (card) data.cards.set(id, card);
      else data.failed.add(id);
      publish();
    });
    return () => controller.abort();
  }, [scope, ids, language, authStatus, sessionRevision, attempt]));

  const retry = () => {
    if (cache.current.scope === scope) cache.current.failed.clear();
    setAttempt(++revision.current);
  };
  const current = snapshot.scope === scope ? snapshot : empty(scope);
  return { cards: current.cards, failed: current.failed, retry,
    loading: ids.some(id => !current.cards.has(id) && !current.failed.has(id)) };
}
