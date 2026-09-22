import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import DatePicker from 'react-datepicker';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { arSA } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import BookingAPI from '../services/bookingApi';
import { CalendarIcon, PinIcon, UsersIcon } from './Icons';

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
    const blurTimer = useRef(null);

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
        onSearch?.(search);
    };

    return (
        <section className="relative isolate overflow-visible bg-slate-950 py-8 lg:py-12">
            <div className="absolute inset-0 -z-10 bg-[url('https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=2200&q=85')] bg-cover bg-center" />
            <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(2,6,23,.96)_0%,rgba(2,6,23,.78)_48%,rgba(2,6,23,.18)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-slate-50 to-transparent" />

            <div className="mx-auto flex max-w-7xl flex-col px-5 lg:px-10">
                <div className="max-w-2xl text-right text-white">
                    <h1 className="max-w-xl text-3xl font-bold leading-tight sm:text-4xl">
                        رمال <span className="text-cyan-300">وفِلّها</span>
                    </h1>
                    <p className="mt-3 max-w-lg text-base leading-7 text-slate-100">إقامتك الجاية تبدأ هنا. اختر وجهتك وتواريخك.</p>
                </div>

                <form onSubmit={handleSearch} className="relative mt-6 w-full" dir="rtl">
                    <div className="flex flex-col divide-y divide-slate-200 rounded-[1.75rem] bg-white/95 p-2 shadow-2xl backdrop-blur-md lg:flex-row lg:items-stretch lg:rounded-full">
                        <label className={`relative z-40 flex min-h-[76px] flex-1 items-center gap-3 rounded-[1.4rem] px-5 py-4 transition-all duration-300 lg:rounded-full ${activeField === 'destination' ? 'bg-white shadow-md' : 'hover:bg-slate-50'}`} htmlFor="destination-search">
                            <PinIcon className="h-6 w-6 shrink-0 text-blue-600" size={24} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">الوجهة</span>
                                <input id="destination-search" role="combobox" aria-expanded={showSuggestions && suggestions.length > 0} aria-busy={loading} aria-describedby={error || suggestionError ? 'search-error' : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedDestination(null); setSuggestions([]); setShowSuggestions(false); setSuggestionError(''); setError(''); }} onFocus={() => { setActiveField('destination'); setShowSuggestions(true); }} onBlur={() => { setActiveField(null); blurTimer.current = window.setTimeout(() => setShowSuggestions(false), 200); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); document.querySelector('#destination-suggestions button')?.focus(); } if (event.key === 'Escape') setShowSuggestions(false); }} placeholder="ابحث عن وجهة أو فندق..." aria-autocomplete="list" aria-controls="destination-suggestions" className="w-full border-0 bg-transparent p-0 pt-1 text-sm font-bold text-slate-900 placeholder:text-slate-500" />
                            </span>
                            {loading && <LoaderCircle size={17} className="animate-spin text-slate-400" />}
                            {showSuggestions && query.trim().length > 1 && suggestions.length > 0 && <div id="destination-suggestions" role="listbox" aria-label="اقتراحات الوجهات" className="custom-scrollbar absolute inset-x-2 top-[76px] z-50 max-h-72 overflow-y-auto rounded-2xl border border-slate-100 bg-white p-2 text-right shadow-lg lg:inset-x-0">
                                {suggestions.map((item, index) => <button type="button" role="option" aria-selected={selectedDestination?.label === item.label} key={`${item.label}-${index}`} onFocus={() => window.clearTimeout(blurTimer.current)} onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(item.label); setSelectedDestination(item); setShowSuggestions(false); setSuggestionError(''); setError(''); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.nextElementSibling?.focus(); } if (event.key === 'ArrowUp') { event.preventDefault(); event.currentTarget.previousElementSibling?.focus(); } if (event.key === 'Escape') { setShowSuggestions(false); document.getElementById('destination-search')?.focus(); } }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-right hover:bg-slate-50"><span className="break-words text-sm font-bold text-slate-900">{item.label}</span><span className="shrink-0 text-xs text-slate-600">{item.hint}</span></button>)}
                            </div>}
                        </label>
                        <label className={`relative flex min-h-[76px] flex-1 items-center gap-3 rounded-[1.4rem] border-slate-200 px-5 py-4 transition-all duration-300 lg:rounded-full lg:border-l ${activeField === 'checkin' ? 'bg-white shadow-md' : 'hover:bg-slate-50'}`}>
                            <CalendarIcon className="pointer-events-none h-6 w-6 shrink-0 text-blue-600" size={24} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">تسجيل الوصول</span>
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
                                    className="w-full cursor-pointer border-none bg-transparent p-0 pt-1 text-right text-sm font-medium leading-5 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
                                    wrapperClassName="date-picker-shell"
                                    calendarClassName="premium-datepicker"
                                    popperClassName="premium-datepicker-popper"
                                    popperPlacement="bottom-start"
                                    name="checkin"
                                />
                            </span>
                        </label>
                        <label className={`relative flex min-h-[76px] flex-1 items-center gap-3 rounded-[1.4rem] border-slate-200 px-5 py-4 transition-all duration-300 lg:rounded-full lg:border-l ${activeField === 'checkout' ? 'bg-white shadow-md' : 'hover:bg-slate-50'}`}>
                            <CalendarIcon className="pointer-events-none h-6 w-6 shrink-0 text-blue-600" size={24} />
                            <span className="flex min-w-0 flex-1 flex-col text-right">
                                <span className="text-[11px] font-bold text-slate-800">تسجيل المغادرة</span>
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
                                    className="w-full cursor-pointer border-none bg-transparent p-0 pt-1 text-right text-sm font-medium leading-5 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
                                    wrapperClassName="date-picker-shell"
                                    calendarClassName="premium-datepicker"
                                    popperClassName="premium-datepicker-popper"
                                    popperPlacement="bottom-start"
                                    name="checkout"
                                />
                            </span>
                        </label>
                        <div className="relative flex min-h-[76px] min-w-0 flex-1 items-center gap-3 px-5 py-4">
                            <UsersIcon className="h-6 w-6 shrink-0 text-blue-600" size={24} />
                            <details className="min-w-0 flex-1 text-slate-900">
                                <summary className="cursor-pointer text-sm font-bold">{guests.length === 1 ? 'غرفة واحدة' : `${guests.length} غرف`}، {guests.reduce((total, room) => total + room.adults + room.children.length, 0)} ضيوف</summary>
                                <div className="absolute inset-x-0 top-full z-50 max-h-96 min-w-[260px] space-y-4 overflow-auto rounded-lg border border-slate-200 bg-white p-4 shadow-lg lg:left-0 lg:right-auto lg:w-80">
                                    {guests.map((room, index) => <fieldset key={index} className="space-y-3 border-b border-slate-200 pb-4"><legend className="mb-2 text-sm font-bold">غرفة {index + 1}</legend>
                                        <label className="flex items-center justify-between text-sm">البالغون<input aria-label={`البالغون في غرفة ${index + 1}`} type="number" min="1" max="6" value={room.adults} onChange={event => setGuests(guests.map((group, position) => position === index ? { ...group, adults: Math.max(1, Math.min(6, Number(event.target.value))) } : group))} className="w-20 rounded border p-2" /></label>
                                        <label className="flex items-center justify-between text-sm">الأطفال<select aria-label={`الأطفال في غرفة ${index + 1}`} value={room.children.length} onChange={event => setGuests(guests.map((group, position) => position === index ? { ...group, children: Array.from({ length: Number(event.target.value) }, (_, child) => group.children[child] ?? '') } : group))} className="rounded border p-2">{[0, 1, 2, 3, 4].map(count => <option key={count}>{count}</option>)}</select></label>
                                        {room.children.map((age, child) => <label key={child} className="flex items-center justify-between gap-2 text-sm">عمر الطفل {child + 1} عند الوصول<select aria-label={`عمر الطفل ${child + 1} في غرفة ${index + 1}`} value={age} onChange={event => setGuests(guests.map((group, position) => position === index ? { ...group, children: group.children.map((value, childIndex) => childIndex === child ? (event.target.value === '' ? '' : Number(event.target.value)) : value) } : group))} className="rounded border p-2"><option value="">اختر</option>{Array.from({ length: 18 }, (_, value) => <option key={value}>{value}</option>)}</select></label>)}
                                        {guests.length > 1 && <button type="button" onClick={() => setGuests(guests.filter((_, position) => position !== index))} className="text-sm text-red-800 underline">إزالة الغرفة</button>}
                                    </fieldset>)}
                                    {guests.length < 4 && <button type="button" onClick={() => setGuests([...guests, { adults: 2, children: [] }])} className="text-sm font-bold text-remal-blue">إضافة غرفة</button>}
                                </div>
                            </details>
                        </div>
                        <div className="p-1 lg:flex lg:items-center lg:py-1 lg:pl-1 lg:pr-2">
                            <button type="submit" disabled={loading} className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-lg bg-remal-dark px-7 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60 lg:w-auto"><span>ابحث الآن</span><ArrowLeft size={18} /></button>
                        </div>
                    </div>
                    {(error || suggestionError) && <p id="search-error" role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">{error || suggestionError}</p>}
                </form>
            </div>
        </section>
    );
}
