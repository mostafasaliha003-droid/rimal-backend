import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BedDouble, Check, ChevronLeft, LoaderCircle, MapPin, ShieldCheck, Star } from 'lucide-react';
import HotelRoomCard from './components/HotelRoomCard';
import BookingAPI from './services/bookingApi';

const DEFAULT_HOTEL_IMAGE = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80';

const getPrice = (rate) => rate?.payment_options?.payment_types?.[0]?.amount || rate?.price || '-';
const getCurrency = (rate) => rate?.payment_options?.payment_types?.[0]?.currency_code || rate?.currency || 'USD';
const getHash = (rate) => rate?.book_hash || rate?.match_hash;
const getAmenities = (rate) => Array.isArray(rate?.amenities) ? rate.amenities : (Array.isArray(rate?.room_amenities) ? rate.room_amenities : []);
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
    return images.length ? images : [DEFAULT_HOTEL_IMAGE];
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

export default function HotelDetails({ hid, onBack }) {
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
                    language: 'en',
                    currency: 'USD'
                })
            ]);
            if (!active) return;

            const staticHotel = staticResult.status === 'fulfilled' ? staticResult.value?.hotel : null;
            const liveData = liveResult.status === 'fulfilled' ? liveResult.value : null;
            const liveHotel = liveData?.hotel || liveData?.hotels?.[0] || {};
            const liveRates = liveData?.rates || liveHotel.rates || [];
            if (!staticHotel && !liveData) {
                setError('تعذر تحميل تفاصيل الفندق، يرجى المحاولة مرة أخرى');
            } else {
                setHotel({ ...staticHotel, ...liveHotel, hid, images: toImages({ ...staticHotel, ...liveHotel }) });
                setRates(Array.isArray(liveRates) ? liveRates : []);
            }
            setLoading(false);
        };
        fetchHotelDetails();
        return () => { active = false; };
    }, [hid, searchParams.checkin, searchParams.checkout, JSON.stringify(searchParams.guests)]);

    const rooms = rates.map((rate) => ({
        name: rate.room_name || rate.name || 'Standard Room',
        bed: rate.room_info?.bed || rate.bedding || rate.bed,
        price: getPrice(rate),
        currency: getCurrency(rate),
        book_hash: getHash(rate),
        adults: rate.rooms?.[0]?.adults || searchParams.guests?.[0]?.adults || 2,
        amenities: getAmenities(rate),
        cancellation: rate.payment_options?.payment_types?.[0]?.cancellation_penalties?.free_cancellation_before,
        hotel
    }));

    const navigateToCheckout = (room) => {
        const booking = {
            hid,
            hotelName: hotel?.name || 'Hotel',
            checkin: searchParams.checkin,
            checkout: searchParams.checkout,
            room
        };
        sessionStorage.setItem('remal_checkout', JSON.stringify(booking));
        window.history.pushState({ checkout: booking }, '', '/checkout');
        window.dispatchEvent(new PopStateEvent('popstate'));
    };

    if (loading) return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10"><div className="mx-auto max-w-7xl"><LoadingSkeleton /></div></main>;
    if (error) return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10"><div className="mx-auto max-w-3xl rounded-2xl bg-red-50 p-8 text-center font-bold text-remal-red"><p>{error}</p><button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-sm text-white"><ArrowRight size={16} /> العودة للنتائج</button></div></main>;

    return <main className="min-h-screen bg-remal-bg px-5 py-8 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-7">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-black text-remal-blue"><ArrowRight size={17} /> العودة للنتائج</button>
            <section className="grid gap-3 overflow-hidden rounded-3xl lg:grid-cols-[1.4fr_0.8fr] lg:grid-rows-2">
                <img src={images[0] || DEFAULT_HOTEL_IMAGE} alt={hotel?.name || 'Hotel'} className="h-72 w-full object-cover lg:row-span-2 lg:h-full" />
                <div className="grid grid-cols-2 gap-3">{images.slice(1, 3).map((image) => <img key={image} src={image} alt={hotel?.name || 'Hotel'} className="h-36 w-full object-cover lg:h-full" />)}</div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <article className="rounded-2xl bg-white p-6 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm font-black text-remal-gold"><span className="inline-flex items-center gap-1"><Star size={16} fill="currentColor" /> {hotel?.stars || hotel?.star_rating || 'Hotel'}</span><span className="text-slate-300">|</span><span className="inline-flex items-center gap-1 text-slate-400"><MapPin size={15} /> {hotel?.city || 'Dubai'}</span></div>
                    <h1 className="text-3xl font-black text-remal-dark">{hotel?.name || 'Hotel'}</h1>
                    <p className="mt-4 leading-8 text-slate-500">{hotel?.description || hotel?.staticData?.description || 'استمتع بإقامة مريحة مع غرف مختارة بعناية وخدمة موثوقة.'}</p>
                    <div className="mt-6 flex flex-wrap gap-2">{(hotel?.amenities || hotel?.staticData?.amenities || ['واي فاي مجاني', 'استقبال على مدار الساعة']).slice(0, 6).map((amenity) => <span key={String(amenity)} className="rounded-full bg-remal-bg px-3 py-2 text-xs font-bold text-slate-600">{typeof amenity === 'string' ? amenity : amenity.name || amenity.title}</span>)}</div>
                </article>
                <aside className="rounded-2xl bg-remal-dark p-6 text-white shadow-sm"><p className="text-xs font-bold text-white/60">ملخص الإقامة</p><p className="mt-3 text-2xl font-black">{rooms.length ? `${rooms.length} غرف متاحة` : 'لا توجد غرف متاحة'}</p><p className="mt-2 text-sm font-bold text-white/60">{searchParams.checkin || 'تاريخ الوصول'} إلى {searchParams.checkout || 'تاريخ المغادرة'}</p><div className="mt-6 flex items-center gap-2 text-sm font-bold text-emerald-300"><ShieldCheck size={18} /> حجز آمن وأسعار مباشرة</div></aside>
            </section>

            <section className="space-y-4"><div><h2 className="text-2xl font-black">الغرف المتاحة</h2><p className="mt-1 text-sm font-bold text-slate-400">اختر الغرفة المناسبة ثم ثبّت السعر قبل الدفع</p></div>{rooms.length ? rooms.map((room, index) => <HotelRoomCard key={room.book_hash || index} room={room} onBook={() => navigateToCheckout(room)} />) : <div className="rounded-2xl bg-white p-10 text-center"><BedDouble className="mx-auto text-slate-300" size={36} /><p className="mt-3 font-black text-slate-500">لا توجد غرف متاحة لهذه التواريخ</p><p className="mt-2 text-sm text-slate-400">جرّب تغيير تاريخ الوصول أو المغادرة.</p></div>}</section>
        </div>
    </main>;
}
