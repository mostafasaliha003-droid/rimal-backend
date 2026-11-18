import type { SearchCriteria } from '../types';
import { copyCriteria } from './offerReviewModel';

export const SAVED_HOTELS_KEY = 'remal.savedHotelIds.v1';
export const SAVED_HOTELS_LIMIT = 100;
export interface SavedHotelsBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface SavedHotelsSnapshot {
  saved: readonly number[];
  ready: boolean;
  loading: boolean;
  pending: boolean;
  errorKind: 'load' | 'save' | null;
}

const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Keep the existing key, numeric IDs, first-occurrence order and first-100 load cap. */
export function readSavedHotelIds(raw: string | null): number[] {
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value)) throw new Error('saved_hotels_invalid');
  return [...new Set(value.filter(validId))].slice(0, SAVED_HOTELS_LIMIT);
}

/** Travel setup for Saved must not replace a known Explore destination or add a recent search. */
export function savedSearchSetup(value: SearchCriteria, existing: SearchCriteria | null, destinationName: string) {
  const next = copyCriteria(value);
  delete next.regionId;
  delete next.hids;
  if (existing && destinationName.trim()) {
    if (existing.regionId !== undefined) next.regionId = existing.regionId;
    if (existing.hids !== undefined) next.hids = [...existing.hids];
    return { criteria: next, destinationName };
  }
  if (value.hids !== undefined) next.hids = [...value.hids];
  return { criteria: next, destinationName: '' };
}

/** One application-provider store. It never persists anything except the desired numeric-ID array. */
export function createSavedHotelsStore(backend: SavedHotelsBackend) {
  let desired: readonly number[] = Object.freeze([]);
  let acknowledged = '[]';
  let ready = false, loading = false, writing = false, uncertain = false, paused = false;
  let errorKind: SavedHotelsSnapshot['errorKind'] = null;
  let readFlight: Promise<boolean> | null = null, writeFlight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const pending = () => ready && (writing || uncertain || JSON.stringify(desired) !== acknowledged);
  let snapshot: SavedHotelsSnapshot = Object.freeze({ saved: desired, ready, loading, pending: false, errorKind });
  const publish = () => {
    snapshot = Object.freeze({ saved: desired, ready, loading, pending: pending(), errorKind });
    listeners.forEach(listener => listener());
  };

  function requestWrite(): Promise<boolean> {
    if (writeFlight) return writeFlight;
    if (!ready || paused) return Promise.resolve(false);
    const task = Promise.resolve().then(async () => {
      while (uncertain || JSON.stringify(desired) !== acknowledged) {
        const target = JSON.stringify(desired);
        writing = true;
        publish();
        try { await backend.setItem(SAVED_HOTELS_KEY, target); }
        catch {
          // A rejected write may have reached storage. Never claim the old
          // acknowledgement is current or silently retry an ambiguous failure.
          writing = false; uncertain = true; paused = true; errorKind = 'save';
          publish();
          return false;
        }
        acknowledged = target;
        writing = false; uncertain = false; errorKind = null;
        publish();
      }
      return true;
    });
    writeFlight = task;
    void task.finally(() => {
      if (writeFlight === task) writeFlight = null;
      // Cover an explicit mutation queued at the completion boundary.
      if (!paused && pending()) void requestWrite();
    });
    return task;
  }

  function load(): Promise<boolean> {
    if (ready) return Promise.resolve(true);
    if (readFlight) return readFlight;
    loading = true; errorKind = null; publish();
    const task = Promise.resolve().then(async () => {
      try {
        const ids = readSavedHotelIds(await backend.getItem(SAVED_HOTELS_KEY));
        desired = Object.freeze(ids);
        acknowledged = JSON.stringify(ids);
        ready = true; errorKind = null;
        return true;
      } catch {
        // Failed/corrupt reads never become an empty writable list. Only an
        // explicit retry can establish the previous contents safely.
        errorKind = 'load';
        return false;
      } finally { loading = false; publish(); }
    });
    readFlight = task;
    void task.finally(() => { if (readFlight === task) readFlight = null; });
    return task;
  }

  function change(next: number[]) {
    if (next.length === desired.length && next.every((id, index) => id === desired[index])) return;
    desired = Object.freeze(next);
    publish();
    if (!paused) void requestWrite();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    toggle(hid: number) {
      if (!ready || !validId(hid)) return;
      change(desired.includes(hid) ? desired.filter(id => id !== hid) : [...desired, hid].slice(-SAVED_HOTELS_LIMIT));
    },
    remove(hid: number) {
      if (!ready || !validId(hid) || !desired.includes(hid)) return;
      change(desired.filter(id => id !== hid));
    },
    restore(hid: number, index: number) {
      if (!ready || !validId(hid) || !Number.isSafeInteger(index)
        || desired.includes(hid) || desired.length >= SAVED_HOTELS_LIMIT) return;
      const next = [...desired];
      next.splice(Math.max(0, Math.min(index, next.length)), 0, hid);
      change(next);
    },
    retry(): Promise<boolean> {
      if (!ready) return load();
      paused = false;
      return requestWrite();
    },
  };
}
