import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';
import { listAccountDeletionRequests } from '../services/accountDeletion.js';
import { supportRequest, STAFF_TOKEN_KEY } from '../services/customerSupport';

const copy = {
    ar: { title: 'طلبات حذف الحساب — عرض فقط', intro: 'طلبات مستلمة بانتظار المراجعة. لا تنفّذ هذه القائمة حذفًا للحساب أو البيانات أو تغييرًا للحجوزات.', admin: 'لوحة الإدارة', signIn: 'دخول الإدارة', email: 'البريد الإلكتروني', password: 'كلمة المرور', loading: 'جارٍ التحميل…', refresh: 'تحديث', reference: 'مرجع الطلب', owner: 'معرّف صاحب الحساب', status: 'الحالة', received: 'وقت الاستلام', requested: 'مستلم — بانتظار المراجعة', empty: 'لا توجد طلبات في هذه الصفحة.', previous: 'السابق', next: 'التالي', unavailable: 'تعذّر تحميل القائمة. لم تُنفّذ أي تغييرات.', denied: 'الوصول مقيّد. استخدم جلسة إدارة مخوّلة.', loginError: 'تعذّر تسجيل دخول الإدارة.', table: 'طلبات حذف الحساب المستلمة', page: 'بداية النتائج' },
    en: { title: 'Account deletion requests — read only', intro: 'Received requests awaiting review. This queue does not delete accounts or data, or change bookings.', admin: 'Admin dashboard', signIn: 'Admin sign in', email: 'Email', password: 'Password', loading: 'Loading…', refresh: 'Refresh', reference: 'Request reference', owner: 'Account subject', status: 'Status', received: 'Received at', requested: 'Received — pending review', empty: 'No requests on this page.', previous: 'Previous', next: 'Next', unavailable: 'The queue could not be loaded. No changes were made.', denied: 'Access is restricted. Use an authorized admin session.', loginError: 'Unable to sign in as an administrator.', table: 'Received account deletion requests', page: 'Results start at' },
    es: { title: 'Solicitudes de eliminación — solo lectura', intro: 'Solicitudes recibidas pendientes de revisión. Esta lista no elimina cuentas ni datos ni cambia reservas.', admin: 'Panel de administración', signIn: 'Acceso de administración', email: 'Correo electrónico', password: 'Contraseña', loading: 'Cargando…', refresh: 'Actualizar', reference: 'Referencia', owner: 'Identificador de cuenta', status: 'Estado', received: 'Recibida el', requested: 'Recibida — pendiente de revisión', empty: 'No hay solicitudes en esta página.', previous: 'Anterior', next: 'Siguiente', unavailable: 'No se pudo cargar la lista. No se hicieron cambios.', denied: 'Acceso restringido. Usa una sesión de administración autorizada.', loginError: 'No se pudo iniciar sesión como administrador.', table: 'Solicitudes de eliminación recibidas', page: 'Los resultados empiezan en' }
};
function staffToken() { try { return sessionStorage.getItem(STAFF_TOKEN_KEY); } catch { return null; } }
const buttonClass = 'min-h-12 rounded-xl border border-slate-300 bg-white px-5 py-3 font-bold text-remal-navy disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-700';

