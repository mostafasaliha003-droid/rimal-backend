import { memberHeaders } from '../services/membershipApi.js';
import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, RotateCw, Plus, Minus } from 'lucide-react';
import { API_BASE_URL } from '../services/apiBaseUrl.js';
import { ratehawkReviewsCopy } from '../services/ratehawkReviewsCopy.js';
import { useLanguage } from '../i18n';
import GoogleHotelReviews from './GoogleHotelReviews';

async function reviewPage(hid, language, offset, signal) {
    const request = new AbortController();
    const cancel = () => request.abort();
    signal.addEventListener('abort', cancel, { once:true });
    if (signal.aborted) request.abort();
    const timer = setTimeout(cancel, 20000);
    try {
        const response = await fetch(`${API_BASE_URL}/v1/hotels/${encodeURIComponent(hid)}/reviews/ratehawk?language=${language}&offset=${offset}`, { signal:request.signal, cache:'no-store', headers:memberHeaders() });
        return await response.json();
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}

function Comment({ text, title, positive, copy }) {
    const [expanded, setExpanded] = useState(false);
    if (!text) return null;
    return <div className="mt-5">
        <p className={`mb-2 flex items-center gap-2 text-xs font-bold ${positive ? 'text-teal-700' : 'text-slate-600'}`}>{positive ? <Plus size={14} /> : <Minus size={14} />}{title}</p>
        <p dir="auto" className={`whitespace-pre-line break-words text-sm leading-7 text-slate-700 ${text.length > 220 && !expanded ? 'line-clamp-4' : ''}`}>{text}</p>
        {text.length > 220 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="mt-2 min-h-10 text-xs font-bold text-blue-700">{expanded ? copy.collapse : copy.expand}</button>}
    </div>;
}
function GuestReview({ review, copy, language }) {
    const date = new Date(review.publishedAt);
    return <article data-ratehawk-review className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <header className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{(review.author || copy.author).slice(0, 1)}</span><div className="min-w-0"><p dir="auto" className="break-words text-sm font-bold text-slate-900">{review.author || copy.author}</p>{Number.isFinite(date.getTime()) && <time dateTime={review.publishedAt} className="mt-1 block text-xs text-slate-500">{new Intl.DateTimeFormat(language, { dateStyle:'medium' }).format(date)}</time>}</div></div>
            {review.rating !== null && <span dir="ltr" className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">{Number(review.rating).toFixed(1)}<span className="text-white/60"> / 10</span></span>}
        </header>
        {(review.roomName || review.nights) && <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">{review.roomName && <span dir="auto" className="rounded-lg bg-slate-50 px-2.5 py-2">{review.roomName}</span>}{review.nights && <span className="rounded-lg bg-slate-50 px-2.5 py-2">{copy.nights}: {review.nights}</span>}</div>}
        <Comment text={review.positive} title={copy.positive} positive copy={copy} />
        <Comment text={review.negative} title={copy.negative} copy={copy} />
        {review.excerpt && <p className="mt-3 text-xs text-slate-400">{copy.excerpt}</p>}
    </article>;
}

export default function HotelGuestReviews({ hid, hotelName = '', address = '' }) {
    const { language } = useLanguage(), copy = ratehawkReviewsCopy(language), key = `${hid}:${language}`;
    const [result, setResult] = useState({ key, status:'loading', reviews:[] });
    const [loadingMore, setLoadingMore] = useState(false), [pageError, setPageError] = useState(false), [retry, setRetry] = useState(0);
    const abort = useRef(null);
    const current = result.key === key ? result : { status:'loading', reviews:[] };
    useEffect(() => {
        const controller = new AbortController(); abort.current = controller;
        let timer, attempts = 0;
        const load = async () => {
            try {
                const data = await reviewPage(hid, language, 0, controller.signal);
                if (controller.signal.aborted) return;
                let status = ['ready','empty','checking'].includes(data.status) ? data.status : 'unavailable';
                if (status === 'checking' && ++attempts >= 8) status = 'unavailable';
                setResult({ key, ...data, status, reviews:data.reviews || [] });
                if (status === 'checking') timer = setTimeout(load, 3000);
            } catch { if (!controller.signal.aborted) setResult({ key, status:'unavailable', reviews:[] }); }
        };
        setResult({ key, status:'loading', reviews:[] }); setPageError(false); setLoadingMore(false);
        load();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [key, retry]);
    const more = async () => {
        if (loadingMore) return;
        setLoadingMore(true); setPageError(false);
        const controller = abort.current;
        try {
            const data = await reviewPage(hid, language, current.nextOffset, controller.signal);
            if (!controller.signal.aborted && data.status === 'ready') setResult(previous => ({ ...previous, ...data, key,
                reviews:[...new Map([...previous.reviews, ...data.reviews].map(review => [review.id, review])).values()] }));
            else if (!controller.signal.aborted) setPageError(true);
        } catch { if (!controller.signal.aborted) setPageError(true); }
        finally { if (!controller.signal.aborted) setLoadingMore(false); }
    };
    const ready = current.status === 'ready', summary = current.summary;
    return <div className="space-y-5">
        <section id="hotel-guest-reviews" data-ratehawk-reviews aria-labelledby="guest-reviews-title" aria-busy={['loading','checking'].includes(current.status)} className="scroll-mt-24 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/60 shadow-sm">
            <header className="border-b border-slate-200 bg-white p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-bold text-blue-700">{copy.eyebrow}</span><span className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-500">{copy.source}</span></div>
                <h2 id="guest-reviews-title" className="mt-4 text-2xl font-black text-slate-900">{copy.title}</h2><p className="mt-3 text-sm leading-7 text-slate-500">{copy.intro}</p>
                {current.environment === 'sandbox' && <p className="mt-4 text-xs leading-6 text-slate-500"><span className="me-2 rounded-md bg-amber-50 px-2 py-1 font-bold text-amber-800">{copy.sandbox}</span>{copy.sandboxHint}</p>}
                {ready && Number.isFinite(summary?.score) && <div data-ratehawk-rating className="mt-6 rounded-2xl border border-teal-100 bg-teal-50/60 p-5"><div className="flex flex-wrap items-center gap-5"><div><span dir="ltr" className="text-5xl font-black tracking-tight text-slate-900">{Number(summary.score).toFixed(1)}</span><span className="mx-2 text-sm text-slate-500">{copy.outOf}</span></div><div className="space-y-1"><p className="text-sm font-bold text-slate-800">{copy.average}</p><p className="text-xs text-slate-600">{new Intl.NumberFormat(language).format(summary.count)} {copy.count}</p></div></div><p className="mt-4 text-xs leading-6 text-slate-500">{copy.numeric.replace('{{count}}', new Intl.NumberFormat(language).format(summary.ratedCount))}</p></div>}
                {ready && summary?.categories?.length > 0 && <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">{summary.categories.map(category => <div key={category.key}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="font-semibold text-slate-600">{copy[category.key]}</span><span dir="ltr" className="font-bold text-slate-800">{category.score.toFixed(1)} / 10</span></div><div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600" style={{width:`${category.score * 10}%`}} /></div></div>)}</div>}
            </header>
            <div className="space-y-4 p-5 sm:p-8" aria-live="polite">
                {['loading','checking'].includes(current.status) && <div role="status" className="space-y-4 py-2"><p className="flex items-center gap-2 text-sm text-slate-600"><RotateCw size={17} className="shrink-0 motion-safe:animate-spin" />{current.status === 'checking' ? copy.checking : copy.loading}</p><div className="h-24 rounded-2xl bg-slate-200/60 motion-safe:animate-pulse" />{current.status === 'checking' && <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 text-sm font-bold text-blue-700">{copy.retry}</button>}</div>}
                {ready && <><p className="text-xs leading-6 text-slate-500">{copy.notice}</p>{current.resolvedLanguage === 'en' && language !== 'en' && <p className="text-xs text-slate-500">{copy.language}</p>}{current.capped && <p className="text-xs text-slate-500">{copy.capped}</p>}{current.reviews.map(review => <GuestReview key={review.id} review={review} copy={copy} language={language} />)}{current.hasMore && <button data-more-ratehawk-reviews type="button" disabled={loadingMore} onClick={more} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 disabled:opacity-60">{loadingMore ? copy.loading : copy.more}</button>}{pageError && <p role="status" className="text-sm text-slate-500">{copy.unavailable}</p>}</>}
                {current.status === 'empty' && <div data-ratehawk-empty className="space-y-3 py-4 text-center"><MessageSquareText size={30} className="mx-auto text-slate-400" /><p className="text-sm font-bold text-slate-700">{copy.empty}</p><p className="text-xs leading-6 text-slate-500">{copy.emptyHint}</p></div>}
                {current.status === 'unavailable' && <div className="space-y-3 py-3"><p className="text-sm leading-7 text-slate-600">{copy.unavailable}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-11 text-sm font-bold text-blue-700">{copy.retry}</button></div>}
            </div>
        </section>
        {current.googleAvailable === true && <details data-google-review-option className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer text-sm font-bold text-slate-600">{copy.google}</summary><div className="mt-5"><GoogleHotelReviews key={key} hid={hid} hotelName={hotelName} address={address} /></div></details>}
    </div>;
}
