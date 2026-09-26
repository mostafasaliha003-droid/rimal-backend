import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useLayoutEffect(() => {
        const media = window.matchMedia(query);
        const update = () => setMatches(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [query]);
    return matches;
}

export function AnchoredOverlay({ anchorRef, host, children, className = '', role, id, label, direction }) {
    const ref = useRef(null);
    const [position, setPosition] = useState(null);
    useLayoutEffect(() => {
        if (!host || !anchorRef.current) return undefined;
        let frame;
        const update = () => {
            const anchor = anchorRef.current.getBoundingClientRect();
            const viewport = window.visualViewport;
            const leftEdge = (viewport?.offsetLeft || 0) + 16;
            const topEdge = (viewport?.offsetTop || 0) + 16;
            const rightEdge = (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth) - 16;
            const bottomEdge = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - 16;
            const width = Math.min(Math.max(anchor.width, 320), rightEdge - leftEdge);
            const left = Math.max(leftEdge, Math.min(direction === 'rtl' ? anchor.right - width : anchor.left, rightEdge - width));
            const below = bottomEdge - anchor.bottom - 8;
            const above = anchor.top - topEdge - 8;
            const useAbove = below < 160 && above > below;
            const maxHeight = Math.max(64, useAbove ? above : below);
            const height = Math.min(ref.current?.scrollHeight || 320, maxHeight);
            setPosition({ width, left, top: Math.max(topEdge, useAbove ? anchor.top - height - 8 : anchor.bottom + 8), maxHeight });
        };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
        update();
        const observer = new ResizeObserver(schedule);
        observer.observe(anchorRef.current);
        if (ref.current) observer.observe(ref.current);
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        window.visualViewport?.addEventListener('resize', schedule);
        window.visualViewport?.addEventListener('scroll', schedule);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            window.visualViewport?.removeEventListener('resize', schedule);
            window.visualViewport?.removeEventListener('scroll', schedule);
        };
    }, [anchorRef, host, direction]);
    if (!host) return null;
    return createPortal(<div ref={ref} id={id} role={role} aria-label={label} dir={direction}
        className={`search-popover fixed z-[90] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-2 text-remal-navy shadow-xl supports-[backdrop-filter]:bg-white/[0.92] supports-[backdrop-filter]:backdrop-blur-[20px] ${className}`}
        style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>{children}</div>, host);
}

export function SearchDialog({ id = 'search-editor-dialog', title, closeLabel, onClose, returnFocusRef, initialFocusId, direction, children }) {
    const ref = useRef(null);
    const [host, setHost] = useState(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useLayoutEffect(() => {
        const dialog = ref.current;
        const previous = returnFocusRef?.current || document.activeElement;
        const oldOverflow = document.body.style.overflow;
        dialog.showModal();
        document.body.style.overflow = 'hidden';
        const frame = requestAnimationFrame(() => {
            const target = initialFocusId ? dialog.querySelector(`[id="${initialFocusId}"]`) : null;
            (target || dialog.querySelector('[data-dialog-close]'))?.focus({ preventScroll: true });
        });
        return () => {
            cancelAnimationFrame(frame);
            dialog.close();
            document.body.style.overflow = oldOverflow;
            requestAnimationFrame(() => {
                if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
                else document.getElementById('destination-search')?.focus({ preventScroll: true });
            });
        };
    }, [returnFocusRef, initialFocusId]);
    return createPortal(<dialog ref={ref} id={id} dir={direction} aria-labelledby={`${id}-title`} className="search-dialog"
        onCancel={event => { event.preventDefault(); closeRef.current(); }}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <h2 id={`${id}-title`} className="text-lg font-bold text-remal-navy">{title}</h2>
            <button data-dialog-close type="button" onClick={onClose} aria-label={closeLabel} className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-remal-navy hover:bg-remal-blue/10"><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="p-4">{children(host)}</div>
        <div ref={setHost} data-search-overlay-host />
    </dialog>, document.body);
}