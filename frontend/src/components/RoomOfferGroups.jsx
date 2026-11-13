import HotelRoomCard from './HotelRoomCard';
import { groupRoomOffers } from '../services/hotelOfferPresentation.js';
import { useLanguage } from '../i18n';

export default function RoomOfferGroups({ rooms, ...cardProps }) {
    const { t } = useLanguage();
    return <div className="room-offer-groups space-y-6">{groupRoomOffers(rooms).map(group => <section key={group.key} className="room-offer-group min-w-0">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-bold text-slate-900">{group.name || t('room.defaultName', 'Room')}</h3>
            <span className="text-sm font-semibold text-slate-600">{t('room.groupOfferCount', '{{count}} offers', { count: group.offers.length })}</span>
        </div>
        <HotelRoomCard {...cardProps} room={group.offers[0].room} />
        {group.offers.length > 1 && <details className="room-offer-variants rounded-2xl border border-slate-200 bg-white p-3">
            <summary className="min-h-11 cursor-pointer rounded-xl px-2 py-3 font-bold text-[var(--remal-blue-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
                {t('room.moreOffers', 'Show {{count}} more offers', { count: group.offers.length - 1 })}
            </summary>
            <p className="mb-4 px-2 text-sm text-slate-600">{t('room.offerChoices', 'Compare meal plans, payment and cancellation options')}</p>
            {group.offers.slice(1).map(({ room, index }) => <HotelRoomCard key={index} {...cardProps} room={room} />)}
        </details>}
    </section>)}</div>;
}
