/*
 * Mkhadda Desk finance: what each booking earned, from the server's own records only.
 *
 *   sell     what the guest was charged (CheckoutAttempt.amount_minor / currency)
 *   cost     what the supplier is paid (CheckoutAttempt.supplier_payment: the B2B deposit amount),
 *            or, after a cancellation, what the supplier still keeps (BookingCancellation.amount_payable)
 *   fees     the payment provider's fee from the schedule the administrator entered (never invented)
 *   refunds  what went back to the guest (refund_completed)
 *   net      sell − refunds − cost − fees, in the reporting currency (AED)
 *
 * Amounts are converted with the rates stored in the booking's signed payment quote when present
 * (the rate the guest actually paid at), otherwise with the current public rate table.
 */
const currencies = require('../shared/paymentCurrencies.json');

const REPORTING = 'AED';
const PROVIDERS = {
    ziina: { label: 'Ziina', kind: 'card', connected: true },
    tabby: { label: 'Tabby', kind: 'bnpl', connected: true },
    tamara: { label: 'Tamara', kind: 'bnpl', connected: false }
};
const DECIMAL = /^\d{1,7}(?:\.\d{1,4})?$/;
// Payment taken: these attempts are money we hold or held.
const PAID = ['payment_verified', 'booking_pending', 'booking_confirmed', 'booking_cancelled', 'booking_failed',
    'refund_creating', 'refund_unknown', 'refund_pending', 'refund_completed', 'refund_review', 'manual_review'];

const decimals = currency => currencies[currency]?.decimals ?? 2;
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;

function money(value) {
    if (value && typeof value === 'object' && typeof value.amount === 'string' && /^\d+(?:\.\d+)?$/.test(value.amount)
        && typeof value.currency_code === 'string' && /^[A-Z]{3}$/.test(value.currency_code)) {
        return { amount: Number(value.amount), currency: value.currency_code };
    }
    return null;
}

/** A fee schedule as the administrator entered it; unconfigured until a percentage or a fixed part is set. */
function normalizeSchedule(input = {}) {
    const field = (value, fallback = '0') => typeof value === 'string' && DECIMAL.test(value.trim()) ? value.trim() : fallback;
    const percent = field(input.percent), fixed = field(input.fixed), vatPercent = field(input.vatPercent);
    const fixedCurrency = typeof input.fixedCurrency === 'string' && currencies[input.fixedCurrency] ? input.fixedCurrency : REPORTING;
    return { percent, fixed, fixedCurrency, vatPercent, active: input.active !== false,
        configured: input.configured === true || Number(percent) > 0 || Number(fixed) > 0 };
}

/** Validates the administrator's edit; rejects anything that is not a plain decimal within sane bounds. */
function validateProviders(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('desk_invalid_fees'), { code: 'desk_invalid_fees', httpStatus: 400 });
    const out = {};
    for (const key of Object.keys(PROVIDERS)) {
        const row = body[key];
        if (row === undefined) continue;
        if (!row || typeof row !== 'object') throw Object.assign(new Error('desk_invalid_fees'), { code: 'desk_invalid_fees', httpStatus: 400 });
        for (const name of ['percent', 'fixed', 'vatPercent']) {
            if (row[name] !== undefined && (typeof row[name] !== 'string' || !DECIMAL.test(row[name].trim()))) {
                throw Object.assign(new Error('desk_invalid_fees'), { code: 'desk_invalid_fees', httpStatus: 400 });
            }
        }
        if (Number(row.percent || 0) > 30 || Number(row.vatPercent || 0) > 30) throw Object.assign(new Error('desk_invalid_fees'), { code: 'desk_invalid_fees', httpStatus: 400 });
        if (row.fixedCurrency !== undefined && !currencies[row.fixedCurrency]) throw Object.assign(new Error('desk_invalid_fees'), { code: 'desk_invalid_fees', httpStatus: 400 });
        out[key] = normalizeSchedule({ ...row, configured: Number(row.percent || 0) > 0 || Number(row.fixed || 0) > 0 });
    }
    return out;
}

