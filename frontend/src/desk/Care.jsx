import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, CheckCheck, Flag, Lock, Mail, MessageCircle, Phone, Search, Send, ShieldCheck, Sparkles, StickyNote, UserCheck } from 'lucide-react';
import { care, desk, uuid, useLive } from './api';
import { fmt, day, dateTime, useT } from './i18n';
import { Empty, ErrorState, ProviderChip, Skeleton, StatusChip } from './ui';

const dir = text => /^[^A-Za-z]*[֐-ࣿ]/.test(text || '') ? 'rtl' : 'ltr';

/** The live picture of one booking: status, stay, policy, timeline, contact (and money for the admin). */
export function BookingPanel({ reference, onOpenChat, compact = false }) {
    const { t, lang, role } = useT();
    const live = useLive(signal => reference ? desk(`/care/bookings/${encodeURIComponent(reference)}`, { signal }) : Promise.resolve(null), [reference], 20000);
    if (!reference) return null;
    if (live.error && !live.data) return <ErrorState error={live.error} retry={live.reload} />;
    if (!live.data) return <div className="stack"><Skeleton h={90} /><Skeleton h={140} /></div>;
    const { booking: b, policy, live: now, timeline, conversation, economics } = live.data;
    const status = b.status === 'cancelled' ? 'cancelled' : b.confirmedAt ? 'confirmed' : 'pending';
    return <div className={`booking-panel ${compact ? 'compact' : ''}`}>
        <header><div><span className="eyebrow">{t.bookingPanel}</span><h3 className="mono">{b.reference}</h3></div><StatusChip status={status} /></header>
        <p className="bp-hotel">{b.hotel}</p>
        <div className="bp-row"><CalendarDays size={15} /><span>{day(b.checkin, lang)} → {day(b.checkout, lang)}</span>{b.room && <span className="muted">· {b.room}</span>}</div>
        <section className="bp-card">
            <h4><span className="pulse" />{t.liveStatus}</h4>
            {now?.unavailable ? <p className="muted">{t.unavailable}</p> : now ? <>
                <div className="bp-kv"><span>{t.status}</span><b>{now.status || b.supplierStatus || '—'}</b></div>
                <div className="bp-kv"><span>{t.cancellation}</span><b className={now.cancellable ? 'pos' : ''}>{now.cancellable ? t.cancellable : t.notCancellable}</b></div>
                {now.currentPenalty && <div className="bp-kv"><span>{t.penaltyNow}</span><b>{Number(now.currentPenalty.amount) === 0 ? t.free : fmt(Number(now.currentPenalty.amount), now.currentPenalty.currency)}</b></div>}
                <small className="muted">{dateTime(now.checkedAt, lang)}</small>
            </> : <div className="bp-kv"><span>{t.status}</span><b>{b.supplierStatus || b.status || '—'}</b></div>}
            <div className="bp-kv"><span>{t.provider}</span><span>{b.paymentProvider ? <ProviderChip provider={b.paymentProvider} /> : '—'} <small className="muted">{b.paymentState || ''}{b.refundStatus ? ` · ${b.refundStatus}` : ''}</small></span></div>
        </section>
        <section className="bp-card">
            <h4><ShieldCheck size={14} />{t.policy}</h4>
            {policy.freeBefore && <p className="pos strong">{t.freeUntil} {dateTime(policy.freeBefore, lang)}</p>}
            {policy.policies.length > 0 && <ul className="policy-list">{policy.policies.map((p, i) => <li key={i}><span>{p.from ? dateTime(p.from, lang) : '…'} → {p.until ? dateTime(p.until, lang) : '…'}</span>
                <b>{p.penalty ? (Number(p.penalty.amount) === 0 ? t.free : fmt(Number(p.penalty.amount), p.penalty.currency)) : '—'}</b></li>)}</ul>}
            {policy.text && <p className="muted small">{policy.text}</p>}
        </section>
        <section className="bp-card">
            <h4><Sparkles size={14} />{t.timeline}</h4>
            <ol className="timeline">{timeline.map((event, i) => <li key={i}><i /><span>{t.events[event.event] || event.event}</span><small>{dateTime(event.at, lang)}</small></li>)}</ol>
        </section>
        <section className="bp-card">
            <h4><UserCheck size={14} />{t.contact}</h4>
            <p className="strong">{b.guest || '—'}</p>
            {b.email && <a className="bp-link" href={`mailto:${b.email}`}><Mail size={14} />{b.email}</a>}
            {b.phone && <a className="bp-link" href={`tel:${b.phone}`} dir="ltr"><Phone size={14} />{b.phone}</a>}
        </section>
        {role === 'admin' && economics && <section className="bp-card bp-money"><h4><Lock size={14} />{t.economics}</h4>
            <div className="bp-kv"><span>{t.sell}</span><b className="tabular">{fmt(economics.reporting.sell)}</b></div>
            <div className="bp-kv"><span>{t.cost}</span><b className="tabular">{fmt(economics.reporting.cost)}</b></div>
            <div className="bp-kv"><span>{t.fee}</span><b className="tabular">{fmt(economics.reporting.fee)}</b></div>
            <div className="bp-kv"><span>{t.net}</span><b className={`tabular ${economics.reporting.net < 0 ? 'neg' : 'pos'}`}>{fmt(economics.reporting.net)}</b></div>
        </section>}
        {onOpenChat && (conversation ? <button className="btn btn-primary" onClick={() => onOpenChat(conversation.id, b.reference)}><MessageCircle size={16} />{t.openChat}</button>
            : <p className="muted small">{t.noChat}</p>)}
    </div>;
}

