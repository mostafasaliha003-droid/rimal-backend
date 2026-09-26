import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import BookingAPI from '../../services/bookingApi';
import { trackBookingEvent } from '../../services/analytics';
import { useLanguage } from '../../i18n';
import { initialGuests, normalizeSuggestions, parseSearchDate, validateSearch } from './searchModel';
import SearchShell from './SearchShell';

export default function SearchController({ initialSearch, onSearch, isSearching = false, searchError = '' }) {
    const { t, apiLanguage, language, direction } = useLanguage();
    const [query, setQuery] = useState(initialSearch?.query || '');
    const [destination, setDestination] = useState(initialSearch?.destination || null);
    const [dates, setDates] = useState({ checkin: initialSearch?.checkin || '', checkout: initialSearch?.checkout || '' });
    const [guests, setGuests] = useState(() => initialGuests(initialSearch?.guests));
    const [suggestions, setSuggestions] = useState([]);
    const [suggestionStatus, setSuggestionStatus] = useState('idle');
    const [retry, setRetry] = useState(0);
    const [errors, setErrors] = useState({});
    const [submitError, setSubmitError] = useState('');
    const [dispatching, setDispatching] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const submissionLock = useRef(false);
    const requestVersion = useRef(0);
    const busy = isSearching || dispatching;

    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);

    useEffect(() => {
        const version = ++requestVersion.current;
        const abort = new AbortController();
        setSuggestions([]);
        if (destination || query.trim().length < 2) {
            setSuggestionStatus('idle');
            return () => abort.abort();
        }
        if (!online) {
            setSuggestionStatus('offline');
            return () => abort.abort();
        }
        setSuggestionStatus('loading');
        const timer = window.setTimeout(async () => {
            try {
                const response = await BookingAPI.suggest(query.trim(), apiLanguage, { signal: abort.signal });
                if (abort.signal.aborted || requestVersion.current !== version) return;
                const next = normalizeSuggestions(response);
                setSuggestions(next);
                setSuggestionStatus(next.length ? 'ready' : 'empty');
            } catch {
                if (!abort.signal.aborted && requestVersion.current === version) setSuggestionStatus('error');
            }
        }, 280);
        return () => { window.clearTimeout(timer); abort.abort(); };
    }, [query, destination, apiLanguage, online, retry]);

    const clearError = useCallback(field => {
        setErrors(current => {
            const next = { ...current };
            delete next[field];
            return next;
        });
        setSubmitError('');
    }, []);

    const changeQuery = value => {
        // Invalidate immediately, even before React runs the effect cleanup.
        requestVersion.current++;
        setQuery(value);
        setDestination(null);
        setSuggestions([]);
        setSuggestionStatus('idle');
        clearError('destination');
    };

    const selectDestination = item => {
        requestVersion.current++;
        setQuery(item.label);
        setDestination(item);
        setSuggestions([]);
        setSuggestionStatus('idle');
        clearError('destination');
    };

    const changeDate = (field, value) => {
        setDates(current => {
            const next = { ...current, [field]: value };
            const arrival = parseSearchDate(next.checkin);
            const departure = parseSearchDate(next.checkout);
            if (field === 'checkin' && arrival && departure && departure <= arrival) {
                next.checkout = format(addDays(arrival, 1), 'yyyy-MM-dd');
            }
            return next;
        });
        clearError(field);
        if (field === 'checkin') clearError('checkout');
    };

    const changeGuests = next => { setGuests(next); clearError('guests'); };
    const messages = {
        destinationRequired: t('search.destinationRequired', 'اختر وجهة أو فندقاً من قائمة الاقتراحات.'),
        datesRequired: t('search.datesRequired', 'حدد تاريخ الوصول والمغادرة.'),
        invalidDates: t('search.invalidDates', 'اختر وصولاً من اليوم فصاعداً ومغادرة بعده بيوم على الأقل.'),
        invalidGuests: t('search.invalidGuests', 'حدد من غرفة إلى أربع غرف، ومن بالغ واحد إلى ستة بالغين لكل غرفة.'),
        childAgeRequired: t('search.childAgeRequired', 'حدد عمر كل طفل وقت تسجيل الوصول.')
    };
    const suggestionMessage = suggestionStatus === 'loading' ? t('search.suggestionLoading', 'جارٍ تحميل اقتراحات الوجهة.')
        : suggestionStatus === 'empty' ? t('search.noSuggestions', 'لا توجد وجهات أو فنادق مطابقة. جرّب اسماً آخر.')
        : suggestionStatus === 'error' ? t('search.suggestionsFailed', 'تعذر تحميل اقتراحات الوجهة. تحقق من الاتصال وأعد المحاولة.')
        : suggestionStatus === 'ready' ? t('search.suggestionCount', '{{count}} اقتراحات متاحة. استخدم الأسهم للاختيار.', { count: suggestions.length }) : '';

    const submit = async () => {
        if (submissionLock.current || busy) return false;
        const codes = validateSearch({ query, destination, ...dates, guests });
        const nextErrors = Object.fromEntries(Object.entries(codes).map(([field, code]) => [field, messages[code]]));
        if (nextErrors.destination && ['empty', 'error', 'loading'].includes(suggestionStatus)) nextErrors.destination = suggestionMessage;
        setErrors(nextErrors);
        setSubmitError('');
        const first = Object.keys(nextErrors)[0];
        if (first) {
            const id = first === 'destination' ? 'destination-search' : first === 'guests' ? 'search-guests' : `search-${first}`;
            window.requestAnimationFrame(() => document.getElementById(id)?.focus());
            return false;
        }
        if (!online) {
            setSubmitError(t('search.offline', 'أنت غير متصل. احتفظنا ببيانات البحث؛ اتصل بالإنترنت ثم أعد المحاولة.'));
            return false;
        }
        submissionLock.current = true;
        setDispatching(true);
        try {
            trackBookingEvent('search_cta_clicked', { room_count: guests.length });
            await onSearch?.({ query: destination.label, destination, ...dates, guests });
            return true;
        } catch {
            setSubmitError(t('search.submitFailed', 'تعذر تنفيذ البحث. بياناتك محفوظة؛ أعد المحاولة.'));
            return false;
        } finally {
            submissionLock.current = false;
            setDispatching(false);
        }
    };

    return <SearchShell controller={{
        t, language, direction, query, destination, dates, guests, errors, suggestions, suggestionStatus,
        suggestionMessage, busy, online, searchError: submitError || searchError,
        changeQuery, selectDestination, changeDate, changeGuests, submit,
        retrySuggestions: () => setRetry(value => value + 1)
    }} />;
}