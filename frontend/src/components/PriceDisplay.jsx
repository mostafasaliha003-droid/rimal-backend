import { displayAmount, formatMoney } from '../services/offers';

export default function PriceDisplay({ amount, currency, displayCurrency, displayRates, className = '' }) {
    const converted = displayAmount(amount, currency, displayCurrency, displayRates?.rates);
    const estimated = displayCurrency !== currency && converted !== null;
    return <span className={`inline-block ${className}`}>
        <span className="block">{estimated ? `≈ ${formatMoney(converted, displayCurrency)}` : formatMoney(amount, currency)}</span>
        {displayCurrency !== currency && <span className="block text-xs font-normal leading-5 opacity-75">
            {estimated ? <>تقديري · سعر المورد {formatMoney(amount, currency)} · صرف {displayRates.date} · <a href="https://frankfurter.dev/" target="_blank" rel="noopener noreferrer" className="underline">Frankfurter</a></> : `سعر الصرف غير متاح · سعر المورد ${formatMoney(amount, currency)}`}
        </span>}
    </span>;
}