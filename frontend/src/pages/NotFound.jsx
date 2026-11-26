import { useEffect } from 'react';
import { Headset, Home } from 'lucide-react';
import { useLanguage } from '../i18n';
import { MembershipChrome } from './MembershipPortal';
import '../components/MkhaddaLanding.css';

const copy = {
    ar: { title: 'هذه الصفحة نامت في مكان آخر', body: 'الرابط الذي فتحته غير موجود، أو تغيّر عنوانه. لنرجعك إلى مكان مريح.', home: 'الصفحة الرئيسية', care: 'عناية مخدة' },
    en: { title: 'This page is asleep somewhere else', body: 'The link you opened does not exist, or its address has changed. Let’s take you somewhere comfortable.', home: 'Home page', care: 'Mkhadda care' },
    es: { title: 'Esta página duerme en otro lugar', body: 'El enlace que abriste no existe o su dirección ha cambiado. Te llevamos a un lugar cómodo.', home: 'Página de inicio', care: 'Atención Mkhadda' },
};

/** A real "not found" page: the server answers 404 for these addresses and search engines are told not to index them. */
export default function NotFound({ go }) {
    const { language } = useLanguage(), L = copy[language] || copy.en;
    useEffect(() => {
        let robots = document.head.querySelector('meta[name="robots"]');
        const created = !robots;
        if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); }
        const prior = robots.content; robots.content = 'noindex,follow';
        return () => { if (created) robots.remove(); else robots.content = prior; };
    }, []);
    const open = path => event => { event.preventDefault(); go(path); };
    return <MembershipChrome compact>
        <section className="mk-missing" data-not-found>
            <svg className="mk-missing-art" viewBox="0 0 330 200" role="img" aria-label="404" direction="ltr" style={{ direction: 'ltr' }}>
                <ellipse cx="165" cy="178" rx="96" ry="10" fill="#2d173a12" />
                <text x="26" y="132" fontFamily="Manrope, sans-serif" fontSize="92" fontWeight="700" fill="#c9b7f5">4</text>
                <text x="252" y="132" fontFamily="Manrope, sans-serif" fontSize="92" fontWeight="700" fill="#c9b7f5">4</text>
                <g className="mk-missing-pillow">
                    <path transform="translate(96 44) scale(1.24)" fill="#2D173A" d="M8 8c8-6 26 3 44 2 19 0 36-13 49-8 13 5 5 20 4 33-2 15 12 37 1 45-10 7-31-5-51-5-19 0-31 12-44 10C0 83 6 65 7 49 8 34-2 16 8 8Z" />
                    <path transform="translate(96 44) scale(1.24)" stroke="#FAF8F4" strokeWidth="6.6" strokeLinecap="round" strokeLinejoin="round" fill="none" d="M22 63c4-13 16-16 29-17 13-1 22 6 34 0 15-8 7-23-6-21-12 2-18 15-28 21" />
                </g>
                <text className="mk-missing-z" x="232" y="52" fontFamily="Manrope, sans-serif" fontSize="20" fontWeight="700" fill="#694a88">z</text>
                <text className="mk-missing-z" x="246" y="36" fontFamily="Manrope, sans-serif" fontSize="26" fontWeight="700" fill="#694a88">z</text>
                <text className="mk-missing-z" x="264" y="18" fontFamily="Manrope, sans-serif" fontSize="32" fontWeight="700" fill="#694a88">z</text>
            </svg>
            <h1>{L.title}</h1>
            <p>{L.body}</p>
            <div className="mk-missing-actions">
                <a href="/" onClick={open('/')}><Home size={18} aria-hidden="true" />{L.home}</a>
                <a href="/support" onClick={open('/support')}><Headset size={18} aria-hidden="true" />{L.care}</a>
            </div>
        </section>
    </MembershipChrome>;
}
