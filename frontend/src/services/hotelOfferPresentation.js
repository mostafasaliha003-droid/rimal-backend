import { hotelImages } from './hotelImages.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';
const currencyCode = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;

function acceptedHotel(value, expectedHid) {
    const record = object(value);
    if (record.hid !== undefined && record.hid !== null && String(record.hid) !== String(expectedHid)) return {};
    return record;
}

export function hotelDescription(hotel = {}) {
    const nested = object(hotel.staticData);
    const direct = text(hotel.description) || text(nested.description);
    if (direct) return direct;
    const blocks = Array.isArray(hotel.description_struct) ? hotel.description_struct : nested.description_struct;
    return Array.isArray(blocks) ? blocks.flatMap(block => Array.isArray(block?.paragraphs)
        ? block.paragraphs.map(text).filter(Boolean) : []).join('\n\n') : '';
}

export function hotelAmenities(hotel = {}) {
    const nested = object(hotel.staticData);
    const result = new Map();
    const add = (value, paid = false) => {
        const label = text(value) || text(value?.name) || text(value?.title);
        if (label) result.set(label, { label, paid: paid || result.get(label)?.paid === true });
    };
    for (const list of [hotel.amenities, nested.amenities]) {
        if (Array.isArray(list)) list.forEach(value => add(value));
    }
    for (const list of [hotel.amenity_groups, nested.amenity_groups]) {
        if (!Array.isArray(list)) continue;
        for (const group of list) {
            if (Array.isArray(group?.amenities)) group.amenities.forEach(value => add(value));
            if (Array.isArray(group?.non_free_amenities)) group.non_free_amenities.forEach(value => add(value, true));
        }
    }
    return [...result.values()];
}

// Presentation only: empty live arrays must not erase content from the exact
// requested property's static response. No remote lookup or substitute content.
export function mergeHotelPresentation(staticValue, liveValue, expectedHid, language) {
    const staticHotel = acceptedHotel(staticValue, expectedHid);
    const liveHotel = acceptedHotel(liveValue, expectedHid);
    const merged = { ...staticHotel, ...liveHotel, hid: expectedHid };
    for (const field of ['name', 'city', 'address']) {
        const translated = staticHotel.resolvedLanguage === language ? text(staticHotel[field]) : '';
        merged[field] = translated || text(liveHotel[field]) || text(staticHotel[field])
            || text(staticHotel.staticData?.[field]) || text(liveHotel.staticData?.[field]);
    }
    const translatedDescription = staticHotel.resolvedLanguage === language ? hotelDescription(staticHotel) : '';
    merged.description = translatedDescription || hotelDescription(liveHotel) || hotelDescription(staticHotel);
    merged.images = [...new Set([...hotelImages(staticHotel), ...hotelImages(liveHotel)])];
    for (const field of ['room_groups', 'rooms', 'amenity_groups', 'amenities']) {
        if ((!Array.isArray(merged[field]) || !merged[field].length) && Array.isArray(staticHotel[field])) merged[field] = staticHotel[field];
    }
    merged.staticData = Object.keys(object(staticHotel.staticData)).length ? staticHotel.staticData : object(liveHotel.staticData);
    return merged;
}

export function groupRoomOffers(rooms = []) {
    const groups = new Map();
    rooms.forEach((room, index) => {
        const raw = object(room.originalRate);
        const groupId = raw.room_group_id ?? raw.room_group?.id;
        const identity = JSON.stringify([room.name || '', typeof groupId === 'string' || typeof groupId === 'number' ? String(groupId) : '', room.bed || '']);
        if (!groups.has(identity)) groups.set(identity, { key: identity, name: room.name, firstIndex: index, offers: [] });
        // Do not deduplicate hashes, sort rates or replace the selected room.
        groups.get(identity).offers.push({ room, index });
    });
    return [...groups.values()];
}

// A verified prebook belongs to this exact supplier offer. A refreshed hash
// must create a new stateful card, while repeated hashes remain separate offers.
export function roomOfferKey({ room, index }) {
    return JSON.stringify([room.contract_source || 'b2b', room.book_hash || room.roomId || '', index]);
}

export function etgPolicyInstant(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (!match) return null;
    const [year, month, day, hour, minute, second] = [match[1], match[2], match[3], match[4], match[5], match[6] || '0'].map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
        || calendar.getUTCHours() !== hour || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;
    // ETG explicitly defines these three cancellation fields as UTC+0 when
    // their ISO values omit a zone. Explicit offsets remain authoritative.
    const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}${match[7] || ''}${match[8] || 'Z'}`;
    const instant = new Date(normalized);
    return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

export function formatEtgPolicyTime(value, language = 'en') {
    const iso = etgPolicyInstant(value);
    if (!iso) return null;
    const locale = language === 'ar' ? 'ar-AE' : language === 'es' ? 'es-ES' : 'en-GB';
    return { iso, label: `${new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))} UTC` };
}

function decimal(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const result = String(value);
    return /^\d+(?:\.\d+)?$/.test(result) ? result : null;
}

export function policyAmount(policy = {}, { currency, chargeCurrency, showCurrency, contractSource = 'b2b' } = {}) {
    // A normalized B2B room's currency is the selected payment's contract
    // currency. Affiliate display currency is not a contract-currency proof.
    const charge = currencyCode(chargeCurrency) || (contractSource === 'b2b' ? currencyCode(currency) : null);
    const show = currencyCode(showCurrency);
    const explicit = currencyCode(policy.currency_code);
    const candidates = [
        { amount: decimal(policy.amount_charge), currency: charge },
        { amount: decimal(policy.amount_show), currency: show },
        { amount: decimal(policy.amount), currency: explicit }
    ].filter(value => value.amount !== null && value.currency);
    return candidates.find(value => value.currency === currency) || candidates[0] || null;
}

export function staySummary({ checkin, checkout, guests = [] } = {}) {
    const parseDay = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const parsed = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed.getTime() : null;
    };
    const start = parseDay(checkin), end = parseDay(checkout);
    const nights = start !== null && end !== null && end > start ? (end - start) / 86400000 : null;
    const validGuests = Array.isArray(guests) ? guests : [];
    return { checkin: start === null ? null : checkin, checkout: end === null ? null : checkout, nights,
        rooms: validGuests.length, guests: validGuests.reduce((count, room) => count
            + (Number.isInteger(room?.adults) ? room.adults : 0) + (Array.isArray(room?.children) ? room.children.length : 0), 0) };
}
