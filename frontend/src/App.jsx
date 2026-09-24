import { lazy, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, ShieldCheck, SlidersHorizontal, ImageOff, MapPin, Check, Ban, AlertCircle, Search } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelRoomCard from './components/HotelRoomCard';
import PriceDisplay from './components/PriceDisplay';
import AccountCenter from './components/AccountCenter';
import LoyaltyDashboard from './components/LoyaltyDashboard';
const HotelDetails = lazy(() => import('./HotelDetails'));
const Checkout = lazy(() => import('./Checkout'));
import { StarIcon } from './components/Icons';
import BookingAPI from './services/bookingApi';
import { SEARCH_CURRENCY, DISPLAY_CURRENCIES, cheapestRate, rateAmount, rateCurrency, paymentFor, normalizeRoom } from './services/offers';
import { loadUsdDisplayRates } from './services/displayCurrency';
import { trackBookingEvent } from './services/analytics';
import { useLanguage } from './i18n';

function storedSearch() {
    try { return JSON.parse(sessionStorage.getItem('remal_search') || 'null'); } catch { return null; }
}

function storedDisplayCurrency() {
    try {
        const currency = localStorage.getItem('remal_display_currency');
        return DISPLAY_CURRENCIES.includes(currency) ? currency : SEARCH_CURRENCY;
    } catch { return SEARCH_CURRENCY; }
}

const getHotels = (response) => {
    const envelopes = [
        ...(Array.isArray(response) ? [response] : []),
        response?.data,
        response?.data?.data,
        response?.result,
        response?.result?.data,
        response
    ];
    const hotelEnvelope = envelopes.find((envelope) => Array.isArray(envelope?.hotels));
    const hotels = Array.isArray(response) ? response : hotelEnvelope?.hotels;
    return (hotels || []).filter(Boolean).map((hotel) => {
        const staticData = hotel.staticData || {};
        const images = [
            ...(Array.isArray(hotel.images) ? hotel.images : []),
            hotel.image,
            ...(Array.isArray(staticData.images) ? staticData.images : []),
            staticData.image
        ].map((image) => typeof image === 'string' ? image : image?.url || image?.src || '')
            .filter((image) => image.trim());
        const name = [hotel.name, hotel.hotel_name, staticData.name, staticData.hotel_name]
            .find((value) => typeof value === 'string' && value.trim());

        return {
            ...hotel,
            name: name?.trim() || 'Hotel',
            images: [...new Set(images)].map(image => image.replace(/\{size\}/gi, '640x400')),
            rates: (hotel.rates || []).filter(rate => rateCurrency(rate) === SEARCH_CURRENCY).sort((first, second) => rateAmount(first) - rateAmount(second)),
            stars: hotel.stars || hotel.star_rating || staticData.stars || staticData.star_rating || ''
        };
    });
};
const getRatePrice = (rate) => rate?.payment_options?.payment_types?.[0]?.amount || rate?.price || '-';
const getRateHash = (rate) => rate?.book_hash || rate?.match_hash;
const getAmenities = (rate) => Array.isArray(rate?.amenities) ? rate.amenities : (Array.isArray(rate?.room_amenities) ? rate.room_amenities : []);

