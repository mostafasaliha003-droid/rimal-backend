import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { RoomOffer } from '../types';
import { parseCancellationTimestamp } from './cancellationPresentationModel';

/** One clock can drive every cancellation summary/filter on a hotel page. */
export function useCancellationClock(cancellations: readonly RoomOffer['cancellation'][]): number {
  // Only dates affect the timer. Amount, display-language and disclosure changes
  // need no new listener, and caller-created arrays do not restart the clock.
  const boundariesKey = JSON.stringify(cancellations.map(source => [source.freeUntil,
    ...source.policies.flatMap(period => [period.startAt, period.endAt])]));
  const [clock, setClock] = useState(() => ({ key: boundariesKey, now: Date.now() }));

  useEffect(() => {
    if (boundariesKey === '[]') return;
    const sources = JSON.parse(boundariesKey) as (string | null)[][];
    const boundaries = sources.flat().map(parseCancellationTimestamp).filter((value): value is number => value !== null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const schedule = (now: number) => {
      if (timer) clearTimeout(timer);
      const next = boundaries.reduce((soonest, value) => value > now && value < soonest ? value : soonest, Infinity);
      if (!Number.isFinite(next) || !Number.isFinite(now)) return;
      // Long stays must not overflow the platform's signed 32-bit timer delay.
      timer = setTimeout(update, Math.min(2_147_483_647, Math.max(1, next - now)));
    };
    const update = () => {
      if (!active) return;
      const now = Date.now();
      setClock({ key: boundariesKey, now });
      schedule(now);
    };
    // Refresh after a changed schedule without synchronously setting state in
    // an effect. Until then the caller receives unknown, never an old free fee.
    const initial = setTimeout(update, 0);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    return () => { active = false; clearTimeout(initial); if (timer) clearTimeout(timer); subscription.remove(); };
  }, [boundariesKey]);

  return clock.key === boundariesKey ? clock.now : Number.NaN;
}
