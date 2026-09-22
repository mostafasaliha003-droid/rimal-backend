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
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md"
        >
            <div className="grid lg:grid-cols-[15rem_1fr]">
                <div className="relative min-h-52 overflow-hidden bg-slate-100 lg:min-h-full">
                    <img src={image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" onError={(event) => { event.currentTarget.src = DEFAULT_IMAGE; }} />
                    <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-gradient-to-l from-amber-300 to-yellow-100 px-3 py-1.5 text-[11px] font-black text-amber-950 shadow-sm"><StarIcon size={13} fill="currentColor" /> كاش باك حصري</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/85 px-2.5 py-1.5 text-[10px] font-bold text-white backdrop-blur-sm"><Check size={12} /> متاح</span>
                    </div>
                </div>
                <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-center">
                    <div className="min-w-0 text-right">
                        <div className="mb-3 flex items-center justify-end gap-2">
                            <div className="flex gap-0.5 text-amber-500" aria-label="تصنيف خمس نجوم">{Array.from({ length: 5 }).map((_, index) => <StarIcon key={index} size={13} fill="currentColor" />)}</div>
                            <span className="text-xs font-bold text-slate-500">اختيار مميز</span>
                        </div>
                        <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="text-xl font-black leading-8 text-slate-900">{room.name || 'غرفة فندقية'}</h3>
                        <div className="mt-5 flex flex-wrap justify-end gap-x-5 gap-y-3 text-xs font-bold text-slate-600">
                            <span className="inline-flex items-center gap-2"><BedIcon size={17} className="text-blue-700" /> {room.bed || 'سرير كينج'}</span>
                            <span className="inline-flex items-center gap-2"><UsersIcon size={17} className="text-blue-700" /> حتى {room.adults || 2} بالغين</span>
                            {room.amenities?.slice(0, 1).map((amenity) => <span key={String(amenity)} className="inline-flex items-center gap-2"><Wifi size={17} className="text-blue-700" /> {amenity}</span>)}
                        </div>
                        <p className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><Check size={15} className="text-emerald-700" /> إلغاء مجاني حسب السياسة</p>
                    </div>
                    <div className="border-t border-slate-200 pt-5 text-right xl:border-r xl:border-t-0 xl:pr-6 xl:pt-0">
                        <div aria-live="polite" aria-atomic="true">
                            <p className="text-xs font-bold text-slate-500">السعر الإجمالي</p>
                            <div className="mt-1 flex items-baseline justify-end gap-1"><span className="text-3xl font-black tracking-normal text-slate-900">{room.price ?? '-'}</span><span className="text-xs font-black text-slate-500">{room.currency || 'AED'}</span></div>
                            <p className="mt-1 text-[11px] font-medium text-slate-500">شامل الضرائب والرسوم</p>
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-800">{error}</p>}
                            <button type="button" onClick={handleBook} disabled={isLoading} aria-busy={isLoading} className="group/button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-sm transition duration-200 hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-500">
                                {isLoading ? <><LoaderCircle size={17} className="animate-spin" /> <span className="animate-pulse">جارٍ تثبيت السعر...</span></> : isLocked ? <><Check size={17} /> تم تثبيت السعر</> : <><span>تثبيت السعر والحجز</span><ArrowLeft size={17} className="transition-transform duration-200 group-hover/button:-translate-x-1" /></>}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </motion.article>
    );
}
