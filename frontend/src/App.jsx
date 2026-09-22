import { lazy, useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, LoaderCircle, RotateCcw, ShieldCheck, SlidersHorizontal, ImageOff } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelRoomCard from './components/HotelRoomCard';
const HotelDetails = lazy(() => import('./HotelDetails'));
const Checkout = lazy(() => import('./Checkout'));
import { StarIcon } from './components/Icons';
import BookingAPI from './services/bookingApi';
import { cheapestRate, rateAmount, rateCurrency, formatMoney, paymentFor } from './services/offers';
import { trackBookingEvent } from './services/analytics';

function storedSearch() {
    try { return JSON.parse(sessionStorage.getItem('remal_search') || 'null'); } catch { return null; }
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
            rates: (hotel.rates || []).filter(rate => rateCurrency(rate) === 'AED').sort((first, second) => rateAmount(first) - rateAmount(second)),
            stars: hotel.stars || hotel.star_rating || staticData.stars || staticData.star_rating || ''
        };
    });
};
const getRatePrice = (rate) => rate?.payment_options?.payment_types?.[0]?.amount || rate?.price || '-';
const getRateHash = (rate) => rate?.book_hash || rate?.match_hash;
const getAmenities = (rate) => Array.isArray(rate?.amenities) ? rate.amenities : (Array.isArray(rate?.room_amenities) ? rate.room_amenities : []);

