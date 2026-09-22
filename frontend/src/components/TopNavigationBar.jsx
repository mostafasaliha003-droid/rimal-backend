import { Menu, Search, Mail, X } from 'lucide-react';
import { useState } from 'react';
import PwaStatus from './PwaStatus';

const links = [
    { label: 'استكشاف الفنادق', href: '/#search', active: true, icon: Search },
    { label: 'تواصل معنا', href: 'mailto:management@remaltourismllc.com', active: false, icon: Mail }
];

export default function TopNavigationBar() {
    const [open, setOpen] = useState(false);
    return (
        <header className="relative z-20 border-b border-white/10 bg-remal-dark text-white">
            <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 lg:px-10">
                <div className="flex items-center gap-3">
                    <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-navigation" className="rounded-lg p-3 text-white lg:hidden" aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}>
                        {open ? <X size={21} /> : <Menu size={21} />}
                    </button>
                    <a href="/" aria-label="العودة إلى الصفحة الرئيسية" className="flex items-center gap-2.5">
                        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-remal-blue/15 text-lg font-black text-remal-blue">ر</span>
                        <div className="leading-none">
                            <div className="text-lg font-black tracking-tight">رمال <span className="text-remal-blue">وفِلّها</span></div>
                            <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.24em] text-white/40">remal & chill</div>
                        </div>
                    </a>
                </div>

                <nav className="hidden items-center gap-8 lg:flex">
                    {links.map(({ label, href, active, icon: Icon }) => (
                        <a key={label} href={href} className={`group flex items-center gap-2 border-b-2 py-7 text-[13px] font-bold transition ${active ? 'border-remal-blue text-white' : 'border-transparent text-white/55 hover:border-white/30 hover:text-white'}`}>
                            {Icon && <Icon size={15} className={active ? 'text-remal-blue' : 'text-white/40'} />}
                            {label}
                        </a>
                    ))}
                </nav>

                <div className="flex items-center gap-2.5 text-xs font-bold">
                    <span className="text-sm text-white">AED · العربية</span>
                </div>
            </div>
            {open && <nav id="mobile-navigation" aria-label="القائمة الرئيسية" className="border-t border-white/20 px-5 py-3 lg:hidden">{links.map(({ label, href, icon: Icon }) => <a key={label} href={href} onClick={() => setOpen(false)} className="flex min-h-12 items-center gap-3"><Icon size={18} />{label}</a>)}</nav>}
            <PwaStatus />
        </header>
    );
}
