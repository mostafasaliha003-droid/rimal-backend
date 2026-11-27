import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BadgeCheck, BellRing, ChevronDown, Download, FileCheck2, KeyRound, LockKeyhole, MapPin, MessagesSquare, Activity, ShieldCheck, Sparkles, UserPlus } from 'lucide-react';
import { useLanguage } from '../i18n';
import { membershipCopy } from '../services/membershipCopy';
import { API_BASE_URL } from '../services/apiBaseUrl.js';
import TabbyBadge from './TabbyBadge';
import './MkhaddaLanding.css';

/*
 * The public front of the Mkhadda website: the same world as the app's welcome screen. Real places
 * cross-fading behind the promise, three steps to membership, the app, and plain answers.
 * Every statement here is something the product does today; nothing promises a price or a wait.
 */
const PHOTOS = [
    { src: '/pillow/hero-jumeirah.webp', ar: 'جميرا، دبي', en: 'Jumeirah, Dubai' },
    { src: '/pillow/hero-marina.webp', ar: 'مرسى دبي', en: 'Dubai Marina' },
    { src: '/pillow/hero-istanbul.webp', ar: 'السلطان أحمد، إسطنبول', en: 'Sultanahmet, Istanbul' },
    { src: '/pillow/hero-paris.webp', ar: 'باريس', en: 'Paris' },
];
const SLIDE_MS = 6500;
const TABBY_DISCLAIMER = 'Pay Later (Short Term Credit) is provided by Tabby LLC. Terms and conditions apply. For more information or to contact us, visit tabby.ai.';

