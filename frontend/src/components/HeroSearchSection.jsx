import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, LoaderCircle, Sparkles } from 'lucide-react';
import DatePicker from 'react-datepicker';
import { format } from 'date-fns';
import 'react-datepicker/dist/react-datepicker.css';
import BookingAPI from '../services/bookingApi';
import { CalendarIcon, PinIcon, UsersIcon } from './Icons';

export default function HeroSearchSection({ onSearch }) {
    const [query, setQuery] = useState('');
    const [selectedDestination, setSelectedDestination] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checkinDate, setCheckinDate] = useState(null);
    const [checkoutDate, setCheckoutDate] = useState(null);
    const blurTimer = useRef(null);

    useEffect(() => {
        const value = query.trim();
        if (value.length < 2) {
            setSuggestions([]);
            return undefined;
        }
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const data = await BookingAPI.suggest(value);
                const payload = data?.data || data;
                const suggestionData = Array.isArray(payload)
                    ? { regions: payload }
                    : (Array.isArray(payload?.suggestions) ? { regions: payload.suggestions } : (payload?.suggestions || payload));
                const hotels = Array.isArray(suggestionData?.hotels) ? suggestionData.hotels : [];
                const regions = Array.isArray(suggestionData?.regions) ? suggestionData.regions : [];
                const getLabel = (item) => item.name?.content || item.name?.value || item.name || item.title || item.label || value;
                const getHotelId = (item) => {
                    const hotelId = Number(item.hid ?? item.hotel_id);
                    return Number.isInteger(hotelId) && hotelId >= 0 && hotelId <= 0xFFFFFFFF
                        ? hotelId
                        : null;
                };
                const nextSuggestions = [
                    ...regions.slice(0, 5).map((item) => ({ label: getLabel(item), hint: 'وجهة سفر', type: 'region', region_id: item.id || item.region_id })),
                    ...hotels.slice(0, 5).map((item) => {
                        const hotelId = getHotelId(item);
                        return hotelId === null ? null : {
                            label: getLabel(item),
                            hint: 'فندق',
                            type: 'hotel',
                            hotel_id: hotelId,
                            hotel_key: item.id || hotelId
                        };
                    }).filter(Boolean)
                ].filter((item) => item.label && (item.region_id || item.hotel_id));
                setSuggestions(nextSuggestions);
                setShowSuggestions(nextSuggestions.length > 0);
            } catch {
                setSuggestions([]);
                setShowSuggestions(false);
            } finally {
                setLoading(false);
            }
        }, 280);
        return () => window.clearTimeout(timer);
    }, [query]);

    const handleSearch = (event) => {
        event.preventDefault();
        const form = event.currentTarget.tagName === 'FORM' ? event.currentTarget : event.currentTarget.form;
        if (!selectedDestination || (!selectedDestination.region_id && !selectedDestination.hotel_id)) {
            event.currentTarget.querySelector('input')?.focus();
            return;
        }
        if (!checkinDate || !checkoutDate) {
            form.checkin.focus();
            return;
        }
        if (checkoutDate <= checkinDate) {
            return;
        }
        const destination = selectedDestination;
        const search = {
            query,
            destination,
            checkin: format(checkinDate, 'yyyy-MM-dd'),
            checkout: format(checkoutDate, 'yyyy-MM-dd'),
            guests: [{ adults: Number(form.guests.value), children: [] }]
        };
        console.log('Search triggered with:', destination);
        onSearch?.(search);
    };

    return (
        <section className="relative isolate overflow-visible bg-slate-950 pb-24 pt-20 lg:pb-28 lg:pt-24">
            <div className="absolute inset-0 -z-10 bg-[url('https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=2200&q=85')] bg-cover bg-center" />
            <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(2,6,23,.96)_0%,rgba(2,6,23,.78)_48%,rgba(2,6,23,.18)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-slate-50 to-transparent" />

            <div className="mx-auto flex max-w-7xl flex-col px-5 lg:px-10">
                <div className="max-w-2xl text-right text-white">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-200/30 bg-amber-100/10 px-3 py-1.5 text-[11px] font-bold text-amber-200 backdrop-blur-sm">
                        <Sparkles size={14} /> عروض مختارة بعناية لك
                    </div>
                    <h1 className="max-w-xl text-4xl font-black leading-[1.18] tracking-normal sm:text-5xl lg:text-[3.6rem]">
                        عروض فنادق تخليك تفكر <span className="text-cyan-300">تسحب على الدوام!</span>
                    </h1>
                    <p className="mt-5 max-w-lg text-sm font-semibold leading-8 text-slate-200 sm:text-base">خلّ سفرتك تبدأ من المكان الصح. أسعار خاصة، فنادق أصدق، وتجربة حجز على مزاجك.</p>
                </div>

                <form onSubmit={handleSearch} className="relative mt-10 w-full lg:mt-12" dir="rtl">
                    <div className="flex flex-col divide-y divide-slate-200 rounded-[1.75rem] bg-white p-2 shadow-[0_20px_45px_-15px_rgba(2,6,23,0.35)] lg:flex-row lg:items-stretch lg:divide-y-0 lg:divide-x lg:divide-x-reverse lg:rounded-full">
                        <label className="relative z-40 flex min-h-[68px] flex-1 items-center gap-3 rounded-[1.4rem] px-5 transition-colors duration-200 hover:bg-slate-50 focus-within:bg-white focus-within:shadow-sm lg:rounded-full" htmlFor="destination-search">
                            <PinIcon className="shrink-0 text-slate-400" size={20} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">الوجهة</span>
                                <input id="destination-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedDestination(null); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} onBlur={() => { blurTimer.current = window.setTimeout(() => setShowSuggestions(false), 160); }} placeholder="ابحث عن وجهة أو فندق..." aria-autocomplete="list" aria-controls="destination-suggestions" className="w-full border-0 bg-transparent p-0 pt-1 text-sm font-black text-slate-900 outline-none ring-0 placeholder:font-medium placeholder:text-slate-400 focus:outline-none focus:ring-0" />
                            </span>
                            {loading && <LoaderCircle size={17} className="animate-spin text-slate-400" />}
                            {showSuggestions && query.trim().length > 1 && suggestions.length > 0 && <div id="destination-suggestions" role="listbox" aria-label="اقتراحات الوجهات" className="custom-scrollbar absolute inset-x-2 top-[76px] z-50 max-h-72 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 text-right shadow-lg lg:inset-x-0">
                                {suggestions.map((item, index) => <button type="button" key={`${item.label}-${index}`} onMouseDown={() => { setQuery(item.label); setSelectedDestination(item); setShowSuggestions(false); }} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-right transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"><span className="text-sm font-black text-slate-900">{item.label}</span><span className="shrink-0 text-[10px] font-bold text-slate-500">{item.hint}</span></button>)}
                            </div>}
                        </label>
                        <label className="relative flex min-h-[68px] flex-1 items-center gap-3 rounded-[1.4rem] px-5 transition-colors duration-200 hover:bg-slate-50 focus-within:bg-white focus-within:shadow-sm lg:rounded-full">
                            <CalendarIcon className="pointer-events-none shrink-0 text-slate-400" size={19} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">تسجيل الوصول</span>
                                <DatePicker
                                    selected={checkinDate}
                                    onChange={setCheckinDate}
                                    selectsStart
                                    startDate={checkinDate}
                                    endDate={checkoutDate}
                                    maxDate={checkoutDate || undefined}
                                    dateFormat="d MMM yyyy"
                                    placeholderText="أضف تاريخ"
                                    className="w-full border-none bg-transparent p-0 pt-1 text-right text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
                                    wrapperClassName="date-picker-shell"
                                    calendarClassName="premium-datepicker"
                                    popperClassName="premium-datepicker-popper"
                                    popperPlacement="bottom-start"
                                    name="checkin"
                                />
                            </span>
                        </label>
                        <label className="relative flex min-h-[68px] flex-1 items-center gap-3 rounded-[1.4rem] px-5 transition-colors duration-200 hover:bg-slate-50 focus-within:bg-white focus-within:shadow-sm lg:rounded-full">
                            <CalendarIcon className="pointer-events-none shrink-0 text-slate-400" size={19} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">تسجيل المغادرة</span>
                                <DatePicker
                                    selected={checkoutDate}
                                    onChange={setCheckoutDate}
                                    selectsEnd
                                    startDate={checkinDate}
                                    endDate={checkoutDate}
                                    minDate={checkinDate || undefined}
                                    dateFormat="d MMM yyyy"
                                    placeholderText="أضف تاريخ"
                                    className="w-full border-none bg-transparent p-0 pt-1 text-right text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
                                    wrapperClassName="date-picker-shell"
                                    calendarClassName="premium-datepicker"
                                    popperClassName="premium-datepicker-popper"
                                    popperPlacement="bottom-start"
                                    name="checkout"
                                />
                            </span>
                        </label>
                        <label className="flex min-h-[68px] flex-1 items-center gap-3 rounded-[1.4rem] px-5 transition-colors duration-200 hover:bg-slate-50 focus-within:bg-white focus-within:shadow-sm lg:rounded-full">
                            <UsersIcon className="shrink-0 text-slate-400" size={19} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">الضيوف</span>
                                <span className="relative">
                                    <select name="guests" defaultValue="2" className="w-full appearance-none border-0 bg-transparent p-0 pl-5 pt-1 text-sm font-black text-slate-900 outline-none ring-0 focus:outline-none focus:ring-0"><option value="1">ضيف واحد</option><option value="2">ضيفان</option><option value="3">3 ضيوف</option><option value="4">4 ضيوف</option></select>
                                    <ChevronDown size={14} className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-slate-400" />
                                </span>
                            </span>
                        </label>
                        <div className="p-1 lg:flex lg:items-center lg:py-1 lg:pl-1 lg:pr-2">
                            <button type="button" onClick={handleSearch} className="group flex min-h-[60px] w-full items-center justify-center gap-2 rounded-[1.4rem] bg-slate-900 px-7 text-sm font-black text-white shadow-lg shadow-slate-900/20 transition-colors duration-200 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 active:translate-y-px lg:w-auto lg:rounded-full"><span>ابحث الآن</span><ArrowLeft size={18} className="transition-transform group-hover:-translate-x-1" /></button>
                        </div>
                    </div>
                </form>
            </div>
        </section>
    );
}
