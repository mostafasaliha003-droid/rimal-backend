import { memberHeaders } from '../services/membershipApi.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MessageSquareText, Star, RotateCw } from 'lucide-react';
import { API_BASE_URL } from '../services/apiBaseUrl.js';
import { googleReviewsCopy } from '../services/googleReviewsCopy.js';
import { useLanguage } from '../i18n';
import googleMapsLogo from '../assets/google-maps-attribution.svg';

function Review({ review, copy, language, placeUrl }) {
    const [expanded, setExpanded] = useState(false), [original, setOriginal] = useState(false), [photoFailed, setPhotoFailed] = useState(false);
    const translated = Boolean(review.originalText && review.text && review.originalText !== review.text
        && review.originalLanguage && review.textLanguage && review.originalLanguage !== review.textLanguage);
    const text = original ? review.originalText : review.text || review.originalText;
    const published = new Date(review.publishedAt);
    const date = Number.isFinite(published.getTime()) ? new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(published) : review.relativeTime;
    const authorName = review.author?.name || copy.unknownAuthor;
    return <article data-google-review className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <header className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 font-bold text-slate-600">
                {review.author?.photo && !photoFailed ? <img src={review.author.photo} alt="" width="44" height="44" loading="lazy" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} /> : authorName.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
                {review.author?.url ? <a href={review.author.url} target="_blank" rel="noopener noreferrer" className="block break-words text-sm font-bold text-slate-900 hover:underline">{authorName}</a> : <p className="break-words text-sm font-bold text-slate-900">{authorName}</p>}
                {date && <p className="mt-1 text-xs text-slate-500"><time dateTime={review.publishedAt || undefined}>{date}</time></p>}
            </div>
            {review.rating !== null && <span dir="ltr" className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm font-bold text-amber-900"><Star size={14} fill="currentColor" />{review.rating}/5</span>}
        </header>
        {text && <p dir="auto" className={`mt-4 whitespace-pre-line break-words text-sm leading-7 text-slate-700 ${expanded || text.length <= 220 ? '' : 'line-clamp-4'}`}>{text}</p>}
        {text.length > 220 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="mt-2 min-h-10 text-sm font-bold text-blue-700 hover:underline">{expanded ? copy.less : copy.more}</button>}
        {translated && <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
            {!original && <span>{copy.translation}</span>}
            <button data-google-original type="button" onClick={() => setOriginal(value => !value)} className="min-h-10 font-bold text-blue-700 hover:underline">{original ? copy.translated : copy.original}</button>
        </div>}
        {review.visitDate && <p className="mt-2 text-xs text-slate-500">{copy.visit}: {new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(review.visitDate.year, review.visitDate.month - 1, 1)))}</p>}
        {(review.url || placeUrl) && <a href={review.url || placeUrl} target="_blank" rel="noopener noreferrer" className="mt-4 flex min-h-10 w-fit items-center gap-1 text-xs font-bold text-slate-600 hover:text-blue-700 hover:underline">{copy.source}<ArrowUpRight size={14} /></a>}
    </article>;
}