function Thread({ id, onChanged }) {
    const { t, lang } = useT();
    const live = useLive(signal => care(`/conversations/${id}`, { signal }), [id], 4000);
    const [mode, setMode] = useState('message');
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const list = useRef(null);
    const count = live.data?.messages?.length || 0;
    useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [count, id]);
    if (live.error && !live.data) return <ErrorState error={live.error} retry={live.reload} />;
    if (!live.data) return <div className="thread"><Skeleton h={60} /><Skeleton h={200} /></div>;
    const { conversation: c, messages } = live.data;
    const send = async () => {
        const body = text.trim();
        if (!body || sending) return;
        setSending(true);
        try { await care(`/conversations/${id}/messages`, { method: 'POST', body: { body, clientId: uuid(), kind: mode } }); setText(''); await live.reload(); onChanged(); }
        finally { setSending(false); }
    };
    const patch = async change => { await care(`/conversations/${id}`, { method: 'PATCH', body: change }).catch(() => null); live.reload(); onChanged(); };
    return <div className="thread">
        <header className="thread-head">
            <div><h3>{c.customerName || c.reference}</h3><span className="muted small mono">{c.reference} · {c.hotelName}</span></div>
            <div className="thread-actions">
                {!c.assignedTo && <button className="btn btn-small btn-ghost" onClick={() => patch({ assignToMe: true })}><UserCheck size={14} />{t.assignMe}</button>}
                <button className={`btn btn-small btn-ghost ${c.priority === 'high' ? 'on' : ''}`} onClick={() => patch({ priority: c.priority === 'high' ? 'normal' : 'high' })}><Flag size={14} />{t.priority}</button>
                {c.status === 'resolved' ? <button className="btn btn-small btn-ghost" onClick={() => patch({ status: 'open' })}>{t.reopen}</button>
                    : <button className="btn btn-small" onClick={() => patch({ status: 'resolved' })}><CheckCheck size={14} />{t.resolve}</button>}
            </div>
        </header>
        <div className="messages" ref={list}>
            {messages.filter(m => m.kind !== 'event').map(m => <div key={m.id} className={`msg ${m.role === 'user' ? 'msg-customer' : m.kind === 'note' ? 'msg-note' : 'msg-team'}`}>
                <span className="msg-who">{m.role === 'user' ? t.customer : m.kind === 'note' ? <><StickyNote size={12} />{t.internal}</> : t.team}</span>
                <p dir={dir(m.body)}>{m.body}</p><time>{dateTime(m.createdAt, lang)}</time></div>)}
        </div>
        <footer className={`composer ${mode === 'note' ? 'composer-note' : ''}`}>
            <div className="composer-modes">
                <button className={mode === 'message' ? 'on' : ''} onClick={() => setMode('message')}><Send size={13} />{t.reply}</button>
                <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}><StickyNote size={13} />{t.note}</button>
                {mode === 'message' && <div className="quick">{t.quick.map(q => <button key={q} onClick={() => setText(q)}>{q.slice(0, 34)}…</button>)}</div>}
            </div>
            <div className="composer-row">
                <textarea value={text} onChange={e => setText(e.target.value)} placeholder={mode === 'note' ? t.typeNote : t.typeReply} rows={2} maxLength={2000}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
                <button className="send" disabled={!text.trim() || sending} onClick={send} aria-label={t.send}><Send size={18} /></button>
            </div>
        </footer>
    </div>;
}