export default function AccountDeletionRequests() {
    const { language, direction, setLanguage } = useLanguage(), L = copy[language] || copy.en;
    const [token, setToken] = useState(staffToken), [rows, setRows] = useState([]), [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
    const [credentials, setCredentials] = useState({ email: '', password: '' });
    const sequence = useRef(0), active = useRef(true), limit = 25;
    useEffect(() => { active.current = true; return () => { active.current = false; ++sequence.current; }; }, []);
    useEffect(() => {
        const attempt = ++sequence.current, controller = new AbortController();
        setRows([]); setHasMore(false); setError('');
        if (!token) { setBusy(false); return () => controller.abort(); }
        setBusy(true);
        listAccountDeletionRequests({ token, limit, offset, signal: controller.signal }).then(data => {
            if (active.current && attempt === sequence.current) { setRows(data.requests); setHasMore(data.pagination.has_more); }
        }).catch(failure => {
            if (!active.current || attempt !== sequence.current) return;
            if (failure.status === 401 && staffToken() === token) { try { sessionStorage.removeItem(STAFF_TOKEN_KEY); } catch {} setToken(null); }
            else setError(failure.status === 403 ? 'denied' : 'unavailable');
        }).finally(() => { if (active.current && attempt === sequence.current) setBusy(false); });
        return () => controller.abort();
    }, [token, offset, retry]);
    const signIn = async event => {
        event.preventDefault(); if (busy) return;
        const attempt = ++sequence.current, body = { ...credentials }; setBusy(true); setError(''); setCredentials(value => ({ ...value, password: '' }));
        try {
            const result = await supportRequest('/login', { staff: true, auth: true, method: 'POST', body });
            if (active.current && attempt === sequence.current) {
                if (typeof result?.access_token !== 'string' || !/^[a-f\d]{64}$/i.test(result.access_token)) throw Error('invalid_session');
                sessionStorage.setItem(STAFF_TOKEN_KEY, result.access_token); setCredentials({ email: '', password: '' }); setOffset(0); setToken(result.access_token);
            }
        } catch { if (active.current && attempt === sequence.current) setError('loginError'); }
        finally { if (active.current && attempt === sequence.current) setBusy(false); }
    };
    return <main dir={direction} className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4"><a className="inline-flex min-h-12 items-center font-bold text-remal-blue-strong underline" href="/admin.html">{L.admin}</a><label className="flex items-center gap-2"><span className="sr-only">{language === 'ar' ? 'اللغة' : language === 'es' ? 'Idioma' : 'Language'}</span><select className="min-h-12 rounded-xl border border-slate-300 px-3" value={language} onChange={event => setLanguage(event.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="es">Español</option></select></label></header>
        <h1 className="text-3xl font-black text-remal-navy">{L.title}</h1><p className="max-w-3xl leading-8">{L.intro}</p>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">{L[error]}</p>}
        {!token ? <form onSubmit={signIn} className="max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-bold">{L.signIn}</h2>{['email', 'password'].map(name => <label key={name} className="block space-y-2 font-bold"><span>{L[name]}</span><input type={name} autoComplete={name === 'email' ? 'username' : 'current-password'} className="min-h-12 w-full rounded-xl border border-slate-300 px-3" maxLength={name === 'email' ? 254 : 256} required value={credentials[name]} onChange={event => setCredentials({ ...credentials, [name]: event.target.value })} disabled={busy} /></label>)}<button className={buttonClass} disabled={busy}>{busy ? L.loading : L.signIn}</button></form> : <section className="space-y-4" aria-busy={busy}>
            <button className={buttonClass} disabled={busy} onClick={() => setRetry(value => value + 1)}>{L.refresh}</button>
            {busy ? <p role="status">{L.loading}</p> : !error && <>
                <div role="region" aria-label={L.table} tabIndex={0} className="overflow-x-auto rounded-2xl border border-slate-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-700"><table className="w-full text-start"><caption className="sr-only">{L.table}</caption><thead><tr>{[L.reference, L.owner, L.status, L.received].map(label => <th key={label} scope="col" className="px-4 py-4 text-start">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.reference} className="border-t border-slate-200"><th scope="row" className="max-w-72 break-all px-4 py-4 text-start font-normal"><bdi dir="ltr">{row.reference}</bdi></th><td className="max-w-64 break-all px-4 py-4"><bdi dir="ltr">{row.ownerSubject}</bdi></td><td className="px-4 py-4">{L.requested}</td><td className="px-4 py-4"><time dateTime={row.requested_at}>{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.requested_at))}</time></td></tr>)}</tbody></table>{!rows.length && <p className="p-5">{L.empty}</p>}</div>
                <nav className="flex flex-wrap items-center gap-3" aria-label={L.table}><button className={buttonClass} disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - limit))}>{L.previous}</button><span>{L.page} {offset + 1}</span><button className={buttonClass} disabled={!hasMore || offset + limit > 10000} onClick={() => setOffset(value => value + limit)}>{L.next}</button></nav>
            </>}
        </section>}
    </main>;
}
