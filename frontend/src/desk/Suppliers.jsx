import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, CreditCard, Hourglass, PlugZap, Wallet } from 'lucide-react';
import { desk, DeskError, useLive } from './api';
import { fmt, dateTime, useT } from './i18n';
import { Gauge } from './charts';
import { ErrorState, LiveBadge, Skeleton } from './ui';

export function Suppliers() {
    const { t, lang } = useT();
    const live = useLive(signal => desk('/suppliers', { signal }), [], 60000);
    const refresh = async () => { await desk('/suppliers?refresh=1').catch(() => null); live.reload(); };
    return <section className="view">
        <header className="view-head"><div><span className="eyebrow">{t.console}</span><h1>{t.supplierTitle}</h1></div>
            <LiveBadge at={live.at} loading={live.loading} onRefresh={refresh} /></header>
        {live.error && !live.data ? <ErrorState error={live.error} retry={refresh} /> : !live.data ? <Skeleton h={320} /> :
            <div className="supplier-grid">{live.data.suppliers.map(s => s.connected === false
                ? <div key={s.supplier} className="supplier supplier-off"><PlugZap size={26} /><h3>{s.supplier}</h3><p className="muted">{t.notConnected}</p></div>
                : <div key={s.supplier} className="supplier">
                    <header><span className="supplier-logo"><Building2 size={20} /></span><div><h3>{s.supplier}</h3><span className="muted small">{t.checked} {dateTime(live.data.checkedAt, lang)} · {s.currency}</span></div></header>
                    <Gauge value={s.availableForBooking ?? 0} max={(s.deposit || 0) + (s.creditLimit || 0) + (s.overpay || 0) || s.availableForBooking || 1}
                        label={fmt(s.availableForBooking, s.currency)} sub={t.available} />
                    <div className="stat-grid">
                        <div className="stat"><Wallet size={16} /><span>{t.deposit}</span><b className="tabular">{fmt(s.deposit, s.currency)}</b></div>
                        <div className="stat"><CreditCard size={16} /><span>{t.creditLimit}</span><b className="tabular">{fmt(s.creditLimit, s.currency)}</b></div>
                        <div className="stat"><Hourglass size={16} /><span>{t.unpaid}</span><b className="tabular">{fmt(s.unpaidOrders, s.currency)}</b>
                            <small>{t.unpaidRef} {fmt(s.unpaidRefundable, '')} · {t.unpaidNonRef} {fmt(s.unpaidNonRefundable, '')}</small></div>
                        <div className={`stat ${s.overdueDebt > 0 ? 'stat-alert' : 'stat-ok'}`}>{s.overdueDebt > 0 ? <Hourglass size={16} /> : <CheckCircle2 size={16} />}
                            <span>{t.overdue}</span><b className="tabular">{fmt(s.overdueDebt, s.currency)}</b></div>
                    </div>
                    {s.agreements?.length > 0 && <ul className="agreements">{s.agreements.map(a => <li key={a.agreement}><span className="mono">{a.agreement}</span>
                        <span className="muted">{t.unpaid} {fmt(a.unpaidOrders, '')}</span><span className="muted">{t.overdue} {fmt(a.overdueDebt, '')}</span></li>)}</ul>}
                </div>)}</div>}
    </section>;
}

const EXAMPLE = 1000;
function preview(row) {
    const percent = Number(row.percent) || 0, fixed = Number(row.fixed) || 0, vat = Number(row.vatPercent) || 0;
    return (EXAMPLE * percent / 100 + (row.fixedCurrency === 'AED' ? fixed : 0)) * (1 + vat / 100);
}

export function Fees() {
    const { t } = useT();
    const [rows, setRows] = useState(null);
    const [state, setState] = useState({ busy: false, message: '' });
    useEffect(() => { desk('/finance/providers').then(data => setRows(data.providers)).catch(() => setState({ busy: false, message: t.error })); }, [t.error]);
    const set = (key, field, value) => setRows(current => ({ ...current, [key]: { ...current[key], [field]: value } }));
    const save = async () => {
        setState({ busy: true, message: '' });
        const providers = Object.fromEntries(Object.entries(rows).filter(([, row]) => row.connected).map(([key, row]) =>
            [key, { percent: String(row.percent || '0'), fixed: String(row.fixed || '0'), fixedCurrency: row.fixedCurrency || 'AED', vatPercent: String(row.vatPercent || '0') }]));
        try { const data = await desk('/finance/providers', { method: 'PUT', body: { providers } }); setRows(data.providers); setState({ busy: false, message: t.saved }); }
        catch (error) { setState({ busy: false, message: error instanceof DeskError && error.code === 'desk_invalid_fees' ? t.invalidFees : t.error }); }
    };
    return <section className="view">
        <header className="view-head"><div><span className="eyebrow">{t.finance}</span><h1>{t.feesTitle}</h1><p className="lead">{t.feesBody}</p></div></header>
        {!rows ? <Skeleton h={260} /> : <>
            <div className="fee-grid">{Object.entries(rows).map(([key, row]) => <div key={key} className={`fee-card fee-${key} ${row.connected ? '' : 'fee-off'}`}>
                <header><span className={`chip chip-provider chip-${key}`}>{row.label}</span><span className="muted small">{row.kind === 'card' ? t.card : t.bnpl}</span>
                    {!row.connected && <span className="chip">{t.comingSoon}</span>}</header>
                <label><span>{t.percent}</span><input inputMode="decimal" dir="ltr" disabled={!row.connected} value={row.percent} onChange={e => set(key, 'percent', e.target.value)} /></label>
                <label><span>{t.fixed}</span><div className="input-pair"><input inputMode="decimal" dir="ltr" disabled={!row.connected} value={row.fixed} onChange={e => set(key, 'fixed', e.target.value)} />
                    <select disabled={!row.connected} value={row.fixedCurrency} onChange={e => set(key, 'fixedCurrency', e.target.value)}>{['AED', 'USD', 'SAR', 'EUR'].map(c => <option key={c}>{c}</option>)}</select></div></label>
                <label><span>{t.vat}</span><input inputMode="decimal" dir="ltr" disabled={!row.connected} value={row.vatPercent} onChange={e => set(key, 'vatPercent', e.target.value)} /></label>
                <footer><span className="muted small">{t.example}</span><b className="tabular">{row.connected ? fmt(preview(row)) : '—'}</b></footer>
            </div>)}</div>
            <div className="save-bar"><button className="btn btn-primary" disabled={state.busy} onClick={save}>{t.save}</button>
                {state.message && <span role="status" className="muted">{state.message}</span>}</div>
        </>}
    </section>;
}

