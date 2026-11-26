import { RefreshCw, WifiOff } from 'lucide-react';
import { clock, useT } from './i18n';

export function LiveBadge({ at, loading, onRefresh }) {
    const { t, lang } = useT();
    return <button className={`live ${loading ? 'is-loading' : ''}`} onClick={onRefresh} title={t.refresh}>
        <span className="pulse" aria-hidden="true" /><b>{t.live}</b>
        <span className="muted">{at ? `${t.updated} ${clock(at, lang)}` : t.loading}</span>
        <RefreshCw size={14} className="spin-on-load" />
    </button>;
}

export function Panel({ title, children, legend, action, flush = false }) {
    return <section className={`panel ${flush ? 'panel-flush' : ''}`}>
        {(title || action) && <header className="panel-head"><h2>{title}</h2>
            {legend && <span className="panel-legend">{legend.map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</span>}
            {action}</header>}
        {children}
    </section>;
}

export const Skeleton = ({ h = 20, w = '100%' }) => <div className="skeleton" style={{ height: h, width: w }} />;

export function ErrorState({ error, retry, text }) {
    const { t } = useT();
    return <div className="error-state"><WifiOff size={26} /><p>{text || (error?.code === 'supplier_balance_unavailable' ? t.supplierError : t.error)}</p>
        {retry && <button className="btn btn-ghost" onClick={retry}>{t.retry}</button>}</div>;
}

export function StatusChip({ status }) {
    const { t } = useT();
    return <span className={`chip chip-${status}`}><i />{t[status] || status}</span>;
}

const PROVIDER_LABEL = { ziina: 'Ziina', tabby: 'tabby', tamara: 'Tamara' };
export function ProviderChip({ provider }) {
    return <span className={`chip chip-provider chip-${provider}`}>{PROVIDER_LABEL[provider] || provider}</span>;
}

export function Empty({ icon: Icon, text }) {
    return <div className="empty-state">{Icon && <Icon size={30} />}<p>{text}</p></div>;
}
