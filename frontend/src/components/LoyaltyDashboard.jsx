import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Crown, Gem, LockKeyhole, Sparkles, Trophy } from 'lucide-react';
import BookingAPI from '../services/bookingApi';
import { trackBookingEvent } from '../services/analytics';
import { useLanguage } from '../i18n';

const USER_STORAGE_KEY = 'rimal_current_user';
const TIERS = [
    { key: 'explorer', name: 'Explorer', arabic: 'المستكشف', min: 0, color: 'slate', icon: Sparkles, benefits: ['جمع نقاط مع الحساب المؤهل', 'عروض ومحتوى مخصص', 'متابعة الحجوزات من حسابك'] },
    { key: 'voyager', name: 'Voyager', arabic: 'المسافر', min: 1000, color: 'cyan', icon: Gem, benefits: ['مزايا أفضل للحجوزات المؤهلة', 'أولوية في العروض المخصصة', 'مكافآت أكبر مع الوقت'] },
    { key: 'elite', name: 'Elite', arabic: 'النخبة', min: 2500, color: 'amber', icon: Crown, benefits: ['أعلى مستوى في البرنامج', 'أولوية للمزايا المؤهلة', 'تجربة ولاء مميزة'] }
];

function readUser() {
    try { return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || 'null'); } catch { return null; }
}

function tierFor(points) {
    return [...TIERS].reverse().find(tier => points >= tier.min) || TIERS[0];
}

