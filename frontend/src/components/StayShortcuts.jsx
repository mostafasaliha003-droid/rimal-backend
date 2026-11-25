import { Heart, Tickets, LifeBuoy, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../i18n';
const copy = {
    ar: ['خطّط لإقامتك', 'فنادقك المفضلة', 'ارجع إلى الفنادق التي حفظتها', 'حجوزاتي', 'تفاصيل الإقامة والفاوجر', 'الدعم', 'تابع طلبًا مرتبطًا بحجزك'],
    en: ['Plan your stay', 'Saved hotels', 'Revisit hotels you saved', 'My bookings', 'Stay details and vouchers', 'Support', 'Get help with a booking'],
    es: ['Planifica tu estancia', 'Hoteles guardados', 'Vuelve a tus hoteles favoritos', 'Mis reservas', 'Detalles y bonos', 'Soporte', 'Ayuda con tu reserva']
};
export default function StayShortcuts() {
    const { language, direction } = useLanguage(), L = copy[language] || copy.en;
    const Arrow = direction === 'rtl' ? ChevronLeft : ChevronRight;
    return <section className="pillow-shortcuts"><h2>{L[0]}</h2><div>{[[Heart,'/favorites'],[Tickets,'/bookings'],[LifeBuoy,'/support']].map(([Icon,href],index)=>
        <a key={href} href={href}><span className="pillow-shortcut-icon"><Icon size={22}/></span><span><strong>{L[1+index*2]}</strong><small>{L[2+index*2]}</small></span><Arrow size={18}/></a>)}</div></section>;
}