export default function Care({ initialChat = null }) {
    const { t, lang } = useT();
    const [inbox, setInbox] = useState('all');
    const [status, setStatus] = useState('open');
    const [q, setQ] = useState('');
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(initialChat);
    useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(timer); }, [q]);
    const params = useMemo(() => new URLSearchParams({ inbox, status, ...(query ? { q: query } : {}) }).toString(), [inbox, status, query]);
    const live = useLive(signal => care(`/conversations?${params}`, { signal }), [params], 8000);
    const rows = live.data?.conversations || [];
    const current = rows.find(row => row.id === active?.id) || active;
    return <section className="view view-care">
        <header className="view-head"><div><span className="eyebrow">{t.care}</span><h1>{t.inbox}</h1></div>
            <div className="counts">{['open', 'waiting', 'resolved'].map(key => <span key={key} className={`count count-${key}`}><b className="tabular">{live.data?.counts?.[key] ?? '—'}</b>{t[key]}</span>)}
                <span className="count count-unread"><b className="tabular">{live.data?.counts?.unread ?? '—'}</b>{t.unread}</span></div></header>
        <div className={`care-grid ${current ? 'has-thread' : ''}`}>
            <aside className="inbox">
                <div className="search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchChats} aria-label={t.searchChats} /></div>
                <div className="tabs">{['all', 'unread', 'mine', 'unassigned'].map(key => <button key={key} className={inbox === key ? 'on' : ''} onClick={() => setInbox(key)}>{t[key]}</button>)}</div>
                <div className="tabs tabs-soft">{['open', 'waiting', 'resolved', 'all'].map(key => <button key={key} className={status === key ? 'on' : ''} onClick={() => setStatus(key)}>{t[key]}</button>)}</div>
                {live.error && !live.data ? <ErrorState error={live.error} retry={live.reload} /> : !live.data ? <div className="stack">{[0, 1, 2].map(i => <Skeleton key={i} h={64} />)}</div>
                    : rows.length === 0 ? <Empty icon={MessageCircle} text={t.noChats} /> : <ul className="chat-list">{rows.map(row => <li key={row.id}>
                        <button className={`chat-item ${current?.id === row.id ? 'on' : ''} ${row.unread ? 'unread' : ''}`} onClick={() => setActive(row)}>
                            <span className="avatar">{(row.customerName || '?').trim().charAt(0).toUpperCase()}</span>
                            <span className="chat-main"><b>{row.customerName || row.reference}</b><span className="muted ellipsis">{row.lastMessage || row.hotelName}</span></span>
                            <span className="chat-meta"><time>{dateTime(row.updatedAt, lang)}</time>{row.priority === 'high' && <Flag size={12} className="flag" />}{row.unread && <i className="dot" />}</span>
                        </button></li>)}</ul>}
            </aside>
            <div className="thread-col">{current ? <>
                <button className="back-link" onClick={() => setActive(null)}><ArrowRight size={16} />{t.inbox}</button>
                <Thread key={current.id} id={current.id} onChanged={live.reload} /></> : <Empty icon={MessageCircle} text={t.pickChat} />}</div>
            <aside className="side-col">{current && <BookingPanel reference={current.reference} compact />}</aside>
        </div>
    </section>;
}

export function Bookings({ initial, openChat }) {
    const { t, lang } = useT();
    const [q, setQ] = useState(initial || '');
    const [query, setQuery] = useState(initial || '');
    const [selected, setSelected] = useState(initial || null);
    useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(timer); }, [q]);
    const live = useLive(signal => desk(`/care/bookings${query ? `?q=${encodeURIComponent(query)}` : ''}`, { signal }), [query], 30000);
    return <section className="view">
        <header className="view-head"><div><span className="eyebrow">{t.care}</span><h1>{t.bookings}</h1></div></header>
        <div className="search search-big"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={t.lookup} aria-label={t.lookup} autoFocus /></div>
        <div className="lookup-grid">
            <div>{!live.data ? <div className="stack">{[0, 1, 2].map(i => <Skeleton key={i} h={70} />)}</div> : live.data.bookings.length === 0 ? <Empty icon={Search} text={t.noBookings} />
                : <ul className="lookup-list">{live.data.bookings.map(row => {
                    const status = row.status === 'cancelled' ? 'cancelled' : row.confirmedAt ? 'confirmed' : 'pending';
                    return <li key={row.reference}><button className={`lookup-item ${selected === row.reference ? 'on' : ''}`} onClick={() => setSelected(row.reference)}>
                        <span className="lookup-main"><b className="mono">{row.reference}</b><span className="ellipsis">{row.hotel}</span><small className="muted">{row.guest} · {day(row.checkin, lang)} → {day(row.checkout, lang)}</small></span>
                        <span className="lookup-meta"><StatusChip status={status} />{row.paymentProvider && <ProviderChip provider={row.paymentProvider} />}</span>
                    </button></li>;
                })}</ul>}</div>
            <aside className="side-col side-sticky">{selected ? <BookingPanel reference={selected} onOpenChat={openChat} /> : <Empty icon={CalendarDays} text={t.lookup} />}</aside>
        </div>
    </section>;
}
