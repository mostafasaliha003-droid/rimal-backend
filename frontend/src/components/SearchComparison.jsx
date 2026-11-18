import { useLanguage } from '../i18n';
import { cheapestRate, rateAmount, paymentFor, rateCurrency } from '../services/offers';
import PriceDisplay from './PriceDisplay';
const copy={
    ar:['مقارنة الفنادق','إجمالي الإقامة','الغرفة','الوجبات','الإلغاء المجاني حتى','الموقع','المرافق','غير محدد من المورد'],
    en:['Compare hotels','Stay total','Room','Board','Free cancellation until','Location','Amenities','Not supplied'],
    es:['Comparar hoteles','Total','Habitación','Comidas','Cancelación gratuita hasta','Ubicación','Servicios','Sin datos del proveedor']
};
export default function SearchComparison({ hotels, displayCurrency, displayRates }) {
    const {language}=useLanguage(), T=copy[language]||copy.en;
    if(hotels.length<2)return null;
    const columns=hotels.map(h=>{
        const r=cheapestRate(h.rates || []), policy=paymentFor(r)?.cancellation_penalties, expires=Date.parse(policy?.free_cancellation_before);
        const amenities=h.amenities || h.staticData?.amenities || r?.amenities || [];
        return [r && <PriceDisplay amount={rateAmount(r)} currency={rateCurrency(r)} displayCurrency={displayCurrency} displayRates={displayRates}/>,
            r?.room_name || r?.room_data_trans?.main_name,r?.meal,
            Number.isFinite(expires) ? new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(expires)+' UTC' : null,
            h.address || h.staticData?.address || h.city,
            Array.isArray(amenities)?amenities.map(a=>typeof a==='string'?a:a?.name).filter(Boolean).slice(0,6).join(' · '):null];
    });
    return <div className="pillow-comparison" role="region" aria-label={T[0]} tabIndex="0"><table><caption>{T[0]}</caption><thead><tr><th scope="col">{T[0]}</th>{hotels.map(h=><th key={h.hid||h.id} scope="col">{h.name}</th>)}</tr></thead><tbody>{T.slice(1,7).map((label,index)=><tr key={label}><th scope="row">{label}</th>{columns.map((col,i)=><td key={i}>{col[index] || T[7]}</td>)}</tr>)}</tbody></table></div>;
}
