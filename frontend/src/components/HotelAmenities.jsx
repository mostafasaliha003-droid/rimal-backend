import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { normalizeHotelAmenities } from '../shared/hotelAmenities';
import { canShowFacilityAvailability, facilityLabel } from '../shared/hotelFacilityLabels';

const copy = {
    ar: { title: 'المرافق والخدمات', free: 'مجاني', paid: 'برسوم', available: 'متاح',
        costNote: 'تظهر عبارة «مجاني» أو «برسوم» عندما يحدّد الفندق تكلفة المرفق.', more: 'عرض جميع المرافق', less: 'عرض أقل' },
    en: { title: 'Facilities and services', free: 'Free', paid: 'Extra charge', available: 'Available',
        costNote: 'Free or extra charge is shown when the hotel specifies the cost.', more: 'Show all facilities', less: 'Show fewer' },
    es: { title: 'Instalaciones y servicios', free: 'Gratis', paid: 'De pago', available: 'Disponible',
        costNote: 'Las etiquetas «Gratis» y «De pago» aparecen cuando el hotel indica el coste.', more: 'Ver todos los servicios', less: 'Ver menos' }
};
const feeStyle = { free: 'rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800', paid: 'rounded-full bg-amber-50 px-2.5 py-1 text-amber-900' };
const spanishNames = {
    internet: 'Internet', 'wi-fi': 'Wifi', wifi: 'Wifi', recreation: 'Ocio', pool: 'Piscina', 'swimming pool': 'Piscina',
    'pool and beach': 'Piscina y playa', 'beauty and wellness': 'Belleza y bienestar', spa: 'Spa'
};

function displayName(name, language) {
    const label = facilityLabel(name, language === 'ar');
    return language === 'es' ? spanishNames[label.toLowerCase()] || label : label;
}

export default function HotelAmenities({ hotel, language }) {
    const [expanded, setExpanded] = useState(false);
    const words = copy[language] || copy.en;
    const stored = hotel?.staticData || {};
    const groups = normalizeHotelAmenities(
        hotel?.amenity_groups ?? stored.amenity_groups,
        hotel?.metapolicy_struct?.internet ?? stored.metapolicy_struct?.internet,
        hotel?.amenities ?? stored.amenities
    );
    const total = groups.reduce((count, group) => count + group.items.length, 0);
    if (!total) return null;

    let remaining = expanded ? total : 6;
    const visibleGroups = [];
    for (const group of groups) {
        const items = group.items.slice(0, remaining);
        visibleGroups.push({ name: group.name, items });
        remaining -= items.length;
        if (!remaining) break;
    }
    const hasUnpriced = visibleGroups.some(group => group.items.some(item => item.fee === 'unknown'));
    return <section aria-labelledby="hotel-amenities-title" className="mt-6 border-t border-slate-100 pt-6">
        <h3 id="hotel-amenities-title" className="text-xl font-black text-slate-900">{words.title}</h3>
        {hasUnpriced && <p id="hotel-amenity-cost-note" className="mt-1 text-sm text-slate-600">{words.costNote}</p>}
        <div id="hotel-amenity-list">
            {visibleGroups.map((group, index) => <div key={index} className="mt-4">
                {group.name && <h4 className="mb-1 text-sm font-bold text-slate-600">{displayName(group.name, language)}</h4>}
                <ul className="m-0 grid list-none gap-x-6 p-0 md:grid-cols-2">
                    {group.items.map(item => <li key={item.name} data-amenity-fee={item.fee}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm">
                        <span className="min-w-0 break-words font-semibold text-slate-800">{displayName(item.name, language)}</span>
                        {item.fee === 'unknown'
                            ? canShowFacilityAvailability(item.name) && <span className="text-xs text-slate-600">{words.available}</span>
                            : <span className={`text-xs font-semibold ${feeStyle[item.fee]}`}>{words[item.fee]}</span>}
                    </li>)}
                </ul>
            </div>)}
        </div>
        {total > 6 && <button type="button" aria-controls="hotel-amenity-list" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-remal-blue focus-visible:outline">
            {expanded ? words.less : `${words.more} (${new Intl.NumberFormat(language).format(total)})`}
            <ChevronDown aria-hidden="true" size={16} className={expanded ? 'rotate-180' : ''} />
        </button>}
    </section>;
}
