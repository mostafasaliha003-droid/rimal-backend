/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const m = load(path.resolve(__dirname, './guestRatingModel.ts'));
const r = load(path.resolve(__dirname, '../api/reviews.ts'));

test('a guest score is shown only with enough ratings and reads with one decimal', () => {
  assert.equal(m.shownRating({ score: 9.4, count: 2 }), null);
  assert.deepEqual(m.shownRating({ score: 9.4, count: 3 }), { score: 9.4, count: 3 });
  assert.equal(m.shownRating(null), null);
  assert.equal(m.ratingScore(8), '8.0');
  assert.equal(m.ratingScore(9.4), '9.4');
});

test('score words and Arabic count agreement', () => {
  assert.equal(m.ratingWord(9.1, 'ar'), 'استثنائي');
  assert.equal(m.ratingWord(8.0, 'en'), 'Excellent');
  assert.equal(m.ratingWord(7.2, 'ar'), 'جيد جداً');
  assert.equal(m.ratingWord(6, 'en'), 'Good');
  assert.equal(m.ratingWord(5.9, 'en'), '');
  assert.equal(m.ratingCount(1, 'ar'), 'تقييم واحد');
  assert.equal(m.ratingCount(2, 'ar'), 'تقييمان');
  assert.equal(m.ratingCount(7, 'ar'), '7 تقييمات');
  assert.equal(m.ratingCount(120, 'ar'), '120 تقييماً');
  assert.equal(m.ratingCount(105, 'ar'), '105 تقييمات');
  assert.equal(m.ratingCount(1, 'en'), '1 rating');
  assert.equal(m.ratingLabel({ score: 8.6, count: 120 }, 'en'), 'Guest rating 8.6 out of 10, Excellent, 120 ratings');
});

test('rating summaries: null means no ratings, missing or pending means ask again, malformed means none', () => {
  const { ratings, pending } = r.normalizeRatingSummaries({
    summaries: { 1: { score: 8.64, count: 120 }, 2: null, 3: { score: 11, count: 5 }, 4: { score: 7, count: 0 }, 6: { score: 9, count: 4 } },
    pending: ['6'],
  }, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ratings.get(1), { score: 8.6, count: 120 });
  assert.equal(ratings.get(2), null);
  assert.equal(ratings.get(3), null);
  assert.equal(ratings.get(4), null);
  assert.equal(ratings.has(5), false);
  assert.deepEqual(pending, [5, 6]);
  assert.deepEqual([...r.normalizeRatingSummaries('nonsense', [9]).pending], [9]);
});

test('hotel reviews keep only real reviews and known categories, and read the page state', () => {
  const reviews = load(path.resolve(__dirname, '../api/hotelReviews.ts'));
  const page = reviews.normalizeHotelReviews({ status: 'ready', hasMore: true, nextOffset: 10, summary: { score: 8.64, count: 3, ratedCount: 2,
    categories: [{ key: 'cleanness', score: 9.1, count: 2 }, { key: 'invented', score: 5, count: 1 }, { key: 'room', score: 12, count: 1 }] },
  reviews: [{ id: '1', author: 'Guest', positive: 'Great pool', negative: '', rating: 9, publishedAt: '2026-10-01T00:00:00.000Z', roomName: 'Family room', nights: 2 },
    { id: '2', author: 'Empty', positive: '', negative: '', rating: null }, { id: '3', negative: 'Noisy\u202e', rating: 7.5 }] });
  assert.equal(page.status, 'ready'); assert.equal(page.score, 8.6); assert.equal(page.ratedCount, 2);
  assert.deepEqual(page.categories, [{ key: 'cleanness', score: 9.1, count: 2 }]);
  assert.deepEqual(page.reviews.map(item => item.id), ['1', '3']);
  assert.equal(page.reviews[1].negative, 'Noisy');
  assert.equal(page.hasMore, true); assert.equal(page.nextOffset, 10);
  assert.equal(reviews.normalizeHotelReviews({ status: 'weird' }).status, 'unavailable');
  assert.equal(reviews.normalizeHotelReviews({ status: 'checking', retryAfterMs: 1 }).retryAfterMs, 1500);
});
