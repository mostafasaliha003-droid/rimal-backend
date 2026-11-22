import type { createTransport } from './transport';
import { invalidResponse } from './errors';
import { hotelId } from './validation';

/*
 * Guest reviews for one hotel (RateHawk, 0–10). Reviews keep the words and language the guest
 * wrote them in; the summary averages only the ratings that were actually given.
 */
type Request = ReturnType<typeof createTransport>;
export type ReviewCategory = 'cleanness' | 'location' | 'price' | 'services' | 'room' | 'meal';
export interface HotelReview {
  id: string; author: string; positive: string; negative: string; rating: number | null;
  publishedAt: string; roomName: string; nights: number | null;
}
export interface HotelReviewsPage {
  status: 'ready' | 'empty' | 'checking' | 'unavailable';
  score: number | null; count: number; ratedCount: number;
  categories: { key: ReviewCategory; score: number; count: number }[];
  reviews: HotelReview[]; hasMore: boolean; nextOffset: number; retryAfterMs: number;
}

const CATEGORIES: readonly ReviewCategory[] = ['cleanness', 'location', 'price', 'services', 'room', 'meal'];
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, limit) : '';
const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? Math.round(value * 10) / 10 : null;

export function normalizeHotelReviews(value: unknown): HotelReviewsPage {
  const row = object(value), summary = object(row.summary);
  const status = row.status === 'ready' || row.status === 'empty' || row.status === 'checking' ? row.status : 'unavailable';
  const reviews = (Array.isArray(row.reviews) ? row.reviews : []).slice(0, 50).map((item, index) => {
    const review = object(item);
    const date = typeof review.publishedAt === 'string' && Number.isFinite(Date.parse(review.publishedAt)) ? review.publishedAt : '';
    return { id: text(review.id, 64) || 'review-' + index, author: text(review.author, 160), positive: text(review.positive, 4000),
      negative: text(review.negative, 4000), rating: score(review.rating), publishedAt: date, roomName: text(review.roomName, 300),
      nights: Number.isSafeInteger(review.nights) && Number(review.nights) > 0 ? Number(review.nights) : null };
  }).filter(review => review.rating !== null || review.positive || review.negative);
  const categories = (Array.isArray(summary.categories) ? summary.categories : []).flatMap(item => {
    const category = object(item), key = CATEGORIES.find(name => name === category.key), value = score(category.score);
    return key && value !== null && Number.isSafeInteger(category.count) && Number(category.count) > 0 ? [{ key, score: value, count: Number(category.count) }] : [];
  });
  const retry = Number(row.retryAfterMs);
  return { status, score: score(summary.score), count: Number.isSafeInteger(summary.count) ? Number(summary.count) : reviews.length,
    ratedCount: Number.isSafeInteger(summary.ratedCount) ? Number(summary.ratedCount) : 0, categories, reviews,
    hasMore: row.hasMore === true, nextOffset: Number.isSafeInteger(row.nextOffset) ? Math.min(200, Number(row.nextOffset)) : reviews.length,
    retryAfterMs: Number.isFinite(retry) ? Math.min(15000, Math.max(1500, retry)) : 3000 };
}

export async function getHotelReviews(request: Request, hid: number, language: string, offset = 0, signal?: AbortSignal) {
  if (hotelId(hid) === null || !Number.isSafeInteger(offset) || offset < 0 || offset > 200) throw invalidResponse();
  return normalizeHotelReviews(await request('GET', `/v1/hotels/${hid}/reviews/ratehawk`, { signal, timeoutMs: 20000,
    query: { language: language === 'ar' ? 'ar' : 'en', offset: String(offset) } }));
}
