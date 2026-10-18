import { RATING_MIN_COUNT_TO_DISPLAY } from '../config/policyConfig';

/**
 * Rule 23.1: an Average Rating is shown as soon as the account has at least one rating; before that it reads "Not Yet Rated" - never a number, never a default.
 * The database holds the Average Rating (driver.weighted_average_rating, passenger.average_rating, NULL = not rated) and the number of ratings it is made of
 * (rating_count); every screen reads it through these functions so no screen invents a default (the old fallbacks were 4.0 and 5.0).
 */

export type RatingLanguage = 'en' | 'tl';

/** The number to show, or null when the account is Not Yet Rated. `count` may be omitted by a screen that only has the average (NULL still means Not Yet Rated). */
export function displayedAverageRating(average: unknown, count?: number | null): number | null {
  if (average === null || average === undefined || average === '') return null;
  if (count !== undefined && count !== null && count < RATING_MIN_COUNT_TO_DISPLAY) return null;
  const n = Number(average);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const NOT_YET_RATED: Record<RatingLanguage, string> = { en: 'Not Yet Rated', tl: 'Wala pang rating' };

/** "4.6", or "Not Yet Rated" / "Wala pang rating" */
export function formatAverageRating(average: unknown, count?: number | null, language: RatingLanguage = 'en', digits = 1): string {
  const value = displayedAverageRating(average, count);
  return value === null ? NOT_YET_RATED[language] : value.toFixed(digits);
}
