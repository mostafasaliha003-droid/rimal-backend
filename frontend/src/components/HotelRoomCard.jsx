import { motion } from 'framer-motion';
import { ArrowLeft, Check, Wifi } from 'lucide-react';
import { BedIcon, StarIcon, UsersIcon } from './Icons';

export default function HotelRoomCard({ room = {}, onBook }) {
    const name = room.room_name || room.name || 'غرفة';
    const price = room.payment_options?.payment_types?.[0]?.amount ?? room.price ?? room.sell_price ?? '—';
    const amenities = [room.meal, room.bedding, ...(room.amenities || [])].filter(Boolean);
    return (
        <motion.article whileHover={{ y: -3 }} transition={{ duration: 0.2 }} className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-shadow hover:shadow-xl">
            <div className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full bg-remal-blue/10 px-2.5 py-1 text-[10px] font-black text-remal-blue">الأكثر طلباً</span>
                        <div className="flex gap-0.5 text-remal-gold">{Array.from({ length: 5 }).map((_, index) => <StarIcon key={index} size={12} fill="currentColor" />)}</div>
                    </div>
                    <h3 className="text-xl font-black text-remal-dark">{name}</h3>
                    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-xs font-bold text-slate-500">
                        <span className="flex items-center gap-2"><BedIcon size={17} className="text-remal-blue" /> {room.bedding || 'سرير'}</span>
                        <span className="flex items-center gap-2"><UsersIcon size={17} className="text-remal-blue" /> حتى {room.max_occupancy?.adults || room.adults || 2} بالغين</span>
                        {amenities.slice(0, 2).map((amenity, index) => <span key={`${amenity}-${index}`} className="flex items-center gap-2"><Wifi size={17} className="text-remal-blue" /> {typeof amenity === 'string' ? amenity : amenity.name}</span>)}
                    </div>
                    <div className="mt-5 flex items-center gap-2 text-xs font-bold text-emerald-600"><Check size={15} /> إلغاء مجاني حتى 18 يونيو</div>
                </div>
                <div className="flex flex-col items-stretch gap-3 border-t border-slate-100 pt-5 text-right sm:flex-row sm:items-center sm:gap-5 lg:border-r lg:border-t-0 lg:pr-7 lg:pt-0">
                    <div className="text-right">
                        <div className="mb-2 inline-flex rounded-full bg-remal-gold/15 px-3 py-1 text-[10px] font-black text-amber-700">كاش باك 43 AED</div>
                        <div className="flex items-baseline gap-1"><span className="text-3xl font-black tracking-tight text-remal-dark">{price}</span><span className="text-xs font-black text-slate-400">{room.currency || 'USD'}</span></div>
                        <p className="mt-1 text-[10px] font-bold text-slate-400">شامل الضرائب والرسوم</p>
                    </div>
                    <button onClick={onBook} className="flex items-center justify-center gap-2 rounded-full bg-remal-red px-6 py-3.5 text-xs font-black text-white transition hover:bg-[#a10b0b] hover:shadow-luxe"><span>احجز الغرفة</span><ArrowLeft size={16} /></button>
                </div>
            </div>
        </motion.article>
    );
}
