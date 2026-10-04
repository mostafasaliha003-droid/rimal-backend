import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n';
import BookingAPI from '../services/bookingApi';
import { formatAedPrice, sessionAccessTokenFromStorage } from '../services/nextGenCheckout';

function safeReturnUrl(value, sessionId) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.origin !== window.location.origin || url.pathname !== '/payment-status'
            || url.searchParams.get('sessionId') !== sessionId || url.searchParams.has('accessToken')) return null;
        return url.href;
    } catch { return null; }
}

export default function MockPaymentPage() {
    const { t, direction } = useLanguage();
    const query = useMemo(() => new URLSearchParams(window.location.search), []);
    const sessionId = query.get('sessionId') || '';
    const returnUrl = safeReturnUrl(query.get('return_url'), sessionId);
    const accessToken = sessionAccessTokenFromStorage(sessionId);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!sessionId || !accessToken || !returnUrl) {
            setError(t('nextgen.mockPaymentInvalid', 'تعذر التحقق من جلسة الدفع التجريبية.'));
            setLoading(false);
            return undefined;
        }
        const controller = new AbortController();
        let active = true;
        BookingAPI.getHotelCheckoutSessionStatus(sessionId, accessToken, { signal: controller.signal })
            .then(result => {
                if (!active) return;
                if (result?.success !== true || result.sessionId !== sessionId) {
                    setError(t('nextgen.mockPaymentInvalid', 'تعذر التحقق من جلسة الدفع التجريبية.'));
                    setLoading(false);
                    return;
                }
                setSession(result);
                setLoading(false);
            })
            .catch(() => {
                if (!active) return;
                setError(t('nextgen.mockPaymentInvalid', 'تعذر التحقق من جلسة الدفع التجريبية.'));
                setLoading(false);
            });
        return () => { active = false; controller.abort(); };
    }, [sessionId, accessToken, returnUrl]);

    const completePayment = async () => {
        if (!session || session.status !== 'awaiting_payment' || submitting) return;
        setSubmitting(true);
        setError('');
        try {
            const result = await BookingAPI.completeMockHotelPayment(sessionId, accessToken);
            if (result?.success !== true || result.sessionId !== sessionId) throw new Error('mock_payment_result_invalid');
            window.location.replace(returnUrl);
        } catch {
            setError(t('nextgen.mockPaymentFailed', 'تعذر إرسال نتيجة الدفع التجريبية. أعد المحاولة أو تواصل مع الدعم.'));
            setSubmitting(false);
        }
    };

    const amount = session?.currency === 'AED' && Number.isSafeInteger(session.totalAmount)
        ? formatAedPrice(`${BigInt(session.totalAmount) / 100n}.${String(BigInt(session.totalAmount) % 100n).padStart(2, '0')}`, 'AED') : null;

    return (
        <main dir={direction} className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-[radial-gradient(ellipse_at_top,_rgba(15,143,163,0.13),_transparent_55%),linear-gradient(180deg,#f7f9fc,#edf4f7)] px-4 py-10 sm:px-6">
            <section className="glass-surface w-full max-w-lg rounded-3xl border border-white/80 p-7 text-center shadow-float backdrop-blur-2xl sm:p-10">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-100 text-remal-blue"><CreditCard size={30} /></div>
                <p className="eyebrow mt-5 inline-flex items-center gap-2"><ShieldCheck size={14} />{t('nextgen.mockOnly', 'محاكاة دفع محلية — لا توجد معاملة مصرفية')}</p>
                <h1 className="mt-3 text-3xl font-black text-remal-navy">{t('nextgen.mockPaymentTitle', 'بوابة الدفع التجريبية')}</h1>
                {loading ? <p role="status" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-slate-600"><LoaderCircle size={18} className="animate-spin" />{t('nextgen.mockPaymentLoading', 'جار التحقق من جلسة الدفع...')}</p> : (
                    <>
                        <p className="mt-5 text-sm font-semibold text-slate-600">{t('nextgen.mockPaymentBody', 'هذه صفحة اختبار محلية. لن يتم خصم أي مبلغ حقيقي.')}</p>
                        <p className="mt-6 text-xs font-bold text-slate-500">{t('nextgen.total', 'إجمالي الإقامة')}</p>
                        <p className="mt-1 text-3xl font-black tabular-nums text-remal-navy">{amount || t('nextgen.priceUnavailable', 'السعر غير متاح')}</p>
                        {session && <p className="mt-3 break-all font-mono text-xs font-bold text-slate-500">{session.sessionId}</p>}
                        {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
                        <button type="button" disabled={!session || session.status !== 'awaiting_payment' || submitting || !returnUrl}
                            onClick={completePayment} className="cta-red mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-black text-white disabled:opacity-60">
                            {submitting ? <LoaderCircle size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                            {submitting ? t('nextgen.mockPaymentSubmitting', 'جار تأكيد المحاكاة...') : t('nextgen.mockPaymentComplete', 'محاكاة دفع ناجح')}
                        </button>
                        <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">{t('nextgen.mockPaymentNoBank', 'لا تدخل بيانات بطاقة. سيرسل الخادم حدث اختبار موقّعًا بعد تحقق الجلسة.')}</p>
                    </>
                )}
            </section>
        </main>
    );
}