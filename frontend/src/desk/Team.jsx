import { useState } from 'react';
import { KeyRound, ShieldCheck, UserPlus, UserX, UserCheck } from 'lucide-react';
import { desk, DeskError, useLive } from './api';
import { dateTime, useT } from './i18n';
import { Empty, ErrorState, Skeleton } from './ui';

export default function Team() {
    const { t, lang } = useT();
    const live = useLive(signal => desk('/team', { signal }), [], 0);
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [message, setMessage] = useState('');
    const errorText = error => error instanceof DeskError ? ({ desk_weak_password: t.weakPassword, desk_agent_exists: t.exists, desk_invalid_email: t.invalidEmail }[error.code] || t.error) : t.error;
    const add = async event => {
        event.preventDefault(); setMessage('');
        try { await desk('/team', { method: 'POST', body: form }); setForm({ name: '', email: '', password: '' }); setMessage(t.added); live.reload(); }
        catch (error) { setMessage(errorText(error)); }
    };
    const update = async (email, change) => {
        try { await desk(`/team/${encodeURIComponent(email)}`, { method: 'PATCH', body: change }); live.reload(); setMessage(t.saved); }
        catch (error) { setMessage(errorText(error)); }
    };
    const reset = email => {
        const password = window.prompt(`${t.resetPassword} (${t.weakPassword})`);
        if (password) update(email, { password });
    };
    return <section className="view">
        <header className="view-head"><div><span className="eyebrow"><ShieldCheck size={12} /> {t.admin}</span><h1>{t.teamTitle}</h1><p className="lead">{t.teamBody}</p></div></header>
        <form className="team-form" onSubmit={add}>
            <input required placeholder={t.name} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} aria-label={t.name} />
            <input required type="email" dir="ltr" placeholder={t.email} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} aria-label={t.email} />
            <input required type="password" dir="ltr" minLength={12} placeholder={t.password} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} aria-label={t.password} autoComplete="new-password" />
            <button className="btn btn-primary"><UserPlus size={16} />{t.add}</button>
        </form>
        {message && <p className="muted" role="status">{message}</p>}
        {live.error && !live.data ? <ErrorState error={live.error} retry={live.reload} /> : !live.data ? <Skeleton h={160} /> : live.data.team.length === 0 ? <Empty icon={UserPlus} text={t.teamBody} />
            : <ul className="team-list">{live.data.team.map(member => <li key={member.email} className={member.active ? '' : 'off'}>
                <span className="avatar avatar-lg">{member.name.charAt(0).toUpperCase()}</span>
                <span className="team-main"><b>{member.name}</b><span className="muted mono small">{member.email}</span>
                    <small className="muted">{t.lastLogin}: {member.lastLoginAt ? dateTime(member.lastLoginAt, lang) : t.never}</small></span>
                <span className={`chip ${member.active ? 'chip-confirmed' : 'chip-cancelled'}`}><i />{member.active ? t.active : t.disabled}</span>
                <button className="btn btn-small btn-ghost" onClick={() => reset(member.email)}><KeyRound size={14} />{t.resetPassword}</button>
                <button className="btn btn-small btn-ghost" onClick={() => update(member.email, { active: !member.active })}>
                    {member.active ? <><UserX size={14} />{t.disable}</> : <><UserCheck size={14} />{t.enable}</>}</button>
            </li>)}</ul>}
    </section>;
}
