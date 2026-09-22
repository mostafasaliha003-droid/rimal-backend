import { ChevronDown, CircleUserRound, Menu, Search, ShieldCheck } from 'lucide-react';

const links = [
    { label: 'استكشاف الفنادق', href: '#search', active: true, icon: Search },
    { label: 'دفع آمن عبر Ziina', href: '#security', active: false, icon: ShieldCheck }
];

export default function TopNavigationBar() {
    return (
        <header className="relative z-20 border-b border-white/10 bg-remal-dark text-white">
            <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 lg:px-10">
                <div className="flex items-center gap-3">
                    <button className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white lg:hidden" aria-label="فتح القائمة">
                        <Menu size={21} />
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
                    {links.map(({ label, active, icon: Icon }) => (
                        <a key={label} href={href} className={`group flex items-center gap-2 border-b-2 py-7 text-[13px] font-bold transition ${active ? 'border-remal-blue text-white' : 'border-transparent text-white/55 hover:border-white/30 hover:text-white'}`}>
                            {Icon && <Icon size={15} className={active ? 'text-remal-blue' : 'text-white/40'} />}
                            {label}
                        </a>
                    ))}
                </nav>

                <div className="flex items-center gap-2.5 text-xs font-bold">
                    <button className="hidden items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-white/70 transition hover:border-white/30 hover:text-white sm:flex" type="button">
                        AED <ChevronDown size={14} />
                    </button>
                    <button className="hidden items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-white/70 transition hover:border-white/30 hover:text-white sm:flex" type="button">
                        العربية <ChevronDown size={14} />
                    </button>
                    <button className="flex items-center gap-2 rounded-full bg-remal-red px-3 py-2 text-white transition hover:bg-[#a10b0b]" type="button" aria-label="تسجيل الدخول" title="تسجيل الدخول غير متاح في تطبيق الحجز الجديد">
                        <CircleUserRound size={16} />
                        <span className="hidden sm:inline">دخول</span>
                    </button>
                </div>
            </div>
        </header>
    );
}
