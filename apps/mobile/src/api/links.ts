import type { AppEnvironment, Language, SearchCriteria } from '../types';
import { APP_ENV, endpoints } from './config';
import { ApiError } from './errors';
import { assertCriteria, hotelId } from './validation';

export type WebsitePath = '/account' | '/support' | '/privacy' | '/terms' | '/membership';
const paths = new Set<WebsitePath>(['/account', '/support', '/privacy', '/terms', '/membership']);
export function websiteUrl(path: WebsitePath, environment: AppEnvironment = APP_ENV) {
  if (!paths.has(path)) throw new ApiError('validation', 'invalid_website_path');
  return `${endpoints(environment).website}${path}`;
}
export function bookingWebsiteUrl(hid: number, criteria: SearchCriteria, language: Language = 'en', environment: AppEnvironment = APP_ENV) {
  const id = hotelId(hid);
  if (id === null || !['ar', 'en', 'es'].includes(language)) throw new ApiError('validation', 'invalid_hotel_link');
  assertCriteria({ ...criteria, regionId: undefined, hids: [id] });
  const url = new URL(`/hotel/${id}`, endpoints(environment).website);
  // Occupancy/search dates are shareable; session tokens, guest identities,
  // offer hashes and checkout capabilities never enter a handoff URL.
  url.search = new URLSearchParams({ checkin: criteria.checkin, checkout: criteria.checkout,
    residency: criteria.residency, guests: JSON.stringify(criteria.guests), lang: language }).toString();
  return url.href;
}
