import type { SearchCriteria } from '../types';
import { validateSearchCriteria } from '../api/validation';

/*
 * "Continue your search" across app launches. Only the destination label and the
 * search criteria are kept on the device: no guest names, contacts, prices, offers
 * or payment data. The record is environment-scoped, expires, and is cleared on sign-out.
 */
export const LAST_SEARCH_KEY = 'pillow.lastSearch.v1';
export const LAST_SEARCH_MAX_AGE_MS = 60 * 86_400_000;
export interface LastSearch { name: string; criteria: SearchCriteria; savedAt: number }
interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }

const cleanName = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160
  && !/[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(value) ? value.trim() : null;

function portable(criteria: SearchCriteria): SearchCriteria | null {
  const destination = criteria.regionId ? { regionId: criteria.regionId } : criteria.hids?.length === 1 ? { hids: [criteria.hids[0]] } : null;
  // Saved-hotel comparisons (several hotels) are resumed from Saved stays, not from home.
  if (!destination) return null;
  return { checkin: criteria.checkin, checkout: criteria.checkout, residency: criteria.residency, currency: 'USD',
    guests: criteria.guests.map(room => ({ adults: room.adults, children: [...room.children] })), ...destination };
}

/** Structural check that tolerates past dates: those are surfaced to the traveler, not dropped silently. */
function structurallyValid(criteria: SearchCriteria) {
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(criteria.checkin) ? new Date(`${criteria.checkin}T12:00:00`) : new Date(NaN);
  if (!Number.isFinite(anchor.getTime())) return false;
  return validateSearchCriteria(criteria, anchor).valid;
}

export function encodeLastSearch(criteria: SearchCriteria, name: string, environment: string, now = Date.now()): string | null {
  const label = cleanName(name), value = portable(criteria);
  if (!label || !value || !structurallyValid(value)) return null;
  return JSON.stringify({ v: 1, env: environment, name: label, savedAt: now, criteria: value });
}

export function decodeLastSearch(raw: string | null, environment: string, now = Date.now()): LastSearch | null {
  if (!raw || raw.length > 4000) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const savedAt = Number(row.savedAt), name = cleanName(row.name);
  if (row.v !== 1 || row.env !== environment || !name || !Number.isFinite(savedAt)
    || savedAt > now + 86_400_000 || now - savedAt > LAST_SEARCH_MAX_AGE_MS) return null;
  const source = row.criteria as SearchCriteria | undefined;
  if (!source || typeof source !== 'object' || !Array.isArray(source.guests)) return null;
  const value = portable(source);
  return value && structurallyValid(value) ? { name, criteria: value, savedAt } : null;
}

/** Device-local today (YYYY-MM-DD) decides whether the stored dates can still be searched. */
export function resumeState(record: LastSearch, today: string): 'ready' | 'datesPassed' {
  return record.criteria.checkin < today ? 'datesPassed' : 'ready';
}

/** Criteria for a fresh search with today's currency and language; nothing is reused from an old result. */
export function resumeCriteria(record: LastSearch, currency: string, language: SearchCriteria['language']): SearchCriteria {
  return { ...record.criteria, guests: record.criteria.guests.map(room => ({ adults: room.adults, children: [...room.children] })), currency, language };
}

export function createLastSearchStore(storage: Storage, environment: string) {
  let snapshot: { ready: boolean; record: LastSearch | null } = { ready: false, record: null };
  const listeners = new Set<() => void>();
  let writes = Promise.resolve();
  let loading: Promise<void> | null = null;
  const publish = (next: typeof snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const queue = (task: () => Promise<void>) => { writes = writes.then(task).catch(() => {}); return writes; };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    load() {
      loading ??= storage.getItem(LAST_SEARCH_KEY).then(raw => {
        // A newer save during the read wins over the stored value.
        if (!snapshot.ready) publish({ ready: true, record: decodeLastSearch(raw, environment) });
      }).catch(() => { if (!snapshot.ready) publish({ ready: true, record: null }); });
      return loading;
    },
    save(criteria: SearchCriteria, name: string, now = Date.now()) {
      const encoded = encodeLastSearch(criteria, name, environment, now);
      if (!encoded) return writes;
      publish({ ready: true, record: decodeLastSearch(encoded, environment, now) });
      return queue(() => storage.setItem(LAST_SEARCH_KEY, encoded));
    },
    clear() {
      publish({ ready: true, record: null });
      return queue(() => storage.removeItem(LAST_SEARCH_KEY));
    },
  };
}
