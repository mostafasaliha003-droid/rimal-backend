import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Search } from 'lucide-react';
import DestinationCombobox from './DestinationCombobox';
import DateRangeFields from './DateRangeFields';
import GuestSelector, { guestSummary } from './GuestSelector';
import SearchFeedback from './SearchFeedback';
import { SearchDialog, useMediaQuery } from './SearchOverlay';

function SearchForm({ controller, overlayHost, inDialog = false, onSubmitted, onInteractionChange }) {
    const { t, direction, busy } = controller;
    const [overlays, setOverlays] = useState({ destination: false, dates: false, guests: false });
    const [focused, setFocused] = useState(false);
    const frameRef = useRef(null);
    const blurFrame = useRef(null);
    const destinationOpen = useCallback(value => setOverlays(current => current.destination === value ? current : { ...current, destination: value }), []);
    const datesOpen = useCallback(value => setOverlays(current => current.dates === value ? current : { ...current, dates: value }), []);
    const guestsOpen = useCallback(value => setOverlays(current => current.guests === value ? current : { ...current, guests: value }), []);
    const interacting = focused || Object.values(overlays).some(Boolean);
    useEffect(() => { onInteractionChange(interacting); }, [interacting, onInteractionChange]);
    useEffect(() => () => cancelAnimationFrame(blurFrame.current), []);
    return <div ref={frameRef} data-search-scope dir={direction} className="relative min-w-0"
        onFocusCapture={() => setFocused(true)} onBlurCapture={() => {
            cancelAnimationFrame(blurFrame.current);
            blurFrame.current = requestAnimationFrame(() => setFocused(Boolean(frameRef.current?.contains(document.activeElement) || overlayHost?.contains(document.activeElement))));
        }}>
        <h2 id="search-form-title" className="sr-only">{t('search.formTitle', 'ابحث عن فندقك')}</h2>
        <div aria-hidden="true" className="glass-medium search-glass-surface pointer-events-none absolute inset-0 rounded-2xl" />
        <form id="hotel-search-form" role="search" aria-labelledby="search-form-title" aria-busy={busy} noValidate
            onSubmit={async event => {
                event.preventDefault();
                if (await controller.submit()) {
                    if (document.activeElement instanceof HTMLElement && frameRef.current?.contains(document.activeElement)) document.activeElement.blur();
                    onSubmitted?.();
                }
            }} className="relative rounded-2xl p-2 sm:p-3">
            <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
                <DestinationCombobox controller={controller} overlayHost={overlayHost} onOpenChange={destinationOpen} />
                <DateRangeFields controller={controller} overlayHost={overlayHost} onOpenChange={datesOpen} />
                <GuestSelector controller={controller} overlayHost={overlayHost} inDialog={inDialog} onOpenChange={guestsOpen} />
                <button id="search-submit" type="submit" disabled={busy}
                    className="search-submit inline-flex min-h-12 w-full items-center justify-center gap-2 self-center rounded-xl bg-remal-red px-5 py-3 text-base font-bold text-white transition-[transform,box-shadow] duration-300 ease-out focus-visible:ring-2 focus-visible:ring-remal-blue-strong focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-slate-200 disabled:text-slate-600 disabled:shadow-none motion-reduce:transition-none sm:col-span-2 xl:col-span-1">
                    {busy ? <LoaderCircle size={20} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : <Search size={20} className="shrink-0" aria-hidden="true" />}
                    <span className="grid"><span className="invisible col-start-1 row-start-1" aria-hidden="true">{t('search.submitting', 'جارٍ البحث عن الفنادق...')}</span>
                        <span className="col-start-1 row-start-1">{busy ? t('search.submitting', 'جارٍ البحث عن الفنادق...') : t('search.search', 'ابحث الآن')}</span></span>
                </button>
            </div>
            <SearchFeedback controller={controller} />
        </form>
    </div>;
}