/** Converts with a USD-based table (units per USD). Returns null when a rate is missing. */
function convert(amount, from, to, rates) {
    if (!Number.isFinite(amount)) return null;
    if (from === to) return amount;
    const source = Number(rates?.[from]), target = Number(rates?.[to]);
    if (!(source > 0) || !(target > 0)) return null;
    return amount / source * target;
}

function feeFor(schedule, sell, currency, rates) {
    if (!schedule?.configured || !schedule.active) return null;
    const fixed = convert(Number(schedule.fixed), schedule.fixedCurrency, currency, rates);
    if (fixed === null) return null;
    return (sell * Number(schedule.percent) / 100 + fixed) * (1 + Number(schedule.vatPercent) / 100);
}

const providerOf = checkout => checkout?.payment_provider === 'tabby' ? 'tabby' : 'ziina';

/** One booking's economics. Missing pieces are reported, not guessed. */
function economics({ checkout, booking = null, cancellation = null, schedules = {}, liveRates = {} }) {
    const issues = [];
    const quoteRates = checkout?.payment_quote?.rates && typeof checkout.payment_quote.rates === 'object' ? checkout.payment_quote.rates : {};
    const rates = { ...liveRates, ...quoteRates };
    const currency = checkout.currency;
    const sell = Number.isSafeInteger(checkout.amount_minor) ? checkout.amount_minor / 10 ** decimals(currency) : null;
    const supplier = money(checkout.supplier_payment);
    const provider = providerOf(checkout);
    const state = checkout.state;
    const failed = state === 'booking_failed' || (!checkout.partner_order_id && state === 'refund_completed');
    const cancelled = Boolean(checkout.cancellation_request_hash) || state === 'booking_cancelled' || booking?.status === 'cancelled';
    let cost = failed ? 0 : supplier?.amount ?? null;
    let costCurrency = supplier?.currency || currency;
    if (cancelled && !failed) {
        const payable = money(cancellation?.amount_payable);
        if (payable) { cost = payable.amount; costCurrency = payable.currency; }
        else issues.push('supplier_penalty_unknown');
    }
    if (cost === null) issues.push('supplier_cost_unknown');
    // Money owed back to the guest is never profit: a failed booking owes everything back, a cancellation
    // owes the refund it recorded. Counted as soon as it is due, not only once the gateway completes it.
    const refundMinor = failed ? checkout.amount_minor : Number.isSafeInteger(checkout.refund_amount_minor) ? checkout.refund_amount_minor : 0;
    const refunded = Number.isSafeInteger(refundMinor) ? refundMinor / 10 ** decimals(currency) : 0;
    const refundPending = refunded > 0 && state !== 'refund_completed';
    const fee = sell === null ? null : feeFor(schedules[provider], sell, currency, rates);
    if (fee === null) issues.push(`fees_not_configured:${provider}`);
    const report = value => value === null ? null : convert(value, currency, REPORTING, rates);
    const sellR = report(sell), refundR = report(refunded), feeR = fee === null ? 0 : report(fee);
    const costR = cost === null ? null : convert(cost, costCurrency, REPORTING, rates);
    if ([sellR, refundR, feeR].includes(null) || (cost !== null && costR === null)) issues.push('fx_unavailable');
    const net = [sellR, refundR, feeR, costR].includes(null) ? null : sellR - refundR - costR - feeR;
    const kept = sellR === null || refundR === null ? null : sellR - refundR;
    return {
        reference: checkout.reference, provider, state, test: checkout.ziina_test === true,
        hotel: booking?.hotelName || checkout.prebook_snapshot?.hotel_name || '', hid: booking?.providerHotelCode || checkout.prebook_snapshot?.hid || null,
        room: checkout.prebook_snapshot?.room_name || booking?.roomType || '',
        checkin: checkout.prebook_snapshot?.checkin || booking?.checkInDate || null, checkout: checkout.prebook_snapshot?.checkout || booking?.checkOutDate || null,
        guest: booking?.customerName || '', createdAt: checkout.createdAt || null,
        status: failed ? 'failed' : cancelled ? 'cancelled' : state === 'booking_confirmed' ? 'confirmed' : state.startsWith('refund') ? 'refund' : 'pending',
        sell: sell === null ? null : { amount: round2(sell), currency }, cost: cost === null ? null : { amount: round2(cost), currency: costCurrency },
        fee: fee === null ? null : { amount: round2(fee), currency }, refunded: { amount: round2(refunded), currency },
        reporting: { currency: REPORTING, sell: sellR === null ? null : round2(sellR), cost: costR === null ? null : round2(costR),
            fee: round2(feeR || 0), refunded: round2(refundR || 0), kept: kept === null ? null : round2(kept), net: net === null ? null : round2(net),
            margin: net === null || !kept ? null : round2(net / kept * 100) },
        refundPending, rateSource: Object.keys(quoteRates).length ? 'booking' : 'live',
        issues: [...new Set(issues)]
    };
}

