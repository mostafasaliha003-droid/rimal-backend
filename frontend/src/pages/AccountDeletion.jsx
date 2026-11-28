import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';
import BookingAPI from '../services/bookingApi';
import { clearUserSession, saveUserSession, userAccessToken } from '../services/authSession.js';
import { getAccountDeletion, requestAccountDeletion } from '../services/accountDeletion.js';
import CompanyFooter from '../components/CompanyFooter';

const copy = {
    en: {
        title: 'Request account deletion', home: 'Home', language: 'Language',
        intro: 'You can request a review of deletion of your account and associated personal data here, without downloading the app.',
        pending: 'Submitting this form records a request for review. It does not delete your account or data, cancel bookings, or change payments, refunds or support records. Your request remains pending until reviewed.',
        privacy: 'Read the privacy policy', signIn: 'Sign in to your account', signInBody: 'Sign in to request deletion for your own account. No booking or approved membership is required.',
        email: 'Email', password: 'Password', login: 'Sign in', loginError: 'Unable to sign in. Check your details and try again.',
        loading: 'Checking request status…', signedIn: 'Your account is signed in.', consent: 'I request review of deletion of my account and associated personal data. I understand that submitting this request does not delete data or cancel bookings.',
        send: 'Send deletion request', working: 'Please wait…', received: 'Request received — pending review',
        receivedBody: 'The server has recorded your request. Your account and data have not been deleted. Existing bookings remain unchanged.',
        reference: 'Request reference', requestedAt: 'Received at', retry: 'Try again',
        unavailable: 'The request service is unavailable. A new request has not been confirmed as received. Retry to check the server status before submitting again.',
        wrongPassword: 'The password was not accepted. Your session is still signed in. Check your password and try again.',
        expired: 'Your session has expired. Sign in again to continue.', signOut: 'Sign out',
        formHelp: 'Confirm with your current password. The request applies only to the account signed in on this page.'
    },
    ar: {
        title: 'طلب حذف الحساب', home: 'الرئيسية', language: 'اللغة',
        intro: 'يمكنك من هنا طلب مراجعة حذف حسابك والبيانات الشخصية المرتبطة به، دون تنزيل التطبيق.',
        pending: 'يسجّل إرسال النموذج طلبًا للمراجعة. لا يحذف حسابك أو بياناتك، ولا يلغي الحجوزات أو يغيّر المدفوعات أو المبالغ المستردة أو سجلات الدعم. يبقى طلبك معلّقًا حتى مراجعته.',
        privacy: 'قراءة سياسة الخصوصية', signIn: 'تسجيل الدخول إلى حسابك', signInBody: 'سجّل الدخول لطلب حذف حسابك أنت. لا يُشترط وجود حجز أو عضوية معتمدة.',
        email: 'البريد الإلكتروني', password: 'كلمة المرور', login: 'تسجيل الدخول', loginError: 'تعذّر تسجيل الدخول. تحقق من بياناتك وحاول مجددًا.',
        loading: 'جارٍ التحقق من حالة الطلب…', signedIn: 'تم تسجيل الدخول إلى حسابك.', consent: 'أطلب مراجعة حذف حسابي والبيانات الشخصية المرتبطة به. أفهم أن إرسال الطلب لا يحذف البيانات ولا يلغي الحجوزات.',
        send: 'إرسال طلب الحذف', working: 'يرجى الانتظار…', received: 'تم استلام الطلب — بانتظار المراجعة',
        receivedBody: 'سجّل الخادم طلبك. لم يُحذف حسابك أو بياناتك، وتبقى حجوزاتك القائمة دون تغيير.',
        reference: 'مرجع الطلب', requestedAt: 'وقت الاستلام', retry: 'إعادة المحاولة',
        unavailable: 'خدمة الطلبات غير متاحة. لم يتم تأكيد استلام طلب جديد. أعد المحاولة للتحقق من حالة الطلب لدى الخادم قبل إرساله مجددًا.',
        wrongPassword: 'لم تُقبل كلمة المرور. ما زالت جلسة الدخول قائمة. تحقق من كلمة المرور وحاول مجددًا.',
        expired: 'انتهت جلسة الدخول. سجّل الدخول مجددًا للمتابعة.', signOut: 'تسجيل الخروج',
        formHelp: 'أكّد باستخدام كلمة مرورك الحالية. ينطبق الطلب فقط على الحساب المسجّل دخوله في هذه الصفحة.'
    },
    es: {
        title: 'Solicitar la eliminación de la cuenta', home: 'Inicio', language: 'Idioma',
        intro: 'Puedes solicitar aquí la revisión de la eliminación de tu cuenta y los datos personales asociados, sin descargar la aplicación.',
        pending: 'Enviar el formulario registra una solicitud de revisión. No elimina tu cuenta ni tus datos, no cancela reservas ni cambia pagos, reembolsos o registros de asistencia. La solicitud queda pendiente de revisión.',
        privacy: 'Leer la política de privacidad', signIn: 'Inicia sesión en tu cuenta', signInBody: 'Inicia sesión para solicitar la eliminación de tu propia cuenta. No necesitas una reserva ni una membresía aprobada.',
        email: 'Correo electrónico', password: 'Contraseña', login: 'Iniciar sesión', loginError: 'No se pudo iniciar sesión. Comprueba tus datos e inténtalo de nuevo.',
        loading: 'Comprobando el estado…', signedIn: 'Has iniciado sesión en tu cuenta.', consent: 'Solicito que se revise la eliminación de mi cuenta y los datos personales asociados. Entiendo que enviar la solicitud no elimina datos ni cancela reservas.',
        send: 'Enviar solicitud', working: 'Espera…', received: 'Solicitud recibida — pendiente de revisión',
        receivedBody: 'El servidor ha registrado tu solicitud. Tu cuenta y tus datos no se han eliminado. Las reservas existentes no cambian.',
        reference: 'Referencia', requestedAt: 'Recibida el', retry: 'Reintentar',
        unavailable: 'El servicio no está disponible. No se ha confirmado la recepción de una nueva solicitud. Reintenta para comprobar el estado del servidor antes de volver a enviarla.',
        wrongPassword: 'No se aceptó la contraseña. Tu sesión sigue abierta. Comprueba la contraseña e inténtalo de nuevo.',
        expired: 'Tu sesión ha caducado. Inicia sesión de nuevo.', signOut: 'Cerrar sesión',
        formHelp: 'Confirma con tu contraseña actual. La solicitud solo corresponde a la cuenta conectada en esta página.'
    }
};
const fieldClass = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700';
const buttonClass = 'min-h-12 rounded-xl bg-remal-navy px-5 py-3 font-bold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700';

