import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, Waves, Building2, Globe2, LockKeyhole, Sparkles, Check, RefreshCw } from 'lucide-react';
import { useLanguage } from '../i18n';
import { membershipRequest } from '../services/membershipApi';
import './MembershipDiscover.css';

const copy = {
    ar: {
        eyebrow: 'مساحة خاصة. احتمالات أكبر.', title: 'إقامتك القادمة تستحق الدخول.',
        intro: 'شواطئ جميرا، نبض دبي، أو وجهة جديدة حول العالم. افتح الباب لأسعار الإقامة المخصصة لأعضاء رمال المقبولين.',
        destinations: ['جميرا والشاطئ', 'وسط دبي', 'وجهات حول العالم'],
        descriptions: ['لإجازة قريبة تشبه السفر بعيدًا.', 'كن قريبًا من كل ما تحب اكتشافه.', 'مدينة جديدة. ذكريات تستحق الرحلة.'],
        styles: ['إجازات البحر', 'إقامات المدينة', 'رحلتك المقبلة'],
        private: 'أسعار مخصصة للأعضاء', unlock: 'اكتشف الأسعار بعد قبول عضويتك',
        apply: 'اطلب عضويتك المجانية', free: 'تسجيل مجاني', eligibility: 'القبول بعد التحقق من الأهلية',
        note: 'وجهات للاستكشاف؛ تتغير الأسعار والعروض حسب الفندق والتواريخ والتوفر.',
        live: 'عروض حصرية متاحة الآن', updated: 'آخر تحديث', upTo: 'خصم يصل إلى', until: 'العرض متاح حتى',
        checking: 'نتحقق من العروض المتاحة', unavailable: 'تعذّر تحديث العروض الآن', refresh: 'تحديث العروض',
        empty: 'كل رحلة تبدأ باختيار مميز.', emptyHint: 'ابدأ بطلب العضوية لتتمكن، بعد القبول، من استكشاف أسعار الفنادق ومقارنة الإقامات المناسبة لك.',
    },
    en: {
        eyebrow: 'Private access. More possibilities.', title: 'Your next stay is worth getting in for.',
        intro: 'Jumeirah shores, the energy of Dubai, or somewhere new worldwide. Open the door to stay rates for approved Remal members.',
        destinations: ['Jumeirah & the beach', 'Downtown Dubai', 'Destinations worldwide'],
        descriptions: ['A nearby escape that feels a world away.', 'Stay close to everything you want to explore.', 'A new city. Memories worth the journey.'],
        styles: ['Coastal escapes', 'City stays', 'Your next journey'],
        private: 'Member stay rates', unlock: 'Explore rates once your membership is approved',
        apply: 'Apply for free membership', free: 'Free to register', eligibility: 'Access after eligibility review',
        note: 'Destination inspiration; rates and offers depend on the hotel, dates and availability.',
        live: 'Exclusive offers available now', updated: 'Last updated', upTo: 'Save up to', until: 'Available until',
        checking: 'Checking available offers', unavailable: 'Offers could not be refreshed', refresh: 'Refresh offers',
        empty: 'Every journey starts with a special choice.', emptyHint: 'Start your membership application. Once approved, explore hotel rates and compare stays that suit your trip.',
    },
};

export default function MembershipDiscover({ onApply }) {
    const { language } = useLanguage(), L = copy[language] || copy.en;
    const [feed, setFeed] = useState(null), [error, setError] = useState(false), [tick, setTick] = useState(0), [now, setNow] = useState(Date.now());
    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            if (document.hidden) return;
            try {
                const data = await membershipRequest('/offers', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
                if (!Array.isArray(data.offers) || !Number.isFinite(Date.parse(data.checkedAt))) throw Error('invalid_feed');
                if (!controller.signal.aborted) { setFeed(data); setError(false); setNow(Date.now()); }
            } catch { if (!controller.signal.aborted) { setFeed(null); setError(true); } }
        };
        void load(); const timer = setInterval(() => { setNow(Date.now()); void load(); }, 60000);
        const visible = () => { if (!document.hidden) void load(); };
        document.addEventListener('visibilitychange', visible);
        return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
    }, [tick]);
    const offers = feed?.offers.filter(offer => offer && Date.parse(offer.startsAt) <= now && now < Date.parse(offer.endsAt) && typeof offer.title?.en === 'string' && typeof offer.terms?.en === 'string') || [];
    useEffect(() => {
        const expiry = Math.min(...(feed?.offers || []).map(offer => Date.parse(offer.endsAt)).filter(value => value > Date.now()));
        if (!Number.isFinite(expiry)) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(expiry - Date.now() + 1, 2147483647));
        return () => clearTimeout(timer);
    }, [feed, now]);
    const formatDate = value => new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai', timeZoneName: 'short' }).format(new Date(value));
    return <section className="membership-discover" aria-labelledby="membership-discover-title">
        <div className="membership-discover-heading"><span><Sparkles size={16} aria-hidden="true" />{L.eyebrow}</span><h2 id="membership-discover-title">{L.title}</h2><p>{L.intro}</p></div>
        <div className="membership-discover-grid">
            {[Waves, Building2, Globe2].map((Icon, index) => <article className={`membership-destination membership-destination-${index}`} key={index}>
                <div className="membership-destination-art" aria-hidden="true"><Icon strokeWidth={.8} /><span>{String(index + 1).padStart(2, '0')}</span></div>
                <span className="membership-destination-style">{L.styles[index]}</span><h3>{L.destinations[index]}</h3><p>{L.descriptions[index]}</p>
                <div className="membership-destination-access"><LockKeyhole size={15} aria-hidden="true" /><span>{L.private}</span></div>
            </article>)}
        </div>
        <p className="membership-discover-note">{L.note}</p>
        <div className="membership-offers-board">
            <div className="membership-offers-caption" role="status" aria-live="polite"><span className={offers.length ? 'membership-offers-active' : ''}><i />{error ? L.unavailable : !feed ? L.checking : offers.length ? L.live : L.empty}</span>{feed && offers.length > 0 && <small>{L.updated} {new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(new Date(feed.checkedAt))}</small>}{error && <button type="button" onClick={() => setTick(value => value + 1)}><RefreshCw size={14} />{L.refresh}</button>}</div>
            {offers.length > 0 ? <div className="membership-campaigns">{offers.map(offer => <article key={offer.id}>
                <div><span className="membership-campaign-badge"><Sparkles size={14} />{L.private}</span><h3>{offer.title[language] || offer.title.en}</h3><p>{offer.terms[language] || offer.terms.en}</p><small>{L.until} <time dateTime={offer.endsAt}>{formatDate(offer.endsAt)}</time></small></div>
                {Number.isInteger(offer.maxSavingPercent) && offer.maxSavingPercent > 0 && offer.maxSavingPercent <= 100 && <div className="membership-campaign-saving"><span>{L.upTo}</span><strong><bdi>{offer.maxSavingPercent}%</bdi></strong></div>}
            </article>)}</div> : <p className="membership-offers-invitation">{L.emptyHint}</p>}
            <div className="membership-discover-action"><div><LockKeyhole size={19} aria-hidden="true" /><span>{L.unlock}</span></div><button type="button" onClick={onApply}>{L.apply}<ArrowUpRight size={18} aria-hidden="true" /></button></div>
            <div className="membership-discover-reassurance"><span><Check size={14} aria-hidden="true" />{L.free}</span><span>{L.eligibility}</span><ArrowRight size={14} aria-hidden="true" /></div>
        </div>
    </section>;
}
