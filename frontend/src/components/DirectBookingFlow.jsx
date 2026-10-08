import { useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { useLanguage } from '../i18n';
import BookingAPI from '../services/bookingApi';
import { userAccessToken } from '../services/authSession.js';
import { normalizeCheckoutGuestDetails } from '../services/nextGenCheckout.js';
import RateReviewConsent from './RateReviewConsent.jsx';
import {
    canStartDirectHotelbedsBooking,
    directBookingAttemptStorageKey,
    isValidReviewIdempotencyKey,
    normalizeReviewOfferForDisplay,
    reviewIdempotencyStorageKey,
    validateRateReviewForSelectedOffer
} from '../services/hotelbedsRateReview.js';

const DEFINITE_REVIEW_FAILURES = new Set([
    'hotelbeds_rate_review_rate_changed',
    'hotelbeds_rate_review_stale',
    'hotelbeds_rate_review_expired',
    'hotelbeds_rate_review_failed',
    'hotelbeds_rate_review_checkrate_invalid',
    'hotelbeds_rate_review_idempotency_conflict',
    'hotelbeds_rate_review_offer_not_found',
    'hotelbeds_rate_review_offer_expired',
    'hotelbeds_rate_review_offer_not_reviewable',
    'hotelbeds_rate_review_payment_flow_unsupported',
    'hotelbeds_rate_review_reservation_unavailable',
    'hotelbeds_rate_review_revalidation_unavailable',
    'hotelbeds_rate_review_response_too_large',
    'hotelbeds_rate_review_terms_invalid',
    'hotelbeds_rate_review_terms_unresolved'
]);

function randomIdempotencyKey() {
    if (!globalThis.crypto?.randomUUID) throw new Error('secure_random_unavailable');
    return globalThis.crypto.randomUUID();
}

function validEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^\S+@\S+\.\S+$/.test(value.trim());
}

function translatedError(code, t) {
    if (code === 'hotelbeds_rate_review_disabled' || code === 'hotelbeds_booking_disabled'
        || code === 'hotelbeds_test_environment_required') {
        return t('nextgen.directPilotDisabled', 'Direct Hotelbeds booking is not enabled for this environment.');
    }
    if (code === 'hotelbeds_rate_review_rate_changed' || code === 'booking_rate_changed'
        || code === 'booking_rate_terms_changed' || code === 'booking_rate_key_changed') {
        return t('nextgen.directRateChanged', 'The supplier rate or its terms changed. Review a fresh offer before booking.');
    }
    if (code === 'hotelbeds_rate_review_stale' || code === 'hotelbeds_rate_review_expired') {
        return t('nextgen.directReviewRenew', 'This price review expired. Request a fresh review before accepting the terms.');
    }
    if (code === 'booking_guest_email_invalid') return t('nextgen.directEmailInvalid', 'Enter a valid email address.');
    if (code === 'booking_guest_name_invalid') return t('nextgen.directNameInvalid', 'Enter each guest name as it appears on travel documents.');
    return t('nextgen.directRequestFailed', 'We could not complete this step. Check the message and contact support if the result is unclear.');
}