const dayOf = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null; };

/** Totals, a daily series, and the split by payment provider and by hotel. */
function summarize(rows, { days = 30, now = Date.now() } = {}) {
    const totals = { bookings: 0, sell: 0, cost: 0, fees: 0, refunds: 0, net: 0, confirmed: 0, cancelled: 0, failed: 0, incomplete: 0 };
    const series = new Map(), providers = new Map(), hotels = new Map();
    for (let i = days - 1; i >= 0; i--) series.set(new Date(now - i * 86400000).toISOString().slice(0, 10), { day: '', sell: 0, net: 0, count: 0 });
    for (const row of rows) {
        const r = row.reporting;
        totals.bookings += 1;
        if (row.status === 'confirmed') totals.confirmed += 1; else if (row.status === 'cancelled') totals.cancelled += 1; else if (row.status === 'failed') totals.failed += 1;
        if (r.net === null) { totals.incomplete += 1; }
        totals.sell += r.sell || 0; totals.cost += r.cost || 0; totals.fees += r.fee || 0; totals.refunds += r.refunded || 0; totals.net += r.net || 0;
        const day = dayOf(row.createdAt);
        if (day && series.has(day)) { const point = series.get(day); point.sell += r.sell || 0; point.net += r.net || 0; point.count += 1; }
        const p = providers.get(row.provider) || { provider: row.provider, label: PROVIDERS[row.provider]?.label || row.provider, count: 0, sell: 0, fees: 0 };
        p.count += 1; p.sell += r.sell || 0; p.fees += r.fee || 0; providers.set(row.provider, p);
        const key = row.hid || row.hotel || 'unknown';
        const h = hotels.get(key) || { hid: row.hid, hotel: row.hotel || '—', count: 0, sell: 0, cost: 0, net: 0 };
        h.count += 1; h.sell += r.sell || 0; h.cost += r.cost || 0; h.net += r.net || 0; hotels.set(key, h);
    }
    const kept = totals.sell - totals.refunds;
    const fix = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? round2(v) : v]));
    return {
        currency: REPORTING,
        totals: fix({ ...totals, margin: kept > 0 ? totals.net / kept * 100 : null, averageNet: totals.bookings ? totals.net / totals.bookings : 0 }),
        series: [...series.entries()].map(([day, point]) => fix({ ...point, day })),
        providers: [...providers.values()].map(fix).sort((a, b) => b.sell - a.sell),
        hotels: [...hotels.values()].map(fix).sort((a, b) => b.net - a.net)
    };
}

/** RateHawk financial details → the few numbers a manager reads, as numbers. */
function supplierBalance(details) {
    const c = details?.contract || {};
    const n = value => value === null || value === undefined || value === '' ? null : Number(value);
    return {
        supplier: 'RateHawk', currency: c.reporting_currency || null,
        deposit: n(c.deposit), creditLimit: n(c.credit_limit), overpay: n(c.contract_overpay),
        availableForBooking: n(c.max_booking_price), overdueDebt: n(c.overdue_debt),
        unpaidOrders: n(c.unpaid_orders_sum), unpaidRefundable: n(c.unpaid_ref_orders_sum), unpaidNonRefundable: n(c.unpaid_non_ref_orders_sum),
        agreements: (details?.contract_datas || []).map(row => ({ agreement: row.agreement_number, overpay: n(row.overpay), overdueDebt: n(row.overdue_debt), unpaidOrders: n(row.unpaid_orders_sum) }))
    };
}

module.exports = { REPORTING, PROVIDERS, PAID, normalizeSchedule, validateProviders, convert, feeFor, economics, summarize, supplierBalance };
