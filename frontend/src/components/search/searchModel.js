import { format, isValid, parseISO, startOfDay } from 'date-fns';

export function parseSearchDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = parseISO(value);
    return isValid(date) && format(date, 'yyyy-MM-dd') === value ? date : null;
}

export function hotelId(value) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id >= 0 && id <= 9999999999 ? id : null;
}

export function validDestination(destination) {
    if (!destination || typeof destination.label !== 'string' || !destination.label.trim()) return false;
    if (destination.type === 'hotel') return hotelId(destination.hotel_id) !== null;
    return destination.type === 'region' && Number.isSafeInteger(Number(destination.region_id)) && Number(destination.region_id) > 0;
}

export function normalizeSuggestions(response) {
    const payload = response?.data || response;
    const data = Array.isArray(payload) ? { regions: payload }
        : Array.isArray(payload?.suggestions) ? { regions: payload.suggestions } : payload?.suggestions || payload || {};
    const metadata = payload?.suggestions && !Array.isArray(payload.suggestions)
        ? payload.suggestions
        : payload || {};
    const labelFor = item => [item.name?.content, item.name?.value, item.name, item.title, item.label]
        .find(value => typeof value === 'string' && value.trim())?.trim();
    const regions = (Array.isArray(data.regions) ? data.regions : []).filter(item => item && typeof item === 'object').slice(0, 5).map(item => ({
        label: labelFor(item), type: 'region', region_id: item.id ?? item.region_id,
        resolvedLanguage: item.resolvedLanguage || metadata.resolvedLanguage || null
    }));
    const hotels = (Array.isArray(data.hotels) ? data.hotels : []).filter(item => item && typeof item === 'object').slice(0, 5).map(item => ({
        label: labelFor(item), type: 'hotel', hotel_id: hotelId(item.hid ?? item.hotel_id ?? item.id), hotel_key: item.id,
        resolvedLanguage: item.resolvedLanguage || metadata.resolvedLanguage || null
    }));
    return [...new Map([...regions, ...hotels].filter(validDestination).map(item => {
        const key = `${item.type}-${item.region_id ?? item.hotel_id}`;
        return [key, { ...item, key }];
    })).values()];
}

export function initialGuests(guests) {
    if (!Array.isArray(guests) || !guests.length) return [{ adults: 2, children: [] }];
    return guests.slice(0, 4).map(room => ({
        adults: Number.isInteger(Number(room?.adults)) ? Math.max(1, Math.min(6, Number(room.adults))) : 2,
        children: (Array.isArray(room?.children) ? room.children : []).slice(0, 4)
            .map(age => age !== '' && age !== null && Number.isInteger(Number(age)) && Number(age) >= 0 && Number(age) <= 17 ? Number(age) : '')
    }));
}

export function validateSearch({ query, destination, checkin, checkout, guests }, now = new Date()) {
    const errors = {};
    if (!validDestination(destination) || query.trim() !== destination.label.trim()) errors.destination = 'destinationRequired';
    const arrival = parseSearchDate(checkin);
    const departure = parseSearchDate(checkout);
    if (!arrival) errors.checkin = checkin ? 'invalidDates' : 'datesRequired';
    else if (arrival < startOfDay(now)) errors.checkin = 'invalidDates';
    if (!departure) errors.checkout = checkout ? 'invalidDates' : 'datesRequired';
    else if (arrival && departure <= arrival) errors.checkout = 'invalidDates';
    if (!Array.isArray(guests) || !guests.length || guests.length > 4 || guests.some(room =>
        !Number.isInteger(room.adults) || room.adults < 1 || room.adults > 6 || !Array.isArray(room.children) || room.children.length > 4)) {
        errors.guests = 'invalidGuests';
    } else if (guests.some(room => room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17))) {
        errors.guests = 'childAgeRequired';
    }
    return errors;
}