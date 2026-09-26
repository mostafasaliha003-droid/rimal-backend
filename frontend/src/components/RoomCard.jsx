import { useRef, useState } from 'react';
import { ArrowLeft, Check, Wifi, Info, Coffee, Ban, AlertCircle, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { BedIcon, UsersIcon, StarIcon } from './Icons'; // تأكد أن StarIcon متوفر هنا
import PriceDisplay from './PriceDisplay';
import BookingAPI from '../services/bookingApi'; // تأكد من مسار API الخاص بك
import { responsiveImageSources } from '../services/hotelImages.js';
import { paymentFor, rateAmount, rateCurrency } from '../services/offers';
import { useLanguage } from '../i18n';

export function CancellationPolicy({ cancellation, currency }) {
    const { t } = useLanguage();
    const deadline = cancellation?.free_cancellation_before;
    return (
        <div className="text-sm">
            {deadline ? (
                <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs font-bold text-emerald-800">
                    <Check size={16} className="text-emerald-500 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words leading-tight">
                        {t('room.freeCancellationUntil', 'إلغاء مجاني حتى')} <span className="font-black text-emerald-900">{deadline.replace('T', ' ')}</span>
                    </span>
                </div>
            ) : (
                <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                    <AlertCircle size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words leading-tight">{t('room.noFreeCancellation', 'لا يوجد إلغاء مجاني مؤكد لهذا العرض')}</span>
                </div>
            )}
            
            {cancellation?.policies?.length > 0 && (
                <details className="mt-3 group">
                    <summary className="cursor-pointer text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors outline-none flex items-center gap-1">
                        {t('room.cancellationFees', 'رسوم الإلغاء')}
                    </summary>
                    <ul className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs font-medium text-slate-600 border border-slate-100 shadow-sm">
                        {cancellation.policies.map((policy, index) => (
                            <li key={index} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200/50 pb-1.5 last:border-0 last:pb-0">
                                <span className="min-w-0 break-words">
                                    {policy.start_at ? `${t('room.from', 'من')} ${policy.start_at.replace('T', ' ')}` : t('room.beforeNextDeadline', 'قبل الموعد التالي')}
                                    {policy.end_at ? ` ${t('room.until', 'حتى')} ${policy.end_at.replace('T', ' ')}` : ''}
                                </span>
                                <span className="shrink-0 break-words font-bold text-left text-slate-800" dir="ltr">
                                    {policy.amount} {policy.currency_code || currency}
                                </span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}

export default function RoomCard({ room = {}, onBook, displayCurrency = 'USD', displayRates = null }) {
    const { t } = useLanguage();
    const [status, setStatus] = useState('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [prebookResult, setPrebookResult] = useState(null);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const touchStartX = useRef(null);

    const hotel = room.hotel || {};
    const name = room.name || t('room.defaultName', 'غرفة فندقية');
    const roomImages = Array.isArray(room.images) ? room.images : [];
    const image = roomImages[activeImageIndex];
    const imageSource = responsiveImageSources(image, 'room');
    const price = room.price ?? '-';
    const amenities = room.amenities || [];

    const payable = ['AED', 'USD', 'SAR', 'EUR'].includes(room.currency) && room.paymentType === 'deposit'
        && Number.isFinite(room.price) && room.price > 0 && room.book_hash;
    const additionalTaxes = (room.taxes || []).filter(tax => !tax.included_by_supplier);

    const handleBook = async () => {
        if (status === 'success') {
            onBook?.(prebookResult);
            return;
        }
        setStatus('loading');
        setErrorMsg('');
        try {
            const result = await BookingAPI.prebook(room.book_hash || room.roomId, 2);
            const validatedRate = result?.rate || result?.hotels?.[0]?.rates?.[0];
            const validatedRoom = {
                ...room,
                ...result,
                book_hash: result?.bookHash || validatedRate?.book_hash || room.book_hash,
                price: validatedRate ? rateAmount(validatedRate) : room.price,
                currency: validatedRate ? rateCurrency(validatedRate) : room.currency,
                paymentType: paymentFor(validatedRate)?.type || room.paymentType,
                originalRate: validatedRate || room.originalRate,
                prebookResult: result
            };
            setPrebookResult(validatedRoom);
            setStatus('success');
        } catch (requestError) {
            setStatus('error');
            const errorCode = requestError.response?.data?.error;
            setErrorMsg(requestError.response?.status === 409 || errorCode === 'RATE_NOT_FOUND' || errorCode === 'rate_not_found'
                ? t('room.rateChanged', 'عذراً، لقد تغير السعر أو التوفر، يرجى تحديث الصفحة')
                : errorCode === 'PREBOOK_TIMEOUT'
                    ? t('room.timeout', 'استغرق التحقق من السعر وقتاً أطول من المتوقع. يرجى المحاولة مرة أخرى.')
                    : t('room.prebookFailed', 'تعذر تثبيت السعر، يرجى المحاولة مرة أخرى'));
        }
    };

    const handleImageTouchStart = (event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
    };

    const handleImageTouchEnd = (event) => {
        if (touchStartX.current === null || roomImages.length < 2) return;
        const delta = event.changedTouches[0]?.clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(delta) < 36) return;
        setActiveImageIndex((index) => delta < 0
            ? (index === roomImages.length - 1 ? 0 : index + 1)
            : (index === 0 ? roomImages.length - 1 : index - 1));
    };

    return (
        <article
            aria-labelledby={`room-${room.book_hash || room.roomId || room.name}`}
            className="room-card surface-card group relative mb-6 overflow-hidden rounded-3xl transition-[transform,box-shadow,border-color] duration-[350ms] ease-out motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:border-remal-blue/30 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_1rem_2.5rem_rgba(16,42,67,0.10)]"
        >
            <div className="flex flex-col lg:flex-row h-full">
                
                {/* Only supplier-provided room photos are shown; never reuse the hotel photo. */}
                <div onTouchStart={handleImageTouchStart} onTouchEnd={handleImageTouchEnd} className="relative w-full touch-pan-y lg:w-1/4 lg:min-w-0 shrink-0 overflow-hidden bg-slate-100 h-48 lg:h-auto">
                    {image ? (
                        <picture>
                            {imageSource?.sources?.map(source => <source key={source.type} type={source.type} srcSet={source.srcSet} />)}
                            <img
                                src={imageSource?.src || image}
                                srcSet={imageSource?.srcSet}
                                sizes={imageSource?.sizes}
                                width={imageSource?.width}
                                height={imageSource?.height}
                                alt={name}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition-transform duration-500 ease-out motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.03]"
                                onError={() => setActiveImageIndex(index => index + 1)}
                            />
                        </picture>
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                            <ImageOff size={30} />
                            <span className="px-4 text-center text-xs font-bold">{t('room.photoUnavailable', 'لا توجد صورة حقيقية متاحة لهذه الغرفة')}</span>
                        </div>
                    )}
                    {roomImages.length > 1 && image && (
                        <>
                            <button type="button" onClick={() => setActiveImageIndex(index => index === 0 ? roomImages.length - 1 : index - 1)} className="flex min-h-10 min-w-10 items-center justify-center absolute left-2 top-1/2 rounded-full bg-black/45 text-white" aria-label="Previous room photo"><ChevronLeft size={16} /></button>
                            <button type="button" onClick={() => setActiveImageIndex(index => index === roomImages.length - 1 ? 0 : index + 1)} className="flex min-h-10 min-w-10 items-center justify-center absolute right-2 top-1/2 rounded-full bg-black/45 text-white" aria-label="Next room photo"><ChevronRight size={16} /></button>
                            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1">
                                {roomImages.slice(0, 5).map((roomImage, index) => <span key={roomImage} className={`h-1.5 rounded-full ${index === activeImageIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`} />)}
                            </div>
                        </>
                    )}
                </div>

                {/* Right Side: Room Details */}
                <div className="flex-1 p-5 sm:p-6 lg:p-7 min-w-0 flex flex-col justify-between">
                    <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            {!image && <span className="rounded-full bg-cyan-50 border border-cyan-100 px-2.5 py-1 text-[10px] font-black text-[var(--remal-blue)]">{t('room.comparable', 'عرض قابل للمقارنة')}</span>}
                            <div className="flex gap-0.5 text-amber-400">
                                {Array.from({ length: 5 }).map((_, index) => <StarIcon key={index} size={14} fill="currentColor" />)}
                            </div>
                        </div>
                        
                        <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="mb-4 text-2xl font-black leading-snug text-slate-900 transition-colors motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:text-blue-700">
                            {name}
                        </h3>
                        
                        {/* Masterstroke Badges for Amenities */}
                        <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-700">
                            {room.bed && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                    <BedIcon size={16} className="text-slate-400" />
                                    {room.bed}
                                </span>
                            )}
                            
                            {room.guests && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                    <UsersIcon size={16} className="text-slate-400" />
                                    {t('room.guests', `حتى ${room.guests.reduce((total, group) => total + group.adults + group.children.length, 0)} ضيوف`, { count: room.guests.reduce((total, group) => total + group.adults + group.children.length, 0) })}
                                </span>
                            )}
                            
                            {room.meal && (
                                <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 border ${room.meal === 'nomeal' ? 'bg-slate-50 border-slate-100 text-slate-600' : 'bg-orange-50 border-orange-100 text-orange-800'}`}>
                                    {room.meal === 'nomeal' ? <Ban size={15} className="text-slate-400" /> : <Coffee size={15} className="text-orange-500" />}
                                    {room.meal === 'nomeal' ? t('results.noMeal', 'بدون وجبات') : room.meal === 'breakfast' ? t('results.breakfast', 'الإفطار مشمول') : room.meal}
                                </span>
                            )}

                            {amenities.slice(0, 2).map((amenity) => (
                                <span key={String(amenity)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50/50 border border-blue-100 px-3 py-2 text-blue-800">
                                    <Wifi size={15} className="text-blue-600" />
                                    <span className="max-w-full break-words">{amenity}</span>
                                </span>
                            ))}
                        </div>
                        
                        <div className="mt-5">
                            <CancellationPolicy cancellation={room.cancellation} currency={room.currency} />
                        </div>
                    </div>
                </div>

                {/* Left Side: Pricing & CTA (Glassmorphism highlight box) */}
                <div className="min-w-0 bg-slate-50 border-t lg:w-1/4 lg:border-t-0 lg:border-r border-slate-100 p-5 sm:p-7 flex flex-col justify-center relative overflow-hidden">
                    {/* Decorative background element */}
                    <div className="absolute top-0 left-0 w-32 h-32 bg-blue-600/5 rounded-full blur-3xl -translate-x-10 -translate-y-10" />
                    
                    <div aria-live="polite" aria-atomic="true" className="relative z-10 text-right mb-5 lg:mb-6">
                        <div className="mb-3 inline-flex rounded-full bg-cyan-50 border border-cyan-100 px-3 py-1 text-[10px] font-black text-[var(--remal-blue)] w-fit">
                            تحقق من السعر والتوفر قبل الدفع
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">السعر الإجمالي للإقامة</p>
                        
                        <div className="flex items-baseline justify-end gap-1.5">
                            {price !== '-' ? (
                                <PriceDisplay amount={price} currency={room.currency || 'AED'} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl" />
                            ) : (
                                <span className="text-3xl font-black tracking-tight text-slate-900">-</span>
                            )}
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500 flex items-center justify-end gap-1">
                            <Info size={12} /> {t('room.included', 'شامل الضرائب والرسوم')}
                        </p>

                        {additionalTaxes.length > 0 && (
                            <div className="mt-3 space-y-1 rounded-lg bg-orange-50/50 p-2.5 border border-orange-100/50 text-right">
                                {additionalTaxes.map((tax, index) => (
                                    <p key={index} className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-orange-800">
                                        <span className="min-w-0 break-words">{tax.name || t('room.localFees', 'رسوم غير مشمولة')}{' '}</span>
                                        <span dir="ltr" className="shrink-0 break-words rounded bg-white px-1.5 py-0.5 shadow-sm">{tax.amount} {tax.currency_code}</span>
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="relative z-10 flex flex-col gap-2">
                        {errorMsg && <p role="alert" className="text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg text-center border border-red-100 mb-2">{errorMsg}</p>}
                        
                        <button
                            type="button"
                            onClick={handleBook} 
                            disabled={status === 'loading' || (!payable && status !== 'success')} 
                            className={`group/btn relative inline-flex min-h-[56px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0 ${status === 'success' ? 'bg-emerald-600 shadow-[0_8px_18px_rgba(16,185,129,0.2)] transition-colors hover:bg-emerald-700' : payable ? 'cta-red' : 'bg-slate-300 text-slate-600'}`}
                        >
                            <span className="relative z-10 flex flex-wrap items-center justify-center gap-2 text-center">
                                {status === 'loading' ? t('room.verifying', 'جارٍ التحقق...') : status === 'success' ? t('room.fixed', 'تم تثبيت السعر') : t('room.book', 'احجز الغرفة')}
                                {status === 'success' ? <Check size={18} className="motion-safe:animate-[success-pop_300ms_ease-out] motion-reduce:animate-none" /> : status === 'loading' ? <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent motion-safe:animate-spin motion-reduce:animate-none"></span> : <ArrowLeft size={18} className="transition-transform duration-300 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/btn:-translate-x-1" />}
                            </span>
                        </button>

                        {!payable && status !== 'success' && (
                            <div className="mt-2 flex items-start gap-1.5 text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg">
                                <Info size={14} className="shrink-0 mt-0.5" />
                                <p>{t('room.paymentUnavailable', 'عذراً، هذا العرض غير متاح للدفع الإلكتروني حالياً.')}</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </article>
    );
}
