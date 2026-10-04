import { displayAmount, formatMoney } from '../services/offers';
import { useLanguage } from '../i18n';

export default function PriceDisplay({ amount, currency, displayCurrency, displayRates, className = '' }) {
    const { t } = useLanguage();
    const converted = displayAmount(amount, currency, displayCurrency, displayRates?.rates);
    const estimated = displayCurrency !== currency && converted !== null;
    return <span className={`inline-block ${className}`}>
        <span className="block">{estimated ? `≈ ${formatMoney(converted, displayCurrency)}` : formatMoney(amount, currency)}</span>
        {displayCurrency !== currency && <span className="block text-xs font-normal leading-5 opacity-75">
            {estimated ? <>{t('currency.estimate', 'تقديري · سعر المورد {{price}} · تاريخ الصرف {{date}} ·', { price: formatMoney(amount, currency), date: displayRates.date })} <a href="https://frankfurter.dev/" target="_blank" rel="noopener noreferrer" className="underline">Frankfurter</a>{displayRates.stale && <> · {t('currency.stale', 'سعر صرف مرجعي أقدم')}</>}</> : t('currency.unavailable', 'سعر الصرف غير متاح · سعر المورد {{price}}', { price: formatMoney(amount, currency) })}
        </span>}
    </span>;
}