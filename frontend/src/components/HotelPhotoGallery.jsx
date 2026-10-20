import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { useLanguage } from '../i18n';

export default function HotelPhotoGallery({ images, name, initialIndex = 0, onClose }) {
    const { t, direction } = useLanguage();
    const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, images.length - 1)));
    const [failed, setFailed] = useState(false);
    const dialog = useRef(null);
    const startX = useRef(null);
    const thumbs = useRef(null);
    const move = step => setIndex(current => (current + step + images.length) % images.length);
    useEffect(() => {
        const node = dialog.current;
        const priorOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        node.showModal();
        return () => { node.close(); document.body.style.overflow = priorOverflow; };
    }, []);
    useEffect(() => {
        setFailed(false);
        thumbs.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [index]);
    return (
        <dialog data-hotel-gallery ref={dialog} dir={direction} onCancel={onClose}
            onKeyDown={event => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.preventDefault();
                if (event.key === 'ArrowRight') move(direction === 'rtl' ? -1 : 1);
                if (event.key === 'ArrowLeft') move(direction === 'rtl' ? 1 : -1);
                if (event.key === 'Home') setIndex(0);
                if (event.key === 'End') setIndex(images.length - 1);
            }} aria-labelledby="gallery-title" className="fixed inset-0 m-0 h-[100svh] max-h-none w-screen max-w-none border-0 bg-slate-950 p-0 text-white backdrop:bg-slate-950/95">
            <div className="flex h-full flex-col">
                <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-7">
                    <div className="min-w-0"><h2 id="gallery-title" className="truncate text-sm font-bold">{name || t('hotel.photos')}</h2><p aria-live="polite" className="mt-1 text-xs text-slate-300">{t('gallery.counter', '{{current}} / {{total}}', { current: index + 1, total: images.length })}</p></div>
                    <button autoFocus onClick={onClose} aria-label={t('gallery.close')} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/20 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><X size={21} /></button>
                </header>
                <div className="relative min-h-0 flex-1 p-3 sm:p-6" onTouchStart={event => { startX.current = event.touches[0]?.clientX; }} onTouchEnd={event => {
                    const endX = event.changedTouches[0]?.clientX;
                    if (startX.current !== null && Number.isFinite(endX) && Math.abs(endX - startX.current) > 45) move(endX < startX.current ? 1 : -1);
                    startX.current = null;
                }}>
                    {failed ? <div role="status" className="grid h-full place-content-center justify-items-center gap-3 text-sm text-slate-300"><ImageOff size={34} />{t('gallery.failed')}</div>
                        : <img key={images[index]} data-gallery-photo src={images[index]} alt={t('gallery.alt', '{{name}} · {{current}}', { name: name || t('hotel.photos'), current: index + 1 })} onError={() => setFailed(true)} className="h-full w-full object-contain" />}
                    {images.length > 1 && <><button data-gallery-prev onClick={() => move(-1)} aria-label={t('gallery.previous')} className={`absolute ${direction === 'rtl' ? 'right-3' : 'left-3'} top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-slate-950/70 backdrop-blur-sm hover:bg-slate-800`}>{direction === 'rtl' ? <ChevronRight size={23} /> : <ChevronLeft size={23} />}</button><button data-gallery-next onClick={() => move(1)} aria-label={t('gallery.next')} className={`absolute ${direction === 'rtl' ? 'left-3' : 'right-3'} top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-slate-950/70 backdrop-blur-sm hover:bg-slate-800`}>{direction === 'rtl' ? <ChevronLeft size={23} /> : <ChevronRight size={23} />}</button></>}
                </div>
                <nav ref={thumbs} aria-label={t('gallery.thumbnails')} className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 px-4 py-3">
                    {images.map((image, photoIndex) => <button key={`${image}:${photoIndex}`} aria-label={t('gallery.select', 'Photo {{current}}', { current: photoIndex + 1 })} aria-current={photoIndex === index ? 'true' : undefined} onClick={() => setIndex(photoIndex)} className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${photoIndex === index ? 'border-cyan-300' : 'border-transparent opacity-60 hover:opacity-100'}`}><img src={image} alt="" loading="lazy" className="h-full w-full object-cover" /></button>)}
                </nav>
            </div>
        </dialog>
    );
}
