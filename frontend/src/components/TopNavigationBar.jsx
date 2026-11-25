import { useState } from 'react';
import { BadgeCheck, Bell, Compass, Gift, Globe2, Heart, LifeBuoy, Menu, Tickets, UserRound, X } from 'lucide-react';
import PillowBrand from './PillowBrand';
import PwaStatus from './PwaStatus';
import { DISPLAY_CURRENCIES, SEARCH_CURRENCY } from '../services/offers';
import { trackBookingEvent } from '../services/analytics';
import { useLanguage } from '../i18n';

const labels = {
    ar: ['اكتشف', 'المفضلة', 'حجوزاتي', 'حسابي', 'عضو معتمد', 'الدعم', 'برنامج الولاء', 'عملة العرض', 'القائمة'],
    en: ['Discover', 'Saved', 'My bookings', 'Account', 'Approved member', 'Support', 'Loyalty', 'Display currency', 'Menu'],
    es: ['Descubrir', 'Guardados', 'Mis reservas', 'Cuenta', 'Miembro aprobado', 'Soporte', 'Fidelidad', 'Moneda', 'Menú']
};

export default function TopNavigationBar({ currency = SEARCH_CURRENCY, onCurrencyChange, onNavigate }) {
    const { language, languages, setLanguage } = useLanguage();
    const L = labels[language] || labels.en;
    const [open, setOpen] = useState(false);
    const path = location.pathname;
    const links = [['/', Compass, L[0]], ['/favorites', Heart, L[1]], ['/bookings', Tickets, L[2]], ['/account', UserRound, L[3]]];
    const follow = (event, href) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !onNavigate) return;
        event.preventDefault();
        setOpen(false);
        onNavigate(href);
    };
    const link = ([href, Icon, title]) => <a key={href} href={href} onClick={event => follow(event, href)}
        data-nav-bookings={href === '/bookings' ? '' : undefined} aria-current={path === href ? 'page' : undefined}>
        <Icon size={19} aria-hidden="true" /><span>{title}</span>
    </a>;
    return <>
        <header className="site-header pillow-header">
            <div className="pillow-nav-inner">
                <a href="/" onClick={event => follow(event, '/')}><PillowBrand /></a>
                <nav className="pillow-desktop-nav" aria-label={L[8]}>{links.slice(0,3).map(link)}</nav>
                <div className="pillow-nav-tools">
                    <a className="pillow-member" href="/membership"><BadgeCheck size={17} aria-hidden="true" />{L[4]}</a>
                    <label className="pillow-select"><Globe2 size={17} aria-hidden="true" /><select id="language-select" aria-label="Language / اللغة" value={language} onChange={event => setLanguage(event.target.value)}>
                        {languages.map(option => <option key={option.code} value={option.code}>{option.short}</option>)}
                    </select></label>
                    <button type="button" className="pillow-menu-button" aria-label={L[8]} aria-expanded={open} aria-controls="pillow-navigation-menu" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
                </div>
            </div>
            {open && <nav id="pillow-navigation-menu" className="pillow-menu" aria-label={L[8]}>
                {links.map(link)}{[['/notifications',Bell, language==='ar'?'الإشعارات':language==='es'?'Notificaciones':'Notifications'],['/support', LifeBuoy, L[5]], ['/loyalty', Gift, L[6]]].map(link)}
                <label>{L[7]}<select value={currency} onChange={event => { trackBookingEvent('currency_changed'); onCurrencyChange?.(event.target.value); }}>{DISPLAY_CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></label>
            </nav>}
            <PwaStatus showInstall={open} />
        </header>
        {links.some(([href]) => path === href) && <nav className="pillow-bottom-nav" aria-label={L[8]}>{links.map(link)}</nav>}
    </>;
}
