import { useCallback, useEffect, useRef, useState } from 'react';
import HeroSearchSection from '../components/HeroSearchSection';
import UnifiedSearchResults from '../components/UnifiedSearchResults';
import BookingAPI from '../services/bookingApi';
import { validateUnifiedSearchResponse } from '../services/nextGenCheckout';
import { useLanguage } from '../i18n';

export function aggregateCriteriaFromSearch(search) {
    const destination = search?.destination;
    if (!destination || !Array.isArray(search.guests) || !search.guests.length) {
        throw new Error('aggregate_search_criteria_invalid');
    }
    const request = {
        checkIn: search.checkin,
        checkOut: search.checkout,
        guests: search.guests.map(room => ({ adults: room.adults, children: room.children || [] }))
    };
    if (destination.type === 'region') {
        request.destination = {
            type: 'region',
            ...(destination.region_id ? { regionId: Number(destination.region_id) } : {}),
            name: destination.label
        };
    } else if (destination.type === 'hotel') {
        request.destination = {
            type: 'hotel',
            providerHotelIds: { ratehawk: [String(destination.hotel_id)] }
        };
    } else {
        throw new Error('aggregate_search_destination_unsupported');
    }
    return request;
}

export default function NextGenHotels({ initialSearch = null }) {
    const { t, apiLanguage, language, direction } = useLanguage();
    const [search, setSearch] = useState(initialSearch);
    const [response, setResponse] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [retryKey, setRetryKey] = useState(0);
    const requestVersion = useRef(0);
    const activeRequest = useRef(null);
    const initialSearchKey = JSON.stringify(initialSearch || null);
    const mounted = useRef(false);

    const runSearch = useCallback(async criteria => {
        const version = ++requestVersion.current;
        activeRequest.current?.abort();
        const controller = new AbortController();
        activeRequest.current = controller;
        setSearch(criteria);
        setLoading(true);
        setError('');
        try {
            const request = aggregateCriteriaFromSearch(criteria);
            request.language = apiLanguage;
            request.display_language = language;
            const result = validateUnifiedSearchResponse(await BookingAPI.searchAggregateHotels(request, { signal: controller.signal }));
            if (version !== requestVersion.current) return null;
            setResponse(result);
            return result;
        } catch (cause) {
            if (version !== requestVersion.current || controller.signal.aborted) return null;
            setResponse(null);
            setError(cause?.response?.data?.error === 'multi_supplier_mock_search_disabled'
                ? t('nextgen.searchDisabled', 'البحث التجريبي غير مفعّل على الخادم حاليًا.')
                : t('nextgen.searchError', 'تعذر إكمال البحث التجريبي. أعد المحاولة لاحقًا.'));
            return null;
        } finally {
            if (version === requestVersion.current) {
                activeRequest.current = null;
                setLoading(false);
            }
        }
    }, [apiLanguage, language, t]);

    useEffect(() => {
        let criteria;
        try { criteria = JSON.parse(initialSearchKey); } catch { criteria = null; }
        if (!criteria) return;
        void runSearch(criteria);
    }, [initialSearchKey, runSearch]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            // React StrictMode performs a synthetic cleanup/setup cycle during
            // development. Defer abort by a microtask so a real unmount is
            // canceled while that synthetic cycle does not strand the search UI.
            queueMicrotask(() => {
                if (mounted.current) return;
                requestVersion.current += 1;
                activeRequest.current?.abort();
            });
            mounted.current = false;
        };
    }, []);

    const handleSearch = criteria => {
        try { sessionStorage.setItem('remal_nextgen_search', JSON.stringify(criteria)); } catch {}
        return runSearch(criteria);
    };

    const retrySearch = () => {
        if (!search) return;
        setRetryKey(value => value + 1);
        void runSearch(search);
    };

    return (
        <div dir={direction} className="min-h-screen bg-remal-bg text-remal-ink" data-next-gen-hotels>
            <HeroSearchSection initialSearch={search} isSearching={loading} searchError={error} onSearch={handleSearch} />
            <main className="mx-auto max-w-7xl space-y-6 px-4 pb-20 pt-8 sm:px-6 lg:px-10">
                {search && <UnifiedSearchResults
                    key={retryKey}
                    response={response}
                    isLoading={loading}
                    error={error}
                    onRetry={retrySearch}
                    onChooseOffer={offer => {
                        if (offer?.mock !== true && response?.mock !== true) return;
                        const selectedOffer = { ...offer, mock: true };
                        try { sessionStorage.setItem('remal_nextgen_selected_offer', JSON.stringify(selectedOffer)); } catch {}
                        window.history.pushState({}, '', '/next-gen/checkout');
                        window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                />}
                {!search && <section className="glass-surface mx-auto max-w-3xl rounded-3xl border border-white/80 p-8 text-center shadow-float">
                    <h2 className="text-2xl font-black text-remal-navy">{t('nextgen.startSearch', 'اختر وجهتك وتواريخ إقامتك لعرض العروض التجريبية.')}</h2>
                </section>}
            </main>
        </div>
    );
}