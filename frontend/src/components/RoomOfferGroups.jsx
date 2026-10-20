import { useId } from 'react';
import { BedDouble } from 'lucide-react';
import RoomCard from './RoomCard';
import { groupRoomOffers } from '../services/supplierRoomTypes.js';
import { useLanguage } from '../i18n';

function RoomType({ group, ...cardProps }) {
    const { t } = useLanguage();
    const headingId = useId();
    return <section data-room-type aria-labelledby={headingId} className="mb-8 min-w-0 rounded-3xl border border-slate-200 bg-slate-50/70 p-3 sm:p-5">
        <header className="mb-5 flex flex-col items-start justify-between gap-3 px-1 pt-1 sm:flex-row">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="rounded-2xl bg-white p-3 text-blue-700 shadow-sm"><BedDouble size={22} /></span>
                <div className="min-w-0">
                    <p className="mb-1 text-xs font-bold text-slate-500">{t('room.typeLabel')}</p>
                    <h3 id={headingId} className="break-words text-xl font-black text-slate-900">{group.name || t('room.defaultName')}</h3>
                    <p className="mt-2 text-xs leading-6 text-slate-500">{t('room.compareOptions')}</p>
                </div>
            </div>
            <span className="rounded-full border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-blue-800">{t('room.offerCount', '{{count}} خيارات', { count: group.rooms.length })}</span>
        </header>
        <div className="space-y-4">
            {group.rooms.map((room, index) => <RoomCard key={`${room.contract_source}:${room.book_hash || index}:${index}`} room={room} headingLevel="h4" {...cardProps} />)}
        </div>
    </section>;
}

export default function RoomOfferGroups({ rooms = [], ...cardProps }) {
    return groupRoomOffers(rooms).map(group => <RoomType key={group.key} group={group} {...cardProps} />);
}
