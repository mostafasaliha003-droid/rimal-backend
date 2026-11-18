import type { HotelDetails, HotelSummary, Money, RoomOffer, Suggestion, User } from '../types';
import { invalidResponse } from './errors';
import { hotelId, parseCancellationTimestamp } from './validation';

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
  let raw = value.trim().replace(/\{size\}/gi, '640x480');
  if (/unsplash\.com|33036666\.jpg|35165972\.jpg/i.test(raw)) return null;
  if (raw.startsWith('//')) raw = `https:${raw}`;
  if (/^t\/(?:\d+x\d+)\//.test(raw)) raw = `https://cdn.worldota.net/${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || raw.length > 2048
      || !/(^|\.)(worldota\.net|ratehawk\.net|ostrovok\.ru|remalbookings\.com|rimal-api(?:-staging)?\.onrender\.com)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function images(...values: unknown[]): string[] {
  const result: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || result.length >= 200) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (typeof value === 'string') { const url = imageUrl(value); if (url) result.push(url); return; }
    const row = object(value);
    const keys = ['url', 'src', 'image', 'photo', 'source'];
    const explicit = keys.filter(key => Object.hasOwn(row, key));
    (explicit.length ? explicit : Object.keys(row).filter(key => !['category_slug', 'category', 'caption', 'alt', 'width', 'height', 'w', 'h', 'type'].includes(key)))
      .forEach(key => visit(row[key], depth + 1));
  };
  values.forEach(value => visit(value));
  return [...new Set(result)];
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
  const rawGroups = staticHotel.room_groups;
  const groups = Array.isArray(rawGroups) ? rawGroups : Object.values(object(rawGroups));
  return array(value).flatMap((item, index) => {
    const rate = object(item), name = label(rate.room_name) || label(object(rate.room_data_trans).main_name);
    if (typeof rate.book_hash !== 'string' || !rate.book_hash || rate.book_hash.length > 1024 || !name) return [];
    const payment = array(object(rate.payment_options).payment_types).map(object).find(item => item.type === 'deposit');
    const key = classification(rate.rg_ext);
    const matched = key ? groups.map(object).filter(group => classification(group.rg_ext) === key) : [];
    return [{ id: `${rate.book_hash}:${index}`, name, bookHash: rate.book_hash, ...(key ? { roomIdentity: key } : {}),
      ...(typeof rate.offer_context === 'string' && rate.offer_context.length <= 131072 ? { offerContext: rate.offer_context } : {}),
      price: customerPrice(rate), ...(typeof rate.meal === 'string' ? { meal: rate.meal } : {}),
      images: matched.flatMap(group => images(group.images_ext, group.images)),
      taxes: array(object(payment?.tax_data).taxes).map(value => {
        const tax = object(value);
        return { name: label(tax.name), amount: decimal(tax.amount, true), currency_code: currency(tax.currency_code),
          included_by_supplier: typeof tax.included_by_supplier === 'boolean' ? tax.included_by_supplier : null };
      }),
      cancellation: cancellationTerms(payment) }];
  });
}
function cheapest(value: unknown, code: string): Money | null {
  return array(value).map(customerPrice).filter((price): price is Money => price !== null && price.currency === code)
    .reduce<Money | null>((best, price) => !best || Number(price.amount) < Number(best.amount) ? price : best, null);
}
export function normalizeHotel(value: unknown, code: string): HotelSummary {
  const row = object(value), hid = hotelId(row.hid ?? row.hotelId);
  if (hid === null || !Array.isArray(row.rates)) throw invalidResponse();
  const star = Number(row.star_rating ?? row.stars ?? row.starRating);
  return { hid, id: String(hid), name: label(row.name) || label(row.hotel_name),
    ...(label(row.address) ? { address: label(row.address) } : {}),
    ...(Number.isFinite(star) && star > 0 && star <= 5 ? { stars: star } : {}),
    imageUrl: images(row.images, row.images_ext, row.image)[0],
    price: cheapest(row.rates, code), offers: normalizeOffers(row.rates, row) };
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
  return { ...summary, description: paragraphs,
    amenities: array(content.amenity_groups).flatMap(group => array(object(group).amenities)).filter((item): item is string => typeof item === 'string'),
    images: images(content.images_ext, content.images, content.image),
    policyExtraInfo: label(content.metapolicy_extra_info) || null, policies: object(content.metapolicy_struct),
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
