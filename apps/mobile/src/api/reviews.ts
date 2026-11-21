/** A hotel's average guest score on RateHawk's 0–10 scale and how many guests rated it. */
export interface GuestRating { score: number; count: number }

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * Reads the rating-summary response for the hotels that were asked about. A hotel listed with
 * null has no rated reviews; a hotel missing from the answer (or listed as pending) is still
 * being fetched and may be asked again later. Anything malformed counts as "no rating".
 */
export function normalizeRatingSummaries(value: unknown, hids: readonly number[]): { ratings: Map<number, GuestRating | null>; pending: number[] } {
  const row = object(value), summaries = object(row.summaries);
  const pendingList = Array.isArray(row.pending) ? row.pending.map(String) : [];
  const ratings = new Map<number, GuestRating | null>(), pending: number[] = [];
  for (const hid of hids) {
    const key = String(hid);
    if (!Object.hasOwn(summaries, key) || pendingList.includes(key)) { pending.push(hid); continue; }
    const summary = object(summaries[key]);
    const score = summary.score, count = summary.count;
    ratings.set(hid, typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10
      && Number.isSafeInteger(count) && Number(count) > 0 ? { score: Math.round(score * 10) / 10, count: Number(count) } : null);
  }
  return { ratings, pending };
}