const copy = {
    ar: {
        badge: 'عضوية سفر خاصة', first: 'حجوزات أريح.', second: 'أسعار للأعضاء.',
        lead: 'مخدتك جاهزة في مدن العالم. عضوية مجانية للمؤهلين، وبعد القبول تنفتح لك أسعار الفنادق المخصصة لأعضاء مخدة.',
        facts: ['فنادق في مدن العالم', 'عناية خاصة بكل حجز', 'وثائقك مشفّرة'],
        floatTitle: 'حالة طلبك مباشرة', floatBody: 'تتابعها لحظة بلحظة بعد التقديم', photo: 'صورة', places: 'وجهات على مخدة',
        login: 'تسجيل الدخول',
        stepsEyebrow: 'كيف تعمل العضوية', stepsTitle: 'ثلاث خطوات إلى أسعار الأعضاء',
        steps: [
            ['قدّم طلبك مجانًا', 'أنشئ حسابك وأكّد بريدك الإلكتروني برمز من 6 أرقام.'],
            ['أثبت أهليتك', 'اختر فئة العضوية وارفع صورة جواز السفر أو الهوية الإماراتية. وثائقك مشفّرة ولا يراها إلا المراجعون المخوّلون.'],
            ['ادخل عالم مخدة', 'بعد القبول تنكشف لك أسعار الأعضاء، وتتابع حجوزاتك وقسائمك ودعمك من مكان واحد.'],
        ],
        appEyebrow: 'تطبيق مخدة', appTitle: 'مخدة في جيبك', appLead: 'كل ما في الموقع، مع ما يجعل الرحلة أهدأ.',
        appPoints: ['محادثة عناية مباشرة مرتبطة بحجزك المؤكد', 'حالة الحجز والإلغاء والاسترداد لحظة بلحظة', 'ردود فريق العناية تصلك في التطبيق وعلى بريدك'],
        download: 'حمّل نسخة أندرويد', version: 'الإصدار', preview: 'نسخة تجريبية تُثبَّت من الملف مباشرة. متاح حاليًا لأندرويد.',
        tabbyWhere: 'عند الدفع في تطبيق مخدة', tabbyLead: 'ادفع على راحتك', tabbySupport: '4 دفعات بدون فوائد أو حتى 12 شهرًا.',
        faqEyebrow: 'أسئلة تتكرر', faqTitle: 'قبل أن تبدأ',
        phoneTagline: 'مخدتك جاهزة في مدن العالم، بسعر الأعضاء',
    },
    en: {
        badge: 'A private travel membership', first: 'Stay easier.', second: 'Member rates.',
        lead: 'Your pillow is ready in cities around the world. Membership is free for eligible travellers, and member hotel rates open once you are approved.',
        facts: ['Hotels in cities worldwide', 'Personal care for every booking', 'Your documents stay encrypted'],
        floatTitle: 'Live application status', floatBody: 'Follow it as it moves, right after you apply', photo: 'Photo', places: 'Destinations on Mkhadda',
        login: 'Sign in',
        stepsEyebrow: 'How membership works', stepsTitle: 'Three steps to member rates',
        steps: [
            ['Apply for free', 'Create your account and confirm your email with a 6-digit code.'],
            ['Show your eligibility', 'Choose your membership category and upload your passport page or Emirates ID. Documents are encrypted and seen only by authorised reviewers.'],
            ['Step into Mkhadda', 'Once approved, member rates are revealed and your bookings, vouchers and support live in one place.'],
        ],
        appEyebrow: 'The Mkhadda app', appTitle: 'Mkhadda in your pocket', appLead: 'Everything on the website, plus what makes a trip calmer.',
        appPoints: ['Live care chat tied to your confirmed booking', 'Booking, cancellation and refund status as it happens', 'Replies from the care team reach you in the app and by email'],
        download: 'Download for Android', version: 'Version', preview: 'A preview build installed directly from the file. Available on Android for now.',
        tabbyWhere: 'At checkout in the Mkhadda app', tabbyLead: 'Pay over time', tabbySupport: '4 interest-free payments or up to 12 months.',
        faqEyebrow: 'Common questions', faqTitle: 'Before you start',
        phoneTagline: 'Your pillow is ready around the world, at member rates',
    },
    es: {
        badge: 'Una membresía de viaje privada', first: 'Viaja con calma.', second: 'Tarifas para miembros.',
        lead: 'Tu almohada está lista en ciudades de todo el mundo. La membresía es gratuita para viajeros elegibles y las tarifas para miembros se abren tras la aprobación.',
        facts: ['Hoteles en ciudades de todo el mundo', 'Atención personal en cada reserva', 'Tus documentos, cifrados'],
        floatTitle: 'Tu solicitud, en vivo', floatBody: 'Síguela al momento después de solicitar', photo: 'Foto', places: 'Destinos en Mkhadda',
        login: 'Iniciar sesión',
        stepsEyebrow: 'Cómo funciona la membresía', stepsTitle: 'Tres pasos hacia las tarifas para miembros',
        steps: [
            ['Solicita gratis', 'Crea tu cuenta y confirma tu correo con un código de 6 dígitos.'],
            ['Acredita tu elegibilidad', 'Elige tu categoría y sube la página de tu pasaporte o tu Emirates ID. Los documentos están cifrados y solo los ven revisores autorizados.'],
            ['Entra en Mkhadda', 'Tras la aprobación verás las tarifas para miembros, con tus reservas, bonos y asistencia en un solo lugar.'],
        ],
        appEyebrow: 'La app Mkhadda', appTitle: 'Mkhadda en tu bolsillo', appLead: 'Todo lo del sitio, y lo que hace el viaje más tranquilo.',
        appPoints: ['Chat de atención en vivo vinculado a tu reserva confirmada', 'Estado de reserva, cancelación y reembolso al momento', 'Las respuestas del equipo te llegan en la app y por correo'],
        download: 'Descargar para Android', version: 'Versión', preview: 'Versión preliminar que se instala desde el archivo. Disponible en Android por ahora.',
        tabbyWhere: 'Al pagar en la app Mkhadda', tabbyLead: 'Pay over time', tabbySupport: '4 interest-free payments or up to 12 months.',
        faqEyebrow: 'Preguntas frecuentes', faqTitle: 'Antes de empezar',
        phoneTagline: 'Tu almohada está lista en el mundo, con tarifas para miembros',
    },
};
const landingCopy = language => copy[language] || copy.en;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/*
 * Sections arrive as they scroll into view. Content is visible by default: only a section that is still
 * below the fold is held back (`mk-wait`), and anything that stops the observer — no support, printing,
 * a full-page capture — leaves it shown rather than blank.
 */
export function useReveal() {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const show = () => { node.classList.remove('mk-wait'); node.classList.add('is-in'); };
        if (typeof IntersectionObserver !== 'function' || reducedMotion() || node.getBoundingClientRect().top < window.innerHeight * 0.92) { show(); return undefined; }
        node.classList.add('mk-wait');
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { show(); observer.disconnect(); }
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        observer.observe(node);
        const reveal = () => { show(); observer.disconnect(); };
        window.addEventListener('beforeprint', reveal);
        return () => { observer.disconnect(); window.removeEventListener('beforeprint', reveal); node.classList.remove('mk-wait'); };
    }, []);
    return ref;
}

/** The brand emblem with its slow orbit, as in the app. */
function Emblem() {
    return <div className="mk-emblem" aria-hidden="true">
        <svg className="mk-emblem-orbit" viewBox="0 0 120 120">
            <defs><linearGradient id="mk-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#C9B7F5" /><stop offset="0.55" stopColor="#F2B48C" /><stop offset="1" stopColor="#C9B7F5" stopOpacity="0.2" /></linearGradient></defs>
            <circle cx="60" cy="60" r="56" fill="none" stroke="url(#mk-ring)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="210 142" />
            <circle cx="60" cy="4" r="3.6" fill="#F2B48C" /><path d="M112 66l2.6 5.2 5.2 2.6-5.2 2.6-2.6 5.2-2.6-5.2-5.2-2.6 5.2-2.6Z" fill="#C9B7F5" />
        </svg>
        <span><img src="/pillow/symbol.svg" alt="" width="46" height="36" /></span>
    </div>;
}

