import { useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronLeft, ChevronRight, ImageOff, MapPin } from 'lucide-react';
import PriceDisplay from './PriceDisplay';
import { StarIcon } from './Icons';
import { cheapestRate, paymentFor, rateAmount, rateCurrency } from '../services/offers';
import { responsiveImageSources } from '../services/hotelImages.js';
import { useLanguage } from '../i18n';

function getAmenities(rate) {
    if (Array.isArray(rate?.amenities)) return rate.amenities;
    if (Array.isArray(rate?.room_amenities)) return rate.room_amenities;
    return [];
}

export default function HotelCard({ hotel, href, onSelect, displayCurrency, displayRates, priority = false }) {
    const { t } = useLanguage();
    const rate = cheapestRate(hotel.rates);
    const images = hotel.images || [];
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [imageFailed, setImageFailed] = useState(false);
    const imageSource = responsiveImageSources(images[currentImageIndex], 'card');
    const hasFreeCancellation = Boolean(rate && paymentFor(rate)?.cancellation_penalties?.free_cancellation_before);
    const reviewScore = Number(hotel.reviewScore ?? hotel.review_score ?? hotel.guest_rating ?? hotel.rating);
    const reviewCount = Number(hotel.reviewCount ?? hotel.review_count ?? hotel.reviews_count ?? hotel.number_of_reviews);
    const hasVerifiedReview = Number.isFinite(reviewScore) && reviewScore > 0
        && Number.isFinite(reviewCount) && reviewCount > 0;
    const canNavigate = Boolean(href);
    const canChoose = Boolean(rate && href);

    const nextImage = (event) => {
        event.stopPropagation();
        setCurrentImageIndex(previousIndex => previousIndex === images.length - 1 ? 0 : previousIndex + 1);
    };

    const previousImage = (event) => {
        event.stopPropagation();
        setCurrentImageIndex(previousIndex => previousIndex === 0 ? images.length - 1 : previousIndex - 1);
    };

    return (
        <article aria-labelledby={`hotel-${hotel.hid || hotel.id}`} className="hotel-card surface-card group/card relative overflow-hidden rounded-3xl transition-[transform,box-shadow,border-color] duration-[350ms] ease-out motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:border-remal-blue/30 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_1rem_2.5rem_rgba(16,42,67,0.10)]">
            <div className="flex h-full flex-col md:flex-row">
                <div className="group/carousel relative h-56 w-full shrink-0 touch-auto overflow-hidden bg-slate-100 md:h-auto md:w-1/4 md:min-w-0">
                    {images.length > 0 && !imageFailed ? (
                        <>
                            <picture>
                                {imageSource?.sources?.map(source => <source key={source.type} type={source.type} srcSet={source.srcSet} />)}
                                <img
                                    src={imageSource?.src || images[currentImageIndex]}
                                    srcSet={imageSource?.srcSet}
                                    sizes={imageSource?.sizes}
                                    width={imageSource?.width}
                                    height={imageSource?.height}
                                    alt={`${hotel.name || t('results.hotelFallback', 'الفندق')} - ${t('results.photoAlt', 'صورة')} ${currentImageIndex + 1}`}
                                    loading={priority ? 'eager' : 'lazy'}
                                    fetchPriority={priority ? 'high' : 'auto'}
                                    decoding="async"
                                    className="h-full w-full object-cover transition-transform duration-500 ease-out motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/carousel:scale-[1.03]"
                                    onError={() => setImageFailed(true)}
                                />
                            </picture>
                            {images.length > 1 && (
                                <div className="absolute inset-0 flex items-center justify-between px-2 opacity-100 transition-opacity duration-300 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:md:opacity-0 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:md:group-hover/carousel:opacity-100">
                                    <button type="button" onClick={previousImage} className="flex min-h-10 min-w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-black/60" aria-label="الصورة السابقة">
                                        <ChevronRight size={20} />
                                    </button>
                                    <button type="button" onClick={nextImage} className="flex min-h-10 min-w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-black/60" aria-label="الصورة التالية">
                                        <ChevronLeft size={20} />
                                    </button>
                                </div>
                            )}
                            {images.length > 1 && (
                                <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center gap-1.5">
                                    {images.slice(0, 5).map((_, index) => (
                                        <span key={index} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${index === currentImageIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
                                    ))}
                                    {images.length > 5 && <span className="h-1.5 w-1.5 rounded-full bg-white/50" />}
                                    <span className="sr-only">{t('results.photoCounter', 'الصورة {{current}} من {{total}}', { current: currentImageIndex + 1, total: images.length })}</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
                            <ImageOff size={32} />
                            <span className="text-sm font-medium">الصورة غير متاحة</span>
                        </div>
                    )}

                    {Number(hotel.stars) > 0 && (
                            <div className="glass-dark absolute right-4 top-4 z-10 flex items-center gap-1 px-2.5 py-1.5 text-sm font-bold shadow-sm">
                            <span>{hotel.stars}</span>
                            <StarIcon size={14} className="text-amber-400" fill="currentColor" />
                        </div>
                    )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-between p-5 sm:p-6 lg:p-7">
                    <div>
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <h3 id={`hotel-${hotel.hid || hotel.id}`} className="line-clamp-2 text-2xl font-black text-slate-900">
                                    <a href={href || '#'} onClick={event => {
                                        if (!canNavigate) { event.preventDefault(); return; }
                                        event.preventDefault();
                                        onSelect(hotel);
                                    }} className="rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-remal-blue-strong focus-visible:ring-offset-2 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:hover:text-remal-blue-strong">
                                        {hotel.name || t('results.hotelFallback', 'فندق')}
                                    </a>
                                </h3>
                                {hotel.city && (
                                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-500">
                                        <MapPin size={16} className="shrink-0 text-blue-500" />
                                        <span className="truncate">{hotel.city}</span>
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-3">
                            {rate && <div className="flex flex-wrap gap-2">
                                {hasFreeCancellation ? (
                                    <div className="inline-flex max-w-fit items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700">
                                        <Check size={14} className="shrink-0 text-emerald-500" /> يتوفر إلغاء مجاني
                                    </div>
                                ) : (
                                    <div className="inline-flex max-w-fit items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600">
                                        <AlertCircle size={14} className="shrink-0 text-slate-400" /> راجع شروط الإلغاء
                                    </div>
                                )}
                            </div>}

                            {getAmenities(rate).length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {getAmenities(rate).slice(0, 4).map(amenity => <span key={String(amenity)} className="cursor-default rounded-lg border border-blue-100 bg-blue-50/50 px-2 py-1 text-[11px] font-bold text-blue-800">{amenity}</span>)}
                                    {getAmenities(rate).length > 4 && <span className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-400">+{getAmenities(rate).length - 4} مزايا أخرى</span>}
                                </div>
                            )}

                            {hasVerifiedReview && <p className="mt-1 text-xs font-bold text-slate-600">{t('results.reviewSummary', '{{score}} من 5 · {{count}} مراجعة', { score: reviewScore.toFixed(1), count: reviewCount.toLocaleString('en-US') })}</p>}
                        </div>
                    </div>

                    <div className="relative mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-5">
                        <div className="text-right">
                            <p className="eyebrow mb-1">{t('results.stayStartsAt', 'إجمالي الإقامة يبدأ من')}</p>
                            {rate ? <>
                                <PriceDisplay amount={rateAmount(rate)} currency={rateCurrency(rate)} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-slate-900" />
                                <p className="mt-1 text-[10px] font-bold text-slate-400">{t('results.reviewFees', 'راجع الضرائب والرسوم قبل الدفع')}</p>
                            </> : <p className="text-lg font-black text-slate-600">{t('results.offerUnavailable', 'العرض غير متاح')}</p>}
                        </div>
                            {canChoose ? <a href={href} onClick={event => { event.preventDefault(); onSelect(hotel); }} className="cta-red group/btn relative inline-flex min-h-[50px] w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-2.5 text-sm font-black text-white sm:w-auto">
                                <span className="relative z-10 flex items-center gap-2">{t('results.chooseRooms', 'تحديد الغرف')} <ArrowLeft size={18} className="transition-transform duration-300 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/btn:-translate-x-1" /></span>
                            </a> : <span className="inline-flex min-h-[50px] w-full items-center justify-center rounded-xl bg-slate-200 px-6 py-2.5 text-sm font-bold text-slate-600 sm:w-auto">{t('results.offerUnavailable', 'العرض غير متاح')}</span>}
                        </div>
                    </div>
                </div>
        </article>
    );
}