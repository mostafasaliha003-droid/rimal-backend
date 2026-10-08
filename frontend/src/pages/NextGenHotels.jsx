import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Hotel, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import UnifiedSearchResults from '../components/UnifiedSearchResults';
import BookingAPI from '../services/bookingApi';
import { validateUnifiedSearchResponse } from '../services/nextGenCheckout';
import { buildHotelbedsPilotSearch, normalizeHotelbedsPilotList, sanitizeHotelbedsPilotSearch } from '../services/hotelbedsPilotSearch';
import { canStartDirectHotelbedsBooking } from '../services/hotelbedsRateReview.js';
import { useLanguage } from '../i18n';

function defaultDates() {
    const checkIn = new Date();
    checkIn.setDate(checkIn.getDate() + 30);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 1);
    const format = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { checkIn: format(checkIn), checkOut: format(checkOut) };
}

function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addCalendarDay(value) {
    if (!isValidDate(value)) return value;
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readInitialAdults(initialSearch) {
    const guests = initialSearch?.guests;
    return Array.isArray(guests) && guests.length === 1
        && Number.isSafeInteger(guests[0]?.adults) && guests[0].adults >= 1 && guests[0].adults <= 6
        ? guests[0].adults : 2;
}

function retryAfterMilliseconds(error, now = Date.now()) {
    const maxCooldownMs = 24 * 60 * 60 * 1000;
    const response = error?.response;
    const headers = response?.headers;
    let retryAfter = typeof headers?.get === 'function'
        ? headers.get('retry-after')
        : headers?.['retry-after'] ?? headers?.['Retry-After'];

    if (retryAfter === undefined || retryAfter === null || retryAfter === '') {
        retryAfter = response?.data?.retryAfterSeconds;
        const seconds = Number(retryAfter);
        return Number.isFinite(seconds) && seconds >= 0
            ? Math.min(maxCooldownMs, Math.ceil(seconds * 1000)) : null;
    }

    const value = String(retryAfter).trim();
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        const seconds = Number(value);
        return Number.isFinite(seconds) ? Math.min(maxCooldownMs, Math.ceil(seconds * 1000)) : null;
    }
    if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
    const retryAt = Date.parse(value);
    return Number.isFinite(retryAt) ? Math.min(maxCooldownMs, Math.max(0, retryAt - now)) : null;
}

function searchErrorMessage(status, code, t) {
    if (status === 429) {
        return code === 'hotelbeds_supplier_rate_limited'
            ? t('nextgen.supplierQuotaError', 'The supplier is temporarily limiting searches. Please try again later.')
            : t('nextgen.quotaError', 'Search is temporarily paused because a request limit was reached.');
    }
    if (status === 503) {
        return t('nextgen.unavailable503', 'Hotel search is temporarily unavailable. No retry time is known.');
    }
    if (status === 403) {
        return t('nextgen.accessError', 'Search access is unavailable. Please contact support or try again later.');
    }
    if (code === 'multi_supplier_mock_search_disabled') {
        return t('nextgen.searchDisabled', 'Mock search is not currently enabled on the server.');
    }
    if (code === 'hotelbeds_pilot_hotel_not_allowed') {
        return t('nextgen.pilotSelectionInvalid', 'Select a hotel from the currently approved pilot list.');
    }
    return t('nextgen.searchError', 'Mock search could not complete. Please try again later.');
}

