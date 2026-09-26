import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BedDouble, ImageOff, MapPin, ShieldCheck, Star, CheckCircle2, CalendarDays, Users } from 'lucide-react';
import HotelRoomCard from './components/HotelRoomCard';
import BookingAPI from './services/bookingApi';
import { SEARCH_CURRENCY, normalizeRoom, rateAmount, rateCurrency } from './services/offers';
import PriceDisplay from './components/PriceDisplay';
import { trackBookingEvent } from './services/analytics';
import { hotelImages } from './services/hotelImages.js';
import { responsiveImageSources } from './services/hotelImages.js';
import { useLanguage } from './i18n';

const toImages = (hotel = {}) => {
    return hotelImages(hotel);
};

function readSearchParams() {
    const params = new URLSearchParams(window.location.search);
    let guests = [];
    try {
        guests = JSON.parse(params.get('guests') || '[]');
    } catch {
        guests = [];
    }
    return {
        checkin: params.get('checkin') || '',
        checkout: params.get('checkout') || '',
        guests: Array.isArray(guests) && guests.length ? guests : [{ adults: 2, children: [] }]
    };
}

function LoadingSkeleton() {
    return (
        <div className="space-y-8 animate-pulse" aria-label="جار تحميل تفاصيل الفندق">
            <div className="space-y-4">
                <div className="h-4 w-32 rounded bg-slate-200" />
                <div className="h-10 w-2/3 rounded-lg bg-slate-200" />
                <div className="h-4 w-1/3 rounded bg-slate-100" />
            </div>
            <div className="h-[50vh] rounded-3xl bg-slate-200" />
            <div className="grid gap-10 lg:grid-cols-[1fr_350px]">
                <div className="space-y-4 rounded-3xl bg-white p-8 border border-slate-100">
                    <div className="h-8 w-1/3 rounded bg-slate-200" />
                    <div className="h-4 w-full rounded bg-slate-100" />
                    <div className="h-4 w-5/6 rounded bg-slate-100" />
                    <div className="h-4 w-4/6 rounded bg-slate-100" />
                </div>
                <div className="h-80 rounded-3xl bg-slate-100" />
            </div>
        </div>
    );
}

function SupplierPicture({ source, fallback, alt, loading = 'lazy', fetchPriority, className = '' }) {
    if (!source && !fallback) return <div className="flex h-full items-center justify-center text-slate-400"><ImageOff size={40} /></div>;
    return (
        <picture>
            {source?.sources?.map(item => <source key={item.type} type={item.type} srcSet={item.srcSet} />)}
            <img
                src={source?.src || fallback}
                srcSet={source?.srcSet}
                sizes={source?.sizes}
                width={source?.width}
                height={source?.height}
                loading={loading}
                fetchPriority={fetchPriority}
                decoding="async"
                alt={alt}
                className={className}
            />
        </picture>
    );
}

