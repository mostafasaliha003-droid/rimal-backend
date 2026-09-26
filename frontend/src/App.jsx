import { lazy, useEffect, useState } from 'react';
import { ChevronLeft, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, ShieldCheck, SlidersHorizontal, MapPin, Check, AlertCircle, Search, X } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelCard from './components/HotelCard';
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
import { hotelImages } from './services/hotelImages.js';
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
        const images = hotelImages({ ...hotel, staticData });
        const name = [hotel.name, hotel.hotel_name, staticData.name, staticData.hotel_name]
            .find((value) => typeof value === 'string' && value.trim());

        return {
            ...hotel,
            name: name?.trim() || 'Hotel',
            images,
            rates: (hotel.rates || []).filter(rate => rateCurrency(rate) === SEARCH_CURRENCY).sort((first, second) => rateAmount(first) - rateAmount(second)),
            stars: hotel.stars || hotel.star_rating || staticData.stars || staticData.star_rating || ''
        };
    });
};
const getAmenities = (rate) => {
    if (Array.isArray(rate?.amenities)) return rate.amenities;
    if (Array.isArray(rate?.room_amenities)) return rate.room_amenities;
    return [];
};

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

    const activeFilterCount = [
        Boolean(maxPrice),
        freeCancellation,
        Boolean(starFilter),
        amenityFilter
    ].filter(Boolean).length;

    useEffect(() => {
        const isMobile = window.matchMedia('(max-width: 1023px)').matches;
        document.body.classList.toggle('filter-sheet-open', filtersOpen && isMobile);
        return () => document.body.classList.remove('filter-sheet-open');
    }, [filtersOpen]);

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
        setLoading(true);
        setError('');
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
                <HeroSearchSection onSearch={handleSearch} initialSearch={searchParams} isSearching={loading} searchError={error} />
                <section id="results-heading" className="mx-auto max-w-7xl scroll-mt-8 px-5 pb-24 pt-10 lg:px-10 lg:pt-12">
                    
                    {/* Header Section */}
                    <div className="mb-10 flex flex-col gap-5 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-blue-600">{searched ? t('results.searchResults', 'نتائج البحث') : t('results.remalPicks', 'اختيارات رمال')}</p>
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{t('results.heading', 'فنادق تحسّها على كيفك')}</h2>
                            <p className="mt-2 text-sm font-semibold text-slate-500">{searched ? t('results.searchedCount', `${visibleHotels.length} فندق متاح حسب بحثك`, { count: visibleHotels.length }) : t('results.initialSubheading', 'ابدأ بوجهة وتاريخ واضحين لتحصل على أسعار حية')}</p>
                        </div>
                        <div className="hidden flex-wrap items-center gap-4 lg:flex">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                {t('results.sort', 'الترتيب')}
                                <select value={sort} onChange={event => setSort(event.target.value)} className="rounded-xl border border-slate-200 p-2.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white">
                                    <option value="recommended">{t('results.supplier', 'ترتيب المورد')}</option>
                                    <option value="price">{t('results.lowestPrice', 'الأقل سعراً')}</option>
                                    <option value="stars">{t('results.highestRating', 'الأعلى تصنيفاً')}</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
                        
                        {/* Filters Sidebar (Clean UI & Progressive Disclosure) */}
                        {filtersOpen && <button type="button" aria-label={t('results.closeFilters', 'إغلاق الفلاتر')} onClick={() => setFiltersOpen(false)} className="filter-sheet-backdrop fixed inset-0 z-[60] bg-slate-950/45 lg:hidden" />}
                        <aside id="search-filters" role={filtersOpen ? 'dialog' : undefined} aria-modal={filtersOpen ? 'true' : undefined} aria-label={t('results.filterResults', 'تصفية النتائج')} className={`filter-sheet ${filtersOpen ? 'filter-sheet-open' : ''} min-w-0 w-full max-w-full border-b border-slate-200 py-6 lg:block lg:border-none lg:py-0`}>
                            <div className="filter-sheet-panel rounded-t-3xl bg-white shadow-sm border border-slate-100 overflow-hidden lg:rounded-3xl">
                                <div className="filter-sheet-handle lg:hidden" aria-hidden="true" />
                                <div className="p-5 pb-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 sm:p-6">
                                    <h3 className="text-lg font-black text-slate-900">{t('results.filterResults', 'تصفية النتائج')}</h3>
                                    <div className="flex items-center gap-2">
                                        {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors"><RotateCcw size={14} /> {t('results.clearFilters', 'مسح الكل')}</button>}
                                        <button type="button" onClick={() => setFiltersOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 lg:hidden" aria-label={t('results.closeFilters', 'إغلاق الفلاتر')}><X size={18} /></button>
                                    </div>
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
                                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-4 lg:hidden">
                                    <span className="text-sm font-bold text-slate-500">{activeFilterCount ? t('results.activeFilters', '{{count}} فلاتر مفعّلة', { count: activeFilterCount }) : t('results.noActiveFilters', 'لا توجد فلاتر مفعّلة')}</span>
                                    <button type="button" onClick={() => setFiltersOpen(false)} className="min-h-11 rounded-xl bg-[var(--remal-orange)] px-6 text-sm font-black text-white shadow-sm hover:bg-[#d86522]">{t('results.showResults', 'عرض النتائج')}</button>
                                </div>
                            </div>
                        </aside>

                        {/* Search Results Area */}
                        <div className="min-w-0 space-y-6 pb-20 lg:pb-0">
                            
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
                                <ul aria-label={t('results.hotelList', 'قائمة الفنادق')} className="grid auto-cols-[88%] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain snap-x snap-proximity scroll-px-4 px-4 py-4 touch-auto md:auto-cols-auto md:grid-flow-row md:grid-cols-1 md:overflow-visible md:snap-none md:space-y-6">
                                    {visibleHotels.slice(0, limit).map((hotel) => (
                                        <li key={hotel.id || hotel.hid} className="min-w-0 snap-start snap-normal">
                                            <HotelCard hotel={hotel} onSelect={openHotelDetails} displayCurrency={displayCurrency} displayRates={displayRates} />
                                        </li>
                                    ))}
                                    {visibleHotels.length > limit && (
                                        <li className="min-w-0 snap-start snap-normal md:col-span-1">
                                            <button onClick={() => setLimit(limit + 20)} className="min-h-[60px] w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 font-bold text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
                                            {t('results.moreHotels', `عرض المزيد (${visibleHotels.length - limit} فندق)`, { count: visibleHotels.length - limit })}
                                            </button>
                                        </li>
                                    )}
                                </ul>
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
                {searched && <div className="mobile-results-toolbar lg:hidden">
                    <button type="button" aria-controls="search-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} className="relative flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800 shadow-sm active:scale-[0.98]">
                        <SlidersHorizontal size={18} /> {t('results.filters', 'الفلاتر')}
                        {activeFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--remal-blue)] px-1 text-[11px] font-black text-white">{activeFilterCount}</span>}
                    </button>
                    <label className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm">
                        <span className="sr-only">{t('results.sort', 'الترتيب')}</span>
                        <select value={sort} onChange={event => setSort(event.target.value)} className="w-full bg-transparent text-center font-black outline-none">
                            <option value="recommended">{t('results.supplier', 'ترتيب المورد')}</option>
                            <option value="price">{t('results.lowestPrice', 'الأقل سعراً')}</option>
                            <option value="stars">{t('results.highestRating', 'الأعلى تصنيفاً')}</option>
                        </select>
                    </label>
                </div>}
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
