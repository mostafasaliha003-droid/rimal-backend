import { useEffect, useMemo, useState } from 'react';
import { BadgePercent, Bug, Building2, Calculator, Globe, Headset, LayoutDashboard, LogOut, Search, Users } from 'lucide-react';
import { desk, DeskError, session } from './api';
import { DeskLanguage, dictionaries } from './i18n';
import Finance from './Finance';
import { Fees, Suppliers } from './Suppliers';
import Rates from './Rates';
import Care, { Bookings } from './Care';
import Team from './Team';
import Errors from './Errors';

const NAV = [
    { key: 'finance', icon: LayoutDashboard, roles: ['admin'] },
    { key: 'suppliers', icon: Building2, roles: ['admin'] },
    { key: 'rates', icon: Calculator, roles: ['admin'] },
    { key: 'fees', icon: BadgePercent, roles: ['admin'] },
    { key: 'care', icon: Headset, roles: ['admin', 'agent'] },
    { key: 'bookings', icon: Search, roles: ['admin', 'agent'] },
    { key: 'team', icon: Users, roles: ['admin'] },
    { key: 'errors', icon: Bug, roles: ['admin'] }
];

/** The brand mark with a slow orbit: the console's signature on the sign-in screen. */
function Orbit() {
    return <svg className="orbit" viewBox="0 0 400 400" aria-hidden="true">
        <defs>
            <radialGradient id="orbitGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#8E6BC0" stopOpacity="0.55" /><stop offset="1" stopColor="#1a1020" stopOpacity="0" /></radialGradient>
            <linearGradient id="orbitLine" x1="0" x2="1"><stop offset="0" stopColor="#C9B7F5" stopOpacity="0" /><stop offset="0.5" stopColor="#C9B7F5" stopOpacity="0.7" /><stop offset="1" stopColor="#3EEDBF" stopOpacity="0" /></linearGradient>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#orbitGlow)" />
        {[70, 112, 154].map((r, i) => <g key={r} className={`ring ring-${i}`}>
            <circle cx="200" cy="200" r={r} fill="none" stroke="url(#orbitLine)" strokeWidth="1.2" strokeDasharray={i === 1 ? '3 9' : 'none'} />
            <circle cx={200 + r} cy="200" r={i === 2 ? 5 : 4} fill={['#3EEDBF', '#F2B48C', '#C9B7F5'][i]} />
        </g>)}
        <path d="M150 178c18-12 82-12 100 0 9 15 9 49 0 64-18 12-82 12-100 0-9-15-9-49 0-64Z" fill="#fff" opacity="0.96" />
        <path d="M168 210c10 9 24 13 32 13s22-4 32-13" fill="none" stroke="#2D173A" strokeWidth="7" strokeLinecap="round" />
    </svg>;
}

function SignIn({ onSignedIn, t, toggleLanguage }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [state, setState] = useState({ busy: false, error: '' });
    const submit = async event => {
        event.preventDefault();
        setState({ busy: true, error: '' });
        try {
            const data = await desk('/login', { method: 'POST', body: { email, password } });
            session.set({ token: data.token, role: data.role, name: data.name, email: data.email, expiresAt: data.expiresAt });
            onSignedIn();
        } catch (error) {
            setState({ busy: false, error: error instanceof DeskError ? (error.status === 429 ? t.tooMany : error.status === 401 ? t.badCredentials : t.error) : t.offline });
        }
    };
    return <main className="signin">
        <section className="signin-art"><Orbit />
            <div className="signin-brand"><img src="/pillow/symbol.svg" alt="" width="54" height="46" /><div><b>{t.brand}</b><span>pillow stays · {t.desk}</span></div></div>
            <h1>{t.signInTitle}</h1><p>{t.signInBody}</p>
        </section>
        <form className="signin-form" onSubmit={submit}>
            <button type="button" className="lang-btn" onClick={toggleLanguage}><Globe size={15} />{t.language}</button>
            <h2>{t.signIn}</h2>
            <label><span>{t.email}</span><input type="email" dir="ltr" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label><span>{t.password}</span><input type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
            {state.error && <p className="form-error" role="alert">{state.error}</p>}
            <button className="btn btn-primary btn-wide" disabled={state.busy}>{state.busy ? t.signingIn : t.signIn}</button>
            <p className="muted small">{t.secureNote}</p>
        </form>
    </main>;
}

