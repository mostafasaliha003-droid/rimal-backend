import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck, X } from 'lucide-react';
import BookingAPI from '../services/bookingApi';
import { useLanguage } from '../i18n';
import { formatMoney } from '../services/offers';
import CancellationOutcome from './CancellationOutcome';

const needsTracking = value => value.pending || value.customer_refund_status === 'pending'
    || ['pending', 'sending'].includes(value.receipt_status);

export default function BookingCancellationDialog({ booking, onClose, onCancelled }) {
    const { t, direction } = useLanguage();
    const dialog = useRef(null);
    const [quote, setQuote] = useState(null);
    const [phase, setPhase] = useState('loading');
    const [accepted, setAccepted] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const lastResult = useRef(null);
    lastResult.current = result;
    const [expired, setExpired] = useState(false);
    const [connection, setConnection] = useState('connected');
    const [policyDelayed, setPolicyDelayed] = useState(false);
    const [reload, setReload] = useState(0);
    const submitted = useRef(false);
    useEffect(() => {
        const node = dialog.current;
        node.showModal();
        return () => node.close();
    }, []);
    const load = () => setReload(value => value + 1);
    useEffect(() => {
        let active = true, timer;
        const started = Date.now();
        setPhase('loading'); setError(''); setQuote(null); setAccepted(false); setExpired(false); setPolicyDelayed(false);
        const retry = delay => {
            const pause = Math.max(3000, Number(delay) || 3000);
            if (Date.now() - started + pause >= 120000) { setPhase('error'); setError(t('cancel.loadError')); return; }
            setPolicyDelayed(true);
            timer = setTimeout(check, pause);
        };
        const check = async () => {
            try {
                const value = await BookingAPI.getOwnedCancellationQuote(booking.bookingReference);
                if (!active) return;
                if (value.mode === 'checking') { retry(value.retry_after_ms); return; }
                setQuote(value);
                if (value.mode === 'tracking') {
                    setResult(value.cancellation); submitted.current = true;
                    setPhase(needsTracking(value.cancellation) ? 'tracking' : 'result');
                } else setPhase('review');
            } catch (failure) {
                if (!active) return;
                if (!failure.response || [429, 502, 503, 504].includes(failure.response.status)) {
                    retry(Number(failure.response?.headers?.['retry-after']) * 1000); return;
                }
                setPhase('error'); setError(t('cancel.loadError'));
            }
        };
        void check();
        return () => { active = false; clearTimeout(timer); };
    }, [booking.bookingReference, reload]);
    useEffect(() => {
        if (!quote?.expires_at) return;
        const timer = setTimeout(() => setExpired(true), Math.max(0, quote.expires_at - Date.now()));
        return () => clearTimeout(timer);
    }, [quote]);
    useEffect(() => {
        if (phase !== 'tracking') return;
        let active = true, timer;
        const check = async () => {
            try {
                const current = await BookingAPI.getOwnedCancellationStatus(booking.bookingReference);
                if (!active) return;
                setResult(current);
                setConnection('connected');
                setError('');
                if (current.status === 'cancelled') onCancelled();
                if (!needsTracking(current)) setPhase('result');
                else timer = setTimeout(check, 8000);
            } catch {
                if (active) {
                    setConnection('reconnecting');
                    if (lastResult.current?.status === 'cancelled') timer = setTimeout(check, 15000);
                    else { setError(t('cancel.unknown')); setPhase('result'); }
                }
            }
        };
        void check();
        return () => { active = false; clearTimeout(timer); };
    }, [phase, booking.bookingReference]);
    const submit = async () => {
        if (!accepted || submitted.current || expired || quote?.mode !== 'automatic') return;
        submitted.current = true; setPhase('submitting'); setError('');
        try {
            const current = await BookingAPI.cancelOwnedBooking(booking.bookingReference, quote.quote_token);
            setResult(current);
            if (current.status === 'cancelled') onCancelled();
            setPhase(needsTracking(current) ? 'tracking' : 'result');
        } catch (failure) {
            const code = failure.response?.data?.error;
            if (['cancellation_penalty_changed', 'cancellation_quote_expired_or_changed', 'order_not_cancellable'].includes(code)) {
                submitted.current = false; setQuote(null); setPhase('error'); setError(t('cancel.changed'));
            } else { setError(t('cancel.unknown')); setPhase('tracking'); }
        }
    };
    const money = value => value ? formatMoney(Number(value.amount), value.currency_code) : '—';
    const cancelled = result?.status === 'cancelled';
    const canClose = phase !== 'submitting';
    const support = `mailto:management@remaltourismllc.com?subject=${encodeURIComponent(`Booking cancellation: ${booking.bookingReference}`)}`;
    return (
        <dialog ref={dialog} dir={direction} onCancel={event => { if (!canClose) event.preventDefault(); else onClose(); }}
            aria-labelledby="cancellation-title" className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm sm:p-8">
            <header className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-cyan-700">{t('cancel.eyebrow')}</p><h2 id="cancellation-title" className="mt-2 text-2xl font-extrabold">{t(cancelled ? 'cancel.cancelled' : 'cancel.title')}</h2></div><button autoFocus disabled={!canClose} onClick={onClose} aria-label={t('cancel.close')} className="rounded-full p-2 hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button></header>
            {!cancelled && <><p className="mt-5 font-bold">{booking.hotelName}</p><p dir="ltr" className="mt-1 break-all text-xs text-slate-500">{booking.bookingReference}</p></>}
            <div aria-live="polite" className="mt-6 space-y-4">
                {['loading', 'submitting'].includes(phase) && <p className="flex items-center gap-3 rounded-2xl bg-slate-50 p-5 text-sm"><LoaderCircle className="motion-safe:animate-spin" size={20} />{t(phase === 'loading' ? 'cancel.loading' : 'cancel.submitting')}</p>}
                {phase === 'loading' && <p data-cancellation-policy-wait className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4 text-sm leading-7 text-cyan-950">{t(policyDelayed ? 'cancel.policyDelayed' : 'cancel.policyHint')}</p>}
                {error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-7 text-amber-900">{error}</p>}
                {phase === 'review' && quote && <>
                    {quote.policy && <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-7">{quote.policy}</p>}
                    <dl className="space-y-3 rounded-2xl border border-slate-200 p-5 text-sm">
                        <div className="flex justify-between gap-4"><dt>{t('cancel.paid')}</dt><dd dir="ltr" className="font-bold">{formatMoney(Number(booking.price), booking.priceCurrency)}</dd></div>
                        <div className="flex justify-between gap-4"><dt>{t(quote.fee ? 'cancel.fee' : 'cancel.supplierFee')}</dt><dd dir="ltr" className="font-bold">{money(quote.fee || quote.penalty)}</dd></div>
                        <div className="flex justify-between gap-4 border-t border-slate-100 pt-3"><dt>{t('cancel.refund')}</dt><dd dir={quote.refund ? 'ltr' : undefined} className="font-extrabold text-cyan-800">{quote.refund ? money(quote.refund) : t('cancel.reviewRefund')}</dd></div>
                    </dl>
                    {quote.mode === 'automatic' ? <>
                        <p className="flex gap-2 text-xs leading-6 text-slate-600"><ShieldCheck size={18} className="shrink-0" />{t('cancel.refundNote')}</p>
                        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm leading-7"><input data-cancellation-accept type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-2 h-4 w-4 shrink-0" />{t('cancel.accept')}</label>
                        {expired ? <p role="status" className="text-sm text-amber-800">{t('cancel.expired')}</p> : null}
                        <div className="flex flex-col gap-3 sm:flex-row"><button data-cancellation-confirm disabled={!accepted || expired} onClick={submit} className="min-h-12 flex-1 rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40">{t('cancel.confirm')}</button><button onClick={expired ? load : onClose} className="min-h-12 flex-1 rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold">{t(expired ? 'cancel.refresh' : 'cancel.keep')}</button></div>
                    </> : <p className="rounded-xl bg-amber-50 p-4 text-sm leading-7 text-amber-900">{t('cancel.supportOnly')}</p>}
                </>}
                {cancelled ? <CancellationOutcome booking={booking} result={result} quote={quote} connection={connection} />
                    : (phase === 'tracking' || result) && <div className="rounded-2xl bg-slate-50 p-5 text-sm leading-7"><p className="font-bold">{t(phase === 'tracking' ? 'cancel.tracking' : 'cancel.needsReview')}</p></div>}
                {phase === 'error' && <button onClick={load} className="rounded-xl border px-5 py-3 text-sm font-bold">{t('cancel.refresh')}</button>}
            </div>
            <footer className="mt-6 border-t border-slate-100 pt-5"><a href={support} className="text-sm font-bold text-cyan-800 underline-offset-4 hover:underline">{t('checkout.paymentHelp')}</a></footer>
        </dialog>
    );
}