function Field({ id, name, label, value, onChange, type = 'text', autoComplete, required = false }) {
    return (
        <label htmlFor={id} className="block min-w-0">
            <span className="mb-2 block text-sm font-black text-remal-navy">{label}{required && <span aria-hidden="true"> *</span>}</span>
            <input id={id} name={name} type={type} value={value} autoComplete={autoComplete}
                required={required} maxLength={type === 'email' ? 254 : 80}
                onChange={event => onChange(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-remal-navy/10 bg-white/75 px-4 py-3 font-semibold text-remal-navy outline-none transition placeholder:text-slate-400 focus:border-remal-blue focus:ring-4 focus:ring-remal-blue/10" />
        </label>
    );
}

export default function DirectBookingFlow({ offer, onBack, onNavigate }) {
    const { t, direction } = useLanguage();
    const id = useId();
    const submissionLock = useRef(false);
    const reviewLock = useRef(false);
    const eligible = canStartDirectHotelbedsBooking(offer);
    const [guest, setGuest] = useState({ firstName: '', lastName: '', email: '', phone: '' });
    const [additionalGuests, setAdditionalGuests] = useState(() => Array.from({
        length: Math.max(0, (offer?.occupancy?.adults || 1) - 1)
    }, () => ({ firstName: '', lastName: '' })));
    const [review, setReview] = useState(null);
    const [reviewBusy, setReviewBusy] = useState(false);
    const [bookingBusy, setBookingBusy] = useState(false);
    const [reviewAccepted, setReviewAccepted] = useState(false);
    const [reviewExpired, setReviewExpired] = useState(false);
    const [error, setError] = useState('');
    const [validation, setValidation] = useState('');
    const [voucherBusy, setVoucherBusy] = useState(false);
    const [voucherError, setVoucherError] = useState('');
    const [result, setResult] = useState(null);
    const [bookingAttemptLocked, setBookingAttemptLocked] = useState(() => {
        const key = directBookingAttemptStorageKey(offer?.publicOfferId);
        try { return key ? sessionStorage.getItem(key) !== null : false; } catch { return true; }
    });
    const stay = useMemo(() => offer?.stay || {}, [offer]);
    const labels = {
        heading: t('nextgen.directHeading', 'Book and pay at the property'),
        description: t('nextgen.directDescription', 'Review the supplier terms, accept them explicitly, and submit one booking request.'),
        review: t('nextgen.directRequestReview', 'Check current price and terms'),
        reviewAgain: t('nextgen.directRequestFreshReview', 'Request a fresh price review'),
        reviewLoading: t('nextgen.directReviewLoading', 'Checking the selected rate...'),
        reviewRetry: t('nextgen.directReviewRetry', 'Retry the review request'),
        guestDetails: t('nextgen.directGuestDetails', 'Lead guest details'),
        firstName: t('nextgen.firstName', 'First name'),
        lastName: t('nextgen.lastName', 'Last name'),
        email: t('nextgen.email', 'Email address'),
        phone: t('nextgen.phone', 'Phone number'),
        guest: t('nextgen.guest', 'Guest {{number}}'),
        fieldsRequired: t('nextgen.directFieldsRequired', 'Complete each adult guest name and enter a valid email address.'),
        consentRequired: t('nextgen.directConsentRequired', 'Review and accept the exact supplier terms before booking.'),
        submit: t('nextgen.directSubmit', 'Confirm pay-at-property booking'),
        submitting: t('nextgen.directSubmitting', 'Submitting booking request...'),
        back: t('nextgen.backOffers', 'Back to offers'),
        signIn: t('nextgen.directSignIn', 'Sign in to continue'),
        signInRequired: t('nextgen.directSignInRequired', 'Sign in before requesting a rate review or booking.'),
        unavailable: t('nextgen.directUnavailable', 'This offer is not eligible for direct pay-at-property booking.'),
        manualTitle: t('nextgen.directManualTitle', 'Booking result needs review'),
        manualBody: t('nextgen.directManualBody', 'We could not establish the final result. Do not submit or pay again. Contact support.'),
        pendingTitle: t('nextgen.directPendingTitle', 'Booking is awaiting hotel confirmation'),
        pendingBody: t('nextgen.directPendingBody', 'The supplier returned a pending status. This is not a confirmed reservation.'),
        confirmedTitle: t('nextgen.directConfirmedTitle', 'Booking confirmed'),
        confirmedBody: t('nextgen.directConfirmedBody', 'The supplier confirmed this reservation.'),
        reference: t('nextgen.directReference', 'Hotel reference: {{reference}}'),
        voucher: t('nextgen.directDownloadVoucher', 'Download booking voucher'),
        voucherLoading: t('nextgen.directVoucherLoading', 'Preparing your voucher...'),
        voucherUnavailable: t('nextgen.directVoucherUnavailable', 'The voucher is not available yet. Please try again later.'),
        snapshotNotice: t('nextgen.directSnapshotNotice', 'The supplier terms are checked once at review and are valid only until the shown expiry time.'),
        genericError: t('nextgen.directRequestFailed', 'We could not complete this step. Check the message and contact support if the result is unclear.')
    };

    const requestReview = async ({ fresh = false } = {}) => {
        if (reviewLock.current || reviewBusy || bookingBusy || result || bookingAttemptLocked) return;
        setError('');
        setValidation('');
        if (!eligible) {
            setError(labels.unavailable);
            return;
        }
        if (!userAccessToken()) {
            setError(labels.signInRequired);
            return;
        }
        const storageKey = reviewIdempotencyStorageKey(offer.publicOfferId);
        if (!storageKey) {
            setError(labels.genericError);
            return;
        }

        reviewLock.current = true;
        setReviewBusy(true);
        try {
            let idempotencyKey = null;
            try {
                idempotencyKey = !fresh ? sessionStorage.getItem(storageKey) : null;
                if (!isValidReviewIdempotencyKey(idempotencyKey)) {
                    idempotencyKey = randomIdempotencyKey();
                    sessionStorage.setItem(storageKey, idempotencyKey);
                }
            } catch {
                throw new Error('hotelbeds_rate_review_idempotency_storage_unavailable');
            }
            const response = await BookingAPI.createHotelbedsRateReview({
                publicOfferId: offer.publicOfferId
            }, idempotencyKey);
            const selectedReview = validateRateReviewForSelectedOffer(response, offer);
            const display = normalizeReviewOfferForDisplay(selectedReview);
            setReview({ raw: selectedReview, display });
            setReviewAccepted(false);
            setReviewExpired(false);
            setError('');
        } catch (requestError) {
            const code = requestError?.response?.data?.error || requestError?.message || '';
            setError(code === 'hotelbeds_rate_review_private_field_exposed'
                ? t('nextgen.directUnsafeReview', 'The rate review included unsafe private data. No booking was sent.')
                : translatedError(code, t));
            setReview(null);
            setReviewAccepted(false);
            setReviewExpired(false);
            if (DEFINITE_REVIEW_FAILURES.has(code)) {
                try { sessionStorage.removeItem(storageKey); } catch {}
            }
        } finally {
            reviewLock.current = false;
            setReviewBusy(false);
        }
    };

    const submitBooking = async event => {
        event.preventDefault();
        setError('');
        setValidation('');
        if (submissionLock.current || bookingBusy || bookingAttemptLocked || result) return;
        if (!review || reviewExpired || Date.parse(review.display.expiresAt) <= Date.now()) {
            setReviewExpired(true);
            setReviewAccepted(false);
            setValidation(t('nextgen.directReviewRenew', 'This price review expired. Request a fresh review before accepting the terms.'));
            return;
        }
        if (!reviewAccepted) {
            setValidation(labels.consentRequired);
            return;
        }

        const details = normalizeCheckoutGuestDetails({ ...guest, additionalGuests });
        if (!eligible || !details.firstName || !details.lastName || !validEmail(details.email)
            || details.phone.length > 40 || details.rooms[0].guests.length !== offer.occupancy.adults
            || details.rooms[0].guests.some(person => !person.firstName || !person.lastName)) {
            setValidation(labels.fieldsRequired);
            return;
        }
        if (!userAccessToken()) {
            setError(labels.signInRequired);
            return;
        }

        const attemptStorageKey = directBookingAttemptStorageKey(offer.publicOfferId);
        if (!attemptStorageKey) {
            setError(labels.genericError);
            return;
        }
        submissionLock.current = true;
        setBookingBusy(true);
        try {
            // Persist a no-repeat marker before the request. Any transport error after
            // dispatch stays quarantined because a Booking POST may have reached HBX.
            const marker = JSON.stringify({ startedAt: new Date().toISOString() });
            sessionStorage.setItem(attemptStorageKey, marker);
            setBookingAttemptLocked(true);
        } catch {
            submissionLock.current = false;
            setBookingBusy(false);
            setError(t('nextgen.directStorageUnavailable', 'Secure one-time booking state cannot be saved in this browser. No booking was sent.'));
            return;
        }

        try {
            const booking = await BookingAPI.bookHotelbedsDirect({
                publicOfferId: offer.publicOfferId,
                guestDetails: details,
                termsAccepted: true,
                acceptedTermsVersion: review.raw.termsVersion,
                reviewId: review.raw.reviewId,
                sourceTermsVersion: review.raw.sourceTermsVersion
            });
            if (booking?.success !== true || typeof booking.bookingReference !== 'string'
                || !booking.bookingReference.trim() || !['CONFIRMED', 'ON_REQUEST', 'PENDING'].includes(booking.status)) {
                setResult({ kind: 'unknown' });
            } else if (booking.status === 'CONFIRMED') {
                setResult({ kind: 'confirmed', bookingReference: booking.bookingReference });
            } else {
                setResult({ kind: 'pending', bookingReference: booking.bookingReference, status: booking.status });
            }
        } catch (requestError) {
            // No Booking response is treated as proof that no supplier request was
            // made. Keep the durable client-side quarantine for every error.
            setResult({ kind: 'unknown' });
        } finally {
            submissionLock.current = false;
            setBookingBusy(false);
        }
    };

    const updateAdditionalGuest = (index, field, value) => setAdditionalGuests(current =>
        current.map((person, position) => position === index ? { ...person, [field]: value } : person));

    const openSignIn = () => {
        if (onNavigate) onNavigate('/account');
        else {
            window.history.pushState({}, '', '/account');
            window.dispatchEvent(new PopStateEvent('popstate'));
        }
    };

    const authenticated = Boolean(userAccessToken());
    const canReview = eligible && authenticated && !reviewBusy && !bookingBusy && !bookingAttemptLocked && !result;
    const canBook = canReview && Boolean(review) && reviewAccepted && !reviewExpired
        && Date.parse(review?.display?.expiresAt) > Date.now();
    const resultTitle = result?.kind === 'confirmed' ? labels.confirmedTitle
        : result?.kind === 'pending' ? labels.pendingTitle : labels.manualTitle;
    const resultBody = result?.kind === 'confirmed' ? labels.confirmedBody
        : result?.kind === 'pending' ? labels.pendingBody : labels.manualBody;

    const downloadVoucher = async () => {
        if (result?.kind !== 'confirmed' || !result.bookingReference || voucherBusy) return;
        setVoucherBusy(true);
        setVoucherError('');
        let objectUrl;
        try {
            const response = await BookingAPI.getOwnedBookingVoucher(result.bookingReference);
            const contentType = response?.headers?.['content-type'] || response?.headers?.get?.('content-type') || '';
            if (!(response?.data instanceof Blob) || response.data.size === 0
                || !/^application\/pdf(?:\s*;|$)/i.test(contentType)) {
                throw new Error('booking_voucher_response_invalid');
            }
            objectUrl = URL.createObjectURL(response.data);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = `Rimal-Voucher-${result.bookingReference}.pdf`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            objectUrl = null;
        } catch {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setVoucherError(labels.voucherUnavailable);
        } finally {
            setVoucherBusy(false);
        }
    };

    if (!eligible) {
        return (
            <main dir={direction} className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-remal-bg px-5 py-10">
                <section role="alert" className="glass-surface max-w-xl rounded-3xl border border-white/80 p-8 text-center shadow-float">
                    <h1 className="text-2xl font-black text-remal-navy">{labels.unavailable}</h1>
                    {onBack && <button type="button" onClick={onBack} className="cta-red mt-6 min-h-11 rounded-xl px-5 py-2.5 font-black text-white">{labels.back}</button>}
                </section>
            </main>
        );
    }

    return (
        <main data-direct-booking-flow dir={direction}
            className="min-h-[calc(100vh-72px)] bg-[radial-gradient(ellipse_at_top,_rgba(15,143,163,0.13),_transparent_55%),linear-gradient(180deg,#f7f9fc,#edf4f7)] px-4 py-8 sm:px-6 sm:py-12">
            <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
                <section className="glass-surface rounded-3xl border border-white/80 p-5 shadow-float backdrop-blur-2xl sm:p-8">
                    <div className="mb-7 flex items-center gap-4 border-b border-remal-navy/10 pb-6">
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-remal-blue/10 text-remal-blue"><UserRound size={24} /></span>
                        <div>
                            <p className="eyebrow">{t('nextgen.payAtProperty', 'Pay at property')}</p>
                            <h1 className="mt-1 text-2xl font-black text-remal-navy sm:text-3xl">{labels.heading}</h1>
                            <p className="mt-1 text-sm font-semibold text-slate-600">{labels.description}</p>
                        </div>
                    </div>

                    {!authenticated && <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">
                        <span>{labels.signInRequired}</span>
                        <button type="button" onClick={openSignIn} className="min-h-10 rounded-lg border border-amber-300 px-4 font-black">{labels.signIn}</button>
                    </div>}

                    {error && <p role="alert" data-direct-booking-error className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
                    {validation && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">{validation}</p>}

                    {bookingAttemptLocked && !result && <section role="alert" data-direct-booking-locked className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                        <h2 className="font-black text-amber-950">{labels.manualTitle}</h2>
                        <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">
                            {t('nextgen.directPreviousAttempt', 'A booking request was already started for this offer in this browser. Check your account or contact support; this screen cannot safely submit another request.')}
                        </p>
                    </section>}

                    {!result && !bookingAttemptLocked && !review && <button type="button" disabled={!canReview} data-request-rate-review
                        onClick={() => requestReview()} className="cta-red inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                        {reviewBusy ? <LoaderCircle size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                        {reviewBusy ? labels.reviewLoading : labels.review}
                    </button>}

                    {review && !result && <form onSubmit={submitBooking} className="space-y-6" noValidate>
                        <RateReviewConsent review={review.display} accepted={reviewAccepted}
                            onAcceptedChange={value => { setReviewAccepted(value); setValidation(''); }}
                            disabled={bookingBusy || bookingAttemptLocked}
                            onExpiryChange={expired => { if (expired) { setReviewExpired(true); setReviewAccepted(false); } }} />

                        <section aria-labelledby="direct-guest-details" className="space-y-4">
                            <h2 id="direct-guest-details" className="text-lg font-black text-remal-navy">{labels.guestDetails}</h2>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field id={`${id}-first`} name="firstName" label={t('nextgen.firstName', 'First name')}
                                    autoComplete="given-name" value={guest.firstName}
                                    onChange={value => setGuest(current => ({ ...current, firstName: value }))} required />
                                <Field id={`${id}-last`} name="lastName" label={t('nextgen.lastName', 'Last name')}
                                    autoComplete="family-name" value={guest.lastName}
                                    onChange={value => setGuest(current => ({ ...current, lastName: value }))} required />
                                <Field id={`${id}-email`} name="email" label={t('nextgen.email', 'Email address')}
                                    type="email" autoComplete="email" value={guest.email}
                                    onChange={value => setGuest(current => ({ ...current, email: value }))} required />
                                <Field id={`${id}-phone`} name="phone" label={t('nextgen.phone', 'Phone number')}
                                    type="tel" autoComplete="tel" value={guest.phone}
                                    onChange={value => setGuest(current => ({ ...current, phone: value }))} />
                            </div>
                            {additionalGuests.map((person, index) => (
                                <fieldset key={index} className="grid gap-4 rounded-2xl border border-remal-navy/10 bg-white/55 p-4 sm:grid-cols-2">
                                    <legend className="px-2 text-sm font-black text-remal-navy">
                                        {labels.guest.replace('{{number}}', String(index + 2))}
                                    </legend>
                                    <Field id={`${id}-guest-${index}-first`} name={`additionalGuests.${index}.firstName`}
                                        label={t('nextgen.firstName', 'First name')} value={person.firstName}
                                        onChange={value => updateAdditionalGuest(index, 'firstName', value)} required />
                                    <Field id={`${id}-guest-${index}-last`} name={`additionalGuests.${index}.lastName`}
                                        label={t('nextgen.lastName', 'Last name')} value={person.lastName}
                                        onChange={value => updateAdditionalGuest(index, 'lastName', value)} required />
                                </fieldset>
                            ))}
                        </section>

                        <div className="flex items-start gap-3 rounded-2xl border border-remal-blue/15 bg-cyan-50/60 p-4 text-sm font-bold leading-6 text-remal-navy">
                            <LockKeyhole size={18} className="mt-1 shrink-0 text-remal-blue" />
                            <span>{t('nextgen.directSecure', 'Your booking is submitted securely. We never store supplier rate keys in this page.')}</span>
                        </div>

                        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                            {onBack && <button type="button" disabled={bookingBusy} onClick={onBack}
                                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-remal-navy/10 px-5 py-3 font-black text-remal-navy disabled:opacity-60">
                                <ArrowLeft size={17} />{labels.back}
                            </button>}
                            <button type="submit" data-submit-direct-booking
                                disabled={!canBook || bookingBusy || reviewExpired || !reviewAccepted}
                                className="cta-red inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                                {bookingBusy ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowRight size={17} />}
                                {bookingBusy ? labels.submitting : labels.submit}
                            </button>
                        </div>
                    </form>}

                    {review && !result && !bookingAttemptLocked && (reviewExpired || Date.parse(review.display.expiresAt) <= Date.now())
                        && <button type="button" data-request-fresh-rate-review disabled={!canReview}
                            onClick={() => requestReview({ fresh: true })}
                            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-remal-blue/20 px-4 py-2.5 font-black text-remal-blue disabled:opacity-60">
                            {reviewBusy && <LoaderCircle size={17} className="animate-spin" />}
                            {reviewBusy ? labels.reviewLoading : labels.reviewAgain}
                        </button>}
                </section>

                <aside className="glass-surface h-fit rounded-3xl border border-white/80 p-5 shadow-float backdrop-blur-2xl sm:p-6 lg:sticky lg:top-6">
                    <p className="eyebrow flex items-center gap-2"><ShieldCheck size={14} />{t('nextgen.summary', 'Offer summary')}</p>
                    <h2 className="mt-3 text-xl font-black text-remal-navy">{offer.hotel?.name || t('nextgen.hotel', 'Hotel')}</h2>
                    <p className="mt-2 text-sm font-semibold text-slate-600">{offer.room?.name || t('nextgen.roomUnknown', 'Room details unavailable')}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-600">{stay.checkIn} — {stay.checkOut}</p>
                    <p className="mt-5 border-t border-remal-navy/10 pt-4 text-xs font-bold text-slate-500">{labels.snapshotNotice}</p>
                </aside>
            </div>

            {result && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4" role="presentation">
                <section role="status" aria-live="polite" data-direct-booking-result={result.kind}
                    className="glass-surface w-full max-w-xl rounded-3xl border border-white/80 bg-white p-7 shadow-2xl sm:p-9">
                    <h2 className="text-2xl font-black text-remal-navy">{resultTitle}</h2>
                    <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">{resultBody}</p>
                    {result.bookingReference && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-black text-remal-navy">
                        {labels.reference.replace('{{reference}}', result.bookingReference)}
                    </p>}
                    {result.kind === 'confirmed' && <div className="mt-5">
                        {voucherError && <p role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">{voucherError}</p>}
                        <button type="button" data-download-booking-voucher disabled={voucherBusy}
                            onClick={downloadVoucher}
                            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-remal-blue/20 px-5 py-2.5 font-black text-remal-blue disabled:cursor-not-allowed disabled:opacity-60">
                            {voucherBusy ? <LoaderCircle size={17} className="animate-spin" /> : <Download size={17} />}
                            {voucherBusy ? labels.voucherLoading : labels.voucher}
                        </button>
                    </div>}
                    {onBack && <button type="button" onClick={onBack} className="cta-red mt-6 min-h-11 rounded-xl px-5 py-2.5 font-black text-white">
                        {labels.back}
                    </button>}
                </section>
            </div>}
        </main>
    );
}