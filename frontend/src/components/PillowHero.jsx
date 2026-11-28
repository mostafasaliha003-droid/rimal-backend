import { BadgeCheck, LockKeyhole } from 'lucide-react';
import { useLanguage } from '../i18n';

const copy = {
    ar: ['عضوية معتمدة', 'أسعار خاصة للأعضاء المعتمدين', 'حجوزات أريح.', 'أسعار للأعضاء.', 'وين نرتاح اليوم؟', 'إقامتك الجاية تبدأ من مخدة.'],
    en: ['Approved member', 'Private rates for approved members', 'Stay easier.', 'Member rates.', 'Where shall we stay?', 'Find your next stay with Pillow Stays.'],
    es: ['Miembro aprobado', 'Tarifas para miembros aprobados', 'Viaja con calma.', 'Tarifas para miembros.', '¿Dónde nos alojamos?', 'Encuentra tu próxima estancia con Pillow Stays.']
};
export default function PillowHero({ member = false, children }) {
    const { language } = useLanguage();
    const [approved, privateRates, first, second, mobile, description] = copy[language] || copy.en;
    const Icon = member ? BadgeCheck : LockKeyhole;
    return <section className="pillow-hero" id={member ? 'search' : undefined}>
        <div className="pillow-hero-copy">
            <span className="pillow-badge"><Icon size={16} aria-hidden="true" />{member ? approved : privateRates}</span>
            <h1><span className="pillow-hero-title">{first}<br/>{second}</span><span className="pillow-hero-mobile">{member ? mobile : first + ' ' + second}</span></h1>
            <p>{description}</p>{children}
        </div>
        <div className="pillow-hero-photo"><img src="/pillow/dubai.jpg" width="1240" height="730" alt="" fetchPriority="high" /></div>
    </section>;
}
