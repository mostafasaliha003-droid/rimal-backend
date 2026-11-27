import type { HotelDetails, HotelSummary, Money, RoomOffer, Suggestion, User } from '../types';
import { invalidResponse } from './errors';
import { hotelId, parseCancellationTimestamp } from './validation';
import { normalizeHotelAmenities } from './hotelAmenities';

type Row = Record<string, unknown>;
export const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function label(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const row = object(value);
  return typeof row.content === 'string' ? row.content.trim() : typeof row.value === 'string' ? row.value.trim() : '';
}
const decimal = (value: unknown, zero = false): string | null => {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && (zero ? amount >= 0 : amount > 0) ? String(value) : null;
};
const currency = (value: unknown): string | null => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
export function customerPrice(value: unknown): Money | null {
  const row = object(value);
  const amount = decimal(row.customer_display_amount), code = currency(row.customer_display_currency);
  // A net supplier amount is never silently presented as the customer total.
  return amount !== null && code !== null ? { amount, currency: code } : null;
}
export function utcTimestamp(value: unknown): string | null {
  const time = parseCancellationTimestamp(value);
  return time === null ? null : new Date(time).toISOString();
}
function imageUrl(value: string): string | null {
  const size = '1920x1080';
  let raw = value.trim().replace(/\{size\}|%7bsize%7d/gi, size);
  if (!raw || raw.length > 2048 || /[\\\s]|unsplash\.com|33036666\.jpg|35165972\.jpg/i.test(raw)) return null;
  if (raw.startsWith('//')) raw = `https:${raw}`;
  if (/^\/?t\/(?:\d*x\d+|orig)\//i.test(raw)) raw = 'https://cdn.worldota.net/' + raw.replace(/^\//, '');
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.port) return null;
    if (/^cdn\.(worldota|ratehawk)\.net$/.test(url.hostname) && ['http:', 'https:'].includes(url.protocol)) {
      url.protocol = 'https:';
      url.hostname = 'cdn.worldota.net';
      // ETG rejects the former mobile preset with HTTP 400, including cached URLs.
      url.pathname = url.pathname.replace(/^\/t\/640x480\//i, '/t/' + size + '/');
    }
    if (url.protocol !== 'https:'
      || !/(^|\.)(worldota\.net|ratehawk\.net|ostrovok\.ru|remalbookings\.com|rimal-api(?:-staging)?\.onrender\.com)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function images(...values: unknown[]): string[] {
  const result = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || result.size >= 200) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (typeof value === 'string') { const url = imageUrl(value); if (url) result.add(url); return; }
    const row = object(value);
    const keys = ['url', 'src', 'image', 'photo', 'source'];
    const explicit = keys.filter(key => Object.hasOwn(row, key));
    (explicit.length ? explicit : Object.keys(row).filter(key => !['category_slug', 'category', 'caption', 'alt', 'width', 'height', 'w', 'h', 'type'].includes(key)))
      .forEach(key => visit(row[key], depth + 1));
  };
  values.forEach(value => visit(value));
  return [...result];
}
// The first photo is the hotel's cover on every card. RateHawk tags many photos with a category;
// a room, the building or the view sells the stay, a kitchen or a bathroom does not. Only the
// order changes (stable within a tier, nothing dropped); untagged photos keep the supplier's order.
const COVER_TIER: Readonly<Record<string, number>> = {
  guest_rooms: 0, hotel_rooms: 0, exterior: 0, outside: 0, pool: 0, beach: 0, balcony: 0, view: 0,
  lobby: 1, restaurant: 1, spa: 1, sports: 1, bar: 1,
  kitchen: 2, bathroom: 2, people: 2, interior: 1, unspecified: 1,
};
function coverTier(category: unknown): number {
  return typeof category === 'string' && Object.hasOwn(COVER_TIER, category) ? COVER_TIER[category] : 1;
}
export function rankByCategory(photos: string[], ...tagged: unknown[]): string[] {
  const tier = new Map<string, number>();
  for (const entry of tagged.flatMap(value => Array.isArray(value) ? value : [])) {
    const row = object(entry), url = typeof row.url === 'string' ? imageUrl(row.url) : null;
    if (url && !tier.has(url)) tier.set(url, coverTier(row.category_slug));
  }
  if (!tier.size) return photos;
  return photos.map((url, index) => ({ url, index, tier: tier.get(url) ?? 1 }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index).map(item => item.url);
}
export function hotelPhotos(hotel: unknown): string[] {
  const row = object(hotel), cached = object(row.staticData);
  return rankByCategory(images(row.images_ext, row.images, row.image, cached.images_ext, cached.images, cached.image), row.images_ext, cached.images_ext);
}
const RG_FIELDS = ['class', 'quality', 'sex', 'bathroom', 'bedding', 'family', 'capacity', 'club', 'bedrooms', 'balcony', 'view', 'floor'];
function classification(value: unknown): string | null {
  const row = object(value), keys = Object.keys(row).sort();
  return RG_FIELDS.every(key => Number.isInteger(row[key]) && Number(row[key]) >= 0)
    && keys.every(key => Number.isInteger(row[key]) && Number(row[key]) >= 0)
    ? JSON.stringify(keys.map(key => [key, row[key]])) : null;
}
function cancellationTerms(payment: Row | undefined): RoomOffer['cancellation'] {
  const source = payment?.cancellation_penalties;
  const penalty = object(source);
  const currencyCode = currency(payment?.currency_code);
  const freeUntil = utcTimestamp(penalty.free_cancellation_before);
  const incomplete = source != null && (typeof source !== 'object' || Array.isArray(source))
    || penalty.policies != null && !Array.isArray(penalty.policies);
  const policies = array(penalty.policies).map(value => {
    const row = object(value);
    const startAt = utcTimestamp(row.start_at), endAt = utcTimestamp(row.end_at);
    const startInvalid = row.start_at !== null && startAt === null;
    const endInvalid = row.end_at !== null && endAt === null;
    const amount = startInvalid || endInvalid ? null : decimal(row.amount_charge, true);
    return { startAt, endAt, amount, currency: amount !== null ? currencyCode : null,
      ...(startInvalid && { startInvalid: true as const }), ...(endInvalid && { endInvalid: true as const }) };
  });
  return { freeUntil, policies, ...(incomplete && { incomplete: true }),
    ...(penalty.free_cancellation_before != null && freeUntil === null && { freeUntilInvalid: true }) };
}
export function normalizeOffers(value: unknown, hotel: unknown = {}): RoomOffer[] {
  const staticHotel = object(hotel);
  const groups = [staticHotel.room_groups, object(staticHotel.staticData).room_groups]
    .flatMap(value => Array.isArray(value) ? value : Object.values(object(value))).map(object);
  const groupPhotos = new Map<string, string[]>();
  for (const group of groups) {
    const key = classification(group.rg_ext);
    if (!key) continue;
    groupPhotos.set(key, images(groupPhotos.get(key), group.images_ext, group.images));
  }
  return array(value).flatMap((item, index) => {
    const rate = object(item), name = label(rate.room_name) || label(object(rate.room_data_trans).main_name);
    if (typeof rate.book_hash !== 'string' || !rate.book_hash || rate.book_hash.length > 1024 || !name) return [];
    const payment = array(object(rate.payment_options).payment_types).map(object).find(item => item.type === 'deposit');
    const key = classification(rate.rg_ext);
    const bedding = label(object(rate.room_data_trans).bedding_type);
    const mealData = object(rate.meal_data);
    const meal = label(mealData.value) || label(rate.meal);
    return [{ id: `${rate.book_hash}:${index}`, name, bookHash: rate.book_hash, ...(key ? { roomIdentity: key } : {}),
      ...(typeof rate.offer_context === 'string' && rate.offer_context.length <= 131072 ? { offerContext: rate.offer_context } : {}),
      price: customerPrice(rate), ...(meal ? { meal } : {}),
      ...(mealData.no_child_meal === true && meal.toLowerCase() !== 'nomeal' ? { noChildMeal: true as const } : {}),
      ...(payment ? { paymentType: 'deposit' as const } : {}), ...(bedding ? { bedding } : {}),
      images: key ? groupPhotos.get(key) || [] : [],
      taxes: array(object(payment?.tax_data).taxes).map(value => {
        const tax = object(value);
        // A large JSON number may already have lost digits before it reaches the adapter.
        const amount = typeof tax.amount === 'number' && Math.abs(tax.amount) > Number.MAX_SAFE_INTEGER ? null : decimal(tax.amount, true);
        return { name: label(tax.name), amount, currency_code: currency(tax.currency_code),
          included_by_supplier: typeof tax.included_by_supplier === 'boolean' ? tax.included_by_supplier : null };
      }),
      cancellation: cancellationTerms(payment) }];
  });
}
function cheapest(value: unknown, code: string): Money | null {
  return array(value).map(customerPrice).filter((price): price is Money => price !== null && price.currency === code)
    .reduce<Money | null>((best, price) => !best || Number(price.amount) < Number(best.amount) ? price : best, null);
}
/**
 * Whether free cancellation is on offer, for the result card. The compact search view sends it as
 * flags; a full rate list is read directly. A deadline that has already passed never counts.
 */
export function hotelFreeCancellation(row: Row, code: string, now = Date.now()): HotelSummary['freeCancellation'] {
  if (typeof row.free_cancellation === 'boolean')
    return row.lowest_free_cancellation === true ? 'lowest' : row.free_cancellation ? 'available' : 'none';
  const rates = array(row.rates).map(object);
  if (!rates.length) return undefined;
  let known = false, lowest: { amount: number; free: boolean } | null = null, any = false;
  for (const rate of rates) {
    const payment = array(object(rate.payment_options).payment_types).map(object).find(item => item.type === 'deposit');
    const penalties = object(payment?.cancellation_penalties);
    if (!('free_cancellation_before' in penalties)) continue;
    known = true;
    const until = utcTimestamp(penalties.free_cancellation_before);
    const free = until !== null && Date.parse(until) > now;
    any ||= free;
    const price = customerPrice(rate);
    if (price && price.currency === code && (!lowest || Number(price.amount) < lowest.amount)) lowest = { amount: Number(price.amount), free };
  }
  if (!known) return undefined;
  return lowest?.free ? 'lowest' : any ? 'available' : 'none';
}
function hotelLocation(row: Record<string, unknown>) {
  const coordinate = (value: unknown) => typeof value === 'number' || typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const latitude = coordinate(row.latitude), longitude = coordinate(row.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : undefined;
}
export function normalizeHotel(value: unknown, code: string): HotelSummary {
  const row = object(value), hid = hotelId(row.hid ?? row.hotelId);
  if (hid === null || !Array.isArray(row.rates)) throw invalidResponse();
  const star = Number(row.star_rating ?? row.stars ?? row.starRating);
  const photos = hotelPhotos(row);
  return { hid, id: String(hid), name: label(row.name) || label(row.hotel_name),
    ...(label(row.address) ? { address: label(row.address) } : {}),
    ...(Number.isFinite(star) && star > 0 && star <= 5 ? { stars: star } : {}),
    location: hotelLocation(row),
    imageUrl: photos[0], images: photos,
    price: cheapest(row.rates, code),
    ...((cancel => cancel ? { freeCancellation: cancel } : {})(hotelFreeCancellation(row, code))) };
}
function propertyClock(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value.trim())) return undefined;
  return value.trim().replace(/^(\d\d:\d\d):00$/, '$1');
}

export function normalizeDetails(hid: number, value: unknown, page: unknown, code: string): HotelDetails {
  const raw = object(value), content = Object.keys(object(raw.staticData)).length ? { ...object(raw.staticData), ...raw } : raw;
  const hp = object(page), supplied = object(hp.hotel ?? array(hp.hotels)[0]);
  if (Object.keys(supplied).length && hotelId(supplied.hid) !== hid) throw invalidResponse();
  if (!Array.isArray(hp.rates)) throw invalidResponse();
  const contentHid = hotelId(content.hid);
  if (contentHid !== null && contentHid !== hid) throw invalidResponse();
  const combined = { ...supplied, ...content, hid, rates: hp.rates };
  const summary = normalizeHotel(combined, code);
  const description = label(content.description);
  const paragraphs = description ? [description] : array(content.description_struct).flatMap(section =>
    array(object(section).paragraphs).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())));
  const policies = object(content.metapolicy_struct);
  const amenityGroups = normalizeHotelAmenities(content.amenity_groups, policies.internet, content.amenities);
  return { ...summary, description: paragraphs,
    amenities: [...new Set(amenityGroups.flatMap(group => group.items.map(item => item.name)))], amenityGroups,
    checkInTime: propertyClock(content.check_in_time), checkInEnds: propertyClock(content.check_in_time_end),
    checkOutTime: propertyClock(content.check_out_time),
    images: images(summary.images, hotelPhotos(supplied)),
    policyExtraInfo: label(content.metapolicy_extra_info) || null, policies,
    offers: normalizeOffers(hp.rates, content) };
}
export function normalizeSuggestions(value: unknown): Suggestion[] {
  const payload = object(value), data = object(payload.suggestions);
  if (!Array.isArray(data.hotels) || !Array.isArray(data.regions)) throw invalidResponse();
  const regions = data.regions.flatMap(item => { const row = object(item), id = hotelId(row.id ?? row.region_id), name = label(row.name);
    return id && name ? [{ id: `region-${id}`, type: 'region' as const, name, regionId: id,
      subtitle: label(row.country) || label(row.country_name) || undefined }] : []; });
  const hotels = data.hotels.flatMap(item => { const row = object(item), id = hotelId(row.hid ?? row.hotel_id ?? row.id), name = label(row.name);
    return id && name ? [{ id: `hotel-${id}`, type: 'hotel' as const, name, hid: id,
      subtitle: label(row.region_name) || label(row.address) || undefined }] : []; });
  return [...new Map([...regions, ...hotels].map(item => [item.id, item])).values()].slice(0, 20);
}
export function normalizeUser(value: unknown): User {
  const row = object(value);
  if (!label(row.name) || typeof row.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw invalidResponse();
  return { name: label(row.name), email: row.email,
    ...(typeof row.phone === 'string' ? { phone: row.phone } : {}),
    ...(Number.isSafeInteger(row.points) && Number(row.points) >= 0 ? { points: Number(row.points) } : {}) };
}
