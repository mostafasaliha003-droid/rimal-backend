import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Banknote, CircleDollarSign, Coins, Landmark, Percent, ReceiptText, X } from 'lucide-react';
import { desk, useLive } from './api';
import { fmt, pct, day, dateTime, useT } from './i18n';
import { AnimatedNumber, AreaChart, Donut, Meter, Spark } from './charts';
import { LiveBadge, Panel, Skeleton, ErrorState, StatusChip, ProviderChip } from './ui';

const COLORS = { sell: '#C9B7F5', net: '#3EEDBF', cost: '#F2B48C', fee: '#8E6BC0', refund: '#FF7A8A' };

function Kpi({ icon: Icon, label, value, hint, tone = 'plain', spark, format }) {
    return <div className={`kpi kpi-${tone}`}>
        <div className="kpi-top"><span className="kpi-icon"><Icon size={18} /></span><span className="kpi-label">{label}</span></div>
        <div className="kpi-value"><AnimatedNumber value={value} format={format} /></div>
        <div className="kpi-foot"><span>{hint}</span>{spark}</div>
    </div>;
}

function BookingDrawer({ row, onClose, onOpenCare }) {
    const { t, lang } = useT();
    if (!row) return null;
    const r = row.reporting;
    const lines = [[t.sell, row.sell && fmt(row.sell.amount, row.sell.currency), r.sell], [t.refunded, fmt(row.refunded.amount, row.refunded.currency), -r.refunded],
        [t.supplierCost, row.cost ? fmt(row.cost.amount, row.cost.currency) : '—', r.cost === null ? null : -r.cost], [t.paymentFees, row.fee ? fmt(row.fee.amount, row.fee.currency) : t.notConfigured, -r.fee]];
    return <div className="drawer-scrim" onClick={onClose}>
        <aside className="drawer" onClick={event => event.stopPropagation()} role="dialog" aria-label={row.reference}>
            <header><div><span className="eyebrow">{t.economics}</span><h3 className="mono">{row.reference}</h3></div>
                <button className="icon-btn" onClick={onClose} aria-label="close"><X size={18} /></button></header>
            <p className="drawer-hotel">{row.hotel || '—'}</p>
            <p className="muted">{row.room} · {day(row.checkin, lang)} → {day(row.checkout, lang)} · {row.guest}</p>
            <div className="chips"><StatusChip status={row.status} /><ProviderChip provider={row.provider} />{row.test && <span className="chip chip-test">{t.test}</span>}</div>
            <div className="waterfall">
                {lines.map(([label, original, value]) => <div key={label} className="wf-row"><span>{label}</span><span className="muted mono">{original}</span>
                    <b className={`tabular ${value < 0 ? 'neg' : ''}`}>{value === null ? '—' : fmt(value)}</b></div>)}
                <div className="wf-row wf-total"><span>{t.net}</span><span>{pct(r.margin)}</span><b className={`tabular ${r.net < 0 ? 'neg' : 'pos'}`}>{fmt(r.net)}</b></div>
            </div>
            <p className="muted small">{row.rateSource === 'booking' ? t.rateBooking : t.rateLive} · {dateTime(row.createdAt, lang)}</p>
            {row.issues.length > 0 && <ul className="issues">{row.issues.map(issue => <li key={issue}><AlertTriangle size={14} />{issue.startsWith('fees_not_configured') ? `${t.feesMissing} ${issue.split(':')[1]}`
                : issue === 'supplier_cost_unknown' ? t.costUnknown : issue === 'supplier_penalty_unknown' ? t.penaltyUnknown : t.fxMissing}</li>)}</ul>}
            <button className="btn btn-ghost" onClick={() => onOpenCare(row.reference)}>{t.care}<ArrowUpRight size={16} /></button>
        </aside>
    </div>;
}

