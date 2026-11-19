import type { GuestRoom, SearchCriteria, Suggestion } from '../types';
import { addDays, todayDate, validDate } from './calendarModel';
import { localeFor } from './format';

export type QuickStay = 'tonight' | 'tomorrow' | 'nextWeek';

export const featuredCities = {
  dubai: { en: 'Dubai', ar: 'دبي', countries: ['AE', 'UAE', 'United Arab Emirates', 'الإمارات العربية المتحدة', 'الإمارات'] },
  istanbul: { en: 'Istanbul', ar: 'إسطنبول', countries: ['TR', 'Türkiye', 'Turkey', 'تركيا'] },
  paris: { en: 'Paris', ar: 'باريس', countries: ['FR', 'France', 'فرنسا'] },
} as const;
export type DestinationId = keyof typeof featuredCities;

function lookupText(value: string) {
  return value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function destinationLookupName(value: string) {
  return Object.values(featuredCities).find(city => lookupText(value) === lookupText(city.ar))?.en ?? value.trim();
}

// Curated photographs select a city. Only a matching city/country pair from the
// supplier can resolve the shortcut directly; ambiguous results remain selectable.
export function resolveFeaturedCity(id: DestinationId, suggestions: Suggestion[]) {
  const city = featuredCities[id];
  const names = [lookupText(city.ar), lookupText(city.en)];
  const matches = suggestions.filter(item => item.type === 'region' && !!item.regionId && names.includes(lookupText(item.name)));
  const candidates = matches.filter(item => {
    if (item.subtitle) return city.countries.some(country => lookupText(country) === lookupText(item.subtitle!));
    // This city has been verified in the supplier index, which can omit its country label.
    return id === 'dubai' && item.regionId === 6053839;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function displayTravelDate(value: string, language: string) {
  if (!validDate(value)) return value;
  const locale = localeFor(language);
  const showYear = Number(value.slice(0, 4)) !== new Date().getFullYear();
  // Keep the supplier's calendar day when formatting from any device time zone.
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: showYear ? 'numeric' : undefined, calendar: 'gregory', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

// Use the device's local calendar day before doing calendar-day arithmetic.
export function quickStayDates(kind: QuickStay, now = new Date()) {
  const today = todayDate(now);
  const checkin = addDays(today, kind === 'tonight' ? 0 : kind === 'tomorrow' ? 1 : 7);
  return { checkin, checkout: addDays(checkin, kind === 'nextWeek' ? 2 : 1) };
}

export function stayNights(checkin: string, checkout: string): number | null {
  if (!validDate(checkin) || !validDate(checkout)) return null;
  const nights = (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000;
  return Number.isInteger(nights) && nights >= 1 && nights <= 30 ? nights : null;
}

export function destinationFromSearch(criteria: SearchCriteria | null, name: string): Suggestion | null {
  if (!criteria || !name.trim()) return null;
  const region = Number.isSafeInteger(criteria.regionId) && Number(criteria.regionId) > 0;
  const hotels = criteria.hids;
  if (region && !hotels?.length) return { id: `region-${criteria.regionId}`, type: 'region', name, regionId: criteria.regionId };
  if (!region && hotels?.length === 1 && Number.isSafeInteger(hotels[0]) && hotels[0] > 0) {
    return { id: `hotel-${hotels[0]}`, type: 'hotel', name, hid: hotels[0] };
  }
  return null;
}

export function shouldSuggestDestination(query: string, selected: Suggestion | null) {
  return query.trim().length >= 2 && selected?.name !== query;
}

export function copyGuestRooms(guests: GuestRoom[]): GuestRoom[] {
  return guests.map(room => ({ adults: room.adults, children: [...room.children] }));
}

// Restore form data only. Navigation, supplier calls, and booking capabilities
// have no place in a recent-search draft.
export function recentSearchDraft(recent: { name: string; criteria: SearchCriteria }) {
  const selected = destinationFromSearch(recent.criteria, recent.name);
  if (!selected) return null;
  return { query: recent.name, selected, checkin: recent.criteria.checkin, checkout: recent.criteria.checkout,
    residency: recent.criteria.residency, currency: recent.criteria.currency, guests: copyGuestRooms(recent.criteria.guests) };
}