export default function SearchShell({ controller }) {
    const { t, direction, query, dates, guests } = controller;
    const desktop = useMediaQuery('(min-width: 1280px)');
    const contentRef = useRef(null);
    const startRef = useRef(null);
    const endRef = useRef(null);
    const summaryRef = useRef(null);
    const [overlayHost, setOverlayHost] = useState(null);
    const [measuredHeight, setMeasuredHeight] = useState(0);
    const [topOffset, setTopOffset] = useState(0);
    const [passed, setPassed] = useState(false);
    const [sticky, setSticky] = useState(false);
    const [compact, setCompact] = useState(false);
    const [editing, setEditing] = useState(false);
    const [interacting, setInteracting] = useState(false);
    const showInline = !editing && (desktop || !compact);

    useLayoutEffect(() => {
        const header = document.querySelector('.site-header');
        if (!header) return undefined;
        const measure = () => {
            const position = getComputedStyle(header).position;
            setTopOffset(['fixed', 'sticky'].includes(position) ? Math.ceil(header.getBoundingClientRect().height) : 0);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(header);
        measure();
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        if (!showInline || !contentRef.current) return undefined;
        const measure = () => setMeasuredHeight(Math.ceil(contentRef.current.getBoundingClientRect().height));
        const observer = new ResizeObserver(measure);
        observer.observe(contentRef.current);
        measure();
        return () => observer.disconnect();
    }, [showInline, desktop]);

    useEffect(() => {
        const observer = new IntersectionObserver(entries => entries.forEach(entry => {
            if (entry.target === startRef.current) setSticky(entry.boundingClientRect.top < topOffset);
            if (entry.target === endRef.current) setPassed(entry.boundingClientRect.top < topOffset);
        }), { rootMargin: `-${topOffset}px 0px 0px 0px`, threshold: [0, 1] });
        observer.observe(startRef.current);
        observer.observe(endRef.current);
        return () => observer.disconnect();
    }, [topOffset]);

    useEffect(() => {
        if (!interacting && !editing) setCompact(!desktop && passed);
    }, [desktop, passed, interacting, editing]);

    const closeEditor = () => { setEditing(false); setInteracting(false); };
    return <>
        <div ref={startRef} aria-hidden="true" className="h-px" />
        <div data-search-shell data-sticky={sticky} dir={direction}
            className="search-shell mx-auto w-full max-w-7xl px-5 lg:px-10"
            style={{ '--search-top': `${topOffset}px`, minHeight: showInline ? undefined : measuredHeight }}>
            {showInline && <div ref={contentRef}><SearchForm controller={controller} overlayHost={overlayHost} onInteractionChange={setInteracting} /></div>}
        </div>
        <div ref={endRef} aria-hidden="true" className="h-px" />
        {createPortal(<div ref={setOverlayHost} data-search-overlay-host />, document.body)}
        {compact && !desktop && createPortal(<div data-search-compact dir={direction} className="fixed inset-x-0 z-40 border-b border-slate-200 bg-white px-4 py-2 shadow-sm supports-[backdrop-filter]:bg-white/[0.92] supports-[backdrop-filter]:backdrop-blur-[20px]"
            style={{ top: topOffset }}>
            <button ref={summaryRef} type="button" aria-haspopup="dialog" aria-expanded={editing} onClick={() => setEditing(true)}
                className="mx-auto flex min-h-12 w-full max-w-7xl items-center gap-3 rounded-xl text-start text-remal-navy">
                <Search size={22} className="shrink-0 text-remal-blue-strong" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block truncate font-bold">{query || t('search.destination', 'الوجهة أو الفندق')}</span>
                    <span className="block truncate text-xs">{dates.checkin && dates.checkout ? `${dates.checkin} — ${dates.checkout}` : t('search.stayDates', 'تواريخ الإقامة')} · {guestSummary(guests, t)}</span></span>
                <span className="rounded-lg bg-remal-blue/10 px-3 py-2 text-sm font-bold text-remal-blue-strong">{t('search.edit', 'تعديل البحث')}</span>
            </button>
        </div>, document.body)}
        {editing && <SearchDialog title={t('search.edit', 'تعديل البحث')} closeLabel={t('search.close', 'إغلاق')} onClose={closeEditor}
            returnFocusRef={summaryRef} initialFocusId="destination-search" direction={direction}>
            {host => <SearchForm controller={controller} overlayHost={host} inDialog onSubmitted={closeEditor} onInteractionChange={setInteracting} />}
        </SearchDialog>}
    </>;
}