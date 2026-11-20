import { ArrowUpRight, Building2, MapPin, Mail } from 'lucide-react';
import { useLanguage } from '../i18n';
import './CompanyFooter.css';

const copy = {
    ar: {
        name: 'Remal Group LLC FZ', tagline: 'إقامتك تبدأ من هنا', operator: 'الشركة المشغّلة',
        office: 'مكتبنا في دبي',
        address: 'دائرة السياحة والاقتصاد، نفس البناء الحكومي، بلوك ب، مكتب 610',
        city: 'ميناء سعيد، دبي، الإمارات العربية المتحدة', directions: 'عرض الموقع على الخريطة',
        registration: 'بيانات الشركة', licence: 'رقم الترخيص', since: 'مسجلون في الإمارات منذ 2023',
        contact: 'تواصل معنا', privacy: 'الخصوصية', deletion: 'طلب حذف الحساب', terms: 'الشروط والأحكام', rights: 'جميع الحقوق محفوظة',
    },
    en: {
        name: 'Remal Group LLC FZ', tagline: 'Your stay starts here', operator: 'Operating company',
        office: 'Our Dubai office',
        address: 'Department of Economy and Tourism, same government building, Block B, Office 610',
        city: 'Port Saeed, Dubai, United Arab Emirates', directions: 'View location on map',
        registration: 'Company information', licence: 'Licence number', since: 'Registered in the UAE since 2023',
        contact: 'Get in touch', privacy: 'Privacy', deletion: 'Request account deletion', terms: 'Terms & conditions', rights: 'All rights reserved',
    },
    es: {
        name: 'Remal Group LLC FZ', tagline: 'Tu estancia empieza aquí', operator: 'Empresa operadora',
        office: 'Nuestra oficina en Dubái',
        address: 'Departamento de Economía y Turismo, mismo edificio gubernamental, Bloque B, oficina 610',
        city: 'Port Saeed, Dubái, Emiratos Árabes Unidos', directions: 'Ver ubicación en el mapa',
        registration: 'Información de la empresa', licence: 'Número de licencia', since: 'Registrados en EAU desde 2023',
        contact: 'Contáctanos', privacy: 'Privacidad', deletion: 'Solicitar eliminación de cuenta', terms: 'Términos y condiciones', rights: 'Todos los derechos reservados',
    },
};

export default function CompanyFooter() {
    const { language, direction } = useLanguage();
    const L = copy[language] || copy.en;
    const mapQuery = 'Department of Economy and Tourism, Block B, Office 610, Port Saeed, Dubai, UAE';
    return <footer className="remal-company-footer" dir={direction}>
        <div className="remal-company-footer-main">
            <a href={`/?lang=${language}`} className="remal-company-footer-brand">
                <img src="/pillow-symbol.png" alt="" width="80" height="80" loading="lazy" decoding="async" />
                <span><strong><bdi>مخدة | pillow stays</bdi></strong><small>{L.tagline}</small></span>
            </a>
            <section className="remal-company-footer-office">
                <h2><MapPin size={18} aria-hidden="true" />{L.office}</h2>
                <address>{L.address}<br /><span>{L.city}</span></address>
                <a className="remal-company-footer-map" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noopener noreferrer">{L.directions}<ArrowUpRight size={16} aria-hidden="true" /></a>
            </section>
            <section className="remal-company-footer-registration">
                <h2><Building2 size={18} aria-hidden="true" />{L.registration}</h2>
                <p className="remal-company-footer-operator">{L.operator}<strong><bdi dir="ltr">{L.name}</bdi></strong></p>
                <p>{L.licence}<strong><bdi dir="ltr">2312342.01</bdi></strong></p>
                <span className="remal-company-footer-since">{L.since}</span>
            </section>
        </div>
        <div className="remal-company-footer-bottom">
            <span>© {new Date().getFullYear()} {L.name} · {L.rights}</span>
            <nav aria-label={L.contact}>
                <a href="mailto:management@remaltourismllc.com"><Mail size={15} aria-hidden="true" />{L.contact}</a>
                <a href={`/privacy?lang=${language}`}>{L.privacy}</a>
                <a href={`/account-deletion?lang=${language}`}>{L.deletion}</a>
                <a href={`/terms?lang=${language}`}>{L.terms}</a>
            </nav>
        </div>
    </footer>;
}
