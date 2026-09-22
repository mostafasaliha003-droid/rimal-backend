import { ArrowLeft, Check, Star } from 'lucide-react';

const firstRate = (hotel) => hotel.rates?.[0] || hotel.rooms?.[0] || {};

export default function SerpResultCard({ hotel, onSelect }) {
    const rate = firstRate(hotel);
    const price = rate.payment_options?.payment_types?.[0]?.amount
        ?? rate.daily_prices?.reduce((sum, value) => sum + Number(value || 0), 0)
        ?? rate.price
        ?? rate.sell_price;
    const amenities = hotel.amenities || rate.amenities || rate.meal ? [rate.meal, ...(rate.amenities || [])] : [];

    return (
        <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-1 text-remal-gold">{Array.from({ length: Number(hotel.stars || hotel.star_rating || 0) }).map((_, index) => <Star key={index} size={13} fill="currentColor" />)}</div>
                    <h3 className="mt-2 text-xl font-black text-remal-dark">{hotel.name || hotel.hotel_name || `فندق ${hotel.hid || hotel.id}`}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">{amenities.filter(Boolean).slice(0, 3).map((amenity, index) => <span key={`${amenity}-${index}`} className="flex items-center gap-1 text-xs font-bold text-slate-500"><Check size={14} className="text-emerald-600" />{typeof amenity === 'string' ? amenity : amenity.name}</span>)}</div>
                </div>
                <div className="flex items-center gap-5">
                    <div><p className="text-2xl font-black text-remal-dark">{price ?? '—'} <span className="text-xs text-slate-400">{rate.currency || hotel.currency || 'USD'}</span></p><p className="text-[10px] font-bold text-slate-400">شامل الضرائب والرسوم</p></div>
                    <button type="button" onClick={() => onSelect(hotel)} className="flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-xs font-black text-white transition hover:bg-[#a10b0b]">تحديد الغرف <ArrowLeft size={15} /></button>
                </div>
            </div>
        </article>
    );
}
