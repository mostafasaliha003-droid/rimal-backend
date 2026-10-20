import labels from '../../../shared/hotelLabels.json' with { type: 'json' };
const generic = new Set(labels.genericNames);
export function resolveHotelName(...values) {
    return values.find(value => typeof value === 'string' && value.trim()
        && !generic.has(value.trim().toLowerCase()))?.trim() || '';
}
