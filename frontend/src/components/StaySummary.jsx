import { useLanguage } from '../i18n';
import { staySummary } from '../services/hotelOfferPresentation.js';

export default function StaySummary({ checkin, checkout, guests, className = '' }) {
    const { t } = useLanguage();
    const summary = staySummary({ checkin, checkout, guests });
    return <div className={`stay-summary min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700 ${className}`}>
        <p className="font-bold text-slate-900">{t('stay.yourStay', 'Your stay')}</p>
        {summary.checkin && summary.checkout
            ? <div className="mt-2 grid grid-cols-2 gap-3">
                <div><p className="text-xs text-slate-600">{t('checkout.checkin', 'Check-in')}</p><time dateTime={summary.checkin} dir="ltr" className="mt-1 block font-semibold">{summary.checkin}</time></div>
                <div><p className="text-xs text-slate-600">{t('checkout.checkout', 'Check-out')}</p><time dateTime={summary.checkout} dir="ltr" className="mt-1 block font-semibold">{summary.checkout}</time></div>
            </div>
            : <p className="mt-1">{t('stay.datesUnavailable', 'Stay dates unavailable')}</p>}
        <p className="mt-1 break-words text-xs font-semibold text-slate-600">{summary.nights !== null
            ? t('stay.summary', 'Nights: {{nights}} · Guests: {{guests}} · Rooms: {{rooms}}', summary)
            : t('stay.guestsSummary', 'Guests: {{guests}} · Rooms: {{rooms}}', summary)}</p>
    </div>;
}
