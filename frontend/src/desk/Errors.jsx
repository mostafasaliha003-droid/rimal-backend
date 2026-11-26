import { useState } from 'react';
import { Bug, ChevronDown, Smartphone } from 'lucide-react';
import { desk, useLive } from './api';
import { dateTime, useT } from './i18n';
import { Empty, ErrorState, LiveBadge, Skeleton } from './ui';

/** App crashes reported by phones (scrubbed on the server), newest first, counted per version. */
export default function Errors() {
    const { t, lang } = useT();
    const live = useLive(signal => desk('/errors', { signal }), [], 60000);
    const [open, setOpen] = useState(null);
    const rows = live.data?.errors || [];
    return <section className="view">
        <header className="view-head"><div><span className="eyebrow">{t.console}</span><h1>{t.errors}</h1><p className="lead">{t.errorsBody}</p></div>
            <LiveBadge at={live.at} loading={live.loading} onRefresh={live.reload} /></header>
        {live.error && !live.data ? <ErrorState error={live.error} retry={live.reload} /> : !live.data ? <Skeleton h={200} />
            : rows.length === 0 ? <Empty icon={Bug} text={t.noErrors} /> : <ul className="error-list">{rows.map(row => <li key={row.id} className={row.fatal ? 'fatal' : ''}>
                <button className="error-head" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}>
                    <span className="error-count tabular">{row.count}×</span>
                    <span className="error-main"><b>{row.message}</b><small className="muted"><Smartphone size={12} /> {row.platform} · v{row.version}{row.route ? ` · ${row.route}` : ''} · {t.updated} {dateTime(row.lastSeen, lang)}</small></span>
                    {row.fatal && <span className="chip chip-failed"><i />{t.fatal}</span>}
                    <ChevronDown size={16} className={open === row.id ? 'rot' : ''} />
                </button>
                {open === row.id && <pre className="error-stack" dir="ltr">{row.stack || '—'}</pre>}
            </li>)}</ul>}
    </section>;
}
