import { motion } from 'framer-motion';
import { ArrowLeft, Check, LoaderCircle, Wifi } from 'lucide-react';
import { BedIcon, StarIcon, UsersIcon } from './Icons';
import { useState } from 'react';
import BookingAPI from '../services/bookingApi';

const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80';

export default function RoomCard({ room = {}, onBook }) {
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [prebookResult, setPrebookResult] = useState(null);
    const hotel = room.hotel || {};
    const image = hotel.images?.[0] || hotel.image || DEFAULT_IMAGE;
    const isLoading = status === 'loading';
    const isLocked = status === 'success';

    const handleBook = async () => {
        if (isLocked) {
            onBook?.(prebookResult);
            return;
        }
        setStatus('loading');
        setError('');
        try {
            const result = await BookingAPI.prebook(room.book_hash || room.roomId, 2);
            setPrebookResult(result);
            setStatus('success');
        } catch (requestError) {
            setStatus('error');
            setError(requestError.response?.status === 409 || requestError.response?.data?.error === 'rate_not_found'
                ? 'عذراً، لقد تغير السعر أو التوفر، يرجى تحديث الصفحة'
                : 'تعذر تثبيت السعر، يرجى المحاولة مرة أخرى');
        }
    };

    return (
        <motion.article
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2 }}
            aria-labelledby={`room-${room.book_hash || room.roomId || room.name}`}
            className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-xl"
        >
            <div className="relative">
                <img src={image} alt="" className="h-40 w-full object-cover" onError={(event) => { event.currentTarget.src = DEFAULT_IMAGE; }} />
                <div className="absolute inset-x-4 bottom-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-remal-gold px-3 py-1 text-[11px] font-black text-remal-dark">استرداد نقدي</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-remal-dark/90 px-3 py-1 text-[11px] font-black text-white"><Check size={13} /> سعر حي مثبت</span>
                </div>
            </div>
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full bg-remal-blue/10 px-2.5 py-1 text-[10px] font-black text-remal-blue">متاح الآن</span>
                        <div className="flex gap-0.5 text-remal-gold" aria-label="تصنيف خمس نجوم">{Array.from({ length: 5 }).map((_, index) => <StarIcon key={index} size={12} fill="currentColor" />)}</div>
                    </div>
                    <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="text-xl font-black text-remal-dark">{room.name || 'غرفة فندقية'}</h3>
                    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-xs font-bold text-slate-500">
                        <span className="flex items-center gap-2"><BedIcon size={17} className="text-remal-blue" /> {room.bed || 'سرير كينج'}</span>
                        <span className="flex items-center gap-2"><UsersIcon size={17} className="text-remal-blue" /> حتى {room.adults || 2} بالغين</span>
                        {room.amenities?.slice(0, 1).map((amenity) => <span key={String(amenity)} className="flex items-center gap-2"><Wifi size={17} className="text-remal-blue" /> {amenity}</span>)}
                    </div>
                    <div className="mt-5 flex items-center gap-2 text-xs font-bold text-emerald-600"><Check size={15} /> إلغاء مجاني حسب السياسة</div>
                </div>
                <div className="flex flex-col items-stretch gap-3 border-t border-slate-100 pt-5 text-right sm:flex-row sm:items-center lg:border-r lg:border-t-0 lg:pr-7 lg:pt-0">
                    <div aria-live="polite" aria-atomic="true" className="text-right">
                        <div className="mb-2 inline-flex rounded-full bg-remal-gold/15 px-3 py-1 text-[10px] font-black text-amber-700">كاش باك متاح</div>
                        <div className="flex items-baseline gap-1"><span className="text-3xl font-black tracking-tight text-remal-dark">{room.price ?? '-'}</span><span className="text-xs font-black text-slate-400">{room.currency || 'AED'}</span></div>
                        <p className="mt-1 text-[10px] font-bold text-slate-400">السعر شامل الضرائب والرسوم</p>
                    </div>
                    <div className="flex flex-col gap-2">
                        {error && <p role="alert" className="max-w-[240px] text-xs font-bold text-remal-red">{error}</p>}
                        <button type="button" onClick={handleBook} disabled={isLoading} aria-busy={isLoading} className="flex min-w-40 items-center justify-center gap-2 rounded-xl bg-remal-red px-6 py-3.5 text-xs font-black text-white transition hover:bg-[#a10b0b] hover:shadow-luxe disabled:cursor-not-allowed disabled:bg-slate-400">
                            {isLoading ? <><LoaderCircle size={16} className="animate-spin" /> تثبيت السعر...</> : isLocked ? <><Check size={16} /> تم تثبيت السعر</> : <><span>احجز الغرفة</span><ArrowLeft size={16} /></>}
                        </button>
                    </div>
                </div>
            </div>
        </motion.article>
    );
}
