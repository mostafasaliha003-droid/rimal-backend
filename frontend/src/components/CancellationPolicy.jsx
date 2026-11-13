import { AlertCircle, Check } from 'lucide-react';
import { useLanguage } from '../i18n';
import { paymentFor } from '../services/offers';
import { formatEtgPolicyTime, policyAmount } from '../services/hotelOfferPresentation.js';

export default function CancellationPolicy({ cancellation, currency, rawRate, contractSource = 'b2b' }) {
    const { t, language } = useLanguage();
    const deadline = formatEtgPolicyTime(cancellation?.free_cancellation_before, language);
    const payment = contractSource === 'affiliate'
        ? rawRate?.payment_options?.payment_types?.find(value => value?.type === 'hotel')
        : paymentFor(rawRate);
    const policies = Array.isArray(cancellation?.policies) ? cancellation.policies.filter(value => value && typeof value === 'object') : [];
    const rows = policies.map(policy => ({ policy,
        start: formatEtgPolicyTime(policy.start_at, language), end: formatEtgPolicyTime(policy.end_at, language),
        amount: policyAmount(policy, { currency, chargeCurrency: payment?.currency_code,
            showCurrency: payment?.show_currency_code, contractSource }) }));
    const hasTime = deadline || rows.some(row => row.start || row.end);
    return <div className="cancellation-policy text-sm">
        <div className={`inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${deadline
            ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
            {deadline ? <Check size={16} className="shrink-0" aria-hidden="true" /> : <AlertCircle size={16} className="shrink-0" aria-hidden="true" />}
            <span className="min-w-0 break-words leading-5">{deadline
                ? <>{t('room.freeCancellationUntil', 'Free cancellation until')} <time dateTime={deadline.iso} className="font-black">{deadline.label}</time></>
                : t('room.noFreeCancellation', 'No confirmed free cancellation for this offer')}</span>
        </div>
        {policies.length > 0 && <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50">
            <summary className="min-h-11 cursor-pointer rounded-xl px-3 py-3 text-sm font-bold text-[var(--remal-blue-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                {t('room.cancellationFees', 'Cancellation fees')}
            </summary>
            <ul className="space-y-3 px-3 pb-3 text-xs leading-6 text-slate-700">{rows.map(({ policy, start, end, amount }, index) => <li key={index} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-slate-200 pt-2">
                <span className="min-w-0 break-words">{policy.start_at == null && policy.end_at == null
                    ? t('room.policyAlways', 'Applies at all times')
                    : <>{policy.start_at == null ? t('room.beforeNextDeadline', 'Before the next deadline') : <>{t('room.from', 'From')} {start ? <time dateTime={start.iso}>{start.label}</time> : t('room.policyTimeUnavailable', 'Policy time not supplied')}</>}
                        {policy.end_at != null && <> {t('room.until', 'until')} {end ? <time dateTime={end.iso}>{end.label}</time> : t('room.policyTimeUnavailable', 'Policy time not supplied')}</>}</>}
                </span>
                {amount ? <span dir="ltr" className="break-words font-bold text-slate-900">{amount.amount} {amount.currency}</span>
                    : <span className="font-semibold text-slate-700">{t('room.policyAmountUnavailable', 'Penalty amount not supplied')}</span>}
            </li>)}</ul>
        </details>}
        {hasTime && <p className="mt-2 text-xs text-slate-600">{t('room.policyUtcNote', 'Cancellation deadlines are shown in UTC.')}</p>}
    </div>;
}
