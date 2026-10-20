// ETG identifies room content by the complete rg_ext object. room_group_id is
// deprecated, but remains supported when the supplier explicitly provides it.
const RG_FIELDS = ['class', 'quality', 'sex', 'bathroom', 'bedding', 'family', 'capacity', 'club', 'bedrooms', 'balcony', 'view', 'floor'];

export function roomClassification(value) {
    if (!value || typeof value !== 'object' || !RG_FIELDS.every(key => Number.isInteger(value[key]) && value[key] >= 0)) return '';
    const keys = Object.keys(value).sort();
    if (!keys.every(key => Number.isInteger(value[key]) && value[key] >= 0)) return '';
    return JSON.stringify(keys.map(key => [key, value[key]]));
}

function explicitId(value) {
    const id = [value?.room_group_id, value?.room_group?.room_group_id, value?.room_group?.id]
        .find(item => (typeof item === 'string' && item.trim()) || (typeof item === 'number' && Number.isFinite(item)));
    return id === undefined ? '' : String(id).trim();
}

function groupsForHotel(hotel) {
    return [hotel?.room_groups, hotel?.rooms, hotel?.staticData?.room_groups, hotel?.staticData?.rooms]
        .flatMap(value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [])
        .filter(value => value && typeof value === 'object');
}

export function roomGroupForRate(rate = {}, hotel = {}) {
    const id = explicitId(rate);
    const classification = roomClassification(rate.rg_ext);
    if (!id && !classification) return null;
    const matches = groupsForHotel(hotel).filter(group => {
        const groupId = String(group.room_group_id ?? group.id ?? '').trim();
        if (id && id !== groupId) return false;
        const groupClassification = roomClassification(group.rg_ext);
        if (classification && classification !== groupClassification) return false;
        return Boolean(id || classification);
    });
    // Reject ambiguous matches; a similar name or partial classification is not
    // enough to claim that a photograph depicts this room type.
    const identities = new Set(matches.map(group => JSON.stringify([
        group.room_group_id ?? group.id ?? null, roomClassification(group.rg_ext), group.name
    ])));
    if (identities.size !== 1) return null;
    return { ...matches[0], images: matches.flatMap(group => group.images || []),
        images_ext: matches.flatMap(group => group.images_ext || []) };
}

export function supplierRoomIdentity(rate = {}) {
    const classification = roomClassification(rate.rg_ext);
    const id = explicitId(rate);
    return classification || id ? JSON.stringify([id, classification]) : '';
}

export function groupRoomOffers(rooms = []) {
    const groups = new Map();
    rooms.forEach((room, index) => {
        const identity = supplierRoomIdentity(room.originalRate);
        const key = JSON.stringify([room.hotel?.hid || room.hotel?.hotelId || '', room.contract_source || 'b2b',
            room.name, identity || `unmatched-offer-${index}`]);
        if (!groups.has(key)) groups.set(key, { key, name: room.name, rooms: [] });
        groups.get(key).rooms.push(room);
    });
    return [...groups.values()];
}
