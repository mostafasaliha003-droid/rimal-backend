import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { AnchoredOverlay, SearchDialog, useMediaQuery } from './SearchOverlay';
import { FieldError } from './SearchFeedback';

export function guestSummary(guests, t) {
    return t('search.guestSummary', '{{rooms}} غرف، {{guests}} ضيوف', {
        rooms: guests.length,
        guests: guests.reduce((total, room) => total + room.adults + room.children.length, 0)
    });
}

function GuestEditor({ controller, onClose }) {
    const { t, guests, changeGuests, errors } = controller;
    const update = (index, patch) => changeGuests(guests.map((room, position) => position === index ? { ...room, ...patch } : room));
    return <div className="space-y-4 p-2">
        {guests.map((room, index) => <fieldset key={index} className="min-w-0 space-y-3 border-b border-slate-200 pb-4">
            <legend className="mb-3 font-bold">{t('search.room', 'غرفة')} {index + 1}</legend>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`guests-${index}-adults`}>{t('search.adults', 'البالغون')}</label>
                <select id={`guests-${index}-adults`} aria-label={`${t('search.adults', 'البالغون')} ${t('search.inRoom', 'في غرفة')} ${index + 1}`}
                    value={room.adults} onChange={event => update(index, { adults: Number(event.target.value) })} className="search-guest-control">
                    {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`guests-${index}-children`}>{t('search.children', 'الأطفال')}</label>
                <select id={`guests-${index}-children`} aria-label={`${t('search.children', 'الأطفال')} ${t('search.inRoom', 'في غرفة')} ${index + 1}`}
                    value={room.children.length} onChange={event => update(index, { children: Array.from({ length: Number(event.target.value) }, (_, child) => room.children[child] ?? '') })} className="search-guest-control">
                    {[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
            </div>
            {room.children.map((age, child) => <div key={child} className="flex flex-wrap items-center justify-between gap-2">
                <label className="min-w-0 flex-[1_1_9rem]" htmlFor={`guests-${index}-age-${child}`}>{t('search.childAge', 'عمر الطفل {{number}} عند الوصول', { number: child + 1 })}</label>
                <select id={`guests-${index}-age-${child}`} aria-label={t('search.childAgeInRoom', 'عمر الطفل {{child}} في غرفة {{room}}', { child: child + 1, room: index + 1 })}
                    value={age} aria-invalid={Boolean(errors.guests && age === '')} aria-describedby={errors.guests ? 'search-guests-error' : undefined}
                    onChange={event => update(index, { children: room.children.map((value, position) => position === child ? (event.target.value === '' ? '' : Number(event.target.value)) : value) })} className="search-guest-control">
                    <option value="">{t('search.choose', 'اختر')}</option>
                    {Array.from({ length: 18 }, (_, value) => <option key={value} value={value}>{value}</option>)}
                </select>
            </div>)}
            {guests.length > 1 && <button type="button" className="min-h-10 rounded-lg px-2 text-sm font-bold text-remal-danger underline"
                onClick={() => {
                    changeGuests(guests.filter((_, position) => position !== index));
                    requestAnimationFrame(() => document.getElementById('guests-0-adults')?.focus());
                }}>{t('search.removeRoom', 'إزالة الغرفة')} {index + 1}</button>}
        </fieldset>)}
        {guests.length < 4 && <button type="button" onClick={() => {
            changeGuests([...guests, { adults: 2, children: [] }]);
            requestAnimationFrame(() => document.getElementById(`guests-${guests.length}-adults`)?.focus());
        }} className="min-h-12 w-full rounded-xl bg-remal-blue/10 px-4 font-bold text-remal-blue-strong">{t('search.addRoom', 'إضافة غرفة')}</button>}
        <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl bg-remal-navy px-4 py-3 font-bold text-white">{t('search.done', 'تم')}</button>
    </div>;
}

export default function GuestSelector({ controller, overlayHost, inDialog, onOpenChange }) {
    const { t, direction, guests, errors } = controller;
    const [open, setOpen] = useState(false);
    const anchorRef = useRef(null);
    const buttonRef = useRef(null);
    const mobile = useMediaQuery('(max-width: 767px)');
    const modal = mobile && !inDialog;
    const close = () => { setOpen(false); if (!modal) buttonRef.current?.focus({ preventScroll: true }); };
    useEffect(() => { onOpenChange(open); return () => onOpenChange(false); }, [open, onOpenChange]);
    useEffect(() => {
        if (!open || modal) return undefined;
        const frame = requestAnimationFrame(() => document.getElementById('guests-0-adults')?.focus({ preventScroll: true }));
        const escape = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close();
        };
        const outside = event => {
            if (!anchorRef.current?.contains(event.target) && !document.getElementById('search-guests-panel')?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('keydown', escape, true);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', escape, true);
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
        };
    }, [open, modal]);
    return <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <div ref={anchorRef} className={`search-field ${errors.guests ? 'search-field-invalid' : ''}`}>
            <span id="search-guests-label" className="search-label">{t('search.guests', 'الضيوف')}</span>
            <button ref={buttonRef} id="search-guests" type="button" aria-labelledby="search-guests-label search-guests-value"
                aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'search-guests-panel' : undefined}
                aria-invalid={Boolean(errors.guests)} aria-describedby={errors.guests ? 'search-guests-error' : undefined}
                onClick={() => setOpen(value => !value)} className="flex min-h-10 w-full items-center gap-2 rounded-lg text-start font-bold">
                <Users size={20} className="shrink-0 text-remal-blue-strong" aria-hidden="true" /><span id="search-guests-value" className="min-w-0 [overflow-wrap:anywhere]">{guestSummary(guests, t)}</span>
            </button>
        </div>
        <FieldError field="guests" message={errors.guests} />
        {open && (modal ? <SearchDialog id="search-guests-panel" title={t('search.guests', 'الضيوف')} closeLabel={t('search.close', 'إغلاق')} onClose={close}
            returnFocusRef={buttonRef} initialFocusId="guests-0-adults" direction={direction}>
            {() => <GuestEditor controller={controller} onClose={close} />}
        </SearchDialog> : <AnchoredOverlay anchorRef={anchorRef} host={overlayHost} id="search-guests-panel" role="dialog" label={t('search.guests', 'الضيوف')} direction={direction}>
            <div onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
                <GuestEditor controller={controller} onClose={close} />
            </div>
        </AnchoredOverlay>)}
    </div>;
}