export default function Finance({ go }) {
    const { t, lang, rtl } = useT();
    const [days, setDays] = useState(30);
    const [selected, setSelected] = useState(null);
    const live = useLive(signal => desk(`/finance/overview?days=${days}`, { signal }), [days], 30000);
    const data = live.data;
    const series = useMemo(() => (data?.series || []).map(point => ({ ...point, label: day(point.day, lang) })), [data, lang]);
    const missingFees = (data?.warnings || []).filter(w => w.startsWith('fees_not_configured')).map(w => w.split(':')[1]);
    const otherIssues = (data?.warnings || []).filter(w => !w.startsWith('fees_not_configured'));
    const totals = data?.totals;
    const kept = totals ? totals.sell - totals.refunds : null;
    const maxHotel = Math.max(1, ...(data?.hotels || []).map(h => Math.abs(h.net)));
    const maxProvider = Math.max(1, ...(data?.providers || []).map(p => p.sell));

    return <section className="view">
        <header className="view-head">
            <div><span className="eyebrow">{t.console}</span><h1>{t.finance}</h1></div>
            <div className="head-actions">
                <div className="segmented" role="tablist">{[7, 30, 90, 365].map(value => <button key={value} role="tab" aria-selected={days === value}
                    className={days === value ? 'on' : ''} onClick={() => setDays(value)}>{t.days[value]}</button>)}</div>
                <LiveBadge at={live.at} loading={live.loading} onRefresh={live.reload} />
            </div>
        </header>

        {missingFees.length > 0 && <div className="banner banner-warn"><AlertTriangle size={18} />
            <div><b>{t.feesMissing} {missingFees.map(p => p[0].toUpperCase() + p.slice(1)).join(' · ')}</b><span>{t.feesMissingBody}</span></div>
            <button className="btn btn-small" onClick={() => go('fees')}>{t.setFees}</button></div>}
        {otherIssues.length > 0 && <div className="banner banner-info"><AlertTriangle size={18} /><div>{otherIssues.map(issue => <span key={issue}>
            {issue === 'supplier_cost_unknown' ? t.costUnknown : issue === 'supplier_penalty_unknown' ? t.penaltyUnknown : t.fxMissing}</span>)}</div></div>}

        {live.error && !data ? <ErrorState error={live.error} retry={live.reload} /> : !data ? <div className="kpis">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={138} />)}</div> : <>
            <div className="kpis">
                <Kpi icon={Banknote} label={t.revenue} value={kept} hint={t.revenueHint} spark={<Spark values={series.map(p => p.sell)} color={COLORS.sell} />} />
                <Kpi icon={Landmark} label={t.supplierCost} value={totals.cost} hint={pct(kept ? totals.cost / kept * 100 : null)} tone="cost" />
                <Kpi icon={ReceiptText} label={t.paymentFees} value={totals.fees} hint={missingFees.length ? t.notConfigured : pct(kept ? totals.fees / kept * 100 : null)} tone="fee" />
                <Kpi icon={CircleDollarSign} label={t.net} value={totals.net} hint={`${t.margin} ${pct(totals.margin)}`} tone={totals.net < 0 ? 'neg' : 'net'}
                    spark={<Spark values={series.map(p => p.net)} color={COLORS.net} />} />
                <Kpi icon={Coins} label={t.bookingsCount} value={totals.bookings} format={v => String(Math.round(v))}
                    hint={`${t.confirmed} ${totals.confirmed} · ${t.cancelled} ${totals.cancelled}${totals.failed ? ` · ${t.failed} ${totals.failed}` : ''}`} />
                <Kpi icon={Percent} label={t.margin} value={totals.margin} format={v => pct(v)} hint={`${fmt(totals.averageNet)} / ${t.bookingsCount}`} />
            </div>

            <div className="grid-2">
                <Panel title={t.salesVsNet} legend={[[t.sell, COLORS.sell], [t.net, COLORS.net]]}>
                    <AreaChart series={series} rtl={rtl} label={t.salesVsNet} lines={[{ key: 'sell', label: t.sell, color: COLORS.sell }, { key: 'net', label: t.net, color: COLORS.net }]} />
                </Panel>
                <Panel title={t.whereMoneyGoes}>
                    <Donut total={fmt(kept, '', 0)} caption="AED" parts={[{ label: t.supplierCost, value: totals.cost, color: COLORS.cost },
                        { label: t.paymentFees, value: totals.fees, color: COLORS.fee }, { label: t.net, value: totals.net, color: COLORS.net }]} />
                </Panel>
            </div>

            <div className="grid-2">
                <Panel title={t.byProvider}>
                    <ul className="rank">{(data.providers || []).map(p => <li key={p.provider}>
                        <ProviderChip provider={p.provider} /><span className="muted">{p.count}×</span><Meter value={p.sell} max={maxProvider} color={COLORS.sell} />
                        <b className="tabular">{fmt(p.sell)}</b><span className="muted tabular">{t.fee} {fmt(p.fees)}</span></li>)}
                        {Object.values(data.fees || {}).filter(f => !f.connected).map(f => <li key={f.label} className="ghost-row"><span className="chip">{f.label}</span><span className="muted">{t.comingSoon}</span></li>)}
                    </ul>
                </Panel>
                <Panel title={t.topHotels}>
                    <ul className="rank">{(data.hotels || []).slice(0, 8).map(h => <li key={h.hid || h.hotel}>
                        <span className="rank-name">{h.hotel}</span><span className="muted">{h.count}×</span><Meter value={h.net} max={maxHotel} color={COLORS.net} />
                        <b className={`tabular ${h.net < 0 ? 'neg' : ''}`}>{fmt(h.net)}</b><span className="muted tabular">{pct(h.sell ? h.net / h.sell * 100 : null)}</span></li>)}
                        {!data.hotels?.length && <li className="muted">{t.empty}</li>}</ul>
                </Panel>
            </div>

            <Panel title={t.latest} flush>
                {!data.bookings.length ? <p className="empty">{t.empty}</p> : <div className="table-wrap"><table className="table">
                    <thead><tr><th>{t.reference}</th><th>{t.hotel}</th><th>{t.status}</th><th>{t.provider}</th><th className="num">{t.sell}</th>
                        <th className="num">{t.cost}</th><th className="num">{t.fee}</th><th className="num">{t.net}</th><th className="num">{t.margin}</th></tr></thead>
                    <tbody>{data.bookings.map(row => <tr key={row.reference} onClick={() => setSelected(row)} tabIndex={0} onKeyDown={event => event.key === 'Enter' && setSelected(row)}>
                        <td><span className="mono">{row.reference.slice(0, 13)}</span>{row.test && <span className="chip chip-test">{t.test}</span>}<small>{dateTime(row.createdAt, lang)}</small></td>
                        <td className="ellipsis">{row.hotel || '—'}<small>{row.guest}</small></td>
                        <td><StatusChip status={row.status} /></td><td><ProviderChip provider={row.provider} /></td>
                        <td className="num tabular">{fmt(row.reporting.sell, '')}</td><td className="num tabular">{fmt(row.reporting.cost, '')}</td>
                        <td className="num tabular">{row.fee ? fmt(row.reporting.fee, '') : <span className="muted">—</span>}</td>
                        <td className={`num tabular strong ${row.reporting.net < 0 ? 'neg' : 'pos'}`}>{fmt(row.reporting.net, '')}</td>
                        <td className="num tabular">{pct(row.reporting.margin)}</td></tr>)}</tbody></table></div>}
            </Panel>
        </>}
        <BookingDrawer row={selected} onClose={() => setSelected(null)} onOpenCare={reference => { setSelected(null); go('bookings', reference); }} />
    </section>;
}
