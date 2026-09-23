import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BedDouble, MapPin, ShieldCheck, Star } from 'lucide-react';
import HotelRoomCard from './components/HotelRoomCard';
import BookingAPI from './services/bookingApi';
import { SEARCH_CURRENCY, normalizeRoom } from './services/offers';
import { trackBookingEvent } from './services/analytics';

const formatImageUrl = (value) => {
    const raw = typeof value === 'string' ? value : value?.url || value?.src || '';
    if (!raw.trim()) return '';
    const image = raw.trim().replace(/\{size\}/gi, '1024x768');
    if (image.startsWith('//')) return `https:${image}`;
    if (/^https?:\/\//i.test(image)) return image;
    return `https://cdn.worldota.net/2048x1536/${image.replace(/^\/+/, '')}`;
};

const toImages = (hotel = {}) => {
    const staticData = hotel.staticData || {};
    const values = [
        ...(Array.isArray(hotel.images) ? hotel.images : []),
        hotel.image,
        ...(Array.isArray(staticData.images) ? staticData.images : []),
        staticData.image
    ];
    const images = [...new Set(values.map(formatImageUrl).filter(Boolean))];
    return images;
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
    return <div className="space-y-6 animate-pulse" aria-label="جار تحميل تفاصيل الفندق">
        <div className="h-72 rounded-3xl bg-slate-200" />
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-3 rounded-2xl bg-white p-6"><div className="h-8 w-2/3 rounded bg-slate-200" /><div className="h-4 w-full rounded bg-slate-100" /><div className="h-4 w-5/6 rounded bg-slate-100" /></div>
            <div className="h-44 rounded-2xl bg-slate-200" />
        </div>
    </div>;
}

export default function HotelDetails({ hid, onBack, displayCurrency, displayRates }) {
    const [hotel, setHotel] = useState(null);
    const [rates, setRates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const searchParams = useMemo(readSearchParams, []);
    const images = toImages(hotel || {});

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
                    language: 'ar',
                    currency: SEARCH_CURRENCY
                })
            ]);
            if (!active) return;

            const staticHotel = staticResult.status === 'fulfilled' ? staticResult.value?.hotel : null;
            const liveData = liveResult.status === 'fulfilled' ? liveResult.value : null;
            const liveHotel = liveData?.hotel || liveData?.hotels?.[0] || {};
            const liveRates = liveData?.rates || liveHotel.rates || [];
            if (liveResult.status === 'rejected' || (!staticHotel && !liveData)) {
                setError('تعذر تحميل الأسعار الحالية، يرجى العودة للبحث والمحاولة مرة أخرى');
            } else {
                setHotel({ ...staticHotel, ...liveHotel, hid, images: toImages({ ...staticHotel, ...liveHotel }) });
                setRates(Array.isArray(liveRates) ? liveRates : []);
            }
            setLoading(false);
        };
        fetchHotelDetails();
        return () => { active = false; };
    }, [hid, searchParams.checkin, searchParams.checkout, JSON.stringify(searchParams.guests)]);

    const rooms = rates.map(rate => normalizeRoom(rate, hotel, searchParams.guests));

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

    if (loading) return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10"><div className="mx-auto max-w-7xl"><LoadingSkeleton /></div></main>;
    if (error) return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10"><div className="mx-auto max-w-3xl rounded-2xl bg-red-50 p-8 text-center font-bold text-remal-red"><p>{error}</p><button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-sm text-white"><ArrowRight size={16} /> العودة للنتائج</button></div></main>;

    return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-7">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-black text-remal-blue"><ArrowRight size={17} /> العودة للنتائج</button>
            <section className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr] lg:grid-rows-2">
                <div className="overflow-hidden rounded-3xl shadow-lg lg:row-span-2">
                    {images[0] ? <img src={images[0]} alt={hotel?.name || 'الفندق'} className="h-72 w-full object-cover lg:h-full" /> : <div className="flex h-48 items-center justify-center bg-slate-100 text-slate-600">لا توجد صورة موثقة للفندق</div>}
                </div>
                <div className="grid grid-cols-2 gap-3">{images.slice(1, 3).map((image) => <div key={image} className="overflow-hidden rounded-3xl shadow-lg"><img src={image} alt={hotel?.name || 'Hotel'} className="h-36 w-full object-cover transition duration-500 hover:scale-105 lg:h-full" /></div>)}</div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <article className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm font-bold text-amber-700">{Number(hotel?.stars || hotel?.star_rating) > 0 && <span className="inline-flex items-center gap-1"><Star size={16} />{hotel.stars || hotel.star_rating}</span>}{hotel?.city && <span className="inline-flex items-center gap-1 text-slate-600"><MapPin size={15} />{hotel.city}</span>}</div>
                    <h1 className="text-3xl font-black text-remal-dark">{hotel?.name || 'Hotel'}</h1>
                    {typeof hotel?.description === 'string' && <p className="mt-4 leading-8 text-slate-600">{hotel.description}</p>}
                    <div className="mt-6 flex flex-wrap gap-2">{(hotel?.amenities || hotel?.staticData?.amenities || []).slice(0, 6).map((amenity) => <span key={String(amenity)} className="rounded-lg bg-remal-bg px-3 py-2 text-xs font-bold text-slate-600">{typeof amenity === 'string' ? amenity : amenity.name || amenity.title}</span>)}</div>
                </article>
                <aside className="rounded-lg bg-remal-dark p-6 text-white"><p className="text-sm text-white/80">ملخص الإقامة</p><p className="mt-3 text-2xl font-bold">{rooms.length ? `${rooms.length} عروض إقامة` : 'لا توجد عروض متاحة'}</p><p className="mt-2 text-sm text-white/80">{searchParams.checkin || 'تاريخ الوصول'} إلى {searchParams.checkout || 'تاريخ المغادرة'}</p><div className="mt-6 flex items-center gap-2 text-sm text-emerald-200"><ShieldCheck size={18} /> التحقق من العرض قبل الدفع</div></aside>
            </section>

            <section className="space-y-4"><div><h2 className="text-2xl font-bold">عروض الإقامة</h2><p className="mt-1 text-sm text-slate-600">سيُعاد التحقق من السعر والتوفر قبل الدفع</p></div>{rooms.length ? rooms.map((room, index) => <HotelRoomCard key={room.book_hash || index} room={room} onBook={navigateToCheckout} displayCurrency={displayCurrency} displayRates={displayRates} />) : <div className="bg-white p-10 text-center"><BedDouble className="mx-auto text-slate-500" size={36} /><p className="mt-3 font-bold text-slate-600">لا توجد عروض متاحة لهذه التواريخ</p><button onClick={onBack} className="mt-3 underline">تغيير البحث</button></div>}</section>
        </div>
    </main>;
}
