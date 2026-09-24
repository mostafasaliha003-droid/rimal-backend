import { lazy, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, LoaderCircle, RotateCcw, ShieldCheck, SlidersHorizontal, ImageOff, MapPin, Check, Ban, AlertCircle, Search } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelRoomCard from './components/HotelRoomCard';
import PriceDisplay from './components/PriceDisplay';
const HotelDetails = lazy(() => import('./HotelDetails'));
const Checkout = lazy(() => import('./Checkout'));
import { StarIcon } from './components/Icons';
import BookingAPI from './services/bookingApi';
import { SEARCH_CURRENCY, DISPLAY_CURRENCIES, cheapestRate, rateAmount, rateCurrency, paymentFor } from './services/offers';
import { loadUsdDisplayRates } from './services/displayCurrency';
import { trackBookingEvent } from './services/analytics';

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

// Masterstroke UI: SerpResultCard (with Urgency & Social Proof Tags)
function SerpResultCard({ hotel, onSelect, displayCurrency, displayRates }) {
    const rate = cheapestRate(hotel.rates) || {};
    const image = hotel.images?.[0];
    const [imageFailed, setImageFailed] = useState(false);
    const hasFreeCancellation = paymentFor(rate)?.cancellation_penalties?.free_cancellation_before;

    // --- هندسة التحويل: وسوم الاستعجال والثقة (Urgency & Trust) ---
    const hotelIdStr = String(hotel.id || hotel.hid);
    const isPopular = hotelIdStr.endsWith('1') || hotelIdStr.endsWith('7'); // مجرد محاكاة عشوائية مبنية على الـ ID
    const isRareFind = hotelIdStr.endsWith('3'); 
    const priceAmount = rateAmount(rate);
    const isGreatDeal = priceAmount > 0 && priceAmount < 100; // مثال: سعر مغرٍ

    return (
        <article aria-labelledby={`hotel-${hotel.hid || hotel.id}`} className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:border-blue-200 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
            
            {/* Urgency Ribbon (شريط جانبي للفت الانتباه) */}
            {isPopular && (
                <div className="absolute top-4 -right-12 z-20 flex w-40 items-center justify-center rotate-45 bg-gradient-to-r from-red-600 to-rose-500 py-1 text-[10px] font-black text-white shadow-sm">
                    مطلوب بشدة
                </div>
            )}

            <div className="flex flex-col md:flex-row h-full">
                
                {/* Image Section (Right in RTL) */}
                <div className="relative w-full md:w-[280px] shrink-0 overflow-hidden bg-slate-100 h-56 md:h-auto">
                    {image && !imageFailed ? (
                        <img 
                            src={image} 
                            alt={hotel.name} 
                            loading="lazy" 
                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" 
                            onError={() => setImageFailed(true)} 
                        />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center text-slate-400 gap-2">
                            <ImageOff size={32} />
                            <span className="text-sm font-medium">الصورة غير متاحة</span>
                        </div>
                    )}
                    
                    {/* Floating Star Badge on Image */}
                    {Number(hotel.stars) > 0 && (
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded-lg bg-black/60 backdrop-blur-md px-2.5 py-1.5 text-sm font-bold text-white shadow-sm border border-white/10">
                            <span>{hotel.stars}</span>
                            <StarIcon size={14} className="text-amber-400" fill="currentColor" />
                        </div>
                    )}

                    {/* Social Proof Tag at bottom of image */}
                    {isRareFind && (
                        <div className="absolute bottom-4 right-4 z-10 rounded-lg bg-rose-600/90 backdrop-blur-md px-3 py-1.5 text-[11px] font-black text-white shadow-sm">
                            فرصة نادرة!
                        </div>
                    )}
                </div>

                {/* Content Section */}
                <div className="flex flex-1 flex-col justify-between p-5 sm:p-6 lg:p-7 min-w-0">
                    <div>
                        <div className="flex justify-between items-start gap-4">
                            <div className="min-w-0 flex-1">
                                <h3 id={`hotel-${hotel.hid || hotel.id}`} className="text-2xl font-black text-slate-900 group-hover:text-blue-700 transition-colors line-clamp-2">
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
                            {/* Cancellation & Deal Badges */}
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
                        </div>
                    </div>

                    {/* Pricing & CTA Divider */}
                    <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-5 relative">
                        {/* Fake old price crossed out to show a deal */}
                        {isPopular && (
                            <div className="absolute top-1 right-0 text-xs text-slate-400 line-through decoration-slate-300 font-bold">
                                {(rateAmount(rate) * 1.15).toFixed(0)} {rateCurrency(rate)}
                            </div>
                        )}
                        
                        <div className={`text-right ${isPopular ? 'mt-3' : ''}`}>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">إجمالي الإقامة يبدأ من</p>
                            <PriceDisplay amount={rateAmount(rate)} currency={rateCurrency(rate)} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-slate-900" />
                            <p className="mt-0.5 text-[10px] font-bold text-slate-400">قد تُطبق رسوم محلية إضافية</p>
                        </div>
                        
                        <div className="w-full sm:w-auto flex flex-col items-end gap-2">
                            {/* Scarcity message near the button */}
                            {isPopular && (
                                <span className="text-[11px] font-bold text-red-600 flex items-center gap-1 animate-pulse">
                                    <span className="h-1.5 w-1.5 rounded-full bg-red-600"></span> قد يُحجز قريباً
                                </span>
                            )}
                            <button 
                                type="button" 
                                onClick={() => onSelect(hotel)} 
                                className="group/btn relative inline-flex min-h-[50px] items-center justify-center gap-2 overflow-hidden rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_0_rgb(37,99,235,0.39)] transition-all duration-300 hover:bg-blue-700 hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] hover:-translate-y-0.5 w-full sm:w-auto shrink-0"
                            >
                                <span className="relative z-10 flex items-center gap-2">
                                    تحديد الغرف <ArrowLeft size={18} className="transition-transform duration-300 group-hover/btn:-translate-x-1" />
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
                const request = { checkin, checkout, guests, language: 'ar', currency: SEARCH_CURRENCY };
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
                if (active) setError('تعذر تحميل الفنادق، يرجى المحاولة مرة أخرى');
            } finally {
                if (active) setLoading(false);
            }
        };
        loadResults();
        return () => { active = false; };
    }, [searchParams]);

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
                language: 'ar',
                currency: SEARCH_CURRENCY
            });
            setHotelPage(response);
        } catch {
            setError('تعذر تحميل الغرف، يرجى تحديث الصفحة');
        }
    };

    const openHotelDetails = (hotel) => {
        const hid = hotel.hid || hotel.id;
        const params = new URLSearchParams({
            checkin: searchParams?.checkin || '',
            checkout: searchParams?.checkout || '',
            guests: JSON.stringify(searchParams?.guests || [{ adults: 2, children: [] }])
        });
        window.history.pushState({}, '', `/hotel/${encodeURIComponent(hid)}?${params.toString()}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const rooms = (hotelPage?.rates || hotelPage?.hotel?.rates || []).map((rate) => ({
        name: rate.room_name || rate.name,
        hotel: selectedHotel,
        price: getRatePrice(rate),
        book_hash: getRateHash(rate),
        adults: rate.rooms?.[0]?.adults || 2,
        amenities: getAmenities(rate),
        freeCancellation: rate.payment_options?.payment_types?.[0]?.cancellation_penalties?.free_cancellation_before
    }));

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
    if (checkoutRoute) {
        return <>
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
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
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
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
        <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
            <TopNavigationBar currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
            <main>
                <HeroSearchSection onSearch={handleSearch} initialSearch={searchParams} />
                <section id="results-heading" className="mx-auto max-w-7xl scroll-mt-8 px-5 pb-24 pt-10 lg:px-10 lg:pt-12">
                    
                    {/* Header Section */}
                    <div className="mb-10 flex flex-col gap-5 border-b border-slate-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-blue-600">{searched ? 'نتائج البحث' : 'اختيارات رمال'}</p>
                            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">فنادق تحسّها على كيفك</h2>
                            <p className="mt-2 text-sm font-semibold text-slate-500">{searched ? `${visibleHotels.length} فندق متاح حسب بحثك` : 'ابدأ بوجهة وتاريخ واضحين لتحصل على أسعار حية'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                الترتيب 
                                <select value={sort} onChange={event => setSort(event.target.value)} className="rounded-xl border border-slate-200 p-2.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white">
                                    <option value="recommended">ترتيب المورد</option>
                                    <option value="price">الأقل سعراً</option>
                                    <option value="stars">الأعلى تصنيفاً</option>
                                </select>
                            </label>
                            <button type="button" aria-controls="search-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} className="flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-bold shadow-sm lg:hidden hover:bg-slate-50">
                                <SlidersHorizontal size={18} /> الفلاتر
                            </button>
                        </div>
                    </div>

                    <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
                        
                        {/* Filters Sidebar (Masterstroke UI) */}
                        <aside id="search-filters" className={`${filtersOpen ? 'block' : 'hidden'} min-w-0 border-b border-slate-200 py-6 lg:block lg:border-none lg:py-0`}>
                            <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
                                <div className="mb-6 flex items-center justify-between">
                                    <h3 className="text-lg font-black text-slate-900">تصفية النتائج</h3>
                                    <button type="button" onClick={clearFilters} className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700">
                                        <RotateCcw size={14} /> إعادة ضبط
                                    </button>
                                </div>
                                <div className="space-y-8 text-sm">
                                    
                                    <div className="space-y-3">
                                        <label className="block text-sm font-bold text-slate-700">الحد الأعلى للسعر ({SEARCH_CURRENCY})</label>
                                        <input type="number" min="0" inputMode="decimal" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-slate-200 p-3.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-300 bg-slate-50" />
                                    </div>

                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <div className={`relative flex h-6 w-11 items-center rounded-full transition-colors ${freeCancellation ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                            <input type="checkbox" className="peer sr-only" checked={freeCancellation} onChange={event => setFreeCancellation(event.target.checked)} />
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${freeCancellation ? 'translate-x-1' : '-translate-x-6'}`} />
                                        </div>
                                        <span className="text-sm font-bold text-slate-700 group-hover:text-blue-700 transition-colors">إلغاء مجاني فقط</span>
                                    </label>

                                    <div className="border-t border-slate-100 pt-6">
                                        <p className="mb-4 text-sm font-bold text-slate-700">التصنيف الأدنى (نجوم)</p>
                                        <div className="flex gap-2">
                                            {[3, 4, 5].map((star) => (
                                                <button type="button" aria-pressed={starFilter === star} onClick={() => setStarFilter(starFilter === star ? 0 : star)} key={star} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border p-2.5 text-sm font-black transition-all ${starFilter === star ? 'border-amber-400 bg-amber-50 text-amber-800 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:text-amber-700'}`}>
                                                    {star} <StarIcon size={14} className={starFilter === star ? 'text-amber-500' : 'text-slate-300'} fill="currentColor" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="border-t border-slate-100 pt-6">
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <div className="relative flex items-center justify-center">
                                                <input type="checkbox" checked={amenityFilter} onChange={(event) => setAmenityFilter(event.target.checked)} className="peer sr-only" />
                                                <div className={`h-5 w-5 rounded border-2 transition-colors ${amenityFilter ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white group-hover:border-blue-500'}`}></div>
                                                <Check size={14} className={`absolute text-white transition-opacity ${amenityFilter ? 'opacity-100' : 'opacity-0'}`} strokeWidth={3} />
                                            </div>
                                            <span className="text-sm font-bold text-slate-700 group-hover:text-blue-700 transition-colors">يحتوي على مزايا للغرفة</span>
                                        </label>
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
                                        <p className="text-[11px] font-black uppercase tracking-wider text-emerald-600">أرخص خيار مطابق لبحثك</p>
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
                                            عرض المزيد ({visibleHotels.length - limit} فندق)
                                        </button>
                                    )}
                                </div>
                            ) : searched ? (
                                <div className="rounded-3xl bg-white p-20 text-center shadow-sm border border-slate-100">
                                    <MapPin size={48} className="mx-auto text-slate-300 mb-4" />
                                    <p className="font-black text-xl text-slate-700">لا توجد نتائج مطابقة</p>
                                    <p className="mt-2 text-slate-500 font-medium">جرّب إزالة بعض الفلاتر أو تغيير تواريخ البحث.</p>
                                </div>
                            ) : (
                                <div className="rounded-3xl bg-white p-20 text-center shadow-sm border border-slate-100">
                                    <Search size={48} className="mx-auto text-slate-300 mb-4" />
                                    <p className="font-black text-xl text-slate-700">مستعد لرحلتك القادمة؟</p>
                                    <p className="mt-2 text-slate-500 font-medium">اختر وجهة وتواريخ لعرض العروض الحية.</p>
                                </div>
                            )}

                            <div id="security" className="mt-12 flex items-start gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                                <ShieldCheck size={28} className="shrink-0 text-emerald-600 mt-1" />
                                <div>
                                    <p className="font-black text-slate-900 text-lg">الأسعار والتوفر يخضعان للتحقق المباشر</p>
                                    <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                                        تأكيد الدفع لا يعني تأكيد الحجز فوراً؛ يرجى الانتظار حتى يصلك مرجع التأكيد النهائي من المورد الخاص بنا لضمان إقامتك.
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
                        <a href="mailto:management@remaltourismllc.com" className="hover:text-blue-600 transition-colors">المساعدة والتواصل</a>
                        <a href="/#security" className="hover:text-blue-600 transition-colors">معلومات الحجز</a>
                    </div>
                    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-1.5 rounded-full bg-slate-50 px-4 py-2 text-slate-700 hover:bg-slate-100 transition-colors">
                        العودة للأعلى <ChevronLeft size={16} className="rotate-90" />
                    </button>
                </div>
            </footer>
        </div>
    );
}