export default function AccountDeletion() {
    const { language, direction, setLanguage } = useLanguage(), L = copy[language] || copy.en;
    const [token, setToken] = useState(userAccessToken), [status, setStatus] = useState('loading');
    const [request, setRequest] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
    const [password, setPassword] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
    const [login, setLogin] = useState({ email: '', password: '' });
    const sequence = useRef(0), active = useRef(true), controller = useRef(null);
    useEffect(() => {
        active.current = true;
        const changed = () => { ++sequence.current; controller.current?.abort(); setToken(userAccessToken()); setRetry(value => value + 1); setPassword(''); setConfirmed(false); setLogin({ email: '', password: '' }); setRequest(null); setBusy(false); };
        window.addEventListener('remal:user-changed', changed); window.addEventListener('storage', changed);
        return () => { active.current = false; ++sequence.current; controller.current?.abort(); window.removeEventListener('remal:user-changed', changed); window.removeEventListener('storage', changed); };
    }, []);
    useEffect(() => {
        const attempt = ++sequence.current, abort = new AbortController(); controller.current = abort;
        setRequest(null); setError(''); setPassword(''); setConfirmed(false);
        if (!token) { setStatus('signed-out'); return () => abort.abort(); }
        setStatus('loading');
        getAccountDeletion({ token, signal: abort.signal }).then(row => {
            if (active.current && attempt === sequence.current) { setRequest(row); setStatus('ready'); }
        }).catch(failure => {
            if (!active.current || attempt !== sequence.current) return;
            if (failure.status === 401 && userAccessToken() === token) { clearUserSession(); setError('expired'); }
            else { setStatus('unavailable'); setError('unavailable'); }
        });
        return () => abort.abort();
    }, [token, retry]);
    const signIn = async event => {
        event.preventDefault(); if (busy) return;
        const attempt = ++sequence.current, credentials = { ...login }; setBusy(true); setError(''); setLogin(value => ({ ...value, password: '' }));
        try {
            const result = await BookingAPI.login(credentials);
            if (active.current && attempt === sequence.current) {
                if (result?.success !== true) throw Error('login_failed');
                saveUserSession(result.user, result.access_token);
            }
        } catch { if (active.current && attempt === sequence.current) setError('loginError'); }
        finally { if (active.current && attempt === sequence.current) setBusy(false); }
    };
    const submit = async event => {
        event.preventDefault(); if (!token || token !== userAccessToken() || busy || status !== 'ready' || request || !confirmed || !password) return;
        const attempt = ++sequence.current, currentPassword = password, abort = new AbortController(); controller.current = abort;
        setBusy(true); setError(''); setPassword(''); setConfirmed(false);
        try {
            const row = await requestAccountDeletion({ password: currentPassword, confirmed: true, token, signal: abort.signal });
            if (active.current && attempt === sequence.current && token === userAccessToken()) setRequest(row);
        } catch (failure) {
            if (!active.current || attempt !== sequence.current) return;
            if (failure.status === 401 && userAccessToken() === token) { clearUserSession(); setError('expired'); }
            else { setError(failure.code === 'reauthentication_failed' ? 'wrongPassword' : 'unavailable'); if (failure.code !== 'reauthentication_failed') setStatus('unavailable'); }
        } finally { if (active.current && attempt === sequence.current) setBusy(false); }
    };
    return <div dir={direction}>
        <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-5 py-6">
            <a href={`/?lang=${language}`} className="flex min-h-12 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-700"><img src="/pillow-symbol.png" width="56" height="44" alt="" /><span><strong className="block text-xl"><bdi>Pillow Stays | مخدة</bdi></strong></span></a>
            <label className="flex items-center gap-2 text-sm font-bold">{L.language}<select className={fieldClass} value={language} onChange={event => setLanguage(event.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="es">Español</option></select></label>
        </header>
        <main className="mx-auto max-w-3xl space-y-6 px-5 pb-12">
            <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
                <h1 className="text-3xl font-black text-remal-navy">{L.title}</h1><p className="leading-8">{L.intro}</p><p className="rounded-xl bg-slate-100 p-4 leading-8">{L.pending}</p>
                <a className="inline-flex min-h-11 items-center font-bold text-remal-blue-strong underline focus-visible:outline focus-visible:outline-2" href={`/privacy?lang=${language}`}>{L.privacy}</a>
            </section>
            <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8" aria-busy={busy || status === 'loading'}>
                {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 leading-7 text-red-900">{L[error]}</p>}
                {status === 'loading' ? <p role="status">{L.loading}</p> : status === 'signed-out' ? <form onSubmit={signIn} className="space-y-5">
                    <h2 className="text-xl font-bold">{L.signIn}</h2><p className="leading-7 text-slate-700">{L.signInBody}</p>
                    <label className="block space-y-2 font-bold"><span>{L.email}</span><input className={fieldClass} type="email" autoComplete="username" dir="ltr" required maxLength={254} value={login.email} onChange={event => setLogin({ ...login, email: event.target.value })} disabled={busy} /></label>
                    <label className="block space-y-2 font-bold"><span>{L.password}</span><input className={fieldClass} type="password" autoComplete="current-password" required maxLength={256} value={login.password} onChange={event => setLogin({ ...login, password: event.target.value })} disabled={busy} /></label>
                    <button className={buttonClass} disabled={busy}>{busy ? L.working : L.login}</button>
                </form> : status === 'unavailable' ? <button className={buttonClass} onClick={() => setRetry(value => value + 1)}>{L.retry}</button> : request ? <div role="status" className="space-y-4">
                    <h2 className="text-xl font-bold">{L.received}</h2><p className="leading-8">{L.receivedBody}</p><dl className="space-y-3"><dt className="font-bold">{L.reference}</dt><dd className="break-all"><bdi dir="ltr">{request.reference}</bdi></dd><dt className="font-bold">{L.requestedAt}</dt><dd><time dateTime={request.requested_at}>{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.requested_at))}</time></dd></dl>
                </div> : <form onSubmit={submit} className="space-y-5">
                    <h2 className="text-xl font-bold">{L.signedIn}</h2><p id="deletion-password-help" className="leading-7 text-slate-700">{L.formHelp}</p>
                    <label className="block space-y-2 font-bold"><span>{L.password}</span><input className={fieldClass} type="password" autoComplete="current-password" required maxLength={256} aria-describedby="deletion-password-help" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
                    <label className="flex min-h-12 items-start gap-3 leading-7"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={confirmed} required onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>{L.consent}</span></label>
                    <button className={buttonClass} disabled={busy || !confirmed || !password}>{busy ? L.working : L.send}</button>
                </form>}
            </section>
        </main><CompanyFooter />
    </div>;
}