export function LandingHero({ onApply, onLogin, applyLabel, loginLabel }) {
    const { language } = useLanguage(), L = landingCopy(language);
    const [slide, setSlide] = useState(0), [loaded, setLoaded] = useState(1), [paused, setPaused] = useState(false);
    // Only the first photograph is part of the first paint; the others arrive once the page has settled.
    useEffect(() => {
        const start = () => setLoaded(PHOTOS.length);
        if (document.readyState === 'complete') { const timer = setTimeout(start, 900); return () => clearTimeout(timer); }
        window.addEventListener('load', start, { once: true });
        return () => window.removeEventListener('load', start);
    }, []);
    useEffect(() => {
        if (paused || loaded < PHOTOS.length || reducedMotion()) return undefined;
        const timer = setInterval(() => { if (!document.hidden) setSlide(value => (value + 1) % PHOTOS.length); }, SLIDE_MS);
        return () => clearInterval(timer);
    }, [paused, loaded]);
    const place = PHOTOS[slide];
    return <section className="mk-hero">
        <div className="mk-hero-copy">
            <span className="pillow-badge mk-rise" style={{ '--i': 0 }}><LockKeyhole size={16} aria-hidden="true" />{L.badge}</span>
            <h1 className="mk-rise" style={{ '--i': 1 }}>{L.first}<br /><em>{L.second}</em></h1>
            <p className="mk-rise" style={{ '--i': 2 }}>{L.lead}</p>
            <div className="pillow-hero-actions mk-rise" style={{ '--i': 3 }}>
                <a href="#membership-application" onClick={onApply}>{applyLabel}</a>
                <a href="#membership-application" onClick={onLogin}>{loginLabel}</a>
            </div>
            <ul className="mk-facts mk-rise" style={{ '--i': 4 }}>
                {[Sparkles, MessagesSquare, ShieldCheck].map((Icon, index) => <li key={index}><Icon size={17} aria-hidden="true" /><span>{L.facts[index]}</span></li>)}
            </ul>
        </div>
        <div className="mk-stage-wrap mk-rise" style={{ '--i': 2 }}>
            <div className="mk-stage" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                {PHOTOS.slice(0, loaded).map((photo, index) => <img key={photo.src} src={photo.src} alt="" width="960" height="1200"
                    className={index === slide ? 'is-on' : ''} fetchPriority={index === 0 ? 'high' : 'low'} decoding="async" />)}
                <div className="mk-stage-veil" aria-hidden="true" />
                <p className="mk-stage-place" aria-live="off"><MapPin size={15} aria-hidden="true" /><span key={slide}>{place[language === 'ar' ? 'ar' : 'en']}</span></p>
                <div className="mk-stage-dots" role="group" aria-label={L.places}>
                    {PHOTOS.map((photo, index) => <button key={photo.src} type="button" aria-pressed={index === slide}
                        aria-label={`${L.photo} ${index + 1}: ${photo[language === 'ar' ? 'ar' : 'en']}`}
                        onClick={() => { setLoaded(PHOTOS.length); setSlide(index); setPaused(true); }}><i /></button>)}
                </div>
            </div>
            <Emblem />
            <div className="mk-float" aria-hidden="true"><span><BadgeCheck size={19} /></span><div><b>{L.floatTitle}</b><small>{L.floatBody}</small></div></div>
        </div>
    </section>;
}

export function HowItWorks() {
    const { language } = useLanguage(), L = landingCopy(language), ref = useReveal();
    return <section className="mk-section mk-steps mk-reveal" ref={ref} aria-labelledby="mk-steps-title">
        <div className="mk-heading"><span><Sparkles size={15} aria-hidden="true" />{L.stepsEyebrow}</span><h2 id="mk-steps-title">{L.stepsTitle}</h2></div>
        <ol>
            {[UserPlus, FileCheck2, KeyRound].map((Icon, index) => <li key={index} style={{ '--i': index }}>
                <div className="mk-step-mark"><span className="mk-step-icon"><Icon size={24} aria-hidden="true" /></span><b aria-hidden="true">{`0${index + 1}`}</b></div>
                <h3>{L.steps[index][0]}</h3><p>{L.steps[index][1]}</p>
            </li>)}
        </ol>
    </section>;
}

