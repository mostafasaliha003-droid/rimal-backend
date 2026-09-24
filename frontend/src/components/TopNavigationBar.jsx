import { Menu, Search, Mail, X, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import PwaStatus from './PwaStatus';
import { DISPLAY_CURRENCIES, SEARCH_CURRENCY } from '../services/offers';
import { trackBookingEvent } from '../services/analytics';

const links = [
    { label: 'استكشاف الفنادق', href: '/#search', active: true, icon: Search },
    { label: 'تواصل معنا', href: 'mailto:management@remaltourismllc.com', active: false, icon: Mail }
];

export default function TopNavigationBar({ currency = SEARCH_CURRENCY, onCurrencyChange }) {
    const [open, setOpen] = useState(false);
    return (
        <header className="site-header relative z-20 text-white">
            <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-5 lg:px-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-navigation" className="rounded-lg p-3 text-white lg:hidden" aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}>
                        {open ? <X size={21} /> : <Menu size={21} />}
                    </button>
                    <a href="/" aria-label="العودة إلى الصفحة الرئيسية" className="flex items-center gap-2.5">
                        <span className="brand-mark grid h-10 w-10 place-items-center rounded-2xl text-lg font-black">ر</span>
                        <div className="leading-none">
                            <div className="text-lg font-black tracking-tight">رمال <span className="text-remal-blue">وفِلّها</span></div>
                            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.24em] text-white/45">إقامتك تبدأ من هنا</div>
                        </div>
                    </a>
                </div>

                <nav className="hidden items-center gap-6 lg:flex">
                    {links.map(({ label, href, active, icon: Icon }) => (
                        <a key={label} href={href} className={`group flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold transition ${active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}>
                            {Icon && <Icon size={15} className={active ? 'text-remal-blue' : 'text-white/40'} />}
                            {label}
                        </a>
                    ))}
                </nav>

                <div className="flex shrink-0 items-center gap-2 text-xs font-bold">
                    <span className="hidden items-center gap-1.5 text-white/60 xl:flex"><ShieldCheck size={14} className="text-remal-blue" /> أسعار واضحة وآمنة</span>
                    <select aria-label="عملة عرض السعر" title="عملة عرض السعر" value={currency} onChange={event => { trackBookingEvent('currency_changed'); onCurrencyChange?.(event.target.value); }} className="min-h-10 rounded-full border border-white/20 bg-white/10 px-3 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                        {DISPLAY_CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}
                    </select>
                    <span className="hidden text-sm text-white sm:inline">العربية</span>
                </div>
            </div>
            {open && <nav id="mobile-navigation" aria-label="القائمة الرئيسية" className="border-t border-white/10 bg-slate-950/80 px-5 py-3 lg:hidden">{links.map(({ label, href, icon: Icon }) => <a key={label} href={href} onClick={() => setOpen(false)} className="flex min-h-12 items-center gap-3"><Icon size={18} />{label}</a>)}</nav>}
            <PwaStatus />
        </header>
    );
}
