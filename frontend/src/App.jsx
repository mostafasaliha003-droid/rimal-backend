import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, LoaderCircle } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelRoomCard from './components/HotelRoomCard';
import SerpResultCard from './components/SerpResultCard';
import BookingAPI from './services/bookingApi';

const searchPayload = (search) => ({
    checkin: search.checkin,
    checkout: search.checkout,
    guests: search.guests,
    residency: 'ae',
    language: 'en',
    currency: 'USD'
});

function Layout({ children }) {
    return <div className="min-h-screen bg-remal-bg text-remal-dark"><TopNavigationBar /><main>{children}</main><footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-7 text-xs font-bold text-slate-400 lg:px-10"><span>© 2026 رمال وفِلّها</span><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-1 text-remal-blue">العودة للأعلى <ChevronLeft size={14} /></button></div></footer></div>;
}

function Home() {
    const navigate = useNavigate();
    return <Layout><HeroSearchSection onSearch={(search) => navigate('/search', { state: { search } })} /></Layout>;
}

function SearchResults() {
    const { state } = useLocation();
    const navigate = useNavigate();
    const search = state?.search;
    const [hotels, setHotels] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(Boolean(search));

    useEffect(() => {
        if (!search) return;
        let active = true;
        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const destination = search.destination || {};
                const result = destination.regionId
                    ? await BookingAPI.searchByRegion({ ...searchPayload(search), region_id: destination.regionId })
                    : destination.hotelId
                        ? await BookingAPI.searchByIds({ ...searchPayload(search), hids: [destination.hotelId] })
                        : null;
                if (!result) throw new Error('يرجى اختيار وجهة من الاقتراحات.');
                if (active) setHotels(result.hotels || result.data?.hotels || []);
            } catch (requestError) {
                if (active) setError(requestError.response?.data?.message || requestError.message || 'تعذر جلب الفنادق.');
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [search]);

    if (!search) return <Layout><section className="mx-auto max-w-7xl px-5 py-20 text-center"><p className="font-bold text-slate-500">ابدأ البحث من الصفحة الرئيسية.</p><button type="button" onClick={() => navigate('/')} className="mt-5 rounded-full bg-remal-red px-5 py-3 text-sm font-black text-white">العودة للرئيسية</button></section></Layout>;

    return <Layout><section className="mx-auto max-w-5xl px-5 py-12 lg:px-10"><h1 className="text-3xl font-black">نتائج البحث</h1><p className="mt-2 text-sm font-bold text-slate-400">{search.destination?.label} · {search.checkin} إلى {search.checkout}</p>{loading && <div className="flex justify-center py-16 text-remal-blue"><LoaderCircle className="animate-spin" /></div>}{error && <p role="alert" className="mt-8 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}{!loading && !error && <div className="mt-8 space-y-4">{hotels.length ? hotels.map((hotel, index) => <SerpResultCard key={hotel.hid || hotel.id || index} hotel={hotel} onSelect={(selectedHotel) => navigate(`/hotel/${selectedHotel.hid || selectedHotel.id}`, { state: { search, hotel: selectedHotel } })} />) : <p className="rounded-xl bg-white p-6 text-sm font-bold text-slate-500">لا توجد فنادق متاحة لهذه الوجهة.</p>}</div>}</section></Layout>;
}

function HotelPage() {
    const { hotelId } = useParams();
    const { state } = useLocation();
    const navigate = useNavigate();
    const search = state?.search;
    const [hotel, setHotel] = useState(state?.hotel || null);
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(Boolean(search));
    const [error, setError] = useState('');
    const [bookingMessage, setBookingMessage] = useState('');

    useEffect(() => {
        if (!search) return;
        let active = true;
        const load = async () => {
            setLoading(true);
            try {
                const result = await BookingAPI.getHotelPage({ ...searchPayload(search), hid: hotelId });
                if (!active) return;
                setHotel(result.hotel || state?.hotel);
                setRooms(result.hotel?.rates || result.rates || []);
            } catch (requestError) {
                if (active) setError(requestError.response?.data?.message || 'تعذر جلب الغرف المتاحة.');
            } finally {
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
    }, [hotelId, search, state?.hotel]);

    const book = async (room) => {
        const bookHash = room.book_hash || room.bookHash;
        if (!bookHash) return setBookingMessage('تعذر تحديد سعر هذه الغرفة.');
        setBookingMessage('');
        try {
            const result = await BookingAPI.prebook(bookHash, 2);
            setBookingMessage(result.success === false ? 'تعذر تأكيد الغرفة.' : 'تم تأكيد السعر والتوفر بنجاح. يمكنك المتابعة إلى الدفع.');
        } catch (requestError) {
            setBookingMessage(requestError.response?.status === 409
                ? 'عذراً، لقد تغير السعر أو التوفر، يرجى تحديث الصفحة'
                : requestError.response?.data?.message || 'تعذر تأكيد الغرفة، يرجى المحاولة لاحقاً.');
        }
    };

    if (!search) return <Layout><section className="mx-auto max-w-5xl px-5 py-20 text-center"><p className="font-bold text-slate-500">لا توجد بيانات بحث لهذه الصفحة.</p><button type="button" onClick={() => navigate('/')} className="mt-5 rounded-full bg-remal-red px-5 py-3 text-sm font-black text-white">ابدأ بحثاً جديداً</button></section></Layout>;

    return <Layout><section className="mx-auto max-w-5xl px-5 py-12 lg:px-10"><button type="button" onClick={() => navigate(-1)} className="text-sm font-black text-remal-blue">العودة للنتائج</button><h1 className="mt-5 text-3xl font-black">{hotel?.name || hotel?.hotel_name || `فندق ${hotelId}`}</h1>{loading && <div className="flex justify-center py-16 text-remal-blue"><LoaderCircle className="animate-spin" /></div>}{error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}{bookingMessage && <p role="alert" className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{bookingMessage}</p>}{!loading && !error && <div className="mt-8 space-y-5">{rooms.length ? rooms.map((room, index) => <HotelRoomCard key={room.book_hash || room.match_hash || index} room={room} onBook={() => book(room)} />) : <p className="rounded-xl bg-white p-6 text-sm font-bold text-slate-500">لا توجد غرف متاحة حالياً.</p>}</div>}</section></Layout>;
}

export default function App() {
    return <BrowserRouter><Routes><Route path="/" element={<Home />} /><Route path="/search" element={<SearchResults />} /><Route path="/hotel/:hotelId" element={<HotelPage />} /></Routes></BrowserRouter>;
}
