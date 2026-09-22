import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, Heart, LoaderCircle, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelRoomCard from './components/HotelRoomCard';
import { StarIcon } from './components/Icons';
import BookingAPI from './services/bookingApi';

const DEFAULT_HOTEL_IMAGE = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80';

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
            images: [...new Set(images)],
            stars: hotel.stars || hotel.star_rating || staticData.stars || staticData.star_rating || ''
        };
    });
};
const getRatePrice = (rate) => rate?.payment_options?.payment_types?.[0]?.amount || rate?.price || '-';
const getRateHash = (rate) => rate?.book_hash || rate?.match_hash;
const getAmenities = (rate) => Array.isArray(rate?.amenities) ? rate.amenities : (Array.isArray(rate?.room_amenities) ? rate.room_amenities : []);

function SerpResultCard({ hotel, onSelect }) {
    const rate = hotel.rates?.[0] || {};
    const image = hotel.images?.[0] || hotel.image || DEFAULT_HOTEL_IMAGE;
    return (
        <article className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="h-44 shrink-0 overflow-hidden rounded-xl sm:w-56">
                    <img src={image} alt={hotel.name} className="h-full w-full object-cover" onError={(event) => { event.currentTarget.src = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'; }} />
                </div>
                <div className="min-w-0 text-right">
                    <div className="mb-2 flex items-center justify-end gap-2 text-remal-gold">{hotel.stars || 'فندق'} <StarIcon size={13} fill="currentColor" /></div>
                    <h3 className="text-xl font-black text-remal-dark">{hotel.name || 'فندق بدون اسم'}</h3>
                    <p className="mt-2 text-xs font-bold text-slate-400">{hotel.city || 'الوجهة المختارة'}</p>
                    <div className="mt-4 flex flex-wrap justify-end gap-2 text-[11px] font-bold text-slate-500">
                        {getAmenities(rate).slice(0, 3).map((amenity) => <span key={String(amenity)} className="rounded-full bg-remal-bg px-3 py-1">{amenity}</span>)}
                    </div>
                </div>
                <div className="flex items-center justify-between gap-5 border-t border-slate-100 pt-4 sm:border-t-0 sm:border-r sm:pr-5">
                    <div className="text-right"><span className="text-2xl font-black text-remal-dark">{getRatePrice(rate)}</span><span className="mr-1 text-xs font-black text-slate-400">USD</span><p className="mt-1 text-[10px] font-bold text-slate-400">السعر يبدأ من</p></div>
                    <button type="button" onClick={() => onSelect(hotel)} className="flex items-center gap-2 rounded-full bg-remal-red px-5 py-3 text-xs font-black text-white transition hover:bg-[#a10b0b]"><span>تحديد الغرف</span><ArrowLeft size={16} /></button>
                </div>
            </div>
        </article>
    );
}

export default function App() {
    const [searched, setSearched] = useState(false);
    const [saved, setSaved] = useState(false);
    const [searchParams, setSearchParams] = useState(null);
    const [hotels, setHotels] = useState([]);
    const [selectedHotel, setSelectedHotel] = useState(null);
    const [hotelPage, setHotelPage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSearch = (params) => {
        setSearchParams(params);
        setHotels([]);
        setSelectedHotel(null);
        setHotelPage(null);
        setSearched(true);
        window.history.pushState({}, '', '#search');
    };

    useEffect(() => {
        if (!searchParams) return undefined;
        let active = true;
        const loadResults = async () => {
            setLoading(true);
            setError('');
            try {
                const { destination, checkin, checkout, guests } = searchParams;
                const request = { checkin, checkout, guests, language: 'en', currency: 'USD' };
                const response = destination.type === 'hotel' || destination.hotel_id
                    ? await BookingAPI.searchByIds({ ...request, hids: [Number(destination.hotel_id)] })
                    : await BookingAPI.searchByRegion({ ...request, region_id: destination.region_id });
                console.log('Full API Response:', response);
                const nextHotels = getHotels(response);
                console.log('Hotels extracted for SERP:', nextHotels);
                if (active) {
                    setHotels(nextHotels);
                    setError('');
                }
            } catch (error) {
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
                language: 'en',
                currency: 'USD'
            });
            setHotelPage(response);
        } catch {
            setError('تعذر تحميل الغرف، يرجى تحديث الصفحة');
        }
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

    return (
        <div className="min-h-screen bg-remal-bg text-remal-dark">
            <TopNavigationBar />
            <main>
                <HeroSearchSection onSearch={handleSearch} />
                <section className="mx-auto max-w-7xl px-5 pb-20 pt-6 lg:px-10 lg:pt-0">
                    <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-remal-blue">{searched ? 'نتائج البحث' : 'اختيارات رمال'}</p>
                            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">فنادق تحسّها على كيفك</h2>
                            <p className="mt-2 text-sm font-bold text-slate-400">خيارات مرتبة بعناية عشان تلقى مكانك أسرع</p>
                        </div>
                        <button type="button" className="flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 transition hover:border-remal-blue hover:text-remal-blue"><SlidersHorizontal size={15} /> ترتيب وفلترة</button>
                    </div>

                    <div className="grid gap-8 lg:grid-cols-[1.1fr_2fr]">
                        <aside className="hidden rounded-3xl border border-slate-100 bg-white p-6 lg:block">
                            <div className="mb-6 flex items-center justify-between"><h3 className="font-black">اختياراتك</h3><button className="text-xs font-bold text-remal-blue">إعادة ضبط</button></div>
                            <div className="space-y-6 text-sm">
                                <div><div className="mb-3 flex justify-between font-black"><span>الميزانية</span><span className="text-remal-blue">AED 200 - 800</span></div><div className="relative h-1.5 rounded-full bg-slate-100"><div className="absolute inset-x-10 h-full rounded-full bg-remal-blue" /><span className="absolute right-9 -top-1.5 h-4 w-4 rounded-full border-2 border-remal-blue bg-white" /><span className="absolute left-9 -top-1.5 h-4 w-4 rounded-full border-2 border-remal-blue bg-white" /></div></div>
                                <div className="border-t border-slate-100 pt-5"><p className="mb-3 font-black">تصنيف الفندق</p><div className="flex gap-2">{[3, 4, 5].map((star) => <button key={star} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black transition hover:border-remal-gold hover:text-amber-700">{star} <StarIcon size={12} className="text-remal-gold" fill="currentColor" /></button>)}</div></div>
                                <div className="border-t border-slate-100 pt-5"><p className="mb-3 font-black">مزايا الإقامة</p>{['إلغاء مجاني', 'إفطار مشمول', 'واي فاي مجاني'].map((item) => <label key={item} className="mb-3 flex items-center gap-3 text-xs font-bold text-slate-500"><input type="checkbox" className="h-4 w-4 accent-remal-blue" /> {item}</label>)}</div>
                            </div>
                        </aside>

                        <div className="space-y-5">
                            <div className="flex items-center justify-between rounded-2xl bg-remal-dark px-5 py-4 text-white"><div><p className="text-xs font-bold text-white/60">اقتراح اليوم</p><p className="mt-1 text-sm font-black">فندق بارك حياة دبي</p></div><div className="flex items-center gap-2 text-sm font-black text-remal-gold">9.2 <StarIcon size={15} fill="currentColor" /></div></div>
                            {selectedHotel ? <>
                                <button type="button" onClick={() => setSelectedHotel(null)} className="flex items-center gap-2 text-xs font-black text-remal-blue"><ChevronLeft size={16} /> العودة للنتائج</button>
                                <h2 className="text-2xl font-black">{selectedHotel.name}</h2>
                                {!hotelPage && !error && <div className="flex items-center justify-center rounded-2xl bg-white p-10"><LoaderCircle className="animate-spin text-remal-blue" /></div>}
                                {error && <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm font-bold text-remal-red">{error}</p>}
                                {rooms.map((room, index) => <HotelRoomCard key={room.book_hash || index} room={room} />)}
                            </> : loading ? <div className="flex items-center justify-center rounded-2xl bg-white p-12"><LoaderCircle className="animate-spin text-remal-blue" /></div> : error ? <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm font-bold text-remal-red">{error}</p> : hotels.length ? hotels.map((hotel) => <SerpResultCard key={hotel.id || hotel.hid} hotel={hotel} onSelect={openHotel} />) : searched ? <p className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-400">لا توجد نتائج متاحة لهذه الوجهة</p> : <p className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-400">اختر وجهة وتواريخ لعرض الأسعار الحية</p>}
                            <div className="flex items-center justify-between rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600"><ShieldCheck size={20} /></div><div><p className="text-sm font-black">حجزك محمي معنا</p><p className="mt-1 text-[11px] font-bold text-slate-400">دفع آمن ودعم حقيقي وقت تحتاجه</p></div></div><button onClick={() => setSaved(!saved)} className={`rounded-full p-2.5 transition ${saved ? 'bg-remal-red text-white' : 'bg-slate-100 text-slate-400 hover:text-remal-red'}`} aria-label="حفظ الفندق"><Heart size={18} fill={saved ? 'currentColor' : 'none'} /></button></div>
                        </div>
                    </div>
                </section>
            </main>
            <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs font-bold text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-10"><span>© 2026 رمال وفِلّها</span><div className="flex gap-5"><a href="#">مساعدة</a><a href="#">الشروط والأحكام</a><a href="#">تواصل معنا</a></div><button className="flex items-center gap-1 text-remal-blue">العودة للأعلى <ChevronLeft size={14} /></button></div></footer>
        </div>
    );
}
