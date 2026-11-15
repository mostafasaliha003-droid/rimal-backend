// ETG identifies room content by the complete rg_ext object. Deprecated room
// group IDs are deliberately ignored, including when they conflict with rg_ext.
const RG_FIELDS = ['class', 'quality', 'sex', 'bathroom', 'bedding', 'family', 'capacity', 'club', 'bedrooms', 'balcony', 'view', 'floor'];

export function roomClassification(value) {
    if (!value || typeof value !== 'object' || !RG_FIELDS.every(key => Number.isInteger(value[key]) && value[key] >= 0)) return '';
    const keys = Object.keys(value).sort();
    if (!keys.every(key => Number.isInteger(value[key]) && value[key] >= 0)) return '';
    return JSON.stringify(keys.map(key => [key, value[key]]));
}

function groupsForHotel(hotel) {
    // `rooms` can contain dynamic offers. Only the supplier's static room_groups
    // collection establishes which photographs belong to a classification.
    return [hotel?.room_groups, hotel?.staticData?.room_groups]
        .flatMap(value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [])
        .filter(value => value && typeof value === 'object');
}

export function roomGroupForRate(rate = {}, hotel = {}) {
    const classification = roomClassification(rate.rg_ext);
    if (!classification) return null;
    const matches = groupsForHotel(hotel).filter(group => roomClassification(group.rg_ext) === classification);
    // The complete classification is the identity, even when translated room
    // names or deprecated IDs differ between copies of the static record.
    if (!matches.length) return null;
    return { ...matches[0], images: matches.flatMap(group => group.images || []),
        images_ext: matches.flatMap(group => group.images_ext || []) };
}

export function supplierRoomIdentity(rate = {}) {
    const classification = roomClassification(rate.rg_ext);
    return classification;
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
