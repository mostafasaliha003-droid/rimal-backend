import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, LockKeyhole, MapPin, Sparkles, Check } from 'lucide-react';
import { useLanguage } from '../i18n';
import { membershipRequest } from '../services/membershipApi';
import './MembershipDiscover.css';
import './MkhaddaDiscover.css';
import { useReveal } from './MkhaddaLanding';

const copy = {
    ar: {
        eyebrow: 'مساحة خاصة. احتمالات أكبر.', title: 'إقامتك القادمة تستحق الدخول.',
        intro: 'شواطئ جميرا، أضواء المرسى، أو مدينة جديدة حول العالم. بعض الأماكن التي تنتظرك.',
        destinations: ['جميرا والشاطئ', 'مرسى دبي', 'وجهات حول العالم'],
        places: ['برج العرب، جميرا', 'مرسى دبي', 'السلطان أحمد، إسطنبول'],
        descriptions: ['لإجازة قريبة تشبه السفر بعيدًا.', 'كن قريبًا من كل ما تحب اكتشافه.', 'مدينة جديدة. ذكريات تستحق الرحلة.'],
        styles: ['إجازات البحر', 'إقامات المدينة', 'رحلتك المقبلة'],
        private: 'أسعار مخصصة للأعضاء', unlock: 'اكتشف الأسعار بعد قبول عضويتك',
        apply: 'اطلب عضويتك المجانية', free: 'تسجيل مجاني', eligibility: 'القبول بعد التحقق من الأهلية',
        note: 'وجهات للاستكشاف؛ تتغير الأسعار والعروض حسب الفندق والتواريخ والتوفر.',
        live: 'عروض حصرية متاحة الآن', updated: 'آخر تحديث', upTo: 'خصم يصل إلى', until: 'العرض متاح حتى',
    },
    en: {
        eyebrow: 'Private access. More possibilities.', title: 'Your next stay is worth getting in for.',
        intro: 'Jumeirah’s shores, the lights of the Marina, or a new city abroad. A few of the places waiting for you.',
        destinations: ['Jumeirah & the beach', 'Dubai Marina', 'Destinations worldwide'],
        places: ['Burj Al Arab, Jumeirah', 'Dubai Marina', 'Sultanahmet, Istanbul'],
        descriptions: ['A nearby escape that feels a world away.', 'Stay close to everything you want to explore.', 'A new city. Memories worth the journey.'],
        styles: ['Coastal escapes', 'City stays', 'Your next journey'],
        private: 'Member stay rates', unlock: 'Explore rates once your membership is approved',
        apply: 'Apply for free membership', free: 'Free to register', eligibility: 'Access after eligibility review',
        note: 'Destination inspiration; rates and offers depend on the hotel, dates and availability.',
        live: 'Exclusive offers available now', updated: 'Last updated', upTo: 'Save up to', until: 'Available until',
    },
};

// Real photographs of the places named on each card (public-domain and CC0 sources, credited in public/pillow/PHOTOS.md).
const PHOTOS = ['/pillow/card-jumeirah.webp', '/pillow/card-marina.webp', '/pillow/card-world.webp'];

export default function MembershipDiscover({ onApply }) {
    const { language } = useLanguage(), L = copy[language] || copy.en;
    const reveal = useReveal();
    const [feed, setFeed] = useState(null), [now, setNow] = useState(Date.now());
    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            if (document.hidden) return;
            try {
                const data = await membershipRequest('/offers', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
                if (!Array.isArray(data.offers) || !Number.isFinite(Date.parse(data.checkedAt))) throw Error('invalid_feed');
                if (!controller.signal.aborted) { setFeed(data); setNow(Date.now()); }
            } catch { if (!controller.signal.aborted) setFeed(null); }
        };
        void load(); const timer = setInterval(() => { setNow(Date.now()); void load(); }, 60000);
        const visible = () => { if (!document.hidden) void load(); };
        document.addEventListener('visibilitychange', visible);
        return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
    }, []);
    const offers = feed?.offers.filter(offer => offer && Date.parse(offer.startsAt) <= now && now < Date.parse(offer.endsAt) && typeof offer.title?.en === 'string' && typeof offer.terms?.en === 'string') || [];
    useEffect(() => {
        const expiry = Math.min(...(feed?.offers || []).map(offer => Date.parse(offer.endsAt)).filter(value => value > Date.now()));
        if (!Number.isFinite(expiry)) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(expiry - Date.now() + 1, 2147483647));
        return () => clearTimeout(timer);
    }, [feed, now]);
    const formatDate = value => new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai', timeZoneName: 'short' }).format(new Date(value));
    return <section className="membership-discover mk-reveal" ref={reveal} aria-labelledby="membership-discover-title">
        <div className="membership-discover-heading"><span><Sparkles size={16} aria-hidden="true" />{L.eyebrow}</span><h2 id="membership-discover-title">{L.title}</h2><p>{L.intro}</p></div>
        <div className="membership-discover-grid">
            {PHOTOS.map((photo, index) => <article className={`membership-destination membership-destination-${index}`} key={photo} style={{ '--i': index }}>
                <div className="membership-destination-photo"><img src={photo} alt="" width="880" height="560" loading="lazy" decoding="async" /><span><MapPin size={13} aria-hidden="true" />{L.places[index]}</span></div>
                <span className="membership-destination-style">{L.styles[index]}</span><h3>{L.destinations[index]}</h3><p>{L.descriptions[index]}</p>
            </article>)}
        </div>
        <p className="membership-discover-note">{L.note}</p>
        {/* Only real, live offers earn the board; without them it repeated the hero invitation. */}
        {offers.length > 0 && <div className="membership-offers-board">
            <div className="membership-offers-caption" role="status" aria-live="polite"><span className="membership-offers-active"><i />{L.live}</span><small>{L.updated} {new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(new Date(feed.checkedAt))}</small></div>
            <div className="membership-campaigns">{offers.map(offer => <article key={offer.id}>
                <div><span className="membership-campaign-badge"><Sparkles size={14} />{L.private}</span><h3>{offer.title[language] || offer.title.en}</h3><p>{offer.terms[language] || offer.terms.en}</p><small>{L.until} <time dateTime={offer.endsAt}>{formatDate(offer.endsAt)}</time></small></div>
                {Number.isInteger(offer.maxSavingPercent) && offer.maxSavingPercent > 0 && offer.maxSavingPercent <= 100 && <div className="membership-campaign-saving"><span>{L.upTo}</span><strong><bdi>{offer.maxSavingPercent}%</bdi></strong></div>}
            </article>)}</div>
            <div className="membership-discover-action"><div><LockKeyhole size={19} aria-hidden="true" /><span>{L.unlock}</span></div><button type="button" onClick={onApply}>{L.apply}<ArrowUpRight size={18} aria-hidden="true" /></button></div>
            <div className="membership-discover-reassurance"><span><Check size={14} aria-hidden="true" />{L.free}</span><span>{L.eligibility}</span><ArrowRight size={14} aria-hidden="true" /></div>
        </div>}
    </section>;
}