export default function LoyaltyDashboard({ onNavigate }) {
    const { t, direction } = useLanguage();
    const [user, setUser] = useState(readUser);
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        trackBookingEvent('loyalty_viewed');
        const handleChange = event => setUser(event.detail || readUser());
        window.addEventListener('remal:user-changed', handleChange);
        return () => window.removeEventListener('remal:user-changed', handleChange);
    }, []);

    useEffect(() => {
        if (!user?.email) return undefined;
        let active = true;
        BookingAPI.getUserProfile(user.email).then(result => {
            if (active && result?.success) setProfile(result.profile);
        }).catch(() => {});
        return () => { active = false; };
    }, [user?.email]);

    const points = Number(profile?.points ?? user?.points ?? 0);
    const current = useMemo(() => tierFor(points), [points]);
    const CurrentIcon = current.icon;
    const currentIndex = TIERS.findIndex(tier => tier.key === current.key);
    const next = TIERS[currentIndex + 1] || null;
    const progress = next ? Math.min(100, Math.max(0, ((points - current.min) / (next.min - current.min)) * 100)) : 100;

    if (!user) {
        return (
            <main dir={direction} className="min-h-[calc(100vh-72px)] bg-[#f7f9fc] px-5 py-12 lg:px-10 lg:py-20">
                <div className="mx-auto max-w-3xl rounded-3xl bg-gradient-to-br from-[#102a43] to-[#0f8fa3] p-8 text-center text-white shadow-xl sm:p-12">
                    <Trophy size={48} className="mx-auto text-cyan-100" />
                    <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">{t('loyalty.program', 'برنامج رمال للولاء')}</p>
                    <h1 className="mt-3 text-4xl font-black">{t('loyalty.title', 'سافر أكثر، واستفد أكثر')}</h1>
                    <p className="mx-auto mt-4 max-w-xl text-sm font-medium leading-7 text-white/80">{t('loyalty.subtitle', 'سجّل دخولك لتشاهد نقاطك ومستواك ومزايا كل Tier.')}</p>
                    <button type="button" onClick={() => onNavigate?.('/account')} className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[var(--remal-navy)] hover:bg-cyan-50">{t('loyalty.signIn', 'تسجيل الدخول أو إنشاء حساب')} <ArrowLeft size={17} /></button>
                </div>
            </main>
        );
    }

    return (
        <main dir={direction} className="min-h-[calc(100vh-72px)] bg-[#f7f9fc] px-5 py-10 lg:px-10 lg:py-16">
            <div className="mx-auto max-w-6xl">
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div><p className="eyebrow">{t('loyalty.program', 'برنامج رمال للولاء')}</p><h1 className="mt-2 text-4xl font-black text-[var(--remal-navy)]">{t('loyalty.level', 'مستواك يفتح لك مزايا أكثر')}</h1><p className="mt-2 text-sm font-medium text-slate-500">{t('loyalty.welcome', `مرحباً ${user.name?.split(' ')[0] || 'بك'}، هذه نظرة سريعة على تقدمك.`, { name: user.name?.split(' ')[0] || 'بك' })}</p></div>
                    <button type="button" onClick={() => onNavigate?.('/account')} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:border-cyan-200 hover:text-[var(--remal-blue)]">{t('loyalty.backAccount', 'العودة للحساب')} <ArrowLeft size={17} /></button>
                </div>

                <section className="rounded-3xl bg-gradient-to-br from-[#102a43] to-[#0f8fa3] p-7 text-white shadow-xl sm:p-10">
                    <div className="flex flex-wrap items-start justify-between gap-6">
                        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100">{t('loyalty.current', 'المستوى الحالي')}</p><div className="mt-3 flex items-center gap-3"><CurrentIcon size={32} className="text-amber-200" /><h2 className="text-4xl font-black">{current.name}</h2></div><p className="mt-2 font-bold text-cyan-100">{current.arabic}</p></div>
                        <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-left"><p className="text-xs font-bold text-white/65">{t('loyalty.points', 'رصيد النقاط')}</p><p className="mt-1 text-3xl font-black">{points.toLocaleString('en-US')}</p><p className="text-xs font-bold text-white/65">{t('loyalty.pointsWord', 'نقطة')}</p></div>
                    </div>
                    <div className="mt-9"><div className="mb-2 flex justify-between text-xs font-bold text-white/75"><span>{current.name}</span><span>{next ? t('loyalty.next', `${Math.max(0, next.min - points).toLocaleString('en-US')} نقطة للمستوى التالي`, { count: Math.max(0, next.min - points).toLocaleString('en-US') }) : t('loyalty.highest', 'أعلى مستوى')}</span></div><div className="h-3 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-amber-300 transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div></div>
                </section>

                <div className="mt-8 grid gap-5 lg:grid-cols-3">
                    {TIERS.map(tier => {
                        const Icon = tier.icon;
                        const active = tier.key === current.key;
                        const unlocked = points >= tier.min;
                        return <article key={tier.key} className={`relative rounded-3xl border p-6 transition ${active ? 'border-cyan-300 bg-cyan-50/60 shadow-lg' : 'border-slate-200 bg-white shadow-sm'}`}>
                            <div className="flex items-start justify-between gap-3"><div className={`grid h-12 w-12 place-items-center rounded-2xl ${unlocked ? 'bg-cyan-100 text-[var(--remal-blue)]' : 'bg-slate-100 text-slate-400'}`}><Icon size={24} /></div>{active ? <span className="rounded-full bg-[var(--remal-blue)] px-3 py-1 text-[10px] font-black text-white">{t('loyalty.currentBadge', 'مستواك الحالي')}</span> : unlocked ? <Check className="text-emerald-500" size={20} /> : <LockKeyhole className="text-slate-300" size={19} />}</div>
                            <h3 className="mt-5 text-2xl font-black text-slate-900">{tier.name}</h3><p className="mt-1 text-sm font-bold text-slate-500">{tier.arabic} · {t('loyalty.pointsFrom', `من ${tier.min.toLocaleString('en-US')} نقطة`, { count: tier.min.toLocaleString('en-US') })}</p><ul className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-600">{tier.benefits.map(benefit => <li key={benefit} className="flex gap-2"><Check size={17} className="mt-1 shrink-0 text-emerald-500" />{benefit}</li>)}</ul>
                        </article>;
                    })}
                </div>
                <p className="mt-6 text-center text-xs font-medium leading-6 text-slate-500">{t('loyalty.disclaimer', 'المزايا وتراكم النقاط يخضعان لشروط البرنامج والحجوزات المؤهلة. سيتم تحديث النقاط من حسابك بعد مزامنة البيانات.')}</p>
            </div>
        </main>
    );
}