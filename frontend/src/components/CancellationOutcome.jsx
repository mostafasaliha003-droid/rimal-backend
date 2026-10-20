import { useState } from 'react';
import { Check, CheckCheck, CreditCard, Download, Mail, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n';
import { formatMoney } from '../services/offers';
import BookingAPI from '../services/bookingApi';

export default function CancellationOutcome({ booking, result, quote, connection }) {
    const { t } = useLanguage();
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState(false);
    const completed = result.customer_refund_status === 'completed';
    const noRefund = result.customer_refund_status === 'not_due';
    const review = ['review', 'not_processed'].includes(result.customer_refund_status);
    const amount = result.customer_refund || quote?.refund;
    const displayAmount = amount ? formatMoney(Number(amount.amount), amount.currency_code) : null;
    const pending = !completed && !noRefund && !review;
    const download = async () => {
        if (downloading) return;
        setDownloading(true); setDownloadError(false);
        try {
            const response = await BookingAPI.getOwnedCancellationReceipt(booking.bookingReference);
            const url = URL.createObjectURL(response.data);
            const anchor = document.createElement('a'); anchor.href = url;
            anchor.download = `Remal-Cancellation-${booking.bookingReference}.pdf`; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { setDownloadError(true); }
        finally { setDownloading(false); }
    };
    return (
        <section data-cancellation-outcome data-refund-state={result.customer_refund_status} className="mt-5 rounded-3xl border border-white bg-gradient-to-br from-cyan-50/70 via-white to-slate-50 p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-black tracking-widest text-slate-700">REMAL</span><span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800"><Check size={12} />{t('cancel.cancelled')}</span></div>
            <div className="mx-auto mt-6 grid h-16 w-16 place-items-center rounded-2xl border border-white bg-emerald-50 text-emerald-700 shadow-sm"><CheckCheck size={30} strokeWidth={1.6} /></div>
            <h3 className="mt-5 text-center text-xl font-extrabold leading-relaxed text-slate-900">{t(completed ? 'cancel.finishTitle' : noRefund ? 'cancel.noRefundTitle' : review ? 'cancel.reviewTitle' : 'cancel.processingTitle')}</h3>
            <p className="mt-3 text-center text-sm leading-7 text-slate-600">{t(completed ? 'cancel.finishBody' : noRefund ? 'cancel.noRefund' : review ? 'cancel.reviewBody' : 'cancel.processingBody')}</p>
            {displayAmount && <div className="mt-5 rounded-2xl border border-cyan-100 bg-white/90 p-4 text-center"><p className="text-xs text-slate-600">{t('cancel.refund')}</p><p dir="ltr" className="mt-2 text-2xl font-black text-cyan-800">{displayAmount}</p><p className="mt-1 text-xs font-semibold text-cyan-800">{t(completed ? 'cancel.gatewayConfirmed' : noRefund ? 'cancel.noRefundTitle' : review ? 'cancel.reviewTitle' : 'cancel.refundProcessing')}</p></div>}
            <button data-cancellation-receipt type="button" disabled={downloading} onClick={download} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"><Download size={17} />{t(downloading ? 'cancel.receiptDownloading' : 'cancel.downloadReceipt')}</button>
            {downloadError && <p role="alert" className="mt-3 text-xs leading-6 text-amber-800">{t('cancel.receiptError')}</p>}
            <ol className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-4 text-xs" aria-label={t('cancel.refundSteps')}>
                <li className="flex gap-3"><Check className="shrink-0 text-emerald-700" size={17} /><span className="flex-1 font-bold text-slate-700">{t('cancel.cancellationStep')}</span><span className="text-emerald-700">{t('tracking.done')}</span></li>
                {!noRefund && <><li className="flex gap-3"><ShieldCheck className="shrink-0 text-cyan-700" size={17} /><span className="flex-1 font-bold text-slate-700">{t('cancel.refundStep')}</span><span className="text-cyan-800">{t(completed ? 'tracking.done' : review ? 'tracking.deliveryAttention' : 'cancel.refundProcessing')}</span></li><li className="flex gap-3"><CreditCard className="shrink-0 text-slate-500" size={17} /><span className="flex-1 text-slate-600">{t('cancel.bankStep')}</span><span className="text-slate-600">{t('cancel.bankTiming')}</span></li></>}
            </ol>
            {pending && <p role="status" className="mt-4 flex items-center justify-center gap-2 text-xs text-cyan-800"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${connection === 'reconnecting' ? 'bg-amber-600' : 'bg-cyan-600 motion-safe:animate-pulse'}`} />{t(connection === 'reconnecting' ? 'cancel.refundReconnecting' : 'cancel.refundLive')}</p>}
            <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-slate-600"><Mail size={16} className="mt-1 shrink-0" />{t(result.receipt_status === 'sent' ? 'cancel.receiptSent' : ['unknown', 'review'].includes(result.receipt_status) ? 'cancel.receiptReview' : result.receipt_status === 'not_requested' ? 'cancel.receiptAvailable' : 'cancel.receiptPreparing')}</p>
            <div className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-600"><span>{t('cancel.requestReference')}</span><p dir="ltr" className="mt-1 select-all break-all font-mono">{result.cancellation_reference || booking.bookingReference}</p><p className="mt-3">{t('cancel.bookingReference')}</p><p dir="ltr" className="mt-1 select-all break-all font-mono">{booking.bookingReference}</p><p className="mt-3 leading-6">{t('cancel.reassurance')}</p></div>
        </section>
    );
}
