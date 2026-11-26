import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fmt } from './i18n';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that glides to its new value (ease-out), so live changes are noticed, not jarring. */
export function AnimatedNumber({ value, format = v => fmt(v), duration = 900 }) {
    const [shown, setShown] = useState(value ?? 0);
    const from = useRef(value ?? 0);
    useEffect(() => {
        if (value === null || value === undefined) return undefined;
        if (reduced()) { setShown(value); from.current = value; return undefined; }
        const start = performance.now(), origin = from.current;
        let frame;
        const step = now => {
            const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 4);
            setShown(origin + (value - origin) * eased);
            if (t < 1) frame = requestAnimationFrame(step); else from.current = value;
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [value, duration]);
    return <span className="tabular">{value === null || value === undefined ? '—' : format(shown)}</span>;
}

/** Smooth monotone path through points (Fritsch–Carlson), so the curve never overshoots the data. */
function smooth(points) {
    if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
    const n = points.length, dx = [], m = [], tangent = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; m[i] = (points[i + 1][1] - points[i][1]) / (dx[i] || 1); }
    tangent[0] = m[0]; tangent[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) tangent[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
        const [x0, y0] = points[i], [x1, y1] = points[i + 1], h = dx[i] / 3;
        d += ` C${x0 + h},${y0 + tangent[i] * h} ${x1 - h},${y1 - tangent[i + 1] * h} ${x1},${y1}`;
    }
    return d;
}

/** Area chart for a daily series: gradient fills, a drawn-in stroke, and a crosshair tooltip. */
export function AreaChart({ series, lines, height = 220, rtl = false, label }) {
    const id = useId().replace(/:/g, '');
    const [hover, setHover] = useState(null);
    const width = 720, pad = { t: 16, r: 12, b: 26, l: 12 };
    const max = Math.max(1, ...series.flatMap(point => lines.map(line => Math.abs(point[line.key] || 0))));
    const x = i => { const pos = pad.l + (series.length < 2 ? 0 : i * (width - pad.l - pad.r) / (series.length - 1)); return rtl ? width - pos : pos; };
    const y = v => pad.t + (height - pad.t - pad.b) * (1 - Math.max(0, v) / max);
    const paths = useMemo(() => lines.map(line => {
        const points = series.map((point, i) => [x(i), y(point[line.key] || 0)]);
        const stroke = smooth(rtl ? [...points].reverse() : points);
        const ordered = rtl ? [...points].reverse() : points;
        const area = ordered.length ? `${stroke} L${ordered[ordered.length - 1][0]},${height - pad.b} L${ordered[0][0]},${height - pad.b} Z` : '';
        return { ...line, stroke, area };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [series, lines, rtl, max]);
    const ticks = series.length > 1 ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : [0];
    const move = event => {
        const box = event.currentTarget.getBoundingClientRect();
        const rel = (event.clientX - box.left) / box.width * width;
        const ratio = (rtl ? width - rel : rel) - pad.l;
        const i = Math.round(ratio / ((width - pad.l - pad.r) / Math.max(1, series.length - 1)));
        setHover(Math.max(0, Math.min(series.length - 1, i)));
    };
    return <div className="chart" role="img" aria-label={label}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => setHover(null)}>
            <defs>{paths.map(line => <linearGradient key={line.key} id={`${id}-${line.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={line.color} stopOpacity="0.34" /><stop offset="1" stopColor={line.color} stopOpacity="0" />
            </linearGradient>)}</defs>
            {[0.25, 0.5, 0.75].map(f => <line key={f} x1={pad.l} x2={width - pad.r} y1={pad.t + (height - pad.t - pad.b) * f} y2={pad.t + (height - pad.t - pad.b) * f} className="grid" />)}
            {paths.map(line => <path key={line.key + 'a'} d={line.area} fill={`url(#${id}-${line.key})`} className="area" />)}
            {paths.map(line => <path key={line.key} d={line.stroke} fill="none" stroke={line.color} strokeWidth="2.4" strokeLinecap="round" className="stroke" pathLength="1" />)}
            {hover !== null && <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} className="cross" />
                {lines.map(line => <circle key={line.key} cx={x(hover)} cy={y(series[hover][line.key] || 0)} r="5" fill="#fff" stroke={line.color} strokeWidth="2.5" />)}
            </g>}
            {ticks.map(i => <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? (rtl ? 'end' : 'start') : i === series.length - 1 ? (rtl ? 'start' : 'end') : 'middle'} className="tick">{series[i]?.label}</text>)}
        </svg>
        {hover !== null && <div className="tooltip" style={{ insetInlineStart: `${Math.min(78, Math.max(4, hover / Math.max(1, series.length - 1) * 100))}%` }}>
            <b>{series[hover].label}</b>
            {lines.map(line => <span key={line.key}><i style={{ background: line.color }} />{line.label}: {fmt(series[hover][line.key])}</span>)}
        </div>}
    </div>;
}

/** Donut of where the money goes; segments sweep in, the centre holds the total. */
export function Donut({ parts, total, caption, size = 196 }) {
    const r = 74, c = 2 * Math.PI * r, sum = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
    let offset = 0;
    return <div className="donut">
        <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={caption}>
            <circle cx="100" cy="100" r={r} className="track" />
            {parts.map(part => {
                const length = Math.max(0, part.value) / sum * c, seg = <circle key={part.label} cx="100" cy="100" r={r} stroke={part.color}
                    strokeDasharray={`${Math.max(0, length - 2)} ${c}`} strokeDashoffset={-offset} className="seg" transform="rotate(-90 100 100)" />;
                offset += length;
                return seg;
            })}
            <text x="100" y="94" textAnchor="middle" className="donut-total">{total}</text>
            <text x="100" y="118" textAnchor="middle" className="donut-caption">{caption}</text>
        </svg>
        <ul className="legend">{parts.map(part => <li key={part.label}><i style={{ background: part.color }} /><span>{part.label}</span>
            <b className="tabular">{Math.round(Math.max(0, part.value) / sum * 100)}%</b></li>)}</ul>
    </div>;
}

/** Semicircle gauge (e.g. room left to book with the supplier). */
export function Gauge({ value, max, label, sub }) {
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0, r = 80, c = Math.PI * r;
    const tone = ratio > 0.5 ? '#3EEDBF' : ratio > 0.2 ? '#F2B48C' : '#FF7A8A';
    return <div className="gauge">
        <svg viewBox="0 0 200 116" role="img" aria-label={label}>
            <path d="M20 106 A80 80 0 0 1 180 106" className="gauge-track" />
            <path d="M20 106 A80 80 0 0 1 180 106" className="gauge-fill" stroke={tone} strokeDasharray={`${c * ratio} ${c}`} />
        </svg>
        <div className="gauge-label"><b className="tabular">{label}</b><span>{sub}</span></div>
    </div>;
}

/** A tiny trend line for KPI cards. */
export function Spark({ values, color = '#C9B7F5' }) {
    if (!values?.length) return null;
    const max = Math.max(1, ...values.map(Math.abs)), w = 120, h = 34;
    const points = values.map((v, i) => [i * w / Math.max(1, values.length - 1), h - 3 - (Math.max(0, v) / max) * (h - 6)]);
    return <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><path d={smooth(points)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" /></svg>;
}

/** Horizontal bar with a label and value. */
export function Meter({ value, max, color = '#8E6BC0' }) {
    return <span className="meter"><span style={{ width: `${max > 0 ? Math.max(2, Math.min(100, Math.abs(value) / max * 100)) : 0}%`, background: value < 0 ? '#FF7A8A' : color }} /></span>;
}
