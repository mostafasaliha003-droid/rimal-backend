import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../i18n';

function money(amount, currency) {
    if (typeof amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(amount)
        || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency', currency, maximumFractionDigits: 2
        }).format(Number(amount));
    } catch {
        return `${currency} ${amount}`;
    }
}

function commentText(comment) {
    if (typeof comment === 'string') return comment.trim();
    if (comment && typeof comment.description === 'string') return comment.description.trim();
    return '';
}

function cancellationMoney(policy) {
    const penalty = policy?.penalty || (policy?.amount != null
        ? { amount: String(policy.amount), currency: policy.currency } : null);
    if (typeof penalty?.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(penalty.amount)
        || typeof penalty.currency !== 'string' || !/^[A-Z]{3}$/.test(penalty.currency)) return null;
    return money(penalty.amount, penalty.currency);
}

export default function RateReviewConsent({
    review, accepted, onAcceptedChange, onExpiryChange, disabled = false
}) {
    const { t, direction } = useLanguage();
    const [secondsRemaining, setSecondsRemaining] = useState(() => review?.expiresInSeconds || 0);
    const onExpiryChangeRef = useRef(onExpiryChange);

    useEffect(() => {
        onExpiryChangeRef.current = onExpiryChange;
    }, [onExpiryChange]);

    useEffect(() => {
        if (!review?.expiresAt) {
            setSecondsRemaining(0);
            return undefined;
        }
        const update = () => {
            const expiry = Date.parse(review.expiresAt);
            const remaining = Number.isFinite(expiry)
                ? Math.max(0, Math.ceil((expiry - Date.now()) / 1000)) : 0;
            setSecondsRemaining(remaining);
            if (remaining === 0) onExpiryChangeRef.current?.(true);
        };
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, [review?.expiresAt]);

    if (!review) return null;
    const expired = secondsRemaining <= 0;
    const comments = (Array.isArray(review.rateComments) ? review.rateComments : [])
        .map(commentText).filter(Boolean);
    const issues = Array.isArray(review.contractTerms?.issues)
        ? review.contractTerms.issues.filter(value => typeof value === 'string' && value.trim()) : [];
    const facilities = Array.isArray(review.contractTerms?.mandatoryFacilities)
        ? review.contractTerms.mandatoryFacilities.filter(item => item?.description) : [];
    const cancellation = Array.isArray(review.cancellation?.schedule) ? review.cancellation.schedule : [];
    const taxes = review.taxes;
    const taxesUnknown = taxes?.status !== 'provided' || typeof taxes.allIncluded !== 'boolean'
        || !Array.isArray(taxes.items) || taxes.items.some(item => typeof item?.included !== 'boolean');

    return (
        <section aria-labelledby="hotelbeds-rate-review-heading"
            className="space-y-5 rounded-2xl border border-remal-blue/20 bg-white/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="eyebrow">{t('nextgen.directReviewEyebrow', 'Price and terms review')}</p>
                    <h2 id="hotelbeds-rate-review-heading" className="mt-1 text-xl font-black text-remal-navy">
                        {t('nextgen.directReviewTitle', 'Review this exact hotel offer')}
                    </h2>
                </div>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-black ${expired
                    ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                    <Clock3 size={16} aria-hidden="true" />
                    {expired ? t('nextgen.directReviewExpired', 'This review expired')
                        : t('nextgen.directReviewCountdown', 'Expires in {{seconds}}s', { seconds: secondsRemaining })}
                </span>
            </div>

            <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                <div>
                    <dt className="font-semibold text-slate-500">{t('nextgen.hotel', 'Hotel')}</dt>
                    <dd className="mt-1 font-black text-remal-navy">{review.hotel?.name || t('nextgen.hotel', 'Hotel')}</dd>
                </div>
                <div>
                    <dt className="font-semibold text-slate-500">{t('nextgen.room', 'Room')}</dt>
                    <dd className="mt-1 font-black text-remal-navy">{review.room?.name || t('nextgen.roomUnknown', 'Room details unavailable')}</dd>
                </div>
                <div>
                    <dt className="font-semibold text-slate-500">{t('nextgen.directBoardOccupancy', 'Board and guests')}</dt>
                    <dd className="mt-1 font-black text-remal-navy">
                        {[review.board?.supplierName, review.board?.supplierCode].filter(Boolean).join(' · ')
                            || t('nextgen.boardUnknown', 'Board information unavailable')}
                        {' · '}{t('nextgen.directAdults', '{{count}} adults', {
                            count: review.occupancy?.adults ?? 0
                        })}
                        {' · '}{t('nextgen.directRoomCount', '{{count}} room', {
                            count: review.occupancy?.rooms ?? 0
                        })}
                    </dd>
                </div>
                <div>
                    <dt className="font-semibold text-slate-500">{t('nextgen.stay', 'Stay')}</dt>
                    <dd className="mt-1 font-black text-remal-navy">{review.stay?.checkIn} — {review.stay?.checkOut}</dd>
                </div>
                <div>
                    <dt className="font-semibold text-slate-500">{t('nextgen.directPayAtProperty', 'Payment')}</dt>
                    <dd className="mt-1 font-black text-remal-navy">{t('nextgen.payAtProperty', 'Pay at property')}</dd>
                </div>
            </dl>

            <div className="rounded-xl border border-remal-navy/10 p-4">
                <p className="text-sm font-bold text-slate-500">{t('nextgen.total', 'Stay total')}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-remal-navy">
                    {money(review.price?.amount, review.price?.currency)
                        || t('nextgen.priceUnavailable', 'Price unavailable')}
                </p>
            </div>

            <section aria-labelledby="hotelbeds-cancellation-heading" className="space-y-2">
                <h3 id="hotelbeds-cancellation-heading" className="font-black text-remal-navy">
                    {t('nextgen.directCancellation', 'Cancellation policy')}
                </h3>
                <p className="text-sm font-semibold text-slate-700">
                    {t(`nextgen.${({ refundable: 'refundable', non_refundable: 'nonRefundable', conditional: 'conditional' })[review.cancellation?.refundability] || 'unknownRefund'}`,
                        review.cancellation?.refundability === 'refundable' ? 'Refundable'
                            : review.cancellation?.refundability === 'non_refundable' ? 'Non-refundable'
                                : review.cancellation?.refundability === 'conditional' ? 'Cancellation with conditions'
                                    : 'Cancellation conditions unknown')}
                </p>
                {cancellation.length ? cancellation.map((policy, index) => (
                    <p key={`policy-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                        {t('nextgen.cancellationFrom', 'Cancellation terms apply from')}:{' '}
                        <bdi dir="ltr">{policy.startsAt?.source || t('nextgen.timeUnknown', 'Time zone unknown')}</bdi>
                        {cancellationMoney(policy) ? ` · ${t('nextgen.directPenalty', 'Cancellation penalty')}: ${cancellationMoney(policy)}`
                            : ` · ${t('nextgen.directPenaltyUnknown', 'Penalty amount or currency unavailable')}`}
                    </p>
                )) : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                    {t('nextgen.unknownConditions', 'Cancellation conditions unknown')}
                </p>}
            </section>

            <section aria-labelledby="hotelbeds-rate-comments-heading" className="space-y-2">
                <h3 id="hotelbeds-rate-comments-heading" className="font-black text-remal-navy">
                    {t('nextgen.rateTerms', 'Rate conditions and hotel comments')}
                </h3>
                {comments.length ? comments.map((comment, index) => (
                    <p key={`comment-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                        {comment}
                    </p>
                )) : <p className="text-sm text-slate-600">{t('nextgen.rateCommentsUnknown', 'Rate comments unavailable')}</p>}
                {issues.map((issue, index) => <p key={`issue-${index}`} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{issue}</p>)}
                {facilities.map((facility, index) => (
                    <p key={`facility-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                        {facility.description}: {facility.fee === true ? t('nextgen.paidFee', 'Paid')
                            : facility.fee === false ? t('nextgen.noFeeIndicated', 'No fee indicated')
                                : t('nextgen.feeUnknown', 'Fee unknown')}
                        {facility.amount && facility.currency ? ` · ${money(facility.amount, facility.currency)}` : ''}
                        {facility.fee === true && !(facility.amount && facility.currency)
                            ? ` · ${t('nextgen.amountUnknown', 'Amount unknown')}` : ''}
                    </p>
                ))}
            </section>

            <section aria-labelledby="hotelbeds-taxes-heading" className="space-y-2">
                <h3 id="hotelbeds-taxes-heading" className="font-black text-remal-navy">
                    {t('nextgen.directTaxesFees', 'Taxes and fees')}
                </h3>
                {Array.isArray(taxes?.items) && taxes.items.map((tax, index) => (
                    <p key={`tax-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                        {[tax.type, tax.subType].filter(Boolean).join(' · ') || t('nextgen.fee', 'Fee')}:{' '}
                        {tax.included === true ? t('nextgen.included', 'Included')
                            : tax.included === false ? t('nextgen.additionalFee', 'Not included or payable separately')
                                : t('nextgen.feeUnknown', 'Inclusion unknown')}
                        {tax.amountDisplayable === true ? ` · ${money(tax.amount, tax.currency)}` : ''}
                    </p>
                ))}
                {taxes?.status === 'provided' && taxes.allIncluded === false
                    && (!Array.isArray(taxes.items) || taxes.items.length === 0
                        || taxes.items.every(item => item.included !== false))
                    && <p className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-950">
                        {t('nextgen.taxesNotIncluded', 'Some taxes or fees are not included in the displayed total.')}
                    </p>}
                {taxesUnknown && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                    {t('nextgen.feesUnknown', 'Some tax or fee conditions are unknown; confirm the supplier terms above.')}
                </p>}
            </section>

            {review.promotions?.map((promotion, index) => (
                <p key={`promotion-${index}`} className="text-sm text-slate-700">
                    {t('nextgen.directPromotion', 'Promotion')}: {[promotion.code, promotion.name, promotion.remark].filter(Boolean).join(' · ')}
                </p>
            ))}

            {expired && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">
                {t('nextgen.directReviewRenew', 'Request a fresh review before accepting the terms.')}
            </p>}
            <label dir={direction} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm font-bold leading-6 text-amber-950">
                <input type="checkbox" name="directAcceptedTerms" checked={accepted}
                    disabled={disabled || expired}
                    aria-label={t('nextgen.directConsent', 'I reviewed and accept these exact terms')}
                    onChange={event => onAcceptedChange(event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-cyan-700" />
                <span>{t('nextgen.directConsent', 'I reviewed and accept the exact price, cancellation policy, rate comments, taxes and fees shown above.')}</span>
            </label>
            <div className="flex items-start gap-3 rounded-xl border border-remal-blue/15 bg-cyan-50/60 p-4 text-sm font-bold leading-6 text-remal-navy">
                <ShieldCheck size={18} className="mt-1 shrink-0 text-remal-blue" />
                <span>{t('nextgen.directReviewSnapshotNotice', 'These supplier terms were checked once and are accepted for a limited time. If the review expires, no booking can be submitted with it.')}</span>
            </div>
            {disabled && accepted && <p className="flex items-center gap-2 text-sm font-bold text-emerald-800"><CheckCircle2 size={16} />{t('nextgen.directTermsAccepted', 'Terms accepted')}</p>}
            {disabled && expired && <p className="flex items-center gap-2 text-sm font-bold text-amber-900"><AlertTriangle size={16} />{t('nextgen.directReviewRenew', 'Request a fresh review before accepting the terms.')}</p>}
        </section>
    );
}