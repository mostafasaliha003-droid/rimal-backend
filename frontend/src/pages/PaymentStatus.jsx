import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Clock3, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n';
import BookingAPI from '../services/bookingApi';
import { mapCheckoutStatus, persistedAccessToken } from '../services/nextGenCheckout';

const POLL_INTERVAL_MS = 5000;
const POLLING_STATUSES = new Set(['awaiting_payment', 'payment_verified', 'booking_processing', 'booking_pending', 'verifying_payment']);

export default function PaymentStatus({ sessionId: suppliedSessionId, onBack }) {
    const { t, direction } = useLanguage();
    const query = useMemo(() => new URLSearchParams(window.location.search), []);
    const sessionId = suppliedSessionId || query.get('sessionId') || '';
    const queryToken = query.get('accessToken');
    const [status, setStatus] = useState('verifying_payment');
    const [session, setSession] = useState(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const token = useMemo(() => persistedAccessToken(sessionId, queryToken), [sessionId, queryToken]);

    const labels = {
        verifying_payment: {
            title: t('nextgen.statusVerifyingTitle', 'جار التحقق من الدفع'),
            detail: t('nextgen.statusVerifyingBody', 'العودة من بوابة الدفع ليست تأكيدًا. نتحقق الآن من حالة العملية آمنًا.')
        },
        booking_pending: {
            title: t('nextgen.statusBookingTitle', 'الدفع تحقق والحجز قيد المعالجة'),
            detail: t('nextgen.statusBookingBody', 'ننتظر نتيجة تأكيد الفندق. لا تعاود الدفع أو إرسال الحجز.')
        },
        confirmed: {
            title: t('nextgen.statusConfirmedTitle', 'تم تأكيد الحجز'),
            detail: t('nextgen.statusConfirmedBody', 'أكد الفندق الحجز. احتفظ بمعرّف الجلسة للمتابعة إذا لزم الأمر.')
        },
        refund_review: {
            title: t('nextgen.statusRefundTitle', 'العملية قيد مراجعة الاسترداد'),
            detail: t('nextgen.statusRefundBody', 'لم نعد محاولة الحجز تلقائيًا. سيتابع فريق الدعم حالة المبلغ.')
        },
        manual_review: {
            title: t('nextgen.statusManualTitle', 'نحتاج إلى مراجعة يدوية'),
            detail: t('nextgen.statusManualBody', 'لم نتمكن من إثبات النتيجة النهائية. لا تعاود الدفع؛ تواصل مع الدعم.')
        }
    };

    useEffect(() => {
        if (query.has('accessToken')) {
            const clean = new URL(window.location.href);
            clean.searchParams.delete('accessToken');
            window.history.replaceState(window.history.state, '', `${clean.pathname}${clean.search}${clean.hash}`);
        }
    }, [query]);

    useEffect(() => {
        if (!sessionId || !token) {
            setStatus('manual_review');
            setError(t('nextgen.statusCredentialsMissing', 'تعذر العثور على بيانات الوصول الآمنة لهذه الجلسة.'));
            return undefined;
        }
        let active = true;
        let timer;
        const controller = new AbortController();

        const read = async () => {
            try {
                const result = await BookingAPI.getHotelCheckoutSessionStatus(sessionId, token, { signal: controller.signal });
                if (!active) return;
                if (result?.success !== true || result.sessionId !== sessionId) throw new Error('checkout_status_invalid');
                const mapped = mapCheckoutStatus(result.status);
                setSession(result);
                setStatus(mapped);
                setError('');
                if (POLLING_STATUSES.has(result.status) || POLLING_STATUSES.has(mapped)) {
                    timer = window.setTimeout(read, POLL_INTERVAL_MS);
                }
            } catch {
                if (!active || controller.signal.aborted) return;
                setError(t('nextgen.statusFetchFailed', 'تعذر تحديث حالة الدفع. أعد المحاولة، ولا تبدأ جلسة دفع جديدة.'));
                timer = window.setTimeout(read, POLL_INTERVAL_MS * 2);
            }
        };
        void read();
        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [sessionId, token, attempt]);

    const current = labels[status] || labels.manual_review;
    const isTerminal = ['confirmed', 'refund_review', 'manual_review'].includes(status);
    const icon = status === 'confirmed'
        ? <Check size={38} strokeWidth={3} />
        : status === 'verifying_payment' || status === 'booking_pending'
            ? <LoaderCircle size={36} className="animate-spin" />
            : <AlertCircle size={36} />;
    const iconStyle = status === 'confirmed' ? 'bg-emerald-100 text-emerald-700'
        : status === 'verifying_payment' || status === 'booking_pending' ? 'bg-cyan-100 text-remal-blue'
            : status === 'refund_review' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700';

    return (
        <main dir={direction} className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-[radial-gradient(ellipse_at_top,_rgba(15,143,163,0.13),_transparent_55%),linear-gradient(180deg,#f7f9fc,#edf4f7)] px-4 py-10 sm:px-6">
            <section aria-live="polite" className="glass-surface w-full max-w-2xl rounded-3xl border border-white/80 p-7 text-center shadow-float backdrop-blur-2xl sm:p-10">
                <div className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${iconStyle}`}>{icon}</div>
                <p className="eyebrow mt-6 inline-flex items-center gap-2"><ShieldCheck size={14} />{t('nextgen.secureStatus', 'حالة جلسة الدفع الآمنة')}</p>
                <h1 className="mt-3 text-3xl font-black text-remal-navy">{current.title}</h1>
                <p className="mx-auto mt-4 max-w-lg text-base font-semibold leading-7 text-slate-600">{current.detail}</p>

                {session && <dl className="mx-auto mt-7 grid max-w-md grid-cols-2 gap-3 text-start">
                    <div className="rounded-2xl border border-remal-navy/5 bg-white/60 p-4">
                        <dt className="text-xs font-bold text-slate-500">{t('nextgen.sessionId', 'معرّف الجلسة')}</dt>
                        <dd className="mt-1 break-all font-mono text-xs font-black text-remal-navy">{session.sessionId}</dd>
                    </div>
                    <div className="rounded-2xl border border-remal-navy/5 bg-white/60 p-4">
                        <dt className="text-xs font-bold text-slate-500">{t('nextgen.sessionStatus', 'حالة الجلسة')}</dt>
                        <dd className="mt-1 text-sm font-black text-remal-navy">{session.status}</dd>
                    </div>
                </dl>}

                {error && <p role="alert" className="mx-auto mt-6 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">{error}</p>}
                {!isTerminal && !error && <p role="status" className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-slate-500"><Clock3 size={14} />{t('nextgen.autoRefresh', 'سيتم التحديث تلقائيًا كل بضع ثوانٍ')}</p>}
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                    {(error || isTerminal) && <button type="button" onClick={() => { setError(''); setStatus('verifying_payment'); setAttempt(value => value + 1); }} className="glass-light inline-flex min-h-11 items-center gap-2 rounded-xl border border-remal-navy/10 px-5 py-2.5 font-black text-remal-navy"><RefreshCw size={16} />{t('nextgen.retryStatus', 'تحديث الحالة')}</button>}
                    {onBack && <button type="button" onClick={onBack} className="cta-red min-h-11 rounded-xl px-5 py-2.5 font-black text-white">{t('nextgen.home', 'العودة إلى الموقع')}</button>}
                </div>
            </section>
        </main>
    );
}