export default function GoogleHotelReviews({ hid, hotelName = '', address = '' }) {
    const { language } = useLanguage();
    const copy = googleReviewsCopy(language), key = `${hid}:${language}`;
    const [result, setResult] = useState({ key, status: 'checking' });
    const controller = useRef(null);
    const current = result.key === key ? result : { status: 'checking' };
    useEffect(() => {
        const request = new AbortController(); controller.current = request;
        const timer = setTimeout(() => request.abort(), 10000);
        fetch(`${API_BASE_URL}/v1/hotels/reviews/google/availability`, { signal: request.signal, cache: 'no-store', headers:memberHeaders() })
            .then(response => response.json()).then(data => {
                if (controller.current === request) setResult({ key, status: data.enabled === true ? 'idle' : 'unavailable' });
            }).catch(() => { if (controller.current === request) setResult({ key, status: 'unavailable' }); })
            .finally(() => clearTimeout(timer));
        return () => { controller.current?.abort(); controller.current = null; clearTimeout(timer); };
    }, [key]);
    const load = async () => {
        if (current.status === 'loading') return;
        controller.current?.abort();
        const request = new AbortController(); controller.current = request;
        setResult({ key, status: 'loading' });
        const timeout = setTimeout(() => request.abort(), 25000);
        try {
            const response = await fetch(`${API_BASE_URL}/v1/hotels/${encodeURIComponent(hid)}/reviews/google?language=${language}`, { signal: request.signal, cache: 'no-store', headers:memberHeaders() });
            const data = await response.json();
            if (controller.current !== request) return;
            setResult({ key, ...data, status: ['ready', 'unmatched', 'limited'].includes(data.status) ? data.status : 'unavailable' });
        } catch { if (controller.current === request) setResult({ key, status: 'unavailable' }); }
        finally { clearTimeout(timeout); }
    };
    const ready = current.status === 'ready';
    const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([hotelName, address].filter(Boolean).join(' '))}`;
    return <section id="hotel-google-reviews" data-google-reviews aria-labelledby="google-reviews-title" aria-busy={['checking', 'loading'].includes(current.status)} className="scroll-mt-24 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/60 shadow-sm">
        <header className="border-b border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs font-bold text-blue-700">{copy.eyebrow}</p>
                <img src={googleMapsLogo} alt="Google Maps" className="h-[18px] w-auto" style={{ margin: '10px 10px 5px' }} />
            </div>
            <h2 id="google-reviews-title" className="mt-3 text-2xl font-black text-slate-900">{copy.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-500">{copy.intro}</p>
            {ready && current.rating !== null && <div data-google-rating className="mt-6 flex flex-wrap items-center gap-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
                <div><span dir="ltr" className="text-5xl font-black tracking-tight text-slate-900">{Number(current.rating).toFixed(1)}</span><span className="mx-2 text-sm text-slate-500">{copy.outOf}</span></div>
                <div className="space-y-1">
                    <span aria-hidden="true" className="flex gap-1 text-amber-500">{Array.from({ length: 5 }, (_, i) => <Star key={i} size={18} fill={i < Math.round(current.rating) ? 'currentColor' : 'none'} />)}</span>
                    {current.count !== null && <p className="text-xs font-semibold text-slate-600">{new Intl.NumberFormat(language).format(current.count)} {copy.count}</p>}
                </div>
            </div>}
        </header>
        <div className="space-y-5 p-5 sm:p-8" aria-live="polite">
            {current.status === 'idle' && <div className="flex flex-col items-center gap-4 py-3 text-center"><MessageSquareText size={32} className="text-slate-400" /><button data-load-google-reviews type="button" onClick={load} className="min-h-12 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-700">{copy.load}</button></div>}
            {['checking', 'loading'].includes(current.status) && <div role="status" className="space-y-4 py-4">{current.status === 'loading' && <p className="flex items-center gap-2 text-sm font-bold text-slate-600"><RotateCw size={17} className="motion-safe:animate-spin" />{copy.loading}</p>}<div className="h-28 rounded-2xl bg-slate-200/60 motion-safe:animate-pulse" /></div>}
            {ready && <>
                <p className="text-xs leading-6 text-slate-500">{copy.selected}</p>
                <div className="grid min-w-0 gap-4">{(current.reviews || []).map((review, index) => <Review key={`${key}:${index}`} review={review} copy={copy} language={language} placeUrl={current.url} />)}</div>
                {!current.reviews?.length && <p className="py-3 text-sm text-slate-500">{copy.none}</p>}
                {current.url && <a data-google-all-reviews href={current.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-center text-sm font-bold text-slate-800 hover:border-blue-400">{copy.all}<ArrowUpRight size={16} /></a>}
                {(current.attributions || []).map((item, index) => <p key={index} className="text-xs text-slate-500">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">{item.name}</a> : item.name}</p>)}
                <p className="text-xs leading-6 text-slate-500">{copy.disclaimer}</p>
            </>}
            {!['checking', 'idle', 'loading', 'ready'].includes(current.status) && <div className="space-y-4 py-2"><p className="text-sm leading-7 text-slate-600">{copy[current.status] || copy.unavailable}</p><a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue-700 hover:underline">{copy.search}<ArrowUpRight size={16} /></a>{current.status !== 'limited' && <button type="button" onClick={load} className="block min-h-11 text-sm font-bold text-slate-600 hover:underline">{copy.retry}</button>}</div>}
        </div>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500"><span dir="ltr">Google Maps</span><div className="flex gap-4"><a href={`/privacy?lang=${language}`} className="hover:underline">{copy.privacy}</a><a href={`/terms?lang=${language}`} className="hover:underline">{copy.terms}</a></div></footer>
    </section>;
}
