import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, LoaderCircle, LogIn, Mail, Phone, ShieldCheck, UserPlus } from 'lucide-react';
import BookingAPI from '../services/bookingApi';
import { trackBookingEvent } from '../services/analytics';
import { useLanguage } from '../i18n';

const USER_STORAGE_KEY = 'rimal_current_user';

function readStoredUser() {
    try {
        const raw = localStorage.getItem(USER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveUser(user) {
    try { localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user)); } catch {}
    window.dispatchEvent(new CustomEvent('remal:user-changed', { detail: user }));
}

function clearUser() {
    try { localStorage.removeItem(USER_STORAGE_KEY); } catch {}
    window.dispatchEvent(new CustomEvent('remal:user-changed', { detail: null }));
}

function requestErrorMessage(requestError, fallback, translate) {
    const code = requestError?.response?.data?.error;
    const knownMessage = {
        EMAIL_ALREADY_REGISTERED: translate('account.emailAlreadyRegistered', 'هذا البريد الإلكتروني مسجل مسبقاً.'),
        INVALID_NAME: translate('account.invalidName', 'يرجى إدخال الاسم الكامل.'),
        INVALID_EMAIL: translate('account.invalidEmail', 'يرجى إدخال بريد إلكتروني صحيح.'),
        INVALID_PASSWORD: translate('account.passwordLength', 'استخدم كلمة مرور من 6 أحرف أو أكثر.'),
        VERIFICATION_EMAIL_UNAVAILABLE: translate('account.emailUnavailable', 'تعذر إرسال البريد الإلكتروني حالياً. يرجى المحاولة مرة أخرى.')
    }[code];
    return knownMessage
        || requestError?.response?.data?.message
        || (code && !/request failed|^5\d\d$/i.test(String(code)) ? code : '')
        || requestError?.message
        || fallback;
}

function Field({ label, icon: Icon, ...props }) {
    return (
        <label className="block space-y-2 text-sm font-bold text-slate-700">
            <span>{label}</span>
            <span className="relative block">
                {Icon && <Icon size={17} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />}
                <input {...props} className={`min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 ${Icon ? 'pr-11' : ''} text-sm font-semibold text-slate-900 outline-none transition focus:border-[var(--remal-focus)] focus:bg-white focus:ring-4 focus:ring-cyan-100`} />
            </span>
        </label>
    );
}

export default function AccountCenter({ onNavigate }) {
    const { t, direction } = useLanguage();
    const [user, setUser] = useState(readStoredUser);
    const [mode, setMode] = useState('login');
    const [registerStep, setRegisterStep] = useState('details');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [profile, setProfile] = useState(null);
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });
    const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '', phone: '' });
    const [verificationCode, setVerificationCode] = useState('');

    useEffect(() => {
        const handleUserChange = event => setUser(event.detail || null);
        const handleStorage = () => setUser(readStoredUser());
        window.addEventListener('remal:user-changed', handleUserChange);
        window.addEventListener('storage', handleStorage);
        return () => {
            window.removeEventListener('remal:user-changed', handleUserChange);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    useEffect(() => {
        if (!user?.email) {
            setProfile(null);
            return undefined;
        }
        let active = true;
        BookingAPI.getUserProfile(user.email).then(result => {
            if (active && result?.success) {
                setProfile(result.profile);
                saveUser({ ...user, ...result.profile });
            }
        }).catch(() => {});
        return () => { active = false; };
    }, [user?.email]);

    const clearFeedback = () => {
        setError('');
        setMessage('');
    };

    const handleLogin = async event => {
        event.preventDefault();
        clearFeedback();
        setBusy(true);
        try {
            const result = await BookingAPI.login(loginForm);
            if (!result?.success) throw new Error(result?.error || t('account.loginError', 'تعذر تسجيل الدخول'));
            saveUser(result.user);
            setUser(result.user);
            trackBookingEvent('login_succeeded');
            setMessage(t('account.loginSuccess', 'مرحباً بعودتك. تم تسجيل الدخول بنجاح.'));
        } catch (requestError) {
            setError(requestErrorMessage(requestError, t('account.invalidCredentials', 'بيانات الدخول غير صحيحة'), t));
        } finally {
            setBusy(false);
        }
    };

    const handleRegisterStart = async event => {
        event.preventDefault();
        clearFeedback();
        if (registerForm.password.length < 6) {
            setError(t('account.passwordLength', 'استخدم كلمة مرور من 6 أحرف أو أكثر.'));
            return;
        }
        setBusy(true);
        try {
            const result = await BookingAPI.registerSendCode(registerForm);
            if (!result?.success) throw new Error(result?.error || t('account.sendCodeError', 'تعذر إرسال رمز التحقق'));
            setRegisterStep('verify');
            setMessage(t('account.codeSent', 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.'));
        } catch (requestError) {
            setError(requestErrorMessage(requestError, t('account.createError', 'تعذر إنشاء الحساب'), t));
        } finally {
            setBusy(false);
        }
    };

    const handleRegisterVerify = async event => {
        event.preventDefault();
        clearFeedback();
        setBusy(true);
        try {
            const result = await BookingAPI.verifyRegistration(registerForm.email, verificationCode);
            if (!result?.success) throw new Error(result?.error || t('account.invalidCode', 'رمز التحقق غير صحيح'));
            saveUser(result.user);
            setUser(result.user);
            trackBookingEvent('register_succeeded');
            setMessage(t('account.accountCreated', 'تم إنشاء حسابك وإضافة نقاط البداية إلى برنامج الولاء.'));
        } catch (requestError) {
            setError(requestErrorMessage(requestError, t('account.invalidCode', 'رمز التحقق غير صحيح أو منتهي'), t));
        } finally {
            setBusy(false);
        }
    };

    if (user) {
        const points = Number(profile?.points ?? user.points ?? 500);
        return (
            <main dir={direction} className="min-h-[calc(100vh-72px)] bg-[#f7f9fc] px-5 py-10 lg:px-10 lg:py-16">
                <div className="mx-auto max-w-5xl">
                    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <p className="eyebrow">{t('account.title', 'حسابك في رمال')}</p>
                            <h1 className="mt-2 text-4xl font-black text-[var(--remal-navy)]">{t('account.welcome', `أهلاً، ${user.name?.split(' ')[0] || 'بك'}`, { name: user.name?.split(' ')[0] || 'بك' })}</h1>
                            <p className="mt-2 text-sm font-medium text-slate-500">{t('account.subtitle', 'أدر حسابك، تابع حجوزاتك، واستفد من برنامج الولاء.')}</p>
                        </div>
                        <button type="button" onClick={() => { clearUser(); setUser(null); }} className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700">{t('account.logout', 'تسجيل الخروج')}</button>
                    </div>

                    {(message || error) && <div role={error ? 'alert' : 'status'} className={`mb-6 rounded-2xl border p-4 text-sm font-bold ${error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}

                    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                        <section className="surface-card rounded-3xl p-6 sm:p-8">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="eyebrow">{t('account.summary', 'ملخص الحساب')}</p>
                                    <h2 className="mt-2 text-2xl font-black text-slate-900">{t('account.saved', 'بياناتك محفوظة لتجربة أسرع')}</h2>
                                </div>
                                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan-50 text-[var(--remal-blue)]"><ShieldCheck size={27} /></div>
                            </div>
                            <div className="mt-7 grid gap-4 sm:grid-cols-2">
                                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{t('account.name', 'الاسم')}</p><p className="mt-1 font-black text-slate-900">{user.name}</p></div>
                                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{t('account.email', 'البريد الإلكتروني')}</p><p className="mt-1 break-all font-black text-slate-900">{user.email}</p></div>
                                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{t('account.phone', 'رقم الهاتف')}</p><p className="mt-1 font-black text-slate-900">{profile?.phone || user.phone || t('account.notAdded', 'لم تتم الإضافة')}</p></div>
                                <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{t('account.points', 'النقاط الحالية')}</p><p className="mt-1 font-black text-[var(--remal-blue)]">{points.toLocaleString('en-US')} {t('loyalty.pointsWord', 'نقطة')}</p></div>
                            </div>
                            <button type="button" onClick={() => onNavigate?.('/loyalty')} className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--remal-orange)] px-6 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:-translate-y-0.5 hover:bg-[#d86522]">{t('account.exploreLoyalty', 'استكشف مستويات الولاء')} <ArrowLeft size={17} /></button>
                        </section>

                        <section className="rounded-3xl bg-gradient-to-br from-[#102a43] to-[#0f8fa3] p-6 text-white shadow-xl sm:p-8">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">{t('account.loyaltyProgram', 'برنامج رمال للولاء')}</p>
                            <h2 className="mt-3 text-3xl font-black">{t('account.loyaltyTitle', 'كل رحلة تقرّبك من مزايا أكثر')}</h2>
                            <p className="mt-4 text-sm font-medium leading-7 text-white/80">{t('account.loyaltyDescription', 'اجمع النقاط مع حجوزاتك المؤهلة، وتعرّف على المستوى المناسب لك.')}</p>
                            <button type="button" onClick={() => onNavigate?.('/loyalty')} className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-[var(--remal-navy)] transition hover:bg-cyan-50">{t('account.viewTiers', 'عرض الـ Tiers')} <ArrowLeft size={17} /></button>
                        </section>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main dir={direction} className="min-h-[calc(100vh-72px)] bg-[#f7f9fc] px-5 py-10 lg:px-10 lg:py-16">
            <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
                <section className="rounded-3xl bg-gradient-to-br from-[#102a43] to-[#0f8fa3] p-7 text-white shadow-xl sm:p-9">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">رمال وفِلّها</p>
                    <h1 className="mt-4 text-4xl font-black leading-tight">{t('account.startAccount', 'حساب واحد لرحلاتك القادمة')}</h1>
                    <p className="mt-4 text-sm font-medium leading-7 text-white/80">{t('account.subtitle', 'احفظ بياناتك، تابع حجوزاتك، وابدأ جمع النقاط من أول إقامة.')}</p>
                    <div className="mt-8 space-y-3 text-sm font-bold text-white/90">
                        <p className="flex items-center gap-2"><CheckCircle2 size={18} className="text-cyan-200" /> {t('account.fastLogin', 'دخول أسرع في المرات القادمة')}</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={18} className="text-cyan-200" /> {t('account.clearTiers', 'برنامج ولاء بمستويات واضحة')}</p>
                        <p className="flex items-center gap-2"><CheckCircle2 size={18} className="text-cyan-200" /> {t('account.bookingTracking', 'متابعة الحجوزات من مكان واحد')}</p>
                    </div>
                </section>

                <section className="surface-card rounded-3xl p-6 sm:p-8">
                    <div className="flex rounded-2xl bg-slate-100 p-1">
                        <button type="button" onClick={() => { setMode('login'); setRegisterStep('details'); clearFeedback(); }} className={`flex-1 rounded-xl px-4 py-3 text-sm font-black transition ${mode === 'login' ? 'bg-white text-[var(--remal-blue)] shadow-sm' : 'text-slate-500'}`}><LogIn size={16} className="mx-auto mb-1" /> {t('account.loginTab', 'تسجيل الدخول')}</button>
                        <button type="button" onClick={() => { setMode('register'); setRegisterStep('details'); clearFeedback(); }} className={`flex-1 rounded-xl px-4 py-3 text-sm font-black transition ${mode === 'register' ? 'bg-white text-[var(--remal-blue)] shadow-sm' : 'text-slate-500'}`}><UserPlus size={16} className="mx-auto mb-1" /> {t('account.registerTab', 'حساب جديد')}</button>
                    </div>

                    <div className="mt-7">
                        <p className="eyebrow">{mode === 'login' ? t('account.loginWelcome', 'مرحباً بعودتك') : registerStep === 'details' ? t('account.startAccount', 'ابدأ حسابك') : t('account.verifyEmail', 'تحقق من بريدك')}</p>
                        <h2 className="mt-2 text-3xl font-black text-slate-900">{mode === 'login' ? t('account.loggedInTitle', 'سجّل الدخول إلى رمال') : registerStep === 'details' ? t('account.createTitle', 'أنشئ حساباً جديداً') : t('account.verificationCode', 'أدخل رمز التحقق')}</h2>
                    </div>

                    {(message || error) && <div role={error ? 'alert' : 'status'} className={`mt-5 rounded-2xl border p-4 text-sm font-bold ${error ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{error || message}</div>}

                    {mode === 'login' && <form className="mt-6 space-y-4" onSubmit={handleLogin}>
                        <Field label={t('account.email', 'البريد الإلكتروني')} icon={Mail} type="email" required value={loginForm.email} onChange={event => setLoginForm({ ...loginForm, email: event.target.value })} autoComplete="email" />
                        <Field label={t('account.password', 'كلمة المرور')} icon={ShieldCheck} type="password" required value={loginForm.password} onChange={event => setLoginForm({ ...loginForm, password: event.target.value })} autoComplete="current-password" />
                        <button disabled={busy} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--remal-orange)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-100 transition hover:bg-[#d86522] disabled:opacity-60">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <LogIn size={18} />} {t('account.secureLogin', 'دخول آمن')}</button>
                    </form>}

                    {mode === 'register' && registerStep === 'details' && <form className="mt-6 space-y-4" onSubmit={handleRegisterStart}>
                        <Field label={t('account.fullName', 'الاسم الكامل')} icon={UserPlus} type="text" required value={registerForm.name} onChange={event => setRegisterForm({ ...registerForm, name: event.target.value })} autoComplete="name" />
                        <Field label={t('account.email', 'البريد الإلكتروني')} icon={Mail} type="email" required value={registerForm.email} onChange={event => setRegisterForm({ ...registerForm, email: event.target.value })} autoComplete="email" />
                        <Field label={t('account.optionalPhone', 'رقم الهاتف (اختياري)')} icon={Phone} type="tel" value={registerForm.phone} onChange={event => setRegisterForm({ ...registerForm, phone: event.target.value })} autoComplete="tel" />
                        <Field label={t('account.password', 'كلمة المرور')} icon={ShieldCheck} type="password" required minLength={6} value={registerForm.password} onChange={event => setRegisterForm({ ...registerForm, password: event.target.value })} autoComplete="new-password" />
                        <button disabled={busy} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--remal-orange)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-100 transition hover:bg-[#d86522] disabled:opacity-60">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <Mail size={18} />} {t('account.sendCode', 'إرسال رمز التحقق')}</button>
                    </form>}

                    {mode === 'register' && registerStep === 'verify' && <form className="mt-6 space-y-4" onSubmit={handleRegisterVerify}>
                        <div className="rounded-2xl bg-cyan-50 p-4 text-sm font-bold leading-6 text-cyan-900">{t('account.verifyMessage', 'أرسلنا رمزاً إلى بريدك الإلكتروني. الرمز صالح لمدة محدودة.')} <span dir="ltr">{registerForm.email}</span></div>
                        <Field label={t('account.verificationCode', 'رمز التحقق')} type="text" inputMode="numeric" required minLength={6} maxLength={6} value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" />
                        <button disabled={busy || verificationCode.length !== 6} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--remal-orange)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-100 transition hover:bg-[#d86522] disabled:opacity-60">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <CheckCircle2 size={18} />} {t('account.activate', 'تفعيل الحساب')}</button>
                        <button type="button" onClick={() => { setRegisterStep('details'); clearFeedback(); }} className="w-full py-2 text-sm font-bold text-slate-500 hover:text-slate-800">{t('account.editDetails', 'تعديل البيانات')}</button>
                    </form>}
                </section>
            </div>
        </main>
    );
}