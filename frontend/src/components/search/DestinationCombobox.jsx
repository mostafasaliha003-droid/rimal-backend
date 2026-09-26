import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MapPin, X } from 'lucide-react';
import { AnchoredOverlay } from './SearchOverlay';
import { FieldError } from './SearchFeedback';

export default function DestinationCombobox({ controller, overlayHost, onOpenChange }) {
    const { t, direction, query, suggestions, suggestionStatus, errors, changeQuery, selectDestination } = controller;
    const anchorRef = useRef(null);
    const inputRef = useRef(null);
    const [expanded, setExpanded] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const open = expanded && suggestions.length > 0 && suggestionStatus === 'ready';
    const active = open && activeIndex >= 0 ? suggestions[activeIndex] : null;
    const optionId = item => `destination-option-${item.key}`;
    useEffect(() => { setActiveIndex(-1); }, [suggestions]);
    useEffect(() => { onOpenChange(open); return () => onOpenChange(false); }, [open, onOpenChange]);
    useEffect(() => {
        if (!active) return;
        const item = document.getElementById(optionId(active));
        const list = document.getElementById('destination-suggestions')?.parentElement;
        if (!item || !list) return;
        const rect = item.getBoundingClientRect();
        const box = list.getBoundingClientRect();
        if (rect.bottom > box.bottom) list.scrollTop += rect.bottom - box.bottom;
        else if (rect.top < box.top) list.scrollTop -= box.top - rect.top;
    }, [active]);

    const choose = item => {
        selectDestination(item);
        setExpanded(false);
        setActiveIndex(-1);
        inputRef.current?.focus({ preventScroll: true });
    };
    const onKeyDown = event => {
        if (event.nativeEvent.isComposing) return;
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && suggestions.length) {
            event.preventDefault();
            setExpanded(true);
            setActiveIndex(index => event.key === 'ArrowDown' ? Math.min(open ? index + 1 : 0, suggestions.length - 1)
                : open && index >= 0 ? Math.max(0, index - 1) : suggestions.length - 1);
        } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (active) choose(active);
        } else if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            setExpanded(false);
            setActiveIndex(-1);
        } else if (event.key === 'Tab') setExpanded(false);
    };

    return <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <div ref={anchorRef} className={`search-field ${errors.destination ? 'search-field-invalid' : ''}`}>
            <label htmlFor="destination-search" className="search-label">{t('search.destination', 'الوجهة أو الفندق')}</label>
            <div className="flex min-w-0 items-center gap-2">
                <MapPin size={20} className="shrink-0 text-remal-blue-strong" aria-hidden="true" />
                <input ref={inputRef} id="destination-search" name="destination" type="text" role="combobox" autoComplete="off"
                    aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? 'destination-suggestions' : undefined}
                    aria-activedescendant={active ? optionId(active) : undefined} aria-required="true"
                    aria-invalid={Boolean(errors.destination)} aria-describedby={errors.destination ? 'search-destination-error' : 'search-destination-hint'}
                    aria-busy={suggestionStatus === 'loading'} value={query} placeholder={t('search.destinationPlaceholder', 'ابحث عن وجهة أو فندق...')}
                    className="search-input" onChange={event => { changeQuery(event.target.value); setExpanded(true); setActiveIndex(-1); }}
                    onFocus={() => setExpanded(true)} onBlur={() => setExpanded(false)} onKeyDown={onKeyDown} />
                {suggestionStatus === 'loading' && <LoaderCircle size={18} className="shrink-0 motion-safe:animate-spin text-remal-blue-strong" aria-hidden="true" />}
                {query && <button type="button" aria-label={t('search.clearDestination', 'مسح الوجهة')} className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-remal-navy hover:bg-remal-blue/10"
                    onClick={() => { changeQuery(''); inputRef.current?.focus(); }}><X size={18} aria-hidden="true" /></button>}
            </div>
        </div>
        <span id="search-destination-hint" className="sr-only">{t('search.destinationHint', 'ابحث باسم الوجهة أو الفندق، ثم اختر من الاقتراحات.')}</span>
        <FieldError field="destination" message={errors.destination} />
        {open && <AnchoredOverlay anchorRef={anchorRef} host={overlayHost} direction={direction}>
            <ul id="destination-suggestions" role="listbox" aria-label={t('search.suggestions', 'اقتراحات الوجهات')}>
                {suggestions.map((item, index) => <li key={item.key} id={optionId(item)} role="option" aria-selected={index === activeIndex}
                    className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-xl px-3 py-3 text-start text-sm ${index === activeIndex ? 'bg-remal-blue/10 text-remal-blue-strong' : 'text-remal-navy hover:bg-remal-blue/5'}`}
                    onPointerDown={event => event.preventDefault()} onClick={() => choose(item)}>
                    <MapPin size={16} className="shrink-0" aria-hidden="true" /><span className="min-w-0 flex-[1_1_10rem] [overflow-wrap:anywhere]">{item.label}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">{item.type === 'hotel' ? t('search.hotelType', 'فندق') : t('search.destinationType', 'وجهة سفر')}</span>
                </li>)}
            </ul>
        </AnchoredOverlay>}
    </div>;
}