const routeFromHash = () => { const [view, arg] = decodeURIComponent(window.location.hash.slice(1)).split('/'); return { view, arg: arg || null }; };

export default function DeskApp() {
    const [lang, setLang] = useState(() => localStorage.getItem('mkhadda_desk_lang') === 'en' ? 'en' : 'ar');
    const [user, setUser] = useState(() => session.get());
    const [route, setRoute] = useState(routeFromHash);
    const t = dictionaries[lang], rtl = lang === 'ar';
    useEffect(() => {
        document.documentElement.lang = lang; document.documentElement.dir = rtl ? 'rtl' : 'ltr';
        localStorage.setItem('mkhadda_desk_lang', lang);
    }, [lang, rtl]);
    useEffect(() => {
        const out = () => setUser(null);
        const hash = () => setRoute(routeFromHash());
        window.addEventListener('desk:signed-out', out); window.addEventListener('hashchange', hash);
        return () => { window.removeEventListener('desk:signed-out', out); window.removeEventListener('hashchange', hash); };
    }, []);
    // Confirm the session is still valid on load (role, name).
    useEffect(() => { if (user) desk('/me').then(me => setUser(current => ({ ...current, ...me }))).catch(() => undefined); }, [user?.token]); // eslint-disable-line react-hooks/exhaustive-deps
    const allowed = useMemo(() => NAV.filter(item => user && item.roles.includes(user.role)), [user]);
    const view = allowed.some(item => item.key === route.view) ? route.view : allowed[0]?.key;
    const go = (next, arg) => { window.location.hash = arg ? `${next}/${encodeURIComponent(arg)}` : next; };
    const context = useMemo(() => ({ lang, rtl, t, role: user?.role }), [lang, rtl, t, user?.role]);
    const toggleLanguage = () => setLang(current => current === 'ar' ? 'en' : 'ar');
    const signOut = async () => { await desk('/logout', { method: 'POST' }).catch(() => undefined); session.clear(); setUser(null); };

    if (!user) return <DeskLanguage.Provider value={context}><SignIn t={t} toggleLanguage={toggleLanguage} onSignedIn={() => { setUser(session.get()); go(session.get().role === 'agent' ? 'care' : 'finance'); }} /></DeskLanguage.Provider>;
    return <DeskLanguage.Provider value={context}>
        <div className="shell">
            <nav className="sidebar" aria-label="Desk">
                <div className="side-brand"><img src="/pillow/symbol.svg" alt="" width="36" height="31" /><div><b>{t.brand}</b><span>{t.desk}</span></div></div>
                <ul>{allowed.map(item => <li key={item.key}><a href={`#${item.key}`} className={view === item.key ? 'on' : ''} aria-current={view === item.key ? 'page' : undefined}>
                    <item.icon size={19} /><span>{t[item.key]}</span></a></li>)}</ul>
                <div className="side-foot">
                    <button className="side-btn" onClick={toggleLanguage}><Globe size={17} /><span>{t.language}</span></button>
                    <div className="me"><span className="avatar">{(user.name || user.email || '?').charAt(0).toUpperCase()}</span>
                        <span className="me-text"><b>{user.name}</b><small>{t[user.role]}</small></span>
                        <button className="icon-btn" onClick={signOut} aria-label={t.signOut} title={t.signOut}><LogOut size={17} /></button></div>
                </div>
            </nav>
            <main className="main" key={view}>
                {view === 'finance' && <Finance go={go} />}
                {view === 'suppliers' && <Suppliers />}
                {view === 'rates' && <Rates />}
                {view === 'fees' && <Fees />}
                {view === 'care' && <Care initialChat={route.view === 'care' && route.arg ? { id: route.arg.split('|')[0], reference: route.arg.split('|')[1] } : null} />}
                {view === 'bookings' && <Bookings initial={route.view === 'bookings' ? route.arg : null} openChat={(id, reference) => go('care', `${id}|${reference}`)} />}
                {view === 'team' && <Team />}
                {view === 'errors' && <Errors />}
            </main>
        </div>
    </DeskLanguage.Provider>;
}