export default function HotelDetails({ hid, onBack, displayCurrency, displayRates }) {
    const { t, apiLanguage, direction } = useLanguage();
    const [hotel, setHotel] = useState(null);
    const [rates, setRates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const searchParams = useMemo(readSearchParams, []);
    const images = toImages(hotel || {});
    const mainImageSource = responsiveImageSources(images[0], 'gallery');

    useEffect(() => {
        let active = true;
        const fetchHotelDetails = async () => {
            setLoading(true);
            setError('');
            const [staticResult, liveResult] = await Promise.allSettled([
                BookingAPI.getHotelStatic(hid),
                BookingAPI.getHotelPage({
                    hid,
                    checkin: searchParams.checkin,
                    checkout: searchParams.checkout,
                    guests: searchParams.guests,
                    language: apiLanguage,
                    currency: SEARCH_CURRENCY
                })
            ]);
            if (!active) return;

            const staticHotel = staticResult.status === 'fulfilled' ? staticResult.value?.hotel : null;
            const liveData = liveResult.status === 'fulfilled' ? liveResult.value : null;
            const liveHotel = liveData?.hotel || liveData?.hotels?.[0] || {};
            const liveRates = liveData?.rates || liveHotel.rates || [];
            if (liveResult.status === 'rejected' || (!staticHotel && !liveData)) {
                setError(t('hotel.loadFailed', 'تعذر تحميل الأسعار الحالية، يرجى العودة للبحث والمحاولة مرة أخرى'));
            } else {
                setHotel({ ...staticHotel, ...liveHotel, hid, images: toImages({ ...staticHotel, ...liveHotel }) });
                setRates(Array.isArray(liveRates) ? liveRates : []);
            }
            setLoading(false);
        };
        fetchHotelDetails();
        return () => { active = false; };
    }, [hid, searchParams.checkin, searchParams.checkout, JSON.stringify(searchParams.guests), apiLanguage]);

    const rooms = rates.map(rate => normalizeRoom(rate, hotel, searchParams.guests));
    const lowestRoom = rooms.reduce((best, room) => !best || rateAmount(room) < rateAmount(best) ? room : best, null);

    const navigateToCheckout = (room) => {
        trackBookingEvent('room_selected', { room_count: searchParams.guests.length });
        const booking = {
            hid,
            hotelName: hotel?.name || 'Hotel',
            checkin: searchParams.checkin,
            checkout: searchParams.checkout,
            guests: searchParams.guests,
            room
        };
        sessionStorage.setItem('remal_checkout', JSON.stringify(booking));
        sessionStorage.removeItem('remal_checkout_idempotency_key');
        sessionStorage.removeItem('remal_payment_attempt');
        window.history.pushState({ checkout: booking }, '', '/checkout');
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    if (loading) return <main dir={direction} className="min-h-screen bg-[#F8FAFC] px-5 py-10 lg:px-10"><div className="mx-auto max-w-7xl"><LoadingSkeleton /></div></main>;
    if (error) return <main dir={direction} className="min-h-screen bg-[#F8FAFC] px-5 py-10 lg:px-10"><div className="mx-auto max-w-3xl rounded-3xl bg-red-50 p-10 text-center font-bold text-red-600 shadow-sm"><p className="text-lg">{error}</p><button type="button" onClick={onBack} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-3 text-sm text-white hover:bg-red-700 transition-colors"><ArrowRight size={18} /> {t('hotel.back', 'العودة للنتائج')}</button></div></main>;

    // Calculate total guests safely
    const totalGuests = searchParams.guests.reduce((acc, g) => acc + (g.adults || 0) + (g.children?.length || 0), 0);

    return (
        <main dir={direction} className="min-h-screen bg-[#F8FAFC] pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8 lg:pb-24">
            <div className="mx-auto max-w-7xl px-5 lg:px-10">
                
                {/* 1. Masterstroke Header (Top Section) */}
                <div className="mb-6 space-y-4">
                    <button type="button" onClick={onBack} className="group inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-blue-600 transition-colors">
                        <ArrowRight size={18} className="transition-transform group-hover:-translate-x-1" /> {t('hotel.back', 'العودة للنتائج')}
                    </button>
                    
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                            {Number(hotel?.stars || hotel?.star_rating) > 0 && (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100/80 px-3 py-1.5 text-xs font-extrabold text-amber-700">
                                    <Star size={14} className="fill-amber-500 text-amber-500" />
                                    {t('hotel.stars', `${hotel.stars || hotel.star_rating} نجوم`, { count: hotel.stars || hotel.star_rating })}
                                </span>
                            )}
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl md:text-5xl lg:leading-tight">
                            {hotel?.name || 'Hotel'}
                        </h1>
                        {(hotel?.address || hotel?.staticData?.address) && (
                            <p className="flex items-start gap-2 text-sm font-semibold text-slate-600 sm:text-base">
                                <MapPin size={18} className="mt-0.5 shrink-0 text-blue-600" />
                                {hotel?.address || hotel?.staticData?.address}
                            </p>
                        )}
                    </div>
                </div>

                {/* 2. Masterstroke Bento Grid (Images) */}
                <section aria-label={t('hotel.photos', 'صور الفندق')} className="relative h-[40vh] min-h-[350px] sm:h-[50vh] sm:min-h-[450px] w-full overflow-hidden rounded-3xl shadow-sm">
                    {images.length > 1 ? (
                        <div className="grid h-full grid-cols-1 gap-2 md:grid-cols-4">
                            {/* Main Image (Right side in RTL) */}
                            <div className="group relative h-full md:col-span-2 overflow-hidden bg-slate-200">
                                <SupplierPicture source={mainImageSource} fallback={images[0]} fetchPriority="high" alt={hotel?.name || hotel?.staticData?.name || t('hotel.name', 'الفندق')} className="h-full w-full object-cover transition-transform duration-500 ease-out motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.03]" />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/30 to-transparent opacity-0 transition-opacity duration-300 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100" />
                            </div>
                            
                            {/* 4 Small Images (Left side) */}
                            <div className="hidden h-full grid-cols-2 grid-rows-2 gap-2 md:grid md:col-span-2">
                                {Array.from({ length: 4 }).map((_, index) => images[index + 1] ? (
                                    <div key={images[index + 1]} className="group relative overflow-hidden bg-slate-200">
                                        <SupplierPicture source={responsiveImageSources(images[index + 1], 'gallery')} fallback={images[index + 1]} alt={`${t('hotel.photoAlt', 'صورة')} ${index + 2}`} className="h-full w-full object-cover transition-transform duration-500 ease-out motion-reduce:transition-none motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.03]" />
                                        <div className="absolute inset-0 bg-slate-900/10 opacity-0 transition-opacity duration-300 motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100" />
                                    </div>
                                ) : (
                                    <div key={index} className="flex h-full items-center justify-center bg-slate-100/50 text-slate-300">
                                        <ImageOff size={28} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full w-full bg-slate-200">
                            <SupplierPicture source={mainImageSource} fallback={images[0]} fetchPriority="high" alt={hotel?.name || hotel?.staticData?.name || t('hotel.name', 'الفندق')} className="h-full w-full object-cover" />
                        </div>
                    )}
                </section>

                {/* 3. Main Content & Sticky Widget */}
                <section className="mt-8 grid min-w-0 items-start gap-8 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,22.5rem)] lg:gap-12">
                    
                    {/* Left Column (Content) */}
                    <div className="min-w-0 space-y-8">
                        {/* About & Amenities Card */}
                        <article className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 sm:p-8">
                            <h2 className="text-2xl font-black text-slate-900">عن هذا المكان</h2>
                            {typeof hotel?.description === 'string' && (
                                <p className="mt-4 leading-relaxed text-slate-600 font-medium">{hotel.description}</p>
                            )}
                            
                            <hr className="my-8 border-slate-100" />
                            
                            <h3 className="text-xl font-black text-slate-900 mb-5">أهم المرافق</h3>
                            <div className="grid grid-cols-2 gap-y-4 gap-x-2 sm:grid-cols-3">
                                {(hotel?.amenities || hotel?.staticData?.amenities || []).slice(0, 6).map((amenity) => (
                                    <span key={String(amenity)} className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                        <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                                        {typeof amenity === 'string' ? amenity : amenity.name || amenity.title}
                                    </span>
                                ))}
                            </div>
                        </article>

                        {/* Rooms List */}
                        <section id="hotel-room-offers" className="scroll-mt-24 space-y-5">
                            <div className="mb-6">
                                <h2 className="text-2xl font-black text-slate-900">عروض الإقامة</h2>
                                <p className="mt-1 text-sm font-medium text-slate-500">سيُعاد التحقق من السعر والتوفر قبل إتمام الدفع</p>
                            </div>
                            
                            {rooms.length ? (
                                rooms.map((room, index) => (
                                    <HotelRoomCard key={room.book_hash || index} room={room} onBook={navigateToCheckout} displayCurrency={displayCurrency} displayRates={displayRates} />
                                ))
                            ) : (
                                <div className="rounded-3xl bg-white p-12 text-center border border-slate-100 shadow-sm">
                                    <BedDouble className="mx-auto text-slate-300" size={48} />
                                    <p className="mt-4 text-lg font-black text-slate-700">{t('hotel.noOffers', 'لا توجد عروض متاحة لهذه التواريخ')}</p>
                                    <button onClick={onBack} className="mt-4 font-bold text-blue-600 hover:text-blue-700 underline underline-offset-4">{t('hotel.changeDates', 'تغيير تواريخ البحث')}</button>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Right Column (Sticky Booking Widget - Masterstroke Style) */}
                    <aside className="sticky top-28 hidden overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-2xl shadow-slate-200/50 lg:block">
                        <div className="p-6 sm:p-8">
                            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
                                <p className="min-w-0 break-words text-3xl font-black text-slate-900">{rooms.length ? t('hotel.offers', `${rooms.length} عروض`, { count: rooms.length }) : t('hotel.noOffers', 'لا عروض')}</p>
                                <p className="max-w-full break-words rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-600">{t('hotel.available', 'متاحة الآن')}</p>
                            </div>
                            
                            {/* Airbnb style checkin/checkout box */}
                            <div className="mb-6 rounded-2xl border border-slate-200 overflow-hidden">
                                <div className="flex flex-wrap border-b border-slate-200">
                                    <div className="min-w-0 flex-1 basis-1/2 p-3 border-l border-slate-200 bg-slate-50/50">
                                        <p className="text-[10px] font-black text-slate-900 uppercase tracking-wider mb-1">{t('hotel.arrival', 'الوصول')}</p>
                                        <p className="text-sm font-semibold text-slate-600 flex items-center gap-1.5"><CalendarDays size={14}/> {searchParams.checkin || t('hotel.selectDates', 'تحديد')}</p>
                                    </div>
                                    <div className="min-w-0 flex-1 basis-1/2 p-3 bg-slate-50/50">
                                        <p className="text-[10px] font-black text-slate-900 uppercase tracking-wider mb-1">{t('hotel.departure', 'المغادرة')}</p>
                                        <p className="text-sm font-semibold text-slate-600 flex items-center gap-1.5"><CalendarDays size={14}/> {searchParams.checkout || t('hotel.selectDates', 'تحديد')}</p>
                                    </div>
                                </div>
                                <div className="p-3 bg-slate-50/50">
                                     <p className="text-[10px] font-black text-slate-900 uppercase tracking-wider mb-1">{t('hotel.guestsLabel', 'الضيوف')}</p>
                                     <p className="text-sm font-semibold text-slate-600 flex items-center gap-1.5"><Users size={14}/> {t('hotel.guests', `${totalGuests} ضيوف`, { count: totalGuests })}</p>
                                </div>
                            </div>

                            {/* Trust Pill */}
                            <div className="flex items-start gap-3 rounded-2xl bg-blue-50/50 p-4 border border-blue-100/50">
                                <ShieldCheck size={24} className="text-blue-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-black text-slate-900">{t('hotel.secureTitle', 'حجز آمن ومضمون')}</p>
                                    <p className="mt-1 text-xs font-medium text-slate-500 leading-relaxed">
                                        {t('hotel.secureDescription', 'يتم تشفير بياناتك بالكامل. لن يتم خصم أي مبالغ إلا بعد اختيارك للغرفة والتحقق من التوفر النهائي.')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </aside>

                </section>
                <div className="mobile-booking-bar lg:hidden">
                    <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-500">{t('hotel.mobileSummary', 'ابدأ باختيار غرفة')}</p>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-900">{rooms.length ? t('hotel.offers', `${rooms.length} عروض متاحة`, { count: rooms.length }) : t('hotel.noOffers', 'لا عروض')}</p>
                            {lowestRoom && <PriceDisplay amount={rateAmount(lowestRoom)} currency={rateCurrency(lowestRoom)} displayCurrency={displayCurrency} displayRates={displayRates} className="text-sm font-black text-[var(--remal-blue)]" />}
                        </div>
                    </div>
                    <button type="button" onClick={() => document.getElementById('hotel-room-offers')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} disabled={!rooms.length} className="min-h-12 shrink-0 rounded-xl bg-[var(--remal-orange)] px-5 text-sm font-black text-white shadow-[0_8px_18px_rgba(232,117,45,0.22)] disabled:cursor-not-allowed disabled:bg-slate-300">
                        {t('hotel.viewOffers', 'عرض الغرف')}
                    </button>
                </div>
            </div>
        </main>
    );
}