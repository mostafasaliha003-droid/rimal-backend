import { useEffect, useRef, useState } from 'react';
import { BedDouble, Building, Lock, MapPin, Search, Star } from 'lucide-react';
import { call, desk } from './api';
import { fmt, pct, dateTime, useT } from './i18n';
import { Empty, Skeleton } from './ui';

const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const RESIDENCIES = ['ae', 'sa', 'kw', 'qa', 'bh', 'om', 'eg', 'jo', 'lb', 'gb', 'us', 'in'];

function Destination({ value, onPick }) {
    const { t, lang } = useT();
    const [text, setText] = useState(value?.name || '');
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const timer = useRef();
    useEffect(() => {
        clearTimeout(timer.current);
        if (text.trim().length < 2 || text === value?.name) { setItems([]); return undefined; }
        const controller = new AbortController();
        timer.current = setTimeout(() => {
            call(`/api/search/suggest?query=${encodeURIComponent(text.trim())}&language=en&display_language=${lang}`, { signal: controller.signal }).then(data => {
                const s = data.suggestions || {};
                setItems([...(s.regions || []).slice(0, 5).map(r => ({ kind: 'region', id: r.id || r.region_id, name: r.name, sub: r.country_code || r.type || '' })),
                    ...(s.hotels || []).slice(0, 7).map(h => ({ kind: 'hotel', id: h.hid || h.hotel_id || h.id, name: h.name, sub: h.region_name || '' }))].filter(item => item.id));
                setOpen(true);
            }).catch(() => setItems([]));
        }, 260);
        return () => { clearTimeout(timer.current); controller.abort(); };
    }, [text, lang, value]);
    return <div className="combo">
        <MapPin size={16} className="combo-icon" />
        <input value={text} placeholder={t.destination} onChange={e => { setText(e.target.value); onPick(null); }} onFocus={() => items.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label={t.destination} />
        {open && items.length > 0 && <ul className="combo-list" role="listbox">{items.map(item => <li key={item.kind + item.id} role="option" aria-selected="false"
            onMouseDown={() => { onPick(item); setText(item.name); setOpen(false); }}>
            {item.kind === 'hotel' ? <Building size={15} /> : <MapPin size={15} />}<span>{item.name}</span><small>{item.sub}</small></li>)}</ul>}
    </div>;
}

export default function Rates() {
    const { t, lang } = useT();
    const [target, setTarget] = useState(null);
    const [form, setForm] = useState({ checkin: iso(14), checkout: iso(16), adults: 2, residency: 'ae' });
    const [state, setState] = useState({ busy: false, data: null, error: '' });
    const search = async event => {
        event.preventDefault();
        if (!target) { setState({ busy: false, data: null, error: t.pickDestination }); return; }
        setState({ busy: true, data: null, error: '' });
        try {
            const data = await desk('/rates', { method: 'POST', body: { ...form, ...(target.kind === 'hotel' ? { hid: target.id } : { region_id: target.id }) } });
            setState({ busy: false, data, error: '' });
        } catch { setState({ busy: false, data: null, error: t.error }); }
    };
    return <section className="view">
        <header className="view-head"><div><span className="eyebrow"><Lock size={12} /> {t.admin}</span><h1>{t.ratesTitle}</h1><p className="lead">{t.ratesBody}</p></div></header>
        <form className="rate-form" onSubmit={search}>
            <Destination value={target} onPick={setTarget} />
            <label><span>{t.checkin}</span><input type="date" value={form.checkin} onChange={e => setForm({ ...form, checkin: e.target.value })} /></label>
            <label><span>{t.checkout}</span><input type="date" value={form.checkout} onChange={e => setForm({ ...form, checkout: e.target.value })} /></label>
            <label><span>{t.adults}</span><select value={form.adults} onChange={e => setForm({ ...form, adults: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>
            <label><span>{t.residency}</span><select value={form.residency} onChange={e => setForm({ ...form, residency: e.target.value })}>{RESIDENCIES.map(code => <option key={code} value={code}>{code.toUpperCase()}</option>)}</select></label>
            <button className="btn btn-primary" disabled={state.busy}><Search size={16} />{state.busy ? t.searching : t.search}</button>
        </form>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        {state.busy && <div className="stack">{[0, 1].map(i => <Skeleton key={i} h={180} />)}</div>}
        {state.data && (state.data.hotels.length === 0 ? <Empty icon={BedDouble} text={t.noRates} /> : <>
            <p className="muted small">{dateTime(state.data.searchedAt, lang)} · {t.marginAbs} = {t.sell} − {t.cost} ({state.data.markupPercent}%)</p>
            <div className="stack">{state.data.hotels.map(hotel => <article key={hotel.hid} className="rate-hotel">
                <header><div><h3>{hotel.name}</h3><span className="muted small">{hotel.stars ? <>{Array.from({ length: Math.round(hotel.stars) }, (_, i) => <Star key={i} size={12} fill="currentColor" />)}</> : null} {hotel.city || ''} · #{hotel.hid}</span></div>
                    <div className="from"><span className="muted small">{t.cost}</span><b className="tabular">{fmt(hotel.rates[0].net.amount, hotel.rates[0].net.currency)}</b></div></header>
                <div className="table-wrap"><table className="table table-compact">
                    <thead><tr><th>{t.room}</th><th>{t.meal}</th><th>{t.cancellation}</th><th className="num">{t.cost}</th><th className="num">{t.sell}</th><th className="num">{t.marginAbs}</th></tr></thead>
                    <tbody>{hotel.rates.slice(0, 12).map((rate, index) => <tr key={index}>
                        <td className="ellipsis">{rate.room}</td><td>{rate.meal || '—'}</td>
                        <td>{rate.freeBefore ? <span className="chip chip-confirmed"><i />{t.freeUntil} {dateTime(rate.freeBefore, lang)}</span> : <span className="chip chip-cancelled"><i />{t.nonRefundable}</span>}</td>
                        <td className="num tabular strong">{fmt(rate.net.amount, rate.net.currency)}</td>
                        <td className="num tabular">{rate.sell ? fmt(rate.sell.amount, rate.sell.currency) : '—'}</td>
                        <td className="num tabular pos">{rate.margin === null ? '—' : <>{fmt(rate.margin, '')}<small>{pct(rate.margin / rate.net.amount * 100)}</small></>}</td></tr>)}</tbody>
                </table></div>
            </article>)}</div>
        </>)}
    </section>;
}