function SerpResultCard({ hotel, onSelect }) {
    const rate = cheapestRate(hotel.rates) || {};
    const image = hotel.images?.[0];
    const [imageFailed, setImageFailed] = useState(false);
    return (
        <article aria-labelledby={`hotel-${hotel.hid || hotel.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_10px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
            <div className="grid min-w-0 gap-5 p-4 md:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_12rem]">
                <div className="flex h-44 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500">
                    {image && !imageFailed ? <img src={image} alt={hotel.name} loading="lazy" className="h-full w-full object-cover" onError={() => setImageFailed(true)} /> : <span className="flex items-center gap-2 text-sm"><ImageOff size={20} />الصورة غير متاحة</span>}
                </div>
                <div className="min-w-0 text-right">
                    {Number(hotel.stars) > 0 && <div className="mb-2 flex items-center gap-2 text-amber-700">{hotel.stars} <StarIcon size={13} fill="currentColor" /></div>}
                    <h3 id={`hotel-${hotel.hid || hotel.id}`} className="text-xl font-black text-remal-dark">{hotel.name || 'فندق'}</h3>
                    {hotel.city && <p className="mt-2 text-sm text-slate-600">{hotel.city}</p>}
                    <p className="mt-3 text-sm text-slate-600">{paymentFor(rate)?.cancellation_penalties?.free_cancellation_before ? 'يتوفر إلغاء مجاني قبل الموعد المحدد في العرض' : 'راجع شروط الإلغاء قبل اختيار الغرفة'}</p>
                    <div className="mt-4 flex flex-wrap justify-end gap-2 text-[11px] font-bold text-slate-500">
                        {getAmenities(rate).slice(0, 3).map((amenity) => <span key={String(amenity)} className="rounded-full bg-remal-bg px-3 py-1">{amenity}</span>)}
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 md:col-span-2 xl:col-span-1 xl:flex-col xl:items-stretch xl:justify-center xl:border-r xl:border-t-0 xl:pr-4">
                    <div className="text-right"><span className="text-xl font-bold text-remal-dark">{formatMoney(rateAmount(rate))}</span><p className="mt-1 text-xs text-slate-600">إجمالي الإقامة يبدأ من؛ قد تُطبق رسوم محلية</p></div>
                    <button type="button" onClick={() => onSelect(hotel)} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0F172A] to-[#1E293B] px-5 py-3 text-xs font-black text-white shadow-lg shadow-[#0F172A]/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#0F172A]/40"><span>تحديد الغرف</span><ArrowLeft size={16} /></button>
                </div>
            </div>
        </article>
    );
}

export default function App() {
    const [pathname, setPathname] = useState(() => window.location.pathname);
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
                const request = { checkin, checkout, guests, language: 'ar', currency: 'AED' };
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
                currency: 'AED'
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
            <TopNavigationBar />
            <Checkout
                booking={window.history.state?.checkout}
                onBack={() => {
                    window.history.back();
                }}
            />
        </>;
    }
    if (hotelRoute) {
        return <>
            <TopNavigationBar />
            <HotelDetails
                hid={decodeURIComponent(hotelRoute[1])}
                onBack={() => {
                    window.history.pushState({}, '', '/');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }}
            />
        </>;
    }

    return (
        <div className="min-h-screen bg-remal-bg text-remal-dark">
            <TopNavigationBar />
            <main>
                <HeroSearchSection onSearch={handleSearch} initialSearch={searchParams} />
                <section id="results-heading" className="mx-auto max-w-7xl scroll-mt-8 px-5 pb-20 pt-6 lg:px-10 lg:pt-0">
                    <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-remal-blue">{searched ? 'نتائج البحث' : 'اختيارات رمال'}</p>
                            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">فنادق تحسّها على كيفك</h2>
                            <p className="mt-2 text-sm font-bold text-slate-400">{searched ? `${visibleHotels.length} فندق متاح حسب بحثك` : 'ابدأ بوجهة وتاريخ واضحين لتحصل على أسعار حية'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3"><label className="text-sm">الترتيب <select value={sort} onChange={event => setSort(event.target.value)} className="rounded-lg border border-slate-300 p-2"><option value="recommended">ترتيب المورد</option><option value="price">الأقل سعراً</option><option value="stars">الأعلى تصنيفاً</option></select></label><button type="button" aria-controls="search-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm lg:hidden"><SlidersHorizontal size={16} /> الفلاتر</button></div>
                    </div>

                    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
                        <aside id="search-filters" className={`${filtersOpen ? 'block' : 'hidden'} min-w-0 border-b border-slate-200 py-5 lg:block`}>
                            <div className="mb-6 flex items-center justify-between"><h3 className="font-black">تصفية النتائج</h3><button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs font-bold text-remal-blue"><RotateCcw size={13} /> إعادة ضبط</button></div>
                            <div className="space-y-6 text-sm">
                                <label className="block">الحد الأعلى للإقامة بالدرهم<input type="number" min="0" inputMode="decimal" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 p-3" /></label>
                                <label className="flex items-center gap-2"><input type="checkbox" checked={freeCancellation} onChange={event => setFreeCancellation(event.target.checked)} />إلغاء مجاني في أقل عرض ظاهر</label>
                                <div className="border-t border-slate-100 pt-5"><p className="mb-3 font-black">التصنيف الأدنى</p><div className="flex gap-2">{[3, 4, 5].map((star) => <button type="button" aria-pressed={starFilter === star} onClick={() => setStarFilter(starFilter === star ? 0 : star)} key={star} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-black transition ${starFilter === star ? 'border-remal-gold bg-amber-50 text-amber-700' : 'border-slate-200 hover:border-remal-gold hover:text-amber-700'}`}>{star} <StarIcon size={12} className="text-remal-gold" fill="currentColor" /></button>)}</div></div>
                                <div className="border-t border-slate-100 pt-5"><label className="flex items-center gap-3 text-xs font-bold text-slate-500"><input type="checkbox" checked={amenityFilter} onChange={(event) => setAmenityFilter(event.target.checked)} className="h-4 w-4 accent-remal-blue" /> يحتوي على مزايا للغرفة</label></div>
                            </div>
                        </aside>

                        <div className="min-w-0 space-y-5">
                            {lowestHotel && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 py-4"><div className="min-w-0"><p className="text-sm text-slate-600">أقل إجمالي مطابق للفلاتر</p><p className="mt-1 break-words font-bold">{lowestHotel.name}</p></div><p className="text-lg font-bold text-emerald-800">{formatMoney(rateAmount(cheapestRate(lowestHotel.rates)))}</p></div>}
                            {selectedHotel ? <>
                                <button type="button" onClick={() => setSelectedHotel(null)} className="flex items-center gap-2 text-xs font-black text-remal-blue"><ChevronLeft size={16} /> العودة للنتائج</button>
                                <h2 className="text-2xl font-black">{selectedHotel.name}</h2>
                                {!hotelPage && !error && <div className="flex items-center justify-center rounded-2xl bg-white p-10"><LoaderCircle className="animate-spin text-remal-blue" /></div>}
                                {error && <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm font-bold text-remal-red">{error}</p>}
                                {rooms.map((room, index) => <HotelRoomCard key={room.book_hash || index} room={room} />)}
                            </> : loading ? <div role="status" className="flex items-center justify-center gap-3 bg-white p-12"><LoaderCircle className="animate-spin text-remal-blue" /><span>جار تحميل النتائج</span></div> : error ? <div role="alert" className="bg-red-50 p-5 text-sm text-remal-red"><p>{error}</p><button onClick={() => setSearchParams({ ...searchParams })} className="mt-3 underline">إعادة المحاولة</button></div> : visibleHotels.length ? visibleHotels.slice(0, limit).map((hotel) => <SerpResultCard key={hotel.id || hotel.hid} hotel={hotel} onSelect={openHotelDetails} />) : searched ? <p className="p-8 text-center text-sm text-slate-600">لا توجد نتائج مطابقة. جرّب إزالة الفلاتر أو تغيير التواريخ.</p> : <p className="p-8 text-center text-sm text-slate-600">اختر وجهة وتواريخ لعرض الأسعار الحية</p>}
                            {visibleHotels.length > limit && <button onClick={() => setLimit(limit + 20)} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white p-3">عرض المزيد ({visibleHotels.length - limit})</button>}
                            <div id="security" className="flex items-start gap-3 border-t border-slate-200 py-5"><ShieldCheck size={22} className="shrink-0 text-emerald-700" /><div><p className="font-bold">السعر والتوفر يخضعان للتحقق</p><p className="mt-1 text-sm leading-7 text-slate-600">تأكيد الدفع لا يعني تأكيد الحجز؛ انتظر مرجع التأكيد من المورد.</p></div></div>
                        </div>
                    </div>
                </section>
            </main>
            <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-7 text-sm text-slate-600"><span>© 2026 رمال وفِلّها</span><a href="mailto:management@remaltourismllc.com">المساعدة والتواصل</a><a href="/#security">معلومات التأكيد والدفع</a><button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-1 text-remal-blue">العودة للأعلى <ChevronLeft size={14} /></button></div></footer>
        </div>
    );
}
