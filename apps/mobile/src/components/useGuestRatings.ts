import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { GuestRating } from '../api/reviews';
import type { Language } from '../i18n';

/*
 * Guest ratings for the hotels on screen. Answers are kept for this session (ratings change
 * slowly and the server caches them for 12 hours), so returning to a list or opening a hotel
 * never asks twice. Hotels the server is still fetching are asked once more a moment later.
 * The answers live in React state, so a screen re-renders the moment they arrive.
 */
const known = new Map<string, GuestRating | null>();
const keyOf = (language: string, hid: number) => `${language}:${hid}`;
const RETRY_MS = 3500;

export function useGuestRatings(hids: readonly number[], language: Language): ReadonlyMap<number, GuestRating | null> {
  const wanted = useMemo(() => [...new Set(hids)].filter(hid => Number.isSafeInteger(hid) && hid > 0).slice(0, 50), [hids]);
  const signature = wanted.join(',');
  const [store, setStore] = useState<ReadonlyMap<string, GuestRating | null>>(() => new Map(known));
  useEffect(() => {
    const ids = signature ? signature.split(',').map(Number) : [];
    const missing = ids.filter(hid => !known.has(keyOf(language, hid)));
    if (!missing.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (list: number[], retry: boolean) => {
      api.getGuestRatings(list, language, controller.signal).then(({ ratings, pending }) => {
        if (controller.signal.aborted) return;
        ratings.forEach((rating, hid) => known.set(keyOf(language, hid), rating));
        setStore(new Map(known));
        if (retry && pending.length) timer = setTimeout(() => ask(pending, false), RETRY_MS);
      }).catch(() => undefined);
    };
    ask(missing, true);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [signature, language]);
  return useMemo(() => {
    const map = new Map<number, GuestRating | null>();
    for (const hid of wanted) {
      const key = keyOf(language, hid);
      const value = store.has(key) ? store.get(key) : known.get(key);
      if (value !== undefined) map.set(hid, value);
    }
    return map;
  }, [wanted, language, store]);
}