export default function NextGenHotels({ initialSearch = null }) {
    const { t, apiLanguage, language, direction } = useLanguage();
    const directBookingUiEnabled = import.meta.env.VITE_HOTELBEDS_DIRECT_BOOKING_UI_ENABLED === 'true';
    const [pilotHotels, setPilotHotels] = useState([]);
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState('');
    const [selectedHotelCode, setSelectedHotelCode] = useState('');
    const [dates, setDates] = useState(defaultDates);
    const [adults, setAdults] = useState(() => readInitialAdults(initialSearch));
    const [search, setSearch] = useState(null);
    const [response, setResponse] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [cooldownUntil, setCooldownUntil] = useState(null);
    const [cooldownSeconds, setCooldownSeconds] = useState(0);
    const [retryKey, setRetryKey] = useState(0);
    const requestVersion = useRef(0);
    const activeRequest = useRef(null);
    const mounted = useRef(false);

    useEffect(() => {
        if (cooldownUntil === null) {
            setCooldownSeconds(0);
            return undefined;
        }
        const updateCountdown = () => {
            const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
            setCooldownSeconds(remaining);
            if (remaining === 0) setCooldownUntil(null);
        };
        updateCountdown();
        const timer = window.setInterval(updateCountdown, 1000);
        return () => window.clearInterval(timer);
    }, [cooldownUntil]);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setListLoading(true);
        BookingAPI.getHotelbedsPilotList({ signal: controller.signal }).then(payload => {
            const list = normalizeHotelbedsPilotList(payload);
            if (!active) return;
            setPilotHotels(list.hotels);
            setListError(list.configured ? '' : t('nextgen.pilotUnavailable', 'No approved Hotelbeds Sandbox pilot hotels are configured.'));
        }).catch(() => {
            if (!active || controller.signal.aborted) return;
            setPilotHotels([]);
            setListError(t('nextgen.pilotListError', 'Could not load the approved Hotelbeds pilot list.'));
        }).finally(() => {
            if (active) setListLoading(false);
        });
        return () => { active = false; controller.abort(); };
    }, [t]);

    const runSearch = useCallback(async criteria => {
        const version = ++requestVersion.current;
        activeRequest.current?.abort();
        const controller = new AbortController();
        activeRequest.current = controller;
        setSearch(criteria);
        setLoading(true);
        setError('');
        setCooldownUntil(null);
        setCooldownSeconds(0);
        try {
            // Revalidate against the latest server-supplied list at the call boundary.
            const request = sanitizeHotelbedsPilotSearch(criteria, pilotHotels);
            request.language = apiLanguage;
            request.display_language = language;
            const result = validateUnifiedSearchResponse(
                await BookingAPI.searchMockAggregateHotels(request, { signal: controller.signal })
            );
            if (version !== requestVersion.current) return null;
            setResponse(result);
            try { sessionStorage.setItem('remal_nextgen_search', JSON.stringify(criteria)); } catch {}
            return result;
        } catch (cause) {
            if (version !== requestVersion.current || controller.signal.aborted) return null;
            setResponse(null);
            const status = Number(cause?.response?.status) || null;
            const code = cause?.response?.data?.error || cause?.message || null;
            setError({ message: searchErrorMessage(status, code, t), status, code });
            const waitMs = status === 429 ? retryAfterMilliseconds(cause) : null;
            if (waitMs !== null && waitMs > 0) {
                setCooldownUntil(Date.now() + waitMs);
                setCooldownSeconds(Math.ceil(waitMs / 1000));
            } else {
                setCooldownUntil(null);
                setCooldownSeconds(0);
            }
            return null;
        } finally {
            if (version === requestVersion.current) {
                activeRequest.current = null;
                setLoading(false);
            }
        }
    }, [apiLanguage, language, pilotHotels, t]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            queueMicrotask(() => {
                if (mounted.current) return;
                requestVersion.current += 1;
                activeRequest.current?.abort();
            });
            mounted.current = false;
        };
    }, []);

    const handleSubmit = event => {
        event.preventDefault();
        if (cooldownSeconds > 0) return;
        setError('');
        if (!pilotHotels.some(hotel => hotel.providerHotelId === selectedHotelCode)) {
            setError({ message: t('nextgen.pilotSelectionInvalid', 'Select a hotel from the currently approved pilot list.') });
            return;
        }
        if (!isValidDate(dates.checkIn) || !isValidDate(dates.checkOut) || dates.checkOut <= dates.checkIn
            || !Number.isSafeInteger(adults) || adults < 1 || adults > 6) {
            setError({ message: t('nextgen.pilotDatesInvalid', 'Choose valid stay dates and one to six adults.') });
            return;
        }
        let criteria;
        try {
            criteria = buildHotelbedsPilotSearch({
                hotelCode: selectedHotelCode,
                checkIn: dates.checkIn,
                checkOut: dates.checkOut,
                adults,
                hotels: pilotHotels
            });
        } catch {
            setError({ message: t('nextgen.pilotSelectionInvalid', 'Select a hotel from the currently approved pilot list.') });
            return;
        }
        void runSearch(criteria);
    };

    const retrySearch = () => {
        if (!search || cooldownSeconds > 0) return;
        setRetryKey(value => value + 1);
        void runSearch(search);
    };

    return (
        <div dir={direction} className="min-h-screen bg-remal-bg text-remal-ink" data-next-gen-hotels>
            <section className="relative isolate overflow-hidden bg-gradient-to-br from-remal-navy via-[#123c55] to-remal-blue px-4 py-12 text-white sm:px-8 sm:py-16">
                <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-20 bg-[radial-gradient(circle_at_top_right,white,transparent_45%)]" />
                <div className="mx-auto max-w-7xl">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-100/30 bg-white/10 px-4 py-2 text-xs font-black backdrop-blur-xl">
                        <ShieldCheck size={15} aria-hidden="true" />
                        {t('nextgen.sandboxBadge', 'Next-Gen Sandbox · local mock search')}
                    </div>
                    <h1 className="mt-5 text-3xl font-black sm:text-5xl">{t('nextgen.pilotTitle', 'Hotelbeds Pilot Hotel Selector')}</h1>
                    <p className="mt-3 max-w-2xl font-semibold leading-7 text-white/85">
                        {t('nextgen.pilotDescription', 'Choose an explicitly approved pilot hotel. This screen uses local mock search only; it does not call Hotelbeds or Atlas.')}
                    </p>
                </div>
            </section>

            <main className="mx-auto max-w-7xl space-y-7 px-4 pb-20 pt-8 sm:px-6 lg:px-10">
                <form onSubmit={handleSubmit} className="glass-surface rounded-3xl border border-white/80 p-5 shadow-float backdrop-blur-2xl sm:p-7">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="flex items-center gap-2 text-xl font-black text-remal-navy">
                            <Hotel size={20} className="text-remal-blue" />{t('nextgen.pilotSelector', 'Approved pilot hotel')}
                        </h2>
                        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-black text-cyan-950">{t('nextgen.sandboxMode', 'Sandbox · no supplier request')}</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <label className="block min-w-0 xl:col-span-2">
                            <span className="mb-2 block text-sm font-black text-remal-navy">{t('nextgen.pilotHotelLabel', 'Hotelbeds pilot hotel')}</span>
                            <select id="hotelbeds-pilot-hotel" aria-label={t('nextgen.pilotHotelLabel', 'Hotelbeds pilot hotel')}
                                value={selectedHotelCode} onChange={event => setSelectedHotelCode(event.target.value)}
                                disabled={listLoading || loading || pilotHotels.length === 0}
                                className="min-h-12 w-full rounded-xl border border-remal-navy/10 bg-white/85 px-4 py-3 font-bold text-remal-navy outline-none focus:border-remal-blue focus:ring-4 focus:ring-remal-blue/10 disabled:opacity-60">
                                <option value="">{listLoading
                                    ? t('nextgen.pilotListLoading', 'Loading approved hotels…')
                                    : t('nextgen.pilotHotelPlaceholder', 'Select an approved pilot hotel')}</option>
                                {pilotHotels.map(hotel => <option key={hotel.providerHotelId} value={hotel.providerHotelId}>
                                    {hotel.label} ({hotel.providerHotelId})
                                </option>)}
                            </select>
                        </label>
                        <label className="block min-w-0">
                            <span className="mb-2 block text-sm font-black text-remal-navy">{t('search.arrival', 'Check-in')}</span>
                            <span className="flex min-h-12 items-center gap-2 rounded-xl border border-remal-navy/10 bg-white/85 px-3 focus-within:border-remal-blue focus-within:ring-4 focus-within:ring-remal-blue/10">
                                <CalendarDays size={17} className="shrink-0 text-remal-blue" aria-hidden="true" />
                                <input aria-label={t('search.arrival', 'Check-in')} type="date" value={dates.checkIn} disabled={loading}
                                    onChange={event => setDates(current => ({
                                        checkIn: event.target.value,
                                        checkOut: current.checkOut <= event.target.value
                                            ? addCalendarDay(event.target.value)
                                            : current.checkOut
                                    }))}
                                    className="min-h-10 w-full bg-transparent font-bold text-remal-navy outline-none" />
                            </span>
                        </label>
                        <label className="block min-w-0">
                            <span className="mb-2 block text-sm font-black text-remal-navy">{t('search.departure', 'Check-out')}</span>
                            <span className="flex min-h-12 items-center gap-2 rounded-xl border border-remal-navy/10 bg-white/85 px-3 focus-within:border-remal-blue focus-within:ring-4 focus-within:ring-remal-blue/10">
                                <CalendarDays size={17} className="shrink-0 text-remal-blue" aria-hidden="true" />
                                <input aria-label={t('search.departure', 'Check-out')} type="date" min={dates.checkIn} disabled={loading}
                                    value={dates.checkOut} onChange={event => setDates(current => ({ ...current, checkOut: event.target.value }))}
                                    className="min-h-10 w-full bg-transparent font-bold text-remal-navy outline-none" />
                            </span>
                        </label>
                        <label className="block min-w-0">
                            <span className="mb-2 block text-sm font-black text-remal-navy">{t('search.adults', 'Adults')}</span>
                            <select aria-label={t('search.adults', 'Adults')} value={adults} disabled={loading} onChange={event => setAdults(Number(event.target.value))}
                                className="min-h-12 w-full rounded-xl border border-remal-navy/10 bg-white/85 px-4 py-3 font-bold text-remal-navy outline-none focus:border-remal-blue focus:ring-4 focus:ring-remal-blue/10">
                                {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
                            </select>
                        </label>
                    </div>
                    {listLoading && <p role="status" className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-600"><LoaderCircle size={16} className="animate-spin" />{t('nextgen.pilotListLoading', 'Loading approved hotels…')}</p>}
                    {listError && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">{listError}</p>}
                    {error && <p role="alert" data-search-form-error={error.status || 'validation'} className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">{error.message}</p>}
                    <button id="hotelbeds-pilot-search" type="submit" aria-describedby={cooldownSeconds > 0 ? 'nextgen-cooldown-status' : undefined}
                        disabled={loading || cooldownSeconds > 0 || listLoading || !selectedHotelCode || pilotHotels.length === 0}
                        className="cta-red mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                        {loading ? <LoaderCircle size={18} className="animate-spin" /> : <Search size={18} />}
                        {loading ? t('nextgen.loading', 'Searching for hotel offers…') : t('search.search', 'Search now')}
                    </button>
                </form>

                {search && <UnifiedSearchResults
                    key={retryKey}
                    response={response}
                    isLoading={loading}
                    error={error?.message || ''}
                    errorStatus={error?.status}
                    onRetry={retrySearch}
                    cooldownSeconds={cooldownSeconds}
                    onChooseOffer={offer => {
                        const isMockOffer = offer?.mock === true && response?.mock === true;
                        const isGatedDirectOffer = directBookingUiEnabled
                            && offer?.mock !== true && response?.mock !== true
                            && canStartDirectHotelbedsBooking(offer);
                        if (!isMockOffer && !isGatedDirectOffer) return;
                        try { sessionStorage.setItem('remal_nextgen_selected_offer', JSON.stringify(offer)); } catch {}
                        window.history.pushState({}, '', '/next-gen/checkout');
                        window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                />}
                {!search && <section className="glass-surface mx-auto max-w-3xl rounded-3xl border border-white/80 p-8 text-center shadow-float">
                    <h2 className="text-xl font-black text-remal-navy">{t('nextgen.startSearch', 'Choose an approved pilot hotel and stay dates to see local mock results.')}</h2>
                </section>}
            </main>
        </div>
    );
}