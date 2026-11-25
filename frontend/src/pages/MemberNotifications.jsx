import { useEffect, useState } from 'react';
import { Bell, CalendarCheck, UserRound } from 'lucide-react';
import { useLanguage } from '../i18n';
import { API_BASE_URL } from '../services/apiBaseUrl';
import { memberHeaders } from '../services/membershipApi';
import { readCurrentUser } from '../services/authSession';

const copy = {
    ar: { title: 'الإشعارات', pending: 'جارٍ تحميل الإشعارات…', empty: 'لا توجد إشعارات بعد.', failed: 'تعذّر تحميل الإشعارات.', retry: 'إعادة المحاولة', signIn: 'سجّل الدخول لعرض إشعاراتك.', membership: 'العضوية', booking: 'حجوزاتي',
        submitted: 'تم استلام طلب عضويتك', under_review: 'بدأت مراجعة طلب العضوية', needs_information: 'طلب العضوية يحتاج معلومات إضافية', approved: 'تم اعتماد عضويتك', rejected: 'لم يُقبل طلب العضوية', suspended: 'تم تعليق العضوية', confirmed: 'أكّد المورد الحجز', refunded: 'اكتمل استرداد المبلغ' },
    en: { title: 'Notifications', pending: 'Loading notifications…', empty: 'You have no notifications yet.', failed: 'Your notifications could not be loaded.', retry: 'Try again', signIn: 'Sign in to see your notifications.', membership: 'Membership', booking: 'My bookings',
        submitted: 'Membership application received', under_review: 'Membership review started', needs_information: 'Your application needs more information', approved: 'Membership approved', rejected: 'Membership application declined', suspended: 'Membership suspended', confirmed: 'Your supplier confirmed a booking', refunded: 'Your refund was completed' }
};
export default function MemberNotifications() {
    const { language, direction } = useLanguage();
    const labels = copy[language] || copy.en;
    const [view, setView] = useState({ phase: 'pending' });
    const [retry, setRetry] = useState(0);
    const account = readCurrentUser()?.email.toLowerCase();
    const storageKey = account && 'pillow.notices.read.' + account;
    const [read, setRead] = useState(() => {
        try { const ids = JSON.parse(localStorage.getItem(storageKey) || '[]'); return new Set(Array.isArray(ids) ? ids : []); }
        catch { return new Set(); }
    });
    const mark = ids => {
        const next = new Set([...read, ...ids].slice(-250));
        setRead(next);
        try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
    };
    useEffect(() => {
        const controller = new AbortController();
        setView({ phase: 'pending' });
        (async () => {
            const res = await fetch(API_BASE_URL + '/owned/notifications', { headers: memberHeaders(), cache: 'no-store', signal: controller.signal });
            if (controller.signal.aborted) return;
            if (res.status === 401) { setView({ phase: 'signIn' }); return; }
            if (!res.ok) throw Error('notifications_unavailable');
            const { notifications } = await res.json();
            if (!Array.isArray(notifications)) throw Error('invalid_notifications');
            if (!controller.signal.aborted) setView({ phase: 'ready', notifications });
        })().catch(() => { if (!controller.signal.aborted) setView({ phase: 'failed' }); });
        return () => controller.abort();
    }, [retry]);
    const formatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    return <main dir={direction} className="mx-auto min-h-[60vh] max-w-2xl px-5 py-10" style={{ color: '#2D173A' }}>
        <h1 className="mb-6 flex items-center gap-3 text-3xl font-bold"><Bell aria-hidden="true" />{labels.title}</h1>
        {view.phase !== 'ready' && <section aria-live="polite"><p>{labels[view.phase]}</p>
            {view.phase === 'failed' && <button className="mt-4 rounded-xl border px-5 py-3" onClick={() => setRetry(v => v + 1)}>{labels.retry}</button>}
            {view.phase === 'signIn' && <a className="mt-4 inline-block underline" href="/membership">{labels.membership}</a>}</section>}
        {view.phase === 'ready' && view.notifications.some(item=>!read.has(item.id)) && <button className="mb-4 min-h-11 underline" onClick={()=>mark(view.notifications.map(item=>item.id))}>
            {language === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all as read'}</button>}
        {view.phase === 'ready' && (view.notifications.length ? <ul className="grid gap-3">{view.notifications.map(item => {
            const isMember = item.kind === 'membership', Icon = isMember ? UserRound : CalendarCheck;
            const destination = isMember ? '/membership' : '/bookings' + (item.reference ? '#booking-'+encodeURIComponent(item.reference) : '');
            return <li key={item.id}><a href={destination} onClick={()=>mark([item.id])} className="flex items-center gap-4 rounded-[22px] border border-[#E8E1E9] bg-white p-5">
                <Icon aria-hidden="true" /><div><strong>{labels[item.event] || labels[item.kind]}</strong>
                {!read.has(item.id) && <span className="ms-2 rounded-full bg-[#DFE8C7] px-2 text-xs">{language === 'ar' ? 'جديد' : 'New'}</span>}
                <time dateTime={item.at} className="block text-sm text-[#675E6B]">{formatter.format(new Date(item.at))}</time></div></a></li>;
        })}</ul> : <p role="status">{labels.empty}</p>)}
    </main>;
}
