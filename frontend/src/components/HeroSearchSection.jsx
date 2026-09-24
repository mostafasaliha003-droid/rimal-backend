import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, MapPin, CalendarDays, Users, Search, ShieldCheck, Sparkles } from 'lucide-react';
import DatePicker from 'react-datepicker';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { arSA } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import BookingAPI from '../services/bookingApi';
import { trackBookingEvent } from '../services/analytics';

export default function HeroSearchSection({ onSearch, initialSearch }) {
    const [query, setQuery] = useState(initialSearch?.query || '');
    const [selectedDestination, setSelectedDestination] = useState(initialSearch?.destination || null);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [loading, setLoading] = useState(false);
    const [checkinDate, setCheckinDate] = useState(initialSearch?.checkin ? parseISO(initialSearch.checkin) : null);
    const [checkoutDate, setCheckoutDate] = useState(initialSearch?.checkout ? parseISO(initialSearch.checkout) : null);
    const [guests, setGuests] = useState(initialSearch?.guests || [{ adults: 2, children: [] }]);
    const [error, setError] = useState('');
    const [suggestionError, setSuggestionError] = useState('');
    const [activeField, setActiveField] = useState(null);
    const [isSticky, setIsSticky] = useState(false);
    const blurTimer = useRef(null);

    // هندسة التحويل (UX): تحويل شريط البحث إلى عائم عند التمرير للأسفل
    useEffect(() => {
        const handleScroll = () => {
            setIsSticky(window.scrollY > 280);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        let active = true;
        const value = query.trim();
        if (selectedDestination && value === selectedDestination.label) {
            setShowSuggestions(false);
            setLoading(false);
            return undefined;
        }
        if (value.length < 2) {
            setLoading(false);
            setSuggestions([]);
            return undefined;
        }
        setLoading(true);
        const timer = window.setTimeout(async () => {
            try {
                const data = await BookingAPI.suggest(value, 'ar');
                if (!active) return;
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
                setError('');
                setSuggestionError(nextSuggestions.length > 0 ? '' : 'لا توجد وجهات أو فنادق مطابقة. جرّب الاسم بالإنجليزية أو اسماً آخر.');
                const exactSuggestion = nextSuggestions.find((item) => item.label.trim().toLocaleLowerCase() === value.toLocaleLowerCase());
                if (exactSuggestion) setSelectedDestination(exactSuggestion);
                setShowSuggestions(nextSuggestions.length > 0);
            } catch {
                if (!active) return;
                setSuggestions([]);
                setShowSuggestions(false);
                setError('');
                setSuggestionError('تعذر تحميل اقتراحات الوجهة. تحقق من الاتصال وأعد كتابة الوجهة.');
            } finally {
                if (active) setLoading(false);
            }
        }, 280);
        return () => { active = false; window.clearTimeout(timer); };
    }, [query, selectedDestination]);

    const handleSearch = (event) => {
        event.preventDefault();
        setError('');
        const form = event.currentTarget.tagName === 'FORM' ? event.currentTarget : event.currentTarget.form;
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const exactSuggestion = suggestions.find((item) => item.label.trim().toLocaleLowerCase() === normalizedQuery);
        const destination = selectedDestination || exactSuggestion;
        if (!destination || (!destination.region_id && !destination.hotel_id)) {
            setError(suggestionError || (loading ? 'جارٍ تحميل اقتراحات الوجهة.' : 'اختر وجهة أو فندقاً من قائمة الاقتراحات.'));
            form?.querySelector('#destination-search')?.focus();
            return;
        }
        if (!checkinDate || !checkoutDate) {
            setError('حدد تاريخ الوصول والمغادرة.');
            form.checkin.focus();
            return;
        }
        if (checkinDate < startOfDay(new Date()) || checkoutDate <= checkinDate) {
            setError('اختر وصولاً من اليوم فصاعداً ومغادرة بعده بيوم على الأقل.');
            return;
        }
        if (guests.some(room => room.children.some(age => age === ''))) {
            setError('حدد عمر كل طفل وقت تسجيل الوصول.');
            return;
        }
        const search = {
            query,
            destination,
            checkin: format(checkinDate, 'yyyy-MM-dd'),
            checkout: format(checkoutDate, 'yyyy-MM-dd'),
            guests
        };
        trackBookingEvent('search_cta_clicked', { room_count: guests.length });
        onSearch?.(search);
    };

    return (
        <section id="search" className="hero-search relative isolate overflow-visible py-14 lg:py-24">
            {/* Background Layers for Depth & Contrast */}
            <div className="absolute inset-0 -z-10 bg-[url('https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=2200&q=85')] bg-cover bg-center opacity-35" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#102a43]/95 via-[#123c55]/90 to-[#0f8fa3]/75" />
            <div className="absolute inset-x-0 bottom-0 -z-10 h-28 bg-gradient-to-t from-[#f7f9fc] to-transparent" />

            <div className="mx-auto flex max-w-7xl flex-col px-5 lg:px-10">
                
                <div className="max-w-3xl text-right text-white drop-shadow-lg mb-9">
                    {/* Trust Badge (عكس المخاطرة) */}
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-blue-50 shadow-sm backdrop-blur-md">
                        <Sparkles size={14} className="text-amber-300" />
                        ابحث، قارن، ثم اختر بثقة
                    </div>
                    
                    <h1 className="max-w-3xl text-4xl font-black leading-[1.15] tracking-tight sm:text-6xl">
                        إقامتك القادمة تبدأ من <span className="text-[#8ee7e8]">اختيار أوضح</span>
                    </h1>
                    <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-slate-100/85 sm:text-lg">
                        قارن الأسعار والتوفر وشروط الإلغاء من مكان واحد، ثم انتقل إلى العرض الذي يناسب رحلتك.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3 text-xs font-bold text-white/80">
                        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">أسعار مباشرة</span>
                        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">تفاصيل قابلة للمقارنة</span>
                        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">تحقق قبل الدفع</span>
                    </div>
                </div>

                {/* Sticky Wrapper */}
                <div className={isSticky ? 'h-[100px] lg:h-[85px]' : 'hidden'} /> {/* يمنع قفزة المحتوى عند تفعيل العائم */}
                
                <div className={`transition-all duration-300 z-50 ${isSticky ? 'fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-2xl shadow-sm border-b border-slate-200/50 py-3 px-4 sm:px-6 lg:px-10 animate-in slide-in-from-top-2' : 'relative w-full'}`}>
                    <form onSubmit={handleSearch} className="relative w-full mx-auto max-w-7xl z-20" dir="rtl">
                        
                        {/* The Masterstroke Floating Card */}
                        <div className={`search-panel flex flex-col divide-y divide-slate-200/60 border backdrop-blur-xl lg:flex-row lg:items-stretch lg:divide-y-0 transition-all duration-300 ${isSticky ? 'rounded-2xl border-slate-200 bg-white p-1 shadow-lg lg:rounded-full lg:p-1.5' : 'rounded-3xl border-white/70 bg-white/95 p-2 shadow-[0_22px_60px_rgba(7,31,51,0.22)] lg:rounded-[2rem] lg:p-2.5'}`}>
                            
                            {/* Destination Field */}
                            <label className={`relative flex min-h-[75px] lg:min-h-[80px] flex-1 items-center gap-4 transition-all duration-300 px-6 py-4 ${isSticky ? 'rounded-xl lg:rounded-r-full' : 'rounded-2xl lg:rounded-l-none lg:rounded-r-[2rem]'} ${activeField === 'destination' ? 'bg-white shadow-[0_4px_20px_rgb(0,0,0,0.08)] z-10 scale-[1.02] ring-1 ring-blue-100' : 'hover:bg-slate-50/80 z-0'}`} htmlFor="destination-search">
                                <MapPin className={`h-6 w-6 shrink-0 transition-colors ${activeField === 'destination' ? 'text-blue-600' : 'text-slate-400'}`} />
                                <span className="flex min-w-0 flex-1 flex-col text-right">
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-0.5">الوجهة</span>
                                    <input id="destination-search" role="combobox" aria-expanded={showSuggestions && suggestions.length > 0} aria-busy={loading} aria-describedby={error || suggestionError ? 'search-error' : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedDestination(null); setSuggestions([]); setShowSuggestions(false); setSuggestionError(''); setError(''); }} onFocus={() => { setActiveField('destination'); setShowSuggestions(true); }} onBlur={() => { setActiveField(null); blurTimer.current = window.setTimeout(() => setShowSuggestions(false), 200); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); document.querySelector('#destination-suggestions button')?.focus(); } if (event.key === 'Escape') setShowSuggestions(false); }} placeholder="ابحث عن وجهة أو فندق..." aria-autocomplete="list" aria-controls="destination-suggestions" className="w-full border-0 bg-transparent p-0 pt-1 text-base font-bold text-slate-900 placeholder:text-slate-300 outline-none focus:ring-0" />
                                </span>
                                {loading && <LoaderCircle size={18} className="animate-spin text-blue-500" />}
                                {showSuggestions && query.trim().length > 1 && suggestions.length > 0 && (
                                    <div id="destination-suggestions" role="listbox" aria-label="اقتراحات الوجهات" className="custom-scrollbar absolute inset-x-0 top-[90px] z-50 max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 text-right shadow-2xl">
                                        {suggestions.map((item, index) => (
                                            <button type="button" role="option" aria-selected={selectedDestination?.label === item.label} key={`${item.label}-${index}`} onFocus={() => window.clearTimeout(blurTimer.current)} onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(item.label); setSelectedDestination(item); setShowSuggestions(false); setSuggestionError(''); setError(''); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.nextElementSibling?.focus(); } if (event.key === 'ArrowUp') { event.preventDefault(); event.currentTarget.previousElementSibling?.focus(); } if (event.key === 'Escape') { setShowSuggestions(false); document.getElementById('destination-search')?.focus(); } }} className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-right hover:bg-blue-50 transition-colors group">
                                                <div className="flex items-center gap-3">
                                                    <MapPin size={16} className="text-slate-400 group-hover:text-blue-500" />
                                                    <span className="break-words text-sm font-bold text-slate-900 group-hover:text-blue-700">{item.label}</span>
                                                </div>
                                                <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">{item.hint}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </label>

                            {/* Check-in Field */}
                            <label className={`relative flex min-h-[75px] lg:min-h-[80px] flex-1 items-center gap-4 lg:border-r border-slate-200/50 px-6 py-4 transition-all duration-300 ${isSticky ? 'rounded-xl lg:rounded-none' : 'rounded-2xl lg:rounded-none'} ${activeField === 'checkin' ? 'bg-white shadow-[0_4px_20px_rgb(0,0,0,0.08)] z-10 scale-[1.02] ring-1 ring-blue-100' : 'hover:bg-slate-50/80 z-0'}`}>
                                <CalendarDays className={`pointer-events-none h-6 w-6 shrink-0 transition-colors ${activeField === 'checkin' ? 'text-blue-600' : 'text-slate-400'}`} />
                                <span className="flex min-w-0 flex-1 flex-col text-right">
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-0.5">تسجيل الوصول</span>
                                    <DatePicker
                                        selected={checkinDate}
                                        onChange={date => { setCheckinDate(date); if (date && (!checkoutDate || checkoutDate <= date)) setCheckoutDate(addDays(date, 1)); }}
                                        locale={arSA}
                                        minDate={startOfDay(new Date())}
                                        onFocus={() => setActiveField('checkin')}
                                        onCalendarClose={() => setActiveField(null)}
                                        selectsStart
                                        startDate={checkinDate}
                                        endDate={checkoutDate}
                                        dateFormat="dd MMM yyyy"
                                        placeholderText="أضف تاريخ"
                                        className="w-full cursor-pointer border-none bg-transparent p-0 pt-1 text-right text-base font-bold leading-5 text-slate-900 outline-none placeholder:text-slate-300 focus:ring-0"
                                        wrapperClassName="date-picker-shell"
                                        name="checkin"
                                    />
                                </span>
                            </label>

                            {/* Check-out Field */}
                            <label className={`relative flex min-h-[75px] lg:min-h-[80px] flex-1 items-center gap-4 lg:border-r border-slate-200/50 px-6 py-4 transition-all duration-300 ${isSticky ? 'rounded-xl lg:rounded-none' : 'rounded-2xl lg:rounded-none'} ${activeField === 'checkout' ? 'bg-white shadow-[0_4px_20px_rgb(0,0,0,0.08)] z-10 scale-[1.02] ring-1 ring-blue-100' : 'hover:bg-slate-50/80 z-0'}`}>
                                <CalendarDays className={`pointer-events-none h-6 w-6 shrink-0 transition-colors ${activeField === 'checkout' ? 'text-blue-600' : 'text-slate-400'}`} />
                                <span className="flex min-w-0 flex-1 flex-col text-right">
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-0.5">تسجيل المغادرة</span>
                                    <DatePicker
                                        selected={checkoutDate}
                                        locale={arSA}
                                        onChange={setCheckoutDate}
                                        onFocus={() => setActiveField('checkout')}
                                        onCalendarClose={() => setActiveField(null)}
                                        selectsEnd
                                        startDate={checkinDate}
                                        endDate={checkoutDate}
                                        minDate={addDays(checkinDate || startOfDay(new Date()), 1)}
                                        dateFormat="dd MMM yyyy"
                                        placeholderText="أضف تاريخ"
                                        className="w-full cursor-pointer border-none bg-transparent p-0 pt-1 text-right text-base font-bold leading-5 text-slate-900 outline-none placeholder:text-slate-300 focus:ring-0"
                                        wrapperClassName="date-picker-shell"
                                        name="checkout"
                                    />
                                </span>
                            </label>

                            {/* Guests Field */}
                            <div className={`relative flex min-h-[75px] lg:min-h-[80px] flex-1 items-center gap-4 lg:border-r border-slate-200/50 px-6 py-4 transition-all duration-300 ${isSticky ? 'rounded-xl lg:rounded-none' : 'rounded-2xl lg:rounded-none'} ${activeField === 'guests' ? 'bg-white shadow-[0_4px_20px_rgb(0,0,0,0.08)] z-10 scale-[1.02] ring-1 ring-blue-100' : 'hover:bg-slate-50/80 z-0'}`}>
                                <Users className={`h-6 w-6 shrink-0 transition-colors ${activeField === 'guests' ? 'text-blue-600' : 'text-slate-400'}`} />
                                <details className="min-w-0 flex-1 text-slate-900 group" onToggle={(e) => setActiveField(e.target.open ? 'guests' : null)}>
                                    <summary className="cursor-pointer outline-none list-none">
                                         <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 block mb-0.5">الضيوف</span>
                                         <span className="text-base font-bold truncate block">{guests.length === 1 ? 'غرفة واحدة' : `${guests.length} غرف`}، {guests.reduce((total, room) => total + room.adults + room.children.length, 0)} ضيوف</span>
                                    </summary>
                                    <div className="absolute inset-x-0 top-[90px] z-50 max-h-96 min-w-[300px] space-y-4 overflow-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl lg:left-0 lg:right-auto">
                                        {guests.map((room, index) => <fieldset key={index} className="space-y-4 border-b border-slate-100 pb-5"><legend className="mb-3 text-base font-black text-slate-800">غرفة {index + 1}</legend>
                                            <label className="flex items-center justify-between text-sm font-bold text-slate-600">البالغون<input aria-label={`البالغون في غرفة ${index + 1}`} type="number" min="1" max="6" value={room.adults} onChange={event => setGuests(guests.map((group, position) => position === index ? { ...group, adults: Math.max(1, Math.min(6, Number(event.target.value))) } : group))} className="w-24 rounded-lg border-slate-200 p-2.5 text-center font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" /></label>
                                            <label className="flex items-center justify-between text-sm font-bold text-slate-600">الأطفال<select aria-label={`الأطفال في غرفة ${index + 1}`} value={room.children.length} onChange={event => setGuests(guests.map((group, position) => position === index ? { ...group, children: Array.from({ length: Number(event.target.value) }, (_, child) => group.children[child] ?? '') } : group))} className="w-24 rounded-lg border-slate-200 p-2.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">{[0, 1, 2, 3, 4].map(count => <option key={count}>{count}</option>)}</select></label>
                                            {room.children.map((age, child) => <label key={child} className="flex items-center justify-between gap-2 text-sm font-bold text-slate-600">عمر الطفل {child + 1} (عند الوصول)<select aria-label={`عمر الطفل ${child + 1} في غرفة ${index + 1}`} value={age} onChange={event => setGuests(guests.map((group, position) => position === index ? { ...group, children: group.children.map((value, childIndex) => childIndex === child ? (event.target.value === '' ? '' : Number(event.target.value)) : value) } : group))} className="w-24 rounded-lg border-slate-200 p-2.5 font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"><option value="">اختر</option>{Array.from({ length: 18 }, (_, value) => <option key={value}>{value}</option>)}</select></label>)}
                                            {guests.length > 1 && <button type="button" onClick={() => setGuests(guests.filter((_, position) => position !== index))} className="mt-2 text-sm font-bold text-red-600 hover:text-red-700 underline decoration-2 underline-offset-4">إزالة الغرفة</button>}
                                        </fieldset>)}
                                        {guests.length < 4 && <button type="button" onClick={() => setGuests([...guests, { adults: 2, children: [] }])} className="w-full rounded-xl bg-slate-50 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50 transition-colors">إضافة غرفة</button>}
                                    </div>
                                </details>
                            </div>

                            {/* Submit Button */}
                            <div className={`lg:flex lg:items-center ${isSticky ? 'p-1' : 'p-2'}`}>
                                <button type="submit" disabled={loading} className={`group relative flex min-h-[60px] lg:min-h-[70px] w-full items-center justify-center gap-3 overflow-hidden bg-[var(--remal-orange)] px-8 text-base font-black text-white shadow-[0_8px_18px_rgba(232,117,45,0.28)] transition-all duration-300 hover:bg-[#d86522] hover:shadow-[0_12px_24px_rgba(232,117,45,0.34)] hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 lg:w-auto z-20 ${isSticky ? 'rounded-xl lg:rounded-full' : 'rounded-[1.3rem]'}`}>
                                    <Search size={20} className="transition-transform group-hover:scale-110" />
                                    <span>ابحث الآن</span>
                                </button>
                            </div>
                        </div>
                        
                        {(error || suggestionError) && (
                            <div id="search-error" role="alert" className="absolute -bottom-16 left-0 right-0 mx-auto max-w-fit rounded-full bg-red-50 px-6 py-3 shadow-lg border border-red-100 flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600 font-bold">!</span>
                                <span className="text-sm font-bold text-red-900">{error || suggestionError}</span>
                            </div>
                        )}
                    </form>
                </div>
            </div>
        </section>
    );
}