/** The app, shown as it is: its welcome screen in a phone, what it adds, and (when published) its download. */
export function AppShowcase() {
    const { language } = useLanguage(), L = landingCopy(language), ref = useReveal();
    const [release, setRelease] = useState(null), [tabby, setTabby] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        const read = async path => { const response = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } }); return response.ok ? response.json() : null; };
        read(`${API_BASE_URL}/app/version`).then(data => {
            const android = data?.android;
            // Only GitHub release files are offered, the same rule the app's own update notice follows.
            if (android && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(android.latestVersion || '') && typeof android.downloadUrl === 'string'
                && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(android.downloadUrl)) setRelease({ version: android.latestVersion, url: android.downloadUrl });
        }).catch(() => undefined);
        read(`${API_BASE_URL}/payment/availability`).then(data => { if (data?.enabled === true && data.tabby === true) setTabby(true); }).catch(() => undefined);
        return () => controller.abort();
    }, []);
    return <section className="mk-section mk-app mk-reveal" ref={ref} aria-labelledby="mk-app-title">
        <div className="mk-app-card">
            <div className="mk-app-copy">
                <div className="mk-heading mk-heading-light"><span><Sparkles size={15} aria-hidden="true" />{L.appEyebrow}</span><h2 id="mk-app-title">{L.appTitle}</h2><p>{L.appLead}</p></div>
                <ul>{[MessagesSquare, Activity, BellRing].map((Icon, index) => <li key={index}><span><Icon size={18} aria-hidden="true" /></span>{L.appPoints[index]}</li>)}</ul>
                {release && <div className="mk-app-download">
                    <a href={release.url} rel="noopener"><Download size={19} aria-hidden="true" />{L.download}</a>
                    <small>{L.version} <bdi>{release.version}</bdi> · {L.preview}</small>
                </div>}
                {tabby && <div className="mk-tabby">
                    <small className="mk-tabby-where">{L.tabbyWhere}</small>
                    <div className="mk-tabby-card"><div><strong>{L.tabbyLead}</strong><span>{L.tabbySupport}</span></div><TabbyBadge height={30} /></div>
                    <p dir="ltr" lang="en">{TABBY_DISCLAIMER}</p>
                </div>}
            </div>
            <div className="mk-phone" aria-hidden="true">
                <div className="mk-phone-screen">
                    <img src="/pillow/hero-marina.webp" alt="" width="960" height="1200" loading="lazy" decoding="async" />
                    <div className="mk-phone-veil" />
                    <div className="mk-phone-brand"><span><img src="/pillow/symbol.svg" alt="" width="34" height="27" /></span><b>مخدة</b><i>PILLOW STAYS</i><p>{L.phoneTagline}</p></div>
                    <div className="mk-phone-sheet"><i /><b /><span /><span /></div>
                </div>
            </div>
        </div>
    </section>;
}

export function LandingFaq() {
    const { language } = useLanguage(), L = landingCopy(language), M = membershipCopy(language), ref = useReveal();
    const ar = language === 'ar';
    const items = [
        [ar ? 'من يحق له التقديم؟' : 'Who can apply?', <><p><b>{M.gcc}.</b> {M.gccHint}</p><p><b>{M.professional}.</b> {M.professionalHint}</p></>],
        [ar ? 'هل العضوية مجانية؟' : 'Is membership free?', <p>{M.free}. {M.submitHint}</p>],
        [ar ? 'ما الوثائق المطلوبة؟' : 'Which documents do I need?', <p>{ar
            ? 'مواطنو الإمارات ودول مجلس التعاون: صفحة بيانات جواز السفر. المقيمون في الإمارات: الهوية الإماراتية بوجهيها. صور JPG أو PNG حتى 5 MB لكل صورة.'
            : 'UAE and GCC citizens: the passport identity page. UAE residents: both sides of the Emirates ID. JPG or PNG images, up to 5 MB each.'}</p>],
        [ar ? 'ماذا يحدث لوثائقي؟' : 'What happens to my documents?', <p>{M.privacyHint}</p>],
        [ar ? 'متى أرى الأسعار؟' : 'When do I see the rates?', <p>{ar
            ? 'بعد قبول عضويتك. تتابع حالة طلبك مباشرة من صفحتك بعد تسجيل الدخول، ونرسل إشعارًا إلى بريدك المسجّل.'
            : 'Once your membership is approved. You can follow your application live after signing in, and we send a notification to your registered email.'}</p>],
    ];
    return <section className="mk-section mk-faq mk-reveal" ref={ref} aria-labelledby="mk-faq-title">
        <div className="mk-heading"><span><Sparkles size={15} aria-hidden="true" />{L.faqEyebrow}</span><h2 id="mk-faq-title">{L.faqTitle}</h2></div>
        <div className="mk-faq-list">
            {items.map(([question, answer], index) => <details key={index} style={{ '--i': index }}>
                <summary><span>{question}</span><ChevronDown size={18} aria-hidden="true" /></summary><div>{answer}</div>
            </details>)}
        </div>
    </section>;
}
