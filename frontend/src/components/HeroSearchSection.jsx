import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, Sparkles } from 'lucide-react';
import BookingAPI from '../services/bookingApi';
import { CalendarIcon, PinIcon, UsersIcon } from './Icons';

export default function HeroSearchSection({ onSearch }) {
    const [query, setQuery] = useState('');
    const [selectedDestination, setSelectedDestination] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [loading, setLoading] = useState(false);
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
        if (!form.checkin.value || !form.checkout.value) {
            form.checkin.focus();
            form.checkin.focus();
            return;
        }
        if (form.checkout.value <= form.checkin.value) {
            form.checkout.setCustomValidity('يجب أن يكون تاريخ المغادرة بعد الوصول');
            form.checkout.reportValidity();
            form.checkout.focus();
            return;
        }
        const destination = selectedDestination;
        const search = {
            query,
            destination,
            checkin: form.checkin.value,
            checkout: form.checkout.value,
            guests: [{ adults: Number(form.guests.value), children: [] }]
        };
        console.log('Search triggered with:', destination);
        onSearch?.(search);
    };

    return (
        <section className="relative isolate min-h-[640px] overflow-visible bg-remal-dark">
            <div className="absolute inset-0 -z-10 bg-[url('https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=2200&q=85')] bg-cover bg-center" />
            <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(17,35,49,.96)_0%,rgba(17,35,49,.68)_45%,rgba(17,35,49,.26)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 -z-10 h-36 bg-gradient-to-t from-remal-bg to-transparent" />

            <div className="mx-auto flex max-w-7xl flex-col px-5 pb-28 pt-20 lg:px-10 lg:pt-28">
                <div className="max-w-2xl text-right text-white">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-remal-gold/30 bg-remal-gold/10 px-3 py-1.5 text-[11px] font-bold text-remal-gold backdrop-blur-sm">
                        <Sparkles size={14} /> عروض مختارة بعناية لك
                    </div>
                    <h1 className="max-w-xl text-4xl font-black leading-[1.18] tracking-tight sm:text-5xl lg:text-[4.2rem]">
                        عروض فنادق تخليك تفكر <span className="text-remal-blue">تسحب على الدوام!</span>
                    </h1>
                    <p className="mt-6 max-w-lg text-sm leading-8 text-white/70 sm:text-base">خلّ سفرتك تبدأ من المكان الصح. أسعار خاصة، فنادق أصدق، وتجربة حجز على مزاجك.</p>
                </div>

                <form onSubmit={handleSearch} className="relative mt-16 rounded-[28px] border border-white/70 bg-white/95 p-2 shadow-float backdrop-blur-xl lg:mt-20 lg:rounded-full lg:p-2.5">
                    <div className="grid gap-1 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-center">
                        <label className="relative z-40 flex min-h-[66px] items-center gap-3 rounded-full px-5 transition hover:bg-remal-bg" htmlFor="destination-search">
                            <PinIcon className="shrink-0 text-remal-blue" size={22} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">الوجهة</span>
                                <input id="destination-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedDestination(null); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} onBlur={() => { blurTimer.current = window.setTimeout(() => setShowSuggestions(false), 160); }} placeholder="إلى أين تذهب؟" aria-autocomplete="list" aria-controls="destination-suggestions" className="w-full bg-transparent pt-1 text-sm font-black text-remal-dark outline-none placeholder:text-slate-400" />
                            </span>
                            {loading && <LoaderCircle size={17} className="animate-spin text-remal-blue" />}
                            {showSuggestions && query.trim().length > 1 && suggestions.length > 0 && <div id="destination-suggestions" role="listbox" aria-label="اقتراحات الوجهات" className="absolute inset-x-3 top-[74px] z-50 max-h-72 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 text-right shadow-xl lg:top-[78px]">
                                {suggestions.map((item, index) => <button type="button" key={`${item.label}-${index}`} onMouseDown={() => { setQuery(item.label); setSelectedDestination(item); setShowSuggestions(false); }} className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-right transition hover:bg-remal-bg"><span className="text-sm font-black text-remal-dark">{item.label}</span><span className="text-[10px] font-bold text-slate-400">{item.hint}</span></button>)}
                            </div>}
                        </label>
                        <div className="hidden h-10 w-px bg-slate-200 lg:block" />
                        <label className="flex min-h-[66px] items-center gap-3 rounded-full px-5 transition hover:bg-remal-bg">
                            <CalendarIcon className="shrink-0 text-remal-blue" size={21} />
                            <span className="flex flex-col text-right"><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">تسجيل الوصول</span><input name="checkin" type="date" required className="bg-transparent pt-1 text-sm font-black text-remal-dark outline-none" /></span>
                        </label>
                        <label className="flex min-h-[66px] items-center gap-3 rounded-full px-5 transition hover:bg-remal-bg">
                            <CalendarIcon className="shrink-0 text-remal-blue" size={21} />
                            <span className="flex flex-col text-right"><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">تسجيل المغادرة</span><input name="checkout" type="date" required className="bg-transparent pt-1 text-sm font-black text-remal-dark outline-none" /></span>
                        </label>
                        <label className="flex min-h-[66px] items-center gap-3 rounded-full px-5 transition hover:bg-remal-bg">
                            <UsersIcon className="shrink-0 text-remal-blue" size={21} />
                            <span className="flex flex-col text-right"><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">الضيوف</span><select name="guests" defaultValue="2" className="bg-transparent pt-1 text-sm font-black text-remal-dark outline-none"><option value="1">ضيف واحد</option><option value="2">ضيفان</option><option value="3">3 ضيوف</option><option value="4">4 ضيوف</option></select></span>
                        </label>
                        <button type="button" onClick={handleSearch} className="group flex min-h-[62px] items-center justify-center gap-2 rounded-full bg-remal-red px-7 text-sm font-black text-white shadow-luxe transition hover:-translate-y-0.5 hover:bg-[#a10b0b] active:translate-y-0"><span>ابحث الآن</span><ArrowLeft size={18} className="transition group-hover:-translate-x-1" /></button>
                    </div>
                </form>
            </div>
        </section>
    );
}
