import { currencyForCountry, isDisplayCurrency } from './currencyCatalog';

export const CURRENCY_PREFERENCE_KEY = 'pillow.currency.manual.v1';
const REGION_REFRESH_MS = 15 * 60_000;
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
type Region = { regionCode?: string | null; currencyCode?: string | null };
type CurrencySelection = { currency: string; source: 'network' | 'device' | 'default' | 'manual'; country: string | null };
type Snapshot = CurrencySelection & { ready: boolean; detecting: boolean; saveFailed: boolean };
// Mkhadda is a UAE company and charges in dirhams: when neither the network nor the device names a
// country we know, prices start in AED (the guest can still choose any display currency).
const fallback: CurrencySelection = { currency: 'AED', source: 'default', country: null };

function deviceSelection(getRegion: () => Region | undefined): CurrencySelection {
  try {
    const region = getRegion();
    const country = region?.regionCode?.toUpperCase() || null;
    const currency = currencyForCountry(country);
    if (currency) return { currency, country, source: 'device' };
    if (isDisplayCurrency(region?.currencyCode)) return { currency: region.currencyCode, country: null, source: 'device' };
  } catch { /* Device locale data is optional. */ }
  return fallback;
}

export function createCurrencyPreference(storage: Storage, getNetworkCountry: (signal: AbortSignal) => Promise<string | null>,
  getRegion: () => Region | undefined, now: () => number = Date.now) {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = { ...deviceSelection(getRegion), ready: false, detecting: false, saveFailed: false };
  let restored = false, revision = 0;
  let restoreFlight: Promise<void> | null = null, writes = Promise.resolve();
  let inFlight: AbortController | null = null, lastCheck = -Infinity;

  function publish(change: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach(notify => notify());
  }
  function save(value: string | null) {
    const version = revision;
    // AsyncStorage writes must commit in the same order as the user's taps.
    writes = writes.then(async () => {
      try {
        if (value === null) await storage.removeItem(CURRENCY_PREFERENCE_KEY);
        else await storage.setItem(CURRENCY_PREFERENCE_KEY, value);
      } catch { if (version === revision) publish({ saveFailed: true }); }
    });
    return writes;
  }
  async function detect(force = false) {
    const elapsed = now() - lastCheck;
    if (!restored || snapshot.source === 'manual' || inFlight || (!force && elapsed >= 0 && elapsed < REGION_REFRESH_MS)) return;
    const request = new AbortController();
    inFlight = request;
    publish({ detecting: true });
    let country: string | null;
    try { country = await getNetworkCountry(request.signal); } catch { country = null; }
    if (inFlight !== request || request.signal.aborted) return;
    inFlight = null;
    lastCheck = now();
    const currency = currencyForCountry(country);
    const selection = currency ? { currency, source: 'network' as const, country } : deviceSelection(getRegion);
    publish({ ...selection, ready: true, detecting: false });
  }
  async function start() {
    if (restored) return detect();
    if (restoreFlight) return restoreFlight;
    const version = revision;
    restoreFlight = (async () => {
      let stored: string | null;
      try { stored = await storage.getItem(CURRENCY_PREFERENCE_KEY); } catch { stored = null; }
      if (revision !== version) return;
      restored = true;
      if (isDisplayCurrency(stored)) publish({ currency: stored, country: null, source: 'manual', ready: true });
      else await detect();
    })();
    return restoreFlight;
  }
  function cancelDetection() {
    revision++;
    restored = true;
    inFlight?.abort();
    inFlight = null;
  }
  function choose(currency: string) {
    if (!isDisplayCurrency(currency)) return;
    cancelDetection();
    publish({ currency, country: null, source: 'manual', ready: true, detecting: false, saveFailed: false });
    return save(currency);
  }
  async function useAutomatic() {
    cancelDetection();
    publish({ ...deviceSelection(getRegion), ready: false, saveFailed: false });
    await Promise.all([save(null), detect(true)]);
  }
  return {
    subscribe: (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
    getSnapshot: () => snapshot, start, choose, useAutomatic,
  };
}