// Masterstroke UI: SerpResultCard (with Urgency, Social Proof & Image Carousel)
function SerpResultCard({ hotel, onSelect, displayCurrency, displayRates }) {
    const { t } = useLanguage();
    const rate = cheapestRate(hotel.rates) || {};
    const images = hotel.images || [];
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [imageFailed, setImageFailed] = useState(false);
    const hasFreeCancellation = paymentFor(rate)?.cancellation_penalties?.free_cancellation_before;

    // Recommendation cues stay deterministic and factual; avoid invented scarcity.
    const hotelIdStr = String(hotel.id || hotel.hid);
    const isPopular = hotelIdStr.endsWith('1') || hotelIdStr.endsWith('7');
    const priceAmount = rateAmount(rate);
    const isGreatDeal = priceAmount > 0 && priceAmount < 100;

    const socialProofMessages = [
        t('results.comparisonCue', 'اختيار مناسب للمقارنة'),
        t('results.clearDetailsCue', 'تفاصيل واضحة قبل اتخاذ القرار'),
        t('results.reviewCue', 'عرض يستحق المراجعة')
    ];
    const selectedSocialProof = socialProofMessages[parseInt(hotelIdStr.slice(-1)) % 3];

    const nextImage = (e) => {
        e.stopPropagation(); // يمنع الانتقال لصفحة الفندق عند النقر على السهم
        setCurrentImageIndex((prevIndex) => (prevIndex === images.length - 1 ? 0 : prevIndex + 1));
    };

    const prevImage = (e) => {
        e.stopPropagation();
        setCurrentImageIndex((prevIndex) => (prevIndex === 0 ? images.length - 1 : prevIndex - 1));
    };

    return (
        <article aria-labelledby={`hotel-${hotel.hid || hotel.id}`} className="hotel-card surface-card group relative overflow-hidden rounded-3xl transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_18px_42px_rgba(15,35,55,0.12)]">

            <div className="flex flex-col md:flex-row h-full">
                
                {/* Image Section with Carousel */}
                <div className="relative w-full md:w-[280px] shrink-0 overflow-hidden bg-slate-100 h-56 md:h-auto group/carousel">
                    {images.length > 0 && !imageFailed ? (
                        <>
                            <img 
                                src={images[currentImageIndex]} 
                                alt={`${hotel.name} - صورة ${currentImageIndex + 1}`} 
                                loading="lazy" 
                                className="h-full w-full object-cover transition-transform duration-700 group-hover/carousel:scale-105" 
                                onError={() => setImageFailed(true)} 
                            />
                            
                            {/* Carousel Controls (تظهر عند التمرير بالماوس) */}
                            {images.length > 1 && (
                                <div className="absolute inset-0 flex items-center justify-between px-2 opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300">
                                    <button onClick={prevImage} className="p-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors" aria-label="الصورة السابقة">
                                        <ChevronRight size={20} />
                                    </button>
                                    <button onClick={nextImage} className="p-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors" aria-label="الصورة التالية">
                                        <ChevronLeft size={20} />
                                    </button>
                                </div>
                            )}

                            {/* Image Indicators (Dots) */}
                            {images.length > 1 && (
                                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
                                    {images.slice(0, 5).map((_, idx) => (
                                        <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentImageIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
                                    ))}
                                    {images.length > 5 && <div className="h-1.5 w-1.5 rounded-full bg-white/50" />}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center text-slate-400 gap-2">
                            <ImageOff size={32} />
                            <span className="text-sm font-medium">الصورة غير متاحة</span>
                        </div>
                    )}
                    
                    {/* Floating Star Badge */}
                    {Number(hotel.stars) > 0 && (
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-lg bg-black/60 backdrop-blur-md px-2.5 py-1.5 text-sm font-bold text-white shadow-sm border border-white/10">
                            <span>{hotel.stars}</span>
                            <StarIcon size={14} className="text-amber-400" fill="currentColor" />
                        </div>
                    )}

                    {/* Social Proof Tag */}
                </div>

                {/* Content Section */}
                <div className="flex flex-1 flex-col justify-between p-5 sm:p-6 lg:p-7 min-w-0">
                    <div>
                        <div className="flex justify-between items-start gap-4">
                            <div className="min-w-0 flex-1">
                                <h3 id={`hotel-${hotel.hid || hotel.id}`} className="text-2xl font-black text-slate-900 group-hover:text-blue-700 transition-colors line-clamp-2 cursor-pointer" onClick={() => onSelect(hotel)}>
                                    {hotel.name || 'فندق'}
                                </h3>
                                {hotel.city && (
                                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-500">
                                        <MapPin size={16} className="text-blue-500 shrink-0" />
                                        <span className="truncate">{hotel.city}</span>
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Badges Area */}
                        <div className="mt-4 flex flex-col gap-3">
                            <div className="flex flex-wrap gap-2">
                                {hasFreeCancellation ? (
                                    <div className="inline-flex max-w-fit items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-100">
                                        <Check size={14} className="shrink-0 text-emerald-500" /> يتوفر إلغاء مجاني
                                    </div>
                                ) : (
                                    <div className="inline-flex max-w-fit items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600 border border-slate-200">
                                        <AlertCircle size={14} className="shrink-0 text-slate-400" /> راجع شروط الإلغاء
                                    </div>
                                )}
                                
                                {isGreatDeal && (
                                    <div className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1.5 text-xs font-bold text-purple-700 border border-purple-100">
                                        سعر استثنائي
                                    </div>
                                )}
                            </div>

                            {/* Amenities Chips */}
                            {getAmenities(rate).length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {getAmenities(rate).slice(0, 4).map((amenity) => (
                                        <span key={String(amenity)} className="rounded-lg bg-blue-50/50 border border-blue-100 px-2 py-1 text-[11px] font-bold text-blue-800 hover:bg-blue-100 transition-colors cursor-default">
                                            {amenity}
                                        </span>
                                    ))}
                                    {getAmenities(rate).length > 4 && (
                                        <span className="rounded-lg bg-slate-50 border border-slate-100 px-2 py-1 text-[11px] font-bold text-slate-400">
                                            +{getAmenities(rate).length - 4} مزايا أخرى
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Dynamic Social Proof Text */}
                            {isPopular && (
                                <p className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1.5 bg-rose-50 px-2 py-1 rounded-md w-fit border border-rose-100/50">
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                                    </span>
                                    {selectedSocialProof}
                                </p>
                            )}

                        </div>
                    </div>

                    {/* Pricing & CTA Divider */}
                    <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-5 relative">
                        <div className={`text-right ${isPopular ? 'mt-3' : ''}`}>
                                <p className="eyebrow mb-1">{t('results.stayStartsAt', 'إجمالي الإقامة يبدأ من')}</p>
                            <PriceDisplay amount={rateAmount(rate)} currency={rateCurrency(rate)} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-slate-900" />
                                <p className="mt-1 text-[10px] font-bold text-slate-400">{t('results.reviewFees', 'راجع الضرائب والرسوم قبل الدفع')}</p>
                        </div>
                        
                        <div className="w-full sm:w-auto flex flex-col items-end gap-2">
                            <button 
                                type="button" 
                                onClick={() => onSelect(hotel)} 
                                className="group/btn relative inline-flex min-h-[50px] items-center justify-center gap-2 overflow-hidden rounded-xl bg-[var(--remal-orange)] px-6 py-2.5 text-sm font-black text-white shadow-[0_8px_18px_rgba(232,117,45,0.25)] transition-all duration-300 hover:bg-[#d86522] hover:shadow-[0_12px_24px_rgba(232,117,45,0.32)] hover:-translate-y-0.5 w-full sm:w-auto shrink-0"
                            >
                                <span className="relative z-10 flex items-center gap-2">
                                    {t('results.chooseRooms', 'تحديد الغرف')} <ArrowLeft size={18} className="transition-transform duration-300 group-hover/btn:-translate-x-1" />
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
}

export default function App() {
    const { t, apiLanguage, direction } = useLanguage();
    const [pathname, setPathname] = useState(() => window.location.pathname);
    const [displayCurrency, setDisplayCurrency] = useState(storedDisplayCurrency);
    const [displayRates, setDisplayRates] = useState(null);
    const [searched, setSearched] = useState(() => !!storedSearch());
    const [searchParams, setSearchParams] = useState(storedSearch);
    const [hotels, setHotels] = useState([]);
    const [selectedHotel, setSelectedHotel] = useState(null);
    const [hotelPage, setHotelPage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [starFilter, setStarFilter] = useState(0);
    const [amenityFilter, setAmenityFilter] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [sort, setSort] = useState('recommended');
    const [maxPrice, setMaxPrice] = useState('');
    const [freeCancellation, setFreeCancellation] = useState(false);
    const [limit, setLimit] = useState(20);

    // States for Accordion Filters
    const [priceFilterOpen, setPriceFilterOpen] = useState(true);
    const [starsFilterOpen, setStarsFilterOpen] = useState(true);
    const [amenitiesFilterOpen, setAmenitiesFilterOpen] = useState(true);

    useEffect(() => {
        try { localStorage.setItem('remal_display_currency', displayCurrency); } catch {}
        setDisplayRates(null);
        let active = true;
        const controller = new AbortController();
        loadUsdDisplayRates({ signal: controller.signal }).then(rates => {
            if (active) setDisplayRates(rates);
        }).catch(() => {
            if (active) setDisplayRates(null);
        });
        return () => { active = false; controller.abort(); };
    }, [displayCurrency]);

    useEffect(() => {
        const handleLocationChange = () => setPathname(window.location.pathname);
        window.addEventListener('popstate', handleLocationChange);
        return () => window.removeEventListener('popstate', handleLocationChange);
    }, []);

    const handleSearch = (params) => {
        try { sessionStorage.setItem('remal_search', JSON.stringify(params)); } catch {}
        setLimit(20);
        setSearchParams(params);
        setHotels([]);
        setSelectedHotel(null);
        setHotelPage(null);
        setSearched(true);
        window.history.pushState({}, '', '#search');
        window.requestAnimationFrame(() => document.getElementById('results-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    useEffect(() => {
        if (!searchParams) return undefined;
        let active = true;
        const loadResults = async () => {
            const started = performance.now();
            trackBookingEvent('search_started', { room_count: searchParams.guests.length });
            setLoading(true);
            setError('');
            try {
                const { destination, checkin, checkout, guests } = searchParams;
                const request = { checkin, checkout, guests, language: apiLanguage, currency: SEARCH_CURRENCY };
                const hotelId = Number(destination.hotel_id);
                const isHotelSearch = destination.type === 'hotel' || destination.hotel_id;
                if (isHotelSearch && (!Number.isInteger(hotelId) || hotelId < 0 || hotelId > 0xFFFFFFFF)) {
                    throw new Error('The selected hotel does not have a valid RateHawk hotel ID.');
                }
                const response = isHotelSearch
                    ? await BookingAPI.searchByIds({ ...request, hids: [hotelId] })
                    : await BookingAPI.searchByRegion({ ...request, region_id: destination.region_id });
                const nextHotels = [...new Map(getHotels(response).map(hotel => [String(hotel.hid || hotel.id), hotel])).values()];
                if (active) {
                    setHotels(nextHotels);
                    trackBookingEvent('search_completed', { result_count: nextHotels.length, duration_ms: Math.round(performance.now() - started) });
                    setError('');
                }
            } catch (error) {
                if (active) trackBookingEvent('search_failed');
                console.error('Search Error Details:', error);
            setError(t('results.loadFailed', 'تعذر تحميل الفنادق، يرجى المحاولة مرة أخرى'));
            } finally {
                if (active) setLoading(false);
            }
        };
        loadResults();
        return () => { active = false; };
    }, [searchParams, apiLanguage]);

    const openHotel = async (hotel) => {
        setSelectedHotel(hotel);
        window.history.pushState({}, '', `#hotel/${hotel.id || hotel.hid}`);
        setHotelPage(null);
        setError('');
        try {
            const response = await BookingAPI.getHotelPage({
                hid: hotel.hid || hotel.id,
                checkin: searchParams.checkin,
                checkout: searchParams.checkout,
                guests: searchParams.guests,
                language: apiLanguage,
                currency: SEARCH_CURRENCY
            });
            setHotelPage(response);
        } catch {
            setError(t('results.roomsLoadFailed', 'تعذر تحميل الغرف، يرجى تحديث الصفحة'));
        }
    };

    const openHotelDetails = (hotel) => {
        trackBookingEvent('hotel_view_clicked');
        const hid = hotel.hid || hotel.id;
        const params = new URLSearchParams({
            checkin: searchParams?.checkin || '',
            checkout: searchParams?.checkout || '',
            guests: JSON.stringify(searchParams?.guests || [{ adults: 2, children: [] }])
        });
        window.history.pushState({}, '', `/hotel/${encodeURIComponent(hid)}?${params.toString()}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const rooms = (hotelPage?.rates || hotelPage?.hotel?.rates || [])
        .map(rate => normalizeRoom(rate, selectedHotel, searchParams?.guests || [{ adults: 2, children: [] }]));

    const visibleHotels = hotels.filter((hotel) => {
        const stars = Number(hotel.stars || hotel.star_rating || 0);
        const amenities = getAmenities(hotel.rates?.[0] || hotel);
        const best = cheapestRate(hotel.rates);
        return best && (!starFilter || stars >= starFilter) && (!amenityFilter || amenities.length > 0)
            && (!maxPrice || rateAmount(best) <= Number(maxPrice))
            && (!freeCancellation || !!paymentFor(best)?.cancellation_penalties?.free_cancellation_before);
    }).sort((first, second) => sort === 'price' ? rateAmount(cheapestRate(first.rates)) - rateAmount(cheapestRate(second.rates)) : sort === 'stars' ? Number(second.stars || 0) - Number(first.stars || 0) : 0);
    const lowestHotel = visibleHotels.reduce((best, hotel) => !best || rateAmount(cheapestRate(hotel.rates)) < rateAmount(cheapestRate(best.rates)) ? hotel : best, null);
    
    const clearFilters = () => {
        setStarFilter(0);
        setAmenityFilter(false);
        setMaxPrice('');
        setFreeCancellation(false);
    };

    const hotelRoute = pathname.match(/^\/hotel\/([^/]+)$/);
    const checkoutRoute = pathname === '/checkout';
    const accountRoute = pathname === '/account';
    const loyaltyRoute = pathname === '/loyalty';
    const navigateTo = path => {
        const pathnameOnly = path.split('#')[0] || '/';
        window.history.pushState({}, '', path);
        setPathname(pathnameOnly);
    };

    if (accountRoute) {
        return <>
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} onNavigate={navigateTo} />
            <AccountCenter onNavigate={navigateTo} />
        </>;
    }
    if (loyaltyRoute) {
        return <>
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} onNavigate={navigateTo} />
            <LoyaltyDashboard onNavigate={navigateTo} />
        </>;
    }
    if (checkoutRoute) {
        return <>
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} onNavigate={navigateTo} />
            <Checkout
                booking={window.history.state?.checkout}
                displayCurrency={displayCurrency}
                displayRates={displayRates}
                onBack={() => {
                    window.history.back();
                }}
            />
        </>;
    }
    if (hotelRoute) {
        return <>
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} onNavigate={navigateTo} />
            <HotelDetails
                hid={decodeURIComponent(hotelRoute[1])}
                displayCurrency={displayCurrency}
                displayRates={displayRates}
                onBack={() => {
                    window.history.pushState({}, '', '/');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }}
            />
        </>;
    }

    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-900" dir={direction}>
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} onNavigate={navigateTo} />
            <main>
                <HeroSearchSection onSearch={handleSearch} initialSearch={searchParams} />
                <section id="results-heading" className="mx-auto max-w-7xl scroll-mt-8 px-5 pb-24 pt-10 lg:px-10 lg:pt-12">
                    
                    {/* Header Section */}
                    <div className="mb-10 flex flex-col gap-5 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-blue-600">{searched ? t('results.searchResults', 'نتائج البحث') : t('results.remalPicks', 'اختيارات رمال')}</p>
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{t('results.heading', 'فنادق تحسّها على كيفك')}</h2>
                            <p className="mt-2 text-sm font-semibold text-slate-500">{searched ? t('results.searchedCount', `${visibleHotels.length} فندق متاح حسب بحثك`, { count: visibleHotels.length }) : t('results.initialSubheading', 'ابدأ بوجهة وتاريخ واضحين لتحصل على أسعار حية')}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                {t('results.sort', 'الترتيب')}
                                <select value={sort} onChange={event => setSort(event.target.value)} className="rounded-xl border border-slate-200 p-2.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white">
                                    <option value="recommended">{t('results.supplier', 'ترتيب المورد')}</option>
                                    <option value="price">{t('results.lowestPrice', 'الأقل سعراً')}</option>
                                    <option value="stars">{t('results.highestRating', 'الأعلى تصنيفاً')}</option>
                                </select>
                            </label>
                            <button type="button" aria-controls="search-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} className="flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-bold shadow-sm lg:hidden hover:bg-slate-50">
                                <SlidersHorizontal size={18} /> {t('results.filters', 'الفلاتر')}
                            </button>
                        </div>
                    </div>

                    <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
                        
                        {/* Filters Sidebar (Clean UI & Progressive Disclosure) */}
                        <aside id="search-filters" className={`${filtersOpen ? 'block' : 'hidden'} min-w-0 w-full max-w-full border-b border-slate-200 py-6 lg:block lg:border-none lg:py-0`}>
                            <div className="rounded-3xl bg-white shadow-sm border border-slate-100 overflow-hidden">
                                <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <h3 className="text-lg font-black text-slate-900">{t('results.filterResults', 'تصفية النتائج')}</h3>
                                    {(starFilter !== 0 || amenityFilter || maxPrice || freeCancellation) && (
                                        <button type="button" onClick={clearFilters} className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors">
                                            <RotateCcw size={14} /> {t('results.clearFilters', 'مسح الكل')}
                                        </button>
                                    )}
                                </div>
                                
                                <div className="divide-y divide-slate-100">
                                    
                                    {/* Price Filter Accordion */}
                                    <div className="p-5">
                                        <button type="button" onClick={() => setPriceFilterOpen(!priceFilterOpen)} className="flex w-full items-center justify-between text-sm font-black text-slate-800 hover:text-blue-600 transition-colors">
                                            {t('results.price', 'السعر والخيارات الأساسية')}
                                            {priceFilterOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                                        </button>
                                        
                                        {priceFilterOpen && (
                                            <div className="mt-5 space-y-5 animate-in slide-in-from-top-2 fade-in duration-200">
                                                <div className="space-y-3">
                                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">{t('results.maxPrice', 'الحد الأعلى للسعر')} ({SEARCH_CURRENCY})</label>
                                                    <input type="number" min="0" inputMode="decimal" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-slate-200 p-3.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-300 bg-slate-50/50 transition-all hover:bg-white" />
                                                </div>

                                                <label className="flex items-center justify-between cursor-pointer group bg-slate-50 hover:bg-blue-50/50 p-3 rounded-xl transition-colors border border-slate-100 hover:border-blue-100">
                                                    <span className="text-sm font-bold text-slate-700 group-hover:text-blue-700 transition-colors">{t('results.freeCancellation', 'إلغاء مجاني فقط')}</span>
                                                    <div className={`relative flex h-6 w-11 items-center rounded-full transition-colors ${freeCancellation ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                                        <input type="checkbox" className="peer sr-only" checked={freeCancellation} onChange={event => setFreeCancellation(event.target.checked)} />
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${freeCancellation ? 'translate-x-1' : '-translate-x-6'}`} />
                                                    </div>
                                                </label>
                                            </div>
                                        )}
                                    </div>

                                    {/* Stars Filter Accordion */}
                                    <div className="p-5">
                                        <button type="button" onClick={() => setStarsFilterOpen(!starsFilterOpen)} className="flex w-full items-center justify-between text-sm font-black text-slate-800 hover:text-blue-600 transition-colors">
                                            {t('results.stars', 'تصنيف الفندق (نجوم)')}
                                            {starsFilterOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                                        </button>
                                        
                                        {starsFilterOpen && (
                                            <div className="mt-5 animate-in slide-in-from-top-2 fade-in duration-200">
                                                <div className="flex gap-2">
                                                    {[3, 4, 5].map((star) => (
                                                        <button type="button" aria-pressed={starFilter === star} onClick={() => setStarFilter(starFilter === star ? 0 : star)} key={star} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border p-2.5 text-sm font-black transition-all ${starFilter === star ? 'border-amber-400 bg-amber-50 text-amber-800 shadow-sm scale-[1.02]' : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-amber-300 hover:text-amber-700 hover:bg-white'}`}>
                                                            {star} <StarIcon size={14} className={starFilter === star ? 'text-amber-500' : 'text-slate-300'} fill="currentColor" />
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Amenities Filter Accordion */}
                                    <div className="p-5">
                                        <button type="button" onClick={() => setAmenitiesFilterOpen(!amenitiesFilterOpen)} className="flex w-full items-center justify-between text-sm font-black text-slate-800 hover:text-blue-600 transition-colors">
                                            {t('results.roomBenefits', 'مزايا الغرفة')}
                                            {amenitiesFilterOpen ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                                        </button>
                                        
                                        {amenitiesFilterOpen && (
                                            <div className="mt-5 animate-in slide-in-from-top-2 fade-in duration-200">
                                                <label className="flex items-center gap-3 cursor-pointer group p-2 hover:bg-slate-50 rounded-lg transition-colors -mx-2">
                                                    <div className="relative flex items-center justify-center">
                                                        <input type="checkbox" checked={amenityFilter} onChange={(event) => setAmenityFilter(event.target.checked)} className="peer sr-only" />
                                                        <div className={`h-5 w-5 rounded border-2 transition-colors ${amenityFilter ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white group-hover:border-blue-500'}`}></div>
                                                        <Check size={14} className={`absolute text-white transition-opacity ${amenityFilter ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                                                    </div>
                                                    <span className="text-sm font-bold text-slate-700 group-hover:text-blue-700 transition-colors">{t('results.roomBenefits', 'يحتوي على مزايا للغرفة')}</span>
                                                </label>
                                            </div>
                                        )}
                                    </div>

                                </div>
                            </div>
                        </aside>

                        {/* Search Results Area */}
                        <div className="min-w-0 space-y-6">
                            
                            {/* Best Price Highlight Banner */}
                            {lowestHotel && visibleHotels.length > 1 && (
                                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 p-5 border border-emerald-100/50 shadow-sm">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black uppercase tracking-wider text-emerald-600">{t('results.bestFilteredTotal', 'أقل إجمالي مطابق للفلاتر')}</p>
                                        <p className="mt-1 break-words text-lg font-black text-emerald-900">{lowestHotel.name}</p>
                                    </div>
                                    <PriceDisplay amount={rateAmount(cheapestRate(lowestHotel.rates))} currency={SEARCH_CURRENCY} displayCurrency={displayCurrency} displayRates={displayRates} className="text-2xl font-black text-emerald-700 tracking-tight" />
                                </div>
                            )}

                            {selectedHotel ? (
                                <>
                                    <button type="button" onClick={() => setSelectedHotel(null)} className="flex items-center gap-2 text-sm font-black text-blue-600 hover:text-blue-800 transition-colors">
                                        <ChevronLeft size={18} /> العودة للنتائج
                                    </button>
                                    <h2 className="text-3xl font-black text-slate-900">{selectedHotel.name}</h2>
                                    {!hotelPage && !error && (
                                        <div className="flex flex-col items-center justify-center rounded-3xl bg-white p-20 shadow-sm border border-slate-100 gap-4">
                                            <LoaderCircle size={40} className="animate-spin text-blue-600" />
                                            <span className="font-bold text-slate-500">جارٍ تحميل الغرف المتاحة...</span>
                                        </div>
                                    )}
                                    {error && <p role="alert" className="rounded-2xl bg-red-50 p-6 text-sm font-bold text-red-600 border border-red-100">{error}</p>}
                                    {rooms.map((room, index) => <HotelRoomCard key={room.book_hash || index} room={room} displayCurrency={displayCurrency} displayRates={displayRates} />)}
                                </>
                            ) : loading ? (
                                <div role="status" className="flex flex-col items-center justify-center gap-4 rounded-3xl bg-white p-24 shadow-sm border border-slate-100">
                                    <LoaderCircle size={48} className="animate-spin text-blue-600" />
                                    <span className="font-black text-slate-600 text-lg">جارٍ البحث عن أفضل العروض...</span>
                                </div>
                            ) : error ? (
                                <div role="alert" className="rounded-3xl bg-red-50 p-10 text-center border border-red-100">
                                    <AlertCircle size={40} className="mx-auto text-red-500 mb-4" />
                                    <p className="font-bold text-red-900 text-lg">{error}</p>
                                    <button onClick={() => setSearchParams({ ...searchParams })} className="mt-6 rounded-xl bg-red-600 px-6 py-3 text-sm font-bold text-white hover:bg-red-700 transition-colors">إعادة المحاولة</button>
                                </div>
                            ) : visibleHotels.length ? (
                                <div className="space-y-6">
                                    {visibleHotels.slice(0, limit).map((hotel) => (
                                        <SerpResultCard key={hotel.id || hotel.hid} hotel={hotel} onSelect={openHotelDetails} displayCurrency={displayCurrency} displayRates={displayRates} />
                                    ))}
                                    {visibleHotels.length > limit && (
                                        <button onClick={() => setLimit(limit + 20)} className="min-h-[60px] w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 font-bold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                                            {t('results.moreHotels', `عرض المزيد (${visibleHotels.length - limit} فندق)`, { count: visibleHotels.length - limit })}
                                        </button>
                                    )}
                                </div>
                            ) : searched ? (
                                <div className="rounded-3xl bg-white p-20 text-center shadow-sm border border-slate-100">
                                    <MapPin size={48} className="mx-auto text-slate-300 mb-4" />
                                    <p className="font-black text-xl text-slate-700">{t('results.noMatches', 'لا توجد نتائج مطابقة')}</p>
                                    <p className="mt-2 text-slate-500 font-medium">{t('results.noMatchesHelp', 'جرّب إزالة بعض الفلاتر أو تغيير تواريخ البحث.')}</p>
                                </div>
                            ) : (
                                <div className="rounded-3xl bg-white p-20 text-center shadow-sm border border-slate-100">
                                    <Search size={48} className="mx-auto text-slate-300 mb-4" />
                                    <p className="font-black text-xl text-slate-700">{t('results.ready', 'مستعد لرحلتك القادمة؟')}</p>
                                    <p className="mt-2 text-slate-500 font-medium">{t('results.readyHelp', 'اختر وجهة وتواريخ لعرض العروض الحية.')}</p>
                                </div>
                            )}

                            <div id="security" className="mt-12 flex items-start gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                                <ShieldCheck size={28} className="shrink-0 text-emerald-600 mt-1" />
                                <div>
                                    <p className="font-black text-slate-900 text-lg">{t('results.securityTitle', 'الأسعار والتوفر يخضعان للتحقق المباشر')}</p>
                                    <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                                        {t('results.securityDescription', 'تأكيد الدفع لا يعني تأكيد الحجز فوراً؛ يرجى الانتظار حتى يصلك مرجع التأكيد النهائي من المورد الخاص بنا لضمان إقامتك.')}
                                    </p>
                                </div>
                            </div>
                        </div>

                    </div>
                </section>
            </main>
            <footer className="border-t border-slate-200 bg-white">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-5 py-8 text-sm font-bold text-slate-500">
                    <span className="text-slate-800">© 2026 رمال وفِلّها</span>
                    <div className="flex items-center gap-6">
                    <a href="mailto:management@remaltourismllc.com" className="hover:text-blue-600 transition-colors">{t('footer.help', 'المساعدة والتواصل')}</a>
                    <a href="/#security" className="hover:text-blue-600 transition-colors">{t('footer.bookingInfo', 'معلومات الحجز')}</a>
                    </div>
                    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-1.5 rounded-full bg-slate-50 px-4 py-2 text-slate-700 hover:bg-slate-100 transition-colors">
                        {t('footer.top', 'العودة للأعلى')} <ChevronLeft size={16} className="rotate-90" />
                    </button>
                </div>
            </footer>
        </div>
    );
}
