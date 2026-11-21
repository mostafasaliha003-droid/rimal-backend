import type { GuestRating } from '../api/reviews';

/** A score from one or two guests says little; it is shown only from this many ratings. */
export const MIN_RATINGS = 3;

export function shownRating(rating: GuestRating | null | undefined): GuestRating | null {
  return rating && rating.count >= MIN_RATINGS ? rating : null;
}

/** A word for the score on the 0–10 scale; below 6 the number speaks for itself. */
export function ratingWord(score: number, language: string): string {
  const ar = language === 'ar';
  if (score >= 9) return ar ? 'استثنائي' : 'Exceptional';
  if (score >= 8) return ar ? 'ممتاز' : 'Excellent';
  if (score >= 7) return ar ? 'جيد جداً' : 'Very good';
  if (score >= 6) return ar ? 'جيد' : 'Good';
  return '';
}

/** "120 تقييماً" / "120 ratings", with Arabic number agreement. */
export function ratingCount(count: number, language: string): string {
  if (language !== 'ar') return `${count} ${count === 1 ? 'rating' : 'ratings'}`;
  if (count === 1) return 'تقييم واحد';
  if (count === 2) return 'تقييمان';
  const tens = count % 100;
  return `${count} ${tens >= 3 && tens <= 10 ? 'تقييمات' : 'تقييماً'}`;
}

/** One decimal, always ("8.0", "9.4"), in Western digits like every price in the app. */
export const ratingScore = (score: number) => score.toFixed(1);

/** The full spoken description: "Guest rating 8.6 out of 10, Excellent, 120 ratings". */
export function ratingLabel(rating: GuestRating, language: string): string {
  const word = ratingWord(rating.score, language);
  return language === 'ar'
    ? [`تقييم الضيوف ${ratingScore(rating.score)} من 10`, word, ratingCount(rating.count, language)].filter(Boolean).join('، ')
    : [`Guest rating ${ratingScore(rating.score)} out of 10`, word, ratingCount(rating.count, language)].filter(Boolean).join(', ');
}
