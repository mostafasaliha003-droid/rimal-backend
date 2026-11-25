export function taxInclusion(value) {
    if (value === true || value === 'true') return 'included';
    if (value === false || value === 'false') return 'excluded';
    return 'unknown';
}

// Group exact supplier decimals by original currency. Never add unlike
// currencies or infer a zero from a missing tax collection.
function add(groups, amount, currency) {
    const value = String(amount ?? '');
    if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(value) || !/^[A-Z]{3}$/.test(currency || '')) return false;
    const [integer, fraction = ''] = value.split('.');
    const units = BigInt(integer + fraction.padEnd(8, '0'));
    groups.set(currency, (groups.get(currency) || 0n) + units);
    return true;
}
function amounts(groups) {
    return [...groups].map(([currency, units]) => {
        const digits = units.toString().padStart(9, '0');
        const fraction = digits.slice(-8).replace(/0+$/, '').padEnd(2, '0');
        return { currency, amount: digits.slice(0, -8) + '.' + fraction };
    });
}
export function stayCharges(room, total, currency, payAtHotel) {
    const hotel = new Map(), stay = new Map();
    const rows = Array.isArray(room.taxes) ? room.taxes : [];
    let incomplete = room.taxesDisclosed !== true && !rows.length;
    if (!add(stay, total, currency)) incomplete = true;
    if (payAtHotel && !add(hotel, total, currency)) incomplete = true;
    for (const tax of rows) {
        const inclusion = taxInclusion(tax?.included_by_supplier);
        if (inclusion === 'included') continue;
        if (inclusion === 'unknown' || !add(hotel, tax.amount, tax.currency_code)) { incomplete = true; continue; }
        add(stay, tax.amount, tax.currency_code);
    }
    return { hotel: amounts(hotel), stay: amounts(stay), incomplete };
}
