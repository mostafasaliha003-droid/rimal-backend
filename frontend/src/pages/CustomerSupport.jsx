import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CheckCheck, ChevronDown, Copy, FileText, Headphones, LockKeyhole, Mail, MessageCircle, Phone, Search, Send, ShieldCheck, StickyNote, X } from 'lucide-react';
import SupportDocumentViewer from '../components/SupportDocumentViewer';
import { useLanguage } from '../i18n';
import { supportRequest, STAFF_TOKEN_KEY } from '../services/customerSupport';
import { supportCopy } from '../services/supportCopy';
import { userAccessToken } from '../services/authSession';
import './CustomerSupport.css';

function useLive(task, dependencies) {
    useEffect(() => {
        let active = true, timer, running = false;
        const tick = async () => { if (running || !active) return; running = true;
            try { await task(() => active); } finally { running = false;
            if (active) { clearTimeout(timer); timer = setTimeout(tick, document.hidden ? 20000 : 4000); }
        } };
        const resume = () => { if (!document.hidden) { clearTimeout(timer); void tick(); } };
        document.addEventListener('visibilitychange', resume);
        void tick();
        return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
    }, dependencies);
}
function CopyReference({ value, L }) {
    const [feedback, setFeedback] = useState('');
    useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 2000); return () => clearTimeout(timer); }, [feedback]);
    return <div className="support-copy-reference"><span className="support-reference" dir="ltr">{value}</span><button type="button" aria-label={L.copy} onClick={async () => {
        try { await navigator.clipboard.writeText(value); setFeedback(L.copied); } catch { setFeedback(L.copyError); }
    }}>{feedback === L.copied ? <Check size={14} /> : <Copy size={14} />}</button>{feedback && <small role="status">{feedback}</small>}</div>;
}
function RequestContext({ context, L, staff, conversationId, direction }) {
    const [document, setDocument] = useState(null);
    if (!context) return null;
    const state = value => L.states[value] || L.pending;
    const details = [[L.booking, context.bookingStatus && state(context.bookingStatus)],
        [L.payment, context.paymentStatus && state(context.paymentStatus)], [L.voucher, context.voucherStatus && state(context.voucherStatus)],
        [L.refund, context.refundStatus && state(context.refundStatus)], [L.amount, context.amount != null && context.currency ? `${context.amount} ${context.currency}` : null],
        [L.checkIn, context.checkIn?.slice(0, 10)], [L.checkOut, context.checkOut?.slice(0, 10)]];
    const client = context.customer;
    return <aside className="support-context">
        {staff && client && <section className="support-client" data-support-client><div className="support-client-heading"><span className="support-avatar">{Array.from(client.name || 'R').slice(0, 2).join('')}</span><div><p>{L.clientProfile}</p><h3>{client.name || L.unavailable}</h3></div></div>
            <p className="support-client-source">{client.source === 'account' ? L.registered : L.bookingContact}</p>
            <dl><div><dt><Mail size={13} />{L.email}</dt><dd data-support-client-email>{client.email ? <a dir="ltr" href={`mailto:${client.email}`}>{client.email}</a> : L.unavailable}</dd></div>
                <div><dt><Phone size={13} />{L.phone}</dt><dd data-support-client-phone>{client.phone ? <a dir="ltr" href={`tel:${client.phone.replace(/[^+\d]/g, '')}`}>{client.phone}</a> : L.unavailable}</dd></div></dl>
            {context.bookingContact?.name && context.bookingContact.name !== client.name && <p className="support-booking-contact">{L.bookingContact}: <strong>{context.bookingContact.name}</strong>{context.bookingContact.email && <span dir="ltr">{context.bookingContact.email}</span>}{context.bookingContact.phone && <span dir="ltr">{context.bookingContact.phone}</span>}</p>}
        </section>}
        <p className="support-kicker"><ShieldCheck size={15} />{L.verified}</p><h3>{context.hotelName || L.context}</h3>
        <CopyReference value={context.reference} L={L} />
        {staff && <div className="support-supplier" data-support-supplier><span>{L.supplier}</span><strong>{({ ratehawk: 'RateHawk · Emerging Travel Group', hotelbeds: 'Hotelbeds' })[context.provider] || context.provider || L.unavailable}</strong>{context.supplierReference && <><small>{L.supplierReference}</small><CopyReference value={context.supplierReference} L={L} /></>}</div>}
        <dl>{details.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="support-documents"><h4><FileText size={15} />{L.documents}</h4>{['voucher', 'cancellation'].filter(kind => context.documents?.[kind]).map(kind => <button data-support-document-open={kind} key={kind} onClick={() => setDocument(kind)}><FileText size={17} /><span>{kind === 'voucher' ? L.voucherPdf : L.cancellationPdf}</span><ArrowUpRight size={15} /></button>)}
            {!context.documents?.voucher && !context.documents?.cancellation && <p>{L.pending}</p>}</div>
        <p className="support-safe"><LockKeyhole size={15} />{L.safety}</p>
        {document && <SupportDocumentViewer key={document} document={document} context={context} conversationId={conversationId} staff={staff} L={L} direction={direction} onClose={() => setDocument(null)} />}
    </aside>;
}
function readDraftRecord(key) { try { const saved = JSON.parse(sessionStorage.getItem(key)); return saved?.expiresAt > Date.now() && typeof saved.body === 'string' && saved.body.length <= 2000 ? saved : null; } catch { return null; } }
function readDraft(key) { return readDraftRecord(key)?.body || ''; }
function Thread({ id, staff, L, language, direction, onUnauthorized, onChange }) {
    const draftKey = kind => `remal_support_draft:${staff ? 'staff' : 'user'}:${id}:${kind}`;
    const [data, setData] = useState(null), [messages, setMessages] = useState([]), [draft, setDraft] = useState(() => readDraft(draftKey('message')));
    const [note, setNote] = useState(false), [sending, setSending] = useState(false), [sendError, setSendError] = useState('');
    const [find, setFind] = useState(''), [findOpen, setFindOpen] = useState(false), [draftSaved, setDraftSaved] = useState(false), [newMessages, setNewMessages] = useState(false);
    const [connection, setConnection] = useState(true), [more, setMore] = useState(false), [olderBusy, setOlderBusy] = useState(false);
    const [actionError, setActionError] = useState(''), [acting, setActing] = useState(false);
    const delivery = useRef(readDraftRecord(draftKey('message'))?.pending || null), bottom = useRef(null), submitLock = useRef(false), initialScroll = useRef(true), olderLoaded = useRef(false), nearBottom = useRef(true), textarea = useRef(null);
    useEffect(() => { try { const key = draftKey(note ? 'note' : 'message');
        if (draft) sessionStorage.setItem(key, JSON.stringify({ body: draft, expiresAt: Date.now() + 86400000,
            pending: delivery.current?.body === draft.trim() && delivery.current?.kind === (note ? 'note' : 'message') ? delivery.current : null })); else sessionStorage.removeItem(key);
        setDraftSaved(!!draft);
    } catch { setDraftSaved(false); } }, [draft, note, id]);
    const changeMode = value => { if (sending) return; setNote(value); const key = draftKey(value ? 'note' : 'message'); setDraft(readDraft(key)); delivery.current = readDraftRecord(key)?.pending || null; setSendError(''); };
    const merge = rows => setMessages(current => [...new Map([...current, ...rows].map(row => [row.id, row])).values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
    useLive(async alive => {
        try {
            const result = await supportRequest(`/conversations/${id}?read=${document.hidden ? '0' : '1'}`, { staff });
            if (!alive()) return;
            setData(result); merge(result.messages); setConnection(true);
            if (!olderLoaded.current) setMore(result.hasMore);
        } catch (failure) { if (alive()) { setConnection(false); if (failure.status === 401) onUnauthorized(); } }
    }, [id, staff]);
    const lastId = messages.at(-1)?.id;
    useEffect(() => {
        const node = bottom.current?.parentElement;
        if (node && (initialScroll.current || nearBottom.current)) { node.scrollTop = node.scrollHeight; initialScroll.current = false; setNewMessages(false); }
        else if (node) setNewMessages(true);
    }, [lastId]);
    const send = async event => {
        event.preventDefault(); if (!draft.trim() || submitLock.current) return;
        submitLock.current = true; setSending(true); setSendError('');
        const kind = note ? 'note' : 'message', body = draft.trim();
        if (delivery.current?.body !== body || delivery.current?.kind !== kind) delivery.current = { clientId: crypto.randomUUID(), body, kind };
        try { sessionStorage.setItem(draftKey(kind), JSON.stringify({ body: draft, pending: delivery.current, expiresAt: Date.now() + 86400000 })); } catch { /* Delivery can proceed when draft storage is unavailable. */ }
        try {
            const result = await supportRequest(`/conversations/${id}/messages`, { staff, method: 'POST', body: delivery.current });
            merge([result.message]); setDraft(''); delivery.current = null; onChange?.();
            const node = bottom.current?.parentElement; if (node) node.scrollTop = node.scrollHeight;
        } catch (failure) { setSendError(L.sendError); if (failure.status === 401) onUnauthorized(); }
        finally { submitLock.current = false; setSending(false); }
    };
    const update = async fields => {
        if (acting) return; setActing(true); setActionError('');
        try { const result = await supportRequest(`/conversations/${id}`, { staff: true, method: 'PATCH', body: fields });
            setData(current => ({ ...current, conversation: result.conversation })); onChange?.();
        } catch (failure) { setActionError(L.error); if (failure.status === 401) onUnauthorized(); }
        finally { setActing(false); }
    };
    const earlier = async () => {
        if (olderBusy || !messages.length) return; setOlderBusy(true);
        try { const result = await supportRequest(`/conversations/${id}?before=${encodeURIComponent(messages[0].id)}`, { staff }); olderLoaded.current = true; merge(result.messages); setMore(result.hasMore); }
        catch { setActionError(L.error); } finally { setOlderBusy(false); }
    };
    const conversation = data?.conversation;
    const visibleMessages = find.trim() ? messages.filter(message => message.kind !== 'event' && message.body.toLocaleLowerCase().includes(find.trim().toLocaleLowerCase())) : messages;
    return <div className={`support-detail ${staff ? 'is-staff' : ''}`}>
        <section className="support-thread" aria-label={L.title}>
            <header className="support-thread-head"><div><p className="support-kicker">{staff ? conversation?.customerName || L.guest : L.team}</p>
                <h2>{conversation?.hotelName || L.title}</h2><span className="support-live" role="status"><i className={connection && data ? '' : 'is-offline'} />{!data ? L.pending : connection ? L.live : L.reconnect}</span></div><div className="support-thread-actions"><span className={`support-state is-${conversation?.status || 'open'}`}>{L[conversation?.status || 'open']}</span><button data-support-find-toggle aria-label={L.findMessage} aria-expanded={findOpen} onClick={() => { setFindOpen(value => !value); setFind(''); }}><Search size={18} /></button></div></header>
            {!staff && <ol className="support-care-steps" aria-label={L.journey}>{[L.stepVerified, L.stepCare, L.stepResolved].map((label, index) => <li key={label} className={index === 0 || conversation?.status === 'resolved' ? 'is-done' : index === 1 ? 'is-active' : ''}><span>{index === 0 || conversation?.status === 'resolved' ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>}
            {findOpen && <div className="support-thread-search"><Search size={16} /><input data-support-find autoFocus aria-label={L.findMessage} placeholder={L.findMessage} value={find} onChange={event => setFind(event.target.value)} /><button aria-label={L.close} onClick={() => { setFind(''); setFindOpen(false); }}><X size={17} /></button></div>}
            {staff && conversation && <div className="support-tools">
                <button disabled={acting} onClick={() => update({ assignToMe: true })}>{L.assign}</button>
                <select aria-label={L.priority} disabled={acting} value={conversation.priority} onChange={event => update({ priority: event.target.value })}><option value="normal">{L.normal}</option><option value="high">{L.high}</option></select>
                <button data-support-resolve disabled={acting} onClick={() => update({ status: conversation.status === 'resolved' ? 'open' : 'resolved' })}><CheckCheck size={15} />{conversation.status === 'resolved' ? L.reopen : L.resolve}</button>
                <span className="support-assigned">{L.assigned}: {conversation.assignedTo || L.unassigned}</span>
            </div>}
            {!connection && <p role="status" className="support-alert">{L.connection}</p>}
            {actionError && <p role="alert" className="support-alert">{actionError}</p>}
            <div className="support-messages" data-support-messages onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; if (nearBottom.current) setNewMessages(false); }}>
                {more && <button className="support-earlier" disabled={olderBusy} onClick={earlier}>{L.earlier}</button>}
                {!messages.length && <div className="support-message-empty"><MessageCircle size={30} /><p>{L.noMessages}</p></div>}
                {find && !visibleMessages.length && <p role="status" className="support-empty">{L.noMatches}</p>}
                {visibleMessages.map(message => <article key={message.id} data-support-message data-message-kind={message.kind} className={`support-message ${message.role === (staff ? 'admin' : 'user') ? 'is-own' : ''} ${message.kind !== 'message' ? 'is-note' : ''}`}>
                    <p className="support-message-author">{message.kind === 'event' ? L.event : message.kind === 'note' ? L.private : message.role === 'admin' ? L.team : L.guest}</p>
                    <p dir="auto">{message.kind === 'event' ? Object.entries(JSON.parse(message.body)).map(([key, value]) => key === 'assignedTo' ? `${L.assigned}: ${value}` : key === 'status' ? L[value] : L[value]).join(' · ') : message.body}</p>
                    <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(new Date(message.createdAt))}</time>
                </article>)}<div ref={bottom} />
            </div>
            {newMessages && <button className="support-jump-latest" onClick={() => { const node = bottom.current?.parentElement; if (node) node.scrollTop = node.scrollHeight; setNewMessages(false); }}><ChevronDown size={15} />{L.latest}</button>}
            {!staff && conversation?.status === 'resolved' && <p className="support-resolved-note"><CheckCheck size={17} /><span><strong>{L.allHandled}</strong>{L.resolvedHint}</span></p>}
            {!staff && !draft && !messages.length && <div className="support-issue-shortcuts"><p>{L.helpTitle}</p><span>{L.helpHint}</span><div>{Object.entries(L.prompts).map(([key, prompt]) => <button key={key} onClick={() => { setDraft(prompt); textarea.current?.focus(); }}>{L.topics[key]}</button>)}</div></div>}
            <form className={`support-composer ${note ? 'is-note' : ''}`} onSubmit={send}>
                {staff && <div className="support-compose-options"><button disabled={sending} type="button" aria-pressed={!note} onClick={() => changeMode(false)}>{L.reply}</button><button disabled={sending} data-support-note type="button" aria-pressed={note} onClick={() => changeMode(true)}><StickyNote size={14} />{L.note}</button>
                    <select disabled={sending} aria-label={L.quick} value="" onChange={event => setDraft(event.target.value)}><option value="">{L.quick}</option>{[L.quick1, L.quick2, L.quick3].map(reply => <option key={reply} value={reply}>{reply}</option>)}</select></div>}
                <label className="sr-only" htmlFor="support-message">{note ? L.note : L.placeholder}</label>
                <textarea ref={textarea} data-support-draft id="support-message" maxLength={2000} rows={3} placeholder={note ? L.notePlaceholder : L.placeholder} value={draft} disabled={sending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(event); } }} />
                <div className="support-compose-footer"><span>{draftSaved ? L.saved : `${draft.length}/2000`}<small>{L.enterHint}</small></span><button data-support-send type="submit" disabled={!draft.trim() || sending}><Send size={16} />{sending ? L.sending : L.send}</button></div>
                {sendError && <p role="alert" className="support-alert">{sendError}</p>}
            </form>
            <p className="support-thread-privacy"><LockKeyhole size={13} />{L.privacy}</p>
        </section>
        <RequestContext context={data?.context} L={L} staff={staff} conversationId={id} direction={direction} />
    </div>;
}
export default function CustomerSupport({ staff = false }) {
    const { language, direction } = useLanguage(), L = supportCopy(language);
    const [authenticated, setAuthenticated] = useState(false), [ready, setReady] = useState(false), [denied, setDenied] = useState(false);
    const [references, setReferences] = useState([]), [cases, setCases] = useState([]), [selected, setSelected] = useState(null);
    const [counts, setCounts] = useState({}), [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [topic, setTopic] = useState('booking');
    const [email, setEmail] = useState(''), [password, setPassword] = useState('');
    const [showInbox, setShowInbox] = useState(false);
    const opening = useRef(false), initialOpened = useRef(false), requested = new URLSearchParams(location.search).get('reference');
    const unauthorized = () => { setAuthenticated(false); setDenied(true); if (staff) sessionStorage.removeItem(STAFF_TOKEN_KEY); };
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (staff) await supportRequest('/session', { staff: true, auth: true });
                else { if (!userAccessToken()) { if (active) setDenied(true); return; }
                    const result = await supportRequest('/eligibility'); if (active) setReferences(result.references); }
                if (active) { setAuthenticated(true); setDenied(false); }
            } catch (failure) { if (active) { if (failure.status === 401) setDenied(true); else setError(L.error); } }
            finally { if (active) setReady(true); }
        })(); return () => { active = false; };
    }, [staff, refresh]);
    useLive(async alive => {
        if (!authenticated) return;
        try { const result = await supportRequest(`/conversations${staff ? `?status=${filter}&q=${encodeURIComponent(search)}` : ''}`, { staff });
            if (alive()) { setCases(result.conversations); setCounts(result.counts || {}); setError(''); }
            if (!staff) { const eligibility = await supportRequest('/eligibility'); if (alive()) setReferences(eligibility.references); }
        } catch (failure) { if (alive()) { if (failure.status === 401) unauthorized(); else setError(L.connection); } }
    }, [authenticated, staff, filter, search, refresh]);
    const open = async reference => {
        if (opening.current) return; opening.current = true; setBusy(true); setError('');
        try { const result = await supportRequest('/conversations', { method: 'POST', body: { reference, topic } });
            setSelected(result.conversation.id); setShowInbox(false); setRefresh(value => value + 1);
        } catch (failure) { if (failure.status === 401) unauthorized(); else setError(L.error); }
        finally { opening.current = false; setBusy(false); }
    };
    useEffect(() => {
        const reference = requested || (references.length === 1 ? references[0].reference : null);
        if (!staff && authenticated && reference && !selected && !initialOpened.current && references.some(row => row.reference === reference)) { initialOpened.current = true; void open(reference); }
    }, [authenticated, requested, staff, references.length]);
    const login = async event => {
        event.preventDefault(); if (busy) return; setBusy(true); setError('');
        try { const result = await supportRequest('/login', { staff: true, auth: true, method: 'POST', body: { email, password } });
            sessionStorage.setItem(STAFF_TOKEN_KEY, result.access_token); setPassword(''); setRefresh(value => value + 1);
        } catch { setError(L.error); } finally { setBusy(false); }
    };
    const logout = async () => {
        try { await supportRequest('/logout', { staff: true, auth: true, method: 'POST' }); } catch { setError(L.error); return; }
        unauthorized(); setSelected(null);
    };
    return <main dir={direction} className={`support-page ${staff ? 'support-page-staff' : ''}`} data-support-workspace={staff ? 'staff' : 'customer'}>
        <header className="support-page-header"><a href="/" className="support-brand">REMAL<span>{L.eyebrow}</span></a><div className="support-header-actions"><a href={staff ? '/admin.html' : '/bookings'}>{staff ? 'REMAL ADMIN' : L.bookings}<ArrowUpRight size={16} /></a>{staff && authenticated && <button onClick={logout}>{L.logout}</button>}</div></header>
        <section className={`support-intro ${staff ? '' : 'support-concierge-hero'}`}><div><p className="support-kicker"><Headphones size={16} />{L.eyebrow}</p><h1>{staff ? L.dashboard : L.title}</h1><p>{staff ? L.staffSubtitle : L.subtitle}</p>{!staff && <div className="support-trust-row"><span><ShieldCheck size={15} />{L.journey}</span><span><LockKeyhole size={15} />{L.secure}</span><span><MessageCircle size={15} />{L.live}</span></div>}</div>{!staff && <div className="support-concierge-mark" aria-hidden="true"><Headphones size={48} strokeWidth={1.2} /></div>}</section>
        {error && <p role="alert" className="support-alert support-page-error">{error}<button onClick={() => setRefresh(value => value + 1)}>{L.retry}</button></p>}
        {!ready ? <p role="status" className="support-gate">{L.pending}</p> : !authenticated ? <section className="support-gate"><LockKeyhole size={32} /><h2>{staff ? L.staffLogin : L.login}</h2><p>{staff ? L.staffLoginHint : L.loginHint}</p>
            {staff ? <form onSubmit={login}><label>{L.email}<input data-support-email type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label><label>{L.password}<input data-support-password type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label><button data-support-login disabled={busy}>{L.login}</button></form>
                : <a href={`/account?returnTo=${encodeURIComponent(`/support${requested ? `?reference=${encodeURIComponent(requested)}` : ''}`)}&lang=${language}`}>{L.login}</a>}
            {!denied && error && <p>{L.error}</p>}</section> : <>
            {staff && <section className="support-metrics" aria-label={L.dashboard}>{['open', 'waiting', 'resolved'].map(status => <button key={status} onClick={() => setFilter(status)} aria-pressed={filter === status}><span>{L[status]}</span><strong>{counts[status] || 0}</strong></button>)}</section>}
            {!staff && !references.length ? <section className="support-gate"><ShieldCheck size={32} /><p>{L.noAccess}</p><a href="/">{L.home}</a></section> : <>{selected && <button className="support-mobile-switch" onClick={() => setShowInbox(value => !value)}><MessageCircle size={16} />{showInbox ? L.backToChat : L.myRequests}<ChevronDown size={15} /></button>}<div className={`support-layout ${selected ? 'has-selection' : ''} ${showInbox ? 'show-inbox' : ''}`}>
                <aside className="support-inbox"><div className="support-inbox-heading"><MessageCircle size={19} /><h2>{staff ? L.all : L.myRequests}</h2></div>
                    {staff ? <><label className="support-search"><Search size={16} /><input aria-label={L.search} placeholder={L.search} value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label={L.all} value={filter} onChange={event => setFilter(event.target.value)}>{['all', 'open', 'waiting', 'resolved'].map(status => <option key={status} value={status}>{L[status]}</option>)}</select></>
                        : references.some(row => !cases.some(item => item.reference === row.reference)) && <div className="support-reference-picker"><label>{L.topic}<select value={topic} onChange={event => setTopic(event.target.value)}>{Object.entries(L.topics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{references.filter(row => !cases.some(item => item.reference === row.reference)).map(row => <button data-support-reference disabled={busy} key={row.reference} onClick={() => open(row.reference)}><span>{row.hotelName || L.payment}</span><small dir="ltr">{row.reference}</small></button>)}</div>}
                    <div className="support-cases">{!cases.length && <p className="support-empty">{L.empty}</p>}{cases.map(row => <button data-support-case className={selected === row.id ? 'is-selected' : ''} key={row.id} onClick={() => { setSelected(row.id); setShowInbox(false); }}>
                        <span className="support-case-title">{staff ? row.customerName || L.guest : row.hotelName || L.team}{row.unread && <i aria-label={L.newReply} />}</span>
                        <small dir="ltr">{row.reference}</small><p>{row.lastMessage || L.topics[row.topic]}</p><span className={`support-state is-${row.status}`}>{L[row.status]}</span>{row.priority === 'high' && <span className="support-priority">{L.high}</span>}
                    </button>)}</div>
                </aside>
                {selected ? <Thread key={selected} id={selected} staff={staff} L={L} language={language} direction={direction} onUnauthorized={unauthorized} onChange={() => setRefresh(value => value + 1)} />
                    : <section className="support-welcome"><div><Headphones size={44} strokeWidth={1.3} /><h2>{L.select}</h2><p>{L.privacy}</p></div></section>}
            </div></>}
        </>}
    </main>;
}
